const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { convertSubtitleToVtt } = require('../services/subtitleService');
const { getThumbnail } = require('../services/imageCache');
const { extractSubtitle, extractRawSubtitle } = require('../services/embeddedSubtitles');

// ── Helpers ──────────────────────────────────────────────────────────────────

function findShow(req) {
  return (req.app.locals.teleplayDb || []).find(s => s.id === req.params.id);
}

function findEpisode(show, seasonNum, episodeId) {
  const season = show.seasons.find(s => s.seasonNumber === seasonNum);
  if (!season) return null;
  return { season, episode: season.episodes.find(e => e.id === episodeId) };
}

function safePath(base, file) {
  const full = path.resolve(path.join(base, file));
  if (!full.startsWith(path.resolve(base))) return null;
  return full;
}

// ── GET /api/teleplays ───────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const shows = req.app.locals.teleplayDb || [];
  const list = shows.map(s => ({
    id: s.id,
    title: s.title,
    originalTitle: s.originalTitle,
    year: s.year,
    rating: s.rating,
    genres: s.genres,
    seasonCount: s.seasons.length,
    totalEpisodes: s.totalEpisodes,
    status: s.status,
    hasPoster: !!s.images.poster,
  }));
  res.json(list);
});

// ── GET /api/teleplays/:id ───────────────────────────────────────────────────

router.get('/:id', (req, res) => {
  const show = findShow(req);
  if (!show) return res.status(404).json({ error: 'Show not found' });

  res.json({
    id: show.id,
    title: show.title,
    originalTitle: show.originalTitle,
    year: show.year,
    rating: show.rating,
    votes: show.votes,
    plot: show.plot,
    genres: show.genres,
    actors: show.actors,
    studio: show.studio,
    mpaa: show.mpaa,
    status: show.status,
    premiered: show.premiered,
    uniqueIds: show.uniqueIds,
    images: Object.keys(show.images).filter(k => !k.endsWith('_fromShow')),
    seasons: show.seasons.map(s => ({
      seasonNumber: s.seasonNumber,
      title: s.title,
      year: s.year,
      episodeCount: s.episodes.length,
      hasPoster: !!(s.images.poster),
      episodes: s.episodes.map(e => ({
        id: e.id,
        title: e.title,
        season: e.season,
        episode: e.episode,
        plot: e.plot,
        rating: e.rating,
        runtime: e.runtime,
        aired: e.aired,
        videoSize: e.videoSize,
        hasThumb: !!e.thumb,
        subtitleCount: e.subtitles.length,
        embeddedSubtitleCount: (e.embeddedSubtitles || []).length,
        subtitles: e.subtitles.map(sub => ({
          file: sub.file,
          langCode: sub.langCode,
          langName: sub.langName,
          format: sub.format,
          label: sub.label,
        })),
        embeddedSubtitles: (e.embeddedSubtitles || []).map(sub => ({
          index: sub.index,
          codec: sub.codec,
          language: sub.language,
          langName: sub.langName,
          title: sub.title,
          label: sub.label,
          isDefault: sub.isDefault,
          isText: sub.isText,
        })),
      })),
    })),
  });
});

// ── GET /api/teleplays/:id/image/:type ───────────────────────────────────────

router.get('/:id/image/:type', async (req, res) => {
  const show = findShow(req);
  if (!show) return res.status(404).json({ error: 'Show not found' });

  const imageFile = show.images[req.params.type];
  if (!imageFile) return res.status(404).json({ error: 'Image not found' });

  const imgPath = safePath(show.folderPath, imageFile);
  if (!imgPath || !fs.existsSync(imgPath)) return res.status(404).json({ error: 'File not found' });

  if (req.query.original === '1') {
    res.set('Cache-Control', 'public, max-age=86400');
    res.type(mime.lookup(imageFile) || 'image/jpeg');
    return fs.createReadStream(imgPath).pipe(res);
  }

  const thumbPath = await getThumbnail(imgPath, req.params.type);
  if (thumbPath) {
    res.set('Cache-Control', 'public, max-age=2592000, immutable');
    res.type('image/jpeg');
    return fs.createReadStream(thumbPath).pipe(res);
  }

  res.set('Cache-Control', 'public, max-age=86400');
  res.type(mime.lookup(imageFile) || 'image/jpeg');
  fs.createReadStream(imgPath).pipe(res);
});

// ── GET /api/teleplays/:id/season/:snum/poster ──────────────────────────────

router.get('/:id/season/:snum/poster', async (req, res) => {
  const show = findShow(req);
  if (!show) return res.status(404).json({ error: 'Show not found' });

  const snum = parseInt(req.params.snum);
  const season = show.seasons.find(s => s.seasonNumber === snum);
  if (!season) return res.status(404).json({ error: 'Season not found' });

  const imageFile = season.images.poster;
  if (!imageFile) return res.status(404).json({ error: 'Image not found' });

  // Determine base path — season poster might be from show folder
  const basePath = season.images.poster_fromShow ? show.folderPath : season.folderPath;
  const imgPath = safePath(basePath, imageFile);
  if (!imgPath || !fs.existsSync(imgPath)) return res.status(404).json({ error: 'File not found' });

  if (req.query.original === '1') {
    res.set('Cache-Control', 'public, max-age=86400');
    res.type(mime.lookup(imageFile) || 'image/jpeg');
    return fs.createReadStream(imgPath).pipe(res);
  }

  const thumbPath = await getThumbnail(imgPath, 'poster');
  if (thumbPath) {
    res.set('Cache-Control', 'public, max-age=2592000, immutable');
    res.type('image/jpeg');
    return fs.createReadStream(thumbPath).pipe(res);
  }

  res.set('Cache-Control', 'public, max-age=86400');
  res.type(mime.lookup(imageFile) || 'image/jpeg');
  fs.createReadStream(imgPath).pipe(res);
});

// ── GET /api/teleplays/:id/season/:snum/episode/:eid/thumb ──────────────────

router.get('/:id/season/:snum/episode/:eid/thumb', async (req, res) => {
  const show = findShow(req);
  if (!show) return res.status(404).json({ error: 'Show not found' });

  const snum = parseInt(req.params.snum);
  const result = findEpisode(show, snum, req.params.eid);
  if (!result || !result.episode) return res.status(404).json({ error: 'Episode not found' });

  const { season, episode } = result;
  if (!episode.thumb) return res.status(404).json({ error: 'Thumb not found' });

  const imgPath = safePath(season.folderPath, episode.thumb);
  if (!imgPath || !fs.existsSync(imgPath)) return res.status(404).json({ error: 'File not found' });

  const thumbPath = await getThumbnail(imgPath, 'thumb');
  if (thumbPath) {
    res.set('Cache-Control', 'public, max-age=2592000, immutable');
    res.type('image/jpeg');
    return fs.createReadStream(thumbPath).pipe(res);
  }

  res.set('Cache-Control', 'public, max-age=86400');
  res.type(mime.lookup(episode.thumb) || 'image/jpeg');
  fs.createReadStream(imgPath).pipe(res);
});

// ── GET /api/teleplays/:id/season/:snum/episode/:eid/stream ─────────────────

router.get('/:id/season/:snum/episode/:eid/stream', (req, res) => {
  const show = findShow(req);
  if (!show) return res.status(404).json({ error: 'Show not found' });

  const snum = parseInt(req.params.snum);
  const result = findEpisode(show, snum, req.params.eid);
  if (!result || !result.episode) return res.status(404).json({ error: 'Episode not found' });

  const { season, episode } = result;
  const videoPath = safePath(season.folderPath, episode.videoFile);
  if (!videoPath || !fs.existsSync(videoPath)) {
    return res.status(404).json({ error: 'Video file not found' });
  }

  const stat = fs.statSync(videoPath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const mimeType = mime.lookup(episode.videoFile) || 'video/mp4';

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

// ── GET /api/teleplays/:id/season/:snum/episode/:eid/subtitle/:file ─────────

router.get('/:id/season/:snum/episode/:eid/subtitle/:file', (req, res) => {
  const show = findShow(req);
  if (!show) return res.status(404).json({ error: 'Show not found' });

  const snum = parseInt(req.params.snum);
  const result = findEpisode(show, snum, req.params.eid);
  if (!result || !result.episode) return res.status(404).json({ error: 'Episode not found' });

  const { season, episode } = result;
  const subtitle = episode.subtitles.find(s => s.file === req.params.file);
  if (!subtitle) return res.status(404).json({ error: 'Subtitle not found' });

  const subPath = safePath(season.folderPath, subtitle.file);
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

// ── GET /api/teleplays/:id/season/:snum/episode/:eid/embedded-subtitle/:index ─

router.get('/:id/season/:snum/episode/:eid/embedded-subtitle/:index', async (req, res) => {
  const show = findShow(req);
  if (!show) return res.status(404).json({ error: 'Show not found' });

  const snum = parseInt(req.params.snum);
  const result = findEpisode(show, snum, req.params.eid);
  if (!result || !result.episode) return res.status(404).json({ error: 'Episode not found' });

  const { season, episode } = result;
  const idx = parseInt(req.params.index, 10);
  const sub = (episode.embeddedSubtitles || []).find(s => s.index === idx);
  if (!sub) return res.status(404).json({ error: 'Embedded subtitle not found' });
  if (!sub.isText) return res.status(400).json({ error: '图形字幕无法提取为文本' });

  const videoPath = safePath(season.folderPath, episode.videoFile);
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
