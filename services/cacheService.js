const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, '..', 'movie-cache.json');

function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.movies)) return null;
    return data;
  } catch {
    return null;
  }
}

function saveCache(signature, movieDir, movies) {
  const payload = {
    signature,
    movieDir,
    updatedAt: new Date().toISOString(),
    movies,
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), 'utf-8');
}

module.exports = { loadCache, saveCache };
