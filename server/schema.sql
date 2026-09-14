PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  mobile        TEXT    NOT NULL,
  address       TEXT,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS bills (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id             INTEGER NOT NULL REFERENCES customers(id),
  bill_date               TEXT    NOT NULL,
  start_time              TEXT    NOT NULL,
  end_time                TEXT    NOT NULL,
  usage_minutes           INTEGER NOT NULL CHECK (usage_minutes > 0),
  rate_paise_per_hour     INTEGER NOT NULL CHECK (rate_paise_per_hour >= 0),
  amount_paise            INTEGER NOT NULL CHECK (amount_paise >= 0),
  previous_due_paise      INTEGER NOT NULL,
  total_due_paise         INTEGER NOT NULL,
  created_at              TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id    INTEGER NOT NULL REFERENCES customers(id),
  payment_date   TEXT    NOT NULL,
  amount_paise   INTEGER NOT NULL CHECK (amount_paise > 0),
  mode           TEXT    NOT NULL CHECK (mode IN ('cash','online')),
  note           TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payment_allocations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id     INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  bill_id        INTEGER NOT NULL REFERENCES bills(id),
  amount_paise   INTEGER NOT NULL CHECK (amount_paise > 0),
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bills_customer    ON bills(customer_id);
CREATE INDEX IF NOT EXISTS idx_bills_date        ON bills(bill_date);
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_date     ON payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_alloc_bill        ON payment_allocations(bill_id);
CREATE INDEX IF NOT EXISTS idx_alloc_payment     ON payment_allocations(payment_id);

-- settings

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);


-- notebook due
CREATE TABLE IF NOT EXISTS notebook_dues (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id    INTEGER NOT NULL REFERENCES customers(id),
  due_date       TEXT    NOT NULL,
  amount_paise   INTEGER NOT NULL CHECK (amount_paise > 0),
  note           TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notebook_allocations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_id        INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  notebook_due_id   INTEGER NOT NULL REFERENCES notebook_dues(id),
  amount_paise      INTEGER NOT NULL CHECK (amount_paise > 0),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notebook_customer ON notebook_dues(customer_id);
CREATE INDEX IF NOT EXISTS idx_notebook_date     ON notebook_dues(due_date);
CREATE INDEX IF NOT EXISTS idx_nballoc_notebook  ON notebook_allocations(notebook_due_id);
CREATE INDEX IF NOT EXISTS idx_nballoc_payment   ON notebook_allocations(payment_id);