const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/customers  → list with due
router.get("/", (req, res) => {
  const rows = db.prepare(`
    SELECT
      c.id, c.name, c.mobile, c.address, c.created_at,
            (COALESCE((SELECT SUM(amount_paise) FROM bills    WHERE customer_id = c.id), 0)
       + COALESCE((SELECT SUM(amount_paise) FROM notebook_dues WHERE customer_id = c.id), 0)
       - COALESCE((SELECT SUM(amount_paise) FROM payments WHERE customer_id = c.id), 0)
      ) AS due_paise
    FROM customers c
    WHERE c.is_active = 1
    ORDER BY c.name COLLATE NOCASE ASC
  `).all();
  res.json(rows);
});

// POST /api/customers
router.post("/", (req, res) => {
  const { name, mobile, address } = req.body || {};
  const err = validateCustomer({ name, mobile });
  if (err) return res.status(400).json({ error: err });

  const info = db.prepare(
    "INSERT INTO customers (name, mobile, address) VALUES (?, ?, ?)"
  ).run(name.trim(), normalizeMobile(mobile), (address || "").trim() || null);

  const row = db.prepare("SELECT * FROM customers WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ ...row, due_paise: 0 });
});

// GET /api/customers/:id
router.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });

  const customer = db.prepare("SELECT * FROM customers WHERE id = ? AND is_active = 1").get(id);
  if (!customer) return res.status(404).json({ error: "Customer not found" });

  const { due_paise } = db.prepare(`
        SELECT
      (COALESCE((SELECT SUM(amount_paise) FROM bills    WHERE customer_id = ?), 0)
       + COALESCE((SELECT SUM(amount_paise) FROM notebook_dues WHERE customer_id = ?), 0)
       - COALESCE((SELECT SUM(amount_paise) FROM payments WHERE customer_id = ?), 0)
      ) AS due_paise
  `).get(id, id, id);

  res.json({ ...customer, due_paise });
});

// PUT /api/customers/:id
router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });

  const { name, mobile, address } = req.body || {};
  const err = validateCustomer({ name, mobile });
  if (err) return res.status(400).json({ error: err });

  const existing = db.prepare("SELECT id FROM customers WHERE id = ? AND is_active = 1").get(id);
  if (!existing) return res.status(404).json({ error: "Customer not found" });

  db.prepare(
    "UPDATE customers SET name = ?, mobile = ?, address = ? WHERE id = ?"
  ).run(name.trim(), normalizeMobile(mobile), (address || "").trim() || null, id);

  res.json({ ok: true });
});

// DELETE /api/customers/:id  (soft)
router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });

  const existing = db.prepare("SELECT id FROM customers WHERE id = ? AND is_active = 1").get(id);
  if (!existing) return res.status(404).json({ error: "Customer not found" });

  db.prepare("UPDATE customers SET is_active = 0 WHERE id = ?").run(id);
  res.json({ ok: true });
});

// ---------- helpers ----------
function validateCustomer({ name, mobile }) {
  if (!name || typeof name !== "string" || !name.trim()) return "Name is required";
  if (!mobile || typeof mobile !== "string") return "Mobile is required";
  const digits = normalizeMobile(mobile);
  if (digits.length < 10 || digits.length > 13) return "Mobile must be 10–13 digits";
  return null;
}

function normalizeMobile(mobile) {
  return String(mobile).replace(/\D/g, "");
}

module.exports = router;