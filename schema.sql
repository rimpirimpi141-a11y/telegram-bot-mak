-- Cloudflare D1 Schema for Telegram Bot Maker & Multi-Bot Engine

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS master_admins (
  user_id INTEGER PRIMARY KEY,
  added_by INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS master_users (
  user_id INTEGER PRIMARY KEY,
  username TEXT DEFAULT '',
  first_name TEXT DEFAULT '',
  coins REAL NOT NULL DEFAULT 0,
  referred_by INTEGER NOT NULL DEFAULT 0,
  ref_credited INTEGER NOT NULL DEFAULT 0,
  total_refs INTEGER NOT NULL DEFAULT 0,
  last_daily_at INTEGER NOT NULL DEFAULT 0,
  is_banned INTEGER NOT NULL DEFAULT 0,
  device_verified INTEGER NOT NULL DEFAULT 0,
  device_hash TEXT DEFAULT '',
  device_ip TEXT DEFAULT '',
  state TEXT DEFAULT '',
  state_data TEXT DEFAULT '',
  joined_at INTEGER NOT NULL DEFAULT 0,
  last_active_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS master_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  invite_link TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  amount_rs REAL NOT NULL,
  coins REAL NOT NULL,
  utr TEXT NOT NULL,
  screenshot_file_id TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  processed_by INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  processed_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  bot_id_tg INTEGER NOT NULL DEFAULT 0,
  bot_username TEXT NOT NULL DEFAULT '',
  bot_name TEXT NOT NULL DEFAULT '',
  bot_type TEXT NOT NULL DEFAULT 'upi_normal',
  is_active INTEGER NOT NULL DEFAULT 1,
  per_refer REAL NOT NULL DEFAULT 10.0,
  min_withdraw REAL NOT NULL DEFAULT 50.0,
  daily_bonus REAL NOT NULL DEFAULT 5.0,
  currency TEXT NOT NULL DEFAULT '₹',
  withdrawals_open INTEGER NOT NULL DEFAULT 1,
  maintenance INTEGER NOT NULL DEFAULT 0,
  device_verify INTEGER NOT NULL DEFAULT 1,
  support_username TEXT NOT NULL DEFAULT '',
  deposit_enabled INTEGER NOT NULL DEFAULT 1,
  deposit_qr_file_id TEXT NOT NULL DEFAULT '',
  deposit_upi_id TEXT NOT NULL DEFAULT '',
  min_deposit REAL NOT NULL DEFAULT 10.0,
  gmail_sell_price REAL NOT NULL DEFAULT 5.0,
  gmail_sell_open INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS child_admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_db_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  added_by INTEGER NOT NULL DEFAULT 0,
  added_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(bot_db_id, user_id),
  FOREIGN KEY(bot_db_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS child_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_db_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  username TEXT DEFAULT '',
  first_name TEXT DEFAULT '',
  balance REAL NOT NULL DEFAULT 0.0,
  total_earned REAL NOT NULL DEFAULT 0.0,
  total_withdrawn REAL NOT NULL DEFAULT 0.0,
  upi_id TEXT DEFAULT '',
  referred_by INTEGER NOT NULL DEFAULT 0,
  ref_credited INTEGER NOT NULL DEFAULT 0,
  total_refs INTEGER NOT NULL DEFAULT 0,
  last_daily_at INTEGER NOT NULL DEFAULT 0,
  is_banned INTEGER NOT NULL DEFAULT 0,
  device_verified INTEGER NOT NULL DEFAULT 0,
  device_hash TEXT DEFAULT '',
  device_ip TEXT DEFAULT '',
  state TEXT DEFAULT '',
  state_data TEXT DEFAULT '',
  joined_at INTEGER NOT NULL DEFAULT 0,
  last_active_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(bot_db_id, user_id),
  FOREIGN KEY(bot_db_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS child_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_db_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  invite_link TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(bot_db_id, chat_id),
  FOREIGN KEY(bot_db_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS withdrawals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_db_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  upi_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  note TEXT DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT 0,
  processed_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(bot_db_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS redeem_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_db_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  cost REAL NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(bot_db_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS redeem_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_db_id INTEGER NOT NULL,
  plan_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  is_used INTEGER NOT NULL DEFAULT 0,
  used_by INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(bot_db_id) REFERENCES bots(id) ON DELETE CASCADE,
  FOREIGN KEY(plan_id) REFERENCES redeem_plans(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS child_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_db_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  reward REAL NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(bot_db_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS child_task_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_db_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(bot_db_id, task_id, user_id),
  FOREIGN KEY(bot_db_id) REFERENCES bots(id) ON DELETE CASCADE,
  FOREIGN KEY(task_id) REFERENCES child_tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS child_promos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_db_id INTEGER NOT NULL,
  code TEXT NOT NULL,
  reward REAL NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 100,
  used_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(bot_db_id, code),
  FOREIGN KEY(bot_db_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS child_promo_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_db_id INTEGER NOT NULL,
  promo_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL DEFAULT 0,
  UNIQUE(bot_db_id, promo_id, user_id),
  FOREIGN KEY(bot_db_id) REFERENCES bots(id) ON DELETE CASCADE,
  FOREIGN KEY(promo_id) REFERENCES child_promos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS device_tokens (
  token TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  bot_db_id INTEGER NOT NULL DEFAULT 0,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS child_deposits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_db_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  utr TEXT NOT NULL,
  screenshot_file_id TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  processed_by INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  processed_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(bot_db_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gmail_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_db_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  price REAL NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(bot_db_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gmail_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_db_id INTEGER NOT NULL,
  plan_id INTEGER NOT NULL,
  account_data TEXT NOT NULL,
  is_sold INTEGER NOT NULL DEFAULT 0,
  sold_to INTEGER NOT NULL DEFAULT 0,
  sold_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(bot_db_id) REFERENCES bots(id) ON DELETE CASCADE,
  FOREIGN KEY(plan_id) REFERENCES gmail_plans(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gmail_sell_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_db_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  account_data TEXT NOT NULL,
  price REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  processed_by INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  processed_at INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY(bot_db_id) REFERENCES bots(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_child_users_bot ON child_users(bot_db_id, user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_bot_status ON withdrawals(bot_db_id, status);
CREATE INDEX IF NOT EXISTS idx_bots_owner ON bots(owner_id);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_plan ON redeem_codes(plan_id, is_used);
CREATE INDEX IF NOT EXISTS idx_deposits_status ON deposits(status);
CREATE INDEX IF NOT EXISTS idx_child_deposits_bot ON child_deposits(bot_db_id, status);
CREATE INDEX IF NOT EXISTS idx_gmail_stock_plan ON gmail_stock(plan_id, is_sold);
CREATE INDEX IF NOT EXISTS idx_gmail_sell_bot ON gmail_sell_requests(bot_db_id, status);

-- Default Settings Seed
INSERT OR IGNORE INTO settings (key, value) VALUES ('daily_coins', '2');
INSERT OR IGNORE INTO settings (key, value) VALUES ('bot_cost', '5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('cost_upi_normal', '5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('cost_upi_advanced', '10');
INSERT OR IGNORE INTO settings (key, value) VALUES ('cost_redeem_normal', '5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('cost_redeem_advanced', '10');
INSERT OR IGNORE INTO settings (key, value) VALUES ('cost_star_normal', '5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('cost_star_advanced', '10');
INSERT OR IGNORE INTO settings (key, value) VALUES ('cost_gmail_bot', '10');
INSERT OR IGNORE INTO settings (key, value) VALUES ('master_ref_coins', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('maintenance', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('support_username', '@Support');
INSERT OR IGNORE INTO settings (key, value) VALUES ('master_bot_username', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('master_device_verify', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('deposit_enabled', '1');
INSERT OR IGNORE INTO settings (key, value) VALUES ('deposit_rs', '10');
INSERT OR IGNORE INTO settings (key, value) VALUES ('deposit_coins', '5');
INSERT OR IGNORE INTO settings (key, value) VALUES ('min_deposit_rs', '10');
INSERT OR IGNORE INTO settings (key, value) VALUES ('deposit_qr_file_id', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('deposit_upi_id', '');
