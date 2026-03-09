const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseNfo } = require('./nfoParser');
const { detectSubtitles } = require('./subtitleService');
const { probeSubtitles, checkFfmpeg } = require('./embeddedSubtitles');

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts',
]);

const SUBTITLE_EXTENSIONS = new Set(['.srt', '.ass', '.ssa', '.sub', '.vtt']);

const IMAGE_NAMES = {
  'poster.jpg': 'poster', 'poster.png': 'poster',
  'fanart.jpg': 'fanart', 'fanart.png': 'fanart',
  'banner.jpg': 'banner', 'banner.png': 'banner',
  'clearart.png': 'clearart',
  'clearlogo.png': 'logo', 'logo.png': 'logo',
  'thumb.jpg': 'thumb', 'thumb.png': 'thumb',
  'keyart.jpg': 'keyart', 'keyart.png': 'keyart',
  'disc.png': 'disc',
};

const IMAGE_TOKEN_TO_TYPE = {
  poster: 'poster',
  fanart: 'fanart',
  banner: 'banner',
  clearart: 'clearart',
  clearlogo: 'logo',
  logo: 'logo',
  thumb: 'thumb',
  keyart: 'keyart',
  disc: 'disc',
};

const NFO_ART_KEY_TO_TYPE = {
  poster: 'poster',
  fanart: 'fanart',
  banner: 'banner',
  clearart: 'clearart',
  clearlogo: 'logo',
  logo: 'logo',
  thumb: 'thumb',
  keyart: 'keyart',
  disc: 'disc',
};

function detectImageType(fileName) {
  const lower = fileName.toLowerCase();

  // Exact conventional names first.
  if (IMAGE_NAMES[lower]) return IMAGE_NAMES[lower];

  const ext = path.extname(lower);
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return null;

  const base = path.parse(lower).name;
  const m = base.match(/(?:^|[-_.\s])(poster|fanart|banner|clearart|clearlogo|logo|thumb|keyart|disc)$/i);
  if (!m) return null;

  return IMAGE_TOKEN_TO_TYPE[m[1].toLowerCase()] || null;
}

function findFileByReference(files, reference) {
  if (!reference || typeof reference !== 'string') return null;

  const normalizedRef = reference.replace(/\\/g, '/').trim();
  const refBase = path.basename(normalizedRef).toLowerCase();
  if (!refBase) return null;

  const exact = files.find(f => f.toLowerCase() === refBase);
  if (exact) return exact;

  const refName = path.parse(refBase).name;
  if (!refName) return null;
  const byName = files.find(f => path.parse(f).name.toLowerCase() === refName);
  return byName || null;
}

function buildSourceSignature(movieDir) {
  try {
    const rootStat = fs.statSync(movieDir);
    const entries = fs.readdirSync(movieDir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b, 'zh'));

    const folderMeta = entries.map(name => {
      try {
        const folderPath = path.join(movieDir, name);
        const files = fs.readdirSync(folderPath).sort((a, b) => a.localeCompare(b, 'zh'));
        const keyFiles = files.filter(f => {
          const ext = path.extname(f).toLowerCase();
          return VIDEO_EXTENSIONS.has(ext) || ext === '.nfo' || SUBTITLE_EXTENSIONS.has(ext) || !!detectImageType(f);
        });

        const fileMeta = keyFiles.map(file => {
          try {
            const stat = fs.statSync(path.join(folderPath, file));
            return `${file}:${Math.floor(stat.mtimeMs)}:${stat.size}`;
          } catch {
            return `${file}:0:0`;
          }
        });

        return `${name}|${fileMeta.join(',')}`;
      } catch {
        return `${name}:0`;
      }
    });

    return crypto
      .createHash('sha1')
      .update([Math.floor(rootStat.mtimeMs), ...folderMeta].join('|'))
      .digest('hex');
  } catch {
    return '';
  }
}

function generateId(folderName) {
  return crypto.createHash('md5').update(folderName).digest('hex').substring(0, 12);
}

async function scanMovies(movieDir) {
  const movies = [];

  let entries;
  try {
    entries = fs.readdirSync(movieDir, { withFileTypes: true });
  } catch (err) {
    console.error(`Failed to read movie directory: ${err.message}`);
    return movies;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const folderName = entry.name;
    const folderPath = path.join(movieDir, folderName);

    try {
      const movie = await scanMovieFolder(folderPath, folderName);
      if (movie) {
        movie._folderSignature = buildMovieFolderSignature(folderPath);
        movies.push(movie);
      }
    } catch (err) {
      console.error(`Error scanning "${folderName}": ${err.message}`);
    }
  }

  movies.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh'));
  return movies;
}

// ── Per-folder signature for incremental scanning ────────────────────────────

function buildMovieFolderSignature(folderPath) {
  try {
    const files = fs.readdirSync(folderPath).sort((a, b) => a.localeCompare(b, 'zh'));
    const keyFiles = files.filter(f => {
      const ext = path.extname(f).toLowerCase();
      return VIDEO_EXTENSIONS.has(ext) || ext === '.nfo' || SUBTITLE_EXTENSIONS.has(ext) || !!detectImageType(f);
    });
    const fileMeta = keyFiles.map(file => {
      try {
        const stat = fs.statSync(path.join(folderPath, file));
        return `${file}:${Math.floor(stat.mtimeMs)}:${stat.size}`;
      } catch {
        return `${file}:0:0`;
      }
    });
    return crypto.createHash('sha1').update(fileMeta.join(',')).digest('hex');
  } catch {
    return '';
  }
}

// ── Incremental movie scan (only rescan changed/new folders) ─────────────────

async function incrementalScanMovies(movieDir, existingDb) {
  const existingMap = new Map();
  for (const movie of existingDb) {
    existingMap.set(movie.folderName, movie);
  }

  let entries;
  try {
    entries = fs.readdirSync(movieDir, { withFileTypes: true });
  } catch (err) {
    console.error(`Failed to read movie directory: ${err.message}`);
    return { db: existingDb, changed: false };
  }

  const currentFolders = new Set();
  const movies = [];
  let addedCount = 0, changedCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const folderName = entry.name;
    currentFolders.add(folderName);
    const folderPath = path.join(movieDir, folderName);
    const newSig = buildMovieFolderSignature(folderPath);
    const existing = existingMap.get(folderName);

    if (existing && existing._folderSignature === newSig) {
      movies.push(existing);
    } else {
      try {
        const movie = await scanMovieFolder(folderPath, folderName);
        if (movie) {
          movie._folderSignature = newSig;
          movies.push(movie);
          if (existing) {
            changedCount++;
            console.log(`  Updated movie: ${folderName}`);
          } else {
            addedCount++;
            console.log(`  Added movie: ${folderName}`);
          }
        }
      } catch (err) {
        console.error(`Error scanning "${folderName}": ${err.message}`);
      }
    }
  }

  let removedCount = 0;
  for (const [folderName] of existingMap) {
    if (!currentFolders.has(folderName)) {
      removedCount++;
      console.log(`  Removed movie: ${folderName}`);
    }
  }

  const changed = addedCount > 0 || changedCount > 0 || removedCount > 0;
  if (changed) {
    console.log(`Incremental movie scan: +${addedCount} added, ~${changedCount} updated, -${removedCount} removed`);
    movies.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh'));
  }
  return { db: movies, changed };
}

async function scanMovieFolder(folderPath, folderName) {
  const files = fs.readdirSync(folderPath);

  // --- Find video file ---
  const videoFiles = files.filter(f => VIDEO_EXTENSIONS.has(path.extname(f).toLowerCase()));
  if (videoFiles.length === 0) return null;

  let videoFile = videoFiles[0];
  if (videoFiles.length > 1) {
    const prefix = folderName.split(' (')[0];
    const match = videoFiles.find(f => f.startsWith(prefix));
    if (match) {
      videoFile = match;
    } else {
      let maxSize = 0;
      for (const vf of videoFiles) {
        const size = fs.statSync(path.join(folderPath, vf)).size;
        if (size > maxSize) { maxSize = size; videoFile = vf; }
      }
    }
  }

  // --- Find and parse NFO ---
  const nfoFiles = files
    .filter(f => path.extname(f).toLowerCase() === '.nfo')
    .sort((a, b) => a.localeCompare(b, 'zh'));
  let nfoFile = null;
  if (nfoFiles.length > 0) {
    // Priority: movie.nfo -> any other .nfo
    nfoFile = nfoFiles.find(f => f.toLowerCase() === 'movie.nfo') || null;
    if (!nfoFile) nfoFile = nfoFiles[0];
  }
  let nfo = {};
  if (nfoFile) {
    try {
      nfo = await parseNfo(path.join(folderPath, nfoFile));
    } catch (err) {
      console.error(`  NFO parse error in "${folderName}": ${err.message}`);
    }
  }

  // --- Images ---
  const images = {};

  // Prefer explicit art references from NFO first.
  if (nfo.art && typeof nfo.art === 'object') {
    for (const [artKey, artPath] of Object.entries(nfo.art)) {
      const imageType = NFO_ART_KEY_TO_TYPE[artKey.toLowerCase()];
      if (!imageType || images[imageType]) continue;
      const matched = findFileByReference(files, artPath);
      if (matched) images[imageType] = matched;
    }
  }

  // Fallback to file-name conventions when NFO art is unavailable.
  for (const file of files) {
    const key = detectImageType(file);
    if (!key) continue;

    // Keep NFO-selected images when available.
    if (images[key]) continue;

    // Prefer exact conventional names over suffixed variants.
    if (!images[key]) {
      images[key] = file;
    } else {
      const existingIsExact = !!IMAGE_NAMES[images[key].toLowerCase()];
      const currentIsExact = !!IMAGE_NAMES[file.toLowerCase()];
      if (!existingIsExact && currentIsExact) images[key] = file;
    }
  }

  // --- Subtitles (skip empty files) ---
  const rawSubs = detectSubtitles(files);
  const subtitles = rawSubs.filter(s => {
    try {
      return fs.statSync(path.join(folderPath, s.file)).size > 0;
    } catch { return false; }
  });

  // --- Year from folder name fallback ---
  const yearMatch = folderName.match(/\((\d{4})\)\s*$/);
  const year = nfo.year || (yearMatch ? parseInt(yearMatch[1]) : null);

  const videoStat = fs.statSync(path.join(folderPath, videoFile));

  // --- Embedded subtitles (from video container) ---
  let embeddedSubtitles = [];
  const hasFfmpeg = await checkFfmpeg();
  if (hasFfmpeg) {
    try {
      embeddedSubtitles = await probeSubtitles(path.join(folderPath, videoFile));
    } catch { /* ignore probe errors */ }
  }

  return {
    id: generateId(folderName),
    folderName,
    folderPath,
    title: nfo.title || folderName.replace(/\s*\(\d{4}\)\s*$/, ''),
    originalTitle: nfo.originaltitle || '',
    year,
    rating: nfo.rating,
    votes: nfo.votes,
    plot: nfo.plot || '',
    outline: nfo.outline || '',
    tagline: nfo.tagline || '',
    runtime: nfo.runtime,
    genres: nfo.genres || [],
    directors: nfo.directors || [],
    actors: nfo.actors || [],
    studio: nfo.studio || '',
    country: nfo.country || '',
    mpaa: nfo.mpaa || '',
    uniqueIds: nfo.uniqueIds || {},
    videoFile,
    videoSize: videoStat.size,
    images,
    subtitles,
    embeddedSubtitles,
  };
}

module.exports = { scanMovies, incrementalScanMovies, buildSourceSignature };
