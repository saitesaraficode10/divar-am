const jwt = require('jsonwebtoken');
const db = require('../utils/db');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-divar-am-secret-min-32-chars!!';

function authUser(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'user') return res.redirect('/login');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
    if (!user || user.is_banned) {
      res.clearCookie('token');
      return res.redirect('/login');
    }
    req.user = user;
    next();
  } catch {
    res.clearCookie('token');
    res.redirect('/login');
  }
}

function optionalUser(req, res, next) {
  const token = req.cookies.token;
  if (!token) { req.user = null; return next(); }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role === 'user') {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id);
      req.user = (user && !user.is_banned) ? user : null;
    } else req.user = null;
  } catch { req.user = null; }
  next();
}

function authAdmin(req, res, next) {
  const token = req.cookies.admin_token;
  if (!token) return res.redirect('/admin/login');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'admin') return res.redirect('/admin/login');
    req.admin = { username: payload.username };
    next();
  } catch {
    res.clearCookie('admin_token');
    res.redirect('/admin/login');
  }
}

module.exports = { authUser, optionalUser, authAdmin, JWT_SECRET };
