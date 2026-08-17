// ============================================================
// global state
// ============================================================

let currentView = "brands";
let currentTwitterSubview = "news";
let dashboardRightMode = "chat";
let companies = [];
let waitlistEntries = [];
let waitlistRemoteCount = null;
let waitlistStoredCount = null;
let audiences = [];
let trendsStories = [];
const TREND_STORIES_PAGE_SIZE = 10;
const BRAND_STORIES_PAGE_SIZE = 10;
let trendsStoriesOffset = 0;
let trendsStoriesHasMore = true;
let trendsStoriesLoadingMore = false;
let trendStoryDetail = null;
let trendingPosts = [];
let selectedPostId = null;
let selectedBrandId = null;
let selectedAudienceId = null;
let sitmarCampaigns = [];
let selectedSitmarId = null;
let sitmarStorySortMode = "recency";
let pendingSitmarJobs = new Set();
let sitmarPollTimer = null;
let sitmarPollInFlight = false;
let editingAudienceTitleId = null;
let editingAudienceDescriptionId = null;
let audienceTitleDraft = "";
let audienceDescriptionDraft = "";
const audienceNewsCache = new Map();
const audienceNewsInFlight = new Set();
let selectedTrendStoryId = null;
let selectedTrendingPostId = null;
let activeTrendAudienceFilters = new Set();
let trendSortMode = "recency";
let trendFilterModalOpen = false;
let audienceTrendsSortMode = "posts";
let postDetail = null;
let activePollTimer = null;
let healthPollTimer = null;
let healthPollIntervalMs = 15000;
let statusPollTimer = null;
let preBrandOnboardingStatusMessage = "";
const PRE_BRAND_ONBOARDING_FALLBACK = "Working...";
const EXISTING_BRAND_ONBOARDING_MESSAGE = "Brand found in database! Loading...";
const EXISTING_BRAND_OVERLAY_HOLD_MS = 1000;
let preBrandExistingBrandId = "";

function clearPreBrandOnboardingStatusMessage() {
  preBrandOnboardingStatusMessage = "";
}

function setPreBrandExistingBrandLoad(companyId) {
  preBrandExistingBrandId = String(companyId || "").trim();
  preBrandOnboardingStatusMessage = EXISTING_BRAND_ONBOARDING_MESSAGE;
}

function clearPreBrandExistingBrandLoad() {
  preBrandExistingBrandId = "";
}

function preBrandOverlayCompany() {
  const id =
    preBrandExistingBrandId ||
    (typeof preBrandInProgressCompany === "function"
      ? preBrandInProgressCompany()?.id
      : "") ||
    "";
  if (!id) return null;
  return companies.find((c) => c.id === id) || null;
}

function markDuplicateBrandOnboarding(created) {
  if (created === false) {
    preBrandOnboardingStatusMessage = EXISTING_BRAND_ONBOARDING_MESSAGE;
    return true;
  }
  return false;
}

let brandHomeChatJustUnlocked = false;

function setBrandHomeChatJustUnlocked(value) {
  brandHomeChatJustUnlocked = !!value;
}

function consumeBrandHomeChatJustUnlocked() {
  if (!brandHomeChatJustUnlocked) return false;
  brandHomeChatJustUnlocked = false;
  return true;
}

const brandSectionOpenState = new Set();
const STORIES_BRAND_KEY = "melea:stories_brand_id";
const COMPANY_ID_KEY = "melea:company_id";
const STORIES_FILTER_MODAL_ID = "stories-customer-filter-modal";
const STORIES_CUSTOMER_SORT_MODES = [
  "recency",
  "activity",
];
const CONTENT_DESKTOP_SORT_MODES = [
  "recency",
  "activity",
  "brand_score",
];
const CONTENT_DESKTOP_BRAND_KEY = "reactionEngine.contentBrandId";
let storiesCustomerBrandId = (() => {
  try {
    return localStorage.getItem(STORIES_BRAND_KEY) || "";
  } catch (_) {
    return "";
  }
})();
let storiesCustomerFilters = new Set();
let storiesCustomerSortMode = "recency";
let storiesCustomerSelectedId = "";
let storiesCustomerExpanded = new Set();
let storiesCustomerAutoOpened = false;
let pageFadeInComplete = false;
let brandHomeDesktopStoriesAutoOpened = false;
// true while a campaign create POST is in flight after optimistically sliding into content-gen
let brandHomeContentGenStarting = false;

const STORIES_ACCENT_PALETTE = [
  "#4f6bff",
  "#8b5cf6",
  "#0d9488",
  "#d97706",
  "#db2777",
  "#2563eb",
  "#059669",
  "#c026d3",
];

let campaignsCustomerExpanded = new Set();
let campaignsCustomerSortMode = "recent";
const campaignsCustomerCache = new Map();
const campaignsCustomerInFlight = new Set();
let campaignsCustomerAutoOpened = false;

let brandCustomerSelectedAudienceId = "";
let brandCustomerExpandedAudiences = new Set();
let brandCustomerAudiencesAutoOpened = false;
let brandHomeViewMode = "default";
let brandHomeStoryFocus = false;
let brandHomeContentGenCollapsed = false;
let brandHomePendingPostContent = false;
let storiesCustomerReturnBrandId = "";
let pendingBrandSelectionId = null;
let contentDesktopBrandId = loadContentDesktopBrandId();
let storiesCustomerFeed = [];
let storiesCustomerWindowIndex = 0;
let storiesCustomerOffset = 0;
let storiesCustomerHasMore = true;
let storiesCustomerLoadingMore = false;
let storiesCustomerGated = false;
const storiesCustomerDetailCache = new Map();
const storiesCustomerDetailInFlight = new Set();
let contentStoriesFeed = [];
let contentStoriesOffset = 0;
let contentStoriesHasMore = true;
let contentStoriesLoadingMore = false;

const NAV_STATE_KEY = "reactionEngine.navState";
const brandAudiencesCache = new Map();
const brandAudiencesInFlight = new Set();
const brandAudiencesFetchedAt = new Map();

function loadContentDesktopBrandId() {
  try {
    return localStorage.getItem(CONTENT_DESKTOP_BRAND_KEY) || "";
  } catch (_) {
    return "";
  }
}

function setContentDesktopBrand(brandId) {
  if (contentDesktopBrandId === (brandId || "")) return;
  contentDesktopBrandId = brandId || "";
  contentStoriesFeed = [];
  contentStoriesOffset = 0;
  contentStoriesHasMore = true;
  contentStoriesLoadingMore = false;
  contentDesktopSelectedCampaignId = "";
  contentDesktopDetailCampaign = null;
  contentDesktopBody = null;
  try {
    localStorage.setItem(CONTENT_DESKTOP_BRAND_KEY, contentDesktopBrandId);
  } catch (_) {}
  if (currentView === "sitmar") {
    renderContentDesktopView();
  }
}

function currentContentDesktopBrand() {
  if (contentDesktopBrandId) {
    const company = companies.find((row) => row.id === contentDesktopBrandId);
    if (company) return company;
  }
  const first = companies[0] || null;
  if (first && contentDesktopBrandId !== first.id) {
    contentDesktopBrandId = first.id;
    try {
      localStorage.setItem(CONTENT_DESKTOP_BRAND_KEY, contentDesktopBrandId);
    } catch (_) {}
  }
  return first;
}

function syncContentDesktopLayout() {
  const app = $("app");
  if (!app) return;
  app.classList.toggle("content-desktop-mode", currentView === "sitmar");
}

function storedCompanyId() {
  try {
    return (
      localStorage.getItem(COMPANY_ID_KEY) ||
      localStorage.getItem(STORIES_BRAND_KEY) ||
      loadNavState().brandId ||
      ""
    );
  } catch (_) {
    return "";
  }
}

function setStoredCompanyId(companyId) {
  try {
    const id = String(companyId || "").trim();
    if (id) {
      localStorage.setItem(COMPANY_ID_KEY, id);
      localStorage.setItem(STORIES_BRAND_KEY, id);
    } else {
      localStorage.removeItem(COMPANY_ID_KEY);
      localStorage.removeItem(STORIES_BRAND_KEY);
    }
  } catch (_) {}
}

function setStoriesCustomerBrand(brandId) {
  storiesCustomerBrandId = brandId || "";
  storiesCustomerFilters = new Set();
  storiesCustomerFeed = [];
  storiesCustomerWindowIndex = 0;
  storiesCustomerOffset = 0;
  storiesCustomerHasMore = true;
  storiesCustomerLoadingMore = false;
  storiesCustomerGated = false;
  storiesCustomerDetailCache.clear();
  storiesCustomerDetailInFlight.clear();
  storiesCustomerSelectedId = "";
  storiesCustomerExpanded = new Set();
  storiesCustomerAutoOpened = false;
  brandHomeDesktopStoriesAutoOpened = false;
  try {
    localStorage.setItem(STORIES_BRAND_KEY, storiesCustomerBrandId);
  } catch (_) {}
  renderStoriesCustomerView();
}

function customerStoryTimeMs(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function customerStoryAgeLabel(value) {
  const ms = customerStoryTimeMs(value);
  if (!ms) return "";
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} mo ago`;
  const yr = Math.floor(mo / 12);
  return `${yr} yr${yr === 1 ? "" : "s"} ago`;
}

function customerBrandScoreBucket(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n >= 0.75) return { tier: "extreme", label: "extreme", fill: 100 };
  if (n >= 0.5) return { tier: "good", label: "good", fill: 75 };
  if (n >= 0.25) return { tier: "med", label: "med", fill: 50 };
  return { tier: "bad", label: "bad", fill: 25 };
}

function meetsBrandScoreThreshold(score) {
  const n = Number(score);
  return Number.isFinite(n) && n >= 0.1;
}

async function fetchBrandAudiencesForCompany(companyId, { force = false } = {}) {
  if (!companyId) return [];
  if (!force) {
    const fetchedAt = brandAudiencesFetchedAt.get(companyId) || 0;
    if (fetchedAt && Date.now() - fetchedAt <= 15000) {
      return brandAudiencesCache.get(companyId) || [];
    }
    if (brandAudiencesInFlight.has(companyId)) {
      return brandAudiencesCache.get(companyId) || [];
    }
  }
  brandAudiencesInFlight.add(companyId);
  try {
    const { ok, status, body } = await api(
      `/api/company/${encodeURIComponent(companyId)}/brand-audiences`,
      { method: "GET" },
    );
    if (status === 401) {
      showLogin();
      return brandAudiencesCache.get(companyId) || [];
    }
    if (!ok || !body) {
      return brandAudiencesCache.get(companyId) || [];
    }
    const audiences = Array.isArray(body.audiences) ? body.audiences : [];
    brandAudiencesCache.set(companyId, audiences);
    brandAudiencesFetchedAt.set(companyId, Date.now());
    return audiences;
  } catch (_) {
    return brandAudiencesCache.get(companyId) || [];
  } finally {
    brandAudiencesInFlight.delete(companyId);
  }
}

async function ensureBrandAudiences(companyId) {
  if (!companyId) return;
  const audiences = await fetchBrandAudiencesForCompany(companyId);
  if (!audiences.length) return;
  if (currentView === "brands" && selectedBrandId === companyId) {
    const company = companies.find((row) => row.id === companyId);
    if (company) {
      if (!renderBrandHomeAudiencesColOnly(company)) renderBrandDetail(company);
      else if (storiesCustomerFeed.length) {
        syncStoriesCustomerFeedAfterLoad(company);
      }
    }
  }
}

async function prefetchBrandDashboardData(companyId) {
  if (!companyId) return null;
  storiesCustomerBrandId = companyId;
  contentDesktopBrandId = companyId;
  const company = await fetchCompany(companyId);
  await Promise.all([
    fetchBrandAudiencesForCompany(companyId, { force: true }),
    typeof loadStoriesCustomerPage === "function"
      ? loadStoriesCustomerPage({ append: false })
      : Promise.resolve(),
  ]);
  if (company) {
    ensureCompanyStages(company);
    replaceCompanyInCache(company);
  }
  if (currentView === "brands" && !selectedBrandId) {
    renderBrandHomeEmpty();
    const overlayCompany = preBrandOverlayCompany();
    if (overlayCompany) applyPreBrandProgressState(overlayCompany);
  }
  return company;
}

async function finishSettledExistingBrandOverlay(companyId) {
  if (!companyId) return;
  setPreBrandExistingBrandLoad(companyId);
  try {
    await prefetchBrandDashboardData(companyId);
    await new Promise((resolve) => setTimeout(resolve, EXISTING_BRAND_OVERLAY_HOLD_MS));
  } finally {
    clearPreBrandExistingBrandLoad();
    clearPreBrandOnboardingStatusMessage();
    if (typeof completePreBrandTransition === "function") {
      await completePreBrandTransition(companyId);
    }
  }
}

function isBrandSectionOpen(stateKey) {
  return !!stateKey && brandSectionOpenState.has(stateKey);
}

function setBrandSectionOpen(stateKey, open) {
  if (!stateKey) return;
  if (open) brandSectionOpenState.add(stateKey);
  else brandSectionOpenState.delete(stateKey);
}

function initBrandDetailsToggle(details, stateKey) {
  const open = isBrandSectionOpen(stateKey);
  details.open = open;
  details.addEventListener("toggle", () => {
    setBrandSectionOpen(stateKey, details.open);
  });
}

function hasHomepageContent(company) {
  if (!company) return false;
  return !!company.has_profile;
}

function metaSearchTerms(company) {
  if (!company || !Array.isArray(company.website_synthesis_terms)) return [];
  return company.website_synthesis_terms
    .map((term) => String(term || "").trim())
    .filter(Boolean);
}


