(function () {
  "use strict";

  function wireSignOut() {
    const btn = document.getElementById("ops-signout");
    if (!btn) return;
    btn.addEventListener("click", async () => {
      try {
        if (window.Clerk && typeof window.Clerk.signOut === "function") {
          await window.Clerk.signOut();
        }
      } catch (_) {}
      window.location.reload();
    });
  }

  async function start() {
    try {
      const ok = await opsBootstrap();
      if (!ok) return;
      wireSignOut();
      const nav = document.getElementById("global-appbar-nav");
      if (nav && !nav.dataset.wired) {
        nav.dataset.wired = "1";
        nav.addEventListener("click", (event) => {
          const button = event.target.closest("[data-view]");
          if (!button || !button.dataset.view) return;
          void switchView(button.dataset.view);
        });
      }
      await switchView("users");
      if (typeof startStatusPolling === "function") startStatusPolling();
      const app = document.getElementById("app");
      if (app) app.classList.remove("hidden");
    } catch (error) {
      renderError(error?.message || "Ops boot failed.");
      return;
    }
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    void start();
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      void start();
    });
  }
})();
