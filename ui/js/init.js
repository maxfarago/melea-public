// ============================================================
// init + global wiring
// ============================================================

async function init() {
  applyTheme("light");
  initAppRoutes();
  await initAnalytics();
  $("global-appbar-nav").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (!btn || !btn.dataset.view) return;
    switchView(btn.dataset.view);
  });
  const twitterSubrail = $("twitter-subrail");
  if (twitterSubrail) {
    twitterSubrail.addEventListener("click", (e) => {
      const btn = e.target.closest(".subrail-btn");
      if (!btn || !btn.dataset.twitterView) return;
      switchTwitterSubview(btn.dataset.twitterView);
    });
  }
  window.addEventListener("resize", updateTwitterSidebarWidth);
  const sidebarList = $("sidebar-list");
  if (sidebarList) {
    sidebarList.addEventListener("scroll", onSidebarListScroll, {
      passive: true,
    });
  }
  const trendFilterBtn = $("sidebar-trend-filter");
  if (trendFilterBtn) {
    trendFilterBtn.addEventListener("click", openTrendFilterModal);
  }
  const trendSortBtn = $("sidebar-trend-sort");
  if (trendSortBtn) {
    trendSortBtn.addEventListener("click", () => {
      trendSortMode = trendSortMode === "posts" ? "recency" : "posts";
      showToast(
        trendSortMode === "posts"
          ? "Sorting by number of posts"
          : "Sorting by recency",
      );
      updateTrendingControls();
      if (currentView === "twitter" && currentTwitterSubview === "news")
        renderNewsSidebar();
    });
  }
  const appbarLogin = $("appbar-login");
  if (appbarLogin) {
    appbarLogin.addEventListener("click", () => {
      void openAppbarSignIn();
    });
  }
  wireAppbarUserMenu();
  const appbarLogout = $("appbar-logout");
  if (appbarLogout && !appbarLogout.closest("#appbar-user-menu")) {
    appbarLogout.addEventListener("click", () => {
      void handleLogout();
    });
  }
  const sidebarHeaderAdd = $("sidebar-header-add");
  if (sidebarHeaderAdd) {
    sidebarHeaderAdd.addEventListener("click", () => {
      if (currentView === "sitmar") return openAddSitmarModal();
      if (currentView !== "brands") return;
      openAddBrandModal();
    });
  }
  const addBrandForm = $("add-brand-form");
  if (addBrandForm)
    addBrandForm.addEventListener("submit", handleAddBrandSubmit);
  const addBrandCancel = $("add-brand-cancel");
  if (addBrandCancel)
    addBrandCancel.addEventListener("click", closeAddBrandModal);
  const addSitmarForm = $("add-sitmar-form");
  if (addSitmarForm)
    addSitmarForm.addEventListener("submit", handleAddSitmarSubmit);
  const addSitmarBack = $("add-sitmar-back");
  if (addSitmarBack) addSitmarBack.addEventListener("click", sitmarStepBack);
  const addSitmarClose = $("add-sitmar-close");
  if (addSitmarClose)
    addSitmarClose.addEventListener("click", closeAddSitmarModal);
  const sitmarStorySortBtn = $("sitmar-story-sort-btn");
  if (sitmarStorySortBtn)
    sitmarStorySortBtn.addEventListener("click", cycleSitmarStorySort);
  const addSitmarModalEl = $("add-sitmar-modal");
  if (addSitmarModalEl)
    installModalBehavior(addSitmarModalEl, closeAddSitmarModal);
  const trendFilterModal = $("trend-filter-modal");
  if (trendFilterModal)
    installModalBehavior(trendFilterModal, closeTrendFilterModal);
  const trendFilterClose = $("trend-filter-close");
  if (trendFilterClose)
    trendFilterClose.addEventListener("click", closeTrendFilterModal);
  const trendFilterClear = $("trend-filter-clear");
  if (trendFilterClear) {
    trendFilterClear.addEventListener("click", () => {
      activeTrendAudienceFilters.clear();
      renderTrendFilterModal();
      updateTrendingControls();
      renderNewsSidebar();
      void ensureSelectedTrendingStoryVisible();
    });
  }
  // view-level escape for non-modal navigation. modal-level escapes are
  // installed below via installModalBehavior.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("login-overlay").classList.contains("hidden")) return;
    if (
      !$("add-brand-modal").classList.contains("hidden") ||
      ($("run-detail-modal") &&
        !$("run-detail-modal").classList.contains("hidden"))
    ) {
      return;
    }
    if (currentView !== "brands") return;
    if (selectedBrandId) closeBrand();
  });
  // shared modal behaviors: click-outside, focus trap, ESC. Installed once at
  // boot; the close callbacks are the same ones the cancel buttons use, so
  // every dismiss path lands in the same place.
  if ($("add-brand-modal")) {
    installModalBehavior($("add-brand-modal"), closeAddBrandModal);
  }
  if ($("run-detail-modal")) {
    installModalBehavior($("run-detail-modal"), closeRun);
    const closeBtn = $("run-detail-modal-close");
    if (closeBtn) closeBtn.addEventListener("click", closeRun);
  }
  installSignInOverlayBehavior();

  try {
    await bootstrapClerk();
    onClerkAuthChange(() => {
      syncAppbarAuth();
    });
    onClerkSignedIn(async () => {
      if (!(await checkAuth())) return;
      completeSignInPrompt(true);
      syncAppbarAuth();
      const clerk = getClerk();
      const userId = clerk?.user?.id ? String(clerk.user.id) : "";
      if (userId) {
        setAnalyticsUserId(userId);
        trackEvent("login");
      }
      if (currentView === "brands") await bootCustomerBrand();
      if (isAppShellPath()) {
        const resumed =
          typeof resumeAfterAuth === "function" ? await resumeAfterAuth() : false;
        if (!resumed && window.location.pathname === APP_ROUTES.login) {
          navigateAppRoute(APP_ROUTES.home, { replace: true });
        }
      }
    });
  } catch (err) {
    console.error("clerk bootstrap failed", err);
  }

  await showApp();
}

init();
