const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "tubewell.db");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);

// Seed default settings (only if missing)
const DEFAULTS = {
  business_name: "Tubewell Billing",
  business_address: "",
  receipt_footer: "Thank you.",
  default_rate_paise: String(process.env.DEFAULT_RATE_PAISE || 8000),
};

const insertSetting = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
for (const [k, v] of Object.entries(DEFAULTS)) {
  insertSetting.run(k, v);
}

console.log(`[db] SQLite ready at ${DB_PATH}`);

module.exports = db;