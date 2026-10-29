const express = require("express");
const crypto = require("crypto");
const db = require("./db");

const router = express.Router();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(test, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function safeCompare(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

async function getStoredHash() {
  const rows = await db.query('SELECT "value" FROM settings WHERE "key" = ?', ["admin_password_hash"]);
  const row = rows[0];
  return row ? row.value : null;
}

async function checkPassword(password) {
  const storedHash = await getStoredHash();
  if (storedHash) return verifyPassword(password, storedHash);
  // Fall back to env password until the user sets one in Settings
  const env = process.env.ADMIN_PASSWORD || "changeme123";
  return safeCompare(password, env);
}

router.post("/login", async (req, res) => {
  const { password } = req.body || {};
  if (!password || typeof password !== "string") {
    return res.status(400).json({ error: "Password required" });
  }
  if (!(await checkPassword(password))) {
    return res.status(401).json({ error: "Invalid password" });
  }
  req.session.authed = true;
  req.session.loginAt = Date.now();
  res.json({ ok: true });
});

router.post("/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  res.json({ authed: !!(req.session && req.session.authed) });
});

// Change password (requires being logged in + knowing current password)
router.post("/change-password", async (req, res) => {
  if (!req.session || !req.session.authed) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: "Current and new password are required" });
  }
  if (String(new_password).length < 6) {
    return res.status(400).json({ error: "New password must be at least 6 characters" });
  }
  if (!(await checkPassword(current_password))) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }

  const hash = hashPassword(new_password);
  await db.execute(`
    INSERT INTO settings ("key", "value", updated_at) VALUES ('admin_password_hash', ?, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
  `, [hash]);

  res.json({ ok: true });
});

module.exports = router;