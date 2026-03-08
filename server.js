const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const movieRoutes = require('./routes/movies');
const teleplayRoutes = require('./routes/teleplays');
const authRoutes = require('./routes/auth');
const { scanMovies, buildSourceSignature } = require('./services/scanner');
const { scanTeleplays, buildTeleplaySignature } = require('./services/teleplayScanner');
const { loadCache, saveCache } = require('./services/cacheService');
const { hasAnyUser } = require('./services/userService');

const app = express();
const DETECT_INTERVAL_MS = 60 * 1000;
let isScanning = false;

app.use(cors());
app.use(express.json());

// ── Auth middleware import ────────────────────────────────────────────────────

const { validateToken } = require('./services/userService');

function authRequired(req, res, next) {
  // Allow unauthenticated access during initial setup (no users yet)
  if (!hasAnyUser()) return next();
  const token = req.headers['x-token'];
  if (!token) return res.status(401).json({ error: '未登录' });
  const session = validateToken(token);
  if (!session) return res.status(401).json({ error: '登录已过期' });
  req.user = session;
  next();
}

function adminRequired(req, res, next) {
  if (!hasAnyUser()) return next();
  authRequired(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ error: '需要管理员权限' });
    next();
  });
}

// ── Settings API (available before movie scan) ───────────────────────────────

app.get('/api/settings', (req, res) => {
  res.json({
    port: config.port,
    movieDir: config.movieDir,
    teleplayDir: config.teleplayDir,
    needsSetup: config.needsSetup,
    needsAdmin: !hasAnyUser(),
  });
});

app.post('/api/settings', adminRequired, async (req, res) => {
  const { movieDir, teleplayDir, port } = req.body;
  if (!movieDir && !teleplayDir) {
    return res.status(400).json({ error: '请提供至少一个媒体文件夹路径' });
  }

  if (movieDir && !fs.existsSync(movieDir)) {
    return res.status(400).json({ error: '电影文件夹路径不存在' });
  }
  if (teleplayDir && !fs.existsSync(teleplayDir)) {
    return res.status(400).json({ error: '电视剧文件夹路径不存在' });
  }

  const newCfg = config.save({
    movieDir: (movieDir || '').trim(),
    teleplayDir: (teleplayDir || '').trim(),
    port: parseInt(port) || config.port,
  });

  config.movieDir = newCfg.movieDir;
  config.teleplayDir = newCfg.teleplayDir;
  config.port = newCfg.port;

  try {
    let movieCount = 0, showCount = 0;

    if (config.movieDir) {
      const movieDb = await scanMovies(config.movieDir);
      const signature = buildSourceSignature(config.movieDir);
      app.locals.movieDb = movieDb;
      app.locals.sourceSignature = signature;
      saveCache(signature, config.movieDir, movieDb);
      movieCount = movieDb.length;
    }

    if (config.teleplayDir) {
      const teleplayDb = await scanTeleplays(config.teleplayDir);
      const tpSig = buildTeleplaySignature(config.teleplayDir);
      app.locals.teleplayDb = teleplayDb;
      app.locals.teleplaySignature = tpSig;
      saveCache(tpSig, config.teleplayDir, teleplayDb, 'teleplay-cache.json');
      showCount = teleplayDb.length;
    }

    console.log(`Settings saved. Movies: ${movieCount}, Shows: ${showCount}`);
    res.json({ movieCount, showCount, movieDir: config.movieDir, teleplayDir: config.teleplayDir, port: config.port });
  } catch (err) {
    res.status(500).json({ error: '扫描失败: ' + err.message });
  }
});

// ── Movie API routes ─────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/movies', authRequired, movieRoutes);
app.use('/api/teleplays', authRequired, teleplayRoutes);

app.post('/api/rescan', adminRequired, async (req, res) => {
  try {
    let movieCount = 0, showCount = 0;

    if (config.movieDir) {
      console.log('Rescanning movie directory...');
      const newDb = await scanMovies(config.movieDir);
      const signature = buildSourceSignature(config.movieDir);
      app.locals.movieDb = newDb;
      app.locals.sourceSignature = signature;
      saveCache(signature, config.movieDir, newDb);
      movieCount = newDb.length;
    }

    if (config.teleplayDir) {
      console.log('Rescanning teleplay directory...');
      const newTpDb = await scanTeleplays(config.teleplayDir);
      const tpSig = buildTeleplaySignature(config.teleplayDir);
      app.locals.teleplayDb = newTpDb;
      app.locals.teleplaySignature = tpSig;
      saveCache(tpSig, config.teleplayDir, newTpDb, 'teleplay-cache.json');
      showCount = newTpDb.length;
    }

    console.log(`Rescan complete: ${movieCount} movies, ${showCount} shows`);
    res.json({ movieCount, showCount });
  } catch (err) {
    console.error('Rescan failed:', err.message);
    res.status(500).json({ error: '重新扫描失败: ' + err.message });
  }
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
  app.locals.sourceSignature = '';
  app.locals.teleplayDb = [];
  app.locals.teleplaySignature = '';

  if (config.movieDir) {
    const signature = buildSourceSignature(config.movieDir);
    const cached = loadCache();

    if (
      cached &&
      cached.movieDir === config.movieDir &&
      cached.signature === signature
    ) {
      app.locals.movieDb = cached.movies;
      app.locals.sourceSignature = signature;
      console.log(`Loaded ${cached.movies.length} movies from cache`);
    } else {
      console.log(`Scanning movie directory: ${config.movieDir}`);
      app.locals.movieDb = await scanMovies(config.movieDir);
      app.locals.sourceSignature = signature;
      saveCache(signature, config.movieDir, app.locals.movieDb);
      console.log(`Found ${app.locals.movieDb.length} movies`);
    }
  }

  if (config.teleplayDir) {
    const tpSig = buildTeleplaySignature(config.teleplayDir);
    const tpCached = loadCache('teleplay-cache.json');

    if (
      tpCached &&
      tpCached.movieDir === config.teleplayDir &&
      tpCached.signature === tpSig
    ) {
      app.locals.teleplayDb = tpCached.movies;
      app.locals.teleplaySignature = tpSig;
      console.log(`Loaded ${tpCached.movies.length} shows from cache`);
    } else {
      console.log(`Scanning teleplay directory: ${config.teleplayDir}`);
      app.locals.teleplayDb = await scanTeleplays(config.teleplayDir);
      app.locals.teleplaySignature = tpSig;
      saveCache(tpSig, config.teleplayDir, app.locals.teleplayDb, 'teleplay-cache.json');
      console.log(`Found ${app.locals.teleplayDb.length} shows`);
    }
  }

  if (!config.movieDir && !config.teleplayDir) {
    console.log('No media directory configured. Waiting for setup via frontend...');
  }

  app.listen(config.port, () => {
    console.log(`VideoWeb running on http://localhost:${config.port}`);
  });

  // Detect source update automatically and refresh only when changed.
  setInterval(async () => {
    if ((!config.movieDir && !config.teleplayDir) || isScanning) return;

    isScanning = true;
    try {
      if (config.movieDir) {
        const nextSig = buildSourceSignature(config.movieDir);
        if (nextSig && nextSig !== app.locals.sourceSignature) {
          console.log('Movie source changed. Auto rescanning...');
          const nextDb = await scanMovies(config.movieDir);
          app.locals.movieDb = nextDb;
          app.locals.sourceSignature = nextSig;
          saveCache(nextSig, config.movieDir, nextDb);
          console.log(`Auto rescan movies: ${nextDb.length}`);
        }
      }

      if (config.teleplayDir) {
        const nextTpSig = buildTeleplaySignature(config.teleplayDir);
        if (nextTpSig && nextTpSig !== app.locals.teleplaySignature) {
          console.log('Teleplay source changed. Auto rescanning...');
          const nextTpDb = await scanTeleplays(config.teleplayDir);
          app.locals.teleplayDb = nextTpDb;
          app.locals.teleplaySignature = nextTpSig;
          saveCache(nextTpSig, config.teleplayDir, nextTpDb, 'teleplay-cache.json');
          console.log(`Auto rescan shows: ${nextTpDb.length}`);
        }
      }
    } catch (err) {
      console.error('Auto rescan failed:', err.message);
    } finally {
      isScanning = false;
    }
  }, DETECT_INTERVAL_MS);
}

init().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
