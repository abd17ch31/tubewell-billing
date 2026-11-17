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

function openSMS(mobile, message) {
  const phone = normalizeMobileForWA(mobile);
  if (!phone) { alert("Customer has no valid mobile number."); return; }
  const separator = /iPad|iPhone|iPod/.test(navigator.userAgent) ? "&" : "?";
  window.location.href = `sms:${phone}${separator}body=${encodeURIComponent(message)}`;
}

function buildBillMessage(customer, bill) {
  const usageHours = formatUsageHours(bill.usage_minutes);
  const date = formatDateLong(bill.bill_date);

  const s = (window.settingsCache && settingsCache.data) || {};
  const footer = s.receipt_footer || "Thank you.";

  const todayBill   = Number(bill.amount_paise) || 0;
  const totalDue    = Number(customer.due_paise) || 0;   // live, includes all notebook dues
  const previousDue = totalDue - todayBill;

  return `Hello ${customer.name} ji,
Your tubewell bill details:
Previous Due: ${formatINR(previousDue)}
Date: ${date}
Tubewell Usage: ${usageHours}
Today Bill: ${formatINR(todayBill)}
Total Due: ${formatINR(totalDue)}

${footer}`;
}

window.buildBillMessage = buildBillMessage;

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
window.openSMS = openSMS;
window.buildBillMessage = buildBillMessage;
window.buildPaymentMessage = buildPaymentMessage;