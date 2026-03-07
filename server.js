const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const movieRoutes = require('./routes/movies');
const { scanMovies } = require('./services/scanner');

const app = express();

app.use(cors());
app.use(express.json());

// ── Settings API (available before movie scan) ───────────────────────────────

app.get('/api/settings', (req, res) => {
  res.json({
    port: config.port,
    movieDir: config.movieDir,
    needsSetup: config.needsSetup,
  });
});

app.post('/api/settings', async (req, res) => {
  const { movieDir, port } = req.body;
  if (!movieDir || typeof movieDir !== 'string') {
    return res.status(400).json({ error: '请提供电影文件夹路径' });
  }

  // Validate path exists
  if (!fs.existsSync(movieDir)) {
    return res.status(400).json({ error: '文件夹路径不存在' });
  }

  const newCfg = config.save({
    movieDir: movieDir.trim(),
    port: parseInt(port) || config.port,
  });

  config.movieDir = newCfg.movieDir;
  config.port = newCfg.port;

  // Scan with new directory
  try {
    const movieDb = await scanMovies(config.movieDir);
    app.locals.movieDb = movieDb;
    console.log(`Settings saved. Scanned ${movieDb.length} movies from: ${config.movieDir}`);
    res.json({ count: movieDb.length, movieDir: config.movieDir, port: config.port });
  } catch (err) {
    res.status(500).json({ error: '扫描失败: ' + err.message });
  }
});

// ── Movie API routes ─────────────────────────────────────────────────────────

app.use('/api/movies', movieRoutes);

app.post('/api/rescan', async (req, res) => {
  if (!config.movieDir) return res.status(400).json({ error: '未配置电影目录' });
  console.log('Rescanning movie directory...');
  const newDb = await scanMovies(config.movieDir);
  app.locals.movieDb = newDb;
  console.log(`Rescan complete: ${newDb.length} movies`);
  res.json({ count: newDb.length });
});

// ── Serve frontend ───────────────────────────────────────────────────────────

const frontendPath = path.join(__dirname, 'frontend');
if (fs.existsSync(frontendPath)) {
  app.use(express.static(frontendPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(frontendPath, 'index.html'));
    }
  });
}

// ── Start ────────────────────────────────────────────────────────────────────

async function init() {
  app.locals.movieDb = [];

  if (config.movieDir) {
    console.log(`Scanning movie directory: ${config.movieDir}`);
    app.locals.movieDb = await scanMovies(config.movieDir);
    console.log(`Found ${app.locals.movieDb.length} movies`);
  } else {
    console.log('No movie directory configured. Waiting for setup via frontend...');
  }

  app.listen(config.port, () => {
    console.log(`VideoWeb running on http://localhost:${config.port}`);
  });
}

init().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
