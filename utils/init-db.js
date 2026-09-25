const db = require('./db');
const bcrypt = require('bcryptjs');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_code INTEGER UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  whatsapp TEXT,
  city TEXT DEFAULT 'Yerevan',
  password_hash TEXT NOT NULL,
  last_seen TEXT,
  is_banned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name_fa TEXT NOT NULL,
  name_en TEXT,
  name_hy TEXT,
  name_ru TEXT,
  icon TEXT DEFAULT '📦',
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  price REAL,
  currency TEXT DEFAULT 'AMD',
  city TEXT DEFAULT 'Yerevan',
  district TEXT,
  condition TEXT DEFAULT 'used',
  contact_phone TEXT,
  contact_whatsapp TEXT,
  status TEXT DEFAULT 'pending',
  views INTEGER DEFAULT 0,
  image_path TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS ad_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id INTEGER NOT NULL,
  path TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY(ad_id) REFERENCES ads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  ad_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, ad_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ads_status ON ads(status);
CREATE INDEX IF NOT EXISTS idx_ads_cat ON ads(category_id);
CREATE INDEX IF NOT EXISTS idx_ads_city ON ads(city);
CREATE INDEX IF NOT EXISTS idx_ads_created ON ads(created_at);
`);

const cats = [
  ['real-estate', 'املاک و اجاره', 'Real Estate', 'Անշարժ գույք', 'Недвижимость', '🏠', 1],
  ['vehicles', 'وسایل نقلیه', 'Vehicles', 'Տրանսպորտ', 'Транспорт', '🚗', 2],
  ['mobile', 'موبایل و تبلت', 'Mobile & Tablet', 'Հեռախոս', 'Телефоны', '📱', 3],
  ['electronics', 'لوازم الکترونیکی', 'Electronics', 'Էլեկտրոնիկա', 'Электроника', '💻', 4],
  ['home', 'خانه و آشپزخانه', 'Home & Kitchen', 'Տուն և խոհանոց', 'Дом и кухня', '🛋️', 5],
  ['services', 'خدمات', 'Services', 'Ծառայություններ', 'Услуги', '🛠️', 6],
  ['jobs', 'استخدام و کاریابی', 'Jobs', 'Աշխատանք', 'Работа', '💼', 7],
  ['education', 'آموزش', 'Education', 'Կրթություն', 'Образование', '📚', 8],
  ['fashion', 'مد و پوشاک', 'Fashion', 'Նորաձևություն', 'Мода', '👕', 9],
  ['personal', 'لوازم شخصی', 'Personal', 'Անձնական', 'Личное', '⌚', 10],
  ['pets', 'حیوانات', 'Pets', 'Կենդանիներ', 'Животные', '🐾', 11],
  ['others', 'متفرقه', 'Others', 'Այլ', 'Разное', '📦', 12]
];

const insCat = db.prepare(`INSERT OR IGNORE INTO categories (slug, name_fa, name_en, name_hy, name_ru, icon, sort_order) VALUES (?,?,?,?,?,?,?)`);
cats.forEach(c => insCat.run(...c));

try {
  const ccols = db.prepare('PRAGMA table_info(categories)').all().map(c => c.name);
  if (!ccols.includes('paid_enabled')) db.exec('ALTER TABLE categories ADD COLUMN paid_enabled INTEGER DEFAULT 0');
  if (!ccols.includes('ad_price')) db.exec('ALTER TABLE categories ADD COLUMN ad_price REAL DEFAULT 0');
  if (!ccols.includes('ad_currency')) db.exec("ALTER TABLE categories ADD COLUMN ad_currency TEXT DEFAULT 'AMD'");
} catch (e) {}

try {
  const acols = db.prepare('PRAGMA table_info(ads)').all().map(c => c.name);
  if (!acols.includes('pay_required')) db.exec('ALTER TABLE ads ADD COLUMN pay_required INTEGER DEFAULT 0');
  if (!acols.includes('pay_amount')) db.exec('ALTER TABLE ads ADD COLUMN pay_amount REAL');
  if (!acols.includes('pay_status')) db.exec("ALTER TABLE ads ADD COLUMN pay_status TEXT DEFAULT 'none'");
  if (!acols.includes('pay_note')) db.exec('ALTER TABLE ads ADD COLUMN pay_note TEXT');
} catch (e) {}

const set = (k, v) => {
  if (!db.prepare('SELECT key FROM settings WHERE key=?').get(k)) {
    db.prepare('INSERT INTO settings (key,value) VALUES (?,?)').run(k, v);
  }
};
set('next_user_code', '1000');
set('site_name_fa', 'دیوار ارمنستان');
set('site_name_en', 'Divar Armenia');
set('contact_whatsapp', '');
set('page_views', '2150');
set('require_ad_approval', '1');
set('pay_card_ir', '');
set('pay_card_ir_enabled', '0');
set('pay_card_am', '');
set('pay_card_am_enabled', '0');
set('pay_card_visa', '');
set('pay_card_visa_enabled', '0');
set('pay_card_note', 'پس از واریز هزینه آگهی، رسید را برای پشتیبانی بفرستید تا آگهی تایید شود.');


console.log('Divar-AM DB initialized');
