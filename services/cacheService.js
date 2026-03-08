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

function saveCache(signature, movieDir, movies, filename) {
  const file = filename ? path.join(__dirname, '..', filename) : CACHE_FILE;
  const payload = {
    signature,
    movieDir,
    updatedAt: new Date().toISOString(),
    movies,
  };
  fs.writeFileSync(file, JSON.stringify(payload), 'utf-8');
}

module.exports = { loadCache, saveCache };
