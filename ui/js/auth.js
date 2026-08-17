// ============================================================
// auth + login
// ============================================================

let _pendingSignInResolve = null;
let currentUserPlan = null;
let currentSubscriptionStatus = null;

async function checkAuth() {
  const clerk = getClerk();
  return !!(clerk && clerk.user);
}

function hideSignInOverlay() {
  $("login-overlay").classList.add("hidden");
}

function teardownSignInOverlay() {
  unmountClerkSignIn();
  $("login-overlay").classList.add("hidden");
}

function showSignInPrompt(headline) {
  ensureAuthReturnPath();
  const headlineEl = $("auth-headline");
  if (headlineEl) setAuthHeadline(headlineEl, headline);
  $("login-overlay").classList.remove("hidden");
  $("app").classList.remove("hidden");
  syncAppRouteFromState();
  mountClerkSignIn();
  const clerkNode = $("clerk-sign-in");
  if (clerkNode) clerkNode.focus();
}

function dismissSignInPrompt() {
  const overlay = $("login-overlay");
  if (!overlay || overlay.classList.contains("hidden")) return;
  hideSignInOverlay();
  clearClerkAuthHash();
  $("app").classList.remove("hidden");
  completeSignInPrompt(false);
  if (isAppShellPath() && window.location.pathname === APP_ROUTES.login) {
    navigateAppRoute(APP_ROUTES.home, { replace: true });
  }
}

function installSignInOverlayBehavior() {
  const overlay = $("login-overlay");
  if (!overlay) return;
  overlay.addEventListener("click", (e) => {
    if (e.target !== overlay) return;
    dismissSignInPrompt();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (overlay.classList.contains("hidden")) return;
    e.preventDefault();
    dismissSignInPrompt();
  });
}

async function openAppbarSignIn() {
  try {
    await bootstrapClerk();
  } catch (_) {
    showToast("Sign-in is unavailable right now.");
    return;
  }
  if (await checkAuth()) {
    syncAppbarAuth();
    return;
  }
  showSignInPrompt();
}

function shouldShowAppbarAuth() {
  if (currentView !== "brands") return true;
  let company = null;
  if (selectedBrandId) {
    company = companies.find((c) => c.id === selectedBrandId) || null;
  } else if (typeof preBrandInProgressCompany === "function") {
    company = preBrandInProgressCompany() || null;
  }
  if (!company && typeof emptyHomeCompany === "function") {
    company = emptyHomeCompany();
  }
  return typeof brandHomeChatPhase === "function"
    ? brandHomeChatPhase(company) === "ready"
    : true;
}

function clerkUserEmail(clerk) {
  const user = clerk && clerk.user;
  if (!user) return "";
  const primary = user.primaryEmailAddress;
  if (primary && primary.emailAddress) return String(primary.emailAddress);
  const addresses = Array.isArray(user.emailAddresses) ? user.emailAddresses : [];
  for (const entry of addresses) {
    const email = entry && entry.emailAddress;
    if (email) return String(email);
  }
  return "";
}

function subscribedPlanInfo() {
  const status = String(currentSubscriptionStatus || "")
    .trim()
    .toLowerCase();
  if (!["active", "trialing", "past_due"].includes(status)) return null;
  const plan = String(currentUserPlan || "")
    .trim()
    .toLowerCase();
  if (plan === "grow" || plan === "pro") return { key: "grow", label: "Grow" };
  if (plan === "rise" || plan === "starter")
    return { key: "rise", label: "Rise" };
  return null;
}

let _appbarUserMenuOpen = false;

function closeAppbarUserMenu() {
  _appbarUserMenuOpen = false;
  const trigger = $("appbar-user-trigger");
  const dropdown = $("appbar-user-dropdown");
  if (trigger) trigger.setAttribute("aria-expanded", "false");
  if (dropdown) dropdown.classList.add("hidden");
}

function toggleAppbarUserMenu() {
  const dropdown = $("appbar-user-dropdown");
  const trigger = $("appbar-user-trigger");
  if (!dropdown || !trigger) return;
  _appbarUserMenuOpen = !_appbarUserMenuOpen;
  trigger.setAttribute("aria-expanded", _appbarUserMenuOpen ? "true" : "false");
  dropdown.classList.toggle("hidden", !_appbarUserMenuOpen);
}

function syncAppbarUserEmail() {
  const emailEl = $("appbar-user-email");
  if (!emailEl) return;
  const clerk = getClerk();
  const email = clerkUserEmail(clerk);
  setText(emailEl, email || "Signed in");
  const planRow = $("appbar-user-plan");
  const planBadge = $("appbar-user-plan-badge");
  const planUpgrade = $("appbar-user-plan-upgrade");
  if (!planRow || !planBadge || !planUpgrade) return;
  const planInfo = subscribedPlanInfo();
  if (!planInfo) {
    planRow.classList.add("hidden");
    planUpgrade.classList.add("hidden");
    planBadge.classList.remove("is-rise", "is-grow");
    setText(planBadge, "");
    return;
  }
  planRow.classList.remove("hidden");
  planBadge.classList.toggle("is-rise", planInfo.key === "rise");
  planBadge.classList.toggle("is-grow", planInfo.key === "grow");
  setText(planBadge, planInfo.label);
  planUpgrade.classList.toggle("hidden", planInfo.key !== "rise");
}

function wireAppbarUserMenu() {
  const menu = $("appbar-user-menu");
  const trigger = $("appbar-user-trigger");
  const logoutBtn = $("appbar-logout");
  const planUpgrade = $("appbar-user-plan-upgrade");
  if (!menu || !trigger || menu.dataset.wired === "1") return;
  menu.dataset.wired = "1";
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleAppbarUserMenu();
  });
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      closeAppbarUserMenu();
      void handleLogout();
    });
  }
  if (planUpgrade) {
    planUpgrade.addEventListener("click", (event) => {
      event.preventDefault();
      closeAppbarUserMenu();
      if (typeof openUpgradeModal === "function") openUpgradeModal("grow");
    });
  }
  document.addEventListener("click", (event) => {
    if (!_appbarUserMenuOpen) return;
    if (menu.contains(event.target)) return;
    closeAppbarUserMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAppbarUserMenu();
  });
}

function syncAppbarAuth() {
  const clerk = getClerk();
  const signedIn = !!(clerk && clerk.user);
  const showLogin = shouldShowAppbarAuth();
  const loginBtn = $("appbar-login");
  const userMenu = $("appbar-user-menu");
  const logoutBtn = $("appbar-logout");
  if (loginBtn) loginBtn.classList.toggle("hidden", !showLogin || signedIn);
  if (userMenu) {
    userMenu.classList.toggle("hidden", !signedIn);
    if (signedIn) syncAppbarUserEmail();
    else closeAppbarUserMenu();
  } else if (logoutBtn) {
    logoutBtn.classList.toggle("hidden", !signedIn);
  }
  if (typeof syncUpgradeChrome === "function") syncUpgradeChrome();
}

function completeSignInPrompt(signedIn) {
  if (signedIn) teardownSignInOverlay();
  syncAppbarAuth();
  const resolve = _pendingSignInResolve;
  _pendingSignInResolve = null;
  if (!signedIn) clearAuthReturnContext();
  if (resolve) resolve(!!signedIn);
}

async function requireSignIn(opts) {
  try {
    await bootstrapClerk();
  } catch (_) {
    showToast("Sign-in is unavailable right now.");
    return false;
  }
  if (await checkAuth()) return true;
  setAuthReturnContext({
    intent: opts?.intent ?? null,
    path: appLocationSuffix(),
  });
  showSignInPrompt(opts?.headline);
  return new Promise((resolve) => {
    _pendingSignInResolve = resolve;
  });
}

function showLogin() {
  // regwall is deferred to requireSignIn() at content-creation entry points
}

async function resolveBrandId() {
  const clerk = getClerk();
  if (clerk && clerk.user) {
    const { ok, body } = await api("/api/me", { method: "GET" });
    if (ok && body) {
      currentUserPlan = body.plan || null;
      currentSubscriptionStatus = body.subscription_status || null;
      if (body.company_id) {
        setStoredCompanyId(body.company_id);
        return String(body.company_id);
      }
    }
    const pending = storedCompanyId();
    const { ok: claimOk, body: claimBody } = await api("/api/me/claim", {
      method: "POST",
      body: { company_id: pending || "" },
    });
    if (claimOk && claimBody && claimBody.company_id) {
      setStoredCompanyId(claimBody.company_id);
      return String(claimBody.company_id);
    }
    return pending || null;
  }
  const stored = storedCompanyId();
  return stored ? String(stored) : null;
}

function syncBrandsHeaderAdd() {
  const sidebarAdd = $("sidebar-header-add");
  if (!sidebarAdd) return;
  const show = ADD_BUTTON_VIEWS.has(currentView);
  sidebarAdd.classList.toggle("hidden", !show);
  if (currentView === "sitmar") {
    sidebarAdd.title = "New campaign";
    sidebarAdd.setAttribute("aria-label", "New campaign");
  } else if (ADD_BUTTON_VIEWS.has(currentView)) {
    sidebarAdd.title = "Add brand";
    sidebarAdd.setAttribute("aria-label", "Add brand");
  }
}

async function bootCustomerBrand() {
  const companyId = await resolveBrandId();
  if (!companyId) {
    companies = [];
    selectedBrandId = null;
    storiesCustomerBrandId = "";
    contentDesktopBrandId = "";
    renderBrandHomeEmpty();
    return;
  }
  setStoredCompanyId(companyId);
  const { ok, body } = await api(
    `/api/company/${encodeURIComponent(companyId)}`,
    { method: "GET" },
  );
  if (!ok || !body || !body.company) {
    companies = [];
    selectedBrandId = null;
    setStoredCompanyId("");
    renderBrandHomeEmpty();
    return;
  }
  ensureCompanyStages(body.company);
  companies = [body.company];
  storiesCustomerBrandId = companyId;
  contentDesktopBrandId = companyId;
  syncBrandsHeaderAdd();

  if (shouldResumePreBrandOnboarding(body.company)) {
    selectedBrandId = null;
    renderBrandHomeEmpty();
    syncStagePollingFromCompanies();
    return;
  }

  applyStoriesCustomerDefaultSortMode();

  if (selectedBrandId === companyId) {
    syncStagePollingFromCompanies();
    if (!mountedBrandHomeShell(companyId)) {
      selectBrand(companyId);
    } else {
      ensureBrandHomeStoriesLoad(body.company);
    }
    return;
  }

  selectBrand(companyId);
  syncStagePollingFromCompanies();
}

function completePageLoad() {
  const loader = document.getElementById("page-loader");
  if (!loader) {
    if (typeof markBrandHomePageFadeComplete === "function") {
      markBrandHomePageFadeComplete();
    }
    return;
  }
  loader.classList.add("is-fading");
  loader.addEventListener(
    "transitionend",
    (e) => {
      if (e.propertyName !== "opacity") return;
      loader.remove();
      if (typeof markBrandHomePageFadeComplete === "function") {
        markBrandHomePageFadeComplete();
      }
    },
    { once: true },
  );
}

async function showApp() {
  $("app").classList.remove("hidden");
  hideSignInOverlay();
  syncAppbarAuth();
  updateTwitterLayoutState();
  syncStoriesCustomerLayout();
  syncBrandCustomerLayout();
  if (typeof startStatusPolling === "function") startStatusPolling();
  syncBrandsHeaderAdd();
  if (currentView === "twitter") setTwitterSidebarTitle();
  else setText($("sidebar-title"), VIEW_TITLES[currentView] || "Brands");
  updateTrendingControls();
  syncGlobalNavActive();
  if (isAppShellPath()) {
    await bootCustomerBrand();
    syncAppbarAuth();
    await applyAppRouteFromLocation();
    if (await checkAuth()) {
      const resumed =
        typeof resumeAfterAuth === "function" ? await resumeAfterAuth() : false;
      if (!resumed && window.location.pathname === APP_ROUTES.login) {
        navigateAppRoute(APP_ROUTES.home, { replace: true });
      }
    }
  } else {
    await restoreNavFromStorage();
    if (currentView === "brands") {
      await bootCustomerBrand();
      syncAppbarAuth();
    }
  }
  const clerk = getClerk();
  if (clerk?.user?.id) {
    setAnalyticsUserId(String(clerk.user.id));
  }
  completePageLoad();
}

async function restoreNavFromStorage() {
  const saved = loadNavState();
  let target = saved.view;
  if (target === "twitter" || target === "sitmar") target = "brands";
  if (target === "admin-brands") target = "ops-brands";
  if (target && VIEW_TITLES[target] && target !== currentView) {
    await switchView(target);
  }
}

function stopHealthPolling() {
  if (healthPollTimer) clearInterval(healthPollTimer);
  healthPollTimer = null;
}

async function pollHealth() {
  try {
    const { ok, status, body } = await api("/api/health", { method: "GET" });
    const apiEl = $("rail-api");
    if (apiEl) {
      apiEl.className = "rail-status-btn" + (ok ? " running" : " error");
      apiEl.dataset.label =
        "API · " +
        (body && body.version
          ? "v" + body.version
          : ok
            ? "ok"
            : status || "err");
    }
  } catch (_) {}
}

function startHealthPolling(intervalMs) {
  stopHealthPolling();
  healthPollIntervalMs = intervalMs || 15000;
  pollHealth();
  healthPollTimer = setInterval(pollHealth, healthPollIntervalMs);
}


async function handleLogout() {
  trackEvent("logout");
  setAnalyticsUserId(null);
  try {
    const clerk = getClerk();
    if (clerk) await clerk.signOut();
  } catch (_) {}
  teardownSignInOverlay();
  closeTrendFilterModal();
  if (activePollTimer) clearTimeout(activePollTimer);
  stopHealthPolling();
  stopAllStagePolling();
  stopOnboardingPoll();
  currentView = "brands";
  currentTwitterSubview = "news";
  companies = [];
  audiences = [];
  trendsStories = [];
  trendsStoriesOffset = 0;
  trendsStoriesHasMore = true;
  trendsStoriesLoadingMore = false;
  trendStoryDetail = null;
  trendingPosts = [];
  selectedPostId = null;
  selectedBrandId = null;
  selectedAudienceId = null;
  selectedTrendStoryId = null;
  selectedTrendingPostId = null;
  activeTrendAudienceFilters = new Set();
  trendSortMode = "recency";
  trendFilterModalOpen = false;
  selectedRunId = null;
  saveNavState({
    view: null,
    twitterSubview: null,
    brandId: null,
    runId: null,
  });
  hideRunsSidebar();
  postDetail = null;
  resetAppRouteToHome();
  await showApp();
}

const VIEW_TITLES = {
  twitter: "Twitter",
  brands: "Brands",
  "ops-brands": "Brands",
  waitlist: "Waitlist",
  audiences: "Audiences",
  sitmar: "Content",
};

const VIEW_EMPTY = {
  twitter: "Pick a story from the list on the left.",
  brands:
    "Pick a brand from the list on the left, or add one to start homepage crawl.",
  "ops-brands": "Select a brand to view synthesis and pipeline.",
  waitlist: "No waitlist entries yet.",
  audiences: "No audiences yet.",
  sitmar: "Pick a campaign, or add one to react to a story.",
};

const ADD_BUTTON_VIEWS = new Set(["brands", "sitmar", "ops-brands"]);

const TWITTER_SUBVIEW_TITLES = {
  news: "News",
};

function updateTwitterLayoutState() {
  const app = $("app");
  if (!app) return;
  app.classList.toggle("twitter-view", currentView === "twitter");
  app.classList.toggle("audiences-view", currentView === "audiences");
  updateTwitterSidebarWidth();
}

function updateTwitterSidebarWidth() {
  const sidebar = document.querySelector("aside.sidebar");
  if (!sidebar) return;
  if (
    currentView !== "audiences" ||
    window.matchMedia("(max-width: 700px)").matches
  ) {
    sidebar.style.removeProperty("width");
    return;
  }
  sidebar.style.removeProperty("width");
  const baseWidth = parseFloat(getComputedStyle(sidebar).width);
  if (!Number.isFinite(baseWidth) || baseWidth <= 0) return;
  sidebar.style.width = `${Math.round(baseWidth * 1.5)}px`;
}

function showToast(msg) {
  let container = $("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  setText(toast, msg);
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("toast-visible"));
  setTimeout(() => {
    toast.classList.remove("toast-visible");
    toast.addEventListener("transitionend", () => toast.remove(), {
      once: true,
    });
  }, 2000);
}
