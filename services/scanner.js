const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseNfo } = require('./nfoParser');
const { detectSubtitles } = require('./subtitleService');

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
          return VIDEO_EXTENSIONS.has(ext) || ext === '.nfo' || SUBTITLE_EXTENSIONS.has(ext) || !!IMAGE_NAMES[f.toLowerCase()];
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
      if (movie) movies.push(movie);
    } catch (err) {
      console.error(`Error scanning "${folderName}": ${err.message}`);
    }
  }

  movies.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'zh'));
  return movies;
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
  const nfoFile = files.find(f => path.extname(f).toLowerCase() === '.nfo');
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
  for (const file of files) {
    const key = IMAGE_NAMES[file.toLowerCase()];
    if (key) images[key] = file;
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
  };
}

module.exports = { scanMovies, buildSourceSignature };
