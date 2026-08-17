/* Reaction Engine SPA — posts feed + on-demand reactions */

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  // clerk is the source of truth: attach the short-lived session token (if any)
  // on every request. /api/config is public and just gets no header.
  try {
    const token =
      typeof clerkToken === "function" ? await clerkToken() : null;
    if (token) headers["Authorization"] = "Bearer " + token;
  } catch (_) {}
  const opts = { credentials: "same-origin", ...options, headers };
  if (opts.body && typeof opts.body !== "string") {
    opts.body = JSON.stringify(opts.body);
  }
  const resp = await fetch((window.API_BASE || "") + path, opts);
  let body = null;
  try {
    body = await resp.json();
  } catch (_) {}
  return { ok: resp.ok, status: resp.status, body };
}

function setText(el, text) {
  el.textContent = text;
}

function section(title, bodyHtml, headerAction = null) {
  const sec = document.createElement("div");
  sec.className = "section";
  const h = document.createElement("div");
  h.className = "section-header";
  if (headerAction) {
    h.classList.add("section-header-flex");
    const titleEl = document.createElement("span");
    setText(titleEl, title);
    h.appendChild(titleEl);
    h.appendChild(headerAction);
  } else {
    setText(h, title);
  }
  const b = document.createElement("div");
  b.className = "section-body";
  if (bodyHtml) b.innerHTML = bodyHtml;
  sec.appendChild(h);
  sec.appendChild(b);
  return sec;
}

function autosizeReadonlyTextarea(el) {
  if (!el) return;
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight + 2}px`;
}

// FastAPI returns three different shapes under `detail`:
//   - a plain string (typical HTTPException(status, detail="..."))
//   - an object like {message, hint} (our structured errors)
//   - an array of validation errors (auto-422 from body-model failures)
// Without this helper, the array-of-objects case stringifies straight into
// the DOM as "[object Object]" because Array#toString comma-joins each
// element's own toString. Normalize every shape down to a single string so
// every error banner reads cleanly.
function apiErrorMessage(body, fallback) {
  const d = body && body.detail;
  if (d === undefined || d === null || d === "") return fallback;
  if (typeof d === "string") return d;
  if (Array.isArray(d)) {
    const msgs = d
      .map((item) => {
        if (typeof item === "string") return item;
        const m = (item && (item.msg || item.message)) || "";
        return m.replace(/^Value error,\s*/i, "");
      })
      .filter(Boolean);
    return msgs.join("; ") || fallback;
  }
  if (typeof d === "object") {
    return d.message || d.msg || d.error || fallback;
  }
  return String(d) || fallback;
}

// ============================================================
// modal + error helpers
// ============================================================
//
// every modal in the UI lives behind a `.modal-overlay` wrapper that owns the
// dim background, and a `.modal-box` child that owns the actual card. these
// helpers wire shared behavior (click-outside, ESC, tab loop, aria attrs) to
// any such overlay in one place. native `alert()` and `confirm()` are
// replaced with `showError()` (inline banner) and `confirmModal()` (themed
// modal). this keeps the surface consistent and avoids the OS chrome that
// felt off in maxfarago's PR #7 review.

const FOCUSABLE_SELECTOR =
  'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]';

function installModalBehavior(overlayEl, onClose) {
  const box = overlayEl.querySelector(".modal-box");
  if (!box) return () => {};

  function onOverlayClick(e) {
    if (e.target === overlayEl && typeof onClose === "function") onClose();
  }
  function onKeydown(e) {
    if (overlayEl.classList.contains("hidden")) return;
    if (e.key === "Escape" && typeof onClose === "function") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = Array.from(
      box.querySelectorAll(FOCUSABLE_SELECTOR),
    ).filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  overlayEl.addEventListener("click", onOverlayClick);
  document.addEventListener("keydown", onKeydown);
  return () => {
    overlayEl.removeEventListener("click", onOverlayClick);
    document.removeEventListener("keydown", onKeydown);
  };
}

// confirmModal({title, body, confirmLabel?, cancelLabel?, danger?})
//   -> Promise<boolean> resolved with true on confirm, false on cancel/dismiss.
// Used in place of window.confirm for destructive actions like delete brand,
// so the prompt is themed + dismissable like every other modal.
function confirmModal(opts) {
  const {
    title = "Are you sure?",
    body = "",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    danger = false,
  } = opts || {};
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");

    const box = document.createElement("div");
    box.className = "modal-box";

    const h2 = document.createElement("h2");
    setText(h2, title);
    box.appendChild(h2);

    if (body) {
      const p = document.createElement("p");
      p.style.color = "var(--text-dim)";
      p.style.fontSize = "14px";
      p.style.margin = "0 0 16px 0";
      setText(p, body);
      box.appendChild(p);
    }

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    if (danger) confirmBtn.className = "btn-danger";
    setText(confirmBtn, confirmLabel);

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn-secondary";
    setText(cancelBtn, cancelLabel);

    actions.appendChild(confirmBtn);
    actions.appendChild(cancelBtn);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const previouslyFocused = document.activeElement;
    let teardown = () => {};
    function close(result) {
      teardown();
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
      resolve(result);
    }
    teardown = installModalBehavior(overlay, () => close(false));
    confirmBtn.addEventListener("click", () => close(true));
    cancelBtn.addEventListener("click", () => close(false));
    setTimeout(() => confirmBtn.focus(), 0);
  });
}

// showError(containerOrId, message, opts?)
//   inline error banner inserted at the top of the panel that triggered it.
//   This replaces window.alert() so errors are read in context (e.g. inside
//   the relevant tab/section) and can be dismissed without leaving the page.
function showError(containerOrId, message, opts = {}) {
  const container =
    typeof containerOrId === "string"
      ? document.getElementById(containerOrId)
      : containerOrId;
  if (!container) {
    console.error("showError: container not found", containerOrId);
    return null;
  }
  const existing = container.querySelector(":scope > .error-banner");
  if (existing) existing.remove();

  const banner = document.createElement("div");
  banner.className = "error-banner";
  banner.setAttribute("role", "alert");

  const msg = document.createElement("span");
  msg.className = "error-banner-msg";
  setText(msg, message);
  banner.appendChild(msg);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "error-banner-close";
  close.setAttribute("aria-label", "Dismiss");
  setText(close, "\u2715");
  close.addEventListener("click", () => banner.remove());
  banner.appendChild(close);

  container.insertBefore(banner, container.firstChild);

  if (opts.autoDismissMs !== 0) {
    const ms = opts.autoDismissMs || 6000;
    setTimeout(() => {
      if (banner.parentNode) banner.remove();
    }, ms);
  }
  return banner;
}

function clearErrors(containerOrId) {
  const container =
    typeof containerOrId === "string"
      ? document.getElementById(containerOrId)
      : containerOrId;
  if (!container) return;
  container
    .querySelectorAll(":scope > .error-banner")
    .forEach((el) => el.remove());
}

// showFlash(message)
//   non-blocking confirmation toast — bottom-right of the viewport, ~3s.
//   Used for "Saved", "Main feed: on", etc. so the operator doesn't need
//   to hunt for visual confirmation of a successful PATCH/PUT.
function showFlash(message, opts = {}) {
  let host = document.getElementById("flash-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "flash-host";
    Object.assign(host.style, {
      position: "fixed",
      right: "24px",
      bottom: "24px",
      display: "flex",
      flexDirection: "column",
      gap: "8px",
      zIndex: "9999",
      pointerEvents: "none",
    });
    document.body.appendChild(host);
  }
  const card = document.createElement("div");
  Object.assign(card.style, {
    background: "var(--panel, #1f232c)",
    color: "var(--text, #e7e9ee)",
    border: "1px solid var(--border, #2a2f3a)",
    padding: "10px 14px",
    fontSize: "13px",
    boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
    pointerEvents: "auto",
  });
  setText(card, message);
  host.appendChild(card);
  setTimeout(() => {
    if (card.parentNode) card.remove();
  }, opts.ms || 3000);
}

function relativeTime(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n)) return "";
  const sec = Math.floor(Date.now() / 1000 - n);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// Prefer the tweet's original post time; fall back to when we ingested it.
function postTimestampSeconds(post) {
  const p = post && post.posted_at;
  if (p !== null && p !== undefined && p !== "") {
    if (typeof p === "number" && p > 1_000_000_000) return p;
    const ms = Date.parse(p);
    if (!Number.isNaN(ms)) return ms / 1000;
  }
  if (post && post.ingested_at != null) return post.ingested_at;
  return null;
}

function formatRunTimestamp(ts) {
  const d = new Date((ts || 0) * 1000);
  if (Number.isNaN(d.getTime()))
    return { date: "Unknown date", time: "Unknown time" };
  return {
    date: d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }),
    time: d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}

function formatFollowers(n) {
  if (!n) return null;
  if (n >= 1_000_000)
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

// Used by master's trending feature; returns "0" for missing, never null.
function formatCompactCount(n) {
  if (n == null) return "0";
  const value = Number(n);
  if (!Number.isFinite(value)) return "0";
  if (value >= 1_000_000)
    return (value / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (value >= 1_000)
    return (value / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.trunc(value));
}

function highResTwitterImageUrl(url) {
  return String(url || "")
    .trim()
    .replace(/_normal(\.[a-zA-Z0-9]+)$/i, "$1");
}

// #49: compact count formatter that preserves 0 as "0" instead of "" so the
// engagement strip stays visually consistent when a freshly-published tweet
// has zero of everything. Returns null when the count is missing entirely
// ============================================================
// formatting + dom helpers
// ============================================================

// — distinct from `formatCompactCount` because the engagement strip uses
// null to decide whether to render at all.
function formatCount(n) {
  if (n === null || n === undefined) return null;
  if (n === 0) return "0";
  if (n >= 1_000_000)
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function formatPostedAt(epochSeconds) {
  if (!epochSeconds) return null;
  try {
    const d = new Date(epochSeconds * 1000);
    return d.toLocaleString();
  } catch (err) {
    return null;
  }
}

// Per #49: a single horizontal "♥ 1.2k · ↻ 312 · ↩ 89 · ◉ 45k" strip used
// both on sidebar rows and at the top of the tweet detail. Returns null
// when none of the engagement fields are populated so callers can skip
// appending.
const ENGAGEMENT_FIELDS = [
  { key: "like_count", glyph: "\u2665", label: "likes" },
  { key: "retweet_count", glyph: "\u21BB", label: "retweets" },
  { key: "reply_count", glyph: "\u21A9", label: "replies" },
  { key: "quote_count", glyph: "\u275D", label: "quotes" },
  { key: "view_count", glyph: "\u25C9", label: "views" },
  { key: "bookmark_count", glyph: "\u2606", label: "bookmarks" },
];

function buildEngagementRow(post) {
  const present = ENGAGEMENT_FIELDS.filter(
    (f) => post[f.key] !== null && post[f.key] !== undefined,
  );
  if (present.length === 0) return null;
  const row = document.createElement("div");
  row.className = "job-meta engagement-row";
  present.forEach((field, idx) => {
    if (idx > 0) {
      const sep = document.createElement("span");
      sep.className = "engagement-sep";
      setText(sep, " · ");
      row.appendChild(sep);
    }
    const item = document.createElement("span");
    item.className = "engagement-item";
    item.title = `${formatCount(post[field.key])} ${field.label}`;
    const glyph = document.createElement("span");
    glyph.className = "engagement-glyph";
    setText(glyph, field.glyph);
    item.appendChild(glyph);
    item.appendChild(
      document.createTextNode(" " + formatCount(post[field.key])),
    );
    row.appendChild(item);
  });
  return row;
}

function buildTweetContextSection(post) {
  const rows = [];
  const postedAt = formatPostedAt(post.posted_at);
  if (postedAt) rows.push(["Posted", postedAt]);
  if (post.lang) rows.push(["Language", String(post.lang).toUpperCase()]);
  if (post.in_reply_to_screen_name) {
    rows.push([
      "In reply to",
      "@" + String(post.in_reply_to_screen_name).replace(/^@/, ""),
    ]);
  }
  if (post.conversation_id && post.conversation_id !== post.tweet_id) {
    rows.push(["Conversation root", post.conversation_id]);
  }
  if (rows.length === 0) return null;
  const sec = section("Context", "");
  const body = sec.querySelector(".section-body");
  const dl = document.createElement("dl");
  dl.className = "fact-list";
  rows.forEach(([k, v]) => {
    const dt = document.createElement("dt");
    setText(dt, k);
    const dd = document.createElement("dd");
    setText(dd, v);
    dl.appendChild(dt);
    dl.appendChild(dd);
  });
  body.appendChild(dl);
  return sec;
}

function buildEntitiesSection(post) {
  const hashtags = post.hashtags || [];
  const mentions = post.mentions || [];
  const urls = post.urls || [];
  const cashtags = post.cashtags || [];
  if (
    !hashtags.length &&
    !mentions.length &&
    !urls.length &&
    !cashtags.length
  ) {
    return null;
  }
  const sec = section("Entities", "");
  const body = sec.querySelector(".section-body");

  if (hashtags.length) {
    appendLabeledChips(
      body,
      "Hashtags",
      hashtags.map((h) => "#" + h.replace(/^#/, "")),
    );
  }
  if (cashtags.length) {
    appendLabeledChips(
      body,
      "Cashtags",
      cashtags.map((c) => "$" + c.replace(/^\$/, "")),
    );
  }
  if (mentions.length) {
    const labels = mentions
      .map((m) =>
        m && m.screen_name ? "@" + m.screen_name.replace(/^@/, "") : null,
      )
      .filter(Boolean);
    if (labels.length) appendLabeledChips(body, "Mentions", labels);
  }
  if (urls.length) {
    const urlsRow = document.createElement("div");
    urlsRow.className = "fact-row";
    const label = document.createElement("div");
    label.className = "fact-label";
    setText(label, "Links");
    const list = document.createElement("ul");
    list.className = "url-list";
    urls.forEach((u) => {
      if (!u || !(u.url || u.expanded_url)) return;
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = u.expanded_url || u.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      setText(a, u.display_url || u.expanded_url || u.url);
      li.appendChild(a);
      list.appendChild(li);
    });
    urlsRow.appendChild(label);
    urlsRow.appendChild(list);
    body.appendChild(urlsRow);
  }
  return sec;
}

function buildAuthorExtrasSection(post) {
  const interesting = [
    post.author_verified,
    post.author_blue_verified,
    post.author_following_count,
    post.author_tweet_count,
    post.author_listed_count,
    post.author_bio,
    post.author_location,
    post.author_url,
    post.author_created_at,
  ];
  if (interesting.every((v) => v === null || v === undefined || v === ""))
    return null;
  const sec = section("Author", "");
  const body = sec.querySelector(".section-body");

  const badges = document.createElement("div");
  badges.className = "chip-row";
  if (post.author_verified) {
    const b = document.createElement("span");
    b.className = "chip chip-core";
    b.title = "Legacy verified account";
    setText(b, "Verified");
    badges.appendChild(b);
  }
  if (post.author_blue_verified) {
    const b = document.createElement("span");
    b.className = "chip chip-core";
    b.title = "X Premium / Blue subscriber";
    setText(b, "Blue");
    badges.appendChild(b);
  }
  if (badges.children.length) body.appendChild(badges);

  const dl = document.createElement("dl");
  dl.className = "fact-list";
  const addRow = (label, value) => {
    if (value === null || value === undefined || value === "") return;
    const dt = document.createElement("dt");
    setText(dt, label);
    const dd = document.createElement("dd");
    setText(dd, value);
    dl.appendChild(dt);
    dl.appendChild(dd);
  };
  addRow("Following", formatCount(post.author_following_count));
  addRow("Tweets", formatCount(post.author_tweet_count));
  addRow("Listed", formatCount(post.author_listed_count));
  if (post.author_location) addRow("Location", post.author_location);
  if (post.author_url) {
    const dt = document.createElement("dt");
    setText(dt, "Link");
    const dd = document.createElement("dd");
    const a = document.createElement("a");
    a.href = post.author_url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    setText(a, post.author_url);
    dd.appendChild(a);
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
  if (post.author_created_at) addRow("Joined", post.author_created_at);
  if (dl.children.length) body.appendChild(dl);

  if (post.author_bio) {
    const bio = document.createElement("p");
    bio.className = "author-bio";
    setText(bio, post.author_bio);
    body.appendChild(bio);
  }
  return sec;
}

function looksLikeWebsite(value) {
  const v = value.trim();
  if (!v) return false;
  const host = v.replace(/^https?:\/\//i, "").split("/")[0];
  return /\./.test(host) && host.length >= 3;
}

function truncateText(value, max = 80) {
  const text = (value || "").trim().replace(/\s+/g, " ");
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

function tweetUrl(tweetId) {
  return tweetId ? `https://twitter.com/i/web/status/${tweetId}` : "";
}

function websiteDomain(value) {
  const raw = (value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, "");
  } catch (_) {
    return raw
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .replace(/^www\./, "");
  }
}

function initials(value) {
  const clean = (value || "").replace(/^@/, "").trim();
  return (clean[0] || "?").toUpperCase();
}

function colorFromString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) % 360;
  }
  return `hsl(${hash}, 42%, 32%)`;
}

function avatarFor(value, sizeClass = "", imageUrl = null) {
  if (imageUrl) {
    const img = document.createElement("img");
    img.className =
      "tweet-avatar tweet-avatar-img" + (sizeClass ? " " + sizeClass : "");
    img.src = imageUrl;
    img.alt = value || "";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => {
      const fallback = avatarFor(value, sizeClass, null);
      img.replaceWith(fallback);
    };
    return img;
  }
  const avatar = document.createElement("div");
  avatar.className = "tweet-avatar" + (sizeClass ? " " + sizeClass : "");
  avatar.style.background = colorFromString(value || "?");
  setText(avatar, initials(value));
  return avatar;
}

// Brand-sidebar / generate-run favicon. Lost from master during the
// company-owned-twitter merge — restored verbatim so brand rows render
// the familiar logo + initials fallback.
function sidebarCompanyLogo(websiteUrl, fallbackValue) {
  const host = websiteDomain(websiteUrl || "");
  if (!host) return avatarFor(fallbackValue || "?", "job-company-logo");
  const img = document.createElement("img");
  img.className = "job-company-logo";
  img.alt = "";
  img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  img.referrerPolicy = "no-referrer";
  img.onerror = () => {
    const fallback = avatarFor(host, "job-company-logo");
    img.replaceWith(fallback);
  };
  return img;
}

function tweetTypeLabel(type) {
  if (type === "repost") return "↻ Repost";
  if (type === "quote") return "Quote";
  if (type === "reply") return "Replying to";
  return "";
}

const VIDEO_MEDIA_RE = /(video\.twimg\.com|\.mp4|\.webm|\.m3u8|\.ts)/;

function imageMediaUrls(urls) {
  return (urls || []).filter((u) => !VIDEO_MEDIA_RE.test(u));
}

function appendMediaGrid(parent, urls) {
  if (urls.length === 0) return;
  const grid = document.createElement("div");
  grid.className = "media-grid";
  urls.forEach((url) => {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    a.appendChild(img);
    grid.appendChild(a);
  });
  parent.appendChild(grid);
}

function topicChip(text) {
  const s = document.createElement("span");
  s.className = "topic-chip";
  setText(s, text);
  return s;
}

function sentimentPill(value) {
  const sentiment = (value || "neutral").toLowerCase();
  const pill = document.createElement("span");
  pill.className = "sentiment-pill " + sentiment;
  setText(pill, sentiment);
  return pill;
}

function renderPostDetail(data, rootEl) {
  const post = data.post;
  const root = rootEl || $("detail");
  root.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "detail-inner";

  let tweetHeaderLink = null;
  if (post.tweet_id) {
    tweetHeaderLink = document.createElement("a");
    tweetHeaderLink.className = "section-header-link";
    tweetHeaderLink.href = tweetUrl(post.tweet_id);
    tweetHeaderLink.target = "_blank";
    tweetHeaderLink.rel = "noopener noreferrer";
    tweetHeaderLink.ariaLabel = "Open tweet";
    tweetHeaderLink.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  }
  const tweetSec = section("Tweet", "", tweetHeaderLink);
  const tweetBody = tweetSec.querySelector(".section-body");

  const tweetCard = document.createElement("div");
  tweetCard.className = "tweet-card";

  if (post.tweet_type && post.tweet_type !== "tweet") {
    const type = document.createElement("div");
    type.className = "tweet-type-line " + post.tweet_type;
    setText(type, tweetTypeLabel(post.tweet_type));
    tweetCard.appendChild(type);
  }

  const tweetMain = document.createElement("div");
  tweetMain.className = "tweet-card-main";
  tweetMain.appendChild(
    avatarFor(
      post.author_handle || post.author_name || "?",
      "",
      post.author_avatar || null,
    ),
  );

  const tweetContent = document.createElement("div");
  tweetContent.className = "tweet-card-content";

  const header = document.createElement("div");
  header.className = "tweet-card-header";
  const identity = document.createElement("div");
  identity.className = "tweet-identity";

  const display = document.createElement("span");
  display.className = "tweet-display-name";
  setText(display, post.author_name || post.author_handle || "@unknown");
  identity.appendChild(display);

  const meta = document.createElement("span");
  meta.className = "tweet-meta";
  const fol = formatFollowers(post.author_followers);
  const ts = postTimestampSeconds(post);
  const timeStr = ts ? relativeTime(ts) : "";
  setText(
    meta,
    (post.author_handle || "@unknown") +
      (fol ? " · " + fol + " followers" : "") +
      (timeStr ? " · " + timeStr : ""),
  );
  identity.appendChild(meta);
  header.appendChild(identity);
  tweetContent.appendChild(header);

  let quotedBlock = null;
  if (post.quoted_text || (post.quoted_media_urls || []).length > 0) {
    quotedBlock = document.createElement("div");
    quotedBlock.className = "quoted-block";
    if (
      post.quoted_author_handle ||
      post.quoted_author_name ||
      post.quoted_author_avatar
    ) {
      const qh = document.createElement("div");
      qh.className = "quoted-header";
      qh.appendChild(
        avatarFor(
          post.quoted_author_handle || post.quoted_author_name || "?",
          "quoted-avatar",
          post.quoted_author_avatar || null,
        ),
      );
      const qa = document.createElement("div");
      qa.className = "quoted-author";
      setText(
        qa,
        (post.quoted_author_handle || "@unknown") +
          (post.quoted_author_name ? " · " + post.quoted_author_name : ""),
      );
      qh.appendChild(qa);
      quotedBlock.appendChild(qh);
    }
    if (post.quoted_text) {
      const qt = document.createElement("div");
      qt.className = "quoted-text";
      setText(qt, post.quoted_text);
      quotedBlock.appendChild(qt);
    }
    appendMediaGrid(quotedBlock, imageMediaUrls(post.quoted_media_urls));
  }

  if (quotedBlock && post.tweet_type !== "quote") {
    tweetContent.appendChild(quotedBlock);
  }

  const text = document.createElement("div");
  text.className = "tweet-body-text";
  setText(text, post.tweet_text || "");
  tweetContent.appendChild(text);

  appendMediaGrid(tweetContent, imageMediaUrls(post.media_urls));

  if (quotedBlock && post.tweet_type === "quote") {
    tweetContent.appendChild(quotedBlock);
  }

  tweetMain.appendChild(tweetContent);
  tweetCard.appendChild(tweetMain);
  tweetBody.appendChild(tweetCard);

  const detailEngagement = buildEngagementRow(post);
  if (detailEngagement) {
    detailEngagement.classList.add("engagement-row-detail");
    tweetBody.appendChild(detailEngagement);
  }
  inner.appendChild(tweetSec);

  const contextSec = buildTweetContextSection(post);
  if (contextSec) inner.appendChild(contextSec);

  const entitiesSec = buildEntitiesSection(post);
  if (entitiesSec) inner.appendChild(entitiesSec);

  const authorSec = buildAuthorExtrasSection(post);
  if (authorSec) inner.appendChild(authorSec);

  const sumSec = section("Summary", "");
  const sumBody = sumSec.querySelector(".section-body");
  const sumLayout = document.createElement("div");
  sumLayout.className = "summary-layout";

  const sumProse = document.createElement("div");
  sumProse.className = "summary-prose";
  const sumText = document.createElement("div");
  sumText.className = "brand-prose";
  setText(sumText, post.summary_text || "—");
  sumProse.appendChild(sumText);
  sumLayout.appendChild(sumProse);

  const hasMeta =
    post.summary_sentiment ||
    (post.summary_topics && post.summary_topics.length);
  if (hasMeta) {
    const sumMeta = document.createElement("div");
    sumMeta.className = "summary-metadata";

    if (post.summary_sentiment) {
      const field = document.createElement("div");
      field.className = "meta-field";
      const lbl = document.createElement("div");
      lbl.className = "meta-field-label";
      setText(lbl, "Sentiment");
      field.appendChild(lbl);
      field.appendChild(sentimentPill(post.summary_sentiment));
      sumMeta.appendChild(field);
    }

    if (post.summary_topics && post.summary_topics.length) {
      const field = document.createElement("div");
      field.className = "meta-field";
      const lbl = document.createElement("div");
      lbl.className = "meta-field-label";
      setText(lbl, "Topics");
      field.appendChild(lbl);
      const chips = document.createElement("div");
      chips.className = "topic-chip-row";
      post.summary_topics.forEach((t) => chips.appendChild(topicChip(t)));
      field.appendChild(chips);
      sumMeta.appendChild(field);
    }

    sumLayout.appendChild(sumMeta);
  }

  sumBody.appendChild(sumLayout);
  inner.appendChild(sumSec);

  root.appendChild(inner);
}

const MELEA_STATUS_LOGO = "/static/assets/images/melea-charmark-pulse.svg";
const MELEA_STATUS_LOGO_STATIC = "/static/assets/images/melea-charmark-blue.svg";

function meleaStatusLogoSrc() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? MELEA_STATUS_LOGO_STATIC
    : MELEA_STATUS_LOGO;
}

function meleaStatusLine(
  text,
  { datasetKey = null, ariaBusy = false, labelClass = "", showLogo = true } = {},
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

