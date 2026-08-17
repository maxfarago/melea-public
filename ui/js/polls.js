// ============================================================
// nav state persistence
// ============================================================

function loadNavState() {
  try {
    return JSON.parse(localStorage.getItem(NAV_STATE_KEY) || "{}") || {};
  } catch (_) {
    return {};
  }
}

function saveNavState(patch) {
  const next = { ...loadNavState(), ...patch };
  for (const key of Object.keys(next)) {
    if (next[key] == null) delete next[key];
  }
  try {
    localStorage.setItem(NAV_STATE_KEY, JSON.stringify(next));
  } catch (_) {}
}
