const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/customers/:customerId/bills
router.get("/customers/:customerId/bills", (req, res) => {
  const cid = Number(req.params.customerId);
  if (!Number.isInteger(cid)) return res.status(400).json({ error: "Invalid customer id" });

  const rows = db.prepare(`
    SELECT b.*,
      COALESCE((
        SELECT SUM(amount_paise) FROM payment_allocations WHERE bill_id = b.id
      ), 0) AS allocated_paise
    FROM bills b
    WHERE b.customer_id = ?
    ORDER BY b.bill_date DESC, b.id DESC
  `).all(cid);

  res.json(rows);
});

// POST /api/customers/:customerId/bills
router.post("/customers/:customerId/bills", (req, res) => {
  const cid = Number(req.params.customerId);
  if (!Number.isInteger(cid)) return res.status(400).json({ error: "Invalid customer id" });

  const customer = db.prepare(
    "SELECT id FROM customers WHERE id = ? AND is_active = 1"
  ).get(cid);
  if (!customer) return res.status(404).json({ error: "Customer not found" });

  const { bill_date, start_time, end_time, usage_minutes, rate_paise_per_hour } = req.body || {};

  if (!isValidDate(bill_date)) return res.status(400).json({ error: "Invalid bill date (YYYY-MM-DD)" });
  if (!isValidTime(start_time)) return res.status(400).json({ error: "Invalid start time (HH:MM)" });
  if (!isValidTime(end_time))   return res.status(400).json({ error: "Invalid end time (HH:MM)" });

  const startMin = toMinutes(start_time);
  const endMin   = toMinutes(end_time);
  if (endMin <= startMin) {
    return res.status(400).json({ error: "End time must be after start time" });
  }

  // usage: prefer manual override if provided & valid, else compute
  let usageMin = endMin - startMin;
  if (usage_minutes !== undefined && usage_minutes !== null && usage_minutes !== "") {
    const n = Number(usage_minutes);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ error: "Usage minutes must be a positive number" });
    }
    usageMin = Math.round(n);
  }

  const rate = Number(rate_paise_per_hour);
  if (!Number.isInteger(rate) || rate < 0) {
    return res.status(400).json({ error: "Rate must be a non-negative integer (paise)" });
  }

  const amount_paise = Math.round((usageMin / 60) * rate);

  // snapshot previous due = current customer due before this bill
  const { due } = db.prepare(`
    SELECT
      (COALESCE((SELECT SUM(amount_paise) FROM bills    WHERE customer_id = ?), 0)
       - COALESCE((SELECT SUM(amount_paise) FROM payments WHERE customer_id = ?), 0)
      ) AS due
  `).get(cid, cid);

  const previous_due_paise = due;
  const total_due_paise    = previous_due_paise + amount_paise;

  const info = db.prepare(`
    INSERT INTO bills
      (customer_id, bill_date, start_time, end_time, usage_minutes,
       rate_paise_per_hour, amount_paise, previous_due_paise, total_due_paise)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    cid, bill_date, start_time, end_time, usageMin,
    rate, amount_paise, previous_due_paise, total_due_paise
  );

  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({ ...bill, allocated_paise: 0 });
});

// GET /api/bills/:id
router.get("/bills/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });

  const bill = db.prepare(`
    SELECT b.*,
      COALESCE((SELECT SUM(amount_paise) FROM payment_allocations WHERE bill_id = b.id), 0) AS allocated_paise
    FROM bills b WHERE b.id = ?
  `).get(id);
  if (!bill) return res.status(404).json({ error: "Bill not found" });

  res.json(bill);
});

// ---------- helpers ----------
function isValidDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
function isValidTime(s) {
  return typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
}
function toMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}


// delete bill payment

// DELETE /api/bills/:id
// Only allowed if no payments have been allocated to this bill.
router.delete("/bills/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });

  const bill = db.prepare("SELECT * FROM bills WHERE id = ?").get(id);
  if (!bill) return res.status(404).json({ error: "Bill not found" });

  const allocated = db.prepare(
    "SELECT COALESCE(SUM(amount_paise),0) AS s FROM payment_allocations WHERE bill_id = ?"
  ).get(id).s;

  if (allocated > 0) {
    return res.status(409).json({
      error: "This bill has payments applied to it and cannot be deleted. " +
             "Reverse or reassign the payment first."
    });
  }

  db.prepare("DELETE FROM bills WHERE id = ?").run(id);
  res.json({ ok: true });
});

module.exports = router;