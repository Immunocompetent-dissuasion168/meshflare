CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('offline_days', '7');
INSERT OR IGNORE INTO settings (key, value) VALUES ('oisd_enabled', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('oisd_status', 'idle');
