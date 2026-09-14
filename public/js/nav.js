(function () {
  const items = [
    { href: "/",                     label: "Dashboard",     key: "dashboard" },
    { href: "/customers.html",       label: "Customers",     key: "customers" },
    { href: "/add-customer.html",    label: "Add Customer",  key: "add-customer" },
    { href: "/total-due.html",       label: "Total Due",     key: "total-due" },
    { href: "/billing-history.html", label: "History",       key: "billing-history" },
    { href: "/payments.html",        label: "Payments",      key: "payments" },
    { href: "/settings.html",        label: "Settings",      key: "settings" },
  ];

  window.renderNav = function (active) {
    const linksHTML = items.map(it =>
      `<a href="${it.href}" data-key="${it.key}" class="${it.key === active ? "active" : ""}">${it.label}</a>`
    ).join("");

    const html = `
      <div class="topbar">
        <div class="topbar-inner">
          <div class="brand" id="brandName">Tubewell Billing</div>
          <button id="logoutBtn" class="secondary">Logout</button>
        </div>
        <nav class="nav-links">${linksHTML}</nav>
      </div>
    `;

    document.body.insertAdjacentHTML("afterbegin", html);

    document.getElementById("logoutBtn").addEventListener("click", async () => {
      try { await fetch("/api/auth/logout", { method: "POST" }); } catch (_) {}
      settingsCache && settingsCache.clear && settingsCache.clear();
      window.location.href = "/login.html";
    });

    // Load business name into the topbar
    if (window.settingsCache) {
      settingsCache.load().then(s => {
        const el = document.getElementById("brandName");
        if (el && s && s.business_name) el.textContent = s.business_name;
      });
    }
  };
})();