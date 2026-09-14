const express = require("express");
const db = require("../db");

const router = express.Router();

const PUBLIC_KEYS = [
  "business_name",
  "business_address",
  "receipt_footer",
  "default_rate_paise",
];

// GET /api/settings  → returns public settings as an object
router.get("/settings", (req, res) => {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const out = {};
  for (const r of rows) {
    if (PUBLIC_KEYS.includes(r.key)) out[r.key] = r.value;
  }
  res.json(out);
});

// PUT /api/settings  → updates one or more keys
router.put("/settings", (req, res) => {
  const body = req.body || {};
  const allowed = PUBLIC_KEYS;
  const updates = [];

  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates.push({ key, value: String(body[key]) });
    }
  }

  if (!updates.length) {
    return res.status(400).json({ error: "No valid settings provided" });
  }

  // Validate default_rate_paise if present
  for (const u of updates) {
    if (u.key === "default_rate_paise") {
      const n = Number(u.value);
      if (!Number.isInteger(n) || n < 0) {
        return res.status(400).json({ error: "Default rate must be a non-negative integer (paise)" });
      }
    }
    if (u.key === "business_name" && !u.value.trim()) {
      return res.status(400).json({ error: "Business name cannot be empty" });
    }
  }

  const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);

  const tx = db.transaction(() => {
    for (const u of updates) stmt.run(u.key, u.value);
  });
  tx();

  res.json({ ok: true });
});

module.exports = router;