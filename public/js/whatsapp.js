function normalizeMobileForWA(mobile) {
  let d = String(mobile || "").replace(/\D/g, "");
  if (d.length === 10) d = "91" + d;
  return d;
}

function openWhatsApp(mobile, message) {
  const phone = normalizeMobileForWA(mobile);
  if (!phone) { alert("Customer has no valid mobile number."); return; }
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");
}

function buildBillMessage(customer, bill) {
  const usageHours = formatUsageHours(bill.usage_minutes);
  const date = formatDate(bill.bill_date);
  const rate = formatINR(bill.rate_paise_per_hour);

  return `Hello ${customer.name} ji,
Your tubewell bill details:

Previous Due: ${formatINR(bill.previous_due_paise)}
Current Bill: ${formatINR(bill.amount_paise)}
Total Due: ${formatINR(bill.total_due_paise)}

Tubewell Usage: ${usageHours}
Date: ${date}
Rate: ${rate}/hour

Thank you.`;
}

function buildPaymentMessage(customer, payment, previousDuePaise, remainingDuePaise) {
  return `Hello ${customer.name} ji,
Payment received successfully.

Amount Paid: ${formatINR(payment.amount_paise)}
Payment Mode: ${payment.mode === "cash" ? "Cash" : "Online"}
Previous Due: ${formatINR(previousDuePaise)}
Remaining Due: ${formatINR(remainingDuePaise)}
Payment Date: ${formatDate(payment.payment_date)}

Thank you.`;
}

window.normalizeMobileForWA = normalizeMobileForWA;
window.openWhatsApp = openWhatsApp;
window.buildBillMessage = buildBillMessage;
window.buildPaymentMessage = buildPaymentMessage;