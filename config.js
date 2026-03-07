const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'settings.json');

const defaults = {
  port: 48233,
  movieDir: '',
};

function load() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return { ...defaults, ...JSON.parse(raw) };
    }
  } catch { /* ignore corrupt file */ }
  return { ...defaults };
}

function save(cfg) {
  const data = { port: cfg.port || defaults.port, movieDir: cfg.movieDir || '' };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2), 'utf-8');
  return data;
}

// Environment variables override saved settings
const saved = load();
const config = {
  port: parseInt(process.env.PORT) || saved.port,
  movieDir: process.env.MOVIE_DIR || saved.movieDir,
  load,
  save,
  get needsSetup() { return !this.movieDir; },
};

module.exports = config;
