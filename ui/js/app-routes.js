// ============================================================
// shallow /app/* routes (history api)
// ============================================================

const APP_ROUTES = {
  home: "/app/home",
  content: "/app/content",
  distribute: "/app/distribute",
  login: "/app/login",
};

let _applyingRoute = false;

function isAppShellPath() {
  const path = window.location.pathname;
  return path === "/app" || path.startsWith("/app/");
}

function parseAppRoute() {
  const path = window.location.pathname;
  if (path === APP_ROUTES.home || path === "/app") return "home";
  if (path === APP_ROUTES.content) return "content";
  if (path === APP_ROUTES.distribute) return "distribute";
  if (path === APP_ROUTES.login) return "login";
  return null;
}

function appRoutePath(name) {
  return APP_ROUTES[name] || APP_ROUTES.home;
}

function currentAppRouteFromState() {
  const overlay = $("login-overlay");
  if (overlay && !overlay.classList.contains("hidden")) return "login";
  if (brandHomeViewMode === "content-generation") {
    const campaign = contentDesktopSelectedCampaignId
      ? findSitmarCampaignById(contentDesktopSelectedCampaignId)
      : null;
    const status = String(campaign?.status || "").toLowerCase();
    if (
      status === "posted" ||
      document.querySelector(".sitmar-distribute-shell")
    ) {
      return "distribute";
    }
    return "content";
  }
  return "home";
}

function syncAppRouteFromState() {
  if (_applyingRoute || !isAppShellPath()) return;
  const path = appRoutePath(currentAppRouteFromState());
  if (window.location.pathname === path) return;
  navigateAppRoute(path, { replace: true, skipApply: true });
  trackPageView(path);
}

function navigateAppRoute(path, opts) {
  if (!isAppShellPath()) return;
  if (opts?.replace) {
    history.replaceState({ appRoute: path }, "", path);
  } else {
    history.pushState({ appRoute: path }, "", path);
  }
  if (!opts?.skipApply) {
    void applyAppRouteFromPath(path);
  } else if (!opts?.skipTrack) {
    trackPageView(path);
  }
}

async function openDistributeRouteView(company) {
  if (typeof loadSitmar === "function") await loadSitmar();
  let campaign = contentDesktopSelectedCampaignId
    ? findSitmarCampaignById(contentDesktopSelectedCampaignId)
    : null;
  if (!campaign || String(campaign.status || "").toLowerCase() !== "posted") {
    campaign =
      sitmarCampaigns.find(
        (row) =>
          String(row.company_id || "") === String(company.id) &&
          String(row.status || "").toLowerCase() === "posted",
      ) || null;
  }
  if (!campaign) {
    navigateAppRoute(APP_ROUTES.content, { replace: true });
    return;
  }
  contentDesktopSelectedCampaignId = campaign.id;
  contentDesktopDetailCampaign = null;
  if (brandHomeViewMode !== "content-generation") {
    enterContentGeneration(campaign.story_id || "", null);
  } else if (!renderBrandHomeContentColOnly(company)) {
    renderBrandDetail(company);
  }
  await fetchContentCampaignDetail(campaign.id);
}

async function applyAppRouteFromPath(path) {
  _applyingRoute = true;
  try {
    if (path === APP_ROUTES.login) {
      if (await checkAuth()) {
        const resumed =
          typeof resumeAfterAuth === "function" ? await resumeAfterAuth() : false;
        if (!resumed) navigateAppRoute(APP_ROUTES.home, { replace: true });
        return;
      }
      if (currentView !== "brands") await switchView("brands");
      showSignInPrompt();
      trackPageView(path);
      return;
    }

    if (path === APP_ROUTES.home) {
      if (currentView !== "brands") await switchView("brands");
      const company = companies.find((row) => row.id === selectedBrandId);
      if (brandHomeViewMode === "content-generation" && company) {
        exitContentGeneration(company);
      }
      trackPageView(path);
      return;
    }

    if (path === APP_ROUTES.content) {
      if (currentView !== "brands") await switchView("brands");
      const company = companies.find((row) => row.id === selectedBrandId);
      if (!company) {
        navigateAppRoute(APP_ROUTES.home, {
          replace: true,
          skipApply: true,
          skipTrack: true,
        });
        return;
      }
      if (brandHomeViewMode !== "content-generation") {
        enterContentGeneration("", null);
      }
      trackPageView(path);
      return;
    }

    if (path === APP_ROUTES.distribute) {
      if (currentView !== "brands") await switchView("brands");
      const company = companies.find((row) => row.id === selectedBrandId);
      if (!company) {
        navigateAppRoute(APP_ROUTES.home, {
          replace: true,
          skipApply: true,
          skipTrack: true,
        });
        return;
      }
      await openDistributeRouteView(company);
      trackPageView(path);
    }
  } finally {
    _applyingRoute = false;
  }
}

async function applyAppRouteFromLocation() {
  const path = window.location.pathname;
  if (path === "/app") {
    navigateAppRoute(APP_ROUTES.home, { replace: true });
    return;
  }
  if (!parseAppRoute()) {
    navigateAppRoute(APP_ROUTES.home, { replace: true });
    return;
  }
  await applyAppRouteFromPath(path);
}

function initAppRoutes() {
  if (!isAppShellPath()) return;
  window.addEventListener("popstate", () => {
    // clerk uses hash routes like #/factor-one; let their hashchange handler deal with it
    if (window.location.hash.startsWith("#/")) return;
    void applyAppRouteFromPath(window.location.pathname);
  });
}

function resetAppRouteToHome() {
  if (!isAppShellPath()) return;
  navigateAppRoute(APP_ROUTES.home, {
    replace: true,
    skipApply: true,
    skipTrack: true,
  });
}
