// Money stored as paise (integer). Display as INR.
function formatINR(paise) {
  const rupees = (Number(paise) || 0) / 100;
  return "₹" + rupees.toLocaleString("en-IN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(input) {
  if (!input) return "";
  // "YYYY-MM-DD" → safe local date; ISO timestamp → parse
  const d = typeof input === "string" && input.length === 10
    ? new Date(input + "T00:00:00")
    : new Date(input);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatDateTime(input) {
  if (!input) return "";
  return new Date(input).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}


// whatsapp message formatting

function splitHM(totalMinutes) {
  const m = Math.max(0, Math.round(Number(totalMinutes) || 0));
  return { h: Math.floor(m / 60), m: m % 60 };
}

function formatUsageHours(minutes) {
  const { h, m } = splitHM(minutes);
  const hPart = h > 0 ? `${h} hour${h === 1 ? "" : "s"}` : "";
  const mPart = m > 0 ? `${m} minute${m === 1 ? "" : "s"}` : "";
  if (hPart && mPart) return `${hPart} ${mPart}`;
  if (hPart) return hPart;
  if (mPart) return mPart;
  return "0 minutes";
}

function formatUsageShort(minutes) {
  const { h, m } = splitHM(minutes);
  if (h && m) return `${h}h ${m}m`;
  if (h)      return `${h}h`;
  if (m)      return `${m}m`;
  return "0m";
}

function formatTime12(hhmm) {
  if (!hhmm || typeof hhmm !== "string") return "";
  const [hStr, mStr] = hhmm.split(":");
  let h = Number(hStr);
  const m = mStr || "00";
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

window.splitHM = splitHM;
window.formatUsageHours = formatUsageHours;
window.formatUsageShort = formatUsageShort;
window.formatTime12 = formatTime12;
