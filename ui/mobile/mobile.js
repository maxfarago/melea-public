const $ = (sel) => document.querySelector(sel);

const BRAND_STORAGE_KEY = "mobile:selected_brand_id";
const COMPANY_ID_KEY = "melea:company_id";
const BRAND_STORIES_PAGE_SIZE = 10;
const MOBILE_ANONYMOUS_STORIES_KEY = "__anonymous__";
const MOBILE_TAB_OFFSET = { brand: 0, stories: 1, campaigns: 2 };
const STORIES_FEED_REFRESH_MS = 15000;
const STORY_NEWS_ID_RE = /^\d+$/;
const PRE_BRAND_DUMMY_AUDIENCES = [
  "Tech Early Adopters",
  "Marketing Leaders",
  "Culture & Lifestyle",
  "Industry Analysts",
];
const PRE_BRAND_PREVIEW_LIMIT = 4;
const PRE_BRAND_ONBOARDING_FALLBACK = "Working...";
const EXISTING_BRAND_ONBOARDING_MESSAGE = "Brand found in database! Loading...";
const EXISTING_BRAND_OVERLAY_HOLD_MS = 1000;
let mobilePreBrandExistingBrandId = "";
let mobilePreBrandOnboardingStatusMessage = "";
let currentUserPlan = null;
let currentSubscriptionStatus = null;
const mobileBrandAudiencesCache = new Map();
const mobileBrandAudiencesInFlight = new Set();
const mobileBrandAudiencesFetchedAt = new Map();
const MELEA_STATUS_LOGO = "/static/assets/images/melea-charmark-pulse.svg";
const MELEA_STATUS_LOGO_STATIC =
  "/static/assets/images/melea-charmark-blue.svg";

function meleaStatusLogoSrc() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? MELEA_STATUS_LOGO_STATIC
    : MELEA_STATUS_LOGO;
}
const MELEA_LOADER_LOGO = "/static/assets/images/melea-charmark-bg-light.png";
const POST_BRAND_LOADER_MIN_MS = 800;
const POST_BRAND_LOADER_TIMEOUT_MS = 10000;
const BRAND_HOME_LOGO_CROSSFADE_MS = 550;

function meleaStatusLine(
  text,
  {
    datasetKey = null,
    ariaBusy = false,
    labelClass = "",
    showLogo = true,
  } = {},
) {
  const el = document.createElement("div");
  el.className = "sitmar-ideating";
  if (!showLogo) el.classList.add("sitmar-ideating--no-logo");
  if (ariaBusy) {
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-busy", "true");
  }
  if (showLogo) {
    const logo = document.createElement("img");
    logo.className = "sitmar-ideating-logo";
    logo.src = meleaStatusLogoSrc();
    logo.alt = "";
    el.appendChild(logo);
  }
  const label = document.createElement("span");
  label.className = "sitmar-ideating-label onboarding-status-live";
  if (labelClass) label.className += ` ${labelClass}`;
  setText(label, text);
  el.appendChild(label);
  if (datasetKey) el.dataset[datasetKey] = "1";
  return el;
}

const state = {
  companies: [],
  campaigns: [],
  campaignDetailId: "",
  selectedBrandId: localStorage.getItem(BRAND_STORAGE_KEY) || "",
  activeTab: "brand",
  brandScreen: "list",
  storiesSortMode: "recency",
  storiesExpanded: new Set(),
  storiesAutoOpened: false,
  contentStudioMode: "chat",
  campaignsExpanded: new Set(),
  campaignTweetIndex: 0,
  distributeStoryCache: new Map(),
  distributeStoryInFlight: new Set(),
  distributeReplyInFlight: new Set(),
  distributeSentPosts: new Map(),
  distributeDismissed: new Set(),
  distributeQueueIndex: new Map(),
  distributeTab: "reply",
  campaignsCache: new Map(),
  campaignsInFlight: new Set(),
  campaignDetailInFlight: new Map(),
  campaignsPollTimer: null,
  storyPickerSortMode: "recency",
  memberImageCache: new Map(),
  storiesFeedCache: new Map(),
  storiesFeedOffset: new Map(),
  storiesFeedHasMore: new Map(),
  storiesFeedGated: new Map(),
  storiesFeedInFlight: new Set(),
  storiesFeedLoadingMore: new Set(),
  storiesFeedFetchedAt: new Map(),
  storiesFeedWindowIndex: new Map(),
};

let mobileStoriesLoadObserver = null;
let mobileStoriesLoadArmed = true;
let mobileCampaignStartInFlight = new Set();
let mobileHomeChatThread = null;
let mobileHomeChatScroll = null;

const MOBILE_TAB_ICON_PEOPLE_OUTLINE =
  '<path d="M256 464c-114.69 0-208-93.31-208-208S141.31 48 256 48s208 93.31 208 208-93.31 208-208 208zm0-384c-97 0-176 79-176 176s79 176 176 176 176-78.95 176-176S353.05 80 256 80z"/><path d="M323.67 292c-17.4 0-34.21-7.72-47.34-21.73a83.76 83.76 0 0 1-22-51.32c-1.47-20.7 4.88-39.75 17.88-53.62S303.38 144 323.67 144c20.14 0 38.37 7.62 51.33 21.46s19.47 33 18 53.51a84 84 0 0 1-22 51.3C357.86 284.28 341.06 292 323.67 292zm55.81-74zm-215.66 77.36c-29.76 0-55.93-27.51-58.33-61.33-1.23-17.32 4.15-33.33 15.17-45.08s26.22-18 43.15-18 32.12 6.44 43.07 18.14 16.5 27.82 15.25 45c-2.44 33.77-28.6 61.27-58.31 61.27zm256.55 59.92c-1.59-4.7-5.46-9.71-13.22-14.46-23.46-14.33-52.32-21.91-83.48-21.91-30.57 0-60.23 7.9-83.53 22.25-26.25 16.17-43.89 39.75-51 68.18-1.68 6.69-4.13 19.14-1.51 26.11a192.18 192.18 0 0 0 232.75-80.17zm-256.74 46.09c7.07-28.21 22.12-51.73 45.47-70.75a8 8 0 0 0-2.59-13.77c-12-3.83-25.7-5.88-42.69-5.88-23.82 0-49.11 6.45-68.14 18.17-5.4 3.33-10.7 4.61-14.78 5.75a192.84 192.84 0 0 0 77.78 86.64l1.79-.14a102.82 102.82 0 0 1 3.16-20.02z"/>';

const MOBILE_TAB_ICON_PEOPLE_FILL =
  '<path d="M258.9 48C141.92 46.42 46.42 141.92 48 258.9c1.56 112.19 92.91 203.54 205.1 205.1 117 1.6 212.48-93.9 210.88-210.88C462.44 140.91 371.09 49.56 258.9 48zm-3.68 152.11c.21-1.2.44-2.4.71-3.59a66.46 66.46 0 0 1 16.29-31.21c12.89-13.73 31.16-21.31 51.45-21.31a74.05 74.05 0 0 1 25.06 4.26 66.69 66.69 0 0 1 26.27 17.2 68.15 68.15 0 0 1 18 42.14 78.46 78.46 0 0 1 0 11.4 86.19 86.19 0 0 1-8.2 31q-.76 1.59-1.59 3.15c-1.11 2.07-2.3 4.1-3.58 6.06a79.47 79.47 0 0 1-8.63 11c-13.12 14-29.92 21.73-47.31 21.73a59.61 59.61 0 0 1-19.17-3.18 63.47 63.47 0 0 1-6.1-2.43 70.76 70.76 0 0 1-22.07-16.12 83.76 83.76 0 0 1-22-51.32q-.27-3.88-.18-7.68a75.62 75.62 0 0 1 1.05-11.08zm-149.73 24.34a59.87 59.87 0 0 1 5.2-20.64 56.76 56.76 0 0 1 2.78-5.3 54.49 54.49 0 0 1 7.19-9.56 55.62 55.62 0 0 1 14-10.82 56.84 56.84 0 0 1 8.11-3.64 63.85 63.85 0 0 1 33.35-2.39 57 57 0 0 1 30.78 17 57.86 57.86 0 0 1 15.41 38.62c.05 2.11 0 4.23-.15 6.38a71.58 71.58 0 0 1-6 23.84 69.49 69.49 0 0 1-5.73 10.42 65.39 65.39 0 0 1-15.76 16.57c-1.5 1.07-3.06 2.07-4.67 3.07a54.21 54.21 0 0 1-10 4.65 49.31 49.31 0 0 1-16.2 2.76c-.93 0-1.86 0-2.78-.08a47.6 47.6 0 0 1-5.48-.62 51.19 51.19 0 0 1-5.35-1.23 53.54 53.54 0 0 1-7.72-2.89c-.84-.39-1.66-.8-2.48-1.23-18-9.49-31.57-29.16-34.23-52.12-.12-1.05-.22-2.1-.29-3.16a66.59 66.59 0 0 1 .02-9.63zm53.92 178.6a177.27 177.27 0 0 1-61.94-70.65 4 4 0 0 1 1.62-5.26C117.67 316.69 141.4 311 163.82 311c17 0 30.7 2 42.69 5.88a8 8 0 0 1 2.59 13.77c-23.35 19-38.4 42.54-45.47 70.75a2.77 2.77 0 0 1-4.22 1.65zM256 432a175.12 175.12 0 0 1-65.7-12.72 4 4 0 0 1-2.4-4.46c.4-2.05.84-3.92 1.23-5.48 7.12-28.43 24.76-52 51-68.18 23.29-14.35 53-22.25 83.52-22.25 31.16 0 60 7.58 83.48 21.91a2.72 2.72 0 0 1 .91 3.67A176.1 176.1 0 0 1 256 432z"/><path d="M161 295.28a47.6 47.6 0 0 1-5.48-.62 47.6 47.6 0 0 0 5.48.62zm-26.36-117.15a55.62 55.62 0 0 0-14 10.82 54.49 54.49 0 0 0-7.19 9.56 54.49 54.49 0 0 1 7.19-9.56 55.62 55.62 0 0 1 14-10.82zm81.53 79.76a71.58 71.58 0 0 0 6-23.84c.15-2.15.2-4.27.15-6.38q.08 3.15-.15 6.38a71.58 71.58 0 0 1-6 23.84zm-81.53-79.76a56.84 56.84 0 0 1 8.11-3.64 56.84 56.84 0 0 0-8.11 3.64zm15.57 115.3a53.54 53.54 0 0 1-7.72-2.89 53.54 53.54 0 0 0 7.72 2.89zm-44.43-56.24c2.66 23 16.26 42.63 34.23 52.12-18.01-9.49-31.57-29.16-34.23-52.12zM254.34 219a83.76 83.76 0 0 0 22 51.32 70.76 70.76 0 0 0 22.07 16.12 70.76 70.76 0 0 1-22.07-16.12 83.76 83.76 0 0 1-22-51.32q-.27-3.88-.18-7.68-.09 3.75.18 7.68zm50.16 69.82a63.47 63.47 0 0 1-6.1-2.43 63.47 63.47 0 0 0 6.1 2.43zm-48.57-92.28a66.46 66.46 0 0 1 16.29-31.21 66.46 66.46 0 0 0-16.29 31.21zM375 165.46a68.15 68.15 0 0 1 18 42.14 68.15 68.15 0 0 0-18-42.14 66.69 66.69 0 0 0-26.27-17.2 66.69 66.69 0 0 1 26.27 17.2zM393 219a86.19 86.19 0 0 1-8.2 31 86.19 86.19 0 0 0 8.2-31zm-138.84-7.73a75.62 75.62 0 0 1 1.06-11.14 75.62 75.62 0 0 0-1.06 11.14zm129.03 41.89zm-176.31-64.11a57.86 57.86 0 0 1 15.41 38.62 57.86 57.86 0 0 0-15.41-38.62 57 57 0 0 0-30.78-17 57 57 0 0 1 30.78 17zM190 288a54.21 54.21 0 0 1-10 4.65 54.21 54.21 0 0 0 10-4.65zm-84.51-63.55a59.87 59.87 0 0 1 5.2-20.64 59.87 59.87 0 0 0-5.2 20.64zm89.19 60.43C193.17 286 191.61 287 190 288c1.61-1 3.17-2 4.68-3.12zm21.49-26.99a69.49 69.49 0 0 1-5.73 10.42 69.49 69.49 0 0 0 5.73-10.42zm-105.48-54.08a56.76 56.76 0 0 1 2.78-5.3 56.76 56.76 0 0 0-2.78 5.3zm83.99 81.07a65.39 65.39 0 0 0 15.76-16.57 65.39 65.39 0 0 1-15.76 16.57z"/>';

const MOBILE_TAB_ICON_LIGHTNING_LINE =
  '<path d="M5.52.359A.5.5 0 0 1 6 0h4a.5.5 0 0 1 .474.658L8.694 6H12.5a.5.5 0 0 1 .395.807l-7 9a.5.5 0 0 1-.873-.454L6.823 9.5H3.5a.5.5 0 0 1-.48-.641zM6.374 1 4.168 8.5H7.5a.5.5 0 0 1 .478.647L6.78 13.04 11.478 7H8a.5.5 0 0 1-.474-.658L9.306 1z"/>';

const MOBILE_TAB_ICON_LIGHTNING_FILL =
  '<path d="M5.52.359A.5.5 0 0 1 6 0h4a.5.5 0 0 1 .474.658L8.694 6H12.5a.5.5 0 0 1 .395.807l-7 9a.5.5 0 0 1-.873-.454L6.823 9.5H3.5a.5.5 0 0 1-.48-.641z"/>';
const MOBILE_TAB_ICON_QUILL_PEN_AI_LINE =
  "M4.7134 7.12811L4.46682 7.69379C4.28637 8.10792 3.71357 8.10792 3.53312 7.69379L3.28656 7.12811C2.84706 6.11947 2.05545 5.31641 1.06767 4.87708L0.308047 4.53922C-0.102682 4.35653 -0.102682 3.75881 0.308047 3.57612L1.0252 3.25714C2.03838 2.80651 2.84417 1.97373 3.27612 0.930828L3.52932 0.319534C3.70578 -0.106511 4.29417 -0.106511 4.47063 0.319534L4.72382 0.930828C5.15577 1.97373 5.96158 2.80651 6.9748 3.25714L7.69188 3.57612C8.10271 3.75881 8.10271 4.35653 7.69188 4.53922L6.93228 4.87708C5.94451 5.31641 5.15288 6.11947 4.7134 7.12811ZM6.33421 15.8154C6.51032 15.233 6.7072 14.6562 6.93912 14.0327C8.99484 8.50636 12.4197 5.08172 18.0129 4.21479C17.5 5.35838 17.0151 6.15301 16.5858 6.58237C16.2521 6.91603 15.9185 7.24993 15.5848 7.58407L14.1721 8.99878L15.6279 10.4535C14.4976 12.5384 12.2652 14.1979 9.75193 14.512C8.43544 14.6766 7.29345 15.1188 6.33421 15.8154ZM18 9.99658L17 8.99728C17.3331 8.66372 17.6662 8.33039 18.0027 7.99391C19.0018 6.99303 20.0009 4.99392 21 1.99658C6.31105 1.99658 4.08854 15.422 3.06361 21.6132C3.0419 21.7443 3.02074 21.8722 3 21.9966H4.99824C5.66421 18.6635 7.33146 16.8301 10 16.4966C14 15.9966 17 12.9966 18 9.99658Z";
const MOBILE_TAB_ICON_QUILL_PEN_AI_FILL =
  "M4.7134 7.12811L4.46682 7.69379C4.28637 8.10792 3.71357 8.10792 3.53312 7.69379L3.28656 7.12811C2.84706 6.11947 2.05545 5.31641 1.06767 4.87708L0.308047 4.53922C-0.102682 4.35653 -0.102682 3.75881 0.308047 3.57612L1.0252 3.25714C2.03838 2.80651 2.84417 1.97373 3.27612 0.930828L3.52932 0.319534C3.70578 -0.106511 4.29417 -0.106511 4.47063 0.319534L4.72382 0.930828C5.15577 1.97373 5.96158 2.80651 6.9748 3.25714L7.69188 3.57612C8.10271 3.75881 8.10271 4.35653 7.69188 4.53922L6.93228 4.87708C5.94451 5.31641 5.15288 6.11947 4.7134 7.12811ZM3.06361 21.6132C4.08854 15.422 6.31105 1.99658 21 1.99658C19.5042 4.99658 18.5 6.49658 17.5 7.49658L16.5 8.49658L18 9.49658C17 12.4966 14 15.9966 10 16.4966C7.33146 16.8301 5.66421 18.6635 4.99824 21.9966H3C3.02074 21.8722 3.0419 21.7443 3.06361 21.6132Z";
const MOBILE_CONTENT_TAB_ICON_MESSAGES_SQUARE =
  '<svg class="content-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.07.613l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"/></svg>';
const MOBILE_CONTENT_TAB_ICON_HISTORY =
  '<svg class="content-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>';
const MOBILE_ICON_PANEL_LEFT =
  '<svg class="mobile-distribute-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/></svg>';
const MOBILE_ICON_PANEL_RIGHT =
  '<svg class="mobile-distribute-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/></svg>';

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

function setText(node, value) {
  node.textContent = value == null ? "" : String(value);
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function websiteDomain(url) {
  try {
    return new URL(String(url || "")).hostname.replace(/^www\./, "");
  } catch {
    return String(url || "")
      .trim()
      .replace(/^www\./, "");
  }
}

function companyDisplayName(company) {
  return (
    String(company.business_name || "").trim() ||
    String(company.website_synthesis_business_name || "").trim() ||
    String(company.brand_name || "").trim() ||
    websiteDomain(company.website_url) ||
    String(company.website_url || "").trim() ||
    "Untitled"
  );
}

function brandLogoUrlForCompany(company) {
  const logoUrl = String(
    company?.website_synthesis_business_logo_url || "",
  ).trim();
  if (logoUrl) return logoUrl;
  const host = websiteDomain(company?.website_url || "");
  if (host) {
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
  }
  return "";
}

function initials(value) {
  const words = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  const text = words.map((w) => w[0]?.toUpperCase() || "").join("");
  return text || "?";
}

function relativeTime(ts) {
  const ms = customerStoryTimeMs(ts);
  if (!ms) return "";
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
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

function meetsBrandScoreThreshold(score) {
  const n = Number(score);
  return Number.isFinite(n) && n >= 0.1;
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

function avatarFor(value, sizeClass = "", imageUrl = null) {
  if (imageUrl) {
    const img = document.createElement("img");
    img.className = sizeClass;
    img.alt = "";
    img.src = imageUrl;
    img.onerror = () => {
      const fallback = document.createElement("span");
      fallback.className = `${sizeClass} brand-logo-fallback`;
      fallback.textContent = initials(value);
      img.replaceWith(fallback);
    };
    return img;
  }
  const span = document.createElement("span");
  span.className = `${sizeClass} brand-logo-fallback`;
  span.textContent = initials(value);
  return span;
}

function brandFavicon(websiteUrl, size = 64, className = "brand-logo") {
  const host = websiteDomain(websiteUrl);
  if (!host) return null;
  const img = document.createElement("img");
  img.className = className;
  img.alt = "";
  img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`;
  img.referrerPolicy = "no-referrer";
  img.onerror = () => {
    img.replaceWith(avatarFor(host, className, null));
  };
  return img;
}

function compactNum(n) {
  if (n == null) return "—";
  const value = Number(n);
  if (!Number.isFinite(value)) return String(n);
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000)
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(value));
}

function formatCompactCount(n) {
  if (n == null) return "0";
  const value = Number(n);
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000)
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.trunc(value));
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

function customerStoryRecencyTimeMs(story) {
  return customerStoryTimeMs(story.last_updated_at || story.story_last_seen_at);
}

function customerStoryId(story) {
  return String(story.story_id || story.id || story.headline || "");
}

function sortMobileStories(stories) {
  normalizeMobileStoriesSortMode();
  return [...stories].sort((a, b) => {
    if (state.storiesSortMode === "brand_score") {
      return Number(b.brand_score || 0) - Number(a.brand_score || 0);
    }
    if (state.storiesSortMode === "activity") {
      const diff = Number(b.post_count || 0) - Number(a.post_count || 0);
      if (diff !== 0) return diff;
      return customerStoryRecencyTimeMs(b) - customerStoryRecencyTimeMs(a);
    }
    return customerStoryRecencyTimeMs(b) - customerStoryRecencyTimeMs(a);
  });
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

function buildEngagingNowLabel() {
  const label = document.createElement("div");
  label.className = "sc-detail-label brand-engaging-now-label";
  const strengthEl = document.createElement("span");
  strengthEl.className = "sc-strength sc-strength-engaging";
  strengthEl.appendChild(buildUrgencyDot({ rings: 1 }));
  label.appendChild(strengthEl);
  const text = document.createElement("span");
  setText(text, "Engaging now");
  label.appendChild(text);
  return label;
}

function buildMobileStoryContextBubble(turn) {
  const bubble = document.createElement("div");
  bubble.className =
    "mobile-campaign-bubble mobile-campaign-bubble-user mobile-campaign-story-context";

  const card = document.createElement("div");
  card.className = "mobile-campaign-story-context-card";

  const headline = document.createElement("div");
  headline.className = "mobile-campaign-story-context-headline";
  setText(headline, turn.headline || "Story");
  card.appendChild(headline);

  const stats = document.createElement("div");
  stats.className = "mobile-campaign-story-context-stats";

  const strength = storyUrgency(turn.last_seen_at);
  const strengthEl = document.createElement("span");
  strengthEl.className = `sc-strength sc-strength-${strength.tone}`;
  strengthEl.appendChild(buildUrgencyDot(strength));
  const strengthLabel = document.createElement("span");
  setText(strengthLabel, strength.label);
  strengthEl.appendChild(strengthLabel);
  stats.appendChild(strengthEl);

  const postCount = document.createElement("span");
  postCount.className = "mobile-campaign-story-context-stat";
  const postB = document.createElement("b");
  setText(postB, formatCompactCount(turn.post_count));
  postCount.appendChild(postB);
  postCount.appendChild(document.createTextNode(" posts"));
  stats.appendChild(postCount);

  const ageLabel = customerStoryAgeLabel(turn.last_seen_at);
  if (ageLabel) {
    const age = document.createElement("span");
    age.className = "mobile-campaign-story-context-stat";
    setText(age, ageLabel);
    stats.appendChild(age);
  }

  if (
    turn.brand_score !== null &&
    turn.brand_score !== undefined &&
    Number.isFinite(Number(turn.brand_score))
  ) {
    const badge = buildBrandScoreBadge(turn.brand_score);
    if (badge) stats.appendChild(badge);
  }

  card.appendChild(stats);
  bubble.appendChild(card);
  return bubble;
}

const MOBILE_SITMAR_REGENERATE_LABEL = "Generate new directions";
const mobileSeedRegenInFlight = new Set();
const mobileCampaignPostInFlight = new Set();
const MOBILE_ACTION_ICON_STYLES = [
  { bg: "hsl(210, 70%, 96%)", color: "hsl(218, 55%, 52%)" },
  { bg: "hsl(145, 55%, 94%)", color: "hsl(150, 45%, 38%)" },
  { bg: "hsl(40, 65%, 94%)", color: "hsl(35, 70%, 45%)" },
  { bg: "hsl(350, 55%, 96%)", color: "hsl(350, 50%, 52%)" },
];
const MOBILE_REFRESH_ICON =
  '<svg class="action-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M1 4v6h6"/><path fill="none" stroke="currentColor" stroke-width="2" d="M23 20v-6h-6"/><path fill="none" stroke="currentColor" stroke-width="2" d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>';
const MOBILE_ICON_SCAN_EYE_TONE = {
  bg: "hsl(210, 60%, 96%)",
  color: "hsl(210, 50%, 45%)",
};
const MOBILE_ICON_SCAN_EYE =
  '<svg class="action-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 7V5a2 2 0 0 1 2-2h2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M17 3h2a2 2 0 0 1 2 2v2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M21 17v2a2 2 0 0 1-2 2h-2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="1" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M18.5 12c-1.5 2.5-4 4-6.5 4s-5-1.5-6.5-4"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5.5 12c1.5-2.5 4-4 6.5-4s5 1.5 6.5 4"/></svg>';
const MOBILE_ICON_DRAFT_POST = {
  bg: "hsl(145, 55%, 94%)",
  color: "hsl(150, 45%, 38%)",
};
const MOBILE_ICON_PENCIL =
  '<svg class="action-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 20h9"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';

function buildAddYourBrandAction(onClick) {
  return buildActionGrid(
    [
      {
        label: "Add your brand",
        iconHtml: MOBILE_ICON_SCAN_EYE,
        ariaLabel: "Add your brand",
        iconBg: MOBILE_ICON_SCAN_EYE_TONE.bg,
        iconColor: MOBILE_ICON_SCAN_EYE_TONE.color,
        onClick,
      },
    ],
    { columns: 1 },
  );
}

function buildActionGrid(items, options = {}) {
  const columns = options.columns ?? 1;
  const grid = document.createElement("div");
  grid.className = "sitmar-action-grid" + (columns === 1 ? " is-stack" : "");
  items.forEach((item, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "sitmar-action-btn" +
      (item.primary ? " is-primary" : "") +
      (item.accentCta ? " is-accent-cta" : "");
    if (item.disabled) btn.disabled = true;
    if (item.ariaLabel) btn.setAttribute("aria-label", item.ariaLabel);
    const iconWrap = document.createElement("span");
    iconWrap.className = "action-icon-wrap";
    if (!item.accentCta) {
      const tone =
        item.iconBg && item.iconColor
          ? { bg: item.iconBg, color: item.iconColor }
          : MOBILE_ACTION_ICON_STYLES[index % MOBILE_ACTION_ICON_STYLES.length];
      iconWrap.style.background = item.iconBg || tone.bg;
      iconWrap.style.color = item.iconColor || tone.color;
    }
    const icon = document.createElement("span");
    icon.className = "action-icon";
    if (item.iconHtml) icon.innerHTML = item.iconHtml;
    else setText(icon, item.icon || String(index + 1));
    iconWrap.appendChild(icon);
    btn.appendChild(iconWrap);
    const label = document.createElement("span");
    label.className = "action-label" + (item.subtitle ? " is-stacked" : "");
    if (item.subtitle) {
      const title = document.createElement("span");
      title.className = "action-label-title";
      setText(title, item.label || "");
      label.appendChild(title);
      const subtitle = document.createElement("span");
      subtitle.className = "action-label-subtitle";
      setText(subtitle, item.subtitle);
      label.appendChild(subtitle);
    } else {
      setText(label, item.label || "");
    }
    btn.appendChild(label);
    if (!item.disabled && typeof item.onClick === "function") {
      btn.addEventListener("click", item.onClick);
    }
    grid.appendChild(btn);
  });
  return grid;
}

function mobileCampaignIdeatingIndicator() {
  return meleaStatusLine("Ideating...", { ariaBusy: true });
}

function removeMobileCampaignTypingIndicator(thread) {
  thread?.querySelectorAll(".sitmar-ideating").forEach((el) => el.remove());
}

function shouldShowMobileCampaignIdeating(campaign) {
  if (String(campaign?.status || "").toLowerCase() !== "thinking") return false;
  const messages = Array.isArray(campaign?.messages) ? campaign.messages : [];
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return true;
  if (Array.isArray(last.seeds) && last.seeds.length) return false;
  if (Array.isArray(last.vibes) && last.vibes.length) return false;
  return true;
}

function appendMobileCampaignTurn(thread, turn, campaign, opts) {
  if (!turn) return;
  const thinking = campaign.status === "thinking";
  const i = opts.turnIndex ?? -1;
  const latestSeedTurn = opts.latestSeedTurn ?? -1;
  const latestVibeTurn = opts.latestVibeTurn ?? -1;
  if (
    turn.role === "assistant" &&
    (turn.message ||
      (Array.isArray(turn.seeds) && turn.seeds.length) ||
      (Array.isArray(turn.vibes) && turn.vibes.length))
  ) {
    if (turn.message) {
      const bubble = document.createElement("div");
      bubble.className =
        "mobile-campaign-bubble mobile-campaign-bubble-assistant";
      setText(bubble, turn.message);
      thread.appendChild(bubble);
    }
    if (Array.isArray(turn.seeds) && turn.seeds.length) {
      const isLatest = i === latestSeedTurn && campaign.status === "ready";
      const seeds = turn.seeds.slice(0, 3);
      const items = [
        ...seeds.map((seed, seedIndex) => ({
          label: seed.title || "",
          icon: String(seedIndex + 1),
          ariaLabel: seed.title || `Direction ${seedIndex + 1}`,
          iconBg: MOBILE_ACTION_ICON_STYLES[seedIndex].bg,
          iconColor: MOBILE_ACTION_ICON_STYLES[seedIndex].color,
          disabled: !(isLatest && !thinking),
          onClick:
            isLatest && !thinking
              ? () => selectCampaignSeed(campaign.id, seedIndex)
              : undefined,
        })),
        {
          label: MOBILE_SITMAR_REGENERATE_LABEL,
          iconHtml: MOBILE_REFRESH_ICON,
          ariaLabel: MOBILE_SITMAR_REGENERATE_LABEL,
          iconBg: MOBILE_ACTION_ICON_STYLES[3].bg,
          iconColor: MOBILE_ACTION_ICON_STYLES[3].color,
          disabled: !(isLatest && !thinking),
          onClick:
            isLatest && !thinking
              ? () => regenerateCampaignSeeds(campaign.id)
              : undefined,
        },
      ];
      thread.appendChild(buildActionGrid(items));
    }
    if (Array.isArray(turn.vibes) && turn.vibes.length) {
      const isLatest = i === latestVibeTurn && campaign.status === "selected";
      const vibes = turn.vibes.slice(0, 3);
      const items = [
        ...vibes.map((vibe, vibeIndex) => ({
          label: vibe.label || "",
          icon: String(vibeIndex + 1),
          ariaLabel: vibe.label || `Vibe ${vibeIndex + 1}`,
          iconBg: MOBILE_ACTION_ICON_STYLES[vibeIndex].bg,
          iconColor: MOBILE_ACTION_ICON_STYLES[vibeIndex].color,
          disabled: !(isLatest && !thinking),
          onClick:
            isLatest && !thinking
              ? () => sendCampaignMessage(campaign.id, vibe.label || "")
              : undefined,
        })),
        {
          label: "Review post options",
          icon: "→",
          ariaLabel: "Review post options",
          accentCta: true,
          disabled: !(isLatest && !thinking),
          onClick:
            isLatest && !thinking ? () => postCampaign(campaign.id) : undefined,
        },
      ];
      thread.appendChild(buildActionGrid(items));
    }
  } else if (turn.role === "user" && turn.type === "story_context") {
    thread.appendChild(buildMobileStoryContextBubble(turn));
  } else if (turn.role === "user") {
    const bubble = document.createElement("div");
    bubble.className = "mobile-campaign-bubble mobile-campaign-bubble-user";
    setText(bubble, turn.text || "");
    thread.appendChild(bubble);
  }
}

function showToast(msg) {
  const t = $("#toast");
  setText(t, msg);
  t.classList.remove("hidden");
  requestAnimationFrame(() => t.classList.add("toast-show"));
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    t.classList.remove("toast-show");
    setTimeout(() => t.classList.add("hidden"), 180);
  }, 1500);
}

async function api(path, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  try {
    const token = typeof clerkToken === "function" ? await clerkToken() : null;
    if (token) headers["Authorization"] = "Bearer " + token;
  } catch (_) {}
  const res = await fetch((window.API_BASE || "") + path, {
    credentials: "same-origin",
    ...opts,
    headers,
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { ok: res.ok, status: res.status, body };
}

let _pendingSignInResolve = null;

async function checkAuth() {
  const clerk = getClerk();
  return !!(clerk && clerk.user);
}

function hideSignInOverlay() {
  const overlay = $("#login-overlay");
  if (overlay) overlay.classList.add("hidden");
}

function teardownSignInOverlay() {
  unmountClerkSignIn();
  const overlay = $("#login-overlay");
  if (overlay) overlay.classList.add("hidden");
}

function showSignInPrompt(headline) {
  ensureAuthReturnPath();
  const headlineEl = $("#auth-headline");
  if (headlineEl) setAuthHeadline(headlineEl, headline);
  const overlay = $("#login-overlay");
  if (!overlay) return;
  overlay.classList.remove("hidden");
  document.body.appendChild(overlay);
  mountClerkSignIn();
  const clerkNode = $("#clerk-sign-in");
  if (clerkNode) clerkNode.focus();
}

function dismissSignInPrompt() {
  const overlay = $("#login-overlay");
  if (!overlay || overlay.classList.contains("hidden")) return;
  hideSignInOverlay();
  clearClerkAuthHash();
  completeSignInPrompt(false);
}

function installSignInOverlayBehavior() {
  const overlay = $("#login-overlay");
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

function completeSignInPrompt(signedIn) {
  if (signedIn) teardownSignInOverlay();
  const resolve = _pendingSignInResolve;
  _pendingSignInResolve = null;
  if (!signedIn) clearAuthReturnContext();
  if (resolve) resolve(!!signedIn);
}

async function requireSignIn(opts) {
  setAuthReturnContext({
    intent: opts?.intent ?? null,
    path: appLocationSuffix(),
  });
  const clerk = getClerk();
  if (clerk && clerk.user) return true;
  if (_pendingSignInResolve) completeSignInPrompt(false);
  showSignInPrompt(opts?.headline);
  try {
    await bootstrapClerk();
  } catch (_) {
    hideSignInOverlay();
    showToast("Sign-in is unavailable right now.");
    return false;
  }
  if (await checkAuth()) {
    hideSignInOverlay();
    return true;
  }
  mountClerkSignIn();
  const clerkNode = $("#clerk-sign-in");
  if (clerkNode) clerkNode.focus();
  return new Promise((resolve) => {
    _pendingSignInResolve = resolve;
  });
}

function showLogin() {
  // regwall is deferred to requireSignIn() at content-creation entry points
}

function showShell() {
  hideSignInOverlay();
  const shell = $("#shell");
  if (shell) shell.classList.remove("hidden");
}

function currentCompany() {
  return state.companies.find((c) => c.id === state.selectedBrandId) || null;
}

function mobileSettledCompany() {
  const company = currentCompany();
  if (!company || shouldResumePreBrandOnboarding(company)) return null;
  return company;
}

function mobileStoriesFeedKey() {
  const company = mobileSettledCompany();
  return company ? company.id : MOBILE_ANONYMOUS_STORIES_KEY;
}

const MOBILE_STORIES_SORT_MODES = ["recency", "activity"];
const MOBILE_STORIES_SORT_MODES_WITH_SCORE = [
  "recency",
  "activity",
  "brand_score",
];

function mobileStoriesSortModes() {
  if (mobileSettledCompany()) return MOBILE_STORIES_SORT_MODES_WITH_SCORE;
  return MOBILE_STORIES_SORT_MODES;
}

function mobileStoriesDefaultSortMode() {
  return mobileSettledCompany() ? "brand_score" : "recency";
}

function applyMobileStoriesDefaultSortMode() {
  state.storiesSortMode = mobileStoriesDefaultSortMode();
}

function normalizeMobileStoriesSortMode() {
  const modes = mobileStoriesSortModes();
  if (!modes.includes(state.storiesSortMode)) {
    state.storiesSortMode = mobileStoriesDefaultSortMode();
  }
}

function storedCompanyId() {
  try {
    return (
      localStorage.getItem(COMPANY_ID_KEY) ||
      localStorage.getItem(BRAND_STORAGE_KEY) ||
      ""
    );
  } catch {
    return "";
  }
}

function setStoredCompanyId(companyId) {
  try {
    const id = String(companyId || "").trim();
    if (id) {
      localStorage.setItem(COMPANY_ID_KEY, id);
      localStorage.setItem(BRAND_STORAGE_KEY, id);
    } else {
      localStorage.removeItem(COMPANY_ID_KEY);
    }
  } catch (_) {}
}

async function resolveBrandId() {
  const clerk = getClerk();
  if (clerk && clerk.user) {
    const meRes = await api("/api/me", { method: "GET" });
    if (meRes.ok && meRes.body) {
      currentUserPlan = meRes.body.plan || null;
      currentSubscriptionStatus = meRes.body.subscription_status || null;
      if (meRes.body.company_id) {
        setStoredCompanyId(meRes.body.company_id);
        return String(meRes.body.company_id);
      }
    }
    const pending = storedCompanyId();
    const res = await api("/api/me/claim", {
      method: "POST",
      body: JSON.stringify({ company_id: pending || "" }),
    });
    if (res.ok && res.body && res.body.company_id) {
      setStoredCompanyId(res.body.company_id);
      return String(res.body.company_id);
    }
    if (res.status === 401) return pending ? String(pending) : null;
    return pending ? String(pending) : null;
  }
  const stored = storedCompanyId();
  return stored ? String(stored) : null;
}

async function attachSignedInUserToCompanyIfNeeded(company, errEl) {
  const clerk = getClerk();
  if (!(clerk && clerk.user)) return company;
  const res = await api("/api/me/claim", {
    method: "POST",
    body: JSON.stringify({ company_id: company.id }),
  });
  if (!res.ok || !res.body?.company_id) {
    const detail =
      res.body && typeof res.body.detail === "string" ? res.body.detail : "";
    const claimAuthRequired =
      res.status === 401 || detail === "Authentication required.";
    if (claimAuthRequired) return company;
    setText(errEl, detail || "Brand created but attachment failed.");
    return null;
  }
  return res.body.company || company;
}

async function bootCustomerBrand() {
  const companyId = await resolveBrandId();
  if (!companyId) {
    state.companies = [];
    setSelectedBrand("");
    return null;
  }
  setStoredCompanyId(companyId);
  const res = await api(`/api/company/${encodeURIComponent(companyId)}`);
  if (!res.ok || !res.body || !res.body.company) {
    state.companies = [];
    setSelectedBrand("");
    setStoredCompanyId("");
    return null;
  }
  state.companies = [res.body.company];
  if (shouldResumePreBrandOnboarding(res.body.company)) {
    setSelectedBrand("");
    state.brandScreen = "detail";
    setBrandCreateActive(false);
    return null;
  }
  return companyId;
}

async function openSettledBrandHome(companyId) {
  if (!companyId) return;
  applyMobileStoriesDefaultSortMode();
  setSelectedBrand(companyId, { prefetch: false });
  state.brandScreen = "detail";
  setBrandCreateActive(false);
  showBrandHomeLoadingOverlay("Retrieving your brand data...");
  renderActiveScreen();
  await runPostBrandHomeLoader(companyId);
}

function prepareReturningBrandBootScreen() {
  if (!storedCompanyId()) return;
  state.brandScreen = "detail";
  $("#screen-brand-list")?.classList.add("hidden");
  $("#screen-brand-detail")?.classList.remove("hidden");
  showBrandHomeLoadingOverlay("Retrieving your brand data...");
}

async function presentCustomerBrandAfterBoot() {
  prepareReturningBrandBootScreen();
  showShell();
  const companyId = await bootCustomerBrand();
  if (companyId) {
    await openSettledBrandHome(companyId);
    return;
  }
  applyMobileStoriesDefaultSortMode();
  hideBrandHomeLoadingOverlay({ immediate: true });
  renderActiveScreen();
}

function mobileMeleaLogoSrc() {
  return "/static/assets/images/wordmark-sans-trans.png";
}

function setBrandCreateActive(active) {
  const shell = $("#shell");
  const listScreen = $("#screen-brand-list");
  if (shell) shell.classList.toggle("brand-create-active", !!active);
  if (listScreen) listScreen.classList.toggle("brand-create-active", !!active);
}

function brandCreateLogoEl() {
  const img = document.createElement("img");
  img.className = "brand-create-logo";
  img.src = mobileMeleaLogoSrc();
  img.alt = "melea";
  return img;
}

function clearBrandCreateView() {
  const pad = $("#screen-brand-list")?.querySelector(".screen-pad");
  pad?.querySelector(".brand-create-screen")?.remove();
}

function fadeOutBrandCreateScreen() {
  return new Promise((resolve) => {
    const el = document.querySelector(".brand-create-screen");
    if (!el) {
      setBrandCreateActive(false);
      clearBrandCreateView();
      resolve();
      return;
    }
    const finish = () => {
      setBrandCreateActive(false);
      clearBrandCreateView();
      resolve();
    };
    el.classList.add("brand-create-exit");
    el.addEventListener("animationend", finish, { once: true });
  });
}

function finishBrandCreateTransition() {
  return fadeOutBrandCreateScreen();
}

async function submitPreBrandWebsite(input, errEl, submitBtn, card) {
  const trimmed = String(input?.value || "").trim();
  setText(errEl, "");
  input?.removeAttribute("aria-invalid");
  if (!trimmed) {
    setText(errEl, "Add a website URL or domain first.");
    input?.setAttribute("aria-invalid", "true");
    input?.focus();
    return false;
  }
  if (submitBtn) {
    submitBtn.disabled = true;
    if (submitBtn.classList.contains("brand-create-submit")) {
      setText(submitBtn, "Looking it up…");
    }
  }
  try {
    const res = await api("/api/companies", {
      method: "POST",
      body: JSON.stringify({ website_url: trimmed }),
    });
    if (
      res.status === 403 &&
      res.body?.detail === "You already have a brand."
    ) {
      setText(errEl, "You already have a brand in your account.");
      return false;
    }
    if (!res.ok) {
      const d = res.body && res.body.detail;
      const msg =
        typeof d === "string"
          ? d
          : "Couldn't add that brand. Enter a valid public website URL or domain.";
      setText(errEl, msg);
      input?.setAttribute("aria-invalid", "true");
      return false;
    }
    if (!res.body?.company) return false;
    const attachedCompany = await attachSignedInUserToCompanyIfNeeded(
      res.body.company,
      errEl,
    );
    if (!attachedCompany) return false;
    setStoredCompanyId(attachedCompany.id);
    state.companies = [attachedCompany];
    if (
      res.body.created === false &&
      !shouldResumePreBrandOnboarding(attachedCompany)
    ) {
      markMobileDuplicateBrandOnboarding(false);
      applyPreBrandProgressState(attachedCompany);
      renderBrandHomeEmpty();
      void finishSettledMobileExistingBrandOverlay(attachedCompany.id);
      return true;
    }
    if (res.body.created === false) {
      markMobileDuplicateBrandOnboarding(false);
      void prefetchMobileBrandDashboardData(attachedCompany.id);
    }
    applyPreBrandProgressState(attachedCompany);
    scheduleOnboardingPoll(attachedCompany.id);
    return true;
  } catch (err) {
    setText(errEl, "Network error: " + err.message);
    return false;
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      if (submitBtn.classList.contains("brand-create-submit")) {
        setText(submitBtn, "Continue");
      }
    }
  }
}

async function submitBrandWebsite(url, { input, errEl, submitBtn }) {
  const card = document.querySelector(".pre-brand-overlay-card");
  if (card && input) {
    return submitPreBrandWebsite(input, errEl, submitBtn, card);
  }
  return submitPreBrandWebsite({ value: url }, errEl, submitBtn, card);
}

async function renderBrandCreateView() {
  const listScreen = $("#screen-brand-list");
  const list = $("#brand-list");
  const empty = $("#brand-list-empty");
  const title = listScreen?.querySelector(".screen-title");
  if (title) title.classList.add("hidden");
  if (list) {
    list.innerHTML = "";
    list.classList.add("hidden");
  }
  if (empty) empty.classList.add("hidden");
  const appbarHost = $("#brand-list-appbar");
  if (appbarHost && !appbarHost.hasChildNodes()) {
    appbarHost.appendChild(buildMeleaAppbar());
  }
  setBrandCreateActive(true);
  const pad = listScreen?.querySelector(".screen-pad");
  if (!pad) return;
  let host = pad.querySelector(".brand-create-screen");
  if (!host) {
    host = document.createElement("div");
    pad.appendChild(host);
  }
  host.className = "brand-create-screen";
  host.innerHTML = "";
  const card = document.createElement("div");
  card.className = "brand-create-card";
  card.appendChild(brandCreateLogoEl());
  const form = document.createElement("form");
  form.className = "brand-create-form";
  form.noValidate = true;
  const field = document.createElement("div");
  field.className = "brand-create-field";
  const inputWrap = document.createElement("div");
  inputWrap.className = "brand-create-input-wrap";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "brand-create-input";
  input.placeholder = "What's your brand's website?";
  input.autocomplete = "url";
  const enterHint = document.createElement("span");
  enterHint.className = "brand-create-enter";
  enterHint.setAttribute("aria-hidden", "true");
  setText(enterHint, "ENTER");
  inputWrap.appendChild(input);
  inputWrap.appendChild(enterHint);
  field.appendChild(inputWrap);
  form.appendChild(field);
  const errEl = document.createElement("div");
  errEl.className = "brand-create-error";
  form.appendChild(errEl);
  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "brand-create-submit btn-primary";
  setText(submitBtn, "Continue");
  form.appendChild(submitBtn);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await submitBrandWebsite(input.value, { input, errEl, submitBtn });
  });
  card.appendChild(form);
  host.appendChild(card);
  input.focus();
}

async function pollCompany(companyId) {
  const res = await api(`/api/company/${encodeURIComponent(companyId)}`);
  if (!res.ok || !res.body || !res.body.company) return null;
  const company = res.body.company;
  const idx = state.companies.findIndex((c) => c.id === companyId);
  if (idx >= 0) state.companies[idx] = company;
  else state.companies = [company];
  return company;
}

function setSelectedBrand(id, { prefetch = true } = {}) {
  state.selectedBrandId = id || "";
  state.storiesExpanded = new Set();
  state.storiesAutoOpened = false;
  setStoredCompanyId(state.selectedBrandId);
  if (state.selectedBrandId && prefetch) {
    void ensureMobileBrandAudiences(state.selectedBrandId);
    void ensureStoriesFeed(state.selectedBrandId);
  }
}

function showBrandHomeLoadingOverlay(message) {
  hideBrandHomeLoadingOverlay({ immediate: true });
  const screen = $("#screen-brand-detail");
  if (!screen) return;
  screen.classList.add("has-brand-home-loading");
  const el = document.createElement("div");
  el.id = "brand-home-loading-overlay";
  el.className = "brand-home-loading-overlay";
  el.setAttribute("aria-live", "polite");
  el.setAttribute("aria-busy", "true");
  const logoStack = document.createElement("div");
  logoStack.className = "brand-home-loading-logo-stack";
  const meleaLogo = document.createElement("img");
  meleaLogo.className = "brand-home-loading-logo brand-home-loading-logo-melea";
  meleaLogo.src = MELEA_LOADER_LOGO;
  meleaLogo.alt = "";
  const brandLogo = document.createElement("img");
  brandLogo.className = "brand-home-loading-logo brand-home-loading-logo-brand";
  brandLogo.alt = "";
  logoStack.appendChild(meleaLogo);
  logoStack.appendChild(brandLogo);
  const status = document.createElement("p");
  status.className = "brand-home-loading-status onboarding-status-live";
  setText(status, message || "Retrieving your brand data...");
  el.appendChild(logoStack);
  el.appendChild(status);
  screen.appendChild(el);
}

function preloadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(url);
    img.onerror = () => reject(new Error("image-load-failed"));
    img.src = url;
  });
}

async function crossfadeBrandHomeLoadingLogo(company) {
  const url = brandLogoUrlForCompany(company);
  if (!url) return false;
  const stack = document.querySelector(".brand-home-loading-logo-stack");
  const brandImg = stack?.querySelector(".brand-home-loading-logo-brand");
  if (!stack || !brandImg) return false;
  try {
    await preloadImage(url);
  } catch {
    return false;
  }
  brandImg.src = url;
  brandImg.alt = companyDisplayName(company);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  stack.classList.add("is-brand-logo");
  return true;
}

function updateBrandHomeLoadingOverlay(message) {
  const status = document.querySelector(
    "#brand-home-loading-overlay .brand-home-loading-status",
  );
  if (!status || !message || status.textContent === message) return;
  status.classList.add("onboarding-status-swap");
  setText(status, message);
  status.addEventListener(
    "animationend",
    () => status.classList.remove("onboarding-status-swap"),
    { once: true },
  );
}

function hideBrandHomeLoadingOverlay({ immediate = false } = {}) {
  const screen = $("#screen-brand-detail");
  const el = document.getElementById("brand-home-loading-overlay");
  if (!el) {
    screen?.classList.remove("has-brand-home-loading");
    return;
  }
  if (immediate) {
    el.remove();
    screen?.classList.remove("has-brand-home-loading");
    return;
  }
  el.classList.add("brand-home-loading-exit");
  el.addEventListener(
    "animationend",
    () => {
      el.remove();
      screen?.classList.remove("has-brand-home-loading");
    },
    { once: true },
  );
}

function withPostBrandLoaderTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error("post-brand-loader-timeout")),
        POST_BRAND_LOADER_TIMEOUT_MS,
      );
    }),
  ]);
}

async function waitForMobileInFlight(isActive) {
  while (isActive()) {
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
}

async function waitBrandAudiences(companyId) {
  if (!companyId) return;
  await waitForMobileInFlight(() =>
    mobileBrandAudiencesInFlight.has(companyId),
  );
  await fetchMobileBrandAudiences(companyId, { force: true });
}

async function waitStoriesFeed(feedKey) {
  if (!feedKey) return;
  await waitForMobileInFlight(() => state.storiesFeedInFlight.has(feedKey));
  await ensureStoriesFeed(feedKey);
}

async function hydratePostBrandHome(companyId) {
  updateBrandHomeLoadingOverlay("Retrieving your brand data...");
  const company = await pollCompany(companyId);
  const logoCrossfade = company
    ? crossfadeBrandHomeLoadingLogo(company)
    : Promise.resolve(false);
  updateBrandHomeLoadingOverlay("Loading your brand...");
  await Promise.all([
    waitBrandAudiences(companyId),
    waitStoriesFeed(companyId),
  ]);
  return logoCrossfade;
}

async function runPostBrandHomeLoader(companyId) {
  if (!companyId) return;
  showBrandHomeLoadingOverlay("Retrieving your brand data...");
  const started = Date.now();
  let crossfadeResult = Promise.resolve(false);
  try {
    crossfadeResult = await withPostBrandLoaderTimeout(
      hydratePostBrandHome(companyId),
    );
  } catch {
    // show home with whatever data we have
  }
  const crossfaded = await crossfadeResult;
  const elapsed = Date.now() - started;
  const remain = Math.max(
    POST_BRAND_LOADER_MIN_MS - elapsed,
    crossfaded ? BRAND_HOME_LOGO_CROSSFADE_MS : 0,
  );
  if (remain > 0) await new Promise((resolve) => setTimeout(resolve, remain));
  hideBrandHomeLoadingOverlay();
  if (state.activeTab === "brand") syncCustomerHomePanel();
  else if (state.activeTab === "stories") syncCustomerStoriesPanel();
}

function syncBottomTabIcons(activeTab) {
  const tabs = [
    {
      tab: "brand",
      viewBox: "0 0 512 512",
      line: MOBILE_TAB_ICON_PEOPLE_OUTLINE,
      fill: MOBILE_TAB_ICON_PEOPLE_FILL,
    },
    {
      tab: "stories",
      viewBox: "0 0 16 16",
      line: MOBILE_TAB_ICON_LIGHTNING_LINE,
      fill: MOBILE_TAB_ICON_LIGHTNING_FILL,
    },
    {
      tab: "campaigns",
      viewBox: "0 0 24 24",
      line: `<path d="${MOBILE_TAB_ICON_QUILL_PEN_AI_LINE}"/>`,
      fill: `<path d="${MOBILE_TAB_ICON_QUILL_PEN_AI_FILL}"/>`,
    },
  ];
  for (const { tab, viewBox, line, fill } of tabs) {
    const svg = document.querySelector(`[data-tab="${tab}"] svg`);
    if (!svg) continue;
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("fill", "currentColor");
    svg.removeAttribute("stroke");
    svg.innerHTML = activeTab === tab ? fill : line;
  }
}

function setTab(tab, opts = {}) {
  if (state.activeTab === "campaigns" && tab !== "campaigns") {
    state.campaignDetailId = "";
    stopCampaignPolling();
    if (customerContentMount()) syncCustomerContentPanel();
  }
  if (tab !== "brand") clearBrandHomePipelinePoll();
  state.activeTab = tab;
  document.querySelectorAll(".tab").forEach((node) => {
    node.classList.toggle("tab-active", node.dataset.tab === tab);
  });
  syncBottomTabIcons(tab);
  renderActiveScreen({ slideToHome: !!opts.slideToHome });
  if (tab === "campaigns" && !isPreBrandMode()) loadCampaigns();
}

function isPreBrandMode() {
  return !state.selectedBrandId;
}

function emptyHomeCompany() {
  return {
    id: "",
    website_url: "",
    business_name: "",
    audience: [],
    brand_synthesis: "",
  };
}

function preBrandStoriesFeed() {
  return state.storiesFeedCache.get(MOBILE_ANONYMOUS_STORIES_KEY) || [];
}

function brandHomeTitleH1(label) {
  const h1 = document.createElement("h1");
  h1.className = "sc-title-h1";
  setText(h1, label);
  return h1;
}

function sitmarBubble(role, text) {
  const bubble = document.createElement("div");
  bubble.className = "sitmar-bubble sitmar-bubble-" + role;
  setText(bubble, text || "");
  return bubble;
}

function brandHomeGreeting() {
  const hr = new Date().getHours();
  if (hr < 12) return "Good morning";
  if (hr < 17) return "Good afternoon";
  return "Good evening";
}

function brandHomeNeedsBrandGreeting() {
  return `${brandHomeGreeting()}! Enter your company's website to start generating custom content for your brand.`;
}

function brandHomeReadyGreeting() {
  return `${brandHomeGreeting()}. Ready to draft a post?`;
}

function appendMobileBrandHomeReadyChatActions(thread) {
  thread.appendChild(
    buildActionGrid([
      {
        label: "Draft a post",
        iconHtml: MOBILE_ICON_PENCIL,
        ariaLabel: "Draft a post",
        iconBg: MOBILE_ICON_DRAFT_POST.bg,
        iconColor: MOBILE_ICON_DRAFT_POST.color,
        onClick: () => {
          void (async () => {
            const company = currentCompany();
            if (
              !(await requireSignIn({
                intent: {
                  action: "draftPost",
                  companyId: company?.id || "",
                  via: "chat",
                  contentStudioMode: "chat",
                },
              }))
            )
              return;
            state.contentStudioMode = "chat";
            syncCustomerContentPanel();
            startMobileDraftPostFlow(currentCompany());
          })();
        },
      },
    ]),
  );
}

function buildMobileBrandHomeReadyChat() {
  const shell = document.createElement("div");
  shell.className = "brand-home-chat-shell sitmar-chat-shell";

  const scroll = document.createElement("div");
  scroll.className = "sitmar-chat-scroll";
  const thread = document.createElement("div");
  thread.className = "sitmar-chat-thread";
  thread.appendChild(sitmarBubble("assistant", brandHomeReadyGreeting()));
  appendMobileBrandHomeReadyChatActions(thread);

  scroll.appendChild(thread);
  shell.appendChild(scroll);
  mobileHomeChatThread = thread;
  mobileHomeChatScroll = scroll;
  return shell;
}

function scrollMobileChatToBottom(scrollEl) {
  if (!scrollEl) return;
  requestAnimationFrame(() => {
    scrollEl.scrollTop = scrollEl.scrollHeight;
  });
}

function startMobileDraftPostFlow(company) {
  const thread = mobileHomeChatThread;
  const scrollEl = mobileHomeChatScroll;
  if (!thread || !scrollEl || !company?.id) return;
  thread.appendChild(sitmarBubble("user", "Draft a post"));
  const progress = meleaStatusLine("Finding a few different options…");
  thread.appendChild(progress);
  scrollMobileChatToBottom(scrollEl);
  void handleMobileHomeChatPostContent(company, thread, scrollEl, progress);
}

async function handleMobileHomeChatPostContent(
  company,
  thread,
  scroll,
  loading,
) {
  if (!(await requireSignIn())) {
    loading.remove();
    return;
  }
  try {
    const res = await api("/api/home/suggest-stories", {
      method: "POST",
      body: JSON.stringify({ company_id: company.id }),
    });
    loading.remove();
    if (res.status === 401) {
      showLogin();
      return;
    }
    if (
      !res.ok ||
      !res.body ||
      !Array.isArray(res.body.stories) ||
      !res.body.stories.length
    ) {
      thread.appendChild(
        sitmarBubble(
          "assistant",
          "I couldn't find stories for this brand right now. Try again later.",
        ),
      );
      scrollMobileChatToBottom(scroll);
      return;
    }
    thread.appendChild(
      sitmarBubble(
        "assistant",
        res.body.message || "Here are some stories to react to:",
      ),
    );
    const storyGrid = buildActionGrid(
      res.body.stories.map((story, storyIndex) => ({
        label: story.headline || "",
        subtitle: story.reason || story.summary || "",
        icon: String(storyIndex + 1),
        ariaLabel: story.headline || `Story ${storyIndex + 1}`,
        iconBg: MOBILE_ACTION_ICON_STYLES[storyIndex].bg,
        iconColor: MOBILE_ACTION_ICON_STYLES[storyIndex].color,
        onClick: () => {
          storyGrid.querySelectorAll(".sitmar-action-btn").forEach((btn) => {
            btn.disabled = true;
          });
          storyGrid.remove();
          thread.appendChild(
            buildMobileStoryContextBubble({
              headline: story.headline || "",
              post_count: story.post_count || 0,
              last_seen_at: story.last_seen_at || story.last_updated_at,
              brand_score: story.brand_score,
            }),
          );
          scrollMobileChatToBottom(scroll);
          const campLoading = mobileCampaignIdeatingIndicator();
          thread.appendChild(campLoading);
          scrollMobileChatToBottom(scroll);
          void handleMobileHomeChatStartCampaign(
            company,
            story,
            thread,
            scroll,
            campLoading,
          );
        },
      })),
      { columns: 1 },
    );
    thread.appendChild(storyGrid);
    scrollMobileChatToBottom(scroll);
  } catch (err) {
    loading.remove();
    thread.appendChild(
      sitmarBubble("assistant", "Something went wrong. " + (err.message || "")),
    );
    scrollMobileChatToBottom(scroll);
  }
}

async function handleMobileHomeChatStartCampaign(
  company,
  story,
  thread,
  scroll,
  loading,
) {
  if (!(await requireSignIn())) {
    loading.remove();
    return;
  }
  const storyId = story.story_id || customerStoryId(story);
  const key = `${company.id}:${storyId}`;
  if (mobileCampaignStartInFlight.has(key)) {
    loading.remove();
    return;
  }
  mobileCampaignStartInFlight.add(key);
  try {
    const res = await api("/api/home/start-campaign", {
      method: "POST",
      body: JSON.stringify({
        company_id: company.id,
        story_id: storyId,
      }),
    });
    loading.remove();
    if (res.status === 401) {
      showLogin();
      return;
    }
    if (handleUpgradeRequired(res.status)) return;
    if (!res.ok || !res.body?.campaign) {
      thread.appendChild(
        sitmarBubble("assistant", "Couldn't create the campaign. Try again."),
      );
      scrollMobileChatToBottom(scroll);
      return;
    }
    const campaign = res.body.campaign;
    state.campaignsCache.set(campaign.id, campaign);
    state.campaignDetailId = campaign.id;
    state.campaignTweetIndex = 0;
    await loadCampaigns();
    renderCampaignsView();
    startCampaignPolling(campaign.id);
  } catch (err) {
    loading.remove();
    thread.appendChild(
      sitmarBubble("assistant", "Something went wrong. " + (err.message || "")),
    );
    scrollMobileChatToBottom(scroll);
  } finally {
    mobileCampaignStartInFlight.delete(key);
  }
}

function buildMobileCustomerContentCol() {
  const col = document.createElement("div");
  col.className = "brand-home-content-col is-chat";
  const scroll = document.createElement("div");
  scroll.className = "content-col-scroll";
  scroll.appendChild(buildMobileBrandHomeReadyChat());
  col.appendChild(scroll);
  return col;
}

function buildMobileContentStudioToggle() {
  const tabs = document.createElement("div");
  tabs.className = "content-tab-toggle";
  [
    {
      key: "chat",
      label: "Create",
      icon: MOBILE_CONTENT_TAB_ICON_MESSAGES_SQUARE,
    },
    {
      key: "content",
      label: "History",
      icon: MOBILE_CONTENT_TAB_ICON_HISTORY,
    },
  ].forEach((tab) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.mode = tab.key;
    btn.className =
      "content-tab-btn" + (state.contentStudioMode === tab.key ? " is-on" : "");
    btn.setAttribute("aria-label", tab.label);
    btn.innerHTML = tab.icon;
    if (tab.key === "content") {
      applyMobileContentStudioHistoryButtonState(
        btn,
        mobileSettledCompany()?.id,
      );
    }
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      if (state.contentStudioMode === tab.key) return;
      state.contentStudioMode = tab.key;
      if (tab.key === "content") void loadCampaigns();
      else syncCustomerContentPanel();
    });
    tabs.appendChild(btn);
  });
  return tabs;
}

function buildMobileContentStudioTitleWrap({ showToggle = false } = {}) {
  const titleWrap = document.createElement("div");
  titleWrap.className = "sc-title-wrap content-col-header";
  const titleStack = document.createElement("div");
  titleStack.className = "sc-title-stack";
  titleStack.appendChild(brandHomeTitleH1("Content Studio"));
  titleWrap.appendChild(titleStack);
  if (showToggle) titleWrap.appendChild(buildMobileContentStudioToggle());
  return titleWrap;
}

function buildMobileContentStudioBody() {
  const companyId = mobileSettledCompany()?.id;
  if (
    state.contentStudioMode === "content" &&
    !mobileContentHistoryCountForCompany(companyId)
  ) {
    state.contentStudioMode = "chat";
  }
  if (state.contentStudioMode === "content") {
    return buildMobileCampaignHistoryCol();
  }
  return buildMobileCustomerContentCol();
}

let contentHistorySections = { active: [], draft: [], inactive: [] };
let contentHistoryArchivedCount = 0;
const contentHistorySectionCollapsed = new Set();

const MOBILE_CONTENT_DRAFT_ICON_MESSAGES_SQUARE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.07.613l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"/></svg>';

const MOBILE_CONTENT_DRAFT_ICON_TWITTER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/></svg>';

const MOBILE_XPOST_VERIFIED_SVG =
  '<svg viewBox="0 0 22 22" aria-label="Verified" width="15" height="15"><path fill="currentColor" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.855-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635-.13-1.22-.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.706 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></svg>';

const MOBILE_XPOST_ENG_ICONS = [
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 8.6 8.6 0 0 1-3.2-.6L4 21l1.9-4.4a8 8 0 0 1-1.4-4.6A8.4 8.4 0 0 1 13 3.7a8.4 8.4 0 0 1 8 7.8z"/></svg>',
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 20V10M9 20V4M15 20v-8M21 20V8"/></svg>',
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 3H7a2 2 0 0 0-2 2v16l7-5 7 5V5a2 2 0 0 0-2-2z"/></svg>',
];

function syncMobileContentHistoryFromResponse(body) {
  const sections = body?.sections || {};
  contentHistorySections = {
    active: Array.isArray(sections.active) ? sections.active.slice() : [],
    draft: Array.isArray(sections.draft) ? sections.draft.slice() : [],
    inactive: Array.isArray(sections.inactive) ? sections.inactive.slice() : [],
  };
  contentHistoryArchivedCount = Number(body?.archived_count) || 0;
}

function filteredMobileContentHistorySections() {
  const company = mobileSettledCompany();
  const keep = company
    ? (campaign) => campaign.company_id === company.id
    : () => true;
  return {
    active: contentHistorySections.active.filter(keep),
    draft: contentHistorySections.draft.filter(keep),
    inactive: contentHistorySections.inactive.filter(keep),
  };
}

function mobileContentHistoryCountForCompany(companyId) {
  const id = String(companyId || "").trim();
  if (!id) return 0;
  const keep = (campaign) => campaign.company_id === id;
  return (
    contentHistorySections.active.filter(keep).length +
    contentHistorySections.draft.filter(keep).length +
    contentHistorySections.inactive.filter(keep).length
  );
}

const MOBILE_CONTENT_STUDIO_HISTORY_LOCKED_TITLE =
  "History unlocks after your first campaign";

function applyMobileContentStudioHistoryButtonState(btn, companyId) {
  if (!btn) return;
  const available = mobileContentHistoryCountForCompany(companyId) > 0;
  btn.disabled = !available;
  btn.classList.toggle("is-disabled", !available);
  btn.setAttribute("aria-disabled", available ? "false" : "true");
  if (available) btn.removeAttribute("title");
  else btn.title = MOBILE_CONTENT_STUDIO_HISTORY_LOCKED_TITLE;
}

function refreshMobileContentStudioHistoryToggle(companyId) {
  const company = mobileSettledCompany();
  const id = String(companyId || company?.id || "").trim();
  document
    .querySelectorAll('.content-tab-btn[data-mode="content"]')
    .forEach((btn) => applyMobileContentStudioHistoryButtonState(btn, id));
  if (mobileContentHistoryCountForCompany(id) > 0) return;
  if (state.contentStudioMode === "content") {
    state.contentStudioMode = "chat";
    syncCustomerContentPanel();
  }
}

function mobilePostedCampaignText(campaign) {
  const seed = campaign.selected_seed || {};
  const rawTweetIdx = Number(seed.posted_tweet_index || 0);
  const tweetIdx =
    Number.isInteger(rawTweetIdx) && rawTweetIdx >= 0 ? rawTweetIdx : 0;
  const tweets = Array.isArray(campaign.tweets) ? campaign.tweets : [];
  const tweet = tweets[tweetIdx] || tweets[0] || {};
  return String(tweet.text || "").trim();
}

function mobileContentCampaignCopy(campaign) {
  const seed = campaign.selected_seed || {};
  const seedTitle = String(seed.title || "").trim();
  const seedBlurb = String(seed.blurb || "").trim();
  if (seedTitle || seedBlurb) {
    return {
      title: seedTitle || "Untitled draft",
      blurb: seedBlurb,
    };
  }
  return {
    title: String(campaign.story_title || "").trim() || "Untitled story",
    blurb: String(campaign.story_summary || "").trim(),
  };
}

function buildMobileSitmarPostedXPost(campaign, options = {}) {
  const { linkable = false, variant = "full" } = options;
  const condensed = variant === "condensed";
  const seed = campaign.selected_seed || {};
  const rawTweetIdx = Number(seed.posted_tweet_index || 0);
  const tweetIdx =
    Number.isInteger(rawTweetIdx) && rawTweetIdx >= 0 ? rawTweetIdx : 0;
  const tweets = Array.isArray(campaign.tweets) ? campaign.tweets : [];
  const tweet = tweets[tweetIdx] || tweets[0] || {};

  const card = document.createElement(
    linkable && campaign.post_url ? "a" : "div",
  );
  if (linkable && campaign.post_url) {
    card.href = campaign.post_url;
    card.target = "_blank";
    card.rel = "noopener";
  }
  card.className =
    "mobile-xpost distribute-xpost" +
    (condensed ? " mobile-xpost--condensed" : "");

  const bt = campaign.brand_twitter || {};
  const avatarUrl = bt.profile_image_url || campaign.brand_logo_url || "";
  const displayName = bt.name || campaign.brand_name || "Brand";
  const handle = bt.handle ? `@${bt.handle}` : "";

  const top = document.createElement("div");
  top.className = "mobile-xtop";
  if (avatarUrl) {
    const av = document.createElement("img");
    av.className = "mobile-xav";
    av.src = avatarUrl;
    av.alt = "";
    av.onerror = () => av.remove();
    top.appendChild(av);
  } else {
    const av = document.createElement("span");
    av.className = "mobile-xav mobile-xav-fallback";
    setText(av, (displayName[0] || "?").toUpperCase());
    top.appendChild(av);
  }
  const who = document.createElement("div");
  who.className = "mobile-xwho";
  const nameRow = document.createElement("div");
  nameRow.className = "mobile-xname-row";
  const nameEl = document.createElement("span");
  nameEl.className = "mobile-xname";
  setText(nameEl, displayName);
  nameRow.appendChild(nameEl);
  if (bt.verified) {
    const badge = document.createElement("span");
    badge.className = "mobile-xverified";
    badge.innerHTML = MOBILE_XPOST_VERIFIED_SVG;
    nameRow.appendChild(badge);
  }
  who.appendChild(nameRow);
  if (handle) {
    const handleEl = document.createElement("div");
    handleEl.className = "mobile-xhandle";
    setText(handleEl, handle);
    who.appendChild(handleEl);
  }
  top.appendChild(who);
  card.appendChild(top);

  const text = document.createElement("p");
  text.className = "mobile-xtxt";
  setText(text, tweet.text || "");
  card.appendChild(text);

  if (!condensed) {
    const eng = document.createElement("div");
    eng.className = "mobile-xeng";
    const statSets = [
      ["42", "118", "760", "34K", "92"],
      ["28", "74", "520", "21K", "61"],
      ["65", "180", "1.1K", "48K", "134"],
    ];
    const stats = statSets[tweetIdx % statSets.length];
    MOBILE_XPOST_ENG_ICONS.forEach((icon, idx) => {
      const xe = document.createElement("span");
      xe.className = "mobile-xe";
      xe.innerHTML = icon;
      xe.appendChild(document.createTextNode(stats[idx]));
      eng.appendChild(xe);
    });
    card.appendChild(eng);
  }

  return card;
}

function openMobileCampaignDetail(campaign) {
  if (isCampaignLockedByPaywall(campaign)) {
    openUpgradeModal();
    return;
  }
  state.campaignDetailId = campaign.id;
  state.campaignTweetIndex = 0;
  if (String(campaign.status || "").toLowerCase() === "posted") {
    void loadCampaignDetail(campaign.id, true);
  } else {
    void ensureCampaignDetail(campaign.id);
  }
  renderCampaignsView();
}

function bindMobileContentCampaignCardClick(card, campaign) {
  card.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) return;
    openMobileCampaignDetail(campaign);
  });
}

function buildMobileContentCampaignCard(campaign) {
  const selected = state.campaignDetailId === campaign.id;
  const status = String(campaign.status || "").toLowerCase();

  if (status === "posted") {
    const card = document.createElement("div");
    card.dataset.campaignId = campaign.id;
    card.className =
      "content-campaign-card content-campaign-card-posted" +
      (selected ? " is-selected" : "");
    card.appendChild(
      buildMobileSitmarPostedXPost(campaign, { variant: "condensed" }),
    );
    bindMobileContentCampaignCardClick(card, campaign);
    return card;
  }

  const copy = mobileContentCampaignCopy(campaign);
  const locked = isCampaignLockedByPaywall(campaign);
  const card = document.createElement("div");
  card.dataset.campaignId = campaign.id;
  card.className =
    "cc-card content-campaign-card" +
    (selected ? " is-selected" : "") +
    (locked ? " sc-card-gated" : "");

  const head = document.createElement("div");
  head.className = "cc-card-head";
  const textStack = document.createElement("div");
  textStack.className = "cc-card-text";
  const title = document.createElement("div");
  title.className = "cc-card-title";
  setText(title, copy.title);
  textStack.appendChild(title);
  if (copy.blurb) {
    const blurb = document.createElement("div");
    blurb.className = "cc-card-story";
    setText(blurb, copy.blurb);
    textStack.appendChild(blurb);
  }
  const meta = document.createElement("div");
  meta.className = "cc-card-meta";
  const statusEl = document.createElement("span");
  statusEl.className = "content-status-pill";
  setText(statusEl, contentCampaignStatusLabel(campaign.status));
  meta.appendChild(statusEl);
  if (campaign.created_at) {
    const ts = document.createElement("span");
    ts.className = "cc-meta-time";
    setText(ts, relativeTime(campaign.created_at));
    meta.appendChild(ts);
  }
  textStack.appendChild(meta);
  head.appendChild(textStack);
  card.appendChild(head);

  bindMobileContentCampaignCardClick(card, campaign);
  return card;
}

function buildMobileContentDraftListItem(campaign) {
  const selected = state.campaignDetailId === campaign.id;
  const copy = mobileContentCampaignCopy(campaign);
  const isPost = String(campaign.status || "").toLowerCase() === "drafted";
  const locked = isCampaignLockedByPaywall(campaign);
  const item = document.createElement("div");
  item.dataset.campaignId = campaign.id;
  item.className =
    "content-campaign-card content-history-draft-item" +
    (isPost ? " is-post" : " is-react") +
    (selected ? " is-selected" : "") +
    (locked ? " sc-card-gated" : "");

  const icon = document.createElement("div");
  icon.className = "content-history-draft-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = isPost
    ? MOBILE_CONTENT_DRAFT_ICON_TWITTER
    : MOBILE_CONTENT_DRAFT_ICON_MESSAGES_SQUARE;
  item.appendChild(icon);

  const body = document.createElement("div");
  body.className =
    "content-history-draft-body" + (isPost ? " is-post" : " is-react");

  if (isPost) {
    const tweet = document.createElement("div");
    tweet.className = "content-history-draft-tweet";
    setText(tweet, mobilePostedCampaignText(campaign) || "Untitled post");
    body.appendChild(tweet);
  } else {
    const title = document.createElement("div");
    title.className = "content-history-draft-title";
    setText(title, copy.title);
    body.appendChild(title);

    const blurb = document.createElement("div");
    blurb.className = "content-history-draft-blurb";
    if (copy.blurb) setText(blurb, copy.blurb);
    body.appendChild(blurb);
  }

  item.appendChild(body);
  bindMobileContentCampaignCardClick(item, campaign);
  return item;
}

function buildMobileContentHistoryDraftCta() {
  return buildActionGrid(
    [
      {
        label: "Draft a post",
        iconHtml: MOBILE_ICON_PENCIL,
        ariaLabel: "Draft a post",
        iconBg: MOBILE_ICON_DRAFT_POST.bg,
        iconColor: MOBILE_ICON_DRAFT_POST.color,
        onClick: () => {
          void (async () => {
            const company = currentCompany();
            if (
              !(await requireSignIn({
                intent: {
                  action: "draftPost",
                  companyId: company?.id || "",
                  via: "chat",
                  contentStudioMode: "chat",
                },
              }))
            )
              return;
            state.contentStudioMode = "chat";
            syncCustomerContentPanel();
            startMobileDraftPostFlow(currentCompany());
          })();
        },
      },
    ],
    { columns: 1 },
  );
}

function appendMobileContentHistorySections(scroll, sections) {
  const sectionDefs = [
    { key: "active", label: "Active" },
    { key: "draft", label: "Drafts" },
    { key: "inactive", label: "Inactive" },
  ];
  sectionDefs.forEach(({ key, label }) => {
    const campaigns = sections[key] || [];
    if (!campaigns.length) return;
    const section = document.createElement("div");
    section.className = `content-history-section content-history-section-${key}`;
    const heading = document.createElement("div");
    heading.className = "content-history-section-label";
    const title = document.createElement("span");
    title.className = "content-history-section-title";
    setText(title, label);
    const collapsed = contentHistorySectionCollapsed.has(key);
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "content-history-section-toggle";
    setText(toggle, collapsed ? "SHOW" : "HIDE");
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    const list = document.createElement("div");
    list.className = "content-history-section-list";
    list.hidden = collapsed;
    if (collapsed) section.classList.add("is-collapsed");
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (contentHistorySectionCollapsed.has(key)) {
        contentHistorySectionCollapsed.delete(key);
      } else {
        contentHistorySectionCollapsed.add(key);
      }
      const isCollapsed = contentHistorySectionCollapsed.has(key);
      list.hidden = isCollapsed;
      section.classList.toggle("is-collapsed", isCollapsed);
      setText(toggle, isCollapsed ? "SHOW" : "HIDE");
      toggle.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    });
    heading.appendChild(title);
    heading.appendChild(toggle);
    section.appendChild(heading);
    campaigns.forEach((campaign) =>
      list.appendChild(
        key === "draft"
          ? buildMobileContentDraftListItem(campaign)
          : buildMobileContentCampaignCard(campaign),
      ),
    );
    section.appendChild(list);
    scroll.appendChild(section);
  });
}

function buildMobileCampaignHistoryRoot() {
  const root = document.createElement("div");
  root.className = "mobile-campaign-history";
  const sections = filteredMobileContentHistorySections();
  const visibleCount =
    sections.active.length + sections.draft.length + sections.inactive.length;

  if (contentHistoryArchivedCount > 0) {
    const note = document.createElement("div");
    note.className = "content-col-note";
    setText(
      note,
      `${contentHistoryArchivedCount} archived draft${
        contentHistoryArchivedCount === 1 ? "" : "s"
      } hidden`,
    );
    root.appendChild(note);
  }

  if (!visibleCount) {
    const empty = document.createElement("div");
    empty.className = "content-history-empty";
    empty.appendChild(buildMobileContentHistoryDraftCta());
    root.appendChild(empty);
    return root;
  }

  appendMobileContentHistorySections(root, sections);
  return root;
}

function buildMobileCampaignHistoryCol() {
  const col = document.createElement("div");
  col.className =
    "brand-home-content-col mobile-campaign-history-col content-col-content";
  const scroll = document.createElement("div");
  scroll.className = "content-col-scroll";
  scroll.appendChild(buildMobileCampaignHistoryRoot());
  col.appendChild(scroll);
  return col;
}

function buildCustomerContentStudioView() {
  const root = document.createElement("div");
  root.className = "sc-phone-view pre-brand-tab-content";
  root.appendChild(buildMobileContentStudioTitleWrap({ showToggle: true }));
  root.appendChild(buildMobileContentStudioBody());
  return root;
}

function brandHomeChatPhase(company) {
  if (
    String(company?.id || "").trim() &&
    !shouldResumePreBrandOnboarding(company)
  ) {
    return "ready";
  }
  if (preBrandInProgressCompany()) return "building";
  return "needsBrand";
}

function pulsePreBrandInput() {
  const input = document.querySelector(".pre-brand-overlay-input");
  if (!input) return;
  input.scrollIntoView({ behavior: "smooth", block: "center" });
  input.classList.add("is-input-highlighted");
  input.addEventListener(
    "animationend",
    () => input.classList.remove("is-input-highlighted"),
    { once: true },
  );
  requestAnimationFrame(() => input.focus());
}

function focusPreBrandCreateInput({ skipTabSwitch = false } = {}) {
  if (!skipTabSwitch && state.activeTab !== "brand") {
    setTab("brand", { slideToHome: true });
    return;
  }
  pulsePreBrandInput();
}

function buildMobileBrandHomeIntroChat(company) {
  const shell = document.createElement("div");
  shell.className = "brand-home-chat-shell sitmar-chat-shell";

  const scroll = document.createElement("div");
  scroll.className = "sitmar-chat-scroll";
  const thread = document.createElement("div");
  thread.className = "sitmar-chat-thread";

  const phase = brandHomeChatPhase(company);

  if (phase === "needsBrand") {
    thread.appendChild(
      sitmarBubble("assistant", brandHomeNeedsBrandGreeting()),
    );
    thread.appendChild(
      buildAddYourBrandAction(() => focusPreBrandCreateInput()),
    );
  } else if (phase === "building") {
    thread.appendChild(sitmarBubble("assistant", "Understanding your brand…"));
  }

  scroll.appendChild(thread);
  shell.appendChild(scroll);
  return shell;
}

function shouldResumePreBrandOnboarding(company) {
  if (!company?.id) return false;
  const trends = String(company.audience_trends_status || "")
    .trim()
    .toLowerCase();
  if (
    trends === "done" ||
    trends === "completed" ||
    trends === "error" ||
    trends === "skipped"
  ) {
    return false;
  }
  if (isMobilePipelineStalled(company)) return false;
  return isMobilePipelineInFlight(company);
}

function isMobilePipelineInFlight(company) {
  return MOBILE_STAGE_ORDER.some((field) => {
    const v = String(company?.[field] || "")
      .trim()
      .toLowerCase();
    return (
      v === "running" ||
      v === "running_reader" ||
      v.startsWith("running_") ||
      v === "pending"
    );
  });
}

function isMobilePipelineStalled(company) {
  const syn = String(company.website_synthesis_status || "")
    .trim()
    .toLowerCase();
  if (syn !== "error" && syn !== "skipped") return false;
  const audience = String(company.audience_status || "")
    .trim()
    .toLowerCase();
  if (audience !== "pending") return false;
  if (
    MOBILE_STAGE_ORDER.some((field) => {
      const v = String(company?.[field] || "")
        .trim()
        .toLowerCase();
      return (
        v === "running" || v === "running_reader" || v.startsWith("running_")
      );
    })
  ) {
    return false;
  }
  const created = Number(company.created_at || 0);
  return !created || Date.now() - created * 1000 > 15000;
}

function preBrandOverlayCompany() {
  const id =
    mobilePreBrandExistingBrandId || preBrandInProgressCompany()?.id || "";
  if (!id) return null;
  return state.companies.find((c) => c.id === id) || null;
}

function markMobileDuplicateBrandOnboarding(created) {
  if (created === false) {
    mobilePreBrandOnboardingStatusMessage = EXISTING_BRAND_ONBOARDING_MESSAGE;
    return true;
  }
  return false;
}

function setMobilePreBrandExistingBrandLoad(companyId) {
  mobilePreBrandExistingBrandId = String(companyId || "").trim();
  mobilePreBrandOnboardingStatusMessage = EXISTING_BRAND_ONBOARDING_MESSAGE;
}

function clearMobilePreBrandExistingBrandLoad() {
  mobilePreBrandExistingBrandId = "";
}

function syncMobileBrandAudiencesMemberCache(companyId, audiences) {
  const byAudience = new Map();
  audiences.forEach((item) => {
    const audienceId = String(item?.match?.audience_id || "").trim();
    if (!audienceId) return;
    byAudience.set(audienceId, {
      imageUrl: String(item.member_image_url || "").trim() || null,
      handle: String(item.member_handle || "").trim() || null,
    });
  });
  state.memberImageCache.set(companyId, byAudience);
}

async function fetchMobileBrandAudiences(companyId, { force = false } = {}) {
  if (!companyId) return [];
  if (!force) {
    const fetchedAt = mobileBrandAudiencesFetchedAt.get(companyId) || 0;
    if (fetchedAt && Date.now() - fetchedAt <= 15000) {
      return mobileBrandAudiencesCache.get(companyId) || [];
    }
    if (mobileBrandAudiencesInFlight.has(companyId)) {
      return mobileBrandAudiencesCache.get(companyId) || [];
    }
  }
  mobileBrandAudiencesInFlight.add(companyId);
  try {
    const res = await api(
      `/api/company/${encodeURIComponent(companyId)}/brand-audiences`,
    );
    if (res.status === 401) {
      showLogin();
      return mobileBrandAudiencesCache.get(companyId) || [];
    }
    if (!res.ok || !res.body) {
      return mobileBrandAudiencesCache.get(companyId) || [];
    }
    const audiences = Array.isArray(res.body.audiences)
      ? res.body.audiences
      : [];
    mobileBrandAudiencesCache.set(companyId, audiences);
    syncMobileBrandAudiencesMemberCache(companyId, audiences);
    mobileBrandAudiencesFetchedAt.set(companyId, Date.now());
    return audiences;
  } catch {
    return mobileBrandAudiencesCache.get(companyId) || [];
  } finally {
    mobileBrandAudiencesInFlight.delete(companyId);
  }
}

async function ensureMobileBrandAudiences(companyId) {
  if (!companyId || mobileBrandAudiencesInFlight.has(companyId)) return;
  await fetchMobileBrandAudiences(companyId);
  if (
    state.activeTab === "brand" &&
    state.selectedBrandId === companyId &&
    state.brandScreen === "detail"
  ) {
    renderBrandDetail();
  }
}

async function prefetchMobileBrandDashboardData(companyId) {
  if (!companyId) return null;
  const company = await pollCompany(companyId);
  await Promise.all([
    fetchMobileBrandAudiences(companyId, { force: true }),
    ensureStoriesFeed(companyId),
  ]);
  if (isPreBrandMode()) {
    renderActiveScreen();
    const overlayCompany = preBrandOverlayCompany();
    if (overlayCompany) applyPreBrandProgressState(overlayCompany);
  }
  return company;
}

async function finishSettledMobileExistingBrandOverlay(companyId) {
  if (!companyId) return;
  setMobilePreBrandExistingBrandLoad(companyId);
  try {
    await prefetchMobileBrandDashboardData(companyId);
    await new Promise((resolve) =>
      setTimeout(resolve, EXISTING_BRAND_OVERLAY_HOLD_MS),
    );
  } finally {
    clearMobilePreBrandExistingBrandLoad();
    mobilePreBrandOnboardingStatusMessage = "";
    completePreBrandTransition(companyId);
  }
}

function preBrandInProgressCompany() {
  return state.companies.find((c) => shouldResumePreBrandOnboarding(c)) || null;
}

function preBrandPreviewAudiences() {
  const overlayCompany = preBrandOverlayCompany();
  if (overlayCompany?.id) {
    const cached = mobileBrandAudiencesCache.get(overlayCompany.id);
    if (Array.isArray(cached) && cached.length) {
      return cached.slice(0, PRE_BRAND_PREVIEW_LIMIT).map((item) => ({
        title: String(item?.title || "").trim(),
        description: String(item?.description || "").trim(),
        match:
          item?.match && typeof item.match === "object" ? item.match : null,
        member_image_url: String(item?.member_image_url || "").trim() || null,
        member_handle: String(item?.member_handle || "").trim() || null,
      }));
    }
    const generated = Array.isArray(overlayCompany.audience)
      ? overlayCompany.audience
      : [];
    if (generated.length) {
      return generated.slice(0, PRE_BRAND_PREVIEW_LIMIT).map((item) => ({
        title: String(item?.title || "").trim(),
        description: String(item?.description || "").trim(),
        match:
          item?.match && typeof item.match === "object" ? item.match : null,
        member_image_url: null,
        member_handle: null,
      }));
    }
  }

  const byId = new Map();
  for (const story of preBrandStoriesFeed() || []) {
    for (const aud of story.audiences || []) {
      const audienceId = String(aud.audience_id || "").trim();
      const title = String(aud.title || "").trim();
      if (!audienceId || !title || byId.has(audienceId)) continue;
      byId.set(audienceId, {
        title,
        description: "",
        match: { audience_id: audienceId },
        member_image_url: String(aud.member_image_url || "").trim() || null,
        member_handle: String(aud.member_handle || "").trim() || null,
      });
    }
  }
  const rows = Array.from(byId.values()).sort((a, b) => {
    const ai = a.member_image_url ? 1 : 0;
    const bi = b.member_image_url ? 1 : 0;
    return bi - ai;
  });
  const out = rows.slice(0, PRE_BRAND_PREVIEW_LIMIT);
  for (const name of PRE_BRAND_DUMMY_AUDIENCES) {
    if (out.length >= PRE_BRAND_PREVIEW_LIMIT) break;
    if (out.some((row) => row.title === name)) continue;
    out.push({
      title: name,
      description: "",
      match: null,
      member_image_url: null,
    });
  }
  return out.slice(0, PRE_BRAND_PREVIEW_LIMIT);
}

function buildPreBrandAudiencePlaceholder() {
  const placeholder = document.createElement("div");
  placeholder.className = "pre-brand-placeholder-lines";
  for (let i = 0; i < 3; i += 1) {
    const line = document.createElement("div");
    line.className = "pre-brand-placeholder-line";
    line.style.width = `${65 + Math.round(Math.random() * 30)}%`;
    placeholder.appendChild(line);
  }
  return placeholder;
}

function preBrandMemberImages(audiences) {
  const map = new Map();
  audiences.forEach((item) => {
    const audienceId =
      item?.match && typeof item.match === "object"
        ? String(item.match.audience_id || "").trim()
        : "";
    const imageUrl = String(item.member_image_url || "").trim() || null;
    if (!audienceId || !imageUrl) return;
    map.set(audienceId, {
      imageUrl,
      handle: String(item.member_handle || "").trim() || null,
    });
  });
  return map;
}

function buildPreBrandAudiencesCol() {
  const previewAudiences = preBrandPreviewAudiences();
  const memberImages = preBrandMemberImages(previewAudiences);
  const col = document.createElement("div");
  col.className = "brand-home-audiences-col";

  const blur = document.createElement("div");
  blur.className = "pre-brand-audiences-blur";

  const nav = document.createElement("div");
  nav.className = "brand-home-aud-nav";
  const navHead = document.createElement("div");
  navHead.className = "brand-home-aud-head";
  const titleStack = document.createElement("div");
  titleStack.className = "sc-title-stack";
  titleStack.appendChild(brandHomeTitleH1("Target Audiences"));
  navHead.appendChild(titleStack);
  nav.appendChild(navHead);
  col.appendChild(nav);

  const details = document.createElement("div");
  details.className = "brand-home-aud-details";
  previewAudiences.forEach((item, idx) => {
    const matchedAudienceId =
      item?.match && typeof item.match === "object"
        ? String(item.match.audience_id || "").trim()
        : "";
    const section = document.createElement("div");
    section.className = "brand-home-aud-section";
    if (matchedAudienceId) section.id = `brand-aud-${matchedAudienceId}`;

    const header = document.createElement("div");
    header.className = "brand-home-aud-section-head";
    const member = matchedAudienceId
      ? memberImages.get(matchedAudienceId) || null
      : null;
    header.appendChild(
      avatarFor(
        member?.handle || item.title || `audience-${idx + 1}`,
        "brand-home-aud-section-avatar",
        member?.imageUrl || item.member_image_url || null,
      ),
    );
    const title = document.createElement("h3");
    title.className = "brand-home-aud-section-title";
    setText(title, String(item.title || "Untitled audience"));
    header.appendChild(title);
    section.appendChild(header);

    const detail = document.createElement("div");
    detail.className = "brand-home-aud-detail";
    const consumingWrap = document.createElement("div");
    consumingWrap.className =
      "brand-consuming-stories brand-consuming-stories-compact";
    consumingWrap.appendChild(buildEngagingNowLabel());

    if (matchedAudienceId) {
      const matchedStories = brandStoriesForAudience(
        preBrandStoriesFeed(),
        matchedAudienceId,
        { skipScoreFilter: true },
      );
      if (!matchedStories.length) {
        consumingWrap.appendChild(buildPreBrandAudiencePlaceholder());
      } else {
        matchedStories.forEach((story) => {
          consumingWrap.appendChild(buildMobileAudienceStoryRow(story));
        });
      }
    } else {
      consumingWrap.appendChild(buildPreBrandAudiencePlaceholder());
    }
    detail.appendChild(consumingWrap);
    section.appendChild(detail);
    details.appendChild(section);
  });
  blur.appendChild(details);
  col.appendChild(blur);
  col.appendChild(buildPreBrandOverlay());
  return col;
}

function buildMobilePreBrandContentCol(company) {
  const col = document.createElement("div");
  col.className = "brand-home-content-col is-chat";
  const scroll = document.createElement("div");
  scroll.className = "content-col-scroll";
  scroll.appendChild(buildMobileBrandHomeIntroChat(company));
  col.appendChild(scroll);
  return col;
}

const PRE_BRAND_OVERLAY_X_LOGO =
  '<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.254 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>';

function fillPreBrandOverlayLabel(el) {
  const line1 = document.createElement("span");
  line1.className = "pre-brand-overlay-label-line";
  setText(line1, "Enter your website and start converting");
  const line2 = document.createElement("span");
  line2.className = "pre-brand-overlay-label-line";
  const xLogo = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  xLogo.setAttribute("class", "pre-brand-overlay-x");
  xLogo.setAttribute("viewBox", "0 0 24 24");
  xLogo.setAttribute("aria-hidden", "true");
  xLogo.innerHTML = PRE_BRAND_OVERLAY_X_LOGO;
  line2.appendChild(xLogo);
  line2.appendChild(document.createTextNode(" attention into new users."));
  el.appendChild(line1);
  el.appendChild(line2);
}

function buildPreBrandOverlaySignInPrompt() {
  const clerk = getClerk();
  if (clerk && clerk.user) return null;
  const row = document.createElement("p");
  row.className = "pre-brand-overlay-sign-in";
  row.appendChild(document.createTextNode("or "));
  const link = document.createElement("button");
  link.type = "button";
  link.className = "pre-brand-overlay-sign-in-link";
  setText(link, "sign in to your account");
  link.addEventListener("click", () => {
    void requireSignIn();
  });
  row.appendChild(link);
  return row;
}

function buildPreBrandOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "pre-brand-create-overlay";

  const card = document.createElement("div");
  card.className = "pre-brand-overlay-card";

  const form = document.createElement("form");
  form.className = "pre-brand-overlay-form";
  form.noValidate = true;
  const labelKicker = document.createElement("div");
  labelKicker.className = "pre-brand-overlay-kicker";
  setText(labelKicker, "Find your next users");
  form.appendChild(labelKicker);
  const label = document.createElement("div");
  label.className = "pre-brand-overlay-label";
  fillPreBrandOverlayLabel(label);
  form.appendChild(label);

  const inputWrap = document.createElement("div");
  inputWrap.className = "brand-create-input-wrap";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "brand-create-input pre-brand-overlay-input";
  input.placeholder = "melea.ai";
  input.autocomplete = "url";
  input.name = "website_url";
  inputWrap.appendChild(input);
  const enterBtn = document.createElement("button");
  enterBtn.type = "submit";
  enterBtn.className = "brand-create-enter";
  enterBtn.setAttribute("aria-label", "Continue");
  enterBtn.innerHTML =
    '<span class="sc-react-arrow"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>';
  inputWrap.appendChild(enterBtn);
  form.appendChild(inputWrap);
  const signInPrompt = buildPreBrandOverlaySignInPrompt();
  if (signInPrompt) form.appendChild(signInPrompt);

  const errEl = document.createElement("div");
  errEl.className = "brand-create-error pre-brand-overlay-error";
  form.appendChild(errEl);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void submitPreBrandWebsite(input, errEl, enterBtn, card);
  });
  card.appendChild(form);

  const progress = document.createElement("div");
  progress.className = "pre-brand-overlay-progress";
  const progressLogo = document.createElement("img");
  progressLogo.className = "pre-brand-overlay-logo";
  progressLogo.alt = "";
  progress.appendChild(progressLogo);
  const progressMeta = document.createElement("div");
  progressMeta.className = "pre-brand-overlay-meta";
  const progressName = document.createElement("div");
  progressName.className = "pre-brand-overlay-name";
  progressMeta.appendChild(progressName);
  const progressStatus = meleaStatusLine(PRE_BRAND_ONBOARDING_FALLBACK, {
    labelClass: "pre-brand-overlay-status",
    showLogo: false,
  });
  progressMeta.appendChild(progressStatus);
  progress.appendChild(progressMeta);
  const progressBarTrack = document.createElement("div");
  progressBarTrack.className = "pre-brand-overlay-bar-track";
  const progressBarFill = document.createElement("div");
  progressBarFill.className = "pre-brand-overlay-bar-fill";
  progressBarTrack.appendChild(progressBarFill);
  progress.appendChild(progressBarTrack);
  card.appendChild(progress);

  overlay.appendChild(card);
  return overlay;
}

function applyPreBrandProgressState(company) {
  const card = document.querySelector(".pre-brand-overlay-card");
  if (!card || !company) return;
  const logo = card.querySelector(".pre-brand-overlay-logo");
  const logoUrl = String(
    company.website_synthesis_business_logo_url || "",
  ).trim();
  const host = websiteDomain(company.website_url);
  if (logo) {
    if (logoUrl) {
      logo.src = logoUrl;
      logo.style.display = "";
    } else if (host) {
      logo.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
      logo.style.display = "";
    }
    logo.onerror = () => {
      logo.style.display = "none";
    };
  }
  const nameEl = card.querySelector(".pre-brand-overlay-name");
  if (nameEl) setText(nameEl, companyDisplayName(company));
  card.classList.add("is-progress");
  updatePreBrandOverlay(company);
}

function updatePreBrandOverlay(company) {
  if (!company) return;
  const card = document.querySelector(".pre-brand-overlay-card");
  if (card) {
    const nameEl = card.querySelector(".pre-brand-overlay-name");
    const nextName = companyDisplayName(company);
    if (nameEl && nextName && nameEl.textContent !== nextName) {
      setText(nameEl, nextName);
    }
    const logo = card.querySelector(".pre-brand-overlay-logo");
    const logoUrl = String(
      company.website_synthesis_business_logo_url || "",
    ).trim();
    if (logo && logoUrl) {
      logo.style.display = "";
      if (!logo.src || !logo.src.includes(logoUrl)) {
        logo.src = logoUrl;
        logo.onerror = () => {
          logo.style.display = "none";
        };
      }
    }
  }
  const statusEl = document.querySelector(".pre-brand-overlay-status");
  if (!statusEl) return;
  const msg = onboardingMessage(company) || PRE_BRAND_ONBOARDING_FALLBACK;
  if (msg && msg !== statusEl.textContent) {
    statusEl.classList.add("onboarding-status-swap");
    setText(statusEl, msg);
    statusEl.addEventListener(
      "animationend",
      () => statusEl.classList.remove("onboarding-status-swap"),
      { once: true },
    );
  }
  const fill = card && card.querySelector(".pre-brand-overlay-bar-fill");
  if (fill) {
    fill.style.width = `${onboardingProgressPct(company)}%`;
  }
}

function completePreBrandTransition(companyId) {
  const blur = document.querySelector(".pre-brand-audiences-blur");
  const overlay = document.querySelector(".pre-brand-create-overlay");
  if (blur) blur.classList.add("pre-brand-unblur");
  if (overlay) overlay.classList.add("pre-brand-overlay-exit");
  setTimeout(() => {
    void openSettledBrandHome(companyId);
  }, 420);
}

async function ensurePreBrandStories() {
  await ensureStoriesFeed(MOBILE_ANONYMOUS_STORIES_KEY);
}

function buildPreBrandHomePanel() {
  const panel = document.createElement("div");
  panel.className = "pre-brand-panel pre-brand-panel-home";
  const root = document.createElement("div");
  root.className =
    "customer-view sc-phone-view pre-brand-home pre-brand-tab-home";
  root.appendChild(buildPreBrandAudiencesCol());
  panel.appendChild(root);
  return panel;
}

function buildPreBrandContentPanel() {
  const company = preBrandInProgressCompany() || emptyHomeCompany();
  const panel = document.createElement("div");
  panel.className = "pre-brand-panel pre-brand-panel-content";
  const root = document.createElement("div");
  root.className = "sc-phone-view pre-brand-tab-content";
  root.appendChild(buildMobileContentStudioTitleWrap());
  root.appendChild(buildMobilePreBrandContentCol(company));
  panel.appendChild(root);
  return panel;
}

function buildPreBrandStoriesPanel() {
  const panel = document.createElement("div");
  panel.className = "pre-brand-panel pre-brand-panel-stories";
  panel.appendChild(buildStoriesViewRoot({ preBrand: true }));
  return panel;
}

function syncPreBrandStoriesPanel() {
  const panel = document.querySelector(".pre-brand-panel-stories");
  if (!panel) return;
  panel.innerHTML = "";
  panel.appendChild(buildStoriesViewRoot({ preBrand: true }));
}

function syncPreBrandHomePanel() {
  const panel = document.querySelector(".pre-brand-panel-home");
  if (!panel) return;
  panel.innerHTML = "";
  const root = document.createElement("div");
  root.className =
    "customer-view sc-phone-view pre-brand-home pre-brand-tab-home";
  root.appendChild(buildPreBrandAudiencesCol());
  panel.appendChild(root);
  const inProgress = preBrandInProgressCompany();
  if (inProgress) applyPreBrandProgressState(inProgress);
}

function ensurePreBrandShell() {
  setBrandCreateActive(false);
  clearBrandCreateView();
  state.brandScreen = "detail";
  const listScreen = $("#screen-brand-list");
  const detailScreen = $("#screen-brand-detail");
  listScreen?.classList.add("hidden");
  detailScreen?.classList.remove("hidden");
  const detail = $("#brand-detail-content");
  if (!detail || detail.querySelector(".pre-brand-shell")) return;

  detail.innerHTML = "";
  const shell = document.createElement("div");
  shell.className = "pre-brand-shell";
  const track = document.createElement("div");
  track.className = "pre-brand-track";
  track.appendChild(buildPreBrandHomePanel());
  track.appendChild(buildPreBrandStoriesPanel());
  track.appendChild(buildPreBrandContentPanel());
  shell.appendChild(track);
  detail.appendChild(shell);
}

function ensureCustomerShell() {
  setBrandCreateActive(false);
  clearBrandCreateView();
  state.brandScreen = "detail";
  const listScreen = $("#screen-brand-list");
  const detailScreen = $("#screen-brand-detail");
  listScreen?.classList.add("hidden");
  detailScreen?.classList.remove("hidden");
  const detail = $("#brand-detail-content");
  if (!detail || detail.querySelector(".pre-brand-shell.customer-tab-shell"))
    return;

  detail.innerHTML = "";
  const shell = document.createElement("div");
  shell.className = "pre-brand-shell customer-tab-shell";
  const track = document.createElement("div");
  track.className = "pre-brand-track";
  track.appendChild(buildCustomerHomePanel());
  track.appendChild(buildCustomerStoriesPanel());
  track.appendChild(buildCustomerContentPanel());
  shell.appendChild(track);
  detail.appendChild(shell);
}

function buildCustomerHomePanel() {
  const panel = document.createElement("div");
  panel.className = "pre-brand-panel pre-brand-panel-home";
  const root = buildCustomerHomeRoot();
  root.classList.add("pre-brand-tab-home");
  panel.appendChild(root);
  return panel;
}

function buildCustomerStoriesPanel() {
  const panel = document.createElement("div");
  panel.className = "pre-brand-panel pre-brand-panel-stories";
  const root = buildStoriesViewRoot({ preBrand: false });
  root.classList.add("pre-brand-tab-stories");
  panel.appendChild(root);
  return panel;
}

function buildCustomerContentPanel() {
  const panel = document.createElement("div");
  panel.className = "pre-brand-panel pre-brand-panel-content";
  const mount = document.createElement("div");
  mount.className = "customer-content-mount";
  mount.appendChild(buildCustomerContentStudioView());
  panel.appendChild(mount);
  return panel;
}

function syncCustomerHomePanel() {
  const panel = document.querySelector(
    ".customer-tab-shell .pre-brand-panel-home",
  );
  if (!panel) return;
  panel.innerHTML = "";
  const root = buildCustomerHomeRoot();
  root.classList.add("pre-brand-tab-home");
  panel.appendChild(root);
}

function syncCustomerStoriesPanel() {
  const panel = document.querySelector(
    ".customer-tab-shell .pre-brand-panel-stories",
  );
  if (!panel) return;
  panel.innerHTML = "";
  const root = buildStoriesViewRoot({ preBrand: false });
  root.classList.add("pre-brand-tab-stories");
  panel.appendChild(root);
}

function syncCustomerContentPanel() {
  const mount = document.querySelector(
    ".customer-tab-shell .customer-content-mount",
  );
  if (!mount) return;
  mount.innerHTML = "";
  mount.appendChild(buildCustomerContentStudioView());
}

function customerContentMount() {
  return document.querySelector(".customer-tab-shell .customer-content-mount");
}

function setMobileTrackTab(tab, { slideToHome = false, animate = true } = {}) {
  const track = document.querySelector(".pre-brand-shell .pre-brand-track");
  if (!track) return;

  const index = MOBILE_TAB_OFFSET[tab] ?? 0;
  const panels = track.querySelectorAll(".pre-brand-panel");
  panels.forEach((panel, panelIndex) => {
    const isActive = panelIndex === index;
    panel.classList.toggle("is-active-panel", isActive);
    panel.setAttribute("aria-hidden", isActive ? "false" : "true");
  });
  track.classList.toggle("pre-brand-track-instant", !animate);
  track.style.setProperty("--track-index", String(index));
  if (!animate) {
    requestAnimationFrame(() =>
      track.classList.remove("pre-brand-track-instant"),
    );
  }

  if (!slideToHome || tab !== "brand" || !isPreBrandMode()) return;

  let finished = false;
  const runPulse = () => {
    if (finished) return;
    finished = true;
    focusPreBrandCreateInput({ skipTabSwitch: true });
  };

  if (animate) {
    track.addEventListener(
      "transitionend",
      (e) => {
        if (e.target !== track || e.propertyName !== "transform") return;
        runPulse();
      },
      { once: true },
    );
    window.setTimeout(runPulse, 520);
  } else {
    requestAnimationFrame(runPulse);
  }
}

function renderBrandHomeEmpty() {
  state.activeTab = "brand";
  renderActiveScreen();
}

function renderActiveScreen(opts = {}) {
  const listScreen = $("#screen-brand-list");
  const detailScreen = $("#screen-brand-detail");
  const detail = $("#brand-detail-content");

  if (isPreBrandMode()) {
    listScreen.classList.add("hidden");
    detailScreen.classList.remove("hidden");
    const hadShell = !!detail.querySelector(".pre-brand-shell");
    ensurePreBrandShell();
    setMobileTrackTab(state.activeTab, {
      slideToHome: !!opts.slideToHome,
      animate: hadShell,
    });
    void ensurePreBrandStories();
    const inProgress = preBrandOverlayCompany();
    if (inProgress) {
      applyPreBrandProgressState(inProgress);
      scheduleOnboardingPoll(inProgress.id);
    }
    if (typeof syncUpgradeChrome === "function") syncUpgradeChrome();
    return;
  }

  if (state.selectedBrandId && state.brandScreen === "detail") {
    listScreen.classList.add("hidden");
    detailScreen.classList.remove("hidden");
    const hadShell = !!detail.querySelector(".customer-tab-shell");
    ensureCustomerShell();
    setMobileTrackTab(state.activeTab, { animate: hadShell });
    if (state.activeTab === "brand") syncCustomerHomePanel();
    if (state.activeTab === "stories") {
      const feedKey = mobileStoriesFeedKey();
      if (!state.storiesFeedCache.has(feedKey)) void ensureStoriesFeed(feedKey);
      else syncCustomerStoriesPanel();
    }
    if (state.activeTab === "campaigns") {
      if (state.campaignDetailId) renderCampaignsView();
      else syncCustomerContentPanel();
    }
    if (typeof syncUpgradeChrome === "function") syncUpgradeChrome();
    return;
  }

  if (state.activeTab === "brand") {
    if (state.brandScreen === "detail" && state.selectedBrandId) {
      listScreen.classList.add("hidden");
      detailScreen.classList.remove("hidden");
      renderBrandDetail();
    } else {
      renderBrandHomeEmpty();
    }
    return;
  }

  listScreen.classList.add("hidden");
  detailScreen.classList.remove("hidden");
  detail.innerHTML = "";
  if (state.activeTab === "stories") {
    renderStoriesView();
  } else if (state.activeTab === "campaigns") {
    renderCampaignsView();
  }
  if (typeof syncUpgradeChrome === "function") syncUpgradeChrome();
}

function renderBrandList() {
  const listScreen = $("#screen-brand-list");
  setBrandCreateActive(false);
  const title = listScreen?.querySelector(".screen-title");
  if (title) title.classList.remove("hidden");
  const host = listScreen?.querySelector(".brand-create-screen");
  if (host) host.remove();
  const list = $("#brand-list");
  const empty = $("#brand-list-empty");
  if (list) list.classList.remove("hidden");
  const appbarHost = $("#brand-list-appbar");
  if (appbarHost && !appbarHost.hasChildNodes()) {
    appbarHost.appendChild(buildMeleaAppbar());
  }
  if (list) list.innerHTML = "";
  if (empty) empty.classList.toggle("hidden", state.companies.length > 0);
}

function customerLoadingMessage(company) {
  if (!company) return null;
  if (isMobilePipelineStalled(company)) return null;
  if (shouldResumePreBrandOnboarding(company)) {
    return onboardingMessage(company) || PRE_BRAND_ONBOARDING_FALLBACK;
  }
  if (isStagePendingOrRunningMobile(company, "audience_status")) {
    return "Identifying your audiences...";
  }
  if (isStagePendingOrRunningMobile(company, "audience_match_status")) {
    return "Matching to our audience network...";
  }
  if (isStagePendingOrRunningMobile(company, "audience_trends_status")) {
    return "Collecting relevant trends...";
  }
  return null;
}

let brandHomePipelinePollTimer = null;

function clearBrandHomePipelinePoll() {
  if (!brandHomePipelinePollTimer) return;
  clearInterval(brandHomePipelinePollTimer);
  brandHomePipelinePollTimer = null;
}

function scheduleBrandHomePipelinePoll(companyId) {
  if (!companyId || brandHomePipelinePollTimer) return;
  const tick = async () => {
    const company = await pollCompany(companyId);
    if (!company) {
      clearBrandHomePipelinePoll();
      return;
    }
    await api(`/api/company/${encodeURIComponent(companyId)}/stages`);
    await fetchMobileBrandAudiences(companyId, { force: true });
    if (
      state.activeTab === "brand" &&
      state.selectedBrandId === companyId &&
      state.brandScreen === "detail"
    ) {
      renderBrandDetail();
    }
    if (!customerLoadingMessage(company)) clearBrandHomePipelinePoll();
  };
  void tick();
  brandHomePipelinePollTimer = setInterval(tick, 2000);
}

function isRunning(status) {
  const v = String(status || "")
    .trim()
    .toLowerCase();
  return v === "pending" || v === "running" || v.startsWith("running_");
}

const MOBILE_STAGE_ORDER = [
  "website_synthesis_status",
  "audience_status",
  "audience_match_status",
  "brand_synthesis_status",
  "brand_scoring_status",
  "audience_trends_status",
];

function isTerminalStageStatus(status) {
  const v = String(status || "")
    .trim()
    .toLowerCase();
  return (
    v === "done" ||
    v === "completed" ||
    v === "error" ||
    v === "skipped" ||
    v === "idle"
  );
}

function isStagePendingOrRunningMobile(company, statusField) {
  const status = String(company?.[statusField] || "")
    .trim()
    .toLowerCase();
  if (status === "running" || status.startsWith("running_")) return true;
  if (status !== "pending") return false;
  if (isMobilePipelineStalled(company)) return false;
  const idx = MOBILE_STAGE_ORDER.indexOf(statusField);
  if (idx <= 0) return true;
  for (let i = 0; i < idx; i++) {
    if (!isTerminalStageStatus(company?.[MOBILE_STAGE_ORDER[i]])) return false;
  }
  return true;
}

const MOBILE_ONBOARDING_STAGE_WEIGHTS = [
  { field: "website_synthesis_status", weight: 25 },
  { field: "audience_status", weight: 30 },
  { field: "audience_match_status", weight: 15 },
  { field: "brand_synthesis_status", weight: 20 },
  { field: "brand_scoring_status", weight: 10 },
  { field: "audience_trends_status", weight: 3 },
];
const MOBILE_ONBOARDING_TOTAL_WEIGHT = MOBILE_ONBOARDING_STAGE_WEIGHTS.reduce(
  (s, e) => s + e.weight,
  0,
);

function mobileOnboardingStageStatus(company, field) {
  return String(company?.[field] || "")
    .trim()
    .toLowerCase();
}

function onboardingProgressPct(company) {
  if (!company) return 0;
  let earned = 0;
  for (const { field, weight } of MOBILE_ONBOARDING_STAGE_WEIGHTS) {
    const s = mobileOnboardingStageStatus(company, field);
    if (isTerminalStageStatus(s)) {
      earned += weight;
    } else if (s === "running" || s.startsWith("running_")) {
      earned += weight * 0.5;
    }
  }
  return Math.min(
    99,
    Math.round((earned / MOBILE_ONBOARDING_TOTAL_WEIGHT) * 100),
  );
}

function onboardingMessage(company) {
  if (
    mobilePreBrandExistingBrandId &&
    company?.id === mobilePreBrandExistingBrandId
  ) {
    return (
      mobilePreBrandOnboardingStatusMessage || EXISTING_BRAND_ONBOARDING_MESSAGE
    );
  }
  const synthesis = String(company.website_synthesis_status || "")
    .trim()
    .toLowerCase();
  if (synthesis === "running_reader") return "Reading your website...";
  if (isStagePendingOrRunningMobile(company, "website_synthesis_status")) {
    return "Understanding your brand...";
  }
  if (isStagePendingOrRunningMobile(company, "audience_status")) {
    return "Identifying your audiences...";
  }
  if (isStagePendingOrRunningMobile(company, "audience_match_status")) {
    return "Matching to our audience network...";
  }
  if (isStagePendingOrRunningMobile(company, "brand_synthesis_status")) {
    return "Writing your brand story...";
  }
  if (isStagePendingOrRunningMobile(company, "brand_scoring_status")) {
    return "Scoring news stories to your brand...";
  }
  if (isStagePendingOrRunningMobile(company, "audience_trends_status")) {
    return "Collecting relevant trends...";
  }
  if (
    mobilePreBrandOnboardingStatusMessage === EXISTING_BRAND_ONBOARDING_MESSAGE
  ) {
    return mobilePreBrandOnboardingStatusMessage;
  }
  return null;
}

function brandStoriesForAudience(
  stories,
  audienceId,
  { skipScoreFilter = false } = {},
) {
  return (stories || [])
    .filter((story) =>
      Array.isArray(story.audiences)
        ? story.audiences.some(
            (a) => String(a.audience_id || "") === audienceId,
          )
        : false,
    )
    .filter(
      (story) => skipScoreFilter || meetsBrandScoreThreshold(story.brand_score),
    )
    .sort((a, b) => {
      const aa = (a.audiences || []).find(
        (row) => String(row.audience_id || "") === audienceId,
      );
      const bb = (b.audiences || []).find(
        (row) => String(row.audience_id || "") === audienceId,
      );
      const aTime = customerStoryTimeMs(
        aa?.last_seen_at || a.story_last_seen_at,
      );
      const bTime = customerStoryTimeMs(
        bb?.last_seen_at || b.story_last_seen_at,
      );
      return bTime - aTime;
    })
    .slice(0, 2);
}

function topStoryPosts(story, limit = 3) {
  return Array.isArray(story?.posts) ? story.posts.slice(0, limit) : [];
}

function buildStoryPostList(posts, listClass = "") {
  const postList = document.createElement("div");
  postList.className = `customer-mobile-post-list${listClass ? ` ${listClass}` : ""}`;
  posts.forEach((post) => {
    const url = String(post.url || "").trim();
    const postRow = document.createElement(url ? "a" : "div");
    postRow.className = "customer-mobile-post-row";
    if (url) {
      postRow.href = url;
      postRow.target = "_blank";
      postRow.rel = "noopener";
    }

    const rawHandle = String(post.author_handle || "")
      .trim()
      .replace(/^@+/, "");
    const handle = rawHandle ? `@${rawHandle}` : "@account";
    postRow.appendChild(
      avatarFor(
        rawHandle || post.author_name || "account",
        "customer-mobile-post-avatar",
        post.author_avatar || null,
      ),
    );

    const body = document.createElement("div");
    body.className = "customer-mobile-post-body";

    const handleEl = document.createElement("div");
    handleEl.className = "customer-mobile-post-handle";
    setText(handleEl, handle);
    body.appendChild(handleEl);

    const textEl = document.createElement("div");
    textEl.className = "customer-mobile-post-text";
    setText(textEl, String(post.text || ""));
    body.appendChild(textEl);

    const eng = document.createElement("div");
    eng.className = "customer-mobile-post-eng";
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
      xe.className = "customer-mobile-post-xe";
      xe.innerHTML = `${icon}<b>${formatCompactCount(val || 0)}</b>`;
      eng.appendChild(xe);
    });
    body.appendChild(eng);

    postRow.appendChild(body);
    postList.appendChild(postRow);
  });
  return postList;
}

function buildMeleaAppbar() {
  const appbar = document.createElement("div");
  appbar.className = "sc-appbar";
  const brand = document.createElement("div");
  brand.className = "sc-appbar-brand";
  brand.innerHTML = `<img class="sc-appbar-logo" src="/static/assets/images/wordmark-sans-trans.png" alt="melea">`;
  appbar.appendChild(brand);
  return appbar;
}

function trendingOnXTitleH1() {
  const h1 = document.createElement("h1");
  h1.className = "sc-title-h1 sc-title-h1-with-icon";
  const text = document.createElement("span");
  setText(text, "Trending on");
  h1.appendChild(text);
  const xLogo = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  xLogo.setAttribute("class", "sc-title-x");
  xLogo.setAttribute("viewBox", "0 0 24 24");
  xLogo.setAttribute("aria-hidden", "true");
  xLogo.innerHTML = PRE_BRAND_OVERLAY_X_LOGO;
  h1.appendChild(xLogo);
  return h1;
}

function buildMobileAudienceStoryRow(story) {
  const tone = storyUrgency(story.story_last_seen_at).tone;
  const row = document.createElement("button");
  row.type = "button";
  row.className = `brand-consuming-story sc-card is-${tone}`;
  const titleEl = document.createElement("span");
  titleEl.className = "brand-consuming-story-title";
  setText(titleEl, story.headline || story.title || "Story");
  row.setAttribute(
    "aria-label",
    `Open story: ${titleEl.textContent || "Story"}`,
  );
  row.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const storyId = String(story.story_id || story.id || story.headline || "");
    if (storyId) {
      state.storiesExpanded = new Set([storyId]);
      state.storiesAutoOpened = true;
    }
    setTab("stories");
  });
  row.appendChild(titleEl);
  const action = document.createElement("span");
  action.className = "brand-consuming-story-action sc-react-btn";
  const reactLabel = document.createElement("span");
  reactLabel.className = "sc-react-label";
  reactLabel.setAttribute("aria-hidden", "true");
  setText(reactLabel, "React");
  action.appendChild(reactLabel);
  const arrow = document.createElement("span");
  arrow.className = "sc-react-arrow";
  arrow.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  action.appendChild(arrow);
  row.appendChild(action);
  return row;
}

function buildBrandHeaderLogo(company) {
  const logoUrl = String(
    company.website_synthesis_business_logo_url || "",
  ).trim();
  if (logoUrl) {
    return avatarFor(
      companyDisplayName(company),
      "sc-brand-title-logo",
      logoUrl,
    );
  }
  const fav = brandFavicon(company.website_url);
  if (fav) {
    fav.className = "sc-brand-title-logo";
    return fav;
  }
  return avatarFor(companyDisplayName(company), "sc-brand-title-logo", null);
}

function buildBrandHomeAudiencesBrandHeader(company) {
  const wrap = document.createElement("div");
  wrap.className = "brand-home-aud-brand";
  wrap.appendChild(buildBrandHeaderLogo(company));
  const name = document.createElement("div");
  name.className = "brand-home-aud-brand-name";
  setText(name, companyDisplayName(company));
  wrap.appendChild(name);
  return wrap;
}

function mobileBrandHomeStories(item) {
  if (!Array.isArray(item?.recent_stories)) return [];
  return item.recent_stories.map((story) => ({
    story_id: story.story_id,
    headline: story.headline,
    story_last_seen_at: story.last_seen_at || story.story_last_seen_at,
    brand_score: story.brand_score,
  }));
}

function buildCustomerHomeRoot() {
  const company = currentCompany();
  const root = document.createElement("div");
  root.className = "customer-view sc-phone-view";
  if (!company) {
    const empty = document.createElement("div");
    empty.className = "empty";
    setText(empty, "Brand not found.");
    root.appendChild(empty);
    return root;
  }

  const cachedAudiences = mobileBrandAudiencesCache.get(company.id);
  const audiences = Array.isArray(cachedAudiences)
    ? cachedAudiences
    : Array.isArray(company.audience)
      ? company.audience.filter(
          (item) =>
            item?.match?.audience_id && (item.title || item.description),
        )
      : [];
  const lastFetch = mobileBrandAudiencesFetchedAt.get(company.id) || 0;
  if (!lastFetch || Date.now() - lastFetch > 15000) {
    void ensureMobileBrandAudiences(company.id);
  }

  const stickyHead = document.createElement("div");
  stickyHead.className = "brand-home-aud-sticky-head";
  stickyHead.appendChild(buildBrandHomeAudiencesBrandHeader(company));

  const heading = document.createElement("div");
  heading.className = "sc-title-wrap brand-home-aud-head";
  const titleStack = document.createElement("div");
  titleStack.className = "sc-title-stack";
  titleStack.appendChild(brandHomeTitleH1("Target Audiences"));
  heading.appendChild(titleStack);
  stickyHead.appendChild(heading);
  root.appendChild(stickyHead);

  const loadingMsg = customerLoadingMessage(company);
  if (loadingMsg) {
    const loading = document.createElement("section");
    loading.className = "customer-mobile-loading";
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    loading.appendChild(spinner);
    loading.appendChild(document.createTextNode(loadingMsg));
    root.appendChild(loading);
    scheduleBrandHomePipelinePoll(company.id);
  } else if (!audiences.length) {
    const empty = document.createElement("div");
    empty.className = "sc-empty";
    const audStatus = String(company.audience_status || "")
      .trim()
      .toLowerCase();
    const msg =
      audStatus === "error"
        ? "Couldn't identify audiences for this brand."
        : "No matched audiences yet.";
    setText(empty, msg);
    root.appendChild(empty);
    if (isMobilePipelineStalled(company)) {
      scheduleBrandHomePipelinePoll(company.id);
    }
  } else {
    const list = document.createElement("div");
    list.className = "customer-mobile-audiences-list";
    audiences.forEach((item, idx) => {
      const matchedAudienceId = String(item.match?.audience_id || "");
      const card = document.createElement("div");
      card.className = "customer-mobile-audience-card brand-home-aud-section";

      const header = document.createElement("div");
      header.className = "brand-home-aud-section-head";
      header.appendChild(
        avatarFor(
          item.member_handle || item.title || `audience-${idx + 1}`,
          "brand-home-aud-section-avatar",
          item.member_image_url || null,
        ),
      );
      const title = document.createElement("h3");
      title.className = "brand-home-aud-section-title";
      setText(title, String(item.title || "Untitled audience"));
      header.appendChild(title);

      const descriptionText = String(item.description || "").trim();
      let descEl = null;
      if (descriptionText) {
        descEl = document.createElement("p");
        descEl.className = "brand-home-aud-description";
        setText(descEl, descriptionText);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "brand-home-aud-section-toggle";
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Show audience description");
        toggle.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
        toggle.addEventListener("click", (event) => {
          event.stopPropagation();
          if (!descEl) return;
          const expanded = descEl.classList.toggle("is-expanded");
          toggle.classList.toggle("is-expanded", expanded);
          toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
          toggle.setAttribute(
            "aria-label",
            expanded
              ? "Hide audience description"
              : "Show audience description",
          );
        });
        header.appendChild(toggle);
      }
      card.appendChild(header);
      if (descEl) card.appendChild(descEl);

      const audDetail = document.createElement("div");
      audDetail.className = "brand-home-aud-detail";
      const consumingWrap = document.createElement("div");
      consumingWrap.className =
        "brand-consuming-stories brand-consuming-stories-compact";
      consumingWrap.appendChild(buildEngagingNowLabel());

      const matchedStories = mobileBrandHomeStories(item);
      if (!matchedStories.length) {
        const empty = document.createElement("div");
        empty.className = "sc-empty";
        setText(
          empty,
          matchedAudienceId
            ? "No connected stories yet."
            : "No matched in-house audience yet.",
        );
        consumingWrap.appendChild(empty);
      } else {
        matchedStories.forEach((story) => {
          consumingWrap.appendChild(buildMobileAudienceStoryRow(story));
        });
      }
      audDetail.appendChild(consumingWrap);
      card.appendChild(audDetail);

      list.appendChild(card);
    });
    root.appendChild(list);
  }

  return root;
}

function renderBrandDetail() {
  syncCustomerHomePanel();
}

function bindSeenByTooltip(tipWrap, tooltip) {
  let portal = null;
  let place = null;
  let dismissHandler = null;

  const cleanup = () => {
    if (place) {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      place = null;
    }
    if (dismissHandler) {
      document.removeEventListener("click", dismissHandler, true);
      document.removeEventListener("touchstart", dismissHandler, true);
      dismissHandler = null;
    }
    portal?.remove();
    portal = null;
  };

  const showPortal = () => {
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
  };

  const bindDismiss = () => {
    dismissHandler = (event) => {
      if (tipWrap.contains(event.target)) return;
      cleanup();
    };
    window.setTimeout(() => {
      if (!portal) return;
      document.addEventListener("click", dismissHandler, true);
      document.addEventListener("touchstart", dismissHandler, true);
    }, 300);
  };

  tipWrap.addEventListener("click", (event) => {
    event.stopPropagation();
    event.preventDefault();
    if (portal) {
      cleanup();
      return;
    }
    showPortal();
    bindDismiss();
  });

  if (window.matchMedia("(hover: hover)").matches) {
    tipWrap.addEventListener("mouseenter", showPortal);
    tipWrap.addEventListener("mouseleave", cleanup);
  }
}

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

function buildMobileOutlinedReactBtn({ ariaLabel, onClick }) {
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

async function mobileStartCampaignFromStory(company, story) {
  const storyId = customerStoryId(story);
  if (!company) {
    if (!(await requireSignIn())) return;
    showToast("Add your brand on Home first.");
    setTab("brand");
    return;
  }
  if (
    !(await requireSignIn({
      intent: {
        action: "startCampaign",
        companyId: company.id,
        storyId,
      },
    }))
  )
    return;
  const key = `${company.id}:${storyId}`;
  if (mobileCampaignStartInFlight.has(key)) return;
  mobileCampaignStartInFlight.add(key);
  try {
    const res = await api("/api/home/start-campaign", {
      method: "POST",
      body: JSON.stringify({
        company_id: company.id,
        story_id: story.story_id || storyId,
      }),
    });
    if (res.status === 401) {
      showLogin();
      return;
    }
    if (handleUpgradeRequired(res.status)) return;
    if (!res.ok || !res.body?.campaign) {
      showToast("Couldn't create the campaign. Try again.");
      return;
    }
    const campaign = res.body.campaign;
    state.campaignsCache.set(campaign.id, campaign);
    state.campaignDetailId = campaign.id;
    state.campaignTweetIndex = 0;
    await loadCampaigns();
    setTab("campaigns");
    startCampaignPolling(campaign.id);
  } catch (err) {
    showToast("Network error: " + (err.message || ""));
  } finally {
    mobileCampaignStartInFlight.delete(key);
  }
}

function buildSeenByBlock(audiences, memberImages, brandId = null) {
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
      String(aud.member_image_url || "").trim() ||
      memberImages?.get(String(aud.audience_id || "").trim())?.imageUrl ||
      null;
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
  const tipWrap = document.createElement("button");
  tipWrap.type = "button";
  tipWrap.className = "sc-seen-by-tip-wrap";
  tipWrap.setAttribute(
    "aria-label",
    `Audiences: ${audiences.map((aud) => aud.title || "Unknown").join(", ")}`,
  );
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
}

function appendMobileStoriesCardHeadAndStats(card, story, company) {
  const strength = storyUrgency(story.story_last_seen_at);
  const head = document.createElement("div");
  head.className = "sc-card-head";
  const titleCol = document.createElement("div");
  titleCol.className = "sc-card-title";
  const h4 = document.createElement("h4");
  setText(h4, story.headline || "Story");
  titleCol.appendChild(h4);
  head.appendChild(titleCol);
  head.appendChild(
    buildMobileOutlinedReactBtn({
      ariaLabel: "React to this story",
      onClick: (event) => {
        event.stopPropagation();
        void mobileStartCampaignFromStory(company, story);
      },
    }),
  );
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

function buildMobileStoriesDetailContent(story, company) {
  const detail = document.createElement("div");
  detail.className = "sc-card-detail";
  const brandId = company?.id || null;
  const memberImages = brandId
    ? state.memberImageCache.get(brandId) || new Map()
    : new Map();
  const audiences = Array.isArray(story.audiences)
    ? story.audiences.filter((a) => String(a.title || "").trim())
    : [];

  const seenBy = buildSeenByBlock(audiences, memberImages, brandId);
  if (seenBy) detail.appendChild(seenBy);

  const summaryText = String(story.summary || "").trim();
  if (summaryText) {
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
    detail.appendChild(summaryWrap);
  }

  const conversationPosts = topStoryPosts(story, 3);
  if (conversationPosts.length) {
    const conversationWrap = document.createElement("div");
    conversationWrap.className = "sc-detail-col sc-detail-col-conversation";
    const conversationLabel = document.createElement("div");
    conversationLabel.className = "sc-detail-label";
    setText(conversationLabel, "IN THE CONVERSATION");
    conversationWrap.appendChild(conversationLabel);
    conversationWrap.appendChild(
      buildStoryPostList(
        conversationPosts,
        "customer-mobile-post-list-stories",
      ),
    );
    detail.appendChild(conversationWrap);
  }

  return detail;
}

function syncMobileStoryCardDetailShell(card, expanded) {
  const shell = card.querySelector(".sc-card-detail-shell");
  if (!shell) return;
  if (!expanded) {
    shell.classList.remove("is-detail-settled");
    if (shell) void shell.offsetHeight;
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

function mobileStoriesList() {
  return document.querySelector(".mobile-stories-list");
}

let mobileStoriesScrollFrame = null;

function easeInOutQuint(t) {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
}

function mobileStoryScrollTop(list, el) {
  void list.offsetHeight;
  void el.offsetHeight;
  const padTop =
    parseFloat(getComputedStyle(list).scrollPaddingTop) ||
    parseFloat(getComputedStyle(list).paddingTop) ||
    0;
  const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
  let top = 0;
  let node = el;
  while (node && node !== list) {
    top += node.offsetTop;
    node = node.offsetParent;
    if (node && !list.contains(node)) break;
  }
  if (node === list) {
    return Math.max(0, Math.min(top - padTop, maxScroll));
  }
  const target =
    list.scrollTop +
    el.getBoundingClientRect().top -
    list.getBoundingClientRect().top -
    padTop;
  return Math.max(0, Math.min(target, maxScroll));
}

function scrollMobileStoriesListToElement(list, el, onComplete) {
  if (mobileStoriesScrollFrame) {
    cancelAnimationFrame(mobileStoriesScrollFrame);
    mobileStoriesScrollFrame = null;
  }
  const finish = () => {
    mobileStoriesScrollFrame = null;
    if (typeof onComplete === "function") onComplete();
  };
  const snap = () => {
    list.scrollTop = mobileStoryScrollTop(list, el);
    finish();
  };
  const start = list.scrollTop;
  const target = mobileStoryScrollTop(list, el);
  if (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    Math.abs(target - start) < 1
  ) {
    snap();
    return;
  }
  const duration = 580;
  const startedAt = performance.now();

  function step(now) {
    const t = Math.min(1, (now - startedAt) / duration);
    if (t >= 1 || Math.abs(target - list.scrollTop) < 1) {
      list.scrollTop = target;
      finish();
      return;
    }
    list.scrollTop = start + (target - start) * easeInOutQuint(t);
    mobileStoriesScrollFrame = requestAnimationFrame(step);
  }
  mobileStoriesScrollFrame = requestAnimationFrame(step);
}

function mobileStoryAccordionClick(storyId) {
  if (!storyId) return;
  if (state.storiesExpanded.has(storyId)) {
    state.storiesExpanded.delete(storyId);
    if (!patchMobileStoriesAccordion()) {
      if (isPreBrandMode()) syncPreBrandStoriesPanel();
      else renderActiveScreen();
    }
    return;
  }
  const list = mobileStoriesList();
  const card = list?.querySelector(`[data-story-id="${CSS.escape(storyId)}"]`);
  const expandCard = () => openMobileStoryAccordionAnimated(storyId);
  if (!list || !card) {
    expandCard();
    return;
  }
  scrollMobileStoriesListToElement(list, card, expandCard);
}

function patchMobileStoriesAccordion() {
  const list = mobileStoriesList();
  if (!list) return false;
  list.querySelectorAll(".sc-card[data-story-id]").forEach((card) => {
    const id = card.dataset.storyId || "";
    const expanded = state.storiesExpanded.has(id);
    const shell = card.querySelector(".sc-card-detail-shell");
    if (!expanded) {
      shell?.classList.remove("is-detail-settled");
      if (shell) void shell.offsetHeight;
    }
    card.classList.toggle("collapsed", !expanded);
    if (expanded) syncMobileStoryCardDetailShell(card, true);
  });
  return true;
}

function triggerMobileStoryOpenAnimation(storyId) {
  const list = mobileStoriesList();
  const card = list?.querySelector(`[data-story-id="${CSS.escape(storyId)}"]`);
  if (!card) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  card.classList.add("is-auto-opening");
  const shell = card.querySelector(".sc-card-detail-shell");
  const cleanup = () => {
    card.classList.remove("is-auto-opening");
    syncMobileStoryCardDetailShell(card, true);
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

function scheduleMobileFirstStoryOpen(openFn) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    openFn();
    return;
  }
  window.setTimeout(() => requestAnimationFrame(openFn), 160);
}

function openMobileStoryAccordionAnimated(storyId) {
  state.storiesExpanded.add(storyId);
  if (!patchMobileStoriesAccordion()) {
    refreshStoriesView();
    return;
  }
  triggerMobileStoryOpenAnimation(storyId);
}

function stampMobileStoriesCardEnterAnimation(container) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  container
    ?.querySelectorAll(".sc-card[data-story-id]")
    .forEach((card, index) => {
      if (index >= 8) return;
      card.classList.add("is-entering");
      card.style.animationDelay = `${index * 45}ms`;
    });
}

function tryAutoExpandFirstMobileStory(stories) {
  if (state.storiesAutoOpened) return;
  if (state.activeTab !== "stories") return;
  if (state.storiesExpanded.size > 0) {
    state.storiesAutoOpened = true;
    return;
  }
  const rows = Array.isArray(stories) ? stories : [];
  const first = rows.find((row) => String(row.summary || "").trim()) || rows[0];
  if (!first) return;
  const storyId = customerStoryId(first);
  if (!storyId) return;
  state.storiesAutoOpened = true;
  scheduleMobileFirstStoryOpen(() => openMobileStoryAccordionAnimated(storyId));
}

const MOBILE_GATED_VISIBLE = 2;

function buildMobileGatedStoryCard(story, company) {
  const card = buildMobileStoriesAccordionCard(story, company);
  card.classList.add("sc-card-gated");
  return card;
}

function buildMobileStoriesGateCTA() {
  const cta = document.createElement("div");
  cta.className = "stories-gate-cta";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className =
    "sc-generate-btn cc-cta sitmar-tweet-post-btn stories-gate-cta-btn";
  const label = document.createElement("span");
  label.className = "sitmar-tweet-post-label";
  setText(label, "Upgrade to see all stories");
  btn.appendChild(label);
  btn.addEventListener("click", async () => {
    if (await checkAuth()) openUpgradeModal();
    else void requireSignIn();
  });
  cta.appendChild(btn);
  return cta;
}

function wrapMobileStoriesGateAnchor(card, cta) {
  const anchor = document.createElement("div");
  anchor.className = "stories-gate-anchor";
  anchor.appendChild(card);
  anchor.appendChild(cta);
  return anchor;
}

function buildMobileStoriesAccordionCard(story, company) {
  const storyId = customerStoryId(story);
  const expanded = state.storiesExpanded.has(storyId);
  const card = document.createElement("div");
  card.dataset.storyId = storyId;
  card.className = `sc-card${expanded ? "" : " collapsed"}`;
  card.addEventListener("click", (event) => {
    if (
      event.target.closest(
        "button, a, input, select, textarea, label, .sc-seen-by-tip-wrap",
      )
    )
      return;
    mobileStoryAccordionClick(storyId);
  });
  appendMobileStoriesCardHeadAndStats(card, story, company);
  const shell = document.createElement("div");
  shell.className = "sc-card-detail-shell";
  shell.appendChild(buildMobileStoriesDetailContent(story, company));
  card.appendChild(shell);
  if (expanded) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      shell.classList.add("is-detail-settled");
    } else {
      requestAnimationFrame(() => shell.classList.add("is-detail-settled"));
    }
  }
  syncMobileStoryCardDetailShell(card, expanded);
  return card;
}

function refreshStoriesView() {
  if (isPreBrandMode()) syncPreBrandStoriesPanel();
  else if (document.querySelector(".customer-tab-shell"))
    syncCustomerStoriesPanel();
  else renderStoriesView();
}

function mountStoriesView(container) {
  container.innerHTML = "";
  container.appendChild(buildStoriesViewRoot({ preBrand: false }));
}

function renderStoriesView() {
  if (document.querySelector(".customer-tab-shell")) {
    syncCustomerStoriesPanel();
    return;
  }
  mountStoriesView($("#brand-detail-content"));
}

function buildStoriesViewRoot({ preBrand = false } = {}) {
  const root = document.createElement("div");
  root.className = preBrand
    ? "sc-phone-view stories-customer-detail pre-brand-tab-stories"
    : "sc-phone-view stories-customer-detail";

  const company = mobileSettledCompany();
  const feedKey = mobileStoriesFeedKey();

  if (!state.storiesFeedCache.has(feedKey)) {
    ensureStoriesFeed(feedKey);
  } else {
    const lastFetch = state.storiesFeedFetchedAt.get(feedKey) || 0;
    if (Date.now() - lastFetch > STORIES_FEED_REFRESH_MS) {
      ensureStoriesFeed(feedKey);
    }
  }

  const sortBtn = document.createElement("button");
  sortBtn.type = "button";
  sortBtn.className = "sc-sortbtn";
  sortBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M6 12h12M10 18h4"/></svg>';
  const sortLabelEl = document.createElement("span");
  normalizeMobileStoriesSortMode();
  setText(sortLabelEl, storySortLabel(state.storiesSortMode));
  sortBtn.appendChild(sortLabelEl);
  sortBtn.addEventListener("click", () => {
    normalizeMobileStoriesSortMode();
    const modes = mobileStoriesSortModes();
    const idx = modes.indexOf(state.storiesSortMode);
    state.storiesSortMode = modes[(idx + 1) % modes.length];
    refreshStoriesView();
  });

  const titleWrap = document.createElement("div");
  titleWrap.className = "sc-title-wrap";
  const titleStack = document.createElement("div");
  titleStack.className = "sc-title-stack";
  titleStack.appendChild(trendingOnXTitleH1());
  titleWrap.appendChild(titleStack);
  const titleActions = document.createElement("div");
  titleActions.className = "stories-title-actions";
  titleActions.appendChild(sortBtn);
  titleWrap.appendChild(titleActions);
  root.appendChild(titleWrap);

  const loading =
    state.storiesFeedInFlight.has(feedKey) &&
    !state.storiesFeedCache.get(feedKey)?.length;
  const stories = state.storiesFeedCache.get(feedKey) || [];
  const filtered = sortMobileStories(stories);

  const list = document.createElement("div");
  list.className = "sc-pad mobile-stories-list";

  if (loading) {
    const loadingEl = document.createElement("div");
    loadingEl.className = "customer-mobile-loading";
    const spinner = document.createElement("span");
    spinner.className = "spinner";
    loadingEl.appendChild(spinner);
    loadingEl.appendChild(document.createTextNode("Loading stories…"));
    list.appendChild(loadingEl);
  } else if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "sc-empty";
    setText(
      empty,
      stories.length
        ? "No relevant stories yet."
        : "No stories in the last 24 hours.",
    );
    list.appendChild(empty);
  } else {
    const gated = !!state.storiesFeedGated.get(feedKey);
    const gatedVisible = gated
      ? filtered.slice(0, MOBILE_GATED_VISIBLE)
      : filtered;
    gatedVisible.forEach((story) => {
      list.appendChild(buildMobileStoriesAccordionCard(story, company));
    });
    stampMobileStoriesCardEnterAnimation(list);
    tryAutoExpandFirstMobileStory(gatedVisible);
    if (gated && filtered.length > MOBILE_GATED_VISIBLE) {
      const gatedStories = filtered.slice(
        MOBILE_GATED_VISIBLE,
        MOBILE_GATED_VISIBLE + 8,
      );
      const gateCta = buildMobileStoriesGateCTA();
      gatedStories.forEach((story, index) => {
        const card = buildMobileGatedStoryCard(story, company);
        list.appendChild(
          index === 0 ? wrapMobileStoriesGateAnchor(card, gateCta) : card,
        );
      });
    }
    if (!gated && state.storiesFeedHasMore.get(feedKey)) {
      bindMobileStoriesLoadFooter(list, feedKey);
    }
  }

  root.appendChild(list);
  return root;
}

function ensureCampaignDetail(campaignId) {
  if (!campaignId || state.campaignsCache.has(campaignId)) return;
  if (state.campaignsInFlight.has(campaignId)) return;
  state.campaignsInFlight.add(campaignId);
  api(`/api/sitmar/${encodeURIComponent(campaignId)}`)
    .then(({ ok, body }) => {
      state.campaignsInFlight.delete(campaignId);
      if (ok && body && body.campaign) {
        state.campaignsCache.set(campaignId, body.campaign);
        hydrateMobileDistributeState(body.campaign, { force: true });
        if (state.activeTab !== "campaigns") return;
        const postedOpen =
          state.campaignDetailId === campaignId &&
          String(body.campaign.status || "").toLowerCase() === "posted";
        if (!postedOpen) renderCampaignsView();
      }
    })
    .catch(() => {
      state.campaignsInFlight.delete(campaignId);
    });
}

function stopCampaignPolling() {
  if (!state.campaignsPollTimer) return;
  clearTimeout(state.campaignsPollTimer);
  state.campaignsPollTimer = null;
}

function startCampaignPolling(campaignId) {
  if (!campaignId) return;
  if (state.campaignsPollTimer) return;
  state.campaignsPollTimer = setTimeout(async () => {
    state.campaignsPollTimer = null;
    if (state.activeTab !== "campaigns") return;
    if (state.campaignDetailId !== campaignId) return;
    const detail = await loadCampaignDetail(campaignId, true);
    if (!detail) return;
    const status = String(detail.status || "").toLowerCase();
    if (status === "thinking" || status === "drafting") {
      startCampaignPolling(campaignId);
    }
  }, 1200);
}

async function loadCampaignDetail(campaignId, force = false) {
  const id = String(campaignId || "").trim();
  if (!id) return null;
  if (!force && state.campaignsCache.has(id)) {
    return state.campaignsCache.get(id);
  }
  const existing = state.campaignDetailInFlight.get(id);
  if (existing) return existing;
  const request = (async () => {
    const res = await api(`/api/sitmar/${encodeURIComponent(id)}`);
    if (res.status === 401) {
      showLogin();
      return null;
    }
    if (!res.ok || !res.body?.campaign) return null;
    state.campaignsCache.set(id, res.body.campaign);
    hydrateMobileDistributeState(res.body.campaign, { force: true });
    if (state.activeTab === "campaigns") renderCampaignsView();
    return res.body.campaign;
  })();
  state.campaignDetailInFlight.set(id, request);
  try {
    return await request;
  } finally {
    if (state.campaignDetailInFlight.get(id) === request) {
      state.campaignDetailInFlight.delete(id);
    }
  }
}

function latestCampaignSeeds(campaign) {
  const messages = Array.isArray(campaign?.messages) ? campaign.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const turn = messages[i];
    if (turn?.role === "assistant" && Array.isArray(turn.seeds))
      return turn.seeds;
  }
  return [];
}

function storySortLabel(mode) {
  if (mode === "activity") return "Activity";
  if (mode === "brand_score") return "Brand Score";
  if (mode === "posts") return "Posts";
  return "Recency";
}

function sortedStoryPickerStories(stories) {
  const rows = Array.isArray(stories) ? [...stories] : [];
  if (state.storyPickerSortMode === "brand_score") {
    rows.sort(
      (a, b) => Number(b.brand_score || 0) - Number(a.brand_score || 0),
    );
    return rows;
  }
  if (state.storyPickerSortMode === "posts") {
    rows.sort((a, b) => Number(b.post_count || 0) - Number(a.post_count || 0));
    return rows;
  }
  rows.sort(
    (a, b) =>
      customerStoryTimeMs(b.story_last_seen_at) -
      customerStoryTimeMs(a.story_last_seen_at),
  );
  return rows;
}

function pickStoryAudienceIndex(story) {
  const candidates = Array.isArray(story?.audiences)
    ? story.audiences.filter((row) => Number.isFinite(Number(row?.brand_index)))
    : [];
  if (!candidates.length) return null;
  candidates.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return Number(candidates[0].brand_index);
}

function closeStoryPickerOverlay() {
  document.querySelector(".mobile-story-picker-overlay")?.remove();
}

async function openStoryPickerOverlay() {
  const company =
    currentCompany() ||
    (state.companies.length === 1 ? state.companies[0] : null);
  if (!company) {
    showToast("Select a brand first");
    return;
  }
  closeStoryPickerOverlay();
  const overlay = document.createElement("div");
  overlay.className =
    "customer-mobile-inspector-overlay mobile-story-picker-overlay";
  overlay.innerHTML = `
    <div class="customer-mobile-inspector-panel mobile-story-picker-panel stories-customer-detail sc-phone-view" role="dialog" aria-modal="true" aria-labelledby="mobile-story-picker-title">
      <div class="customer-mobile-inspector-head mobile-story-picker-head">
        <div>
          <div class="customer-mobile-inspector-kicker">${escapeHtml(companyDisplayName(company))}</div>
          <h2 id="mobile-story-picker-title">Pick a story</h2>
        </div>
        <button type="button" class="sc-sortbtn mobile-story-picker-sort" aria-label="Sort stories by ${escapeHtml(storySortLabel(state.storyPickerSortMode))}" title="Sort: ${escapeHtml(storySortLabel(state.storyPickerSortMode))}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M6 12h12M10 18h4"/></svg>
        </button>
      </div>
      <div class="mobile-story-picker-list">
        <div class="mobile-story-picker-empty"><span class="spinner"></span><span>Loading stories…</span></div>
      </div>
    </div>
  `;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeStoryPickerOverlay();
  });
  document.body.appendChild(overlay);

  const list = overlay.querySelector(".mobile-story-picker-list");
  const sortBtn = overlay.querySelector(".mobile-story-picker-sort");
  let stories = [];

  const renderStories = () => {
    list.innerHTML = "";
    const sorted = sortedStoryPickerStories(stories);
    if (!sorted.length) {
      const empty = document.createElement("div");
      empty.className = "mobile-story-picker-empty";
      setText(empty, "No connected stories yet.");
      list.appendChild(empty);
      return;
    }
    sorted.forEach((story) => {
      const row = document.createElement("div");
      row.className = "sc-card collapsed mobile-story-picker-row";

      const head = document.createElement("div");
      head.className = "sc-card-head";
      const titleCol = document.createElement("div");
      titleCol.className = "sc-card-title";
      const h4 = document.createElement("h4");
      setText(h4, story.headline || "Story");
      titleCol.appendChild(h4);
      head.appendChild(titleCol);
      const badge = buildBrandScoreBadge(story.brand_score);
      if (badge) head.appendChild(badge);
      row.appendChild(head);

      const strength = storyUrgency(story.story_last_seen_at);
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
      const postCount = document.createElement("span");
      const b = document.createElement("b");
      setText(b, formatCompactCount(story.post_count));
      postCount.appendChild(b);
      postCount.appendChild(document.createTextNode(" posts"));
      nums.appendChild(postCount);
      const ageLabel = customerStoryAgeLabel(
        story.last_updated_at || story.story_last_seen_at,
      );
      if (ageLabel) nums.appendChild(document.createTextNode(` · ${ageLabel}`));
      stats.appendChild(nums);
      row.appendChild(stats);
      row.addEventListener("click", async () => {
        row.disabled = true;
        const audienceIndex = pickStoryAudienceIndex(story);
        try {
          const res = await api("/api/sitmar", {
            method: "POST",
            body: JSON.stringify({
              company_id: company.id,
              story_id: story.story_id,
              brand_audience_index: audienceIndex,
            }),
          });
          if (res.status === 401) {
            showLogin();
            return;
          }
          if (handleUpgradeRequired(res.status)) {
            row.disabled = false;
            return;
          }
          if (!res.ok || !res.body?.campaign) {
            showToast("Couldn't start campaign");
            row.disabled = false;
            return;
          }
          const campaign = res.body.campaign;
          state.campaignsCache.set(campaign.id, campaign);
          state.campaignDetailId = campaign.id;
          state.campaignTweetIndex = 0;
          closeStoryPickerOverlay();
          await loadCampaigns();
          renderCampaignsView();
          startCampaignPolling(campaign.id);
        } catch {
          showToast("Network error");
          row.disabled = false;
        }
      });
      list.appendChild(row);
    });
  };

  sortBtn?.addEventListener("click", () => {
    const modes = ["recency", "brand_score", "posts"];
    const idx = modes.indexOf(state.storyPickerSortMode);
    state.storyPickerSortMode = modes[(idx + 1) % modes.length];
    sortBtn.setAttribute(
      "aria-label",
      `Sort stories by ${storySortLabel(state.storyPickerSortMode)}`,
    );
    sortBtn.setAttribute(
      "title",
      `Sort: ${storySortLabel(state.storyPickerSortMode)}`,
    );
    renderStories();
  });

  try {
    const options = await api(
      `/api/sitmar/options/${encodeURIComponent(company.id)}`,
    );
    if (options.status === 401) {
      showLogin();
      return;
    }
    stories =
      options.ok && Array.isArray(options.body?.stories)
        ? options.body.stories
        : [];
    renderStories();
  } catch {
    list.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "mobile-story-picker-empty";
    setText(empty, "Network error loading stories.");
    list.appendChild(empty);
  }
}

async function sendCampaignMessage(campaignId, text) {
  const detail = state.campaignsCache.get(campaignId);
  const tweetIndex =
    detail && String(detail.status || "").toLowerCase() === "drafted"
      ? mobileActiveTweetIndex(detail)
      : null;
  if (detail) {
    const nextMessages = Array.isArray(detail.messages)
      ? [...detail.messages]
      : [];
    nextMessages.push({ role: "user", text });
    state.campaignsCache.set(campaignId, {
      ...detail,
      status: "thinking",
      messages: nextMessages,
    });
    renderCampaignsView();
  }
  const payload = { text };
  if (tweetIndex !== null) payload.tweet_index = tweetIndex;
  const res = await api(
    `/api/sitmar/${encodeURIComponent(campaignId)}/message`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
  if (res.status === 401) {
    showLogin();
    return;
  }
  if (handleUpgradeRequired(res.status)) return;
  if (!res.ok) {
    showToast("Couldn't send message");
    await loadCampaignDetail(campaignId, true);
    return;
  }
  startCampaignPolling(campaignId);
}

async function selectCampaignSeed(campaignId, seedIndex) {
  const detail = state.campaignsCache.get(campaignId);
  const selected = latestCampaignSeeds(detail)[seedIndex];
  const chosenTitle =
    String(selected?.title || "").trim() || "Selected direction";
  if (detail && selected) {
    const nextMessages = Array.isArray(detail.messages)
      ? [...detail.messages]
      : [];
    nextMessages.push({ role: "user", text: chosenTitle });
    state.campaignsCache.set(campaignId, {
      ...detail,
      status: "drafting",
      tweets: [],
      messages: nextMessages,
      selected_seed: { title: selected.title, blurb: selected.blurb },
    });
    renderCampaignsView();
  }
  const res = await api(
    `/api/sitmar/${encodeURIComponent(campaignId)}/select`,
    {
      method: "POST",
      body: JSON.stringify({ seed_index: seedIndex }),
    },
  );
  if (res.status === 401) {
    showLogin();
    return;
  }
  if (handleUpgradeRequired(res.status)) return;
  if (!res.ok) {
    showToast("Couldn't start campaign");
    await loadCampaignDetail(campaignId, true);
    return;
  }
  startCampaignPolling(campaignId);
}

async function regenerateCampaignSeeds(campaignId) {
  if (mobileSeedRegenInFlight.has(campaignId)) return;
  mobileSeedRegenInFlight.add(campaignId);
  const detail = state.campaignsCache.get(campaignId);
  if (detail) {
    const nextMessages = Array.isArray(detail.messages)
      ? [...detail.messages]
      : [];
    nextMessages.push({
      role: "user",
      text: MOBILE_SITMAR_REGENERATE_LABEL,
    });
    state.campaignsCache.set(campaignId, {
      ...detail,
      status: "thinking",
      messages: nextMessages,
    });
    renderCampaignsView();
  }
  try {
    const res = await api(
      `/api/sitmar/${encodeURIComponent(campaignId)}/message`,
      {
        method: "POST",
        body: JSON.stringify({ text: "", regenerate: true }),
      },
    );
    if (res.status === 401) {
      showLogin();
      return;
    }
    if (handleUpgradeRequired(res.status)) return;
    if (!res.ok) {
      showToast("Couldn't regenerate directions");
      await loadCampaignDetail(campaignId, true);
      return;
    }
    startCampaignPolling(campaignId);
  } finally {
    mobileSeedRegenInFlight.delete(campaignId);
  }
}

async function postCampaign(campaignId) {
  const detail = state.campaignsCache.get(campaignId);
  if (detail) {
    state.campaignsCache.set(campaignId, {
      ...detail,
      status: "drafting",
      tweets: [],
    });
    state.campaignTweetIndex = 0;
    renderCampaignsView();
  }
  const res = await api(`/api/sitmar/${encodeURIComponent(campaignId)}/post`, {
    method: "POST",
  });
  if (res.status === 401) {
    showLogin();
    return;
  }
  if (handleUpgradeRequired(res.status)) return;
  if (!res.ok) {
    showToast("Couldn't start posting");
    await loadCampaignDetail(campaignId, true);
    return;
  }
  startCampaignPolling(campaignId);
}

async function regenerateCampaignTweets(campaignId) {
  const detail = state.campaignsCache.get(campaignId);
  if (detail) {
    state.campaignsCache.set(campaignId, {
      ...detail,
      status: "drafting",
    });
    state.campaignTweetIndex = 0;
    renderCampaignsView();
  }
  const res = await api(
    `/api/sitmar/${encodeURIComponent(campaignId)}/regenerate-tweets`,
    {
      method: "POST",
    },
  );
  if (res.status === 401) {
    showLogin();
    return;
  }
  if (handleUpgradeRequired(res.status)) return;
  if (!res.ok) {
    showToast("Couldn't regenerate tweets");
    await loadCampaignDetail(campaignId, true);
    return;
  }
  startCampaignPolling(campaignId);
}

async function updateCampaignTweet(campaignId, index, text) {
  try {
    await api(`/api/sitmar/${encodeURIComponent(campaignId)}/update-tweet`, {
      method: "POST",
      body: JSON.stringify({ index, text }),
    });
  } catch {
    // best effort local update only
  }
}

function patchMobileCampaignCache(campaign, patchFn) {
  const cached = state.campaignsCache.get(campaign.id);
  if (cached) {
    patchFn(cached);
    state.campaignsCache.set(campaign.id, cached);
  }
  const listIdx = state.campaigns.findIndex((c) => c.id === campaign.id);
  if (listIdx >= 0) patchFn(state.campaigns[listIdx]);
}

function applyMobilePostedOptimistic(campaign, tweetIdx) {
  patchMobileCampaignCache(campaign, (c) => {
    c.status = "posted";
    c.selected_seed = {
      ...(c.selected_seed || {}),
      posted_tweet_index: tweetIdx,
    };
  });
}

function revertMobilePostedOptimistic(campaign) {
  patchMobileCampaignCache(campaign, (c) => {
    c.status = "drafted";
    const seed = { ...(c.selected_seed || {}) };
    delete seed.posted_tweet_index;
    c.selected_seed = seed;
  });
}

function mobileExecutePostSelectedTweet(campaign, tweetIdx, postBtn) {
  if (mobileCampaignPostInFlight.has(campaign.id)) return;
  mobileCampaignPostInFlight.add(campaign.id);
  if (postBtn) postBtn.disabled = true;

  const tweets = campaign.tweets || [];
  const intentUrl = buildTweetIntentUrl(tweets[tweetIdx]?.text);

  applyMobilePostedOptimistic(campaign, tweetIdx);
  window.open(intentUrl, "_blank", "noopener");
  renderCampaignsView();

  void (async () => {
    try {
      const res = await api(
        `/api/sitmar/${encodeURIComponent(campaign.id)}/posted`,
        {
          method: "POST",
          body: JSON.stringify({ tweet_index: tweetIdx }),
        },
      );
      if (res.status === 401) {
        showLogin();
        revertMobilePostedOptimistic(campaign);
        renderCampaignsView();
        return;
      }
      if (handleUpgradeRequired(res.status)) {
        revertMobilePostedOptimistic(campaign);
        renderCampaignsView();
        return;
      }
      if (!res.ok) {
        const detail = res.body?.detail;
        showToast(
          typeof detail === "string" ? detail : "Couldn't mark as posted.",
        );
        revertMobilePostedOptimistic(campaign);
        renderCampaignsView();
        return;
      }
      await loadCampaigns();
    } catch (err) {
      showToast("Network error: " + (err.message || ""));
      revertMobilePostedOptimistic(campaign);
      renderCampaignsView();
    } finally {
      mobileCampaignPostInFlight.delete(campaign.id);
      if (postBtn) postBtn.disabled = false;
    }
  })();
}

function mobilePostSelectedTweet(campaign, tweetIdx, postBtn) {
  gatePostOnXIntro(() =>
    mobileExecutePostSelectedTweet(campaign, tweetIdx, postBtn),
  );
}

function twitterHandleLabel(handle, displayName) {
  const raw = String(handle || "")
    .trim()
    .replace(/^@+/, "");
  if (raw) return `@${raw}`;
  const placeholder = String(displayName || "brand")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 15);
  return `@${placeholder || "brand"}`;
}

function autosizeTweetTextarea(textarea) {
  const fit = () => {
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  fit();
  textarea.addEventListener("input", fit);
}

function buildTweetSlide(
  tweet,
  i,
  campaign,
  avatarUrl,
  displayName,
  handleLabel,
) {
  const slide = document.createElement("div");
  slide.className = "mobile-tweet-slide";

  const xpost = document.createElement("div");
  xpost.className = "mobile-xpost";

  const xtop = document.createElement("div");
  xtop.className = "mobile-xtop";
  if (avatarUrl) {
    const av = document.createElement("img");
    av.className = "mobile-xav";
    av.src = avatarUrl;
    av.alt = "";
    av.onerror = () => {
      av.remove();
    };
    xtop.appendChild(av);
  } else {
    const av = document.createElement("span");
    av.className = "mobile-xav mobile-xav-fallback";
    setText(av, (displayName[0] || "?").toUpperCase());
    xtop.appendChild(av);
  }
  const xwho = document.createElement("div");
  xwho.className = "mobile-xwho";
  const xnameRow = document.createElement("div");
  xnameRow.className = "mobile-xname-row";
  const xname = document.createElement("span");
  xname.className = "mobile-xname";
  setText(xname, displayName);
  xnameRow.appendChild(xname);
  const verified = document.createElement("span");
  verified.className = "mobile-xverified";
  verified.innerHTML =
    '<svg viewBox="0 0 22 22" aria-label="Verified" width="15" height="15"><path fill="currentColor" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.855-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.706 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></svg>';
  xnameRow.appendChild(verified);
  xwho.appendChild(xnameRow);
  const xhandle = document.createElement("div");
  xhandle.className = "mobile-xhandle";
  setText(xhandle, handleLabel);
  xwho.appendChild(xhandle);
  xtop.appendChild(xwho);
  const xtxt = document.createElement("p");
  xtxt.className = "mobile-xtxt";
  setText(xtxt, tweet.text || "");
  const activateEdit = () => {
    if (xtxt.querySelector("textarea")) return;
    xtxt.textContent = "";
    const textarea = document.createElement("textarea");
    textarea.className = "mobile-campaign-tweet-textarea";
    textarea.value = tweet.text || "";
    textarea.maxLength = 280;
    xtxt.appendChild(textarea);
    autosizeTweetTextarea(textarea);
    textarea.focus();
    const save = () => {
      const newText = textarea.value.trim();
      if (newText && newText !== tweet.text) {
        tweet.text = newText;
        updateCampaignTweet(campaign.id, i, newText);
      }
      xtxt.textContent = "";
      setText(xtxt, tweet.text || "");
    };
    textarea.addEventListener("blur", save);
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        textarea.blur();
      }
    });
  };
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "mobile-campaign-tweet-edit mobile-xedit";
  editBtn.setAttribute("aria-label", "Edit tweet");
  editBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/></svg>';
  editBtn.addEventListener("click", activateEdit);
  xtop.appendChild(editBtn);
  xpost.appendChild(xtop);
  xtxt.addEventListener("click", activateEdit);
  xpost.appendChild(xtxt);
  slide.appendChild(xpost);

  return slide;
}

function removeMobileInlinePostsBlock(thread) {
  thread
    ?.querySelectorAll("[data-mobile-inline-posts]")
    .forEach((el) => el.remove());
}

function buildMobileInlinePostsLoadingBlock() {
  return meleaStatusLine("Generating posts…", {
    datasetKey: "mobileInlinePosts",
  });
}

const MOBILE_TWEET_ROUTE_LABELS = {
  recommended: "Recommended",
  provocative: "Provocative",
  casual: "Casual",
};

function mobileTweetLabel(tweet, index) {
  const route = String(tweet?.route || "")
    .trim()
    .toLowerCase();
  return MOBILE_TWEET_ROUTE_LABELS[route] || `Post ${index + 1}`;
}

function mobileInlineTweets(campaign) {
  const tweets = Array.isArray(campaign.tweets) ? campaign.tweets : [];
  return tweets.slice(0, 3);
}

function mobileHasDraftPosts(campaign) {
  return mobileInlineTweets(campaign).length > 0;
}

function mobileActiveTweetIndex(campaign) {
  const tweets = mobileInlineTweets(campaign);
  if (!tweets.length) return 0;
  return Math.max(0, Math.min(state.campaignTweetIndex, tweets.length - 1));
}

function mobileComposerPlaceholder(campaign) {
  const status = String(campaign?.status || "").toLowerCase();
  if (
    (status === "thinking" || status === "drafting") &&
    mobileHasDraftPosts(campaign)
  ) {
    return "Edit the post";
  }
  if (status === "drafting") return "Generating posts…";
  if (status === "thinking") return "Ideating…";
  if (status === "posted") return "Refine the reply…";
  if (status === "drafted") return "Refine this post…";
  if (status === "selected") return "Refine the direction…";
  return "Refine the directions…";
}

function shouldShowMobileInlinePosts(campaign) {
  const status = String(campaign?.status || "").toLowerCase();
  if (status === "drafted") return true;
  return status === "thinking" && mobileHasDraftPosts(campaign);
}

function setMobileInlinePostIndex(
  wrap,
  campaign,
  idx,
  avatarUrl,
  displayName,
  handleLabel,
) {
  const tweets = mobileInlineTweets(campaign);
  if (!tweets.length) return;
  state.campaignTweetIndex = Math.max(0, Math.min(idx, tweets.length - 1));
  const cardSlot = wrap.querySelector(".sitmar-inline-post-card");
  if (cardSlot) {
    cardSlot.innerHTML = "";
    cardSlot.appendChild(
      buildTweetSlide(
        tweets[state.campaignTweetIndex],
        state.campaignTweetIndex,
        campaign,
        avatarUrl,
        displayName,
        handleLabel,
      ),
    );
  }
  const grid = wrap.querySelector(".sitmar-action-grid");
  if (grid) {
    grid.querySelectorAll(".sitmar-action-btn").forEach((btn, i) => {
      if (i < tweets.length) {
        btn.classList.toggle("is-primary", i === state.campaignTweetIndex);
      }
    });
  }
}

function buildMobileInlinePostsBlock(campaign) {
  const tweets = mobileInlineTweets(campaign);
  if (!tweets.length) return null;
  if (state.campaignTweetIndex >= tweets.length) state.campaignTweetIndex = 0;

  const bt = campaign.brand_twitter || {};
  const avatarUrl = bt.profile_image_url || campaign.brand_logo_url || "";
  const displayName = bt.name || campaign.brand_name || "Brand";
  const handleLabel = twitterHandleLabel(bt.handle, displayName);

  const wrap = document.createElement("div");
  wrap.className = "sitmar-inline-posts";
  wrap.dataset.mobileInlinePosts = "1";

  const row = document.createElement("div");
  row.className = "sitmar-inline-posts-row";

  const options = document.createElement("div");
  options.className = "sitmar-inline-post-options";

  const toggleItems = tweets.map((tweet, i) => ({
    label: mobileTweetLabel(tweet, i),
    icon: String(i + 1),
    ariaLabel: mobileTweetLabel(tweet, i),
    primary: i === state.campaignTweetIndex,
    iconBg: MOBILE_ACTION_ICON_STYLES[i % MOBILE_ACTION_ICON_STYLES.length].bg,
    iconColor:
      MOBILE_ACTION_ICON_STYLES[i % MOBILE_ACTION_ICON_STYLES.length].color,
    onClick: () =>
      setMobileInlinePostIndex(
        wrap,
        campaign,
        i,
        avatarUrl,
        displayName,
        handleLabel,
      ),
  }));
  options.appendChild(buildActionGrid(toggleItems, { columns: 3 }));
  row.appendChild(options);

  const main = document.createElement("div");
  main.className = "sitmar-inline-post-main";

  const cardSlot = document.createElement("div");
  cardSlot.className = "sitmar-inline-post-card";
  cardSlot.appendChild(
    buildTweetSlide(
      tweets[state.campaignTweetIndex],
      state.campaignTweetIndex,
      campaign,
      avatarUrl,
      displayName,
      handleLabel,
    ),
  );
  main.appendChild(cardSlot);

  const actions = document.createElement("div");
  actions.className = "sitmar-inline-post-actions";
  const postBtn = document.createElement("button");
  postBtn.type = "button";
  postBtn.className = "mobile-campaign-tweet-post-btn";
  postBtn.innerHTML =
    '<span>Post on</span><svg class="mobile-campaign-tweet-x" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.254 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
  postBtn.addEventListener("click", () => {
    mobilePostSelectedTweet(campaign, state.campaignTweetIndex, postBtn);
  });
  actions.appendChild(postBtn);
  main.appendChild(actions);
  row.appendChild(main);
  wrap.appendChild(row);

  return wrap;
}

function syncMobileInlinePostsBlock(thread, campaign) {
  if (!thread || !campaign) return;
  removeMobileInlinePostsBlock(thread);
  const status = String(campaign.status || "").toLowerCase();
  if (status === "drafting" && !mobileHasDraftPosts(campaign)) {
    thread.appendChild(buildMobileInlinePostsLoadingBlock());
    return;
  }
  if (shouldShowMobileInlinePosts(campaign)) {
    const block = buildMobileInlinePostsBlock(campaign);
    if (block) thread.appendChild(block);
  }
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

function buildExpandedStoryPost(post, options = {}) {
  const url = options.linkable === false ? "" : String(post.url || "").trim();
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
  const avatarUrl = String(
    post.author_avatar || post.author_profile_image_url || "",
  ).trim();
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
  const time = relativeTime(post.posted_at);
  const parts = [];
  if (rawHandle) parts.push(`@${rawHandle}`);
  if (time) parts.push(`${time} ago`);
  setText(handle, parts.join(" · "));
  who.appendChild(handle);
  top.appendChild(who);
  if (options.showWindowBadge) {
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

function distributePostKey(storyId, post) {
  const id = String(post?.id || post?.url || "").trim();
  if (id) return `${storyId}:${id}`;
  return `${storyId}:${String(post?.text || "").slice(0, 120)}`;
}

let mobileDistributeHydratedFor = "";

function hydrateMobileDistributeState(campaign, { force = false } = {}) {
  if (!campaign || String(campaign.status || "").toLowerCase() !== "posted") {
    if (mobileDistributeHydratedFor) {
      state.distributeSentPosts.clear();
      state.distributeDismissed.clear();
      mobileDistributeHydratedFor = "";
    }
    return;
  }
  if (!force && mobileDistributeHydratedFor === campaign.id) return;
  state.distributeSentPosts.clear();
  state.distributeDismissed.clear();
  const sent = Array.isArray(campaign.distribute_sent)
    ? campaign.distribute_sent
    : [];
  sent.forEach((entry) => {
    const postKey = String(entry?.post_key || "").trim();
    if (!postKey) return;
    const sentAtRaw = Number(entry.sent_at || 0);
    state.distributeSentPosts.set(postKey, {
      post: entry.post || {},
      sentAt: sentAtRaw > 1e12 ? sentAtRaw : sentAtRaw * 1000 || Date.now(),
      reply: String(entry.reply || ""),
    });
  });
  const dismissed = Array.isArray(campaign.distribute_dismissed)
    ? campaign.distribute_dismissed
    : [];
  dismissed.forEach((key) => {
    const postKey = String(key || "").trim();
    if (postKey) state.distributeDismissed.add(postKey);
  });
  distributeReplyDraftSyncCampaign(campaign.id, [
    ...dismissed,
    ...sent.map((entry) => entry?.post_key).filter(Boolean),
  ]);
  mobileDistributeHydratedFor = campaign.id;
}

function patchMobileDistributeSentCache(campaign, entry) {
  patchMobileCampaignCache(campaign, (c) => {
    const sent = Array.isArray(c.distribute_sent) ? [...c.distribute_sent] : [];
    const idx = sent.findIndex((e) => e.post_key === entry.post_key);
    if (idx >= 0) sent[idx] = entry;
    else sent.push(entry);
    c.distribute_sent = sent;
    const dismissed = Array.isArray(c.distribute_dismissed)
      ? [...c.distribute_dismissed]
      : [];
    if (!dismissed.includes(entry.post_key)) dismissed.push(entry.post_key);
    c.distribute_dismissed = dismissed;
  });
}

function patchMobileDistributeDismissedCache(campaign, postKey) {
  patchMobileCampaignCache(campaign, (c) => {
    const dismissed = Array.isArray(c.distribute_dismissed)
      ? [...c.distribute_dismissed]
      : [];
    if (!dismissed.includes(postKey)) dismissed.push(postKey);
    c.distribute_dismissed = dismissed;
  });
}

function persistMobileDistributeSent(campaign, post, reply) {
  const storyId = String(campaign.story_id || "").trim();
  const postKey = distributePostKey(storyId, post);
  const entry = {
    post_key: postKey,
    sent_at: Date.now() / 1000,
    reply: reply || "",
    post: post || {},
  };
  patchMobileDistributeSentCache(campaign, entry);
  void api(`/api/sitmar/${encodeURIComponent(campaign.id)}/distribute-sent`, {
    method: "POST",
    body: JSON.stringify({
      post_key: postKey,
      reply: entry.reply,
      post: entry.post,
    }),
  }).catch(() => {});
}

function persistMobileDistributeSkip(campaign, post) {
  const storyId = String(campaign.story_id || "").trim();
  const postKey = distributePostKey(storyId, post);
  patchMobileDistributeDismissedCache(campaign, postKey);
  void api(`/api/sitmar/${encodeURIComponent(campaign.id)}/distribute-skip`, {
    method: "POST",
    body: JSON.stringify({ post_key: postKey }),
  }).catch(() => {});
}

function getDistributeQueuePosts(storyId) {
  const cached = state.distributeStoryCache.get(storyId);
  const posts = Array.isArray(cached?.posts) ? cached.posts : [];
  return posts.filter(
    (post) => !state.distributeDismissed.has(distributePostKey(storyId, post)),
  );
}

function distributeReplyKey(campaignId, post) {
  const id = String(post?.id || post?.url || "").trim();
  if (id) return `${campaignId}:${id}`;
  return `${campaignId}:${String(post?.text || "").slice(0, 120)}`;
}

const DISTRIBUTE_REPLY_STATUS_RE = /\/status\/(\d+)/;

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
  const statusMatch = direct.match(DISTRIBUTE_REPLY_STATUS_RE);
  if (statusMatch) {
    let url = `https://twitter.com/intent/tweet?in_reply_to=${statusMatch[1]}`;
    if (text) url += `&text=${encodeURIComponent(text)}`;
    return url;
  }
  return direct.startsWith("http") ? direct : "";
}

function distributeTabCounts(campaign) {
  const storyId = String(campaign.story_id || "").trim();
  return {
    queue: getDistributeQueuePosts(storyId).length,
    sent: state.distributeSentPosts.size,
  };
}

function distributeTabCountMarkup(count) {
  return count ? ` <span class="distribute-tab-count">${count}</span>` : "";
}

function mobileDistributeQueueTabHtml(count) {
  return (
    MOBILE_ICON_PANEL_LEFT +
    `<span>Queue${distributeTabCountMarkup(count)}</span>`
  );
}

function mobileDistributeSentTabHtml(count) {
  return (
    `<span>Sent${distributeTabCountMarkup(count)}</span>` +
    MOBILE_ICON_PANEL_RIGHT
  );
}

function mobileDistributeTrackIndex(tab) {
  if (tab === "queue") return 0;
  if (tab === "sent") return 2;
  return 1;
}

function distributeQueuePostIndex(storyId, posts, post) {
  const key = distributePostKey(storyId, post);
  return posts.findIndex((p) => distributePostKey(storyId, p) === key);
}

function refreshMobileDistributeQueueListPanel(campaign) {
  const panel = document.querySelector(".mobile-distribute-panel-queue");
  if (!panel) return;
  panel.innerHTML = "";
  renderMobileDistributeQueueList(campaign, panel);
}

function refreshMobileDistributeReplyPanel(campaign) {
  const postsHost = document.querySelector(
    ".mobile-distribute-panel-reply .distribute-content",
  );
  if (postsHost) {
    renderDistributePostQueue(postsHost, campaign);
    return;
  }
  renderCampaignsView();
}

function selectMobileDistributeQueuePost(campaign, post) {
  const storyId = String(campaign.story_id || "").trim();
  const posts = getDistributeQueuePosts(storyId);
  const idx = distributeQueuePostIndex(storyId, posts, post);
  if (idx < 0) return;
  state.distributeQueueIndex.set(campaign.id, idx);
  setMobileDistributeTab("reply");
  refreshMobileDistributeReplyPanel(campaign);
}

function renderMobileDistributeQueueList(campaign, host) {
  const storyId = String(campaign.story_id || "").trim();
  if (!storyId) return;

  const cached = state.distributeStoryCache.get(storyId);
  if (!cached) {
    const loading = document.createElement("div");
    loading.className = "distribute-loading";
    const spinner = document.createElement("div");
    spinner.className = "mobile-campaign-loading-spinner";
    const label = document.createElement("span");
    setText(label, "Loading story conversation…");
    loading.appendChild(spinner);
    loading.appendChild(label);
    host.appendChild(loading);
    return;
  }

  const posts = getDistributeQueuePosts(storyId);
  if (!posts.length) {
    const empty = document.createElement("div");
    empty.className = "distribute-empty";
    const rawPosts = Array.isArray(cached.posts) ? cached.posts : [];
    setText(
      empty,
      rawPosts.length
        ? "Check back later for high-engagement posts to hijack."
        : "No story posts found yet.",
    );
    host.appendChild(empty);
    return;
  }

  const campaignId = campaign.id;
  const activeIdx = state.distributeQueueIndex.get(campaignId) ?? 0;
  const activePost = posts[activeIdx] || posts[0];
  const activeKey = distributePostKey(storyId, activePost);

  const list = document.createElement("div");
  list.className = "mobile-distribute-queue-list";

  posts.forEach((post) => {
    const postKey = distributePostKey(storyId, post);
    const item = buildMobileDistributeQueueItem(post, {
      isActive: postKey === activeKey,
    });
    item.addEventListener("click", () =>
      selectMobileDistributeQueuePost(campaign, post),
    );
    list.appendChild(item);
  });

  host.appendChild(list);
}

function setMobileDistributeTab(tab, { animate = true } = {}) {
  if (state.distributeTab === tab) return;
  state.distributeTab = tab;
  const track = document.querySelector(".mobile-distribute-track");
  const head = document.querySelector(".mobile-campaign-chat-head-distribute");
  if (!track || !head) {
    renderCampaignsView();
    return;
  }
  track.classList.toggle("mobile-distribute-track-instant", !animate);
  track.style.setProperty(
    "--distribute-index",
    String(mobileDistributeTrackIndex(tab)),
  );
  if (!animate) {
    requestAnimationFrame(() =>
      track.classList.remove("mobile-distribute-track-instant"),
    );
  }
  head.querySelectorAll("[data-distribute-tab]").forEach((btn) => {
    const on = btn.dataset.distributeTab === tab;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });
  const composer = document.querySelector(
    ".mobile-campaign-chat-shell .mobile-campaign-composer",
  );
  if (composer) composer.hidden = tab !== "reply";
  if (tab === "queue") {
    const campaign =
      state.campaignsCache.get(state.campaignDetailId) ||
      state.campaigns.find((c) => c.id === state.campaignDetailId) ||
      null;
    if (campaign) refreshMobileDistributeQueueListPanel(campaign);
  }
  if (tab === "sent") {
    const sentPanel = track.querySelector(".mobile-distribute-panel-sent");
    if (sentPanel) {
      sentPanel.innerHTML = "";
      renderDistributeSentView(sentPanel);
    }
  }
}

function buildMobileDistributeTabHead(campaign) {
  const { queue, sent } = distributeTabCounts(campaign);
  const headRow = document.createElement("div");
  headRow.className =
    "mobile-campaign-chat-head mobile-campaign-chat-head-distribute";

  const queueBtn = document.createElement("button");
  queueBtn.type = "button";
  queueBtn.className =
    "sc-sortbtn mobile-distribute-tab-btn" +
    (state.distributeTab === "queue" ? " active" : "");
  queueBtn.dataset.distributeTab = "queue";
  queueBtn.setAttribute("aria-pressed", state.distributeTab === "queue");
  queueBtn.innerHTML = mobileDistributeQueueTabHtml(queue);
  queueBtn.addEventListener("click", () => {
    setMobileDistributeTab(state.distributeTab === "queue" ? "reply" : "queue");
  });

  const sentBtn = document.createElement("button");
  sentBtn.type = "button";
  sentBtn.className =
    "sc-sortbtn mobile-distribute-tab-btn" +
    (state.distributeTab === "sent" ? " active" : "");
  sentBtn.dataset.distributeTab = "sent";
  sentBtn.setAttribute("aria-pressed", state.distributeTab === "sent");
  sentBtn.innerHTML = mobileDistributeSentTabHtml(sent);
  sentBtn.addEventListener("click", () => {
    setMobileDistributeTab(state.distributeTab === "sent" ? "reply" : "sent");
  });

  headRow.appendChild(queueBtn);
  headRow.appendChild(sentBtn);
  return headRow;
}

function buildMobileDistributeBody(campaign) {
  const viewport = document.createElement("div");
  viewport.className = "mobile-distribute-viewport";
  const track = document.createElement("div");
  track.className = "mobile-distribute-track";
  track.style.setProperty(
    "--distribute-index",
    String(mobileDistributeTrackIndex(state.distributeTab)),
  );

  const queueListPanel = document.createElement("div");
  queueListPanel.className =
    "mobile-distribute-panel mobile-distribute-panel-queue";
  renderMobileDistributeQueueList(campaign, queueListPanel);

  const replyPanel = document.createElement("div");
  replyPanel.className =
    "mobile-distribute-panel mobile-distribute-panel-reply";
  renderMobilePosted(campaign, replyPanel);

  const sentPanel = document.createElement("div");
  sentPanel.className = "mobile-distribute-panel mobile-distribute-panel-sent";
  renderDistributeSentView(sentPanel);

  track.appendChild(queueListPanel);
  track.appendChild(replyPanel);
  track.appendChild(sentPanel);
  viewport.appendChild(track);
  return viewport;
}

function syncDistributeToggleCounts(campaign) {
  const head = document.querySelector(".mobile-campaign-chat-head-distribute");
  if (!head) return;
  const { queue, sent } = distributeTabCounts(campaign);
  const queueBtn = head.querySelector('[data-distribute-tab="queue"]');
  const sentBtn = head.querySelector('[data-distribute-tab="sent"]');
  if (queueBtn) queueBtn.innerHTML = mobileDistributeQueueTabHtml(queue);
  if (sentBtn) sentBtn.innerHTML = mobileDistributeSentTabHtml(sent);
}

function renderDistributeQueueCardStack(host, posts, queueIndex) {
  host.innerHTML = "";
  host.className = "distribute-queue-card";
  const post = posts[queueIndex];
  if (!post) return;
  host.appendChild(buildExpandedStoryPost(post, { showWindowBadge: true }));
}

function renderMobileTweetCarousel(campaign, host) {
  const tweets = Array.isArray(campaign.tweets) ? campaign.tweets : [];
  if (!tweets.length) return;
  if (state.campaignTweetIndex >= tweets.length) state.campaignTweetIndex = 0;

  const bt = campaign.brand_twitter || {};
  const avatarUrl = bt.profile_image_url || campaign.brand_logo_url || "";
  const displayName = bt.name || campaign.brand_name || "Brand";
  const handleLabel = twitterHandleLabel(bt.handle, displayName);

  const carousel = document.createElement("div");
  carousel.className = "mobile-campaign-tweet-carousel";

  const nav = document.createElement("div");
  nav.className = "mobile-campaign-tweet-nav";
  const navLeft = document.createElement("div");
  navLeft.className = "mobile-campaign-tweet-nav-left";
  const counter = document.createElement("span");
  counter.className = "mobile-campaign-tweet-counter";
  const regenBtn = document.createElement("button");
  regenBtn.type = "button";
  regenBtn.className = "mobile-campaign-tweet-regen";
  regenBtn.setAttribute("aria-label", "Regenerate all tweets");
  regenBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg>';
  regenBtn.addEventListener("click", () =>
    regenerateCampaignTweets(campaign.id),
  );
  navLeft.appendChild(counter);
  navLeft.appendChild(regenBtn);
  nav.appendChild(navLeft);
  carousel.appendChild(nav);

  // scroll-snap track — browser handles physics and inertia
  const track = document.createElement("div");
  track.className = "mobile-tweet-track";
  const slides = [];
  tweets.forEach((tweet, i) => {
    const slide = buildTweetSlide(
      tweet,
      i,
      campaign,
      avatarUrl,
      displayName,
      handleLabel,
    );
    slides.push(slide);
    track.appendChild(slide);
  });
  carousel.appendChild(track);

  // expanding-pill position indicator
  const pips = document.createElement("div");
  pips.className = "mobile-tweet-pips";
  tweets.forEach((_, i) => {
    const pip = document.createElement("span");
    pip.className = "mobile-tweet-pip";
    pip.addEventListener("click", () => {
      track.scrollTo({ left: slides[i]?.offsetLeft || 0, behavior: "smooth" });
    });
    pips.appendChild(pip);
  });
  carousel.appendChild(pips);

  const postBtn = document.createElement("button");
  postBtn.type = "button";
  postBtn.className = "mobile-campaign-tweet-post-btn";
  postBtn.innerHTML =
    '<span>Post on</span><svg class="mobile-campaign-tweet-x" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.254 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
  postBtn.addEventListener("click", () => {
    mobilePostSelectedTweet(campaign, state.campaignTweetIndex, postBtn);
  });
  carousel.appendChild(postBtn);

  function updateActive(i) {
    state.campaignTweetIndex = i;
    setText(counter, `${i + 1} of ${tweets.length}`);
    pips.querySelectorAll(".mobile-tweet-pip").forEach((pip, idx) => {
      pip.classList.toggle("active", idx === i);
    });
    postBtn.href =
      "https://twitter.com/intent/tweet?text=" +
      encodeURIComponent(tweets[i].text || "");
  }

  let scrollTimer;
  track.addEventListener(
    "scroll",
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        let i = 0;
        let min = Infinity;
        slides.forEach((slide, idx) => {
          const distance = Math.abs(track.scrollLeft - slide.offsetLeft);
          if (distance < min) {
            min = distance;
            i = idx;
          }
        });
        updateActive(Math.max(0, Math.min(i, tweets.length - 1)));
      }, 50);
    },
    { passive: true },
  );

  updateActive(state.campaignTweetIndex);
  host.appendChild(carousel);

  requestAnimationFrame(() => {
    track.scrollLeft = slides[state.campaignTweetIndex]?.offsetLeft || 0;
  });
}

function renderMobilePosted(campaign, host) {
  const storyId = String(campaign.story_id || "").trim();
  if (!storyId) return;

  const postsHost = document.createElement("div");
  postsHost.className = "distribute-content";
  host.appendChild(postsHost);

  const cached = state.distributeStoryCache.get(storyId);
  const isFresh =
    cached && Date.now() - Number(cached.fetchedAt || 0) < 5 * 60 * 1000;

  if (isFresh) {
    renderDistributePostQueue(postsHost, campaign);
    return;
  }

  const loading = document.createElement("div");
  loading.className = "distribute-loading";
  const spinner = document.createElement("div");
  spinner.className = "mobile-campaign-loading-spinner";
  const label = document.createElement("span");
  setText(label, "Loading story conversation…");
  loading.appendChild(spinner);
  loading.appendChild(label);
  postsHost.appendChild(loading);

  if (!state.distributeStoryInFlight.has(storyId)) {
    state.distributeStoryInFlight.add(storyId);
    (async () => {
      try {
        const res = await api(
          `/api/trends/story/${encodeURIComponent(storyId)}`,
        );
        if (res.status === 401) {
          showLogin();
          return;
        }
        const posts = Array.isArray(res.body?.posts) ? res.body.posts : [];
        state.distributeStoryCache.set(storyId, {
          story: res.ok ? res.body?.story : null,
          posts,
          fetchedAt: Date.now(),
        });
      } catch {
        state.distributeStoryCache.set(storyId, {
          story: null,
          posts: [],
          fetchedAt: Date.now(),
        });
      } finally {
        state.distributeStoryInFlight.delete(storyId);
        if (
          state.activeTab === "campaigns" &&
          state.campaignDetailId === campaign.id
        ) {
          const postsHost = document.querySelector(
            ".mobile-distribute-panel-reply .distribute-content",
          );
          const hasRenderedQueue =
            !!postsHost?.querySelector(".distribute-queue");
          if (!hasRenderedQueue) renderCampaignsView();
        }
      }
    })();
  }
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

function appendMobileDistributePostEngagement(content, post) {
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

function buildMobileDistributePostBody(
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

  appendMobileDistributePostEngagement(content, post);

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

function buildMobileDistributeQueueItem(post, { isActive = false } = {}) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "mobile-distribute-queue-list-item";
  if (isActive) item.classList.add("is-active");

  const windowBadge = buildDistributeWindowBadge(post);
  item.appendChild(
    buildMobileDistributePostBody(post, {
      metaRight: windowBadge,
      fullText: true,
    }),
  );
  return item;
}

function buildMobileDistributeSentItem(entry) {
  const post = entry.post || {};
  const url = String(post.url || "").trim();
  const row = document.createElement(url ? "a" : "div");
  row.className = "mobile-distribute-sent-item";
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
    buildMobileDistributePostBody(post, {
      metaRight: time,
      reply: entry.reply,
    }),
  );
  return row;
}

function renderDistributeSentView(host) {
  const entries = Array.from(state.distributeSentPosts.values());
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "distribute-empty";
    setText(empty, "No replies sent yet.");
    host.appendChild(empty);
    return;
  }
  const list = document.createElement("div");
  list.className = "distribute-sent-list";
  entries.reverse().forEach((entry) => {
    list.appendChild(buildMobileDistributeSentItem(entry));
  });
  host.appendChild(list);
}

function renderDistributePostQueue(host, campaign) {
  const storyId = String(campaign.story_id || "").trim();
  const campaignId = campaign.id;
  const cached = state.distributeStoryCache.get(storyId);
  const rawPosts = Array.isArray(cached?.posts) ? cached.posts : [];
  const activePosts = () => getDistributeQueuePosts(storyId);

  host.innerHTML = "";
  if (!rawPosts.length) {
    const empty = document.createElement("div");
    empty.className = "distribute-empty";
    setText(empty, "No story posts found yet.");
    host.appendChild(empty);
    return;
  }
  if (!activePosts().length) {
    const done = document.createElement("div");
    done.className = "distribute-empty";
    setText(done, "Check back later for high-engagement posts to hijack.");
    host.appendChild(done);
    return;
  }

  const bt = campaign.brand_twitter || {};
  const brandAvatar = bt.profile_image_url || campaign.brand_logo_url || "";
  const brandDisplay = bt.name || campaign.brand_name || "Brand";
  const brandHandle = bt.handle ? `@${bt.handle}` : "";

  const queue = document.createElement("div");
  queue.className = "distribute-queue";
  const cardHost = document.createElement("div");
  cardHost.className = "distribute-queue-card";
  const replyHost = document.createElement("div");
  replyHost.className = "distribute-reply-host";
  const postUrlHost = document.createElement("div");
  postUrlHost.className = "distribute-post-url-host";
  const actions = document.createElement("div");
  actions.className = "distribute-queue-actions";

  const replyBtn = document.createElement("button");
  replyBtn.type = "button";
  replyBtn.className = "mobile-campaign-tweet-post-btn distribute-reply-btn";
  replyBtn.innerHTML =
    '<span>Reply on</span><svg class="mobile-campaign-tweet-x" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.254 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.className = "distribute-dismiss-btn";
  setText(dismissBtn, "Skip");

  actions.appendChild(replyBtn);
  actions.appendChild(dismissBtn);
  queue.appendChild(cardHost);
  queue.appendChild(postUrlHost);
  queue.appendChild(replyHost);
  queue.appendChild(actions);
  host.appendChild(queue);

  let queueIndex = state.distributeQueueIndex.get(campaignId) ?? 0;
  let postUrlInputOpen = false;
  let postUrlInputDraft = "";

  function replyKey(post) {
    return distributeReplyKey(campaignId, post);
  }

  function isReplyHostForPost(post) {
    return String(replyHost.dataset.replyKey || "") === replyKey(post);
  }

  function normalizeReplyDraftText(text) {
    const raw = String(text || "").trim();
    const url = String(campaign.post_url || "").trim();
    if (!raw || !url) return raw;
    if (!raw.endsWith(url)) return raw;
    return raw.slice(0, raw.length - url.length).replace(/\s+$/, "");
  }

  function replyTextWithPostUrl(text) {
    const raw = String(text || "").trim();
    const url = String(campaign.post_url || "").trim();
    if (!raw || !url) return raw;
    if (raw.endsWith(url)) return raw;
    return raw + "\n\n" + url;
  }

  function buildReplyCard(post, options = {}) {
    const { text = null, loading = false } = options;
    const card = document.createElement("div");
    card.className =
      "distribute-reply-card" + (loading ? " distribute-reply-shimmer" : "");

    const connector = document.createElement("div");
    connector.className = "distribute-reply-connector";
    card.appendChild(connector);

    const inner = document.createElement("div");
    inner.className = "distribute-reply-inner";

    const header = document.createElement("div");
    header.className = "distribute-reply-header";
    if (brandAvatar) {
      const av = document.createElement("img");
      av.className = "mobile-xav";
      av.src = brandAvatar;
      av.alt = "";
      av.onerror = () => av.remove();
      header.appendChild(av);
    }
    const who = document.createElement("div");
    who.className = "mobile-xwho";
    const nameRow = document.createElement("div");
    nameRow.className = "mobile-xname-row";
    const name = document.createElement("span");
    name.className = "mobile-xname";
    setText(name, brandDisplay);
    nameRow.appendChild(name);
    who.appendChild(nameRow);
    if (brandHandle) {
      const handle = document.createElement("div");
      handle.className = "mobile-xhandle";
      setText(handle, brandHandle);
      who.appendChild(handle);
    }
    header.appendChild(who);

    const toolRow = document.createElement("div");
    toolRow.className = "distribute-reply-tools";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "distribute-reply-tool-btn";
    editBtn.title = "Edit";
    editBtn.disabled = loading;
    editBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
    const regenBtn = document.createElement("button");
    regenBtn.type = "button";
    regenBtn.className = "distribute-reply-tool-btn";
    regenBtn.title = "Regenerate";
    regenBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>';
    toolRow.appendChild(editBtn);
    toolRow.appendChild(regenBtn);
    header.appendChild(toolRow);
    inner.appendChild(header);

    let textEl = null;
    if (loading) {
      const shimmerBody = document.createElement("div");
      shimmerBody.className = "distribute-reply-shimmer-body";
      const line1 = document.createElement("div");
      line1.className = "distribute-reply-shimmer-line";
      const line2 = document.createElement("div");
      line2.className =
        "distribute-reply-shimmer-line distribute-reply-shimmer-short";
      shimmerBody.appendChild(line1);
      shimmerBody.appendChild(line2);
      inner.appendChild(shimmerBody);
    } else {
      textEl = document.createElement("p");
      textEl.className = "distribute-reply-text";
      setText(textEl, replyTextWithPostUrl(text || ""));
      inner.appendChild(textEl);
    }
    card.appendChild(inner);

    const activateEdit = () => {
      if (!textEl || textEl.querySelector("textarea")) return;
      const current = textEl.textContent;
      textEl.textContent = "";
      const input = document.createElement("textarea");
      input.className = "distribute-reply-edit";
      input.value = current;
      input.maxLength = 150;
      textEl.appendChild(input);
      autosizeTweetTextarea(input);
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);

      const save = () => {
        const val = input.value.trim();
        const clean = normalizeReplyDraftText(val);
        if (clean) {
          distributeReplyDraftSet(replyKey(post), clean);
          textEl.textContent = "";
          setText(textEl, replyTextWithPostUrl(clean));
        } else {
          textEl.textContent = "";
          setText(
            textEl,
            replyTextWithPostUrl(normalizeReplyDraftText(current)),
          );
        }
      };
      input.addEventListener("blur", save);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          input.blur();
        }
        if (e.key === "Escape") {
          textEl.textContent = "";
          setText(textEl, current);
        }
      });
    };

    editBtn.addEventListener("click", activateEdit);
    if (textEl) textEl.addEventListener("click", activateEdit);

    regenBtn.addEventListener("click", () => {
      distributeReplyDraftDelete(replyKey(post));
      fetchReply(post);
    });

    card._setReplyText = (replyText) => {
      if (!replyHost.isConnected || !isReplyHostForPost(post)) return;
      const shimmerBody = card.querySelector(".distribute-reply-shimmer-body");
      if (shimmerBody) {
        textEl = document.createElement("p");
        textEl.className = "distribute-reply-text";
        setText(textEl, replyTextWithPostUrl(replyText));
        textEl.addEventListener("click", activateEdit);
        shimmerBody.replaceWith(textEl);
        card.classList.remove("distribute-reply-shimmer");
        editBtn.disabled = false;
      } else if (textEl) {
        setText(textEl, replyTextWithPostUrl(replyText));
      }
    };

    return card;
  }

  function renderReplyLoading(post) {
    replyHost.innerHTML = "";
    replyHost.appendChild(buildReplyCard(post, { loading: true }));
  }

  async function waitForReplyCache(key, inflightKey) {
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      if (distributeReplyDraftHas(key)) return;
      if (!state.distributeReplyInFlight.has(inflightKey)) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  function paintReply(post, text) {
    if (!replyHost.isConnected || !isReplyHostForPost(post)) return;
    const card = replyHost.querySelector(".distribute-reply-card");
    if (card && typeof card._setReplyText === "function") {
      card._setReplyText(text);
      return;
    }
    replyHost.innerHTML = "";
    replyHost.appendChild(buildReplyCard(post, { text }));
  }

  async function fetchReply(post, feedback) {
    const key = replyKey(post);
    const inflightKey = key + (feedback || "");
    if (!feedback && distributeReplyDraftHas(key)) {
      paintReply(post, distributeReplyDraftGet(key));
      return;
    }
    renderReplyLoading(post);
    if (state.distributeReplyInFlight.has(inflightKey)) {
      await waitForReplyCache(key, inflightKey);
      if (distributeReplyDraftHas(key)) {
        paintReply(post, distributeReplyDraftGet(key));
      }
      return;
    }
    state.distributeReplyInFlight.add(inflightKey);
    try {
      const res = await api(
        `/api/sitmar/${encodeURIComponent(campaignId)}/reply`,
        {
          method: "POST",
          body: JSON.stringify({
            post_text: post.text || "",
            post_author: post.author_name || post.author_handle || "",
            feedback: feedback || "",
          }),
        },
      );
      if (res.status === 401) {
        showLogin();
        return;
      }
      const reply = res.ok ? res.body?.reply || "" : "";
      if (reply) {
        distributeReplyDraftSet(key, reply);
        if (isReplyHostForPost(post)) paintReply(post, reply);
      }
    } catch {
      /* keep existing reply ui on transient failures */
    } finally {
      state.distributeReplyInFlight.delete(inflightKey);
    }
  }

  function dismissCurrent({ persist = true } = {}) {
    const posts = activePosts();
    const post = posts[queueIndex];
    if (post) {
      state.distributeDismissed.add(distributePostKey(storyId, post));
      distributeReplyDraftDelete(replyKey(post));
      if (persist) persistMobileDistributeSkip(campaign, post);
    }
    const remaining = activePosts();
    if (queueIndex >= remaining.length) {
      queueIndex = Math.max(0, remaining.length - 1);
    }
    state.distributeQueueIndex.set(campaignId, queueIndex);
    syncDistributeToggleCounts(campaign);
    refreshMobileDistributeQueueListPanel(campaign);
    renderCurrent();
  }

  // swipe-to-dismiss
  let swipeStartX = 0,
    swipeStartY = 0,
    swipeDx = 0,
    swipeLocked = false,
    swipeActive = false;
  const SWIPE_THRESHOLD = 80;

  function applySwipeTransform(dx) {
    const opacity = Math.max(0, 1 - Math.abs(dx) / 300);
    queue.style.transform = `translateX(${dx}px)`;
    queue.style.opacity = opacity;
  }

  function resetSwipe() {
    queue.style.transition = "transform .2s ease, opacity .2s ease";
    queue.style.transform = "";
    queue.style.opacity = "";
    queue.addEventListener(
      "transitionend",
      function cleanup() {
        queue.style.transition = "";
        queue.removeEventListener("transitionend", cleanup);
      },
      { once: true },
    );
    swipeActive = false;
    swipeLocked = false;
  }

  function animateDismiss(direction) {
    const target = direction * window.innerWidth;
    queue.style.transition = "transform .25s ease-in, opacity .25s ease-in";
    queue.style.transform = `translateX(${target}px)`;
    queue.style.opacity = "0";
    queue.addEventListener(
      "transitionend",
      function done() {
        queue.removeEventListener("transitionend", done);
        queue.style.transition = "";
        queue.style.transform = "";
        queue.style.opacity = "";
        dismissCurrent();
      },
      { once: true },
    );
  }

  queue.addEventListener(
    "touchstart",
    (e) => {
      swipeStartX = e.touches[0].clientX;
      swipeStartY = e.touches[0].clientY;
      swipeDx = 0;
      swipeLocked = false;
      swipeActive = false;
      queue.style.transition = "";
    },
    { passive: true },
  );

  queue.addEventListener(
    "touchmove",
    (e) => {
      const dx = e.touches[0].clientX - swipeStartX;
      const dy = e.touches[0].clientY - swipeStartY;
      if (!swipeLocked) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        swipeLocked = true;
        swipeActive = Math.abs(dx) > Math.abs(dy);
      }
      if (!swipeActive) return;
      e.preventDefault();
      swipeDx = dx;
      applySwipeTransform(dx);
    },
    { passive: false },
  );

  queue.addEventListener("touchend", () => {
    if (!swipeActive) return;
    if (Math.abs(swipeDx) >= SWIPE_THRESHOLD) {
      animateDismiss(swipeDx > 0 ? 1 : -1);
    } else {
      resetSwipe();
    }
  });

  function renderPostUrlInput() {
    postUrlHost.innerHTML = "";
    const row = document.createElement("div");
    row.className = "distribute-post-url-row";
    const input = document.createElement("input");
    input.type = "url";
    input.className = "distribute-post-url-input";
    input.placeholder = "https://x.com/…";
    input.value = postUrlInputDraft;
    const submitBtn = document.createElement("button");
    submitBtn.type = "button";
    submitBtn.className = "distribute-post-url-submit";
    submitBtn.setAttribute("aria-label", "Save post URL");
    submitBtn.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>';
    row.appendChild(input);
    row.appendChild(submitBtn);
    postUrlHost.appendChild(row);
    input.focus();
    if (postUrlInputDraft) {
      input.setSelectionRange(input.value.length, input.value.length);
    }
    input.addEventListener("input", () => {
      postUrlInputDraft = input.value;
    });
    const submit = async () => {
      const url = input.value.trim();
      if (!url) return;
      if (
        !url.startsWith("https://x.com/") &&
        !url.startsWith("https://twitter.com/")
      ) {
        showToast("Please enter an x.com or twitter.com link.");
        return;
      }
      submitBtn.disabled = true;
      try {
        const res = await api(
          `/api/sitmar/${encodeURIComponent(campaign.id)}/post-url`,
          { method: "POST", body: JSON.stringify({ post_url: url }) },
        );
        if (!res.ok) {
          const detail = res.body?.detail;
          showToast(
            typeof detail === "string" ? detail : "Couldn't save post URL.",
          );
          submitBtn.disabled = false;
          return;
        }
        campaign.post_url = url;
        patchMobileCampaignCache(campaign, (c) => {
          c.post_url = url;
        });
        postUrlInputOpen = false;
        postUrlInputDraft = "";
        renderPostUrlHost();
      } catch (err) {
        showToast("Network error: " + (err.message || ""));
        submitBtn.disabled = false;
      }
    };
    submitBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void submit();
      }
    });
  }

  function renderPostUrlHost() {
    postUrlHost.innerHTML = "";
    if (campaign.post_url) {
      postUrlInputOpen = false;
      postUrlInputDraft = "";
      const link = document.createElement("a");
      link.className = "distribute-post-url-link";
      link.href = campaign.post_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.innerHTML =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
      const text = document.createElement("span");
      text.className = "distribute-post-url-link-text";
      setText(text, campaign.post_url);
      link.appendChild(text);
      postUrlHost.appendChild(link);
      return;
    }
    if (postUrlInputOpen) {
      renderPostUrlInput();
      return;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "distribute-link-post-btn";
    btn.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' +
      "<span>Link your post to hijack this thread's engagement</span>";
    btn.addEventListener("click", () => {
      postUrlInputOpen = true;
      renderPostUrlInput();
    });
    postUrlHost.appendChild(btn);
  }

  const renderCurrent = () => {
    queueIndex = state.distributeQueueIndex.get(campaignId) ?? queueIndex;
    const posts = activePosts();
    if (!posts.length) {
      state.distributeQueueIndex.set(campaignId, 0);
      host.innerHTML = "";
      const done = document.createElement("div");
      done.className = "distribute-empty";
      setText(done, "Check back later for high-engagement posts to hijack.");
      host.appendChild(done);
      syncDistributeToggleCounts(campaign);
      return;
    }

    if (queueIndex >= posts.length) queueIndex = 0;
    state.distributeQueueIndex.set(campaignId, queueIndex);

    const post = posts[queueIndex];
    replyHost.dataset.replyKey = replyKey(post);

    cardHost.innerHTML = "";
    renderDistributeQueueCardStack(cardHost, posts, queueIndex);

    const cachedReply = distributeReplyDraftGet(replyKey(post));
    replyHost.innerHTML = "";
    if (cachedReply) {
      paintReply(post, cachedReply);
    } else {
      fetchReply(post);
    }

    renderPostUrlHost();

    state._distributeReplyFeedbackFn = (feedback) => {
      distributeReplyDraftDelete(replyKey(post));
      fetchReply(post, feedback);
    };

    const canReply = Boolean(distributeReplyIntentUrl(post, ""));
    replyBtn.disabled = !canReply;
    replyBtn.onclick = () => {
      const cachedRaw = distributeReplyDraftGet(replyKey(post)) || "";
      const rawReplyText = cachedRaw
        ? cachedRaw
        : normalizeReplyDraftText(
            distributeReplyTextFromHost(replyHost, cachedRaw),
          );
      const sentText = replyTextWithPostUrl(rawReplyText);
      const intentUrl = distributeReplyIntentUrl(post, sentText);
      if (!intentUrl) return;
      if (rawReplyText) distributeReplyDraftSet(replyKey(post), rawReplyText);
      const postKey = distributePostKey(storyId, post);
      state.distributeSentPosts.set(postKey, {
        post,
        sentAt: Date.now(),
        reply: sentText,
      });
      persistMobileDistributeSent(campaign, post, sentText);
      showToast("Reply opened on X");
      syncDistributeToggleCounts(campaign);
      dismissCurrent({ persist: false });
      window.open(intentUrl, "_blank", "noopener");
    };
    dismissBtn.onclick = () => dismissCurrent();
  };

  renderCurrent();
}

function contentCampaignStatusLabel(status) {
  const value = String(status || "").toLowerCase();
  if (value === "posted") return "Distribute";
  if (value === "drafted") return "Post";
  return "React";
}

function renderCampaignsView() {
  let mount = customerContentMount();
  if (!mount && state.selectedBrandId && state.brandScreen === "detail") {
    ensureCustomerShell();
    mount = customerContentMount();
  }
  if (!state.campaignDetailId) {
    if (mount) {
      syncCustomerContentPanel();
      return;
    }
    const detail = $("#brand-detail-content");
    if (!detail) return;
    detail.innerHTML = "";
    const root = document.createElement("div");
    root.className =
      "sc-phone-view campaigns-customer-detail campaigns-list-mode";
    root.appendChild(buildMobileContentStudioTitleWrap({ showToggle: true }));
    root.appendChild(buildMobileCampaignHistoryCol());
    detail.appendChild(root);
    return;
  }
  if (!mount) return;
  const detail = mount;
  detail.innerHTML = "";
  const root = document.createElement("div");
  root.className = "sc-phone-view campaigns-customer-detail";

  if (state.campaignDetailId) {
    const campaign =
      state.campaignsCache.get(state.campaignDetailId) ||
      state.campaigns.find((item) => item.id === state.campaignDetailId) ||
      null;
    if (!campaign) {
      state.campaignDetailId = "";
      renderCampaignsView();
      return;
    }
    const isPosted = campaign.status === "posted";
    if (isPosted) {
      root.appendChild(buildMobileDistributeTabHead(campaign));
    } else {
      const headRow = document.createElement("div");
      headRow.className = "mobile-campaign-chat-head";
      const back = document.createElement("button");
      back.type = "button";
      back.className = "sc-sortbtn mobile-campaign-chat-back";
      back.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 6l-6 6 6 6"/></svg><span>Content</span>';
      back.addEventListener("click", () => {
        state.campaignDetailId = "";
        state.campaignTweetIndex = 0;
        stopCampaignPolling();
        renderCampaignsView();
      });
      headRow.appendChild(back);
      root.appendChild(headRow);
    }

    const seed = campaign.selected_seed || {};
    if (seed.title && campaign.status === "selected") {
      const banner = document.createElement("div");
      banner.className = "mobile-campaign-seed-banner";
      const bTitle = document.createElement("div");
      bTitle.className = "mobile-campaign-seed-banner-title";
      setText(bTitle, seed.title);
      banner.appendChild(bTitle);
      if (seed.blurb) {
        const bBlurb = document.createElement("div");
        bBlurb.className = "mobile-campaign-seed-banner-blurb";
        setText(bBlurb, seed.blurb);
        banner.appendChild(bBlurb);
      }
      root.appendChild(banner);
    }

    const chatShell = document.createElement("div");
    chatShell.className = "mobile-campaign-chat-shell";
    if (isPosted) {
      chatShell.classList.add("mobile-campaign-distribute-shell");
      chatShell.appendChild(buildMobileDistributeBody(campaign));
      stopCampaignPolling();
    } else {
      const scroll = document.createElement("div");
      scroll.className = "mobile-campaign-chat-scroll";
      const thread = document.createElement("div");
      thread.className = "mobile-campaign-chat-thread";
      const messages = Array.isArray(campaign.messages)
        ? campaign.messages
        : [];
      let latestSeedTurn = -1;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (
          messages[i]?.role === "assistant" &&
          Array.isArray(messages[i].seeds) &&
          messages[i].seeds.length
        ) {
          latestSeedTurn = i;
          break;
        }
      }
      let latestVibeTurn = -1;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (
          messages[i]?.role === "assistant" &&
          Array.isArray(messages[i].vibes) &&
          messages[i].vibes.length
        ) {
          latestVibeTurn = i;
          break;
        }
      }
      messages.forEach((turn, index) => {
        appendMobileCampaignTurn(thread, turn, campaign, {
          turnIndex: index,
          latestSeedTurn,
          latestVibeTurn,
        });
      });

      removeMobileCampaignTypingIndicator(thread);
      if (shouldShowMobileCampaignIdeating(campaign)) {
        thread.appendChild(mobileCampaignIdeatingIndicator());
      }
      syncMobileInlinePostsBlock(thread, campaign);

      if (campaign.status === "thinking" || campaign.status === "drafting") {
        startCampaignPolling(campaign.id);
      } else {
        stopCampaignPolling();
      }
      scroll.appendChild(thread);
      chatShell.appendChild(scroll);
    }

    const showComposer =
      (campaign.status !== "drafting" || mobileHasDraftPosts(campaign)) &&
      !(isPosted && state.distributeTab !== "reply");
    if (showComposer) {
      const composer = document.createElement("div");
      composer.className = "mobile-campaign-composer";
      const inputRow = document.createElement("div");
      inputRow.className = "mobile-campaign-input-row";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "mobile-campaign-input";
      const blocked =
        campaign.status === "thinking" || campaign.status === "drafting";
      input.disabled = blocked;
      input.placeholder = mobileComposerPlaceholder(campaign);
      const send = document.createElement("button");
      send.type = "button";
      send.className = "sitmar-chat-send-btn";
      send.setAttribute("aria-label", "Send");
      send.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="6 11 12 5 18 11"></polyline></svg>';
      const syncSendDisabled = () => {
        send.disabled = blocked || !input.value.trim();
      };
      const doSend = () => {
        const text = input.value.trim();
        if (!text || send.disabled) return;
        input.value = "";
        syncSendDisabled();
        if (isPosted && state._distributeReplyFeedbackFn) {
          state._distributeReplyFeedbackFn(text);
        } else {
          sendCampaignMessage(campaign.id, text);
        }
      };
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          doSend();
        }
      });
      input.addEventListener("input", syncSendDisabled);
      send.addEventListener("click", doSend);
      syncSendDisabled();
      inputRow.appendChild(input);
      inputRow.appendChild(send);
      composer.appendChild(inputRow);
      chatShell.appendChild(composer);
    }

    root.appendChild(chatShell);
    detail.appendChild(root);
    if (!isPosted) {
      const scrollEl = chatShell.querySelector(".mobile-campaign-chat-scroll");
      requestAnimationFrame(() => {
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
      });
    }
    if (!state.campaignsCache.has(campaign.id)) {
      ensureCampaignDetail(campaign.id);
    }
    return;
  }
}

function closeBrandCustomerPopover() {
  document.querySelector(".customer-mobile-inspector-overlay")?.remove();
}

function showCustomerSynthesisOverlay(synthesisText) {
  closeBrandCustomerPopover();
  const overlay = document.createElement("div");
  overlay.className = "customer-mobile-inspector-overlay";
  overlay.innerHTML = `
    <div class="customer-mobile-inspector-panel" role="dialog" aria-modal="true" aria-labelledby="customer-inspector-title">
      <div class="customer-mobile-inspector-head">
        <div>
          <div class="customer-mobile-inspector-kicker">Brand inspector</div>
          <h2 id="customer-inspector-title">Brand synthesis</h2>
        </div>
        <button class="customer-mobile-inspector-close" type="button" aria-label="Close brand story">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <p class="customer-mobile-inspector-summary">${escapeHtml(synthesisText)}</p>
    </div>
  `;
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay
    .querySelector(".customer-mobile-inspector-close")
    ?.addEventListener("click", () => {
      overlay.remove();
    });
  document.body.appendChild(overlay);
}

function buildMobileStoriesLoadFooter() {
  const footer = document.createElement("div");
  footer.className = "stories-customer-load-footer";
  footer.setAttribute("aria-live", "polite");
  const label = document.createElement("div");
  label.className = "stories-customer-load-label";
  footer.appendChild(label);
  return footer;
}

function updateMobileStoriesLoadFooter(listEl, feedKey) {
  const footer = listEl?.querySelector(".stories-customer-load-footer");
  if (!footer) return;
  const label = footer.querySelector(".stories-customer-load-label");
  footer.classList.remove("is-loading", "is-armed");
  if (state.storiesFeedLoadingMore.has(feedKey)) {
    footer.classList.add("is-loading");
    setText(label, "Loading more stories…");
    return;
  }
  if (
    !state.storiesFeedHasMore.get(feedKey) &&
    state.storiesFeedCache.get(feedKey)?.length
  ) {
    setText(label, "You're all caught up");
    return;
  }
  setText(label, "");
}

function bindMobileStoriesLoadFooter(listEl, feedKey) {
  mobileStoriesLoadObserver?.disconnect();
  let footer = listEl.querySelector(".stories-customer-load-footer");
  if (!footer) {
    footer = buildMobileStoriesLoadFooter();
    listEl.appendChild(footer);
  }
  updateMobileStoriesLoadFooter(listEl, feedKey);
  mobileStoriesLoadArmed = true;
  mobileStoriesLoadObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) {
          mobileStoriesLoadArmed = true;
          continue;
        }
        if (
          !mobileStoriesLoadArmed ||
          state.storiesFeedLoadingMore.has(feedKey) ||
          !state.storiesFeedHasMore.get(feedKey) ||
          state.storiesFeedGated.get(feedKey)
        ) {
          continue;
        }
        void maybeLoadMoreMobileStories(feedKey);
      }
    },
    { rootMargin: "220px 0px", threshold: 0 },
  );
  mobileStoriesLoadObserver.observe(footer);
}

function appendMobileStoriesCards(freshRows, feedKey) {
  const listEl = document.querySelector(".mobile-stories-list");
  const company = mobileSettledCompany();
  if (!listEl || feedKey !== mobileStoriesFeedKey() || !freshRows.length) {
    return;
  }
  const footer = listEl.querySelector(".stories-customer-load-footer");
  sortMobileStories(freshRows).forEach((story) => {
    const card = buildMobileStoriesAccordionCard(story, company);
    if (footer) listEl.insertBefore(card, footer);
    else listEl.appendChild(card);
  });
  if (
    !state.storiesFeedGated.get(feedKey) &&
    state.storiesFeedHasMore.get(feedKey)
  ) {
    bindMobileStoriesLoadFooter(listEl, feedKey);
  } else {
    updateMobileStoriesLoadFooter(listEl, feedKey);
  }
}

async function loadMobileStoriesPage({ feedKey, append = false } = {}) {
  if (!feedKey) return null;
  const isAnonymous = feedKey === MOBILE_ANONYMOUS_STORIES_KEY;
  let res;
  let rows = [];
  let windowIndex = 0;

  if (isAnonymous) {
    windowIndex = append
      ? (state.storiesFeedWindowIndex.get(feedKey) || 0) + 1
      : 0;
    const sinceHours = (windowIndex + 1) * 24;
    const untilHours = windowIndex * 24;
    const params = new URLSearchParams({
      limit: String(BRAND_STORIES_PAGE_SIZE),
      since_hours: String(sinceHours),
      until_hours: String(untilHours),
      include_posts: "1",
      posts_per_story: "3",
    });
    res = await api(`/api/trends/stories?${params.toString()}`);
  } else {
    const offset = append ? state.storiesFeedOffset.get(feedKey) || 0 : 0;
    const params = new URLSearchParams({
      offset: String(offset),
      limit: String(BRAND_STORIES_PAGE_SIZE),
      posts_per_story: "3",
    });
    res = await api(
      `/api/company/${encodeURIComponent(feedKey)}/stories?${params.toString()}`,
    );
  }

  if (res.status === 401) {
    showLogin();
    return null;
  }
  if (!res.ok) return null;

  rows = Array.isArray(res.body?.stories) ? res.body.stories : [];
  const gated = !!res.body?.gated;
  state.storiesFeedGated.set(feedKey, gated);
  let fresh = rows;

  if (append) {
    const existing = state.storiesFeedCache.get(feedKey) || [];
    const seen = new Set(
      existing.map((story) => customerStoryId(story)).filter(Boolean),
    );
    fresh = rows.filter((story) => {
      const storyId = customerStoryId(story);
      return storyId && !seen.has(storyId);
    });
    state.storiesFeedCache.set(feedKey, existing.concat(fresh));
    if (isAnonymous) {
      state.storiesFeedWindowIndex.set(feedKey, windowIndex);
      state.storiesFeedHasMore.set(feedKey, !gated && rows.length > 0);
    } else {
      const offset = state.storiesFeedOffset.get(feedKey) || 0;
      state.storiesFeedOffset.set(feedKey, offset + fresh.length);
      state.storiesFeedHasMore.set(
        feedKey,
        !gated && rows.length === BRAND_STORIES_PAGE_SIZE,
      );
    }
  } else {
    state.storiesFeedCache.set(feedKey, rows);
    if (isAnonymous) {
      state.storiesFeedWindowIndex.set(feedKey, 0);
      state.storiesFeedHasMore.set(feedKey, !gated && rows.length > 0);
    } else {
      state.storiesFeedOffset.set(feedKey, rows.length);
      state.storiesFeedHasMore.set(
        feedKey,
        !gated && rows.length === BRAND_STORIES_PAGE_SIZE,
      );
    }
  }

  state.storiesFeedFetchedAt.set(feedKey, Date.now());
  if (isPreBrandMode()) {
    if (document.querySelector(".pre-brand-shell")) {
      if (append) appendMobileStoriesCards(fresh, feedKey);
      else syncPreBrandStoriesPanel();
    } else {
      renderActiveScreen();
    }
  } else if (
    state.activeTab === "stories" &&
    mobileStoriesFeedKey() === feedKey
  ) {
    if (append) appendMobileStoriesCards(fresh, feedKey);
    else renderStoriesView();
  }
  return rows;
}

async function ensureStoriesFeed(feedKey) {
  if (!feedKey || state.storiesFeedInFlight.has(feedKey)) return;
  state.storiesFeedInFlight.add(feedKey);
  try {
    await loadMobileStoriesPage({ feedKey, append: false });
  } catch {
    // ignore network failures; ui keeps stale data
  } finally {
    state.storiesFeedInFlight.delete(feedKey);
  }
}

async function maybeLoadMoreMobileStories(feedKey) {
  if (
    !feedKey ||
    state.storiesFeedLoadingMore.has(feedKey) ||
    !state.storiesFeedHasMore.get(feedKey) ||
    !mobileStoriesLoadArmed
  ) {
    return;
  }
  state.storiesFeedLoadingMore.add(feedKey);
  mobileStoriesLoadArmed = false;
  const listEl = document.querySelector(".mobile-stories-list");
  updateMobileStoriesLoadFooter(listEl, feedKey);
  try {
    await loadMobileStoriesPage({ feedKey, append: true });
  } finally {
    state.storiesFeedLoadingMore.delete(feedKey);
    updateMobileStoriesLoadFooter(
      document.querySelector(".mobile-stories-list"),
      feedKey,
    );
  }
}

async function loadCampaigns() {
  const res = await api("/api/sitmar");
  if (res.status === 401) {
    showLogin();
    return;
  }
  if (!res.ok) return;
  syncMobileContentHistoryFromResponse(res.body);
  state.campaigns = Array.isArray(res.body?.campaigns)
    ? res.body.campaigns
    : [];
  refreshMobileContentStudioHistoryToggle();
  if (state.activeTab === "campaigns") {
    renderCampaignsView();
  } else if (state.contentStudioMode === "content" && customerContentMount()) {
    syncCustomerContentPanel();
  }
}

async function loadCompanies() {
  await presentCustomerBrandAfterBoot();
}

let addBrandPollTimer = null;

function openAddBrandOverlay() {
  let overlay = document.querySelector(".add-brand-overlay");
  if (overlay) {
    overlay.remove();
  }
  overlay = document.createElement("div");
  overlay.className = "add-brand-overlay";
  overlay.innerHTML = `
    <div class="add-brand-panel">
      <h2>Add brand</h2>
      <form class="add-brand-form">
        <div class="add-brand-field">
          <label for="add-brand-url">Website URL or domain</label>
          <input type="text" id="add-brand-url" placeholder="nike.com" autocomplete="off" />
          <div class="add-brand-hint">Enter a public website domain or URL.</div>
        </div>
        <div class="add-brand-error"></div>
        <div class="add-brand-actions">
          <button type="submit" class="btn-primary">Add brand</button>
          <button type="button" class="btn-secondary add-brand-cancel">Cancel</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(overlay);

  const panel = overlay.querySelector(".add-brand-panel");
  const input = overlay.querySelector("#add-brand-url");
  const form = overlay.querySelector(".add-brand-form");
  const errEl = overlay.querySelector(".add-brand-error");
  const submitBtn = overlay.querySelector('button[type="submit"]');
  const cancelBtn = overlay.querySelector(".add-brand-cancel");

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeAddBrandOverlay();
  });
  cancelBtn.addEventListener("click", closeAddBrandOverlay);
  input.focus();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = input.value.trim();
    setText(errEl, "");
    input.removeAttribute("aria-invalid");
    if (!url) {
      setText(errEl, "Add a website URL or domain first.");
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    submitBtn.disabled = true;
    setText(submitBtn, "Looking it up…");
    try {
      const res = await api("/api/companies", {
        method: "POST",
        body: JSON.stringify({ website_url: url }),
      });
      if (!res.ok) {
        const d = res.body && res.body.detail;
        const msg =
          typeof d === "string"
            ? d
            : "Couldn't add that brand. Enter a valid public website URL or domain.";
        setText(errEl, msg);
        return;
      }
      closeAddBrandOverlay();
      if (res.body?.company) {
        const attachedCompany = await attachSignedInUserToCompanyIfNeeded(
          res.body.company,
          errEl,
        );
        if (!attachedCompany) return;
        setStoredCompanyId(attachedCompany.id);
        state.companies = [attachedCompany];
        if (
          res.body.created === false &&
          !shouldResumePreBrandOnboarding(attachedCompany)
        ) {
          markMobileDuplicateBrandOnboarding(false);
          renderBrandHomeEmpty();
          applyPreBrandProgressState(attachedCompany);
          void finishSettledMobileExistingBrandOverlay(attachedCompany.id);
          return;
        }
        if (res.body.created === false) {
          markMobileDuplicateBrandOnboarding(false);
          void prefetchMobileBrandDashboardData(attachedCompany.id);
        }
        renderBrandHomeEmpty();
        applyPreBrandProgressState(attachedCompany);
        scheduleOnboardingPoll(attachedCompany.id);
      }
    } catch (err) {
      setText(errEl, "Network error: " + err.message);
    } finally {
      submitBtn.disabled = false;
      setText(submitBtn, "Add brand");
    }
  });
}

function closeAddBrandOverlay() {
  const overlay = document.querySelector(".add-brand-overlay");
  if (overlay) overlay.remove();
}

function showOnboardingScreen(company, { animateContent = true } = {}) {
  let existing = document.querySelector("#onboarding-screen");
  if (existing) existing.remove();

  const screen = document.createElement("div");
  screen.id = "onboarding-screen";

  const content = document.createElement("div");
  content.className = "onboarding-content";
  if (animateContent) content.classList.add("onboarding-content-pending");

  const logoUrl = String(
    company.website_synthesis_business_logo_url || "",
  ).trim();
  const logoEl = logoUrl
    ? avatarFor(companyDisplayName(company), "onboarding-logo", logoUrl)
    : brandFavicon(company.website_url, 128, "onboarding-logo") ||
      avatarFor(companyDisplayName(company), "onboarding-logo", null);
  content.appendChild(logoEl);

  const nameEl = document.createElement("div");
  nameEl.className = "onboarding-name";
  setText(nameEl, companyDisplayName(company));
  content.appendChild(nameEl);

  const statusLine = meleaStatusLine(
    onboardingMessage(company) || "Starting...",
    {
      labelClass: "onboarding-status",
      showLogo: false,
    },
  );
  content.appendChild(statusLine);

  screen.appendChild(content);
  document.body.appendChild(screen);
  if (animateContent) {
    requestAnimationFrame(() => {
      content.classList.remove("onboarding-content-pending");
      content.classList.add("onboarding-content-in");
    });
  }
}

function updateOnboardingScreen(company) {
  const screen = document.querySelector("#onboarding-screen");
  if (!screen) return;

  const nameEl = screen.querySelector(".onboarding-name");
  if (nameEl) setText(nameEl, companyDisplayName(company));

  const statusEl = screen.querySelector(".onboarding-status");
  if (statusEl) {
    const msg = onboardingMessage(company) || "Finishing up...";
    if (statusEl.textContent !== msg) {
      statusEl.classList.remove("onboarding-status-swap");
      void statusEl.offsetWidth;
      setText(statusEl, msg);
      statusEl.classList.add("onboarding-status-swap");
    }
  }

  const logoUrl = String(
    company.website_synthesis_business_logo_url || "",
  ).trim();
  if (logoUrl) {
    const oldLogo = screen.querySelector(".onboarding-logo");
    if (oldLogo && !oldLogo.dataset.swapped) {
      const newLogo = avatarFor(
        companyDisplayName(company),
        "onboarding-logo",
        logoUrl,
      );
      newLogo.dataset.swapped = "1";
      oldLogo.replaceWith(newLogo);
    }
  }
}

function hideOnboardingScreen(callback) {
  const screen = document.querySelector("#onboarding-screen");
  if (!screen) {
    if (callback) callback();
    return;
  }
  screen.classList.add("onboarding-exit");
  setTimeout(() => {
    screen.remove();
    if (callback) callback();
  }, 420);
}

function scheduleOnboardingPoll(companyId) {
  if (addBrandPollTimer) clearInterval(addBrandPollTimer);
  const tick = async () => {
    const company = await pollCompany(companyId);
    if (!company) {
      clearInterval(addBrandPollTimer);
      addBrandPollTimer = null;
      return;
    }

    updatePreBrandOverlay(company);

    if (!shouldResumePreBrandOnboarding(company)) {
      clearInterval(addBrandPollTimer);
      addBrandPollTimer = null;
      completePreBrandTransition(companyId);
    }
  };
  void tick();
  addBrandPollTimer = setInterval(tick, 1200);
}

async function boot() {
  try {
    await bootstrapClerk();
    onClerkSignedIn(async () => {
      if (!(await checkAuth())) return;
      completeSignInPrompt(true);
      await presentCustomerBrandAfterBoot();
      if (typeof resumeAfterAuth === "function") await resumeAfterAuth();
      if (state.activeTab === "brand") setTab("stories");
    });
  } catch (err) {
    console.error("clerk bootstrap failed", err);
  }
  installSignInOverlayBehavior();
  await presentCustomerBrandAfterBoot();
  if ((await checkAuth()) && typeof resumeAfterAuth === "function") {
    await resumeAfterAuth();
  }
}

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    setTab(btn.dataset.tab);
  });
});

boot();
