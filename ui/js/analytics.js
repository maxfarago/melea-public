// ============================================================
// google analytics 4 (env-driven via /api/config)
// ============================================================

let _gaId = null;
let _gaReady = false;

function analyticsLocalhost() {
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

async function initAnalytics() {
  if (_gaReady || analyticsLocalhost()) return;
  try {
    const resp = await fetch((window.API_BASE || "") + "/api/config", {
      credentials: "same-origin",
    });
    const cfg = await resp.json();
    const id = String(cfg?.ga_measurement_id || "").trim();
    if (!id) return;
    _gaId = id;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.async = true;
      script.src =
        "https://www.googletagmanager.com/gtag/js?id=" +
        encodeURIComponent(id);
      script.addEventListener("load", () => resolve());
      script.addEventListener("error", () =>
        reject(new Error("failed to load gtag.js")),
      );
      document.head.appendChild(script);
    });
    window.dataLayer = window.dataLayer || [];
    function gtag() {
      window.dataLayer.push(arguments);
    }
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("config", id, { send_page_view: false });
    _gaReady = true;
  } catch (_) {}
}

function trackPageView(pagePath, params) {
  if (!_gaReady || !window.gtag || !_gaId) return;
  const path = pagePath || window.location.pathname;
  window.gtag("event", "page_view", {
    page_path: path,
    page_location: window.location.origin + path,
    ...(params || {}),
  });
}

function trackEvent(name, params) {
  if (!_gaReady || !window.gtag) return;
  window.gtag("event", name, params || {});
}

function setAnalyticsUserId(userId) {
  if (!_gaReady || !window.gtag || !_gaId) return;
  window.gtag("config", _gaId, {
    user_id: userId || undefined,
  });
}
