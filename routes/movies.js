const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { convertSubtitleToVtt } = require('../services/subtitleService');
const { getThumbnail } = require('../services/imageCache');
const { extractSubtitle, extractRawSubtitle } = require('../services/embeddedSubtitles');

// ── Helper ───────────────────────────────────────────────────────────────────

function findMovie(req) {
  return req.app.locals.movieDb.find(m => m.id === req.params.id);
}

function safePath(base, file) {
  const full = path.resolve(path.join(base, file));
  if (!full.startsWith(path.resolve(base))) return null;
  return full;
}

// ── GET /api/movies ──────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const movies = req.app.locals.movieDb;
  const list = movies.map(m => ({
    id: m.id,
    title: m.title,
    originalTitle: m.originalTitle,
    year: m.year,
    rating: m.rating,
    runtime: m.runtime,
    genres: m.genres,
    hasPoster: !!m.images.poster,
    subtitleCount: m.subtitles.length,
  }));
  res.json(list);
});

// ── GET /api/movies/:id ──────────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const movie = findMovie(req);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  res.json({
    id: movie.id,
    title: movie.title,
    originalTitle: movie.originalTitle,
    year: movie.year,
    rating: movie.rating,
    votes: movie.votes,
    plot: movie.plot,
    outline: movie.outline,
    tagline: movie.tagline,
    runtime: movie.runtime,
    genres: movie.genres,
    directors: movie.directors,
    actors: movie.actors,
    studio: movie.studio,
    country: movie.country,
    mpaa: movie.mpaa,
    uniqueIds: movie.uniqueIds,
    videoSize: movie.videoSize,
    images: Object.keys(movie.images),
    subtitles: movie.subtitles.map(s => ({
      file: s.file,
      langCode: s.langCode,
      langName: s.langName,
      format: s.format,
      label: s.label,
    })),
    embeddedSubtitles: (movie.embeddedSubtitles || []).map(s => ({
      index: s.index,
      codec: s.codec,
      language: s.language,
      langName: s.langName,
      title: s.title,
      label: s.label,
      isDefault: s.isDefault,
      isText: s.isText,
    })),
  });
});

// ── GET /api/movies/:id/image/:type ──────────────────────────────────────────

router.get('/:id/image/:type', async (req, res) => {
  const movie = findMovie(req);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  const imageFile = movie.images[req.params.type];
  if (!imageFile) return res.status(404).json({ error: 'Image not found' });

  const imgPath = safePath(movie.folderPath, imageFile);
  if (!imgPath || !fs.existsSync(imgPath)) return res.status(404).json({ error: 'File not found' });

  // Serve original when ?original=1
  if (req.query.original === '1') {
    res.set('Cache-Control', 'public, max-age=86400');
    res.type(mime.lookup(imageFile) || 'image/jpeg');
    return fs.createReadStream(imgPath).pipe(res);
  }

  // Serve cached thumbnail
  const thumbPath = await getThumbnail(imgPath, req.params.type);
  if (thumbPath) {
    res.set('Cache-Control', 'public, max-age=2592000, immutable');
    res.type('image/jpeg');
    return fs.createReadStream(thumbPath).pipe(res);
  }

  // Fallback to original if thumbnail generation failed
  res.set('Cache-Control', 'public, max-age=86400');
  res.type(mime.lookup(imageFile) || 'image/jpeg');
  fs.createReadStream(imgPath).pipe(res);
});

// ── GET /api/movies/:id/stream ───────────────────────────────────────────────

router.get('/:id/stream', (req, res) => {
  const movie = findMovie(req);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  const videoPath = safePath(movie.folderPath, movie.videoFile);
  if (!videoPath || !fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video file not found' });
  }

  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const mimeType = mime.lookup(movie.videoFile) || 'video/mp4';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize) {
      return res.status(416).set('Content-Range', `bytes */${fileSize}`).end();
    }

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': mimeType,
    });
    const stream = fs.createReadStream(videoPath, { start, end });
    stream.on('error', () => res.end());
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
    });
    const stream = fs.createReadStream(videoPath);
    stream.on('error', () => res.end());
    stream.pipe(res);
  }
});

// ── GET /api/movies/:id/subtitle/:file ───────────────────────────────────────

router.get('/:id/subtitle/:file', (req, res) => {
  const movie = findMovie(req);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  const subtitle = movie.subtitles.find(s => s.file === req.params.file);
  if (!subtitle) return res.status(404).json({ error: 'Subtitle not found' });

  const subPath = safePath(movie.folderPath, subtitle.file);
  if (!subPath || !fs.existsSync(subPath)) {
    return res.status(404).json({ error: 'Subtitle file not found' });
  }

  // Serve raw file for ASS/SSA when ?raw=1
  if (req.query.raw === '1') {
    const ext = path.extname(subPath).toLowerCase();
    const mimeType = ext === '.ass' || ext === '.ssa' ? 'text/plain; charset=utf-8' : 'text/plain; charset=utf-8';
    res.type(mimeType).send(fs.readFileSync(subPath, 'utf-8'));
    return;
  }

  try {
    const vtt = convertSubtitleToVtt(subPath);
    res.type('text/vtt; charset=utf-8').send(vtt);
  } catch (err) {
    console.error(`Subtitle conversion error: ${err.message}`);
    res.status(500).json({ error: 'Subtitle conversion failed' });
  }
});

// ── GET /api/movies/:id/embedded-subtitle/:index ─────────────────────────────

router.get('/:id/embedded-subtitle/:index', async (req, res) => {
  const movie = findMovie(req);
  if (!movie) return res.status(404).json({ error: 'Movie not found' });

  const idx = parseInt(req.params.index, 10);
  const sub = (movie.embeddedSubtitles || []).find(s => s.index === idx);
  if (!sub) return res.status(404).json({ error: 'Embedded subtitle not found' });
  if (!sub.isText) return res.status(400).json({ error: '图形字幕无法提取为文本' });

  const videoPath = safePath(movie.folderPath, movie.videoFile);
  if (!videoPath || !fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video file not found' });
  }

  let extraction;
  const killOnClose = () => { if (extraction && extraction.kill) extraction.kill(); };
  req.on('close', killOnClose);

  try {
    // Extract as native format (ASS) when ?raw=1
    if (req.query.raw === '1' && (sub.codec === 'ass' || sub.codec === 'ssa')) {
      extraction = extractRawSubtitle(videoPath, idx);
      const raw = await extraction;
      if (!res.writableEnded) res.type('text/plain; charset=utf-8').send(raw);
      return;
    }
    extraction = extractSubtitle(videoPath, idx);
    const vtt = await extraction;
    if (!res.writableEnded) res.type('text/vtt; charset=utf-8').send(vtt);
  } catch (err) {
    if (err.message === '字幕提取已取消') return;
    console.error(`Embedded subtitle extraction error: ${err.message}`);
    if (!res.writableEnded) res.status(500).json({ error: '内嵌字幕提取失败' });
  } finally {
    req.removeListener('close', killOnClose);
  }
});

module.exports = router;
