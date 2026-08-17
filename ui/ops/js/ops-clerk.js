(function () {
  "use strict";

  function frontendApiFromKey(pk) {
    const encoded = String(pk || "").split("_").slice(2).join("_");
    if (!encoded) throw new Error("missing clerk publishable key");
    return atob(encoded).replace(/\$+$/, "");
  }

  function loadClerkJs(host, key) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://${host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.setAttribute("data-clerk-publishable-key", key);
      script.addEventListener("load", resolve);
      script.addEventListener("error", () => reject(new Error("failed to load clerk")));
      document.head.appendChild(script);
    });
  }

  async function opsBootstrap() {
    const cfgResp = await fetch((window.API_BASE || "") + "/api/config", {
      credentials: "same-origin",
    });
    const cfg = await cfgResp.json();
    const key = String(cfg?.clerk_publishable_key || "").trim();
    if (!key) throw new Error("ops clerk key missing");
    const host = frontendApiFromKey(key);
    await loadClerkJs(host, key);
    await window.Clerk.load({});
    if (!window.Clerk.user) {
      await window.Clerk.redirectToSignIn({ redirectUrl: window.location.href });
      return false;
    }
    return true;
  }

  Object.assign(window, { opsBootstrap });
})();
