const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const CACHE_DIR = path.join(__dirname, '..', 'cache');

// Thumbnail widths per image type
const THUMB_WIDTH = {
  poster: 300,
  fanart: 960,
  banner: 800,
  thumb: 400,
  keyart: 400,
  clearart: 400,
  logo: 300,
  disc: 200,
};

const DEFAULT_WIDTH = 400;
const JPEG_QUALITY = 80;

// In-flight thumbnail generation map to avoid duplicate work
const _thumbInFlight = new Map();

// Ensure cache directory exists
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

// Build a cache key from absolute source path + file stat
function cacheKey(sourcePath) {
  try {
    const stat = fs.statSync(sourcePath);
    const raw = `${sourcePath}:${stat.mtimeMs}:${stat.size}`;
    return crypto.createHash('md5').update(raw).digest('hex');
  } catch {
    return null;
  }
}

// Return cached thumbnail path, generating it if needed
async function getThumbnail(sourcePath, imageType) {
  ensureCacheDir();

  const hash = cacheKey(sourcePath);
  if (!hash) return null;

  const cachedFile = path.join(CACHE_DIR, `${hash}.jpg`);

  // Already cached – return immediately
  if (fs.existsSync(cachedFile)) return cachedFile;

  // If already generating this thumbnail, wait for the in-flight promise
  if (_thumbInFlight.has(hash)) {
    return _thumbInFlight.get(hash);
  }

  // Generate thumbnail
  const width = THUMB_WIDTH[imageType] || DEFAULT_WIDTH;
  const promise = sharp(sourcePath)
    .resize({ width, withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(cachedFile)
    .then(() => cachedFile)
    .catch(err => {
      console.error(`Thumbnail generation failed for ${sourcePath}: ${err.message}`);
      return null;
    })
    .finally(() => {
      _thumbInFlight.delete(hash);
    });

  _thumbInFlight.set(hash, promise);
  return promise;
}

// Remove all cached files (useful on full rescan or manual clear)
function clearCache() {
  ensureCacheDir();
  const files = fs.readdirSync(CACHE_DIR);
  let count = 0;
  for (const f of files) {
    try {
      fs.unlinkSync(path.join(CACHE_DIR, f));
      count++;
    } catch { /* ignore */ }
  }
  return count;
}

module.exports = { getThumbnail, clearCache, CACHE_DIR };
