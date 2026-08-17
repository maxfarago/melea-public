// ============================================================
// trending news
// ============================================================

function renderNewsSidebarItem(story) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "job-item job-item-post news-sidebar-item";
  if (story.story_id === selectedTrendStoryId) btn.classList.add("active");

  const body = document.createElement("div");
  body.className = "job-item-body";

  const title = document.createElement("div");
  title.className = "job-domain-wrap news-sidebar-title";
  setText(title, story.headline || "Untitled story");

  const meta = document.createElement("div");
  meta.className = "job-meta";
  let freshness = story.recency_label || "—";
  if (story.last_updated_at) {
    const updatedMs = Date.parse(story.last_updated_at);
    if (!Number.isNaN(updatedMs)) {
      freshness = `updated ${relativeTime(updatedMs / 1000)}`;
    }
  }
  setText(meta, `${formatCompactCount(story.post_count)} posts · ${freshness}`);

  body.appendChild(title);
  body.appendChild(meta);
  btn.appendChild(body);
  btn.addEventListener("click", () => selectTrendingStory(story.story_id));
  return btn;
}

function trendAudienceOptions() {
  const options = new Map();
  trendsStories.forEach((story) => {
    const audiencesForStory = Array.isArray(story.audiences)
      ? story.audiences
      : [];
    audiencesForStory.forEach((audience) => {
      const id = String(audience?.audience_id || "").trim();
      const title = String(audience?.title || "").trim();
      if (!id || !title || options.has(id)) return;
      options.set(id, title);
    });
  });
  return Array.from(options.entries())
    .map(([id, title]) => ({ id, title }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

function storyMatchesAudienceFilters(story) {
  if (!activeTrendAudienceFilters.size) return true;
  const audiencesForStory = Array.isArray(story.audiences)
    ? story.audiences
    : [];
  return audiencesForStory.some((audience) =>
    activeTrendAudienceFilters.has(String(audience?.audience_id || "").trim()),
  );
}

function trendStorySortKey(story) {
  if (trendSortMode === "recency") {
    const stamps = [
      story.last_seen_at,
      story.last_updated_at,
      story.approx_started_at,
    ];
    return stamps.reduce((max, stamp) => {
      const t = stamp ? Date.parse(stamp) : NaN;
      return Number.isNaN(t) ? max : Math.max(max, t);
    }, 0);
  }
  const n = Number(story.post_count);
  return Number.isFinite(n) ? n : 0;
}

function sortedTrendStories() {
  return [...trendsStories]
    .filter(storyMatchesAudienceFilters)
    .sort((a, b) => trendStorySortKey(b) - trendStorySortKey(a));
}

async function ensureSelectedTrendingStoryVisible() {
  const ordered = sortedTrendStories();
  if (!ordered.length) {
    selectedTrendStoryId = null;
    trendStoryDetail = null;
    if (currentView === "twitter" && currentTwitterSubview === "news") {
      renderStoriesCustomerView();
    } else {
      renderDetailEmpty("twitter");
    }
    return;
  }
  if (
    selectedTrendStoryId &&
    ordered.some((s) => s.story_id === selectedTrendStoryId)
  ) {
    return;
  }
  await selectTrendingStory(ordered[0].story_id);
}

function renderTrendFilterModal() {
  const list = $("trend-filter-audience-list");
  if (!list) return;
  list.innerHTML = "";
  const options = trendAudienceOptions();
  if (!options.length) {
    const empty = document.createElement("div");
    empty.className = "sidebar-empty";
    setText(empty, "No audience sightings available yet.");
    list.appendChild(empty);
  } else {
    options.forEach((option) => {
      const label = document.createElement("label");
      label.className = "trend-filter-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = activeTrendAudienceFilters.has(option.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) activeTrendAudienceFilters.add(option.id);
        else activeTrendAudienceFilters.delete(option.id);
        updateTrendingControls();
        renderNewsSidebar();
        void ensureSelectedTrendingStoryVisible();
      });
      const text = document.createElement("span");
      setText(text, option.title);
      label.appendChild(checkbox);
      label.appendChild(text);
      list.appendChild(label);
    });
  }
  const clearBtn = $("trend-filter-clear");
  if (clearBtn) clearBtn.disabled = activeTrendAudienceFilters.size === 0;
}

function openTrendFilterModal() {
  if (currentView !== "twitter" || currentTwitterSubview !== "news") return;
  const modal = $("trend-filter-modal");
  if (!modal) return;
  trendFilterModalOpen = true;
  renderTrendFilterModal();
  modal.classList.remove("hidden");
  updateTrendingControls();
}

function closeTrendFilterModal() {
  const modal = $("trend-filter-modal");
  if (modal) modal.classList.add("hidden");
  trendFilterModalOpen = false;
  updateTrendingControls();
}

function renderNewsSidebar() {
  const list = $("sidebar-list");
  if (!list) return;
  list.innerHTML = "";
  const ordered = sortedTrendStories();
  if (trendsStories.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sidebar-empty";
    setText(empty, "No news stories yet.");
    list.appendChild(empty);
    return;
  }
  if (!ordered.length) {
    const empty = document.createElement("div");
    empty.className = "sidebar-empty";
    setText(empty, "No stories match this audience filter.");
    list.appendChild(empty);
    return;
  }
  ordered.forEach((story) => list.appendChild(renderNewsSidebarItem(story)));
  if (trendsStoriesLoadingMore) {
    const loading = document.createElement("div");
    loading.className = "sidebar-empty";
    setText(loading, "Loading more stories...");
    list.appendChild(loading);
  } else if (!trendsStoriesHasMore) {
    const done = document.createElement("div");
    done.className = "sidebar-empty";
    setText(done, "End of news list.");
    list.appendChild(done);
  }
}

async function loadTrendingStoriesPage({ append = false } = {}) {
  const offset = append ? trendsStoriesOffset : 0;
  const { ok, status, body } = await api(
    `/api/trends/stories?limit=${TREND_STORIES_PAGE_SIZE}&offset=${offset}`,
    { method: "GET" },
  );
  if (status === 401) {
    showLogin();
    return null;
  }
  if (!ok) {
    return null;
  }
  const rows = Array.isArray(body?.stories) ? body.stories : [];
  if (append) trendsStories = trendsStories.concat(rows);
  else trendsStories = rows;
  trendsStoriesOffset = trendsStories.length;
  trendsStoriesHasMore = rows.length === TREND_STORIES_PAGE_SIZE;
  return rows;
}

async function loadTrendingStories() {
  trendsStoriesOffset = 0;
  trendsStoriesHasMore = true;
  trendsStoriesLoadingMore = false;
  try {
    const rows = await loadTrendingStoriesPage({ append: false });
    if (rows === null) return;
    if (currentView !== "twitter" || currentTwitterSubview !== "news") return;
    renderNewsSidebar();
    if (trendFilterModalOpen) renderTrendFilterModal();
  } catch (_) {}
}

async function maybeLoadMoreTrendingStories() {
  if (
    currentView !== "twitter" ||
    currentTwitterSubview !== "news" ||
    trendsStoriesLoadingMore ||
    !trendsStoriesHasMore
  ) {
    return;
  }
  trendsStoriesLoadingMore = true;
  renderNewsSidebar();
  try {
    const rows = await loadTrendingStoriesPage({ append: true });
    if (rows === null) return;
    renderNewsSidebar();
    if (trendFilterModalOpen) renderTrendFilterModal();
  } finally {
    trendsStoriesLoadingMore = false;
    if (currentView === "twitter" && currentTwitterSubview === "news") {
      renderNewsSidebar();
    }
  }
}

function onSidebarListScroll() {
  if (currentView !== "twitter" || currentTwitterSubview !== "news") return;
  const list = $("sidebar-list");
  if (!list) return;
  const remaining = list.scrollHeight - list.scrollTop - list.clientHeight;
  if (remaining > 220) return;
  void maybeLoadMoreTrendingStories();
}

function storiesCustomerSettledCompanyId() {
  const brandId = storiesCustomerBrandId || selectedBrandId || "";
  if (!brandId) return "";
  const company = companies.find((row) => row.id === brandId);
  if (company && shouldResumePreBrandOnboarding(company)) return "";
  return brandId;
}

function isSettledBrandForStories(company) {
  if (!company?.id || shouldResumePreBrandOnboarding(company)) return false;
  const brandId = storiesCustomerBrandId || selectedBrandId || company.id;
  return brandId === company.id;
}

function syncStoriesCustomerFeedAfterLoad(companyOrId) {
  storiesCustomerLoadingMore = false;
  if (currentView !== "brands") return;
  const company =
    companyOrId && typeof companyOrId === "object"
      ? companyOrId
      : companies.find((c) => c.id === String(companyOrId || ""));
  if (!company?.id) return;
  if (selectedBrandId !== company.id && storiesCustomerBrandId !== company.id) {
    return;
  }
  if (!renderBrandHomeStoriesColOnly(company)) renderBrandDetail(company);
  tryAutoExpandFirstBrandHomeStory(company);
}

function storiesCustomerSortModes() {
  if (storiesCustomerSettledCompanyId()) {
    return ["recency", "activity", "brand_score"];
  }
  return STORIES_CUSTOMER_SORT_MODES;
}

function storiesCustomerDefaultSortMode() {
  return storiesCustomerSettledCompanyId() ? "brand_score" : "recency";
}

function applyStoriesCustomerDefaultSortMode() {
  storiesCustomerSortMode = storiesCustomerDefaultSortMode();
}

function normalizeStoriesCustomerSortMode() {
  const modes = storiesCustomerSortModes();
  if (!modes.includes(storiesCustomerSortMode)) {
    storiesCustomerSortMode = storiesCustomerDefaultSortMode();
  }
}

function storiesCustomerEmptyLoading() {
  return (
    storiesCustomerLoadingMore ||
    (!storiesCustomerFeed.length && storiesCustomerHasMore)
  );
}

function storiesCustomerEmptyMessage({ audienceFilterEmpty = false } = {}) {
  if (storiesCustomerEmptyLoading()) {
    return "Loading the latest trends...";
  }
  if (audienceFilterEmpty) {
    return "No stories match this audience filter.";
  }
  if (!storiesCustomerSettledCompanyId()) {
    return "There was a problem loading X stories. Please try again later.";
  }
  return "No stories yet — audience trends are still collecting.";
}

function storiesCustomerWindowParams(windowIndex) {
  const sinceHours = (windowIndex + 1) * 24;
  const untilHours = windowIndex * 24;
  return { since_hours: sinceHours, until_hours: untilHours };
}

async function loadStoriesCustomerPage({ append = false } = {}) {
  const settledCompanyId = storiesCustomerSettledCompanyId();
  try {
    if (settledCompanyId) {
      const offset = append ? storiesCustomerOffset : 0;
      const params = new URLSearchParams({
        offset: String(offset),
        limit: String(BRAND_STORIES_PAGE_SIZE),
        posts_per_story: "3",
      });
      const { ok, status, body } = await api(
        `/api/company/${encodeURIComponent(settledCompanyId)}/stories?${params.toString()}`,
        { method: "GET" },
      );
      if (status === 401) {
        showLogin();
        return null;
      }
      if (!ok) {
        return null;
      }
      const rows = Array.isArray(body?.stories) ? body.stories : [];
      storiesCustomerGated = !!body?.gated;
      if (append) {
        const seen = new Set(
          storiesCustomerFeed
            .map((story) => customerStoryId(story))
            .filter(Boolean),
        );
        const fresh = rows.filter((story) => {
          const storyId = customerStoryId(story);
          return storyId && !seen.has(storyId);
        });
        storiesCustomerFeed = storiesCustomerFeed.concat(fresh);
        storiesCustomerOffset += fresh.length;
      } else {
        storiesCustomerFeed = rows;
        storiesCustomerOffset = rows.length;
        storiesCustomerWindowIndex = 0;
      }
      storiesCustomerHasMore =
        !storiesCustomerGated && rows.length === BRAND_STORIES_PAGE_SIZE;
      return rows;
    }

    const windowIndex = append ? storiesCustomerWindowIndex + 1 : 0;
    const { since_hours, until_hours } =
      storiesCustomerWindowParams(windowIndex);
    const params = new URLSearchParams({
      limit: String(TREND_STORIES_PAGE_SIZE),
      since_hours: String(since_hours),
      until_hours: String(until_hours),
      include_posts: "1",
      posts_per_story: "3",
    });
    const { ok, status, body } = await api(
      `/api/trends/stories?${params.toString()}`,
      {
        method: "GET",
      },
    );
    if (status === 401) {
      showLogin();
      return null;
    }
    if (!ok) {
      return null;
    }
    const rows = Array.isArray(body?.stories) ? body.stories : [];
    storiesCustomerGated = !!body?.gated;
    if (append) {
      const seen = new Set(
        storiesCustomerFeed
          .map((story) => customerStoryId(story))
          .filter(Boolean),
      );
      const fresh = rows.filter((story) => {
        const storyId = customerStoryId(story);
        return storyId && !seen.has(storyId);
      });
      storiesCustomerFeed = storiesCustomerFeed.concat(fresh);
      storiesCustomerWindowIndex = windowIndex;
    } else {
      storiesCustomerFeed = rows;
      storiesCustomerWindowIndex = 0;
    }
    storiesCustomerHasMore = !storiesCustomerGated && rows.length > 0;
    return rows;
  } finally {
    if (settledCompanyId && !append) {
      syncStoriesCustomerFeedAfterLoad(settledCompanyId);
    }
  }
}

function buildStoriesCustomerLoadFooter() {
  const footer = document.createElement("div");
  footer.className = "stories-customer-load-footer";
  footer.setAttribute("aria-live", "polite");
  const label = document.createElement("div");
  label.className = "stories-customer-load-label";
  footer.appendChild(label);
  return footer;
}

function storiesCustomerScrollList() {
  return (
    brandHomeStoriesList?.() ||
    document.querySelector(".stories-desktop-shell .stories-desktop-list") ||
    document.querySelector(
      ".stories-desktop-shell .stories-desktop-narrow-feed",
    ) ||
    null
  );
}

const storiesCustomerScrollObservers = new WeakMap();
let storiesCustomerLoadArmed = true;
let storiesCustomerBootstrapRequestKey = "";

function onStoriesCustomerFooterIntersect(entries) {
  for (const entry of entries) {
    if (!entry.isIntersecting) {
      storiesCustomerLoadArmed = true;
      continue;
    }
    if (
      !storiesCustomerLoadArmed ||
      storiesCustomerLoadingMore ||
      !storiesCustomerHasMore
    ) {
      continue;
    }
    void maybeLoadMoreStoriesCustomer();
  }
}

function updateStoriesCustomerLoadFooter(listEl) {
  const list = listEl || storiesCustomerScrollList();
  if (!list) return;
  let footer = list.querySelector(".stories-customer-load-footer");
  if (!footer) {
    footer = buildStoriesCustomerLoadFooter();
    list.appendChild(footer);
  }
  const label = footer.querySelector(".stories-customer-load-label");
  footer.classList.remove("is-loading", "is-armed");
  if (storiesCustomerLoadingMore) {
    footer.classList.add("is-loading");
    setText(label, "Loading more stories…");
    return;
  }
  if (!storiesCustomerHasMore && storiesCustomerFeed.length) {
    setText(label, "You're all caught up");
    return;
  }
  setText(label, "");
}

function pulseStoriesCustomerLoadFooter(listEl) {
  const list = listEl || storiesCustomerScrollList();
  if (!list) return;
  updateStoriesCustomerLoadFooter(list);
  list
    .querySelector(".stories-customer-load-footer")
    ?.classList.add("is-armed");
}

async function maybeLoadMoreStoriesCustomer() {
  const onBrands = currentView === "brands" && !!selectedBrandId;
  const onPreBrand =
    currentView === "brands" && !selectedBrandId && companies.length === 0;
  const onStories =
    currentView === "twitter" && currentTwitterSubview === "news";
  if (
    (!onBrands && !onStories && !onPreBrand) ||
    storiesCustomerLoadingMore ||
    !storiesCustomerHasMore ||
    !storiesCustomerLoadArmed
  ) {
    return;
  }
  const list = storiesCustomerScrollList();
  storiesCustomerLoadingMore = true;
  storiesCustomerLoadArmed = false;
  pulseStoriesCustomerLoadFooter(list);
  try {
    const rows = await loadStoriesCustomerPage({ append: true });
    if (rows === null) return;
    if (onPreBrand) {
      if (!renderPreBrandStoriesColOnly()) renderBrandHomeEmpty();
    } else if (currentView === "brands" && selectedBrandId) {
      const co = companies.find((c) => c.id === selectedBrandId);
      if (co) appendBrandHomeStoryCards(co, rows, list);
    } else {
      renderStoriesCustomerView();
    }
  } finally {
    storiesCustomerLoadingMore = false;
    updateStoriesCustomerLoadFooter(list);
  }
}

function bindStoriesCustomerListScroll(el) {
  if (!el) return;
  const prev = storiesCustomerScrollObservers.get(el);
  if (prev) prev.disconnect();
  let footer = el.querySelector(".stories-customer-load-footer");
  if (!footer) {
    footer = buildStoriesCustomerLoadFooter();
    el.appendChild(footer);
  }
  updateStoriesCustomerLoadFooter(el);
  storiesCustomerLoadArmed = true;
  const observer = new IntersectionObserver(onStoriesCustomerFooterIntersect, {
    root: el,
    rootMargin: "220px 0px",
    threshold: 0,
  });
  observer.observe(footer);
  storiesCustomerScrollObservers.set(el, observer);
}

async function ensureStoriesCustomerDetail(storyId) {
  const key = String(storyId || "").trim();
  if (!key) return;
  if (
    storiesCustomerDetailCache.has(key) ||
    storiesCustomerDetailInFlight.has(key)
  )
    return;
  storiesCustomerDetailInFlight.add(key);
  try {
    const { ok, status, body } = await api(
      `/api/trends/story/${encodeURIComponent(key)}?limit=10`,
      { method: "GET" },
    );
    if (status === 401) {
      showLogin();
      return;
    }
    if (!ok || !body || !body.story) return;
    const detail = {
      story: body.story,
      posts: Array.isArray(body.posts) ? body.posts : [],
      audiences: Array.isArray(body.audiences) ? body.audiences : [],
    };
    storiesCustomerDetailCache.set(key, detail);
    const idx = storiesCustomerFeed.findIndex(
      (row) => customerStoryId(row) === key,
    );
    if (idx >= 0) {
      const row = storiesCustomerFeed[idx];
      storiesCustomerFeed[idx] = {
        ...row,
        ...detail.story,
        posts: detail.posts.length ? detail.posts : row.posts,
        audiences: detail.audiences.length ? detail.audiences : row.audiences,
      };
    }
    if (storiesCustomerSelectedId === key || storiesCustomerExpanded.has(key)) {
      if (currentView === "brands" && selectedBrandId) {
        const co = companies.find((c) => c.id === selectedBrandId);
        if (co) {
          if (!renderBrandHomeStoriesColOnly(co)) renderBrandDetail(co);
          return;
        }
      }
      if (
        currentView === "twitter" &&
        currentTwitterSubview === "news" &&
        storiesCustomerSelectedId === key
      ) {
        renderStoriesCustomerView();
      }
    }
  } finally {
    storiesCustomerDetailInFlight.delete(key);
  }
}

function renderTrendPostCard(post) {
  const card = document.createElement("div");
  card.className = "trend-post-card";

  card.appendChild(
    avatarFor(
      post.author_handle || post.author_name || "?",
      "trend-post-avatar",
      post.author_avatar || null,
    ),
  );

  const content = document.createElement("div");
  content.className = "trend-post-content";

  // header: name · handle · category chip · external link
  const header = document.createElement("div");
  header.className = "trend-post-header";

  const name = document.createElement("span");
  name.className = "trend-post-author";
  setText(name, post.author_name || post.author_handle || "@unknown");
  header.appendChild(name);

  if (post.author_handle) {
    const handle = document.createElement("span");
    handle.className = "trend-post-handle";
    setText(handle, `@${post.author_handle}`);
    header.appendChild(handle);
  }

  if (post.category) {
    const cat = document.createElement("span");
    cat.className = "trend-post-category";
    setText(cat, post.category);
    header.appendChild(cat);
  }

  const postUrl = storyPostUrl(post);
  if (postUrl) {
    const link = document.createElement("a");
    link.className = "trend-post-link";
    link.href = postUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", "Open on X");
    link.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    header.appendChild(link);
  }

  content.appendChild(header);

  const body = document.createElement("div");
  body.className = "trend-post-body";
  setText(body, post.text || "");
  content.appendChild(body);

  // engagement metrics
  const metrics = document.createElement("div");
  metrics.className = "trend-post-metrics";
  [
    [
      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
      post.likes,
    ],
    [
      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
      post.replies,
    ],
    [
      `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
      post.views,
    ],
  ].forEach(([icon, value]) => {
    const stat = document.createElement("span");
    stat.className = "trend-post-stat";
    stat.innerHTML = icon;
    const val = document.createElement("span");
    setText(val, formatCompactCount(value));
    stat.appendChild(val);
    metrics.appendChild(stat);
  });
  content.appendChild(metrics);

  card.appendChild(content);
  return card;
}

function trendBrandScorePercent(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n * 100)));
}

function trendBrandScoreTone(percent) {
  if (percent === null) return "is-na";
  if (percent >= 75) return "is-high";
  if (percent >= 55) return "is-mid";
  return "is-low";
}

function trendAliasMethodLabel(method) {
  const key = String(method || "")
    .trim()
    .toLowerCase();
  if (key === "x_trend_id") return "X ID";
  if (key === "cosine") return "embedding";
  if (key === "haiku") return "AI match";
  return key || "match";
}

function trendAliasScoreText(alias) {
  const parts = [trendAliasMethodLabel(alias.method)];
  const lexical = Number(alias.lexical_score);
  if (Number.isFinite(lexical))
    parts.push(`lexical ${Math.round(lexical * 100)}%`);
  const cosineScore = Number(alias.cosine_score);
  if (Number.isFinite(cosineScore))
    parts.push(`embedding ${Math.round(cosineScore * 100)}%`);
  return parts.join(" · ");
}

function trendStoryMetaText(story) {
  let freshness = story.recency_label || "—";
  if (story.last_updated_at) {
    const updatedMs = Date.parse(story.last_updated_at);
    if (!Number.isNaN(updatedMs)) {
      freshness = `updated ${relativeTime(updatedMs / 1000)}`;
    }
  }
  return `${story.topic_category || "Unknown"} · ${formatCompactCount(story.post_count)} posts · ${freshness}`;
}

function buildTrendStoryHeader(story) {
  const header = document.createElement("div");
  header.className = "brand-detail-header trend-story-header";

  const titleCol = document.createElement("div");
  titleCol.className = "brand-detail-title-col";
  const h = document.createElement("h2");
  h.className = "brand-detail-title";
  setText(h, story.headline || "Trend story");
  titleCol.appendChild(h);
  const newsLink = buildStoryNewsLink(story);
  if (newsLink) titleCol.appendChild(newsLink);
  const subtitle = document.createElement("div");
  subtitle.className = "brand-detail-subtitle";
  setText(subtitle, trendStoryMetaText(story));
  titleCol.appendChild(subtitle);
  header.appendChild(titleCol);
  return header;
}

function customerStoryId(story) {
  return String(story.story_id || story.id || story.headline || "");
}

function storyUrgency(lastSeenAt) {
  const ms = customerStoryTimeMs(lastSeenAt);
  if (!ms) return { label: "Fading", rings: 0, tone: "fading" };
  const hrs = (Date.now() - ms) / 3_600_000;
  if (hrs < 2) return { label: "Live", rings: 2, tone: "live" };
  if (hrs < 12) return { label: "Active", rings: 1, tone: "active" };
  if (hrs < 48) return { label: "Recent", rings: 0, tone: "recent" };
  return { label: "Fading", rings: 0, tone: "fading" };
}

function storyUrgencyRank(lastSeenAt) {
  const ms = customerStoryTimeMs(lastSeenAt);
  if (!ms) return 4;
  const hrs = (Date.now() - ms) / 3_600_000;
  if (hrs < 2) return 0;
  if (hrs < 12) return 1;
  if (hrs < 48) return 2;
  return 3;
}

function buildUrgencyDot(strength) {
  const dot = document.createElement("span");
  dot.className = "sc-dot";
  for (let i = 0; i < strength.rings; i += 1) {
    const ring = document.createElement("span");
    ring.className = "sc-dot-ring";
    dot.appendChild(ring);
  }
  const core = document.createElement("span");
  core.className = "sc-dot-core";
  dot.appendChild(core);
  return dot;
}

const SC_SCORE_BRAND_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 17c-3.859 0-7-3.14-7-7s3.141-7 7-7 7 3.14 7 7-3.141 7-7 7z"/><path d="M12 7c-2.757 0-5 2.243-5 5s2.243 5 5 5 5-2.243 5-5-2.243-5-5-5zm0 7c-1.103 0-2-.897-2-2s.897-2 2-2 2 .897 2 2-.897 2-2 2z"/></svg>';

function buildBrandScoreBadge(score) {
  const n = Number(score);
  if (!Number.isFinite(n) || n < 0.35) return null;
  const badge = document.createElement("div");
  badge.className = "sc-card-score sc-score-brand";
  const icon = document.createElement("span");
  icon.className = "sc-score-brand-icon";
  icon.innerHTML = SC_SCORE_BRAND_ICON;
  badge.appendChild(icon);
  const label = document.createElement("span");
  setText(label, "On-Brand");
  badge.appendChild(label);
  return badge;
}

function topStoryPosts(story, limit = 3) {
  return Array.isArray(story?.posts) ? story.posts.slice(0, limit) : [];
}

const STORY_STATUS_URL_RE = /\/status\/(\d+)/;
const STORY_NEWS_ID_RE = /^\d+$/;

function storyNewsUrl(story) {
  const direct = String(story?.source_url || "").trim();
  if (/^https?:\/\//i.test(direct)) {
    return direct.replace(/^https?:\/\/twitter\.com\//i, "https://x.com/");
  }
  const xTrendId = String(story?.x_trend_id || "").trim();
  if (STORY_NEWS_ID_RE.test(xTrendId)) {
    return `https://x.com/i/trending/${xTrendId}`;
  }
  return "";
}

function buildStoryNewsLink(story) {
  const url = storyNewsUrl(story);
  if (!url) return null;
  const link = document.createElement("a");
  link.className = "section-header-link sc-story-news-link";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", "Open on X");
  link.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  link.addEventListener("click", (event) => event.stopPropagation());
  return link;
}

function storyPostUrl(post) {
  if (!post) return "";
  const direct = String(
    post.url || post.tweet_url || post.post_url || "",
  ).trim();
  const statusMatch = direct.match(STORY_STATUS_URL_RE);
  if (statusMatch) {
    return direct.replace(/^https?:\/\/twitter\.com\//i, "https://x.com/");
  }
  const postId = String(post.post_id || post.id || "").trim();
  if (/^\d+$/.test(postId)) {
    const handle = String(post.author_handle || "")
      .trim()
      .replace(/^@+/, "");
    if (handle) return `https://x.com/${handle}/status/${postId}`;
    return `https://x.com/i/status/${postId}`;
  }
  return direct.startsWith("http") ? direct : "";
}

function distributeReplyTextFromHost(replyHost, cachedText) {
  const input = replyHost?.querySelector(".distribute-reply-edit");
  if (input) {
    const live = String(input.value || "").trim();
    if (live) return live;
  }
  return String(cachedText || "").trim();
}

function distributeReplyIntentUrl(post, replyText) {
  const text = String(replyText || "").trim();
  const replyIntent = String(post?.reply_intent_url || "").trim();
  if (replyIntent) {
    if (!text) return replyIntent;
    const sep = replyIntent.includes("?") ? "&" : "?";
    return replyIntent + sep + "text=" + encodeURIComponent(text);
  }
  const direct = String(
    post?.url || post?.tweet_url || post?.post_url || "",
  ).trim();
  const statusMatch = direct.match(STORY_STATUS_URL_RE);
  if (statusMatch) {
    let url = `https://twitter.com/intent/tweet?in_reply_to=${statusMatch[1]}`;
    if (text) url += `&text=${encodeURIComponent(text)}`;
    return url;
  }
  return storyPostUrl(post) || (direct.startsWith("http") ? direct : "");
}

function buildDistributeWindowBadge(post) {
  const ageMs = customerStoryTimeMs(post.posted_at);
  if (!ageMs) return null;
  const hoursOld = (Date.now() - ageMs) / 3_600_000;
  const badge = document.createElement("span");
  badge.className = "distribute-window-badge";
  const icon = (inner) =>
    `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  const rocketIcon = icon(
    '<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"/>',
  );
  const trendingIcon = icon(
    '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
  );
  const alarmIcon = icon(
    '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M6.38 18.7 4 21"/><path d="M17.64 18.67 20 21"/>',
  );
  if (hoursOld < 2) {
    badge.classList.add("distribute-window-fresh");
    badge.innerHTML = `${rocketIcon}Just posted`;
  } else if (hoursOld < 6) {
    badge.classList.add("distribute-window-open");
    badge.innerHTML = `${trendingIcon}Window open`;
  } else if (hoursOld < 10) {
    badge.classList.add("distribute-window-hot");
    badge.innerHTML = `${alarmIcon}Window closing`;
  } else {
    return null;
  }
  return badge;
}

function distributeStoryPostKey(storyId, post) {
  const id = String(post?.id || post?.url || "").trim();
  if (id) return `${storyId}:${id}`;
  return `${storyId}:${String(post?.text || "").slice(0, 120)}`;
}

function distributeSentAuthorLabel(post) {
  const rawHandle = String(post.author_handle || "")
    .trim()
    .replace(/^@+/, "");
  if (rawHandle) return `@${rawHandle}`;
  const name = String(post.author_name || "").trim();
  return name || "@account";
}

function distributeSentSnippet(text, max = 110) {
  const value = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}…`;
}

function appendDistributeCompactEngagement(content, post) {
  const eng = document.createElement("div");
  eng.className = "mobile-xeng mobile-distribute-sent-eng";
  [
    [
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 8.6 8.6 0 0 1-3.2-.6L4 21l1.9-4.4a8 8 0 0 1-1.4-4.6A8.4 8.4 0 0 1 13 3.7a8.4 8.4 0 0 1 8 7.8z"/></svg>',
      post.replies,
    ],
    [
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
      post.retweets,
    ],
    [
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
      post.likes,
    ],
    [
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 20V10M9 20V4M15 20v-8M21 20V8"/></svg>',
      post.views,
    ],
  ].forEach(([icon, val]) => {
    const xe = document.createElement("span");
    xe.className = "mobile-xe";
    xe.innerHTML = `${icon}<b>${formatCompactCount(val || 0)}</b>`;
    eng.appendChild(xe);
  });
  content.appendChild(eng);
}

function buildDistributeCompactPostBody(
  post,
  { metaRight = null, reply = "", fullText = false } = {},
) {
  const body = document.createElement("div");
  body.className = "mobile-distribute-sent-body";

  const authorName = String(post.author_name || "Account").trim() || "Account";
  const avatarUrl = String(
    post.author_avatar || post.author_profile_image_url || "",
  ).trim();
  if (avatarUrl) {
    const av = document.createElement("img");
    av.className = "mobile-distribute-sent-av";
    av.src = avatarUrl;
    av.alt = "";
    av.onerror = () => av.remove();
    body.appendChild(av);
  } else {
    const av = document.createElement("span");
    av.className =
      "mobile-distribute-sent-av mobile-distribute-sent-av-fallback";
    setText(av, (authorName[0] || "?").toUpperCase());
    body.appendChild(av);
  }

  const content = document.createElement("div");
  content.className = "mobile-distribute-sent-content";

  const meta = document.createElement("div");
  meta.className = "mobile-distribute-sent-meta";

  const target = document.createElement("span");
  target.className = "mobile-distribute-sent-target";
  setText(target, distributeSentAuthorLabel(post));
  meta.appendChild(target);
  if (metaRight) meta.appendChild(metaRight);
  content.appendChild(meta);

  const originalText = fullText
    ? String(post.text || "").trim()
    : distributeSentSnippet(post.text);
  if (originalText) {
    const originalEl = document.createElement("div");
    originalEl.className =
      "mobile-distribute-sent-original" +
      (fullText ? " mobile-distribute-sent-original-full" : "");
    setText(originalEl, originalText);
    content.appendChild(originalEl);
  }

  appendDistributeCompactEngagement(content, post);

  const replyText = String(reply || "").trim();
  if (replyText) {
    const replyEl = document.createElement("div");
    replyEl.className = "mobile-distribute-sent-reply";
    setText(replyEl, replyText);
    content.appendChild(replyEl);
  }

  body.appendChild(content);
  return body;
}

function buildDistributeQueueListItem(post, { isActive = false } = {}) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "mobile-distribute-queue-list-item";
  if (isActive) item.classList.add("is-active");

  const windowBadge = buildDistributeWindowBadge(post);
  item.appendChild(
    buildDistributeCompactPostBody(post, {
      metaRight: windowBadge,
      fullText: true,
    }),
  );
  return item;
}

function buildDistributeSentListItem(entry, options = {}) {
  const { readOnly = false } = options;
  const post = entry.post || {};
  const url = readOnly ? "" : storyPostUrl(post);
  const row = document.createElement(url ? "a" : "div");
  row.className =
    "mobile-distribute-sent-item" +
    (readOnly ? " mobile-distribute-sent-item-readonly" : "");
  if (url) {
    row.href = url;
    row.target = "_blank";
    row.rel = "noopener";
  }

  const time = document.createElement("span");
  time.className = "mobile-distribute-sent-time";
  const ago = relativeTime(entry.sentAt);
  time.innerHTML =
    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
  const timeText = document.createElement("span");
  setText(
    timeText,
    ago === "just now" ? "Just now" : ago ? `${ago} ago` : "Sent",
  );
  time.appendChild(timeText);

  row.appendChild(
    buildDistributeCompactPostBody(post, {
      metaRight: time,
      reply: entry.reply,
    }),
  );
  return row;
}

function buildExpandedStoryPost(post, options = {}) {
  const { showWindowBadge = false } = options;
  const url = storyPostUrl(post);
  const card = document.createElement(url ? "a" : "div");
  card.className = "mobile-xpost distribute-xpost";
  if (url) {
    card.href = url;
    card.target = "_blank";
    card.rel = "noopener";
  }

  const top = document.createElement("div");
  top.className = "mobile-xtop";
  const authorName = String(post.author_name || "Account").trim() || "Account";
  const avatarUrl =
    String(post.author_avatar || post.author_profile_image_url || "").trim() ||
    null;
  if (avatarUrl) {
    const av = document.createElement("img");
    av.className = "mobile-xav";
    av.src = avatarUrl;
    av.alt = "";
    av.onerror = () => {
      av.remove();
    };
    top.appendChild(av);
  } else {
    const av = document.createElement("span");
    av.className = "mobile-xav mobile-xav-fallback";
    setText(av, (authorName[0] || "?").toUpperCase());
    top.appendChild(av);
  }

  const who = document.createElement("div");
  who.className = "mobile-xwho";
  const nameRow = document.createElement("div");
  nameRow.className = "mobile-xname-row";
  const name = document.createElement("span");
  name.className = "mobile-xname";
  setText(name, authorName);
  nameRow.appendChild(name);
  if (post.author_verified) {
    const verified = document.createElement("span");
    verified.className = "mobile-xverified";
    verified.innerHTML =
      '<svg viewBox="0 0 22 22" aria-label="Verified" width="15" height="15"><path fill="currentColor" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.855-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.706 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></svg>';
    nameRow.appendChild(verified);
  }
  who.appendChild(nameRow);
  const handle = document.createElement("div");
  handle.className = "mobile-xhandle";
  const rawHandle = String(post.author_handle || "")
    .trim()
    .replace(/^@+/, "");
  const ts = postTimestampSeconds(post);
  const time = ts ? relativeTime(ts) : "";
  const parts = [];
  if (rawHandle) parts.push(`@${rawHandle}`);
  if (time) parts.push(time);
  setText(handle, parts.join(" · "));
  who.appendChild(handle);
  top.appendChild(who);
  if (showWindowBadge) {
    const windowBadge = buildDistributeWindowBadge(post);
    if (windowBadge) top.appendChild(windowBadge);
  }
  card.appendChild(top);

  const text = document.createElement("p");
  text.className = "mobile-xtxt distribute-xtxt";
  setText(text, post.text || "");
  card.appendChild(text);

  const eng = document.createElement("div");
  eng.className = "mobile-xeng";
  [
    [
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 8.6 8.6 0 0 1-3.2-.6L4 21l1.9-4.4a8 8 0 0 1-1.4-4.6A8.4 8.4 0 0 1 13 3.7a8.4 8.4 0 0 1 8 7.8z"/></svg>',
      post.replies,
    ],
    [
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
      post.retweets,
    ],
    [
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
      post.likes,
    ],
    [
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 20V10M9 20V4M15 20v-8M21 20V8"/></svg>',
      post.views,
    ],
  ].forEach(([icon, val]) => {
    const xe = document.createElement("span");
    xe.className = "mobile-xe";
    xe.innerHTML = `${icon}<b>${formatCompactCount(val || 0)}</b>`;
    eng.appendChild(xe);
  });
  card.appendChild(eng);

  return card;
}

function renderDistributeQueueCardStack(host, posts, queueIndex, options = {}) {
  host.innerHTML = "";
  host.className = "distribute-queue-card";
  const post = posts[queueIndex];
  if (!post) return;
  host.appendChild(buildExpandedStoryPost(post, options));
}

function buildStoryPostList(posts, listClass = "", collapseLimit = 0) {
  const postList = document.createElement("div");
  postList.className = `sc-story-post-list${listClass ? ` ${listClass}` : ""}`;
  const shouldCollapse = collapseLimit > 0 && posts.length > collapseLimit;
  posts.forEach((post, i) => {
    const postEl = buildExpandedStoryPost(post);
    if (shouldCollapse && i >= collapseLimit) {
      postEl.classList.add("sc-story-post-hidden");
    }
    postList.appendChild(postEl);
  });
  if (shouldCollapse) {
    const hiddenCount = posts.length - collapseLimit;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "sc-sortbtn sc-story-posts-toggle";
    setText(toggle, `Show ${hiddenCount} more`);
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const expanded = postList.classList.toggle("is-posts-expanded");
      setText(toggle, expanded ? "Show less" : `Show ${hiddenCount} more`);
    });
    postList.appendChild(toggle);
  }
  return postList;
}

function storySortLabel(mode) {
  if (mode === "activity") return "Activity";
  if (mode === "brand_score") return "Brand Score";
  return "Recency";
}

function openStoriesCustomerFilterModal(brandAudiences) {
  const existing = document.getElementById(STORIES_FILTER_MODAL_ID);
  if (existing) existing.remove();
  const audiences = Array.isArray(brandAudiences) ? brandAudiences : [];
  const draft = new Set(storiesCustomerFilters);

  const overlay = document.createElement("div");
  overlay.id = STORIES_FILTER_MODAL_ID;
  overlay.className = "modal-overlay trend-filter-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const box = document.createElement("div");
  box.className = "modal-box trend-filter-modal-box";
  const h = document.createElement("h2");
  setText(h, "Filter audiences");
  box.appendChild(h);

  const list = document.createElement("div");
  list.className = "trend-filter-list";
  if (!audiences.length) {
    const empty = document.createElement("div");
    empty.className = "sidebar-empty";
    setText(empty, "No matched audiences available.");
    list.appendChild(empty);
  } else {
    audiences.forEach((aud) => {
      const audId = String(aud.match?.audience_id || "").trim();
      if (!audId) return;
      const label = document.createElement("label");
      label.className = "trend-filter-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = draft.has(audId);
      const text = document.createElement("span");
      setText(text, String(aud.match?.title || aud.title || "Audience"));
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) draft.add(audId);
        else draft.delete(audId);
        clearBtn.disabled = draft.size === 0;
      });
      label.appendChild(checkbox);
      label.appendChild(text);
      list.appendChild(label);
    });
  }
  box.appendChild(list);

  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "btn-secondary";
  setText(clearBtn, "Clear");
  clearBtn.disabled = draft.size === 0;
  clearBtn.addEventListener("click", () => {
    draft.clear();
    list.querySelectorAll('input[type="checkbox"]').forEach((el) => {
      el.checked = false;
    });
    clearBtn.disabled = true;
  });
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn-secondary";
  setText(cancelBtn, "Cancel");
  const applyBtn = document.createElement("button");
  applyBtn.type = "button";
  applyBtn.className = "btn-primary";
  setText(applyBtn, "Apply");
  actions.appendChild(clearBtn);
  actions.appendChild(cancelBtn);
  actions.appendChild(applyBtn);
  box.appendChild(actions);

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const cleanupBehavior = installModalBehavior(overlay, cleanup);
  function cleanup() {
    cleanupBehavior();
    overlay.remove();
  }
  cancelBtn.addEventListener("click", cleanup);
  applyBtn.addEventListener("click", () => {
    storiesCustomerFilters = new Set(draft);
    cleanup();
    if (currentView === "brands" && selectedBrandId) {
      const co = companies.find((c) => c.id === selectedBrandId);
      if (co) {
        if (!renderBrandHomeStoriesColOnly(co)) renderBrandDetail(co);
        return;
      }
    }
    renderStoriesCustomerView();
  });
}

function filterStoriesForBrand(stories, company) {
  let rows = Array.isArray(stories) ? stories : [];
  if (!company?.id) return rows;

  if (!isSettledBrandForStories(company)) {
    const matchedIds = new Set(
      (Array.isArray(company.audience) ? company.audience : [])
        .map((item) =>
          item && item.match && typeof item.match === "object"
            ? String(item.match.audience_id || "").trim()
            : "",
        )
        .filter(Boolean),
    );
    if (!matchedIds.size) return [];

    rows = rows
      .map((story) => {
        const audiences = (
          Array.isArray(story.audiences) ? story.audiences : []
        ).filter((audience) =>
          matchedIds.has(String(audience.audience_id || "")),
        );
        if (!audiences.length) return null;
        return { ...story, audiences };
      })
      .filter(Boolean)
      .filter((story) => {
        const score = story.brand_score;
        if (score === null || score === undefined) return true;
        const n = Number(score);
        if (!Number.isFinite(n)) return true;
        return n >= 0.1;
      });
  }

  if (storiesCustomerFilters.size) {
    rows = rows.filter((story) =>
      (story.audiences || []).some((audience) =>
        storiesCustomerFilters.has(String(audience.audience_id || "")),
      ),
    );
  }
  return rows;
}

function storiesForDisplay(company) {
  return sortCustomerStories(
    filterStoriesForBrand(storiesCustomerFeed, company),
  );
}

function customerStoryRecencyTimeMs(story) {
  return customerStoryTimeMs(
    story.audience_last_seen_at ||
      story.last_updated_at ||
      story.story_last_seen_at,
  );
}

function sortCustomerStories(stories) {
  return [...stories].sort((a, b) => {
    if (storiesCustomerSortMode === "brand_score") {
      return Number(b.brand_score || 0) - Number(a.brand_score || 0);
    }
    if (storiesCustomerSortMode === "activity") {
      const diff = Number(b.post_count || 0) - Number(a.post_count || 0);
      if (diff !== 0) return diff;
      return customerStoryRecencyTimeMs(b) - customerStoryRecencyTimeMs(a);
    }
    return customerStoryRecencyTimeMs(b) - customerStoryRecencyTimeMs(a);
  });
}

function storiesCustomerNarrow() {
  return window.matchMedia("(max-width: 899px)").matches;
}

function ensureStoriesCustomerSelection(filtered) {
  const ids = filtered.map((story) => customerStoryId(story));
  if (!ids.length) {
    storiesCustomerSelectedId = "";
    return null;
  }
  if (!ids.includes(storiesCustomerSelectedId)) {
    storiesCustomerSelectedId = ids[0];
  }
  return filtered.find(
    (story) => customerStoryId(story) === storiesCustomerSelectedId,
  );
}

function buildScGenerateBtn({ ariaLabel, onClick, className = "" }) {
  const generateBtn = document.createElement("button");
  generateBtn.type = "button";
  generateBtn.className = (
    "sc-generate-btn" + (className ? ` ${className}` : "")
  ).trim();
  if (ariaLabel) generateBtn.setAttribute("aria-label", ariaLabel);
  const generateLabel = document.createElement("span");
  generateLabel.className = "sc-generate-label";
  setText(generateLabel, ariaLabel || "");
  generateBtn.appendChild(generateLabel);
  const generateArrow = document.createElement("span");
  generateArrow.className = "sc-generate-arrow";
  generateArrow.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
  generateBtn.appendChild(generateArrow);
  if (typeof onClick === "function") {
    generateBtn.addEventListener("click", onClick);
  }
  return generateBtn;
}

function buildStoriesOutlinedReactBtn({ ariaLabel, onClick }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sc-react-btn";
  btn.setAttribute("aria-label", ariaLabel);
  const label = document.createElement("span");
  label.className = "sc-react-label";
  setText(label, "React");
  btn.appendChild(label);
  const arrow = document.createElement("span");
  arrow.className = "sc-react-arrow";
  arrow.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  btn.appendChild(arrow);
  if (typeof onClick === "function") {
    btn.addEventListener("click", onClick);
  }
  return btn;
}

function buildStoriesGenerateBtn(story, company, options = {}) {
  if (options.hideActions || options.viewInStories) return null;
  const ariaLabel = options.contentMode
    ? "React with content"
    : "React to this story";
  const onClick = (event) => {
    event.stopPropagation();
    if (typeof options.onReact === "function") {
      options.onReact();
      return;
    }
    showToast("Coming soon");
  };
  if (options.reactBtnVariant === "outlined") {
    return buildStoriesOutlinedReactBtn({ ariaLabel, onClick });
  }
  return buildScGenerateBtn({ ariaLabel, onClick });
}

function appendStoriesCardHeadAndStats(card, story, options = {}) {
  const strength = storyUrgency(story.story_last_seen_at);

  const head = document.createElement("div");
  head.className = "sc-card-head";

  const titleCol = document.createElement("div");
  titleCol.className = "sc-card-title";
  const h4 = document.createElement("h4");
  setText(h4, story.headline || "Story");
  titleCol.appendChild(h4);
  head.appendChild(titleCol);
  if (options.generateBtn) head.appendChild(options.generateBtn);

  card.appendChild(head);

  const stats = document.createElement("div");
  stats.className = "sc-card-stats";
  const strengthEl = document.createElement("div");
  strengthEl.className = `sc-strength sc-strength-${strength.tone}`;
  strengthEl.appendChild(buildUrgencyDot(strength));
  const strengthLabel = document.createElement("span");
  setText(strengthLabel, strength.label);
  strengthEl.appendChild(strengthLabel);
  stats.appendChild(strengthEl);

  const nums = document.createElement("div");
  nums.className = "sc-card-nums";
  const newsLink = buildStoryNewsLink(story);
  if (newsLink) nums.appendChild(newsLink);
  const postCount = document.createElement("span");
  const posts = document.createElement("b");
  setText(posts, formatCompactCount(story.post_count));
  postCount.appendChild(posts);
  postCount.appendChild(document.createTextNode(" posts"));
  nums.appendChild(postCount);
  const ageLabel = customerStoryAgeLabel(
    story.last_updated_at || story.story_last_seen_at,
  );
  if (ageLabel) nums.appendChild(document.createTextNode(` · ${ageLabel}`));
  stats.appendChild(nums);
  if (
    story.brand_score !== null &&
    story.brand_score !== undefined &&
    Number.isFinite(Number(story.brand_score))
  ) {
    const badge = buildBrandScoreBadge(story.brand_score);
    if (badge) stats.appendChild(badge);
  }
  card.appendChild(stats);
}

function bindSeenByTooltip(tipWrap, tooltip) {
  let portal = null;
  let place = null;

  const cleanup = () => {
    if (place) {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      place = null;
    }
    portal?.remove();
    portal = null;
  };

  tipWrap.addEventListener("mouseenter", () => {
    cleanup();
    portal = tooltip.cloneNode(true);
    portal.classList.add("sc-seen-by-tooltip-portal");
    document.body.appendChild(portal);
    place = () => {
      const icon = tipWrap.querySelector(".sc-seen-by-tip-icon");
      if (!icon || !portal) return;
      const rect = icon.getBoundingClientRect();
      const gap = 6;
      const tipRect = portal.getBoundingClientRect();
      let top = rect.top - tipRect.height - gap;
      const left = rect.left + rect.width / 2;
      if (top < 8) top = rect.bottom + gap;
      portal.style.left = `${left}px`;
      portal.style.top = `${top}px`;
    };
    requestAnimationFrame(() => {
      place();
      requestAnimationFrame(place);
    });
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
  });
  tipWrap.addEventListener("mouseleave", cleanup);
}

function buildStoriesDetailContent(story, company, options = {}) {
  const detail = document.createElement("div");
  detail.className = "sc-card-detail";
  const brandId = company?.id || storiesCustomerBrandId;

  const audiences =
    !options.hideSeenBy && Array.isArray(story.audiences)
      ? story.audiences.filter((a) => String(a.title || "").trim())
      : [];

  const buildSummaryBlock = () => {
    const summaryText = String(story.summary || "").trim();
    if (!summaryText) return null;
    const summaryWrap = document.createElement("div");
    const detailHead = document.createElement("div");
    detailHead.className = "sc-detail-head";
    const label = document.createElement("div");
    label.className = "sc-detail-label";
    setText(label, "Summary");
    detailHead.appendChild(label);
    const summary = document.createElement("p");
    summary.className = "sc-detail-summary";
    setText(summary, summaryText);
    if (summaryText.length > 140) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "customer-mobile-audience-expand";
      toggle.setAttribute("aria-label", "Show more");
      toggle.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const isExpanded = summary.classList.toggle("is-expanded");
        toggle.classList.toggle("is-expanded", isExpanded);
        toggle.setAttribute(
          "aria-label",
          isExpanded ? "Show less" : "Show more",
        );
      });
      detailHead.appendChild(toggle);
    }
    summaryWrap.appendChild(detailHead);
    summaryWrap.appendChild(summary);
    return summaryWrap;
  };

  const conversationPosts = Array.isArray(story?.posts) ? story.posts : [];

  const buildSeenByBlock = () => {
    if (!audiences.length) return null;
    const row = document.createElement("div");
    row.className = "sc-seen-by-row";
    const avatars = document.createElement("div");
    avatars.className = "sc-seen-by-avatars";
    const visibleAudiences = audiences.slice(0, 5);
    const overflowCount = audiences.length - visibleAudiences.length;
    visibleAudiences.forEach((aud, i) => {
      const av = document.createElement("span");
      av.className = "sc-audience-av";
      av.style.background =
        STORIES_ACCENT_PALETTE[i % STORIES_ACCENT_PALETTE.length];
      av.style.marginLeft = i > 0 ? "-6px" : "0";
      av.style.zIndex = String(audiences.length - i);
      const audienceImageUrl =
        String(aud.member_image_url || "").trim() || null;
      if (audienceImageUrl) {
        const img = document.createElement("img");
        img.src = audienceImageUrl;
        img.alt = "";
        img.onerror = () => {
          img.remove();
          setText(av, (aud.title || "?")[0].toUpperCase());
        };
        av.appendChild(img);
      } else {
        setText(av, (aud.title || "?")[0].toUpperCase());
      }
      avatars.appendChild(av);
    });
    if (overflowCount > 0) {
      const overflow = document.createElement("span");
      overflow.className = "sc-audience-av sc-audience-overflow";
      overflow.style.marginLeft = "-6px";
      overflow.style.zIndex = "0";
      setText(overflow, `+${overflowCount}`);
      avatars.appendChild(overflow);
    }
    row.appendChild(avatars);
    const text = document.createElement("span");
    text.className = "sc-seen-by-text";
    const seenByLabel = brandId
      ? `Seen by ${audiences.length} brand audience${audiences.length === 1 ? "" : "s"}`
      : `Seen by ${audiences.length} audience${audiences.length === 1 ? "" : "s"}`;
    setText(text, seenByLabel);
    row.appendChild(text);
    const tipWrap = document.createElement("span");
    tipWrap.className = "sc-seen-by-tip-wrap";
    tipWrap.innerHTML =
      '<svg class="sc-seen-by-tip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>';
    const tooltip = document.createElement("div");
    tooltip.className = "sc-seen-by-tooltip";
    audiences.forEach((aud) => {
      const line = document.createElement("div");
      setText(line, aud.title || "Unknown");
      tooltip.appendChild(line);
    });
    tipWrap.appendChild(tooltip);
    bindSeenByTooltip(tipWrap, tooltip);
    row.appendChild(tipWrap);
    return row;
  };

  const buildConversationBlock = () => {
    if (!conversationPosts.length) return null;
    const conversationWrap = document.createElement("div");
    conversationWrap.className = "sc-detail-col sc-detail-col-conversation";
    const conversationLabel = document.createElement("div");
    conversationLabel.className = "sc-detail-label";
    setText(conversationLabel, "IN THE CONVERSATION");
    conversationWrap.appendChild(conversationLabel);
    conversationWrap.appendChild(
      buildStoryPostList(
        conversationPosts,
        "",
        options.showAllPosts ? 0 : options.viewInStories ? 3 : 0,
      ),
    );
    return conversationWrap;
  };

  if (options.contentMode) {
    const summaryWrap = buildSummaryBlock();
    const seenBy = buildSeenByBlock();
    if (summaryWrap || seenBy) {
      const intro = document.createElement("div");
      intro.className = "sc-detail-columns content-story-summary-seen";
      if (summaryWrap) {
        const summaryCol = document.createElement("div");
        summaryCol.className = "sc-detail-col sc-detail-col-summary";
        summaryCol.appendChild(summaryWrap);
        intro.appendChild(summaryCol);
      }
      if (seenBy) intro.appendChild(seenBy);
      detail.appendChild(intro);
    }
    const conversation = buildConversationBlock();
    if (conversation) detail.appendChild(conversation);
  } else {
    const seenBy = buildSeenByBlock();
    if (seenBy) detail.appendChild(seenBy);
    const summaryWrap = buildSummaryBlock();
    if (summaryWrap) detail.appendChild(summaryWrap);
    if (conversationPosts.length) {
      const columns = document.createElement("div");
      columns.className = "sc-detail-columns";
      const conversation = buildConversationBlock();
      if (conversation) columns.appendChild(conversation);
      if (columns.childElementCount) detail.appendChild(columns);
    }

    const actions = document.createElement("div");
    actions.className = "sc-card-actions";
    if (options.hideActions) {
      return detail;
    }
    if (options.viewInStories) {
      const linkBtn = document.createElement("button");
      linkBtn.type = "button";
      linkBtn.className = "sc-sortbtn";
      setText(linkBtn, "View in Stories");
      linkBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        openStoryInCustomerStoriesView(company.id, story);
      });
      actions.appendChild(linkBtn);
      detail.appendChild(actions);
    }
  }

  return detail;
}

function buildStoriesListRow(story, selected) {
  const card = document.createElement("div");
  const tone = storyUrgency(story.story_last_seen_at).tone;
  card.className =
    `sc-card sc-list-row collapsed is-${tone}` +
    (selected ? " is-selected" : "");
  card.addEventListener("click", () => {
    storiesCustomerSelectedId = customerStoryId(story);
    renderStoriesCustomerView();
  });
  appendStoriesCardHeadAndStats(card, story);
  return card;
}

function buildStoriesDetailPane(story, company) {
  const pane = document.createElement("div");
  pane.className = "stories-desktop-detail-inner";
  const head = document.createElement("div");
  head.className = "stories-desktop-detail-head";
  const h2 = document.createElement("h2");
  setText(h2, story.headline || "Story");
  head.appendChild(h2);
  const generateBtn = buildStoriesGenerateBtn(story, company, {});
  if (generateBtn) head.appendChild(generateBtn);
  pane.appendChild(head);
  pane.appendChild(
    buildStoriesDetailContent(story, company, { hideActions: true }),
  );
  return pane;
}

const STORIES_CARD_ENTER_STAGGER_MS = 45;
const STORIES_CARD_ENTER_MAX = 8;

function stampStoriesCardEnterAnimation(container) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  container
    ?.querySelectorAll(".sc-card[data-story-id]")
    .forEach((card, index) => {
      if (index >= STORIES_CARD_ENTER_MAX) return;
      card.classList.add("is-entering");
      card.style.animationDelay = `${index * STORIES_CARD_ENTER_STAGGER_MS}ms`;
    });
}

function triggerStoryCardOpenAnimation(container, storyId) {
  const card = container?.querySelector(
    `[data-story-id="${CSS.escape(storyId)}"]`,
  );
  if (!card) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  card.classList.add("is-auto-opening");
  const shell = card.querySelector(".sc-card-detail-shell");
  const cleanup = () => {
    card.classList.remove("is-auto-opening");
    syncStoryCardDetailShell(card, true);
  };
  if (!shell) {
    window.setTimeout(cleanup, 600);
    return;
  }
  shell.addEventListener(
    "transitionend",
    (e) => {
      if (e.propertyName === "grid-template-rows") cleanup();
    },
    { once: true },
  );
  window.setTimeout(cleanup, 900);
}

function syncStoryCardDetailShell(card, expanded) {
  const shell = card.querySelector(".sc-card-detail-shell");
  if (!shell) return;
  if (!expanded) {
    shell.classList.remove("is-detail-settled");
    void shell.offsetHeight;
    return;
  }
  if (shell.classList.contains("is-detail-settled")) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    shell.classList.add("is-detail-settled");
    return;
  }
  const markSettled = () => {
    if (!card.classList.contains("collapsed")) {
      shell.classList.add("is-detail-settled");
    }
  };
  shell.addEventListener(
    "transitionend",
    (e) => {
      if (e.propertyName === "grid-template-rows") markSettled();
    },
    { once: true },
  );
  window.setTimeout(markSettled, 650);
}

function buildStoriesAccordionCard(story, company, onToggle, options) {
  const storyId = customerStoryId(story);
  const isStatic = options && options.static;
  const expanded = isStatic || storiesCustomerExpanded.has(storyId);
  const card = document.createElement("div");
  card.dataset.storyId = storyId;
  card.className = `sc-card${expanded ? "" : " collapsed"}${isStatic ? " sc-card-static" : ""}`;
  if (!isStatic) {
    card.addEventListener("click", (event) => {
      if (event.target.closest("button, a, input, select, textarea, label"))
        return;
      if (options && typeof options.onAccordionClick === "function") {
        options.onAccordionClick(storyId);
        return;
      }
      if (storiesCustomerExpanded.has(storyId)) {
        storiesCustomerExpanded.delete(storyId);
      } else {
        storiesCustomerExpanded.add(storyId);
      }
      if (onToggle) onToggle();
      else renderStoriesCustomerView();
    });
  }
  appendStoriesCardHeadAndStats(card, story, {
    generateBtn: isStatic
      ? null
      : buildStoriesGenerateBtn(story, company, options || {}),
  });
  const shell = document.createElement("div");
  shell.className = "sc-card-detail-shell";
  shell.appendChild(
    buildStoriesDetailContent(story, company, {
      ...(options || {}),
      hideActions: !(options && options.viewInStories),
    }),
  );
  card.appendChild(shell);
  if (expanded) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shell.classList.add("is-detail-settled");
    } else {
      requestAnimationFrame(() => shell.classList.add("is-detail-settled"));
    }
  }
  return card;
}

function storiesBrandPickerStatusLabel(company) {
  const trends = getStageStatus(company, "audience_trends");
  if (trends === "done") return "Stories ready";
  if (trends === "running" || trends === "pending")
    return "Collecting stories…";
  if (trends === "error") return "Setup incomplete";
  if (trends === "skipped") {
    const err = String(company.audience_trends_error || "").trim();
    if (err.includes("no homepage content")) return "Finish brand setup";
    if (err.includes("no matched")) return "Match audiences first";
    if (err) return err.length > 42 ? `${err.slice(0, 39)}…` : err;
    return "Setup required";
  }
  return "Not set up yet";
}

function storiesBrandPickerSummary(company) {
  const raw =
    String(company.brand_synthesis || "").trim() ||
    String(company.homepage_summary || "").trim();
  if (!raw) return "";
  const line = raw.replace(/\s+/g, " ").trim();
  return line.length > 110 ? `${line.slice(0, 107)}…` : line;
}

function storiesBrandPickerLogo(company) {
  const logoUrl = String(
    company.website_synthesis_business_logo_url || "",
  ).trim();
  if (logoUrl) {
    const img = document.createElement("img");
    img.className = "sc-brand-picker-logo";
    img.alt = "";
    img.src = logoUrl;
    img.referrerPolicy = "no-referrer";
    img.onerror = () => {
      const fallback = storiesBrandPickerLogoFromDomain(company);
      img.replaceWith(fallback);
    };
    return img;
  }
  return storiesBrandPickerLogoFromDomain(company);
}

function storiesBrandPickerLogoFromDomain(company) {
  const host = websiteDomain(company.website_url || "");
  if (!host) {
    return avatarFor(companyDisplayName(company), "sc-brand-picker-logo");
  }
  const img = document.createElement("img");
  img.className = "sc-brand-picker-logo";
  img.alt = "";
  img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
  img.referrerPolicy = "no-referrer";
  img.onerror = () => {
    const fallback = avatarFor(host, "sc-brand-picker-logo");
    img.replaceWith(fallback);
  };
  return img;
}

function syncStoriesCustomerLayout() {
  const app = $("app");
  if (!app) return;
  const onStories =
    currentView === "twitter" && currentTwitterSubview === "news";
  app.classList.toggle("stories-customer-mode", onStories);
  syncCustomerModeChrome();
}

function syncBrandCustomerLayout() {
  const app = $("app");
  if (!app) return;
  app.classList.toggle("brand-customer-mode", currentView === "brands");
  syncCustomerModeChrome();
}

function syncCustomerModeChrome() {
  const app = $("app");
  if (!app) return;
  const onStories =
    currentView === "twitter" && currentTwitterSubview === "news";
  const onBrands = currentView === "brands";
  const onCampaigns = currentView === "sitmar";
  app.classList.toggle("customer-mode", onStories || onBrands || onCampaigns);
  app.classList.toggle("sitmar-customer-mode", onCampaigns);
}

function buildCustomerBrandPicker(onSelect, opts = {}) {
  const wrap = document.createElement("div");
  wrap.className = "sc-brand-picker sc-brand-picker-desktop";

  const header = document.createElement("div");
  header.className = "sc-brand-picker-header";
  const heading = document.createElement("h1");
  heading.className = "sc-brand-picker-title";
  setText(heading, opts.title || "Select a brand");
  header.appendChild(heading);
  const sub = document.createElement("p");
  sub.className = "sc-brand-picker-sub";
  setText(
    sub,
    opts.subtitle || "Choose a brand to see its matched stories from X.",
  );
  header.appendChild(sub);
  wrap.appendChild(header);

  if (!companies.length) {
    const empty = document.createElement("div");
    empty.className = "sc-empty";
    setText(empty, "No brands yet. Add one from the Brands view.");
    wrap.appendChild(empty);
    return wrap;
  }

  const grid = document.createElement("div");
  grid.className = "sc-brand-picker-grid";
  companies.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sc-brand-picker-card";

    const top = document.createElement("div");
    top.className = "sc-brand-picker-card-top";
    top.appendChild(storiesBrandPickerLogo(c));

    const identity = document.createElement("div");
    identity.className = "sc-brand-picker-identity";
    const name = document.createElement("div");
    name.className = "sc-brand-picker-name";
    setText(name, companyDisplayName(c));
    identity.appendChild(name);
    const host = document.createElement("div");
    host.className = "sc-brand-picker-host";
    setText(host, websiteDomain(c.website_url) || c.website_url || "");
    identity.appendChild(host);
    top.appendChild(identity);
    btn.appendChild(top);

    const summary = storiesBrandPickerSummary(c);
    if (summary) {
      const blurb = document.createElement("p");
      blurb.className = "sc-brand-picker-blurb";
      setText(blurb, summary);
      btn.appendChild(blurb);
    }

    const meta = document.createElement("div");
    meta.className = "sc-brand-picker-meta";
    const matched = (Array.isArray(c.audience) ? c.audience : []).filter(
      (a) => a?.match?.audience_id,
    ).length;
    const audiences = document.createElement("span");
    audiences.className = "sc-brand-picker-meta-item";
    setText(
      audiences,
      matched
        ? `${matched} matched audience${matched === 1 ? "" : "s"}`
        : "No matched audiences",
    );
    meta.appendChild(audiences);
    const status = document.createElement("span");
    status.className = "sc-brand-picker-meta-item sc-brand-picker-status";
    setText(status, storiesBrandPickerStatusLabel(c));
    meta.appendChild(status);
    btn.appendChild(meta);

    btn.addEventListener("click", () => onSelect(c.id));
    grid.appendChild(btn);
  });
  wrap.appendChild(grid);
  return wrap;
}

function buildStoriesCustomerBrandPicker() {
  return buildCustomerBrandPicker(setStoriesCustomerBrand);
}

function buildBrandsCustomerBrandPicker() {
  return buildCustomerBrandPicker(selectBrand, {
    subtitle: "Choose a brand to view its profile.",
  });
}

function renderBrandsCustomerPickerView() {
  closeBrandCustomerPopover();
  syncBrandCustomerLayout();
  const root = $("detail");
  root.innerHTML = "";
  const inner = document.createElement("div");
  inner.className =
    "detail-inner brand-customer-detail stories-desktop-view sc-phone-view";

  inner.appendChild(buildBrandsCustomerBrandPicker());
  root.appendChild(inner);
}

function renderStoriesCustomerView() {
  const root = $("detail");
  root.innerHTML = "";
  syncStoriesCustomerLayout();
  const inner = document.createElement("div");
  inner.className =
    "detail-inner stories-customer-detail stories-desktop-view sc-phone-view";

  const company = companies.find((c) => c.id === storiesCustomerBrandId);
  if (!company) {
    inner.appendChild(buildStoriesCustomerBrandPicker());
    root.appendChild(inner);
    return;
  }

  if (
    !storiesCustomerFeed.length &&
    storiesCustomerHasMore &&
    !storiesCustomerLoadingMore
  ) {
    const settledCompanyId = storiesCustomerSettledCompanyId();
    const requestKey = `${storiesCustomerBrandId || ""}:${settledCompanyId ? "settled" : "trending"}`;
    if (storiesCustomerBootstrapRequestKey === requestKey) {
      return;
    }
    storiesCustomerBootstrapRequestKey = requestKey;
    storiesCustomerLoadingMore = true;
    void loadStoriesCustomerPage({ append: false })
      .then((rows) => {
        if (rows === null || !Array.isArray(rows) || rows.length === 0) {
          storiesCustomerHasMore = false;
          return;
        }
        storiesCustomerBootstrapRequestKey = "";
      })
      .finally(() => {
        storiesCustomerLoadingMore = false;
        if (currentView === "twitter" && currentTwitterSubview === "news") {
          renderStoriesCustomerView();
        }
      });
    return;
  }

  const shell = document.createElement("div");
  shell.className = "stories-desktop-shell";

  const sortBtn = document.createElement("button");
  sortBtn.type = "button";
  sortBtn.className = "sc-sortbtn";
  sortBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M6 12h12M10 18h4"/></svg>';
  const sortLabelEl = document.createElement("span");
  normalizeStoriesCustomerSortMode();
  sortBtn.setAttribute(
    "aria-label",
    "Sort stories by " + storySortLabel(storiesCustomerSortMode),
  );
  setText(sortLabelEl, storySortLabel(storiesCustomerSortMode));
  sortBtn.appendChild(sortLabelEl);
  sortBtn.addEventListener("click", () => {
    normalizeStoriesCustomerSortMode();
    const modes = storiesCustomerSortModes();
    const idx = modes.indexOf(storiesCustomerSortMode);
    storiesCustomerSortMode = modes[(idx + 1) % modes.length];
    renderStoriesCustomerView();
  });

  const titleWrap = document.createElement("div");
  titleWrap.className = "sc-title-wrap";
  const titleStack = document.createElement("div");
  titleStack.className = "sc-title-stack";
  const h1 = document.createElement("h1");
  h1.className = "sc-title-h1";
  setText(h1, "Current Stories");
  titleStack.appendChild(h1);
  const sub = document.createElement("div");
  sub.className = "sc-title-sub";
  sub.innerHTML =
    '<span class="sc-live"><span class="sc-strength sc-strength-live"><span class="sc-dot"><span class="sc-dot-ring"></span><span class="sc-dot-ring"></span><span class="sc-dot-core"></span></span></span><span>Trending on</span><svg class="sc-live-x" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.254 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg></span>';
  titleStack.appendChild(sub);
  titleWrap.appendChild(titleStack);

  const stories = storiesForDisplay(company);
  const brandAudiences = Array.isArray(company.audience)
    ? company.audience.filter((a) => a && a.match && a.match.audience_id)
    : [];
  const filtered = stories;
  const GATED_VISIBLE = 2;
  const gatedVisible = storiesCustomerGated
    ? filtered.slice(0, GATED_VISIBLE)
    : filtered;

  const listHead = document.createElement("div");
  listHead.className = "sc-listhead sc-listhead-actions";
  const controls = document.createElement("div");
  controls.className = "sc-list-controls";
  const filterBtn = document.createElement("button");
  filterBtn.type = "button";
  filterBtn.className =
    "sc-sortbtn" + (storiesCustomerFilters.size ? " active" : "");
  filterBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 5h18l-7 8v5l-4 2v-7z"/></svg>';
  const filterLabel = document.createElement("span");
  setText(
    filterLabel,
    storiesCustomerFilters.size
      ? `Filter (${storiesCustomerFilters.size})`
      : "Filter",
  );
  filterBtn.appendChild(filterLabel);
  filterBtn.addEventListener("click", () =>
    openStoriesCustomerFilterModal(brandAudiences),
  );
  controls.appendChild(filterBtn);
  controls.appendChild(sortBtn);
  listHead.appendChild(controls);

  const narrow = storiesCustomerNarrow();
  if (narrow) {
    shell.appendChild(titleWrap);
  } else {
    listHead.classList.add("sc-listhead-with-title");
    listHead.prepend(titleStack);
  }
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "sc-empty";
    setText(
      empty,
      storiesCustomerEmptyMessage({
        audienceFilterEmpty: !!storiesCustomerFeed.length,
      }),
    );
    shell.appendChild(listHead);
    shell.appendChild(empty);
  } else if (narrow) {
    if (
      !storiesCustomerAutoOpened &&
      storiesCustomerExpanded.size === 0 &&
      gatedVisible.length > 0
    ) {
      storiesCustomerExpanded.add(customerStoryId(gatedVisible[0]));
      storiesCustomerAutoOpened = true;
    }
    const pad = document.createElement("div");
    pad.className = "sc-pad stories-desktop-narrow-feed";
    gatedVisible.forEach((story) =>
      pad.appendChild(buildStoriesAccordionCard(story, company)),
    );
    if (storiesCustomerGated && filtered.length > GATED_VISIBLE) {
      const gated = filtered.slice(GATED_VISIBLE, GATED_VISIBLE + 8);
      const gateCta = buildStoriesGateCTA();
      gated.forEach((story, index) => {
        const card = buildStoriesAccordionCard(story, company);
        card.classList.add("sc-card-gated");
        pad.appendChild(
          index === 0 ? wrapStoriesGateAnchor(card, gateCta) : card,
        );
      });
    }
    if (!storiesCustomerGated) bindStoriesCustomerListScroll(pad);
    shell.appendChild(listHead);
    shell.appendChild(pad);
  } else {
    const selectedStory = ensureStoriesCustomerSelection(gatedVisible);
    const body = document.createElement("div");
    body.className = "stories-desktop-body";

    const listCol = document.createElement("div");
    listCol.className = "stories-desktop-listcol";
    const list = document.createElement("div");
    list.className = "stories-desktop-list sc-pad";
    gatedVisible.forEach((story) => {
      const storyId = customerStoryId(story);
      list.appendChild(
        buildStoriesListRow(story, storyId === storiesCustomerSelectedId),
      );
    });
    if (storiesCustomerGated && filtered.length > GATED_VISIBLE) {
      const gated = filtered.slice(GATED_VISIBLE, GATED_VISIBLE + 8);
      const gateCta = buildStoriesGateCTA();
      gated.forEach((story, index) => {
        const row = buildStoriesListRow(story, false);
        row.classList.add("sc-card-gated");
        list.appendChild(
          index === 0 ? wrapStoriesGateAnchor(row, gateCta) : row,
        );
      });
    }
    if (!storiesCustomerGated) bindStoriesCustomerListScroll(list);
    listCol.appendChild(listHead);
    listCol.appendChild(list);

    const detail = document.createElement("div");
    detail.className = "stories-desktop-detail";
    if (selectedStory) {
      const selectedStoryId = customerStoryId(selectedStory);
      const loadedDetail = storiesCustomerDetailCache.get(selectedStoryId);
      if (loadedDetail) {
        detail.appendChild(
          buildStoriesDetailPane(
            {
              ...selectedStory,
              ...loadedDetail.story,
              posts: loadedDetail.posts,
              audiences: loadedDetail.audiences.length
                ? loadedDetail.audiences
                : selectedStory.audiences,
            },
            company,
          ),
        );
      } else {
        void ensureStoriesCustomerDetail(selectedStoryId);
        detail.appendChild(buildStoriesDetailPane(selectedStory, company));
      }
    } else {
      const emptyDetail = document.createElement("div");
      emptyDetail.className = "sc-empty stories-desktop-detail-empty";
      setText(emptyDetail, "Select a story from the list.");
      detail.appendChild(emptyDetail);
    }

    body.appendChild(listCol);
    body.appendChild(detail);
    shell.appendChild(body);
  }

  inner.appendChild(shell);
  root.appendChild(inner);
}

// --- campaigns customer view ---

function campaignStatusLabel(status) {
  if (status === "posted") return "Posted";
  if (status === "done") return "Done";
  if (status === "rendering") return "Rendering";
  if (status === "thinking") return "Thinking";
  if (status === "ready") return "Draft";
  if (status === "error") return "Error";
  return status || "—";
}

function campaignStatusTone(status) {
  if (status === "posted") return "done";
  if (status === "done") return "done";
  if (status === "rendering") return "rendering";
  if (status === "thinking") return "thinking";
  if (status === "error") return "error";
  return "draft";
}

function ensureCampaignDetail(campaignId) {
  if (campaignsCustomerCache.has(campaignId)) return;
  if (campaignsCustomerInFlight.has(campaignId)) return;
  campaignsCustomerInFlight.add(campaignId);
  api(`/api/sitmar/${encodeURIComponent(campaignId)}`, { method: "GET" })
    .then(({ ok, body }) => {
      campaignsCustomerInFlight.delete(campaignId);
      if (ok && body && body.campaign) {
        campaignsCustomerCache.set(campaignId, body.campaign);
        if (currentView === "sitmar") {
          renderCampaignsCustomerView();
        }
      }
    })
    .catch(() => {
      campaignsCustomerInFlight.delete(campaignId);
    });
}

function buildCampaignCard(campaign, index) {
  const detail = campaignsCustomerCache.get(campaign.id);
  const merged = detail || campaign;
  const isExpanded = campaignsCustomerExpanded.has(campaign.id);

  const card = document.createElement("div");
  card.className = "cc-card" + (isExpanded ? "" : " collapsed");

  const seed = merged.selected_seed || {};

  // single head row: [thumb?] [text stack: title / story / meta] [chevron]
  const head = document.createElement("div");
  head.className = "cc-card-head";

  if (merged.status === "done" && seed.image_url) {
    const thumb = document.createElement("img");
    thumb.className = "cc-card-thumb";
    thumb.src = seed.image_url;
    thumb.alt = "";
    head.appendChild(thumb);
  }

  const textStack = document.createElement("div");
  textStack.className = "cc-card-text";

  const title = document.createElement("div");
  title.className = "cc-card-title";
  setText(title, merged.title || "Campaign");
  textStack.appendChild(title);

  if (merged.story_title) {
    const storyRow = document.createElement("div");
    storyRow.className = "cc-card-story";
    setText(storyRow, merged.story_title);
    textStack.appendChild(storyRow);
  }

  const meta = document.createElement("div");
  meta.className = "cc-card-meta";
  if (merged.created_at) {
    const ts = document.createElement("span");
    ts.className = "cc-meta-time";
    setText(ts, relativeTime(merged.created_at));
    meta.appendChild(ts);
  }
  textStack.appendChild(meta);
  head.appendChild(textStack);

  const chev = document.createElement("span");
  chev.className = "cc-card-chev";
  chev.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M8 9l4 4 4-4"/></svg>';
  head.appendChild(chev);

  card.appendChild(head);

  // expandable detail
  const detailEl = document.createElement("div");
  detailEl.className = "cc-card-detail";

  if (seed.title) {
    const seedTitle = document.createElement("div");
    seedTitle.className = "cc-seed-title";
    setText(seedTitle, seed.title);
    detailEl.appendChild(seedTitle);
  }
  if (seed.blurb) {
    const seedBlurb = document.createElement("div");
    seedBlurb.className = "cc-seed-blurb";
    setText(seedBlurb, seed.blurb);
    detailEl.appendChild(seedBlurb);
  }

  const ba = merged.brand_audience || {};
  if (ba.title) {
    const inhouse = merged.inhouse_audience || {};
    const seenLabel = document.createElement("div");
    seenLabel.className = "sc-detail-label";
    setText(seenLabel, "Seen by");
    detailEl.appendChild(seenLabel);
    const chips = document.createElement("div");
    chips.className = "sc-audience-chips";
    const chip = document.createElement("span");
    chip.className = "sc-audience-chip";
    const av = avatarFor(
      ba.member_handle || inhouse.member_handle || ba.title || "?",
      "sc-audience-av",
      ba.member_image_url || inhouse.member_image_url || null,
    );
    chip.appendChild(av);
    chip.appendChild(document.createTextNode(ba.title));
    chips.appendChild(chip);
    detailEl.appendChild(chips);
  }

  if (merged.story_summary) {
    const sumLabel = document.createElement("div");
    sumLabel.className = "sc-detail-label";
    setText(sumLabel, "STORY");
    detailEl.appendChild(sumLabel);
    const sumText = document.createElement("div");
    sumText.className = "cc-detail-summary";
    const full = merged.story_summary;
    const truncated = full.length > 140;
    setText(sumText, truncated ? full.slice(0, 140) + "…" : full);
    if (truncated) {
      sumText.classList.add("is-truncated");
      sumText.addEventListener("click", (e) => {
        e.stopPropagation();
        if (sumText.classList.contains("is-expanded")) {
          setText(sumText, full.slice(0, 140) + "…");
          sumText.classList.remove("is-expanded");
        } else {
          setText(sumText, full);
          sumText.classList.add("is-expanded");
        }
      });
    }
    detailEl.appendChild(sumText);
  }

  card.appendChild(detailEl);

  // click to toggle
  card.addEventListener("click", (e) => {
    if (e.target.closest("a, button, img.cc-hero-img")) return;
    if (isExpanded) {
      campaignsCustomerExpanded.delete(campaign.id);
    } else {
      campaignsCustomerExpanded.add(campaign.id);
    }
    renderCampaignsCustomerView();
  });

  // trigger detail fetch if not cached
  if (!detail) ensureCampaignDetail(campaign.id);

  return card;
}

function renderCampaignsCustomerView() {
  const root = $("detail");
  root.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "detail-inner campaigns-customer-detail";

  const frame = document.createElement("div");
  frame.className = "customer-mobile-frame";
  const screen = document.createElement("div");
  screen.className = "customer-mobile-screen";
  const view = document.createElement("div");
  view.className = "sc-phone-view";

  const selected = selectedSitmarId
    ? sitmarCampaigns.find((c) => c.id === selectedSitmarId) || null
    : null;

  if (!selected) {
    sitmarDetailCampaign = null;

    const sortBtn = document.createElement("button");
    sortBtn.type = "button";
    sortBtn.className = "sc-sortbtn";
    sortBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M6 12h12M10 18h4"/></svg>';
    const sortLabel = document.createElement("span");
    setText(sortLabel, "Sort");
    sortBtn.appendChild(sortLabel);
    sortBtn.addEventListener("click", () => {
      campaignsCustomerSortMode =
        campaignsCustomerSortMode === "recent" ? "status" : "recent";
      renderCampaignsCustomerView();
    });

    const titleWrap = document.createElement("div");
    titleWrap.className = "sc-title-wrap";
    const titleStack = document.createElement("div");
    titleStack.className = "sc-title-stack";
    const h1 = document.createElement("h1");
    h1.className = "sc-title-h1";
    setText(h1, "Campaigns");
    titleStack.appendChild(h1);
    const ccSub = document.createElement("div");
    ccSub.className = "cc-title-sub";
    setText(ccSub, "Original posts, drafted in your voice");
    titleStack.appendChild(ccSub);
    titleWrap.appendChild(titleStack);
    titleWrap.appendChild(sortBtn);
    view.appendChild(titleWrap);

    const cta = document.createElement("button");
    cta.type = "button";
    cta.className = "sc-generate-btn cc-cta";
    const ctaLabel = document.createElement("span");
    ctaLabel.className = "sc-generate-label";
    setText(ctaLabel, "Start a campaign");
    cta.appendChild(ctaLabel);
    const ctaArrow = document.createElement("span");
    ctaArrow.className = "sc-generate-arrow";
    ctaArrow.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
    cta.appendChild(ctaArrow);
    cta.addEventListener("click", () =>
      openAddSitmarModal({ mode: "customer_preview" }),
    );
    view.appendChild(cta);

    let sorted = company
      ? sitmarCampaigns.filter((campaign) => campaign.company_id === company.id)
      : [...sitmarCampaigns];
    if (campaignsCustomerSortMode === "status") {
      const order = { done: 0, rendering: 1, thinking: 2, ready: 3, error: 4 };
      sorted.sort(
        (a, b) =>
          (order[a.status] ?? 5) - (order[b.status] ?? 5) ||
          (b.created_at || 0) - (a.created_at || 0),
      );
    } else {
      sorted.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    }

    const feedNote = document.createElement("div");
    feedNote.className = "sc-feednote";
    setText(
      feedNote,
      `${sorted.length} campaign${sorted.length !== 1 ? "s" : ""}`,
    );
    view.appendChild(feedNote);

    const pad = document.createElement("div");
    pad.className = "sc-pad";
    if (sorted.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sc-empty";
      setText(empty, "No campaigns yet.");
      pad.appendChild(empty);
    } else {
      sorted.forEach((c, i) => pad.appendChild(buildCampaignCard(c, i)));
    }
    view.appendChild(pad);

    screen.appendChild(view);
    frame.appendChild(screen);
    inner.appendChild(frame);
    root.appendChild(inner);
    return;
  }

  selectedSitmarId = selected.id;
  ensureCampaignDetail(selected.id);
  const campaign = campaignsCustomerCache.get(selected.id) || selected;
  sitmarDetailCampaign = campaign;
  inner.appendChild(sitmarHeaderRow(campaign));

  const storyRow = document.createElement("div");
  storyRow.className = "cc-story-row";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "cc-back-btn";
  backBtn.setAttribute("aria-label", "Back to campaigns");
  backBtn.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  backBtn.addEventListener("click", () => {
    selectedSitmarId = null;
    renderCampaignsCustomerView();
  });
  storyRow.appendChild(backBtn);

  const storyExpanded = campaignsCustomerExpanded.has(campaign.id);
  const storyCard = document.createElement("button");
  storyCard.type = "button";
  storyCard.className = "cc-story-card" + (storyExpanded ? "" : " collapsed");
  const storyHead = document.createElement("div");
  storyHead.className = "cc-story-head";
  const storyTitle = document.createElement("div");
  storyTitle.className = "cc-story-title";
  setText(storyTitle, campaign.story_title || "Story");
  storyHead.appendChild(storyTitle);
  const storyChev = document.createElement("span");
  storyChev.className = "cc-story-chev";
  storyChev.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M8 9l4 4 4-4"/></svg>';
  storyHead.appendChild(storyChev);
  storyCard.appendChild(storyHead);
  const storySummary = document.createElement("div");
  storySummary.className = "cc-story-summary";
  setText(
    storySummary,
    String(campaign.story_summary || "").trim() || "No summary available.",
  );
  storyCard.appendChild(storySummary);
  storyCard.addEventListener("click", () => {
    if (storyExpanded) campaignsCustomerExpanded.delete(campaign.id);
    else campaignsCustomerExpanded.add(campaign.id);
    renderCampaignsCustomerView();
  });
  storyRow.appendChild(storyCard);
  view.appendChild(storyRow);

  const body = document.createElement("div");
  body.className = "cc-chat-body";
  if (campaign.status === "error") {
    const err = document.createElement("div");
    err.className = "field-error";
    setText(err, campaign.error || "Campaign generation failed.");
    body.appendChild(err);
  } else if (campaign.status === "rendering") {
    renderSitmarDrafting(body);
  } else if (campaign.status === "done") {
    renderSitmarTweets(campaign, body);
  } else {
    renderSitmarChat(campaign, body);
  }
  view.appendChild(body);

  screen.appendChild(view);
  frame.appendChild(screen);
  inner.appendChild(frame);
  root.appendChild(inner);
}

function renderTrendingDetail(
  story,
  posts,
  audiences = [],
  brandScores = [],
  aliases = [],
) {
  renderStoriesCustomerView();
  return;

  const root = $("detail");
  root.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "detail-inner";

  inner.appendChild(buildTrendStoryHeader(story));

  if (story.summary) {
    const summary = section("Grok summary", "");
    const summaryBody = summary.querySelector(".section-body");
    appendProseParagraphs(summaryBody, story.summary);
    inner.appendChild(summary);
  }

  const storyAliases = Array.isArray(aliases)
    ? aliases.filter((alias) => String(alias.headline || "").trim())
    : [];
  if (storyAliases.length) {
    const aliasesSection = section(
      `Also known as (${storyAliases.length})`,
      "",
    );
    const aliasesBody = aliasesSection.querySelector(".section-body");
    storyAliases.forEach((alias) => {
      const row = document.createElement("div");
      row.className = "trend-brand-score-row";
      const headline = document.createElement("span");
      headline.className = "trend-brand-score-name";
      setText(headline, String(alias.headline || "").trim());
      const meta = document.createElement("span");
      meta.className = "trend-brand-score-value";
      setText(meta, trendAliasScoreText(alias));
      row.appendChild(headline);
      row.appendChild(meta);
      aliasesBody.appendChild(row);
    });
    inner.appendChild(aliasesSection);
  }

  const seenAudiences = (audiences || []).filter((a) =>
    String(a.title || "").trim(),
  );
  const insightsGrid = document.createElement("div");
  insightsGrid.className = "trend-insights-grid";
  const seen = section(`Seen by (${seenAudiences.length})`, "");
  const seenBody = seen.querySelector(".section-body");
  if (seenAudiences.length) {
    seenAudiences.forEach((audience) => {
      const row = document.createElement("div");
      row.className = "trend-seen-row";
      row.appendChild(
        avatarFor(
          audience.member_handle || audience.title || "?",
          "trend-seen-avatar",
          audience.member_image_url || null,
        ),
      );
      const title = document.createElement("div");
      title.className = "trend-seen-title";
      setText(title, String(audience.title || "").trim());
      row.appendChild(title);
      seenBody.appendChild(row);
    });
  } else {
    const empty = document.createElement("div");
    empty.className = "sidebar-empty";
    setText(empty, "No audience sightings.");
    seenBody.appendChild(empty);
  }
  insightsGrid.appendChild(seen);
  const scores = section(`Brand scores (${(brandScores || []).length})`, "");
  const scoresBody = scores.querySelector(".section-body");
  if (Array.isArray(brandScores) && brandScores.length) {
    brandScores.forEach((row) => {
      const item = document.createElement("div");
      item.className = "trend-brand-score-row";
      const name = document.createElement("span");
      name.className = "trend-brand-score-name";
      setText(
        name,
        String(
          row.brand_name || row.website_url || row.brand_id || "Unknown brand",
        ),
      );
      const score = document.createElement("span");
      const percent = trendBrandScorePercent(row.score);
      score.className = `trend-brand-score-value ${trendBrandScoreTone(percent)}`;
      if (percent !== null)
        score.style.setProperty("--score-pct", `${percent}%`);
      setText(score, percent === null ? "—" : `${percent}%`);
      item.appendChild(name);
      item.appendChild(score);
      scoresBody.appendChild(item);
    });
  } else {
    const empty = document.createElement("div");
    empty.className = "sidebar-empty";
    setText(empty, "No brand scores yet.");
    scoresBody.appendChild(empty);
  }
  insightsGrid.appendChild(scores);

  const sec = section(`Linked posts (${posts.length})`, "");
  sec.classList.add("trend-linked-posts-section");
  const body = sec.querySelector(".section-body");
  if (posts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sidebar-empty";
    setText(empty, "No linked posts found for this story yet.");
    body.appendChild(empty);
  } else {
    posts.forEach((post) => body.appendChild(renderTrendPostCard(post)));
  }
  insightsGrid.appendChild(sec);
  inner.appendChild(insightsGrid);

  root.appendChild(inner);
}

async function selectTrendingStory(storyId) {
  selectedTrendStoryId = storyId;
  renderNewsSidebar();
  try {
    const { ok, status, body } = await api(
      `/api/trends/story/${encodeURIComponent(storyId)}?limit=50`,
      { method: "GET" },
    );
    if (status === 401) {
      showLogin();
      return;
    }
    if (!ok) {
      renderError(apiErrorMessage(body, "Story not found."));
      return;
    }
    trendStoryDetail = body;
    renderTrendingDetail(
      body.story,
      body.posts || [],
      body.audiences || [],
      body.brand_scores || [],
      body.aliases || [],
    );
  } catch (err) {
    renderError("Network error: " + err.message);
  }
}

function appendChipRow(parent, values) {
  if (!values || values.length === 0) return;
  const row = document.createElement("div");
  row.className = "chip-row";
  values.forEach((value) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    setText(chip, value);
    row.appendChild(chip);
  });
  parent.appendChild(row);
}
