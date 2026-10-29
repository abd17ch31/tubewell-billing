const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/customers/:customerId/notebook-dues
router.get("/customers/:customerId/notebook-dues", async (req, res) => {
  const cid = Number(req.params.customerId);
  if (!Number.isInteger(cid)) return res.status(400).json({ error: "Invalid customer id" });

  const rows = await db.query(`
    SELECT n.*,
      COALESCE((SELECT SUM(amount_paise) FROM notebook_allocations WHERE notebook_due_id = n.id), 0) AS allocated_paise
    FROM notebook_dues n
    WHERE n.customer_id = ?
    ORDER BY n.due_date DESC, n.id DESC
  `, [cid]);
  res.json(rows);
});

// POST /api/customers/:customerId/notebook-dues
router.post("/customers/:customerId/notebook-dues", async (req, res) => {
  const cid = Number(req.params.customerId);
  if (!Number.isInteger(cid)) return res.status(400).json({ error: "Invalid customer id" });

  const [customer] = await db.query("SELECT id FROM customers WHERE id = ? AND is_active = 1", [cid]);
  if (!customer) return res.status(404).json({ error: "Customer not found" });

  const { due_date, amount_paise, note } = req.body || {};

  if (typeof due_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
    return res.status(400).json({ error: "Invalid date (YYYY-MM-DD)" });
  }
  const amt = Number(amount_paise);
  if (!Number.isInteger(amt) || amt <= 0) {
    return res.status(400).json({ error: "Amount must be a positive integer (paise)" });
  }

  const info = await db.execute(`
    INSERT INTO notebook_dues (customer_id, due_date, amount_paise, note)
    VALUES (?, ?, ?, ?) RETURNING id
  `, [cid, due_date, amt, note ? String(note).trim() : null]);

  const [row] = await db.query("SELECT * FROM notebook_dues WHERE id = ?", [info.insertId]);
  res.status(201).json({ ...row, allocated_paise: 0 });
});

// DELETE /api/notebook-dues/:id
router.delete("/notebook-dues/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });

  const [existing] = await db.query("SELECT id FROM notebook_dues WHERE id = ?", [id]);
  if (!existing) return res.status(404).json({ error: "Notebook due not found" });

  const [{ s: allocated }] = await db.query(
    "SELECT COALESCE(SUM(amount_paise),0) AS s FROM notebook_allocations WHERE notebook_due_id = ?",
    [id],
  );

  if (allocated > 0) {
    return res.status(409).json({
      error: "This notebook due has payments applied to it. Delete the payment first."
    });
  }

  await db.execute("DELETE FROM notebook_dues WHERE id = ?", [id]);
  res.json({ ok: true });
});

module.exports = router;