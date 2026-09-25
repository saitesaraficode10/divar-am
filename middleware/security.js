const crypto = require('crypto');

function csrfToken(req, res, next) {
  if (!req.cookies.csrf_token) {
    const token = crypto.randomBytes(24).toString('hex');
    res.cookie('csrf_token', token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    res.locals.csrfToken = token;
  } else {
    res.locals.csrfToken = req.cookies.csrf_token;
  }
  next();
}

function verifyCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('multipart/form-data')) {
    req.csrfDeferred = true;
    return next();
  }
  const sent = req.body._csrf || req.headers['x-csrf-token'];
  const cookie = req.cookies.csrf_token;
  if (!sent || !cookie || sent !== cookie) {
    return res.status(403).send('CSRF validation failed');
  }
  next();
}

function checkCsrfAfterMulter(req, res) {
  const sent = req.body && req.body._csrf;
  const cookie = req.cookies.csrf_token;
  if (!sent || !cookie || sent !== cookie) {
    res.status(403).send('CSRF validation failed');
    return false;
  }
  return true;
}

function sanitizeText(str, max = 500) {
  if (str == null) return '';
  return String(str).replace(/[<>]/g, '').trim().slice(0, max);
}

function isValidPhone(p) {
  return /^[+0-9\s()-]{7,20}$/.test(String(p || ''));
}

function checkLoginLock(db, key) {
  const row = db.prepare('SELECT * FROM login_attempts WHERE key = ?').get(key);
  if (!row) return { ok: true };
  if (row.locked_until) {
    const until = Date.parse(row.locked_until);
    if (Number.isFinite(until) && until > Date.now()) {
      return { ok: false, minutes: Math.ceil((until - Date.now()) / 60000) };
    }
  }
  return { ok: true, attempts: row.attempts || 0 };
}

function recordLoginFail(db, key) {
  const row = db.prepare('SELECT * FROM login_attempts WHERE key = ?').get(key);
  const attempts = (row ? row.attempts : 0) + 1;
  let locked = null;
  if (attempts >= 7) locked = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  if (row) {
    db.prepare("UPDATE login_attempts SET attempts=?, locked_until=?, updated_at=datetime('now') WHERE key=?").run(attempts, locked, key);
  } else {
    db.prepare('INSERT INTO login_attempts (key, attempts, locked_until) VALUES (?, ?, ?)').run(key, attempts, locked);
  }
  return { attempts, locked };
}

function clearLoginFail(db, key) {
  db.prepare('DELETE FROM login_attempts WHERE key = ?').run(key);
}

module.exports = {
  csrfToken, verifyCsrf, checkCsrfAfterMulter, sanitizeText, isValidPhone,
  checkLoginLock, recordLoginFail, clearLoginFail
};
