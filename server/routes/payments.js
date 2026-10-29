const express = require("express");
const db = require("../db");

const router = express.Router();

// GET /api/customers/:customerId/payments
router.get("/customers/:customerId/payments", async (req, res) => {
  const cid = Number(req.params.customerId);
  if (!Number.isInteger(cid)) return res.status(400).json({ error: "Invalid customer id" });

  const rows = await db.query(`
    SELECT * FROM payments
    WHERE customer_id = ?
    ORDER BY payment_date DESC, id DESC
  `, [cid]);
  res.json(rows);
});

// POST /api/customers/:customerId/payments
// Records payment + FIFO allocates against unpaid notebook dues first,
// then unpaid bills, atomically.
async function recordPayment(cid, payload) {
  return db.transaction(async (tx) => {
    await tx.query("SELECT id FROM customers WHERE id = ? FOR UPDATE", [cid]);
    const info = await tx.execute(`
      INSERT INTO payments (customer_id, payment_date, amount_paise, mode, note)
      VALUES (?, ?, ?, ?, ?) RETURNING id
    `, [cid, payload.payment_date, payload.amount_paise, payload.mode, payload.note]);

    const paymentId = info.insertId;
    let remaining = payload.amount_paise;

    // ---- 1) Allocate against notebook dues (FIFO: oldest first) ----
    const notebookDues = await tx.query(`
      SELECT n.id, n.amount_paise,
        COALESCE((SELECT SUM(amount_paise) FROM notebook_allocations WHERE notebook_due_id = n.id), 0) AS allocated_paise
      FROM notebook_dues n
      WHERE n.customer_id = ?
      ORDER BY n.due_date ASC, n.id ASC
    `, [cid]);

    for (const due of notebookDues) {
      if (remaining <= 0) break;
      const rowRemaining = due.amount_paise - due.allocated_paise;
      if (rowRemaining <= 0) continue;
      const take = Math.min(remaining, rowRemaining);
      await tx.execute(`
        INSERT INTO notebook_allocations (payment_id, notebook_due_id, amount_paise)
        VALUES (?, ?, ?)
      `, [paymentId, due.id, take]);
      remaining -= take;
    }

    // ---- 2) Allocate remaining against bills (FIFO: oldest first) ----
    const bills = await tx.query(`
      SELECT b.id, b.amount_paise,
        COALESCE((SELECT SUM(amount_paise) FROM payment_allocations WHERE bill_id = b.id), 0) AS allocated_paise
      FROM bills b
      WHERE b.customer_id = ?
      ORDER BY b.bill_date ASC, b.id ASC
    `, [cid]);

    for (const bill of bills) {
      if (remaining <= 0) break;
      const billRemaining = bill.amount_paise - bill.allocated_paise;
      if (billRemaining <= 0) continue;
      const take = Math.min(remaining, billRemaining);
      await tx.execute(`
        INSERT INTO payment_allocations (payment_id, bill_id, amount_paise)
        VALUES (?, ?, ?)
      `, [paymentId, bill.id, take]);
      remaining -= take;
    }

    return paymentId;
  });
}

router.post("/customers/:customerId/payments", async (req, res) => {
  const cid = Number(req.params.customerId);
  if (!Number.isInteger(cid)) return res.status(400).json({ error: "Invalid customer id" });

  const [customer] = await db.query(
    "SELECT id FROM customers WHERE id = ? AND is_active = 1",
    [cid],
  );
  if (!customer) return res.status(404).json({ error: "Customer not found" });

  const { payment_date, amount_paise, mode, note } = req.body || {};

  if (!isValidDate(payment_date)) {
    return res.status(400).json({ error: "Invalid payment date (YYYY-MM-DD)" });
  }
  const amt = Number(amount_paise);
  if (!Number.isInteger(amt) || amt <= 0) {
    return res.status(400).json({ error: "Amount must be a positive integer (paise)" });
  }
  if (mode !== "cash" && mode !== "online") {
    return res.status(400).json({ error: "Mode must be cash or online" });
  }

  const paymentId = await recordPayment(cid, {
    payment_date,
    amount_paise: amt,
    mode,
    note: note ? String(note).trim() : null,
  });

  const [payment] = await db.query("SELECT * FROM payments WHERE id = ?", [paymentId]);
  res.status(201).json(payment);
});

// GET /api/payments/:id
// Also returns due_before and due_after (including notebook dues) so the
// receipt message has correct historical context.
router.get("/payments/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });

  const [payment] = await db.query("SELECT * FROM payments WHERE id = ?", [id]);
  if (!payment) return res.status(404).json({ error: "Payment not found" });

  const cid = payment.customer_id;
  const [{ s: billsSum }] = await db.query("SELECT COALESCE(SUM(amount_paise),0) AS s FROM bills WHERE customer_id = ?", [cid]);
  const [{ s: notebookSum }] = await db.query("SELECT COALESCE(SUM(amount_paise),0) AS s FROM notebook_dues WHERE customer_id = ?", [cid]);
  const [{ s: beforeSum }] = await db.query("SELECT COALESCE(SUM(amount_paise),0) AS s FROM payments WHERE customer_id = ? AND id < ?", [cid, id]);
  const [{ s: uptoSum }] = await db.query("SELECT COALESCE(SUM(amount_paise),0) AS s FROM payments WHERE customer_id = ? AND id <= ?", [cid, id]);
  const totalOwed = billsSum + notebookSum;

  res.json({
    ...payment,
    due_before_paise: totalOwed - beforeSum,
    due_after_paise: totalOwed - uptoSum,
  });
});

// DELETE /api/payments/:id
// Removes the payment and its allocations (CASCADE). Balances recalculate automatically.
router.delete("/payments/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });

  const [payment] = await db.query("SELECT id FROM payments WHERE id = ?", [id]);
  if (!payment) return res.status(404).json({ error: "Payment not found" });

  await db.execute("DELETE FROM payments WHERE id = ?", [id]);
  res.json({ ok: true });
});

function isValidDate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

module.exports = router;
