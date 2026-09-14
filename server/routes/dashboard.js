const express = require("express");
const db = require("../db");

const router = express.Router();

function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// GET /api/dashboard
router.get("/dashboard", (req, res) => {
  const today = todayLocalISO();

  const total_customers = db.prepare(
    "SELECT COUNT(*) AS c FROM customers WHERE is_active = 1"
  ).get().c;

  const total_outstanding_paise = db.prepare(`
    SELECT
            (COALESCE((SELECT SUM(amount_paise) FROM bills), 0)
       + COALESCE((SELECT SUM(amount_paise) FROM notebook_dues), 0)
       - COALESCE((SELECT SUM(amount_paise) FROM payments), 0)) AS s
  `).get().s;

  const today_bills = db.prepare(`
    SELECT COUNT(*) AS c, COALESCE(SUM(amount_paise), 0) AS s
    FROM bills WHERE bill_date = ?
  `).get(today);

  const today_payments = db.prepare(`
    SELECT COUNT(*) AS c, COALESCE(SUM(amount_paise), 0) AS s
    FROM payments WHERE payment_date = ?
  `).get(today);

  const recent_bills = db.prepare(`
    SELECT 'bill' AS type, b.id, b.customer_id,
           c.name AS customer_name,
           b.bill_date AS date, b.amount_paise, b.created_at
    FROM bills b JOIN customers c ON c.id = b.customer_id
    WHERE c.is_active = 1
    ORDER BY b.created_at DESC, b.id DESC
    LIMIT 15
  `).all();

  const recent_payments = db.prepare(`
    SELECT 'payment' AS type, p.id, p.customer_id,
           c.name AS customer_name,
           p.payment_date AS date, p.amount_paise, p.mode, p.created_at
    FROM payments p JOIN customers c ON c.id = p.customer_id
    WHERE c.is_active = 1
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT 15
  `).all();

  const recent = recent_bills
    .concat(recent_payments)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 10);

  const top_defaulters = db.prepare(`
    SELECT c.id, c.name, c.mobile,
          SELECT
      (COALESCE((SELECT SUM(amount_paise) FROM bills    WHERE customer_id = ?), 0)
       + COALESCE((SELECT SUM(amount_paise) FROM notebook_dues WHERE customer_id = ?), 0)
       - COALESCE((SELECT SUM(amount_paise) FROM payments WHERE customer_id = ?), 0)
      ) AS due_paise
    FROM customers c
    WHERE c.is_active = 1
    ORDER BY due_paise DESC
    LIMIT 8
  `).all().filter(r => r.due_paise > 0).slice(0, 5);

  res.json({
    today,
    total_customers,
    total_outstanding_paise,
    today_bills_count: today_bills.c,
    today_bills_paise: today_bills.s,
    today_payments_count: today_payments.c,
    today_payments_paise: today_payments.s,
    recent,
    top_defaulters,
  });
});

// GET /api/all-payments   → global payment feed (for Payments page)
router.get("/all-payments", (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.customer_id, p.payment_date, p.amount_paise, p.mode, p.note,
           c.name AS customer_name, c.mobile AS customer_mobile
    FROM payments p JOIN customers c ON c.id = p.customer_id
    WHERE c.is_active = 1
    ORDER BY p.payment_date DESC, p.id DESC
  `).all();
  res.json(rows);
});

// GET /api/all-transactions   → global bill + payment feed (for Billing History)
router.get("/all-transactions", (req, res) => {
  const bills = db.prepare(`
    SELECT 'bill' AS type, b.id, b.customer_id,
           c.name AS customer_name,
           b.bill_date AS date, b.start_time, b.end_time, b.usage_minutes,
           b.rate_paise_per_hour, b.amount_paise, b.created_at
    FROM bills b JOIN customers c ON c.id = b.customer_id
    WHERE c.is_active = 1
  `).all();

  const payments = db.prepare(`
    SELECT 'payment' AS type, p.id, p.customer_id,
           c.name AS customer_name,
           p.payment_date AS date, p.amount_paise, p.mode, p.note, p.created_at
    FROM payments p JOIN customers c ON c.id = p.customer_id
    WHERE c.is_active = 1
  `).all();

  const all = bills.concat(payments).sort((a, b) => {
    const d = String(b.date).localeCompare(String(a.date));
    if (d !== 0) return d;
    return String(b.created_at).localeCompare(String(a.created_at));
  });

  res.json(all);
});

// GET /api/all-due   → per-customer due, sorted highest first
router.get("/all-due", (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.name, c.mobile, c.address,
      (COALESCE((SELECT SUM(amount_paise) FROM bills    WHERE customer_id = c.id), 0)
       - COALESCE((SELECT SUM(amount_paise) FROM payments WHERE customer_id = c.id), 0)
      ) AS due_paise
    FROM customers c
    WHERE c.is_active = 1
    ORDER BY due_paise DESC, c.name COLLATE NOCASE ASC
  `).all();
  res.json(rows);
});

module.exports = router;