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

async function init() {
  console.log(`Scanning movie directory: ${config.movieDir}`);
  const movieDb = await scanMovies(config.movieDir);
  console.log(`Found ${movieDb.length} movies`);

  app.locals.movieDb = movieDb;

  // API routes
  app.use('/api/movies', movieRoutes);

  app.post('/api/rescan', async (req, res) => {
    console.log('Rescanning movie directory...');
    const newDb = await scanMovies(config.movieDir);
    app.locals.movieDb = newDb;
    console.log(`Rescan complete: ${newDb.length} movies`);
    res.json({ count: newDb.length });
  });

  // Serve frontend static files if available
  const frontendPath = path.join(__dirname, '..', 'frontend');
  if (fs.existsSync(frontendPath)) {
    app.use(express.static(frontendPath));
    app.get('*', (req, res) => {
      if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(frontendPath, 'index.html'));
      }
    });
  }

  app.listen(config.port, () => {
    console.log(`VideoWeb API server running on http://localhost:${config.port}`);
  });
}

init().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
