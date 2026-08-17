// ============================================================
// view switching + data loaders
// ============================================================

function renderDetailEmpty(view) {
  const v = view || currentView;
  if (v === "twitter") {
    syncStoriesCustomerLayout();
    renderStoriesCustomerView();
    return;
  }
  if (v === "sitmar") {
    renderCampaignsCustomerView();
    return;
  }
  if (v === "brands") {
    if (companies.length > 0) return;
    renderBrandHomeEmpty({ resetSort: true });
    return;
  }
  const root = $("detail");
  root.innerHTML = "";
  const note = document.createElement("div");
  note.className = "empty-state";
  const message = document.createElement("div");
  setText(message, VIEW_EMPTY[v] || VIEW_EMPTY.twitter);
  note.appendChild(message);
  if (v === "sitmar" && sitmarCampaigns.length === 0) {
    const cta = document.createElement("button");
    cta.type = "button";
    cta.style.marginTop = "16px";
    setText(cta, "+ New campaign");
    cta.addEventListener("click", openAddSitmarModal);
    note.appendChild(cta);
  }
  root.appendChild(note);
}

function renderError(msg) {
  const root = $("detail");
  root.innerHTML = "";
  const el = document.createElement("div");
  el.className = "error-banner";
  setText(el, msg);
  root.appendChild(el);
}

function hideRunsSidebar() {
  const aside = $("runs-sidebar");
  if (!aside) return;
  aside.classList.add("hidden");
  selectedRunId = null;
  delete aside.dataset.companyId;
  const body = $("runs-sidebar-body");
  if (body) body.innerHTML = "";
}

function stopRunDetailPolling() {}

function syncGlobalNavActive(view = currentView) {
  document.querySelectorAll("#global-appbar-nav [data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
}

async function switchView(view) {
  if (!VIEW_TITLES[view] || view === currentView) return;
  if (view !== "twitter") closeTrendFilterModal();
  currentView = view;
  if (view !== "brands") resetAppRouteToHome();
  saveNavState({ view });
  updateTwitterLayoutState();
  syncStoriesCustomerLayout();
  syncBrandCustomerLayout();
  syncContentDesktopLayout();

  syncGlobalNavActive(view);
  if (view !== "twitter") setText($("sidebar-title"), VIEW_TITLES[view]);
  updateTrendingControls();
  syncBrandsHeaderAdd();
  $("sidebar-list").innerHTML = "";
  if (view !== "brands") {
    renderDetailEmpty(view);
  }
  if (view !== "brands" && view !== "ops-brands") {
    hideRunsSidebar();
    stopRunDetailPolling();
  }

  if (view === "brands") {
    selectedBrandId = null;
    await bootCustomerBrand();
  } else if (view === "waitlist") {
    if (
      typeof loadWaitlist !== "function" ||
      typeof renderWaitlistSidebar !== "function" ||
      typeof renderWaitlistDetail !== "function"
    ) {
      await switchView("brands");
      return;
    }
    await loadWaitlist();
    renderWaitlistSidebar();
    renderWaitlistDetail();
  } else if (view === "audiences") {
    if (
      typeof loadAudiences !== "function" ||
      typeof renderAudiencesSidebar !== "function" ||
      typeof selectAudience !== "function"
    ) {
      await switchView("brands");
      return;
    }
    selectedAudienceId = null;
    await loadAudiences();
    renderAudiencesSidebar();
    if (audiences.length > 0) {
      await selectAudience(audiences[0].id);
    } else {
      renderDetailEmpty("audiences");
    }
  } else if (view === "ops-brands") {
    if (
      typeof loadOpsCompanies !== "function" ||
      typeof renderOpsBrandsView !== "function"
    ) {
      await switchView("brands");
      return;
    }
    await loadOpsCompanies();
    renderOpsBrandsView();
  }
  if (typeof syncAppbarAuth === "function") syncAppbarAuth();
}

function setTwitterSidebarTitle() {
  setText($("sidebar-title"), "Trending News");
}

function updateTrendingControls() {
  const filterBtn = $("sidebar-trend-filter");
  const sortBtn = $("sidebar-trend-sort");
  if (!filterBtn || !sortBtn) return;
  const showControls =
    currentView === "twitter" && currentTwitterSubview === "news";
  filterBtn.classList.toggle("hidden", !showControls);
  filterBtn.classList.toggle(
    "active",
    trendFilterModalOpen || activeTrendAudienceFilters.size > 0,
  );
  filterBtn.title = activeTrendAudienceFilters.size
    ? `Filter audiences (${activeTrendAudienceFilters.size})`
    : "Filter audiences";
  filterBtn.setAttribute("aria-label", filterBtn.title);
  sortBtn.classList.toggle("hidden", !showControls);
  sortBtn.classList.toggle("active", trendSortMode === "posts");
  sortBtn.title =
    trendSortMode === "posts" ? "Sort by recency" : "Sort by posts";
  sortBtn.setAttribute(
    "aria-label",
    trendSortMode === "posts" ? "Sort by recency" : "Sort by posts",
  );
}

async function switchTwitterSubview(subview) {
  if (subview !== "news") return;
  currentTwitterSubview = "news";
  saveNavState({ twitterSubview: "news" });
  closeTrendFilterModal();
  setTwitterSidebarTitle();
  updateTrendingControls();
  $("sidebar-list").innerHTML = "";
  syncStoriesCustomerLayout();

  selectedTrendStoryId = null;
  trendStoryDetail = null;

  renderStoriesCustomerView();
  void loadTrendingStories();
}

async function loadCompanies() {
  if (currentView === "ops-brands") {
    await loadOpsCompanies();
    return;
  }
  await bootCustomerBrand();
}

