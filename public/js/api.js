const api = {
  async request(method, url, body) {
    const opts = {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
    };
    if (body !== undefined) opts.body = JSON.stringify(body);

    const res = await fetch(url, opts);
    if (res.status === 401) {
      window.location.href = "/login.html";
      throw new Error("Not authenticated");
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  },
  get(url)        { return this.request("GET", url); },
  post(url, body) { return this.request("POST", url, body); },
  put(url, body)  { return this.request("PUT", url, body); },
  del(url)        { return this.request("DELETE", url); },
};

window.api = api;