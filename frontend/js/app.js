/* ════════════════════════════════════════════════════════════════
   VideoWeb – Main Application
   ════════════════════════════════════════════════════════════════ */

const API_BASE = window.API_BASE || `${location.origin}/api`;

// ── State ────────────────────────────────────────────────────────────────────

let allMovies = [];        // full list from API
let currentDetail = null;  // currently displayed movie detail

// ── DOM references ───────────────────────────────────────────────────────────

const $grid      = document.getElementById('movieGrid');
const $loading   = document.getElementById('loading');
const $empty     = document.getElementById('emptyMsg');
const $search    = document.getElementById('searchInput');
const $count     = document.getElementById('movieCount');
const $library   = document.getElementById('library');
const $detail    = document.getElementById('detailModal');
const $player    = document.getElementById('playerView');
const $btnRescan = document.getElementById('btnRescan');

// ── API helpers ──────────────────────────────────────────────────────────────

async function api(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}`);
  return res.json();
}

function imgUrl(id, type)  { return `${API_BASE}/movies/${id}/image/${type}`; }
function streamUrl(id)     { return `${API_BASE}/movies/${id}/stream`; }
function subtitleUrl(id,f) { return `${API_BASE}/movies/${id}/subtitle/${encodeURIComponent(f)}`; }

// ── Movie list ───────────────────────────────────────────────────────────────

async function loadMovies() {
  $loading.classList.remove('hidden');
  $grid.innerHTML = '';
  try {
    allMovies = await api('/movies');
    $count.textContent = `${allMovies.length} 部`;
    renderGrid(allMovies);
  } catch (err) {
    $loading.textContent = '加载失败: ' + err.message;
  }
}

function renderGrid(movies) {
  $loading.classList.add('hidden');
  $empty.classList.toggle('hidden', movies.length > 0);
  $grid.innerHTML = '';

  for (const m of movies) {
    const card = document.createElement('div');
    card.className = 'movie-card';
    card.onclick = () => { location.hash = `#/movie/${m.id}`; };

    const posterHTML = m.hasPoster
      ? `<img src="${imgUrl(m.id, 'poster')}" alt="${esc(m.title)}" loading="lazy">`
      : `<div class="no-poster">${esc(m.title)}</div>`;

    const ratingHTML = m.rating
      ? `<span class="rating-badge">★ ${m.rating.toFixed(1)}</span>`
      : '';

    card.innerHTML = `
      <div class="poster-wrap">
        ${posterHTML}
        ${ratingHTML}
      </div>
      <div class="card-info">
        <div class="card-title" title="${esc(m.title)}">${esc(m.title)}</div>
        <div class="card-year">${m.year || ''}</div>
      </div>`;
    $grid.appendChild(card);
  }
}

// ── Search / Filter ──────────────────────────────────────────────────────────

$search.addEventListener('input', () => {
  const q = $search.value.trim().toLowerCase();
  if (!q) { renderGrid(allMovies); return; }
  const filtered = allMovies.filter(m =>
    m.title.toLowerCase().includes(q) ||
    (m.originalTitle && m.originalTitle.toLowerCase().includes(q)) ||
    (m.year && String(m.year).includes(q))
  );
  renderGrid(filtered);
});

// ── Detail view ──────────────────────────────────────────────────────────────

async function showDetail(id) {
  try {
    currentDetail = await api(`/movies/${id}`);
  } catch {
    location.hash = '#/';
    return;
  }

  const m = currentDetail;

  // Hero background
  const $hero = document.getElementById('detailHero');
  if (m.images.includes('fanart')) {
    $hero.style.backgroundImage = `url(${imgUrl(m.id, 'fanart')})`;
  } else if (m.images.includes('thumb')) {
    $hero.style.backgroundImage = `url(${imgUrl(m.id, 'thumb')})`;
  } else {
    $hero.style.backgroundImage = 'none';
    $hero.style.background = '#1a1a1a';
  }

  // Poster
  const $poster = document.getElementById('detailPoster');
  if (m.images.includes('poster')) {
    $poster.innerHTML = `<img src="${imgUrl(m.id, 'poster')}" alt="${esc(m.title)}">`;
  } else {
    $poster.innerHTML = `<div class="no-poster" style="width:200px;height:300px">${esc(m.title)}</div>`;
  }

  // Info
  const meta = [];
  if (m.year) meta.push(`<span>${m.year}</span>`);
  if (m.rating) meta.push(`<span>★ ${m.rating.toFixed(1)}</span>`);
  if (m.runtime) meta.push(`<span>${m.runtime} 分钟</span>`);
  if (m.mpaa) meta.push(`<span>${esc(m.mpaa)}</span>`);

  const genres = m.genres.map(g => `<span class="genre-tag">${esc(g)}</span>`).join('');

  const directors = m.directors.length
    ? `<p style="font-size:14px;color:#aaa;margin-bottom:8px">导演: ${m.directors.map(esc).join(', ')}</p>`
    : '';

  const subInfo = m.subtitles.length
    ? `<div class="detail-subtitles">字幕: <span>${m.subtitles.map(s => s.label).join('、')}</span></div>`
    : '';

  const sizeGB = (m.videoSize / (1024 ** 3)).toFixed(2);

  document.getElementById('detailInfo').innerHTML = `
    <h2>${esc(m.title)}</h2>
    ${m.originalTitle ? `<p style="color:#888;font-size:14px;margin-bottom:6px">${esc(m.originalTitle)}</p>` : ''}
    <div class="meta">${meta.join('')}</div>
    <div class="genres">${genres}</div>
    ${m.tagline ? `<p class="tagline">"${esc(m.tagline)}"</p>` : ''}
    ${directors}
    ${m.plot ? `<p class="plot">${esc(m.plot)}</p>` : ''}
    <button class="btn-play" onclick="location.hash='#/play/${m.id}'">▶ 播放</button>
    <span style="font-size:12px;color:#666;margin-left:12px">${sizeGB} GB</span>
    ${subInfo}`;

  // Cast
  const $cast = document.getElementById('detailCast');
  if (m.actors.length) {
    const cards = m.actors.slice(0, 20).map(a => {
      const thumb = a.thumb
        ? `<img src="${esc(a.thumb)}" alt="${esc(a.name)}" loading="lazy">`
        : a.name.charAt(0);
      return `
        <div class="cast-card">
          <div class="cast-thumb">${thumb}</div>
          <div class="cast-name">${esc(a.name)}</div>
          <div class="cast-role">${esc(a.role)}</div>
        </div>`;
    }).join('');
    $cast.innerHTML = `<h3>演员</h3><div class="cast-grid">${cards}</div>`;
  } else {
    $cast.innerHTML = '';
  }

  showView('detail');
}

// ── Routing ──────────────────────────────────────────────────────────────────

function showView(view) {
  $library.classList.toggle('hidden', view !== 'library');
  $detail.classList.toggle('hidden',  view !== 'detail');
  $player.classList.toggle('hidden',  view !== 'player');

  if (view !== 'player') {
    stopPlayer();
  }
}

function handleRoute() {
  const hash = location.hash || '#/';

  if (hash.startsWith('#/play/')) {
    const id = hash.substring(7);
    openPlayer(id);
    return;
  }

  if (hash.startsWith('#/movie/')) {
    const id = hash.substring(8);
    showDetail(id);
    return;
  }

  // Default: library
  showView('library');
}

window.addEventListener('hashchange', handleRoute);

// ── Rescan ───────────────────────────────────────────────────────────────────

$btnRescan.addEventListener('click', async () => {
  $btnRescan.disabled = true;
  $btnRescan.textContent = '…';
  try {
    await fetch(`${API_BASE}/rescan`, { method: 'POST' });
    await loadMovies();
  } catch (err) {
    alert('重新扫描失败: ' + err.message);
  } finally {
    $btnRescan.disabled = false;
    $btnRescan.textContent = '⟳';
  }
});

// ── Keyboard shortcuts ───────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!$player.classList.contains('hidden')) {
      history.back();
    } else if (!$detail.classList.contains('hidden')) {
      location.hash = '#/';
    }
  }
});

// ── Utility ──────────────────────────────────────────────────────────────────

function esc(s) {
  if (!s) return '';
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// ── Setup / First-run ────────────────────────────────────────────────────────

const $setupOverlay = document.getElementById('setupOverlay');
const $setupForm    = document.getElementById('setupForm');
const $setupError   = document.getElementById('setupError');

async function checkSetup() {
  try {
    const settings = await api('/settings');
    if (settings.needsSetup) {
      showSetup(settings);
    } else {
      $setupOverlay.classList.add('hidden');
      await loadMovies();
      handleRoute();
    }
  } catch (err) {
    $loading.textContent = '无法连接后端: ' + err.message;
  }
}

function showSetup(settings) {
  $setupOverlay.classList.remove('hidden');
  $library.classList.add('hidden');
  document.getElementById('setupPort').placeholder = String(settings.port || 48233);
}

$setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btnSetup');
  const movieDir = document.getElementById('setupMovieDir').value.trim();
  const port = document.getElementById('setupPort').value.trim();

  if (!movieDir) { showSetupError('请输入电影文件夹路径'); return; }

  btn.disabled = true;
  btn.textContent = '正在扫描…';
  $setupError.classList.add('hidden');

  try {
    const res = await fetch(`${API_BASE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ movieDir, port: parseInt(port) || undefined }),
    });
    const data = await res.json();
    if (!res.ok) { showSetupError(data.error || '保存失败'); return; }

    $setupOverlay.classList.add('hidden');
    $library.classList.remove('hidden');
    await loadMovies();
    handleRoute();
  } catch (err) {
    showSetupError('请求失败: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '保存并开始';
  }
});

function showSetupError(msg) {
  $setupError.textContent = msg;
  $setupError.classList.remove('hidden');
}

// ── Init ─────────────────────────────────────────────────────────────────────

checkSetup();
