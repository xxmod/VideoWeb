const express = require('express');
const router = express.Router();
const userService = require('../services/userService');

// ── Auth middleware ───────────────────────────────────────────────────────────

function authRequired(req, res, next) {
  const token = req.headers['x-token'];
  if (!token) return res.status(401).json({ error: '未登录' });
  const session = userService.validateToken(token);
  if (!session) return res.status(401).json({ error: '登录已过期' });
  req.user = session;
  next();
}

function adminRequired(req, res, next) {
  authRequired(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ error: '需要管理员权限' });
    next();
  });
}

// ── POST /api/auth/login ─────────────────────────────────────────────────────

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username) return res.status(400).json({ error: '请输入用户名' });

  const user = userService.authenticate(username, password || '');
  if (!user) return res.status(401).json({ error: '用户名或密码错误' });

  const token = userService.createToken(user.username, user.isAdmin);
  res.json({ token, username: user.username, isAdmin: user.isAdmin });
});

// ── POST /api/auth/logout ────────────────────────────────────────────────────

router.post('/logout', (req, res) => {
  const token = req.headers['x-token'];
  if (token) userService.revokeToken(token);
  res.json({ ok: true });
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get('/me', authRequired, (req, res) => {
  res.json({ username: req.user.username, isAdmin: req.user.isAdmin });
});

// ── POST /api/auth/change-password ───────────────────────────────────────────

router.post('/change-password', authRequired, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = userService.getUser(req.user.username);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  // Verify old password
  if (!userService.verifyPassword(oldPassword || '', user.passwordHash)) {
    return res.status(400).json({ error: '原密码错误' });
  }
  const result = userService.changePassword(req.user.username, newPassword || '');
  res.json(result);
});

// ── Admin: POST /api/auth/create-admin (first-run only) ──────────────────────

router.post('/create-admin', (req, res) => {
  if (userService.hasAnyUser()) {
    return res.status(400).json({ error: '管理员已存在' });
  }
  const { username, password } = req.body;
  if (!username || typeof username !== 'string' || username.trim().length < 1) {
    return res.status(400).json({ error: '请输入管理员用户名' });
  }
  const result = userService.createUser(username.trim(), password || '', true);
  if (result.error) return res.status(400).json(result);

  const token = userService.createToken(username.trim(), true);
  res.json({ ok: true, token, username: username.trim(), isAdmin: true });
});

// ── Admin: GET /api/auth/users ───────────────────────────────────────────────

router.get('/users', adminRequired, (req, res) => {
  res.json(userService.listUsers());
});

// ── Admin: POST /api/auth/users ──────────────────────────────────────────────

router.post('/users', adminRequired, (req, res) => {
  const { username, password } = req.body;
  if (!username || typeof username !== 'string' || username.trim().length < 1) {
    return res.status(400).json({ error: '请输入用户名' });
  }
  const result = userService.createUser(username.trim(), password || '', false);
  if (result.error) return res.status(400).json(result);
  res.json({ ok: true });
});

// ── Admin: DELETE /api/auth/users/:username ───────────────────────────────────

router.delete('/users/:username', adminRequired, (req, res) => {
  const result = userService.deleteUser(req.params.username);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── Admin: POST /api/auth/users/:username/reset-password ─────────────────────

router.post('/users/:username/reset-password', adminRequired, (req, res) => {
  const { newPassword } = req.body;
  const result = userService.changePassword(req.params.username, newPassword || '');
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── Watch progress: GET /api/auth/watch-data ─────────────────────────────────

router.get('/watch-data', authRequired, (req, res) => {
  res.json(userService.getWatchData(req.user.username));
});

// ── Watch progress: POST /api/auth/watch-progress ────────────────────────────

router.post('/watch-progress', authRequired, (req, res) => {
  const { movieId, progress, duration } = req.body;
  if (!movieId) return res.status(400).json({ error: 'movieId required' });
  const result = userService.updateWatchProgress(
    req.user.username, movieId,
    Number(progress) || 0, Number(duration) || 0
  );
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── Watch progress: POST /api/auth/mark-watched ──────────────────────────────

router.post('/mark-watched', authRequired, (req, res) => {
  const { movieId } = req.body;
  if (!movieId) return res.status(400).json({ error: 'movieId required' });
  const result = userService.markWatched(req.user.username, movieId);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── Watch progress: POST /api/auth/unmark-watched ────────────────────────────

router.post('/unmark-watched', authRequired, (req, res) => {
  const { movieId } = req.body;
  if (!movieId) return res.status(400).json({ error: 'movieId required' });
  const result = userService.unmarkWatched(req.user.username, movieId);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ── Export middleware too ─────────────────────────────────────────────────────

router.authRequired = authRequired;
router.adminRequired = adminRequired;

module.exports = router;
