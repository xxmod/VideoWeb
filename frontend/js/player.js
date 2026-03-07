/* ════════════════════════════════════════════════════════════════
   VideoWeb – Video Player Module
   ════════════════════════════════════════════════════════════════ */

const $video        = document.getElementById('videoPlayer');
const $playerTitle  = document.getElementById('playerTitle');
const $subSelector  = document.getElementById('subtitleSelector');

let currentMovieId = null;

// ── Open player ──────────────────────────────────────────────────────────────

async function openPlayer(id) {
  currentMovieId = id;

  // Fetch movie detail if not already loaded
  let movie = currentDetail;
  if (!movie || movie.id !== id) {
    try {
      movie = await api(`/movies/${id}`);
      currentDetail = movie;
    } catch {
      alert('无法获取影片信息');
      location.hash = '#/';
      return;
    }
  }

  $playerTitle.textContent = movie.title;

  // Remove old tracks and source
  while ($video.firstChild) $video.removeChild($video.firstChild);

  // Set video source
  $video.src = streamUrl(id);

  // Add subtitle tracks
  const subs = movie.subtitles || [];
  subs.forEach((sub, i) => {
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = sub.label;
    track.srclang = langCodeToISO(sub.langCode);
    track.src = subtitleUrl(id, sub.file);
    // Default: prefer Chinese subtitles
    if (sub.langCode === 'zho' || sub.langCode === 'chi' || sub.langCode === 'cmn') {
      track.default = true;
    }
    $video.appendChild(track);
  });

  // Build subtitle selector UI
  buildSubtitleSelector(subs);

  showView('player');
  $video.focus();

  // Wait for video metadata to enable default subtitle track
  $video.addEventListener('loadedmetadata', activateDefaultTrack, { once: true });
}

// ── Activate default subtitle ────────────────────────────────────────────────

function activateDefaultTrack() {
  const tracks = $video.textTracks;
  if (!tracks || tracks.length === 0) return;

  let chineseIdx = -1;
  for (let i = 0; i < tracks.length; i++) {
    tracks[i].mode = 'disabled';
    if (chineseIdx < 0 && ['zh', 'zh-CN', 'zh-Hans'].includes(tracks[i].language)) {
      chineseIdx = i;
    }
  }

  // Enable Chinese track, or first track if no Chinese
  const defaultIdx = chineseIdx >= 0 ? chineseIdx : 0;
  if (tracks.length > 0) {
    tracks[defaultIdx].mode = 'showing';
    // Sync selector
    const sel = $subSelector.querySelector('select');
    if (sel) sel.value = String(defaultIdx);
  }
}

// ── Subtitle selector dropdown ───────────────────────────────────────────────

function buildSubtitleSelector(subs) {
  if (subs.length === 0) {
    $subSelector.innerHTML = '<label style="color:#666">无字幕</label>';
    return;
  }

  let html = '<label>字幕:</label><select id="subSelect">';
  html += '<option value="-1">关闭</option>';
  subs.forEach((s, i) => {
    html += `<option value="${i}">${esc(s.label)}</option>`;
  });
  html += '</select>';
  $subSelector.innerHTML = html;

  const sel = document.getElementById('subSelect');
  sel.addEventListener('change', () => {
    const idx = parseInt(sel.value, 10);
    const tracks = $video.textTracks;
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].mode = i === idx ? 'showing' : 'disabled';
    }
  });
}

// ── Stop / cleanup ───────────────────────────────────────────────────────────

function stopPlayer() {
  $video.pause();
  $video.removeAttribute('src');
  while ($video.firstChild) $video.removeChild($video.firstChild);
  $video.load(); // release resources
  currentMovieId = null;
}

// ── Language code helper ─────────────────────────────────────────────────────

function langCodeToISO(code) {
  const map = {
    zho: 'zh', chi: 'zh', cmn: 'zh',
    eng: 'en',
    jpn: 'ja',
    kor: 'ko',
    fra: 'fr', fre: 'fr',
    deu: 'de', ger: 'de',
    spa: 'es',
    ita: 'it',
    por: 'pt',
    rus: 'ru',
    ara: 'ar',
    hin: 'hi',
    tha: 'th',
    vie: 'vi',
  };
  return map[code] || code;
}
