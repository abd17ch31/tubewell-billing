require("dotenv").config();

const express = require("express");
const path = require("path");
const cookieSession = require("cookie-session");

require("./db");
const authRoutes      = require("./auth");
const customerRoutes  = require("./routes/customers");
const billRoutes      = require("./routes/bills");
const paymentRoutes   = require("./routes/payments");
const dashboardRoutes = require("./routes/dashboard");
const settingsRoutes  = require("./routes/settings");
const notebookRoutes  = require("./routes/notebook");

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "..", "public");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cookieSession({
  name: "tb_session",
  keys: [process.env.SESSION_SECRET || "dev_secret_change_me"],
  maxAge: 30 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: "lax",
}));

function authGate(req, res, next) {
  const p = req.path;
  if (p === "/login" || p === "/login.html") return next();
  if (p.startsWith("/css/") || p.startsWith("/js/") || p.startsWith("/assets/")) return next();
  if (p.startsWith("/api/auth/")) return next();
  if (p === "/api/health") return next();

  if (!req.session || !req.session.authed) {
    if (p.startsWith("/api/")) return res.status(401).json({ error: "Not authenticated" });
    return res.redirect("/login.html");
  }
  next();
}
app.use(authGate);

app.use("/api/auth", authRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api", billRoutes);
app.use("/api", paymentRoutes);
app.use("/api", dashboardRoutes);
app.use("/api", settingsRoutes);
app.use("/api", notebookRoutes);


app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.get("/login", (req, res) => res.redirect("/login.html"));

app.use(express.static(PUBLIC_DIR));

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`[server] Running on http://localhost:${PORT}`);
});


