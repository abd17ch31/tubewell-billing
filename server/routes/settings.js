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
router.get("/settings", async (req, res) => {
  const rows = await db.query('SELECT "key", "value" FROM settings');
  const out = {};
  for (const r of rows) {
    if (PUBLIC_KEYS.includes(r.key)) out[r.key] = r.value;
  }
  res.json(out);
});

// PUT /api/settings  → updates one or more keys
router.put("/settings", async (req, res) => {
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

  await db.transaction(async (tx) => {
    for (const u of updates) {
      await tx.execute(`
        INSERT INTO settings ("key", "value", updated_at) VALUES (?, ?, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
        ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
      `, [u.key, u.value]);
    }
  });

  res.json({ ok: true });
});

module.exports = router;