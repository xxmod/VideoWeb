const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseNfo } = require('./nfoParser');
const { detectSubtitles } = require('./subtitleService');
const { probeSubtitles, checkFfmpeg } = require('./embeddedSubtitles');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts',
]);

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function generateId(str) {
  return crypto.createHash('md5').update(str).digest('hex').substring(0, 12);
}

// ── Detect images from file list with NFO art fallback ───────────────────────

function detectShowImages(files, nfoArt) {
  const images = {};

  // NFO art paths first
  if (nfoArt && typeof nfoArt === 'object') {
    for (const [key, artPath] of Object.entries(nfoArt)) {
      const type = key.toLowerCase();
      if (images[type]) continue;
      const refBase = path.basename(artPath).toLowerCase();
      const match = files.find(f => f.toLowerCase() === refBase);
      if (match) images[type] = match;
    }
  }

  // File name convention fallback
  const patterns = {
    poster: /^poster\./i,
    fanart: /^fanart\./i,
    banner: /^banner\./i,
    'clearlogo': /^(clearlogo|logo)\./i,
    thumb: /^thumb\./i,
  };

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;
    for (const [type, regex] of Object.entries(patterns)) {
      if (!images[type] && regex.test(file)) {
        images[type] = file;
      }
    }
  }

  return images;
}

function detectSeasonImages(files, nfoArt, seasonNum, showFiles) {
  const images = {};

  // NFO art paths
  if (nfoArt && typeof nfoArt === 'object') {
    for (const [key, artPath] of Object.entries(nfoArt)) {
      const type = key.toLowerCase();
      if (images[type]) continue;
      const refBase = path.basename(artPath).toLowerCase();
      // Try in season folder first
      let match = files.find(f => f.toLowerCase() === refBase);
      // Try in show folder (parent) if NFO references it
      if (!match && showFiles) {
        match = showFiles.find(f => f.toLowerCase() === refBase);
        if (match) images[`${type}_fromShow`] = true;
      }
      if (match) images[type] = match;
    }
  }

  // Try seasonXX-poster.jpg pattern from show root
  if (!images.poster && showFiles && seasonNum != null) {
    const padded = String(seasonNum).padStart(2, '0');
    const seasonPoster = showFiles.find(f =>
      f.toLowerCase() === `season${padded}-poster.jpg` ||
      f.toLowerCase() === `season${padded}-poster.png`
    );
    if (seasonPoster) {
      images.poster = seasonPoster;
      images.poster_fromShow = true;
    }
  }

  // Try seasonXX-banner.jpg pattern
  if (!images.banner && showFiles && seasonNum != null) {
    const padded = String(seasonNum).padStart(2, '0');
    const seasonBanner = showFiles.find(f =>
      f.toLowerCase() === `season${padded}-banner.jpg` ||
      f.toLowerCase() === `season${padded}-banner.png`
    );
    if (seasonBanner) {
      images.banner = seasonBanner;
      images.banner_fromShow = true;
    }
  }

  return images;
}

// ── Parse episode info from filename ─────────────────────────────────────────

function parseEpisodeFromFilename(filename) {
  const base = path.parse(filename).name;
  // Match patterns like S01E01, S1E2, etc.
  const m = base.match(/S(\d{1,2})E(\d{1,3})/i);
  if (m) return { season: parseInt(m[1]), episode: parseInt(m[2]) };
  return null;
}

// ── Build source signature for teleplay dir ──────────────────────────────────

function buildTeleplaySignature(teleplayDir) {
  try {
    const rootStat = fs.statSync(teleplayDir);
    const entries = fs.readdirSync(teleplayDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh'));

    const meta = entries.map(name => {
      try {
        const showPath = path.join(teleplayDir, name);
        const showStat = fs.statSync(showPath);
        // Scan season subdirectories for deeper change detection
        const subDirs = fs.readdirSync(showPath, { withFileTypes: true })
          .filter(e => e.isDirectory())
          .map(e => e.name)
          .sort((a, b) => a.localeCompare(b, 'zh'));

        const subMeta = subDirs.map(sub => {
          try {
            const subPath = path.join(showPath, sub);
            const files = fs.readdirSync(subPath).sort((a, b) => a.localeCompare(b, 'zh'));
            const keyFiles = files.filter(f => {
              const ext = path.extname(f).toLowerCase();
              return VIDEO_EXTENSIONS.has(ext) || ext === '.nfo'
                || ['.srt', '.ass', '.ssa', '.sub', '.vtt'].includes(ext);
            });
            const fileMeta = keyFiles.map(file => {
              try {
                const stat = fs.statSync(path.join(subPath, file));
                return `${file}:${Math.floor(stat.mtimeMs)}:${stat.size}`;
              } catch {
                return `${file}:0:0`;
              }
            });
            return `${sub}|${fileMeta.join(',')}`;
          } catch {
            return `${sub}:0`;
          }
        });

        return `${name}:${Math.floor(showStat.mtimeMs)}|${subMeta.join(';')}`;
      } catch {
        return `${name}:0`;
      }
    });

    return crypto
      .createHash('sha1')
      .update([Math.floor(rootStat.mtimeMs), ...meta].join('|'))
      .digest('hex');
  } catch {
    return '';
  }
}

// ── Scan a single TV show folder ─────────────────────────────────────────────

async function scanShowFolder(showPath, folderName) {
  const showFiles = fs.readdirSync(showPath);
  const showDirs = showFiles.filter(f => {
    try { return fs.statSync(path.join(showPath, f)).isDirectory(); } catch { return false; }
  });

  // Parse tvshow.nfo
  let showNfo = {};
  const tvshowNfoFile = showFiles.find(f => f.toLowerCase() === 'tvshow.nfo');
  if (tvshowNfoFile) {
    try {
      showNfo = await parseNfo(path.join(showPath, tvshowNfoFile));
    } catch (err) {
      console.error(`  tvshow.nfo parse error in "${folderName}": ${err.message}`);
    }
  }

  // Show-level images
  const showImages = detectShowImages(showFiles, showNfo.art);

  // Year from folder name fallback
  const yearMatch = folderName.match(/\((\d{4})\)\s*$/);
  const year = showNfo.year || (yearMatch ? parseInt(yearMatch[1]) : null);

  // Scan season folders
  const seasonFolders = showDirs
    .filter(d => /^season\s*\d+$/i.test(d))
    .sort((a, b) => {
      const na = parseInt(a.match(/\d+/)?.[0]) || 0;
      const nb = parseInt(b.match(/\d+/)?.[0]) || 0;
      return na - nb;
    });

  // Also look for "Specials" folder
  const specialFolder = showDirs.find(d => /^specials?$/i.test(d));
  if (specialFolder && !seasonFolders.includes(specialFolder)) {
    seasonFolders.unshift(specialFolder);
  }

  const seasons = [];
  for (const seasonDir of seasonFolders) {
    const seasonPath = path.join(showPath, seasonDir);
    const season = await scanSeasonFolder(seasonPath, seasonDir, showFiles, showPath);
    if (season && season.episodes.length > 0) {
      seasons.push(season);
    }
  }

  if (seasons.length === 0) return null;

  const totalEpisodes = seasons.reduce((sum, s) => sum + s.episodes.length, 0);

  return {
    id: generateId(folderName),
    folderName,
    folderPath: showPath,
    title: showNfo.title || folderName.replace(/\s*\(\d{4}\)\s*$/, ''),
    originalTitle: showNfo.originaltitle || '',
    year,
    rating: showNfo.rating,
    votes: showNfo.votes,
    plot: showNfo.plot || '',
    genres: showNfo.genres || [],
    actors: showNfo.actors || [],
    studio: showNfo.studio || '',
    mpaa: showNfo.mpaa || '',
    status: showNfo.status || '',
    premiered: showNfo.premiered || '',
    uniqueIds: showNfo.uniqueIds || {},
    images: showImages,
    seasons,
    totalEpisodes,
  };
}

// ── Scan a single season folder ──────────────────────────────────────────────

async function scanSeasonFolder(seasonPath, seasonDir, showFiles, showPath) {
  const files = fs.readdirSync(seasonPath);

  // Determine season number
  const numMatch = seasonDir.match(/\d+/);
  let seasonNum = numMatch ? parseInt(numMatch[0]) : 0;
  if (/^specials?$/i.test(seasonDir)) seasonNum = 0;

  // Parse season.nfo
  let seasonNfo = {};
  const seasonNfoFile = files.find(f => f.toLowerCase() === 'season.nfo');
  if (seasonNfoFile) {
    try {
      seasonNfo = await parseNfo(path.join(seasonPath, seasonNfoFile));
    } catch { /* ignore */ }
  }

  if (seasonNfo.seasonnumber != null) seasonNum = seasonNfo.seasonnumber;

  // Season images
  const seasonImages = detectSeasonImages(files, seasonNfo.art, seasonNum, showFiles);

  // Scan episodes
  const videoFiles = files.filter(f => VIDEO_EXTENSIONS.has(path.extname(f).toLowerCase()));
  videoFiles.sort((a, b) => a.localeCompare(b, 'zh'));

  const episodes = [];
  for (const videoFile of videoFiles) {
    const ep = await scanEpisode(seasonPath, files, videoFile, seasonNum);
    if (ep) episodes.push(ep);
  }

  episodes.sort((a, b) => a.episode - b.episode);

  return {
    seasonNumber: seasonNum,
    title: seasonNfo.title || seasonDir,
    year: seasonNfo.year || null,
    folderPath: seasonPath,
    images: seasonImages,
    showFolderPath: showPath,
    episodes,
  };
}

// ── Scan a single episode ────────────────────────────────────────────────────

async function scanEpisode(seasonPath, allFiles, videoFile, defaultSeason) {
  const baseName = path.parse(videoFile).name;

  // Parse episode number from filename
  const parsed = parseEpisodeFromFilename(videoFile);
  const seasonNum = parsed ? parsed.season : defaultSeason;
  const episodeNum = parsed ? parsed.episode : 0;

  // Find episode NFO (same base name)
  const nfoFile = allFiles.find(f =>
    path.parse(f).name === baseName && path.extname(f).toLowerCase() === '.nfo'
  );
  let nfo = {};
  if (nfoFile) {
    try {
      nfo = await parseNfo(path.join(seasonPath, nfoFile));
    } catch { /* ignore */ }
  }

  // Find episode thumb
  const thumbFile = allFiles.find(f =>
    f.toLowerCase() === `${baseName.toLowerCase()}-thumb.jpg` ||
    f.toLowerCase() === `${baseName.toLowerCase()}-thumb.png`
  );

  // Detect subtitles matching this episode
  const epSubFiles = allFiles.filter(f => {
    if (!f.startsWith(baseName)) return false;
    const ext = path.extname(f).toLowerCase();
    return ['.srt', '.ass', '.ssa', '.sub', '.vtt'].includes(ext);
  });
  const subtitles = detectSubtitles(epSubFiles).filter(s => {
    try {
      return fs.statSync(path.join(seasonPath, s.file)).size > 0;
    } catch { return false; }
  });

  const videoStat = fs.statSync(path.join(seasonPath, videoFile));

  // Embedded subtitles (from video container)
  let embeddedSubtitles = [];
  const hasFfmpeg = await checkFfmpeg();
  if (hasFfmpeg) {
    try {
      embeddedSubtitles = await probeSubtitles(path.join(seasonPath, videoFile));
    } catch { /* ignore probe errors */ }
  }

  return {
    id: generateId(`${seasonPath}/${videoFile}`),
    title: nfo.title || baseName,
    season: nfo.season || seasonNum,
    episode: nfo.episode || episodeNum,
    plot: nfo.plot || '',
    rating: nfo.rating,
    runtime: nfo.runtime,
    aired: nfo.aired || '',
    videoFile,
    videoSize: videoStat.size,
    thumb: thumbFile || null,
    subtitles,
    embeddedSubtitles,
  };
}

// ── Main scan function ───────────────────────────────────────────────────────

async function scanTeleplays(teleplayDir) {
  const shows = [];

  let entries;
  try {
    entries = fs.readdirSync(teleplayDir, { withFileTypes: true });
  } catch (err) {
    console.error(`Failed to read teleplay directory: ${err.message}`);
    return shows;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const folderName = entry.name;
    const folderPath = path.join(teleplayDir, folderName);

    try {
      const show = await scanShowFolder(folderPath, folderName);
      if (show) {
        show._folderSignature = buildShowFolderSignature(folderPath);
        shows.push(show);
      }
    } catch (err) {
      console.error(`Error scanning show "${folderName}": ${err.message}`);
    }
  }

  shows.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh'));
  return shows;
}

// ── Per-show folder signature for incremental scanning ───────────────────────

function buildShowFolderSignature(showPath) {
  try {
    const showFiles = fs.readdirSync(showPath);
    const regularFiles = showFiles.filter(f => {
      try { return !fs.statSync(path.join(showPath, f)).isDirectory(); } catch { return true; }
    }).sort((a, b) => a.localeCompare(b, 'zh'));

    const showFileMeta = regularFiles.map(f => {
      try {
        const stat = fs.statSync(path.join(showPath, f));
        return `${f}:${Math.floor(stat.mtimeMs)}:${stat.size}`;
      } catch { return `${f}:0:0`; }
    });

    const subDirs = showFiles.filter(f => {
      try { return fs.statSync(path.join(showPath, f)).isDirectory(); } catch { return false; }
    }).sort((a, b) => a.localeCompare(b, 'zh'));

    const subMeta = subDirs.map(sub => {
      try {
        const subPath = path.join(showPath, sub);
        const files = fs.readdirSync(subPath).sort((a, b) => a.localeCompare(b, 'zh'));
        const keyFiles = files.filter(f => {
          const ext = path.extname(f).toLowerCase();
          return VIDEO_EXTENSIONS.has(ext) || ext === '.nfo'
            || ['.srt', '.ass', '.ssa', '.sub', '.vtt'].includes(ext);
        });
        const fileMeta = keyFiles.map(file => {
          try {
            const stat = fs.statSync(path.join(subPath, file));
            return `${file}:${Math.floor(stat.mtimeMs)}:${stat.size}`;
          } catch { return `${file}:0:0`; }
        });
        return `${sub}|${fileMeta.join(',')}`;
      } catch { return `${sub}:0`; }
    });

    return crypto
      .createHash('sha1')
      .update([showFileMeta.join(','), ...subMeta].join('|'))
      .digest('hex');
  } catch {
    return '';
  }
}

// ── Incremental teleplay scan (only rescan changed/new show folders) ─────────

async function incrementalScanTeleplays(teleplayDir, existingDb) {
  const existingMap = new Map();
  for (const show of existingDb) {
    existingMap.set(show.folderName, show);
  }

  let entries;
  try {
    entries = fs.readdirSync(teleplayDir, { withFileTypes: true });
  } catch (err) {
    console.error(`Failed to read teleplay directory: ${err.message}`);
    return { db: existingDb, changed: false };
  }

  const currentFolders = new Set();
  const shows = [];
  let addedCount = 0, changedCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const folderName = entry.name;
    currentFolders.add(folderName);
    const folderPath = path.join(teleplayDir, folderName);
    const newSig = buildShowFolderSignature(folderPath);
    const existing = existingMap.get(folderName);

    if (existing && existing._folderSignature === newSig) {
      shows.push(existing);
    } else {
      try {
        const show = await scanShowFolder(folderPath, folderName);
        if (show) {
          show._folderSignature = newSig;
          shows.push(show);
          if (existing) {
            changedCount++;
            console.log(`  Updated show: ${folderName}`);
          } else {
            addedCount++;
            console.log(`  Added show: ${folderName}`);
          }
        }
      } catch (err) {
        console.error(`Error scanning show "${folderName}": ${err.message}`);
      }
    }
  }

  let removedCount = 0;
  for (const [folderName] of existingMap) {
    if (!currentFolders.has(folderName)) {
      removedCount++;
      console.log(`  Removed show: ${folderName}`);
    }
  }

  const changed = addedCount > 0 || changedCount > 0 || removedCount > 0;
  if (changed) {
    console.log(`Incremental teleplay scan: +${addedCount} added, ~${changedCount} updated, -${removedCount} removed`);
    shows.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh'));
  }
  return { db: shows, changed };
}

module.exports = { scanTeleplays, incrementalScanTeleplays, buildTeleplaySignature };
