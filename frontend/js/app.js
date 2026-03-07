/* ════════════════════════════════════════════════════════════════
   VideoWeb – Main Application
   ════════════════════════════════════════════════════════════════ */

const API_BASE = window.API_BASE || `${location.origin}/api`;

// ── State ────────────────────────────────────────────────────────────────────

let allMovies = [];        // full list from API
let currentDetail = null;  // currently displayed movie detail
let authToken = localStorage.getItem('vw_token') || '';
let currentUser = null;    // { username, isAdmin }
let watchData = {};        // { movieId: { status, progress, duration, updatedAt } }

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

async function api(path, options) {
  const opts = { ...options };
  if (!opts.headers) opts.headers = {};
  if (authToken) opts.headers['x-token'] = authToken;
  const res = await fetch(`${API_BASE}${path}`, opts);
  if (res.status === 401) {
    // Token expired
    clearAuth();
    showLogin();
    throw new Error('登录已过期');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API ${res.status}`);
  }
  return res.json();
}

async function apiPost(path, body) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function imgUrl(id, type)  { return `${API_BASE}/movies/${id}/image/${type}`; }
function streamUrl(id)     { return `${API_BASE}/movies/${id}/stream`; }
function subtitleUrl(id,f) { return `${API_BASE}/movies/${id}/subtitle/${encodeURIComponent(f)}`; }

// ── Auth ─────────────────────────────────────────────────────────────────────

function setAuth(token, user) {
  authToken = token;
  currentUser = user;
  localStorage.setItem('vw_token', token);
  updateUserUI();
}

function clearAuth() {
  authToken = '';
  currentUser = null;
  watchData = {};
  localStorage.removeItem('vw_token');
  updateUserUI();
}

function updateUserUI() {
  const $name = document.getElementById('dropdownUsername');
  const $adminBtn = document.getElementById('btnAdminPanel');
  if (currentUser) {
    $name.textContent = currentUser.username + (currentUser.isAdmin ? '（管理员）' : '');
    $adminBtn.classList.toggle('hidden', !currentUser.isAdmin);
  }
}

// ── Login overlay ────────────────────────────────────────────────────────────

const $loginOverlay = document.getElementById('loginOverlay');
const $loginForm    = document.getElementById('loginForm');
const $loginError   = document.getElementById('loginError');

function showLogin(isAdmin) {
  $loginOverlay.classList.remove('hidden');
  $loginError.classList.add('hidden');
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginUser').focus();
}

$loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  if (!username) { showLoginError('请输入用户名'); return; }

  const btn = document.getElementById('btnLogin');
  btn.disabled = true;
  $loginError.classList.add('hidden');
  try {
    const data = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }).then(r => r.json());

    if (data.error) { showLoginError(data.error); return; }

    setAuth(data.token, { username: data.username, isAdmin: data.isAdmin });
    $loginOverlay.classList.add('hidden');

    await loadWatchData();
    await loadMovies();
    handleRoute();
  } catch (err) {
    showLoginError('登录失败: ' + err.message);
  } finally {
    btn.disabled = false;
  }
});

function showLoginError(msg) {
  $loginError.textContent = msg;
  $loginError.classList.remove('hidden');
}

async function doLogout() {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      headers: { 'x-token': authToken },
    });
  } catch { /* ignore */ }
  clearAuth();
  $grid.innerHTML = '';
  document.getElementById('continueSection').classList.add('hidden');
  showLogin();
}

// ── User dropdown ────────────────────────────────────────────────────────────

const $userMenu   = document.getElementById('userMenu');
const $userDrop   = document.getElementById('userDropdown');

document.getElementById('btnUser').addEventListener('click', (e) => {
  e.stopPropagation();
  $userDrop.classList.toggle('hidden');
});
document.addEventListener('click', () => $userDrop.classList.add('hidden'));

// ── Change password ──────────────────────────────────────────────────────────

function openChangePw() {
  $userDrop.classList.add('hidden');
  document.getElementById('changePwOverlay').classList.remove('hidden');
  document.getElementById('cpOldPw').value = '';
  document.getElementById('cpNewPw').value = '';
  document.getElementById('changePwError').classList.add('hidden');
}

document.getElementById('changePwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const oldPassword = document.getElementById('cpOldPw').value;
  const newPassword = document.getElementById('cpNewPw').value;
  const $err = document.getElementById('changePwError');
  $err.classList.add('hidden');

  try {
    await apiPost('/auth/change-password', { oldPassword, newPassword });
    document.getElementById('changePwOverlay').classList.add('hidden');
    alert('密码已修改');
  } catch (err) {
    $err.textContent = err.message;
    $err.classList.remove('hidden');
  }
});

// ── Admin panel ──────────────────────────────────────────────────────────────

async function openAdminPanel() {
  $userDrop.classList.add('hidden');
  document.getElementById('adminOverlay').classList.remove('hidden');
  document.getElementById('adminError').classList.add('hidden');
  await refreshAdminUserList();
}

async function refreshAdminUserList() {
  try {
    const users = await api('/auth/users');
    const $list = document.getElementById('adminUserList');
    $list.innerHTML = users.map(u => `
      <div class="admin-user-row">
        <span class="admin-user-name">${esc(u.username)}${u.isAdmin ? ' <span class="admin-badge">管理员</span>' : ''}</span>
        <div class="admin-user-actions">
          ${u.isAdmin ? '' : `
            <button class="btn-sm" onclick="adminResetPw('${esc(u.username)}')">重置密码</button>
            <button class="btn-sm btn-danger" onclick="adminDeleteUser('${esc(u.username)}')">删除</button>
          `}
        </div>
      </div>
    `).join('');
  } catch (err) {
    document.getElementById('adminUserList').innerHTML = `<p style="color:#e55">${err.message}</p>`;
  }
}

async function adminResetPw(username) {
  const newPw = prompt(`设置 ${username} 的新密码（留空则无密码）:`, '');
  if (newPw === null) return;
  try {
    await apiPost(`/auth/users/${encodeURIComponent(username)}/reset-password`, { newPassword: newPw });
    alert('密码已重置');
  } catch (err) {
    alert('操作失败: ' + err.message);
  }
}

async function adminDeleteUser(username) {
  if (!confirm(`确认删除用户 "${username}"？`)) return;
  try {
    await api(`/auth/users/${encodeURIComponent(username)}`, { method: 'DELETE' });
    await refreshAdminUserList();
  } catch (err) {
    alert('删除失败: ' + err.message);
  }
}

document.getElementById('adminCreateForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('acUsername').value.trim();
  const password = document.getElementById('acPassword').value;
  const $err = document.getElementById('adminError');
  $err.classList.add('hidden');
  if (!username) { $err.textContent = '请输入用户名'; $err.classList.remove('hidden'); return; }

  try {
    await apiPost('/auth/users', { username, password });
    document.getElementById('acUsername').value = '';
    document.getElementById('acPassword').value = '';
    await refreshAdminUserList();
  } catch (err) {
    $err.textContent = err.message;
    $err.classList.remove('hidden');
  }
});

// ── Watch data ───────────────────────────────────────────────────────────────

async function loadWatchData() {
  try {
    watchData = await api('/auth/watch-data');
  } catch {
    watchData = {};
  }
}

function renderContinueWatching() {
  const $section = document.getElementById('continueSection');
  const $grid = document.getElementById('continueGrid');

  const watching = allMovies.filter(m => {
    const w = watchData[m.id];
    return w && w.status === 'watching' && w.progress > 0;
  }).sort((a, b) => {
    return new Date(watchData[b.id].updatedAt) - new Date(watchData[a.id].updatedAt);
  });

  if (watching.length === 0) {
    $section.classList.add('hidden');
    return;
  }

  $section.classList.remove('hidden');
  $grid.innerHTML = '';

  for (const m of watching) {
    const w = watchData[m.id];
    const pct = w.duration > 0 ? Math.round((w.progress / w.duration) * 100) : 0;
    const card = document.createElement('div');
    card.className = 'continue-card';
    card.onclick = () => { location.hash = `#/play/${m.id}`; };

    const posterHTML = m.hasPoster
      ? `<img src="${imgUrl(m.id, 'poster')}" alt="${esc(m.title)}" loading="lazy">`
      : `<div class="no-poster">${esc(m.title)}</div>`;

    card.innerHTML = `
      <div class="continue-poster">${posterHTML}</div>
      <div class="continue-info">
        <div class="card-title" title="${esc(m.title)}">${esc(m.title)}</div>
        <div class="continue-progress-bar"><div class="continue-progress-fill" style="width:${pct}%"></div></div>
        <div class="continue-progress-text">${formatTime(w.progress)} / ${formatTime(w.duration)}</div>
      </div>`;
    $grid.appendChild(card);
  }
}

function formatTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

// ── Movie list ───────────────────────────────────────────────────────────────

async function loadMovies() {
  $loading.classList.remove('hidden');
  $grid.innerHTML = '';
  try {
    allMovies = await api('/movies');
    $count.textContent = `${allMovies.length} 部`;
    renderGrid(allMovies);
    renderContinueWatching();
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

    // Watch status badge
    const w = watchData[m.id];
    let watchBadge = '';
    if (w) {
      if (w.status === 'watched') {
        watchBadge = '<span class="watch-badge watched">✓ 已看</span>';
      } else if (w.status === 'watching') {
        const pct = w.duration > 0 ? Math.round((w.progress / w.duration) * 100) : 0;
        watchBadge = `<span class="watch-badge watching">${pct}%</span>`;
      }
    }

    card.innerHTML = `
      <div class="poster-wrap">
        ${posterHTML}
        ${ratingHTML}
        ${watchBadge}
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

  // Watch status
  const w = watchData[m.id];
  let watchHTML = '';
  if (w && w.status === 'watched') {
    watchHTML = `<button class="btn-watch-toggle watched" onclick="toggleWatched('${m.id}')">✓ 已看过</button>`;
  } else {
    watchHTML = `<button class="btn-watch-toggle" onclick="toggleWatched('${m.id}')">标为已看</button>`;
  }

  document.getElementById('detailInfo').innerHTML = `
    <h2>${esc(m.title)}</h2>
    ${m.originalTitle ? `<p style="color:#888;font-size:14px;margin-bottom:6px">${esc(m.originalTitle)}</p>` : ''}
    <div class="meta">${meta.join('')}</div>
    <div class="genres">${genres}</div>
    ${m.tagline ? `<p class="tagline">"${esc(m.tagline)}"</p>` : ''}
    ${directors}
    ${m.plot ? `<p class="plot">${esc(m.plot)}</p>` : ''}
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:8px">
      <button class="btn-play" onclick="location.hash='#/play/${m.id}'">▶ 播放</button>
      ${watchHTML}
      <span style="font-size:12px;color:#666">${sizeGB} GB</span>
    </div>
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

async function toggleWatched(movieId) {
  const w = watchData[movieId];
  try {
    if (w && w.status === 'watched') {
      await apiPost('/auth/unmark-watched', { movieId });
      delete watchData[movieId];
    } else {
      await apiPost('/auth/mark-watched', { movieId });
      watchData[movieId] = { status: 'watched', progress: 0, duration: 0 };
    }
    // Re-render detail if still showing
    if (currentDetail && currentDetail.id === movieId) {
      showDetail(movieId);
    }
    renderGrid(allMovies);
    renderContinueWatching();
  } catch (err) {
    alert(err.message);
  }
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

// ── Setup / Settings ─────────────────────────────────────────────────────────

const $setupOverlay = document.getElementById('setupOverlay');
const $setupForm    = document.getElementById('setupForm');
const $setupError   = document.getElementById('setupError');
const $btnSettings  = document.getElementById('btnSettings');
const $btnSetupClose= document.getElementById('btnSetupClose');

let isInitialSetup = true;

async function checkSetup() {
  try {
    const settings = await fetch(`${API_BASE}/settings`).then(r => r.json());
    const needsAdmin = settings.needsAdmin;
    const needsSetup = settings.needsSetup;

    if (needsAdmin || needsSetup) {
      // First-run: show setup with admin creation
      isInitialSetup = true;
      showSetup(settings, needsAdmin);
    } else {
      isInitialSetup = false;
      $setupOverlay.classList.add('hidden');

      // Check if we have a valid token
      if (authToken) {
        try {
          const me = await api('/auth/me');
          currentUser = me;
          updateUserUI();
          await loadWatchData();
          await loadMovies();
          handleRoute();
        } catch {
          clearAuth();
          showLogin();
        }
      } else {
        showLogin();
      }
    }
  } catch (err) {
    $loading.textContent = '无法连接后端: ' + err.message;
  }
}

async function openSettings() {
  isInitialSetup = false;
  try {
    const settings = await fetch(`${API_BASE}/settings`).then(r => r.json());
    showSetup(settings, false);
  } catch (err) {
    alert('无法加载设置');
  }
}

function showSetup(settings, showAdmin) {
  $setupOverlay.classList.remove('hidden');
  document.getElementById('setupMovieDir').value = settings.movieDir || '';
  document.getElementById('setupPort').value = settings.port || 48233;
  document.getElementById('setupPort').placeholder = String(settings.port || 48233);

  const $adminFields = document.getElementById('adminFields');

  if (isInitialSetup) {
    $library.classList.add('hidden');
    $btnSetupClose.classList.add('hidden');
    document.getElementById('setupTitle').textContent = '欢迎使用 VideoWeb';
    document.getElementById('setupDesc').textContent = '首次启动，请配置电影库并创建管理员账户。';
    document.getElementById('btnSetup').textContent = '保存并开始';

    if (showAdmin) {
      $adminFields.style.display = '';
      document.getElementById('setupAdminUser').value = 'admin';
      document.getElementById('setupAdminPass').value = '';
    } else {
      $adminFields.style.display = 'none';
    }
  } else {
    $btnSetupClose.classList.remove('hidden');
    $adminFields.style.display = 'none';
    document.getElementById('setupTitle').textContent = '设置 VideoWeb';
    document.getElementById('setupDesc').textContent = '修改配置后，后端可能需要重启或重新扫描。';
    document.getElementById('btnSetup').textContent = '保存配置';
  }
}

$btnSetupClose.addEventListener('click', () => {
  $setupOverlay.classList.add('hidden');
});

$btnSettings.addEventListener('click', openSettings);

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
    // If first run with admin creation
    const $adminFields = document.getElementById('adminFields');
    if (isInitialSetup && $adminFields.style.display !== 'none') {
      const adminUser = document.getElementById('setupAdminUser').value.trim();
      const adminPass = document.getElementById('setupAdminPass').value;
      if (!adminUser) { showSetupError('请输入管理员用户名'); btn.disabled = false; btn.textContent = '保存并开始'; return; }

      // Create admin
      const adminRes = await fetch(`${API_BASE}/auth/create-admin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: adminUser, password: adminPass }),
      }).then(r => r.json());

      if (adminRes.error) { showSetupError(adminRes.error); btn.disabled = false; btn.textContent = '保存并开始'; return; }

      // Set auth
      setAuth(adminRes.token, { username: adminRes.username, isAdmin: true });
    }

    const res = await fetch(`${API_BASE}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ movieDir, port: parseInt(port) || undefined }),
    });
    const data = await res.json();
    if (!res.ok) { showSetupError(data.error || '保存失败'); return; }

    $setupOverlay.classList.add('hidden');
    
    if (isInitialSetup) {
      isInitialSetup = false;
      $library.classList.remove('hidden');
    }

    await loadWatchData();
    await loadMovies();
    handleRoute();
  } catch (err) {
    showSetupError('请求失败: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = isInitialSetup ? '保存并开始' : '保存配置';
  }
});

function showSetupError(msg) {
  $setupError.textContent = msg;
  $setupError.classList.remove('hidden');
}

// ── Theme Management ─────────────────────────────────────────────────────────

const $btnTheme = document.getElementById('btnTheme');

function initTheme() {
  const savedTheme = localStorage.getItem('vw_theme');
  if (savedTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    $btnTheme.textContent = '🌞';
  } else {
    document.documentElement.removeAttribute('data-theme');
    $btnTheme.textContent = '🌓';
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  if (current === 'light') {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('vw_theme', 'dark');
    $btnTheme.textContent = '🌓';
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('vw_theme', 'light');
    $btnTheme.textContent = '🌞';
  }
}

$btnTheme.addEventListener('click', toggleTheme);

// ── Init ─────────────────────────────────────────────────────────────────────

initTheme();
checkSetup();
