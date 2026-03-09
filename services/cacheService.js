const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'movie-cache.json');

function loadCache(filename) {
  const file = filename ? path.join(__dirname, '..', filename) : CACHE_FILE;
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.movies)) return null;
    return data;
  } catch {
    return null;
  }
}

let _saveCacheQueues = {};

function saveCache(signature, movieDir, movies, filename) {
  const file = filename ? path.join(__dirname, '..', filename) : CACHE_FILE;
  const payload = {
    signature,
    movieDir,
    updatedAt: new Date().toISOString(),
    movies,
  };
  const data = JSON.stringify(payload);
  const key = file;
  if (!_saveCacheQueues[key]) _saveCacheQueues[key] = Promise.resolve();
  _saveCacheQueues[key] = _saveCacheQueues[key].then(() =>
    fs.promises.writeFile(file, data, 'utf-8')
  ).catch(err => console.error('Failed to save cache:', err.message));
}

module.exports = { loadCache, saveCache };
