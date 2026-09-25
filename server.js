require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./utils/db');
const { authUser, optionalUser, authAdmin, JWT_SECRET } = require('./middleware/auth');
const {
  csrfToken, verifyCsrf, checkCsrfAfterMulter, sanitizeText, isValidPhone,
  checkLoginLock, recordLoginFail, clearLoginFail
} = require('./middleware/security');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

const uploadDir = path.join(__dirname, 'public', 'uploads', 'ads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      "font-src": ["'self'", "https://cdn.jsdelivr.net", "data:"],
      "img-src": ["'self'", "data:", "blob:", "https:"],
      "object-src": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"]
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', dotfiles: 'deny' }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 400, standardHeaders: true, legacyHeaders: false }));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 25 });
app.use(csrfToken);
app.use(verifyCsrf);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => {
    if (!/jpeg|jpg|png|webp/i.test(file.mimetype)) return cb(new Error('فقط jpg/png/webp'));
    cb(null, true);
  }
});

const translations = {
  fa: require('./locales/fa.json'),
  en: require('./locales/en.json'),
  ru: require('./locales/ru.json'),
  hy: require('./locales/hy.json')
};

function t(lang, key) {
  return (translations[lang] && translations[lang][key]) || translations.fa[key] || key;
}
function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  const row = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
  if (row) db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(String(value), key);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
}
function nextUserCode() {
  let n = parseInt(getSetting('next_user_code', '1000'), 10) || 1000;
  while (db.prepare('SELECT id FROM users WHERE user_code = ?').get(n)) n += 1;
  setSetting('next_user_code', String(n + 1));
  return n;
}
function catName(cat, lang) {
  if (!cat) return '';
  if (lang === 'en') return cat.name_en || cat.name_fa;
  if (lang === 'hy') return cat.name_hy || cat.name_fa;
  if (lang === 'ru') return cat.name_ru || cat.name_fa;
  return cat.name_fa;
}
function allCategories() {
  return db.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all();
}
function getPayCards() {
  return {
    ir: getSetting('pay_card_ir_enabled', '0') === '1' ? getSetting('pay_card_ir', '') : '',
    am: getSetting('pay_card_am_enabled', '0') === '1' ? getSetting('pay_card_am', '') : '',
    visa: getSetting('pay_card_visa_enabled', '0') === '1' ? getSetting('pay_card_visa', '') : '',
    note: getSetting('pay_card_note', '')
  };
}

app.use((req, res, next) => {
  const lang = ['fa', 'en', 'ru', 'hy'].includes(req.cookies.lang) ? req.cookies.lang : 'fa';
  res.locals.lang = lang;
  res.locals.t = (key) => t(lang, key);
  res.locals.dir = (lang === 'fa' || lang === 'hy') ? 'rtl' : 'ltr';
  res.locals.catName = (c) => catName(c, lang);
  res.locals.siteName = lang === 'fa' ? getSetting('site_name_fa', 'دیوار ارمنستان') : getSetting('site_name_en', 'Divar Armenia');
  next();
});

app.get('/set-lang/:lang', (req, res) => {
  const lang = ['fa', 'en', 'ru', 'hy'].includes(req.params.lang) ? req.params.lang : 'fa';
  res.cookie('lang', lang, { maxAge: 365 * 24 * 60 * 60 * 1000 });
  res.redirect(req.get('Referer') || '/');
});

function listAds(query) {
  const { q = '', category = '', city = '', price_from = '', price_to = '', status = 'active' } = query;
  let sql = `
    SELECT a.*, c.slug AS cat_slug, c.name_fa, c.name_en, c.name_hy, c.name_ru, c.icon
    FROM ads a JOIN categories c ON c.id = a.category_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND a.status = ?'; params.push(status); }
  if (category) { sql += ' AND c.slug = ?'; params.push(category); }
  if (city) { sql += ' AND a.city LIKE ?'; params.push('%' + city + '%'); }
  if (q) { sql += ' AND (a.title LIKE ? OR a.description LIKE ?)'; params.push('%' + q + '%', '%' + q + '%'); }
  if (price_from) { sql += ' AND a.price >= ?'; params.push(parseFloat(price_from)); }
  if (price_to) { sql += ' AND a.price <= ?'; params.push(parseFloat(price_to)); }
  sql += ' ORDER BY a.created_at DESC LIMIT 60';
  return db.prepare(sql).all(...params);
}

app.get('/', optionalUser, (req, res) => {
  try {
    let v = parseInt(getSetting('page_views', '2150'), 10) || 2150;
    setSetting('page_views', String(v + 1));
  } catch (e) {}
  const categories = allCategories();
  const ads = listAds(req.query);
  let favIds = new Set();
  if (req.user) {
    favIds = new Set(db.prepare('SELECT ad_id FROM favorites WHERE user_id = ?').all(req.user.id).map(x => x.ad_id));
  }
  res.render('index', {
    user: req.user, categories, ads, favIds,
    filters: req.query,
    title: res.locals.siteName
  });
});

app.get('/ad/:code', optionalUser, (req, res) => {
  const ad = db.prepare(`
    SELECT a.*, c.slug AS cat_slug, c.name_fa, c.name_en, c.name_hy, c.name_ru, c.icon, u.user_code, u.full_name AS seller_name
    FROM ads a
    JOIN categories c ON c.id = a.category_id
    JOIN users u ON u.id = a.user_id
    WHERE a.code = ?
  `).get(req.params.code);
  if (!ad || (ad.status !== 'active' && (!req.user || req.user.id !== ad.user_id))) {
    return res.status(404).render('error', { user: req.user, message: 'آگهی پیدا نشد', title: '404' });
  }
  db.prepare('UPDATE ads SET views = views + 1 WHERE id = ?').run(ad.id);
  ad.views += 1;
  const images = db.prepare('SELECT * FROM ad_images WHERE ad_id = ? ORDER BY sort_order, id').all(ad.id);
  if (!images.length && ad.image_path) images.push({ path: ad.image_path });
  let isFav = false;
  if (req.user) isFav = !!db.prepare('SELECT id FROM favorites WHERE user_id=? AND ad_id=?').get(req.user.id, ad.id);
  res.render('ad', { user: req.user, ad, images, isFav, title: ad.title });
});

app.get('/register', optionalUser, (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('register', { user: null, error: null, title: t(res.locals.lang, 'register') });
});

app.post('/register', authLimiter, async (req, res) => {
  const full_name = sanitizeText(req.body.full_name, 80);
  const phone_cc = sanitizeText(req.body.phone_cc, 8) || '+374';
  const phone_local = sanitizeText(req.body.phone_local, 20).replace(/^0+/, '');
  const wa_cc = sanitizeText(req.body.wa_cc, 8) || phone_cc;
  const wa_local = sanitizeText(req.body.wa_local, 20).replace(/^0+/, '');
  const phone = (phone_cc + phone_local).replace(/\s/g, '');
  const whatsapp = (wa_cc + (wa_local || phone_local)).replace(/\s/g, '');
  const city = sanitizeText(req.body.city, 40) || 'Yerevan';
  const password = String(req.body.password || '');
  if (!full_name || !phone_local || password.length < 6 || !isValidPhone(phone)) {
    return res.render('register', { user: null, error: 'نام، شماره معتبر و رمز حداقل ۶ کاراکتر لازم است', title: 'ثبت‌نام' });
  }
  try {
    const hash = await bcrypt.hash(password, 12);
    const user_code = nextUserCode();
    db.prepare("INSERT INTO users (user_code, full_name, phone, whatsapp, city, password_hash, last_seen) VALUES (?,?,?,?,?,?,datetime('now'))")
      .run(user_code, full_name, phone, whatsapp, city, hash);
    res.render('register-success', { user: null, user_code, title: 'ثبت‌نام موفق' });
  } catch (e) {
    res.render('register', { user: null, error: 'این شماره قبلاً ثبت شده', title: 'ثبت‌نام' });
  }
});

app.get('/login', optionalUser, (req, res) => {
  if (req.user) return res.redirect('/');
  res.render('login', { user: null, error: null, next: req.query.next || '/', title: t(res.locals.lang, 'login') });
});

app.post('/login', authLimiter, async (req, res) => {
  const phone = sanitizeText(req.body.phone, 20);
  const password = String(req.body.password || '');
  const nextUrl = sanitizeText(req.body.next, 200) || '/';
  const lockKey = 'user:' + phone;
  try {
    const lock = checkLoginLock(db, lockKey);
    if (!lock.ok) return res.render('login', { user: null, error: 'قفل موقت ' + lock.minutes + ' دقیقه', next: nextUrl, title: 'ورود' });
  } catch (e) {}
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    try { recordLoginFail(db, lockKey); } catch (e) {}
    return res.render('login', { user: null, error: 'شماره یا رمز اشتباه', next: nextUrl, title: 'ورود' });
  }
  if (user.is_banned) return res.render('login', { user: null, error: 'حساب مسدود است', next: nextUrl, title: 'ورود' });
  try { clearLoginFail(db, lockKey); } catch (e) {}
  db.prepare("UPDATE users SET last_seen=datetime('now') WHERE id=?").run(user.id);
  const token = jwt.sign({ id: user.id, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 });
  res.redirect(nextUrl.startsWith('/') ? nextUrl : '/');
});

app.get('/logout', (req, res) => { res.clearCookie('token'); res.redirect('/'); });

app.get('/ads/new', authUser, (req, res) => {
  res.render('ad-form', {
    user: req.user,
    categories: allCategories(),
    cards: getPayCards(),
    ad: null,
    error: null,
    title: t(res.locals.lang, 'post_ad')
  });
});

app.post('/ads/new', authUser, (req, res) => {
  upload.array('images', 12)(req, res, (err) => {
    if (!checkCsrfAfterMulter(req, res)) return;
    const formCtx = () => ({ user: req.user, categories: allCategories(), cards: getPayCards(), ad: null, title: 'ثبت آگهی' });
    if (err) return res.render('ad-form', { ...formCtx(), error: err.message });
    const b = req.body;
    const title = sanitizeText(b.title, 100);
    const description = sanitizeText(b.description, 4000);
    const category_id = parseInt(b.category_id, 10);
    if (!title || !description || !category_id) {
      return res.render('ad-form', { ...formCtx(), error: 'عنوان، دسته و توضیحات الزامی است' });
    }
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(category_id);
    if (!cat) return res.render('ad-form', { ...formCtx(), error: 'دسته نامعتبر است' });

    const paidOn = !!cat.paid_enabled && Number(cat.ad_price) > 0;
    const needApprove = getSetting('require_ad_approval', '1') === '1';
    let status = 'active';
    let pay_required = 0;
    let pay_amount = null;
    let pay_status = 'none';
    if (paidOn) {
      status = 'pending_payment';
      pay_required = 1;
      pay_amount = Number(cat.ad_price);
      pay_status = 'pending';
    } else if (needApprove) {
      status = 'pending';
    }

    const code = 'A' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 90 + 10);
    const image_path = (req.files && req.files[0]) ? ('/uploads/ads/' + req.files[0].filename) : null;
    try {
      const info = db.prepare(`
        INSERT INTO ads (code, user_id, category_id, title, description, price, currency, city, district, condition, contact_phone, contact_whatsapp, status, image_path, pay_required, pay_amount, pay_status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        code, req.user.id, category_id, title, description,
        b.price ? parseFloat(b.price) : null, sanitizeText(b.currency, 10) || 'AMD',
        sanitizeText(b.city, 40) || 'Yerevan', sanitizeText(b.district, 60) || null,
        b.condition === 'new' ? 'new' : 'used',
        sanitizeText(b.contact_phone, 30) || req.user.phone,
        sanitizeText(b.contact_whatsapp, 30) || req.user.whatsapp,
        status, image_path, pay_required, pay_amount, pay_status
      );
      if (req.files && req.files.length) {
        const ins = db.prepare('INSERT INTO ad_images (ad_id, path, sort_order) VALUES (?,?,?)');
        req.files.forEach((f, i) => ins.run(info.lastInsertRowid, '/uploads/ads/' + f.filename, i));
      }
      if (paidOn) {
        return res.render('ad-pay', {
          user: req.user,
          code,
          amount: pay_amount,
          currency: cat.ad_currency || 'AMD',
          catName: cat.name_fa,
          cards: getPayCards(),
          title: 'پرداخت هزینه آگهی'
        });
      }
      res.redirect(status === 'pending' ? '/my-ads?msg=pending' : '/ad/' + code);
    } catch (e) {
      console.error(e);
      res.render('ad-form', { ...formCtx(), error: 'خطا در ثبت آگهی' });
    }
  });
});

app.get('/my-ads', authUser, (req, res) => {
  const ads = db.prepare(`
    SELECT a.*, c.name_fa FROM ads a JOIN categories c ON c.id = a.category_id
    WHERE a.user_id = ? ORDER BY a.created_at DESC
  `).all(req.user.id);
  res.render('my-ads', { user: req.user, ads, msg: req.query.msg, title: t(res.locals.lang, 'my_ads') });
});

app.post('/my-ads/:id/close', authUser, (req, res) => {
  db.prepare("UPDATE ads SET status='closed', updated_at=datetime('now') WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  res.redirect('/my-ads');
});

app.post('/favorites/:code/toggle', authUser, (req, res) => {
  const ad = db.prepare('SELECT id FROM ads WHERE code = ?').get(req.params.code);
  if (!ad) return res.redirect('/');
  const row = db.prepare('SELECT id FROM favorites WHERE user_id=? AND ad_id=?').get(req.user.id, ad.id);
  if (row) db.prepare('DELETE FROM favorites WHERE id=?').run(row.id);
  else db.prepare('INSERT INTO favorites (user_id, ad_id) VALUES (?,?)').run(req.user.id, ad.id);
  res.redirect(req.get('Referer') || '/ad/' + req.params.code);
});

app.get('/favorites', authUser, (req, res) => {
  const ads = db.prepare(`
    SELECT a.*, c.name_fa, c.icon FROM favorites f
    JOIN ads a ON a.id = f.ad_id JOIN categories c ON c.id = a.category_id
    WHERE f.user_id = ? AND a.status = 'active' ORDER BY f.created_at DESC
  `).all(req.user.id);
  res.render('favorites', { user: req.user, ads, title: t(res.locals.lang, 'favorites') });
});

// Admin
app.get('/admin/login', (req, res) => res.render('admin/login', { error: null, title: 'Admin' }));
app.post('/admin/login', authLimiter, (req, res) => {
  const username = sanitizeText(req.body.username, 40);
  const password = String(req.body.password || '');
  const lockKey = 'admin:' + username;
  try {
    const lock = checkLoginLock(db, lockKey);
    if (!lock.ok) return res.render('admin/login', { error: 'قفل ' + lock.minutes + ' دقیقه', title: 'Admin' });
  } catch (e) {}
  const ok =
    (username === process.env.ADMIN1_USERNAME && password === process.env.ADMIN1_PASSWORD) ||
    (username === process.env.ADMIN2_USERNAME && password === process.env.ADMIN2_PASSWORD);
  if (!ok) {
    try { recordLoginFail(db, lockKey); } catch (e) {}
    return res.render('admin/login', { error: 'اشتباه', title: 'Admin' });
  }
  try { clearLoginFail(db, lockKey); } catch (e) {}
  const token = jwt.sign({ role: 'admin', username }, JWT_SECRET, { expiresIn: '12h' });
  res.cookie('admin_token', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 60 * 60 * 1000 });
  res.redirect('/admin');
});
app.get('/admin/logout', (req, res) => { res.clearCookie('admin_token'); res.redirect('/admin/login'); });

app.get('/admin', authAdmin, (req, res) => {
  const stats = {
    ads: db.prepare('SELECT COUNT(*) AS c FROM ads').get().c,
    pending: db.prepare("SELECT COUNT(*) AS c FROM ads WHERE status='pending'").get().c,
    pay: db.prepare("SELECT COUNT(*) AS c FROM ads WHERE status='pending_payment' OR pay_status='pending'").get().c,
    users: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    active: db.prepare("SELECT COUNT(*) AS c FROM ads WHERE status='active'").get().c
  };
  const pending = db.prepare(`
    SELECT a.*, u.full_name, u.phone FROM ads a JOIN users u ON u.id = a.user_id
    WHERE a.status IN ('pending','pending_payment') ORDER BY a.created_at DESC LIMIT 30
  `).all();
  res.render('admin/dashboard', { admin: req.admin, stats, pending, title: 'Admin' });
});

app.get('/admin/ads', authAdmin, (req, res) => {
  const status = sanitizeText(req.query.status, 20);
  let sql = `SELECT a.*, u.full_name, u.phone, c.name_fa FROM ads a
    JOIN users u ON u.id=a.user_id JOIN categories c ON c.id=a.category_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND a.status=?'; params.push(status); }
  sql += ' ORDER BY a.created_at DESC LIMIT 100';
  const ads = db.prepare(sql).all(...params);
  res.render('admin/ads', { admin: req.admin, ads, status, title: 'Ads' });
});

app.post('/admin/ads/:id/status', authAdmin, (req, res) => {
  const status = sanitizeText(req.body.status, 20);
  if (['active', 'rejected', 'closed', 'pending'].includes(status)) {
    db.prepare("UPDATE ads SET status=?, updated_at=datetime('now') WHERE id=?").run(status, req.params.id);
  }
  res.redirect(req.get('Referer') || '/admin/ads');
});

app.post('/admin/ads/:id/delete', authAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  db.prepare('DELETE FROM ad_images WHERE ad_id=?').run(id);
  db.prepare('DELETE FROM favorites WHERE ad_id=?').run(id);
  db.prepare('DELETE FROM ads WHERE id=?').run(id);
  res.redirect('/admin/ads');
});

app.get('/admin/users', authAdmin, (req, res) => {
  const users = db.prepare('SELECT id, user_code, full_name, phone, whatsapp, city, is_banned, created_at, last_seen FROM users ORDER BY id DESC').all();
  res.render('admin/users', { admin: req.admin, users, title: 'Users' });
});

app.post('/admin/users/:id/ban', authAdmin, (req, res) => {
  const ban = req.body.ban === '1' ? 1 : 0;
  db.prepare('UPDATE users SET is_banned=? WHERE id=?').run(ban, req.params.id);
  res.redirect('/admin/users');
});


app.get('/admin/categories', authAdmin, (req, res) => {
  res.render('admin/categories', { admin: req.admin, categories: allCategories(), title: 'دسته‌ها و پرداخت' });
});

app.post('/admin/categories/:id', authAdmin, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const paid_enabled = req.body.paid_enabled === '1' ? 1 : 0;
  const ad_price = req.body.ad_price ? parseFloat(req.body.ad_price) : 0;
  const ad_currency = sanitizeText(req.body.ad_currency, 10) || 'AMD';
  db.prepare('UPDATE categories SET paid_enabled=?, ad_price=?, ad_currency=? WHERE id=?')
    .run(paid_enabled, ad_price, ad_currency, id);
  res.redirect('/admin/categories');
});

app.get('/admin/settings', authAdmin, (req, res) => {
  res.render('admin/settings', {
    admin: req.admin,
    require_ad_approval: getSetting('require_ad_approval', '1'),
    pay_card_ir: getSetting('pay_card_ir', ''),
    pay_card_ir_enabled: getSetting('pay_card_ir_enabled', '0'),
    pay_card_am: getSetting('pay_card_am', ''),
    pay_card_am_enabled: getSetting('pay_card_am_enabled', '0'),
    pay_card_visa: getSetting('pay_card_visa', ''),
    pay_card_visa_enabled: getSetting('pay_card_visa_enabled', '0'),
    pay_card_note: getSetting('pay_card_note', ''),
    title: 'تنظیمات'
  });
});

app.post('/admin/settings', authAdmin, (req, res) => {
  setSetting('require_ad_approval', req.body.require_ad_approval === '1' ? '1' : '0');
  setSetting('pay_card_ir', sanitizeText(req.body.pay_card_ir, 40));
  setSetting('pay_card_ir_enabled', req.body.pay_card_ir_enabled === '1' ? '1' : '0');
  setSetting('pay_card_am', sanitizeText(req.body.pay_card_am, 40));
  setSetting('pay_card_am_enabled', req.body.pay_card_am_enabled === '1' ? '1' : '0');
  setSetting('pay_card_visa', sanitizeText(req.body.pay_card_visa, 40));
  setSetting('pay_card_visa_enabled', req.body.pay_card_visa_enabled === '1' ? '1' : '0');
  setSetting('pay_card_note', sanitizeText(req.body.pay_card_note, 500));
  res.redirect('/admin/settings');
});

app.post('/admin/ads/:id/pay-confirm', authAdmin, (req, res) => {
  // confirm payment then set active or pending approval
  const needApprove = getSetting('require_ad_approval', '1') === '1';
  const status = needApprove ? 'pending' : 'active';
  db.prepare("UPDATE ads SET pay_status='paid', status=?, updated_at=datetime('now') WHERE id=?").run(status, req.params.id);
  res.redirect(req.get('Referer') || '/admin/ads');
});


app.use((err, req, res, next) => {
  console.error('ERR', err && err.message);
  res.status(500).send('خطای سرور');
});

try { require('./utils/init-db'); } catch (e) { console.log('init:', e.message); }

app.listen(PORT, '0.0.0.0', () => console.log('Divar-AM on port', PORT));
