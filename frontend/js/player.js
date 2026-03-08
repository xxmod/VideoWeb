/* ════════════════════════════════════════════════════════════════
   VideoWeb – Video Player Module
   ════════════════════════════════════════════════════════════════ */

const $video        = document.getElementById('videoPlayer');
const $playerTitle  = document.getElementById('playerTitle');
const $subSelector  = document.getElementById('subtitleSelector');

let currentMovieId = null;
let currentEpisodeInfo = null; // { showId, seasonNum, episodeId }
let progressTimer = null;

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

  // Combine external + embedded subtitles into unified list
  const allSubs = [];
  const subs = movie.subtitles || [];
  subs.forEach((sub) => {
    allSubs.push({
      label: sub.label,
      langCode: sub.langCode,
      src: subtitleUrl(id, sub.file),
      type: 'external',
    });
  });
  const embSubs = movie.embeddedSubtitles || [];
  embSubs.forEach((sub) => {
    if (!sub.isText) return; // skip bitmap subs
    allSubs.push({
      label: '🔗 ' + sub.label,
      langCode: sub.language,
      src: embeddedSubUrl(id, sub.index),
      type: 'embedded',
      isDefault: sub.isDefault,
    });
  });

  // Add subtitle tracks
  allSubs.forEach((sub) => {
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = sub.label;
    track.srclang = langCodeToISO(sub.langCode);
    track.src = sub.src;
    if (sub.langCode === 'zho' || sub.langCode === 'chi' || sub.langCode === 'cmn') {
      track.default = true;
    }
    $video.appendChild(track);
  });

  // Build subtitle selector UI
  buildSubtitleSelector(allSubs);

  showView('player');
  $video.focus();

  // Restore saved progress
  const w = watchData[id];
  if (w && w.progress > 0 && w.status === 'watching') {
    $video.addEventListener('loadedmetadata', () => {
      $video.currentTime = w.progress;
    }, { once: true });
  }

  // Wait for video metadata to enable default subtitle track
  $video.addEventListener('loadedmetadata', activateDefaultTrack, { once: true });

  // Start periodic progress saving (every 10 seconds)
  clearInterval(progressTimer);
  progressTimer = setInterval(() => saveProgress(), 10000);

  // Also save on pause
  $video.addEventListener('pause', saveProgress);
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
  saveProgress(); // save before stopping
  clearInterval(progressTimer);
  progressTimer = null;
  $video.removeEventListener('pause', saveProgress);
  $video.pause();
  $video.removeAttribute('src');
  while ($video.firstChild) $video.removeChild($video.firstChild);
  $video.load(); // release resources
  currentMovieId = null;
  currentEpisodeInfo = null;
}

// ── Save watch progress ──────────────────────────────────────────────────────

function saveProgress() {
  if (!currentMovieId || !authToken) return;
  const progress = $video.currentTime;
  const duration = $video.duration;
  if (!progress || !duration || isNaN(duration)) return;

  // Update local watchData immediately
  const ratio = duration > 0 ? progress / duration : 0;
  const status = ratio >= 0.9 ? 'watched' : 'watching';
  watchData[currentMovieId] = {
    status,
    progress: Math.floor(progress),
    duration: Math.floor(duration),
    updatedAt: new Date().toISOString(),
  };

  // Fire and forget
  fetch(`${API_BASE}/auth/watch-progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-token': authToken },
    body: JSON.stringify({
      movieId: currentMovieId,
      progress: Math.floor(progress),
      duration: Math.floor(duration),
    }),
  }).catch(() => {});
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

// ── Episode player ───────────────────────────────────────────────────────────

async function openEpisodePlayer(showId, seasonNum, episodeId) {
  currentEpisodeInfo = { showId, seasonNum, episodeId };
  currentMovieId = episodeId; // use episode id for watch progress tracking

  // Fetch show detail to get episode info
  let show;
  try {
    show = await api(`/teleplays/${showId}`);
  } catch {
    alert('无法获取剧集信息');
    location.hash = '#/';
    return;
  }

  const season = show.seasons.find(s => s.seasonNumber === seasonNum);
  if (!season) { alert('找不到该季'); location.hash = '#/'; return; }

  const episode = season.episodes.find(e => e.id === episodeId);
  if (!episode) { alert('找不到该集'); location.hash = '#/'; return; }

  $playerTitle.textContent = `${show.title} - S${String(seasonNum).padStart(2,'0')}E${String(episode.episode).padStart(2,'0')} · ${episode.title}`;

  // Remove old tracks and source
  while ($video.firstChild) $video.removeChild($video.firstChild);

  // Set video source
  $video.src = tpStreamUrl(showId, seasonNum, episodeId);

  // Combine external + embedded subtitles into unified list
  const allSubs = [];
  const subs = episode.subtitles || [];
  subs.forEach((sub) => {
    allSubs.push({
      label: sub.label,
      langCode: sub.langCode,
      src: tpSubtitleUrl(showId, seasonNum, episodeId, sub.file),
      type: 'external',
    });
  });
  const embSubs = episode.embeddedSubtitles || [];
  embSubs.forEach((sub) => {
    if (!sub.isText) return; // skip bitmap subs
    allSubs.push({
      label: '🔗 ' + sub.label,
      langCode: sub.language,
      src: tpEmbeddedSubUrl(showId, seasonNum, episodeId, sub.index),
      type: 'embedded',
      isDefault: sub.isDefault,
    });
  });

  // Add subtitle tracks
  allSubs.forEach((sub) => {
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = sub.label;
    track.srclang = langCodeToISO(sub.langCode);
    track.src = sub.src;
    if (sub.langCode === 'zho' || sub.langCode === 'chi' || sub.langCode === 'cmn') {
      track.default = true;
    }
    $video.appendChild(track);
  });

  buildSubtitleSelector(allSubs);
  showView('player');
  $video.focus();

  // Wait for metadata to enable default track
  $video.addEventListener('loadedmetadata', activateDefaultTrack, { once: true });

  // Start periodic progress saving
  clearInterval(progressTimer);
  progressTimer = setInterval(() => saveProgress(), 10000);
  $video.addEventListener('pause', saveProgress);
}
