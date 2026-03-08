const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, '..', 'users.json');

// ── Password hashing (scrypt) ────────────────────────────────────────────────

function hashPassword(password) {
  if (!password) return '';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored) return !password; // both empty → match
  if (!password) return false;   // stored has hash but no password given
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  return check === hash;
}

// ── Token management (random hex, stored in memory) ──────────────────────────

const tokens = new Map(); // token → { username, isAdmin, created }
const TOKEN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function createToken(username, isAdmin) {
  const token = crypto.randomBytes(32).toString('hex');
  tokens.set(token, { username, isAdmin, created: Date.now() });
  return token;
}

function validateToken(token) {
  const session = tokens.get(token);
  if (!session) return null;
  if (Date.now() - session.created > TOKEN_MAX_AGE_MS) {
    tokens.delete(token);
    return null;
  }
  return session;
}

function revokeToken(token) {
  tokens.delete(token);
}

// Periodically purge expired tokens to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of tokens) {
    if (now - session.created > TOKEN_MAX_AGE_MS) tokens.delete(token);
  }
}, 60 * 60 * 1000); // every hour

// ── User data persistence (in-memory cache) ─────────────────────────────────

let _usersCache = null;

function loadUsers() {
  if (_usersCache) return _usersCache;
  try {
    if (fs.existsSync(USERS_FILE)) {
      _usersCache = JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
      return _usersCache;
    }
  } catch { /* corrupt file */ }
  _usersCache = {};
  return _usersCache;
}

function saveUsers(users) {
  _usersCache = users;
  fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8', (err) => {
    if (err) console.error('Failed to save users:', err.message);
  });
}

function getUser(username) {
  const users = loadUsers();
  return users[username] || null;
}

function listUsers() {
  const users = loadUsers();
  return Object.entries(users).map(([username, u]) => ({
    username,
    isAdmin: !!u.isAdmin,
    createdAt: u.createdAt,
  }));
}

function createUser(username, password, isAdmin) {
  const users = loadUsers();
  if (users[username]) return { error: '用户名已存在' };

  users[username] = {
    passwordHash: hashPassword(password),
    isAdmin: !!isAdmin,
    createdAt: new Date().toISOString(),
    watchData: {},  // { movieId: { status: 'watched'|'watching', progress: 0-1, updatedAt } }
  };
  saveUsers(users);
  return { ok: true };
}

function changePassword(username, newPassword) {
  const users = loadUsers();
  if (!users[username]) return { error: '用户不存在' };
  users[username].passwordHash = hashPassword(newPassword);
  saveUsers(users);
  return { ok: true };
}

function deleteUser(username) {
  const users = loadUsers();
  if (!users[username]) return { error: '用户不存在' };
  if (users[username].isAdmin) return { error: '不能删除管理员账户' };
  delete users[username];
  saveUsers(users);
  return { ok: true };
}

function authenticate(username, password) {
  const users = loadUsers();
  const user = users[username];
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return { username, isAdmin: !!user.isAdmin };
}

function hasAnyUser() {
  const users = loadUsers();
  return Object.keys(users).length > 0;
}

// ── Watch progress ───────────────────────────────────────────────────────────

function getWatchData(username) {
  const users = loadUsers();
  const user = users[username];
  return user ? (user.watchData || {}) : {};
}

function updateWatchProgress(username, movieId, progress, duration) {
  const users = loadUsers();
  const user = users[username];
  if (!user) return { error: '用户不存在' };

  if (!user.watchData) user.watchData = {};

  const ratio = duration > 0 ? progress / duration : 0;
  const status = ratio >= 0.9 ? 'watched' : 'watching';

  user.watchData[movieId] = {
    status,
    progress: Math.floor(progress),
    duration: Math.floor(duration),
    updatedAt: new Date().toISOString(),
  };
  saveUsers(users);
  return { ok: true, status };
}

function markWatched(username, movieId) {
  const users = loadUsers();
  const user = users[username];
  if (!user) return { error: '用户不存在' };
  if (!user.watchData) user.watchData = {};
  user.watchData[movieId] = {
    status: 'watched',
    progress: 0,
    duration: 0,
    updatedAt: new Date().toISOString(),
  };
  saveUsers(users);
  return { ok: true };
}

function unmarkWatched(username, movieId) {
  const users = loadUsers();
  const user = users[username];
  if (!user) return { error: '用户不存在' };
  if (user.watchData) delete user.watchData[movieId];
  saveUsers(users);
  return { ok: true };
}

module.exports = {
  hashPassword, verifyPassword,
  createToken, validateToken, revokeToken,
  loadUsers, getUser, listUsers, createUser, changePassword, deleteUser,
  authenticate, hasAnyUser,
  getWatchData, updateWatchProgress, markWatched, unmarkWatched,
};
