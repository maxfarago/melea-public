// ============================================================
// clerk headless bootstrap
//
// clerk is the source of truth. everything is derived from the publishable
// key served by /api/config, so swapping the key in env (and restarting)
// repoints the browser — no code or asset changes.
// ============================================================

let _clerk = null;
let _clerkReady = null;
let _signInMounted = false;
let _onSignedIn = null;
let _onAuthChange = null;
let _hadUser = false;

function onClerkAuthChange(fn) {
  _onAuthChange = fn;
}

// pk_test_<base64> / pk_live_<base64> encode "<frontend-api-host>$".
function _frontendApiFromKey(pk) {
  const enc = (pk || "").split("_").slice(2).join("_");
  if (!enc) throw new Error("missing clerk publishable key");
  return atob(enc).replace(/\$+$/, "");
}

function _loadClerkScript(src, key) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.crossOrigin = "anonymous";
    s.setAttribute("data-clerk-publishable-key", key);
    s.addEventListener("load", () => resolve());
    s.addEventListener("error", () =>
      reject(new Error("failed to load clerk.js")),
    );
    document.head.appendChild(s);
  });
}

function _cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return v || fallback;
}

function clerkSignInAppearance() {
  // overlay is always light — hardcode light palette so the embedded widget
  // matches our card regardless of the app's dark/light theme setting.
  const accentDim = _cssVar("--accent-dim", "#1e5fa8");
  return {
    variables: {
      colorBackground: "#ffffff",
      colorForeground: "#1c1917",
      colorMutedForeground: "#6b7280",
      colorPrimary: accentDim,
      colorPrimaryForeground: "#ffffff",
      colorInput: "#fdfcf8",
      colorInputForeground: "#1c1917",
      colorBorder: "#e7e4db",
      colorDanger: _cssVar("--bad", "#e87878"),
      borderRadius: "10px",
    },
    elements: {
      // strip clerk's own card so it sits flush inside our wrapper card
      card: {
        boxShadow: "none",
        border: "none",
        background: "transparent",
        padding: "0",
      },
      cardBox: { boxShadow: "none", border: "none" },
      otpCodeFieldInput: {
        border: "1px solid #e7e4db",
        background: "#fdfcf8",
        borderRadius: "12px",
        color: "#1c1917",
      },
      otpCodeFieldInputs: {
        gap: "8px",
      },
      // hide "don't have an account?" and dev-mode badge
      footer: { display: "none" },
      badge: { display: "none" },
      socialButtonsBlockButton: { overflow: "visible" },
      formButtonPrimary: { overflow: "visible" },
    },
    layout: {
      socialButtonsVariant: "blockButton",
    },
  };
}

function appLocationSuffix() {
  const path = window.location.pathname + window.location.search;
  const hash = window.location.hash;
  if (hash && hash.startsWith("#/")) return path;
  return path + hash;
}

function clerkAuthReturnUrl() {
  return (
    window.location.origin +
    window.location.pathname +
    window.location.search
  );
}

function clearClerkAuthHash() {
  const hash = window.location.hash;
  if (!hash || !hash.startsWith("#/")) return;
  history.replaceState(
    history.state,
    "",
    window.location.pathname + window.location.search,
  );
}

function mountClerkSignIn() {
  const clerk = getClerk();
  const node = document.getElementById("clerk-sign-in");
  if (!clerk || !node) return;
  if (_signInMounted) return;
  node.innerHTML = "";
  const returnUrl = clerkAuthReturnUrl();
  clerk.mountSignIn(node, {
    appearance: clerkSignInAppearance(),
    withSignUp: true,
    afterSignInUrl: returnUrl,
    afterSignUpUrl: returnUrl,
    localization: {
      socialButtonsBlockButton: "Continue with {{provider|titleize}}",
    },
  });
  _signInMounted = true;
}

function unmountClerkSignIn() {
  const clerk = getClerk();
  const node = document.getElementById("clerk-sign-in");
  if (!clerk || !node || !_signInMounted) return;
  try {
    clerk.unmountSignIn(node);
  } catch (_) {}
  node.innerHTML = "";
  _signInMounted = false;
  clearClerkAuthHash();
}

function onClerkSignedIn(fn) {
  _onSignedIn = fn;
}

async function bootstrapClerk() {
  if (_clerkReady) return _clerkReady;
  _clerkReady = (async () => {
    const resp = await fetch((window.API_BASE || "") + "/api/config", {
      credentials: "same-origin",
    });
    const cfg = await resp.json();
    const key = cfg && cfg.clerk_publishable_key;
    if (!key) throw new Error("clerk publishable key not configured");
    const host = _frontendApiFromKey(key);
    await _loadClerkScript(
      `https://${host}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`,
      key,
    );
    _clerk = window.Clerk;
    await _clerk.load({});
    _hadUser = !!_clerk.user;
    if (_clerk.user) clearClerkAuthHash();
    _clerk.addListener(({ user }) => {
      const signedIn = !!user;
      if (typeof _onAuthChange === "function") _onAuthChange(signedIn);
      if (signedIn && !_hadUser && typeof _onSignedIn === "function") {
        _onSignedIn();
      }
      _hadUser = signedIn;
    });
    try {
      const fromRedirect = /__clerk|handshake|\/sso-callback/.test(
        window.location.search + window.location.hash,
      );
      if (!_clerk.user && fromRedirect) {
        await _clerk.handleRedirectCallback({});
      }
    } catch (_) {}
    return _clerk;
  })();
  return _clerkReady;
}

function getClerk() {
  return _clerk;
}

async function clerkToken() {
  try {
    if (_clerk?.session) {
      return await _clerk.session.getToken();
    }
  } catch (_) {}
  return null;
}

const AUTH_RETURN_KEY = "melea_auth_return";

let _pendingAuthIntent = null;
let _authReturnPath = null;

function setAuthReturnContext(opts = {}) {
  if (Object.prototype.hasOwnProperty.call(opts, "intent")) {
    _pendingAuthIntent = opts.intent;
  }
  if (opts.path) _authReturnPath = opts.path;
}

function clearAuthReturnContext() {
  _pendingAuthIntent = null;
  _authReturnPath = null;
}

function captureAuthReturnPath() {
  return _authReturnPath || appLocationSuffix();
}

function ensureAuthReturnPath() {
  if (!_authReturnPath) {
    _authReturnPath = appLocationSuffix();
  }
}

function captureAuthShellState() {
  const mobile = window.location.pathname.startsWith("/m");
  const payload = {
    v: 1,
    path: captureAuthReturnPath(),
    shell: mobile ? "mobile" : "desktop",
  };
  if (mobile && typeof state === "object" && state) {
    if (state.activeTab) payload.mobileTab = state.activeTab;
    if (state.contentStudioMode) {
      payload.contentStudioMode = state.contentStudioMode;
    }
  }
  return payload;
}

function stashAuthReturn() {
  if (!_pendingAuthIntent) return null;
  const payload = captureAuthShellState();
  payload.intent = _pendingAuthIntent;
  try {
    sessionStorage.setItem(AUTH_RETURN_KEY, JSON.stringify(payload));
  } catch (_) {
    return null;
  }
  return payload.path;
}

function peekAuthReturn() {
  try {
    const raw = sessionStorage.getItem(AUTH_RETURN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data.v !== 1) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function consumeAuthReturn() {
  const data = peekAuthReturn();
  try {
    sessionStorage.removeItem(AUTH_RETURN_KEY);
  } catch (_) {}
  return data;
}

const DEFAULT_AUTH_HEADLINE = "Your situational marketing engine.";
const DEFAULT_AUTH_BODY =
  "melea drops your brand into the trends your target audience follows — driving engagement and revenue.";

function setAuthHeadline(el, headline) {
  const bodyEl = document.getElementById("auth-body");
  if (!el) return;
  if (headline) {
    el.textContent = headline;
    if (bodyEl) bodyEl.hidden = true;
    return;
  }
  if (bodyEl) {
    bodyEl.hidden = false;
    bodyEl.textContent = DEFAULT_AUTH_BODY;
  }
  el.replaceChildren();
  const span = document.createElement("span");
  span.className = "auth-headline-line";
  span.textContent = DEFAULT_AUTH_HEADLINE;
  el.appendChild(span);
}
