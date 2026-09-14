const settingsCache = {
  data: null,
  async load() {
    if (this.data) return this.data;
    try {
      this.data = await api.get("/api/settings");
    } catch (_) {
      this.data = {};
    }
    return this.data;
  },
  clear() { this.data = null; },
};

window.settingsCache = settingsCache;