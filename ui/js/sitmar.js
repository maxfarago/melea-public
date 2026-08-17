// ===== sitmar (situational marketing) =====

let sitmarModalStories = [];
let contentHistorySections = { active: [], draft: [], inactive: [] };
let contentHistoryArchivedCount = 0;
let contentDesktopStorySortMode = "recency";
let contentDesktopSelectedCampaignId = "";
let contentDesktopDetailCampaign = null;
let contentDesktopBody = null;
let contentDesktopCompaniesLoad = null;
let contentDesktopCompaniesLoadAttempted = false;
const contentStoryCampaignStartInFlight = new Set();
const contentSeedBannerSignatures = new Map();
const contentHistorySectionCollapsed = new Set();

function syncContentHistoryFromResponse(body) {
  const sections = body?.sections || {};
  contentHistorySections = {
    active: Array.isArray(sections.active) ? sections.active.slice() : [],
    draft: Array.isArray(sections.draft) ? sections.draft.slice() : [],
    inactive: Array.isArray(sections.inactive) ? sections.inactive.slice() : [],
  };
  contentHistoryArchivedCount = Number(body?.archived_count) || 0;
}

function filteredContentHistorySections() {
  const company = currentContentDesktopBrand();
  const keep = company
    ? (campaign) => campaign.company_id === company.id
    : () => true;
  return {
    active: contentHistorySections.active.filter(keep),
    draft: contentHistorySections.draft.filter(keep),
    inactive: contentHistorySections.inactive.filter(keep),
  };
}

function contentHistoryCountForCompany(companyId) {
  const id = String(companyId || "").trim();
  if (!id) return 0;
  const keep = (campaign) => campaign.company_id === id;
  return (
    contentHistorySections.active.filter(keep).length +
    contentHistorySections.draft.filter(keep).length +
    contentHistorySections.inactive.filter(keep).length
  );
}

const CONTENT_STUDIO_HISTORY_LOCKED_TITLE =
  "History unlocks after your first campaign";

function applyContentStudioHistoryButtonState(btn, companyId) {
  if (!btn) return;
  const available = contentHistoryCountForCompany(companyId) > 0;
  btn.disabled = !available;
  btn.classList.toggle("is-disabled", !available);
  btn.setAttribute("aria-disabled", available ? "false" : "true");
  if (available) btn.removeAttribute("title");
  else btn.title = CONTENT_STUDIO_HISTORY_LOCKED_TITLE;
}

function refreshContentStudioHistoryToggle(companyId) {
  const id =
    String(companyId || "").trim() ||
    String(contentDesktopBrandId || selectedBrandId || "").trim();
  document
    .querySelectorAll('.content-tab-btn[data-mode="content"]')
    .forEach((btn) => applyContentStudioHistoryButtonState(btn, id));
  if (contentHistoryCountForCompany(id) > 0) return;
  if (dashboardRightMode === "content") {
    dashboardRightMode = "chat";
    const company = companies.find((c) => c.id === id);
    const col = document.querySelector(".brand-home-content-col");
    if (col && company) swapContentColBody(col, company);
  }
}

function mountedContentDesktopBody() {
  if (contentDesktopBody && contentDesktopBody.isConnected) {
    return contentDesktopBody;
  }
  contentDesktopBody = null;
  return null;
}

function updateContentDesktopCardSelection() {
  const body = mountedContentDesktopBody();
  if (!body) return;
  body.querySelectorAll(".content-campaign-card").forEach((card) => {
    card.classList.toggle(
      "is-selected",
      String(card.dataset.campaignId || "") ===
        contentDesktopSelectedCampaignId,
    );
  });
}

function renderContentCol1Only() {
  const body = mountedContentDesktopBody();
  if (!body) return false;
  const nextCol1 = buildContentCol1();
  const existingCol1 = body.querySelector(".content-col-content");
  if (existingCol1) {
    existingCol1.replaceWith(nextCol1);
  } else {
    body.insertBefore(nextCol1, body.firstChild);
  }
  return true;
}

function renderContentCol2Only(loading = false) {
  const body = mountedContentDesktopBody();
  if (!body) return false;
  if (contentDesktopSelectedCampaignId) return false;
  const nextCol2 = buildContentCol2(loading);
  const existingCol2 = body.querySelector(".content-col-stories");
  if (existingCol2) {
    existingCol2.replaceWith(nextCol2);
  } else if (body.children.length > 1) {
    body.lastChild.replaceWith(nextCol2);
  } else {
    body.appendChild(nextCol2);
  }
  return true;
}

function renderContentRightSide(loading = false) {
  const body = mountedContentDesktopBody();
  if (!body) return false;
  const hasSelection = !!contentDesktopSelectedCampaignId;
  body.classList.toggle("has-detail", hasSelection);
  const nextRight = hasSelection
    ? buildContentDetailPane()
    : buildContentCol2(loading);
  if (body.children.length > 1) {
    body.lastChild.replaceWith(nextRight);
  } else {
    body.appendChild(nextRight);
  }
  return true;
}

function sitmarLogo(campaign) {
  const url = (campaign && campaign.brand_logo_url) || "";
  const fallbackText = (campaign && campaign.brand_name) || "?";
  if (!url) return avatarFor(fallbackText, "job-company-logo");
  const img = document.createElement("img");
  img.className = "job-company-logo";
  img.src = url;
  img.referrerPolicy = "no-referrer";
  img.onerror = () =>
    img.replaceWith(avatarFor(fallbackText, "job-company-logo"));
  return img;
}

function isSitmarPending(c) {
  return c && (c.status === "thinking" || c.status === "drafting");
}

const sitmarDetailInFlight = new Map();

async function loadSitmar() {
  try {
    const { ok, status, body } = await api("/api/sitmar", { method: "GET" });
    if (status === 401) return;
    if (!ok)
      return renderError(apiErrorMessage(body, "Failed to load campaigns."));
    syncContentHistoryFromResponse(body);
    sitmarCampaigns = body.campaigns || [];
    pendingSitmarJobs = new Set(
      sitmarCampaigns.filter(isSitmarPending).map((c) => c.id),
    );
    refreshContentStudioHistoryToggle();
  } catch (err) {
    renderError("Network error: " + err.message);
  }
}

function renderSitmarSidebarItem(campaign) {
  const btn = document.createElement("div");
  btn.setAttribute("role", "button");
  btn.tabIndex = 0;
  btn.className = "job-item audience-sidebar-item";
  const active = campaign.id === selectedSitmarId;
  if (active) btn.classList.add("active");

  btn.appendChild(sitmarLogo(campaign));

  const body = document.createElement("div");
  body.className = "job-item-body";
  const title = document.createElement("div");
  title.className = "job-domain-wrap";
  setText(title, campaign.title || "Untitled campaign");
  body.appendChild(title);
  btn.appendChild(body);

  if (isSitmarPending(campaign)) {
    const dot = document.createElement("span");
    dot.className = "job-verdict running";
    btn.appendChild(dot);
  } else if (active) {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "audience-sidebar-delete-btn";
    deleteBtn.title = "Delete campaign";
    deleteBtn.setAttribute("aria-label", "Delete campaign");
    deleteBtn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>';
    deleteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteSitmar(campaign);
    });
    btn.appendChild(deleteBtn);
  }

  btn.addEventListener("click", () => selectSitmar(campaign.id));
  btn.addEventListener("keydown", (e) => {
    if (e.target !== btn) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    selectSitmar(campaign.id);
  });
  return btn;
}

function renderSitmarSidebar() {
  const list = $("sidebar-list");
  list.innerHTML = "";
  if (!sitmarCampaigns.length) {
    const empty = document.createElement("div");
    empty.className = "sidebar-empty";
    setText(empty, "No campaigns yet.");
    list.appendChild(empty);
    return;
  }
  sitmarCampaigns.forEach((c) => list.appendChild(renderSitmarSidebarItem(c)));
}

async function selectSitmar(campaignId) {
  const cached = findSitmarCampaignById(campaignId);
  if (cached && isCampaignLockedByPaywall(cached)) {
    openUpgradeModal();
    return;
  }
  if (currentView === "sitmar") {
    contentDesktopSelectedCampaignId = campaignId;
    contentDesktopDetailCampaign = null;
    renderContentDesktopView();
    await fetchContentCampaignDetail(campaignId);
    return;
  }
  selectedSitmarId = campaignId;
  renderSitmarSidebar();
  try {
    const { ok, status, body } = await api(
      `/api/sitmar/${encodeURIComponent(campaignId)}`,
      { method: "GET" },
    );
    if (status === 401) return;
    if (handleUpgradeRequired(status)) return;
    if (!ok || !body || !body.campaign)
      return renderError(apiErrorMessage(body, "Failed to load campaign."));
    renderSitmarDetail(body.campaign);
    if (isSitmarPending(body.campaign)) {
      pendingSitmarJobs.add(campaignId);
      scheduleSitmarPolling(1500);
    }
  } catch (err) {
    renderError("Network error: " + err.message);
  }
}

const SITMAR_EXPAND_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';

let sitmarOpenPopover = null;
function closeSitmarPopover() {
  if (sitmarOpenPopover) {
    sitmarOpenPopover.remove();
    sitmarOpenPopover = null;
  }
}

let brandCustomerOpenPopover = null;
function closeBrandCustomerPopover() {
  if (brandCustomerOpenPopover) {
    brandCustomerOpenPopover.remove();
    brandCustomerOpenPopover = null;
  }
}

// collapsed-by-default header column: buildHead renders the always-visible first
// element; buildRest (optional) fills an expandable popover toggled by an icon.
function sitmarCol(label, buildHead, buildRest) {
  const col = document.createElement("div");
  col.className = "sitmar-col";
  // collapsed head lives in a clipped inner wrapper so the fixed-height column
  // hides overflow WITHOUT clipping the absolutely-positioned popover (which is
  // a direct child of the col, outside the clipped content box).
  const content = document.createElement("div");
  content.className = "sitmar-col-content";
  const l = document.createElement("div");
  l.className = "sitmar-col-label";
  const text = document.createElement("span");
  setText(text, label);
  l.appendChild(text);
  content.appendChild(l);
  buildHead(content);
  col.appendChild(content);
  if (buildRest) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sitmar-col-expand";
    btn.title = "Expand";
    btn.setAttribute("aria-label", "Expand " + label);
    btn.innerHTML = SITMAR_EXPAND_ICON;
    l.appendChild(btn);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wasOpen =
        sitmarOpenPopover && sitmarOpenPopover.dataset.col === label;
      closeSitmarPopover();
      if (wasOpen) return;
      const pop = document.createElement("div");
      pop.className = "sitmar-col-popover";
      pop.dataset.col = label;
      buildRest(pop);
      col.appendChild(pop);
      sitmarOpenPopover = pop;
    });
  }
  return col;
}
document.addEventListener("click", (e) => {
  if (!sitmarOpenPopover) return;
  if (
    e.target.closest(".sitmar-col-popover") ||
    e.target.closest(".sitmar-col-expand")
  )
    return;
  closeSitmarPopover();
});
document.addEventListener("click", (e) => {
  if (!brandCustomerOpenPopover) return;
  if (e.target.closest(".customer-mobile-inspector-panel")) return;
  if (e.target === brandCustomerOpenPopover) closeBrandCustomerPopover();
});

// the campaign currently rendered in the detail pane; lets the chat input/seed
// handlers optimistically mutate + re-render without an extra fetch.
let sitmarDetailCampaign = null;

function sitmarContextCols(campaign) {
  const wrap = document.createElement("div");
  wrap.className = "sitmar-context-cols";
  const ba = campaign.brand_audience || {};

  wrap.appendChild(
    sitmarCol(
      "Brand",
      (c) => {
        const row = document.createElement("div");
        row.className = "sitmar-brand-head";
        const logo = sitmarLogo(campaign);
        logo.style.cssText =
          "width:22px;height:22px;border-radius:4px;flex:0 0 auto";
        row.appendChild(logo);
        const name = document.createElement("span");
        name.className = "sitmar-brand-name";
        setText(name, campaign.brand_name || "");
        row.appendChild(name);
        c.appendChild(row);
      },
      campaign.brand_synthesis
        ? (pop) => {
            const t = document.createElement("p");
            t.className = "sitmar-body-text";
            setText(t, campaign.brand_synthesis);
            pop.appendChild(t);
          }
        : null,
    ),
  );

  wrap.appendChild(
    sitmarCol(
      "Audience",
      (c) => {
        const t = document.createElement("div");
        t.className = "sitmar-body-text";
        setText(t, ba.title || "—");
        c.appendChild(t);
      },
      ba.description
        ? (pop) => {
            const t = document.createElement("p");
            t.className = "sitmar-body-text";
            setText(t, ba.description);
            pop.appendChild(t);
          }
        : null,
    ),
  );

  wrap.appendChild(
    sitmarCol(
      "Story",
      (c) => {
        const t = document.createElement("div");
        t.className = "sitmar-body-text";
        setText(t, campaign.story_title || "—");
        c.appendChild(t);
      },
      campaign.story_summary
        ? (pop) => {
            const t = document.createElement("p");
            t.className = "sitmar-body-text";
            setText(t, campaign.story_summary);
            pop.appendChild(t);
          }
        : null,
    ),
  );

  return wrap;
}

function sitmarLatestSeeds(campaign) {
  const messages = (campaign && campaign.messages) || [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = messages[i];
    if (t && t.role === "assistant" && Array.isArray(t.seeds)) return t.seeds;
  }
  return [];
}

function sitmarHeaderRow(campaign) {
  const copy = contentCampaignCopy(campaign);
  const headRow = document.createElement("div");
  headRow.className = "sitmar-header-row";
  const stack = document.createElement("div");
  stack.className = "sitmar-header-copy";
  const title = document.createElement("div");
  title.className = "sitmar-header-title";
  setText(title, copy.title);
  stack.appendChild(title);
  if (copy.blurb) {
    const blurb = document.createElement("div");
    blurb.className = "sitmar-header-blurb";
    setText(blurb, copy.blurb);
    stack.appendChild(blurb);
  }
  headRow.appendChild(stack);
  return headRow;
}

function contentSelectedSeedBanner(campaign) {
  const seed = campaign.selected_seed || {};
  if (!seed.title) return null;

  const banner = document.createElement("div");
  banner.className = "content-seed-banner";
  banner.dataset.seedBanner = "1";
  const signature = `${seed.title}\n${seed.blurb || ""}`;
  const campaignId = String(campaign.id || "");
  const previousSignature = contentSeedBannerSignatures.get(campaignId);
  if (previousSignature && previousSignature !== signature) {
    banner.classList.add("content-seed-banner-updated");
  }
  if (campaignId) contentSeedBannerSignatures.set(campaignId, signature);

  const title = document.createElement("div");
  title.className = "content-seed-banner-title";
  setText(title, seed.title);
  banner.appendChild(title);
  if (seed.blurb) {
    const blurb = document.createElement("div");
    blurb.className = "content-seed-banner-blurb";
    setText(blurb, seed.blurb);
    banner.appendChild(blurb);
  }
  return banner;
}

function sitmarBubble(role, text) {
  const b = document.createElement("div");
  b.className = "sitmar-bubble sitmar-bubble-" + role;
  setText(b, text || "");
  return b;
}

function buildStoryContextBubble(turn) {
  const bubble = document.createElement("div");
  bubble.className = "sitmar-bubble sitmar-bubble-user sitmar-story-context";

  const card = document.createElement("div");
  card.className = "sitmar-story-context-card";

  const headline = document.createElement("div");
  headline.className = "sitmar-story-context-headline";
  setText(headline, turn.headline || "Story");
  card.appendChild(headline);

  const stats = document.createElement("div");
  stats.className = "sitmar-story-context-stats";

  const strength = storyUrgency(turn.last_seen_at);
  const strengthEl = document.createElement("span");
  strengthEl.className = `sc-strength sc-strength-${strength.tone}`;
  strengthEl.appendChild(buildUrgencyDot(strength));
  const strengthLabel = document.createElement("span");
  setText(strengthLabel, strength.label);
  strengthEl.appendChild(strengthLabel);
  stats.appendChild(strengthEl);

  const postCount = document.createElement("span");
  postCount.className = "sitmar-story-context-stat";
  const postB = document.createElement("b");
  setText(postB, formatCompactCount(turn.post_count));
  postCount.appendChild(postB);
  postCount.appendChild(document.createTextNode(" posts"));
  stats.appendChild(postCount);

  const ageLabel = customerStoryAgeLabel(turn.last_seen_at);
  if (ageLabel) {
    const age = document.createElement("span");
    age.className = "sitmar-story-context-stat";
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

function sitmarIdeatingIndicator() {
  return meleaStatusLine("Ideating...", { ariaBusy: true });
}

function shouldShowSitmarIdeating(campaign) {
  if (String(campaign?.status || "").toLowerCase() !== "thinking") return false;
  const messages = Array.isArray(campaign?.messages) ? campaign.messages : [];
  const last = messages[messages.length - 1];
  if (!last || last.role !== "assistant") return true;
  if (Array.isArray(last.seeds) && last.seeds.length) return false;
  if (Array.isArray(last.vibes) && last.vibes.length) return false;
  return true;
}

function sitmarChatProgressLine(
  text,
  { datasetKey = "sitmarInlinePosts" } = {},
) {
  return meleaStatusLine(text, { datasetKey });
}

const SITMAR_REGENERATE_LABEL = "Generate new directions";
const sitmarSeedRegenInFlight = new Set();
const sitmarDistributeStoryCache = new Map();
const sitmarDistributeStoryInFlight = new Set();
const sitmarDistributeReplyInFlight = new Set();
const sitmarDistributeSentPosts = new Map();
const sitmarDistributeDismissed = new Set();
const sitmarDistributeQueueIndex = new Map();
let sitmarDistributeTab = "queue";

function sitmarDistributePostKey(storyId, post) {
  return distributeStoryPostKey(storyId, post);
}

function sitmarDistributeQueueInSidebar() {
  return (
    brandHomeViewMode === "content-generation" &&
    String(effectiveCampaignStatus() || "").toLowerCase() === "posted"
  );
}

function refreshSitmarDistributeQueueSidebar(campaign) {
  if (!sitmarDistributeQueueInSidebar()) return;
  const company = companies.find((c) => c.id === selectedBrandId);
  if (company) renderBrandHomeStoriesColOnly(company);
}

function fetchSitmarDistributeStory(campaign) {
  const storyId = String(campaign.story_id || "").trim();
  if (!storyId || sitmarDistributeStoryInFlight.has(storyId)) return;
  sitmarDistributeStoryInFlight.add(storyId);
  void (async () => {
    try {
      const { ok, status, body } = await api(
        `/api/trends/story/${encodeURIComponent(storyId)}`,
      );
      if (status === 401) return;
      const posts = Array.isArray(body?.posts) ? body.posts : [];
      sitmarDistributeStoryCache.set(storyId, {
        story: ok ? body?.story : null,
        posts,
        fetchedAt: Date.now(),
      });
    } catch {
      sitmarDistributeStoryCache.set(storyId, {
        story: null,
        posts: [],
        fetchedAt: Date.now(),
      });
    } finally {
      sitmarDistributeStoryInFlight.delete(storyId);
      const host = document.querySelector(
        ".sitmar-distribute-shell .distribute-content",
      );
      const hasRenderedQueue = !!host?.querySelector(".distribute-queue");
      if (!hasRenderedQueue) refreshSitmarDistributeView(campaign.id);
    }
  })();
}

function selectSitmarDistributeQueuePost(campaign, post) {
  const storyId = String(campaign.story_id || "").trim();
  const posts = getSitmarDistributeQueuePosts(storyId);
  const idx = posts.findIndex(
    (p) =>
      sitmarDistributePostKey(storyId, p) ===
      sitmarDistributePostKey(storyId, post),
  );
  if (idx < 0) return;
  sitmarDistributeQueueIndex.set(campaign.id, idx);
  sitmarDistributeTab = "queue";
  refreshSitmarDistributeQueueSidebar(campaign);
  refreshSitmarDistributeQueueDetail(campaign);
}

function refreshSitmarDistributeQueueDetail(campaign) {
  const host = document.querySelector(
    ".sitmar-distribute-shell .distribute-content",
  );
  if (!host) {
    refreshSitmarDistributeView(campaign.id);
    return;
  }
  if (sitmarDistributeTab === "sent") {
    renderSitmarDistributeSentView(host);
    return;
  }
  renderSitmarDistributeStory(campaign, host);
}

let sitmarDistributeHydratedFor = "";

function hydrateSitmarDistributeState(campaign, { force = false } = {}) {
  if (!campaign || String(campaign.status || "").toLowerCase() !== "posted") {
    if (sitmarDistributeHydratedFor) {
      sitmarDistributeSentPosts.clear();
      sitmarDistributeDismissed.clear();
      sitmarDistributeHydratedFor = "";
    }
    return;
  }
  if (!force && sitmarDistributeHydratedFor === campaign.id) return;
  sitmarDistributeSentPosts.clear();
  sitmarDistributeDismissed.clear();
  const sent = Array.isArray(campaign.distribute_sent)
    ? campaign.distribute_sent
    : [];
  sent.forEach((entry) => {
    const postKey = String(entry?.post_key || "").trim();
    if (!postKey) return;
    const sentAtRaw = Number(entry.sent_at || 0);
    sitmarDistributeSentPosts.set(postKey, {
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
    if (postKey) sitmarDistributeDismissed.add(postKey);
  });
  distributeReplyDraftSyncCampaign(campaign.id, [
    ...dismissed,
    ...sent.map((entry) => entry?.post_key).filter(Boolean),
  ]);
  sitmarDistributeHydratedFor = campaign.id;
}

function patchSitmarDistributeSentCache(campaign, entry) {
  patchSitmarCampaignCaches(campaign, (c) => {
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

function patchSitmarDistributeDismissedCache(campaign, postKey) {
  patchSitmarCampaignCaches(campaign, (c) => {
    const dismissed = Array.isArray(c.distribute_dismissed)
      ? [...c.distribute_dismissed]
      : [];
    if (!dismissed.includes(postKey)) dismissed.push(postKey);
    c.distribute_dismissed = dismissed;
  });
}

function persistSitmarDistributeSent(campaign, post, reply) {
  const storyId = String(campaign.story_id || "").trim();
  const postKey = sitmarDistributePostKey(storyId, post);
  const entry = {
    post_key: postKey,
    sent_at: Date.now() / 1000,
    reply: reply || "",
    post: post || {},
  };
  patchSitmarDistributeSentCache(campaign, entry);
  void api(`/api/sitmar/${encodeURIComponent(campaign.id)}/distribute-sent`, {
    method: "POST",
    body: JSON.stringify({
      post_key: postKey,
      reply: entry.reply,
      post: entry.post,
    }),
  }).catch(() => {});
}

function persistSitmarDistributeSkip(campaign, post) {
  const storyId = String(campaign.story_id || "").trim();
  const postKey = sitmarDistributePostKey(storyId, post);
  patchSitmarDistributeDismissedCache(campaign, postKey);
  void api(`/api/sitmar/${encodeURIComponent(campaign.id)}/distribute-skip`, {
    method: "POST",
    body: JSON.stringify({ post_key: postKey }),
  }).catch(() => {});
}

function getSitmarDistributeQueuePosts(storyId) {
  const cached = sitmarDistributeStoryCache.get(storyId);
  const posts = Array.isArray(cached?.posts) ? cached.posts : [];
  return posts.filter(
    (post) =>
      !sitmarDistributeDismissed.has(sitmarDistributePostKey(storyId, post)),
  );
}

function sitmarDistributeReplyKey(campaignId, post) {
  const id = String(post?.id || post?.url || "").trim();
  if (id) return `${campaignId}:${id}`;
  return `${campaignId}:${String(post?.text || "").slice(0, 120)}`;
}

const SITMAR_DISTRIBUTE_ICON_LAYOUT_LIST =
  '<svg class="distribute-sidebar-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 9h8"/><path d="M8 13h6"/><path d="M13 18l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v5.5"/><path d="M19 16l-2 3h4l-2 3"/></svg>';
const SITMAR_DISTRIBUTE_ICON_SEND =
  '<svg class="distribute-sidebar-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>';

function sitmarDistributeSidebarSegHtml(icon, count) {
  return `${icon}<span class="distribute-seg-n">${count}</span>`;
}

function syncSitmarDistributeToggleCounts(campaign) {
  const storyId = String(campaign.story_id || "").trim();
  const queueCount = getSitmarDistributeQueuePosts(storyId).length;
  const sentCount = sitmarDistributeSentPosts.size;

  const sidebarSegs = document.querySelectorAll(
    '[data-distribute-toggle="sidebar"] .distribute-seg',
  );
  if (sidebarSegs.length >= 2) {
    sidebarSegs[0].innerHTML = sitmarDistributeSidebarSegHtml(
      SITMAR_DISTRIBUTE_ICON_LAYOUT_LIST,
      queueCount,
    );
    sidebarSegs[1].innerHTML = sitmarDistributeSidebarSegHtml(
      SITMAR_DISTRIBUTE_ICON_SEND,
      sentCount,
    );
  }

  const centerSegs = document.querySelectorAll(
    ".sitmar-distribute-shell .distribute-tab-toggle .distribute-seg",
  );
  if (centerSegs.length < 2) return;
  const queueLabel = sitmarDistributeQueueInSidebar() ? "Reply" : "Queue";
  centerSegs[0].innerHTML = `${queueLabel}${queueCount ? ` <span class="distribute-seg-n">${queueCount}</span>` : ""}`;
  centerSegs[1].innerHTML = `Sent${sentCount ? ` <span class="distribute-seg-n">${sentCount}</span>` : ""}`;
}
const SITMAR_ACTION_ICON_STYLES = [
  { bg: "hsl(210, 70%, 96%)", color: "hsl(218, 55%, 52%)" },
  { bg: "hsl(145, 55%, 94%)", color: "hsl(150, 45%, 38%)" },
  { bg: "hsl(40, 65%, 94%)", color: "hsl(35, 70%, 45%)" },
  { bg: "hsl(350, 55%, 96%)", color: "hsl(350, 50%, 52%)" },
];
const SITMAR_ICON_DRAFT_POST = {
  bg: "hsl(145, 55%, 94%)",
  color: "hsl(150, 45%, 38%)",
};
const SITMAR_ICON_PENCIL =
  '<svg class="action-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 20h9"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
const SITMAR_REFRESH_ICON =
  '<svg class="action-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" d="M1 4v6h6"/><path fill="none" stroke="currentColor" stroke-width="2" d="M23 20v-6h-6"/><path fill="none" stroke="currentColor" stroke-width="2" d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>';
const SITMAR_ICON_CIRCLE_ARROW_LEFT =
  '<svg class="sitmar-tweet-arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m12 8-4 4 4 4"/><path d="M16 12H8"/></svg>';
const SITMAR_ICON_CIRCLE_ARROW_RIGHT =
  '<svg class="sitmar-tweet-arrow-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m12 16 4-4-4-4"/><path d="M8 12h8"/></svg>';
const SITMAR_ICON_X =
  '<svg class="sitmar-tweet-post-x" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.254 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
const SITMAR_CHAT_SEND_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="6 11 12 5 18 11"></polyline></svg>';
const SITMAR_ICON_SCAN_EYE_TONE = {
  bg: "hsl(210, 60%, 96%)",
  color: "hsl(210, 50%, 45%)",
};
const SITMAR_ICON_SCAN_EYE =
  '<svg class="action-icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M3 7V5a2 2 0 0 1 2-2h2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M17 3h2a2 2 0 0 1 2 2v2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M21 17v2a2 2 0 0 1-2 2h-2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="1" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M18.5 12c-1.5 2.5-4 4-6.5 4s-5-1.5-6.5-4"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M5.5 12c1.5-2.5 4-4 6.5-4s5 1.5 6.5 4"/></svg>';

function buildAddYourBrandAction(onClick) {
  return buildActionGrid(
    [
      {
        label: "Add your brand",
        iconHtml: SITMAR_ICON_SCAN_EYE,
        ariaLabel: "Add your brand",
        iconBg: SITMAR_ICON_SCAN_EYE_TONE.bg,
        iconColor: SITMAR_ICON_SCAN_EYE_TONE.color,
        onClick,
      },
    ],
    { columns: 2 },
  );
}

function buildActionGrid(items, options = {}) {
  const columns = options.columns ?? 2;
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
          : SITMAR_ACTION_ICON_STYLES[index % SITMAR_ACTION_ICON_STYLES.length];
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

function patchSitmarCampaignCaches(campaign, patchFn) {
  const seen = new Set();
  const apply = (entry) => {
    if (!entry || seen.has(entry)) return;
    seen.add(entry);
    patchFn(entry);
  };
  apply(campaign);
  if (sitmarDetailCampaign?.id === campaign.id) apply(sitmarDetailCampaign);
  if (contentDesktopDetailCampaign?.id === campaign.id) {
    apply(contentDesktopDetailCampaign);
  }
  apply(sitmarCampaigns.find((c) => c.id === campaign.id));
}

function applySitmarPostedOptimistic(campaign, tweetIdx) {
  patchSitmarCampaignCaches(campaign, (c) => {
    c.status = "posted";
    c.selected_seed = {
      ...(c.selected_seed || {}),
      posted_tweet_index: tweetIdx,
    };
  });
}

function revertSitmarPostedOptimistic(campaign) {
  patchSitmarCampaignCaches(campaign, (c) => {
    c.status = "drafted";
    const seed = { ...(c.selected_seed || {}) };
    delete seed.posted_tweet_index;
    c.selected_seed = seed;
  });
}

// ===== unified brand-home chat thread =====

let unifiedChatShell = null;
let unifiedChatThread = null;
let unifiedChatScroll = null;
let unifiedChatCampaignId = null;
let unifiedRenderedCount = 0;
let unifiedPhase = "intro";
let unifiedIntroPhase = null;

function resetUnifiedChat() {
  unifiedChatShell = null;
  unifiedChatThread = null;
  unifiedChatScroll = null;
  unifiedChatCampaignId = null;
  unifiedRenderedCount = 0;
  unifiedPhase = "intro";
  unifiedIntroPhase = null;
}

function resolveChatScrollEl(preferred) {
  if (preferred?.isConnected) return preferred;
  if (unifiedChatScroll?.isConnected) return unifiedChatScroll;
  return unifiedChatThread?.closest(".sitmar-chat-scroll") || null;
}

function scrollChatToBottom(scrollEl) {
  const el = resolveChatScrollEl(scrollEl);
  if (!el) return;
  const snap = () => {
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
  };
  snap();
  requestAnimationFrame(() => {
    snap();
    requestAnimationFrame(() => {
      snap();
      setTimeout(snap, 0);
    });
  });
}

function scrollUnifiedChatToBottom() {
  scrollChatToBottom(unifiedChatScroll);
}

function transitionUnifiedCampaignChat(campaign) {
  if (!campaign || !unifiedChatThread || !unifiedChatShell?.isConnected) {
    return false;
  }
  unifiedPhase = "campaign";
  unifiedChatCampaignId = campaign.id;
  unifiedRenderedCount = 0;
  unifiedChatThread.innerHTML = "";
  unifiedChatShell.querySelector(".sitmar-chat-composer")?.remove();
  contentDesktopSelectedCampaignId = campaign.id;
  contentDesktopDetailCampaign = campaign;
  sitmarDetailCampaign = campaign;
  const company = companies.find((c) => c.id === selectedBrandId);
  if (company)
    appendUnifiedCampaignComposer(unifiedChatShell, company, campaign);
  syncUnifiedThread(campaign);
  return true;
}

function seedBannerShouldShow(resolved) {
  const seed = resolved?.selected_seed || {};
  if (!String(seed.title || "").trim()) return false;
  if (sitmarHasDraftPosts(resolved)) return false;
  const status = String(resolved?.status || "").toLowerCase();
  return status === "selected" || status === "thinking";
}

function isChatStatus(status) {
  return ["thinking", "ready", "selected", "drafting", "drafted"].includes(
    String(status || "").toLowerCase(),
  );
}

function isUnifiedCampaignStatus(status) {
  const s = String(status || "").toLowerCase();
  return isChatStatus(s) || s === "error";
}

function effectiveCampaignStatus() {
  const listCampaign = sitmarCampaigns.find(
    (c) => c.id === contentDesktopSelectedCampaignId,
  );
  const listStatus = String(listCampaign?.status || "").toLowerCase();
  const detailStatus = String(
    contentDesktopDetailCampaign?.status || "",
  ).toLowerCase();
  return listStatus || detailStatus;
}

function sitmarCampaignNeedsFullDetail(listCampaign, detailCampaign) {
  if (!listCampaign) return false;
  if (!detailCampaign || detailCampaign.id !== listCampaign.id) return true;
  const listStatus = String(listCampaign.status || "").toLowerCase();
  const detailStatus = String(detailCampaign.status || "").toLowerCase();
  if (detailStatus !== listStatus) return true;
  const messages = detailCampaign.messages;
  if (!Array.isArray(messages)) {
    return listStatus === "ready" || listStatus === "selected";
  }
  if (listStatus === "ready") {
    return !messages.some(
      (m) =>
        m?.role === "assistant" && Array.isArray(m.seeds) && m.seeds.length,
    );
  }
  if (listStatus === "selected") {
    return !messages.some(
      (m) =>
        m?.role === "assistant" && Array.isArray(m.vibes) && m.vibes.length,
    );
  }
  if (listStatus === "drafted") {
    return (
      !Array.isArray(detailCampaign.tweets) || !detailCampaign.tweets.length
    );
  }
  if (listStatus === "posted") {
    return !("distribute_sent" in detailCampaign);
  }
  return false;
}

function resolvedContentGenCampaign() {
  if (!contentDesktopSelectedCampaignId) return null;
  if (contentDesktopDetailCampaign?.id === contentDesktopSelectedCampaignId) {
    return contentDesktopDetailCampaign;
  }
  return (
    sitmarCampaigns.find((c) => c.id === contentDesktopSelectedCampaignId) ||
    null
  );
}

function findSitmarCampaignById(campaignId) {
  if (sitmarDetailCampaign?.id === campaignId) return sitmarDetailCampaign;
  if (contentDesktopDetailCampaign?.id === campaignId) {
    return contentDesktopDetailCampaign;
  }
  return sitmarCampaigns.find((c) => c.id === campaignId) || null;
}

function isUnifiedChatActive(campaignId) {
  return (
    !!unifiedChatShell?.isConnected && unifiedChatCampaignId === campaignId
  );
}

function removeUnifiedTypingIndicator() {
  if (!unifiedChatThread) return;
  unifiedChatThread
    .querySelectorAll(
      ".sitmar-chat-loading, .sitmar-bubble-assistant.sitmar-typing, .sitmar-opener-placeholder, .sitmar-ideating",
    )
    .forEach((el) => el.remove());
}

function disableActionGrid(grid) {
  if (!grid || grid.dataset.historicized) return;
  grid.dataset.historicized = "1";
  grid.querySelectorAll(".sitmar-action-btn").forEach((btn) => {
    btn.disabled = true;
  });
}

function historicizeUnifiedActionGrids() {
  if (!unifiedChatThread) return;
  unifiedChatThread
    .querySelectorAll(".sitmar-action-grid:not([data-historicized])")
    .forEach((grid) => disableActionGrid(grid));
}

function computeLatestTurnIndices(messages) {
  let latestSeedTurn = -1;
  let latestVibeTurn = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = messages[i];
    if (
      t &&
      t.role === "assistant" &&
      Array.isArray(t.seeds) &&
      t.seeds.length
    ) {
      latestSeedTurn = i;
      break;
    }
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = messages[i];
    if (
      t &&
      t.role === "assistant" &&
      Array.isArray(t.vibes) &&
      t.vibes.length
    ) {
      latestVibeTurn = i;
      break;
    }
  }
  return { latestSeedTurn, latestVibeTurn };
}

function appendSitmarTurn(thread, turn, campaign, opts) {
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
      thread.appendChild(sitmarBubble("assistant", turn.message));
    }
    if (Array.isArray(turn.seeds) && turn.seeds.length) {
      const isLatest = i === latestSeedTurn && campaign.status === "ready";
      if (isLatest && !thinking) {
        const seeds = turn.seeds.slice(0, 3);
        thread.appendChild(
          buildActionGrid(
            [
              ...seeds.map((seed, seedIndex) => ({
                label: seed.title || "",
                icon: String(seedIndex + 1),
                ariaLabel: seed.title || `Direction ${seedIndex + 1}`,
                iconBg: SITMAR_ACTION_ICON_STYLES[seedIndex].bg,
                iconColor: SITMAR_ACTION_ICON_STYLES[seedIndex].color,
                onClick: () => sitmarSelectSeed(campaign.id, seedIndex),
              })),
              {
                label: SITMAR_REGENERATE_LABEL,
                iconHtml: SITMAR_REFRESH_ICON,
                ariaLabel: SITMAR_REGENERATE_LABEL,
                iconBg: SITMAR_ACTION_ICON_STYLES[3].bg,
                iconColor: SITMAR_ACTION_ICON_STYLES[3].color,
                onClick: () => sitmarRegenerateSeeds(campaign.id),
              },
            ],
            { columns: 1 },
          ),
        );
      } else {
        const seeds = turn.seeds.slice(0, 3);
        thread.appendChild(
          buildActionGrid(
            [
              ...seeds.map((seed, seedIndex) => ({
                label: seed.title || "",
                icon: String(seedIndex + 1),
                ariaLabel: seed.title || `Direction ${seedIndex + 1}`,
                iconBg: SITMAR_ACTION_ICON_STYLES[seedIndex].bg,
                iconColor: SITMAR_ACTION_ICON_STYLES[seedIndex].color,
                disabled: true,
              })),
              {
                label: SITMAR_REGENERATE_LABEL,
                iconHtml: SITMAR_REFRESH_ICON,
                ariaLabel: SITMAR_REGENERATE_LABEL,
                iconBg: SITMAR_ACTION_ICON_STYLES[3].bg,
                iconColor: SITMAR_ACTION_ICON_STYLES[3].color,
                disabled: true,
              },
            ],
            { columns: 1 },
          ),
        );
      }
    }
    if (Array.isArray(turn.vibes) && turn.vibes.length) {
      const isLatest = i === latestVibeTurn && campaign.status === "selected";
      if (isLatest && !thinking) {
        const vibes = turn.vibes.slice(0, 3);
        thread.appendChild(
          buildActionGrid([
            ...vibes.map((vibe, vibeIndex) => ({
              label: vibe.label || "",
              icon: String(vibeIndex + 1),
              ariaLabel: vibe.label || `Vibe ${vibeIndex + 1}`,
              iconBg: SITMAR_ACTION_ICON_STYLES[vibeIndex].bg,
              iconColor: SITMAR_ACTION_ICON_STYLES[vibeIndex].color,
              onClick: () => sitmarSendMessage(campaign.id, vibe.label || ""),
            })),
            {
              label: "Review post options",
              icon: "→",
              ariaLabel: "Review post options",
              accentCta: true,
              onClick: () => sitmarPostCampaign(campaign.id),
            },
          ]),
        );
      } else {
        const vibes = turn.vibes.slice(0, 3);
        thread.appendChild(
          buildActionGrid([
            ...vibes.map((vibe, vibeIndex) => ({
              label: vibe.label || "",
              icon: String(vibeIndex + 1),
              ariaLabel: vibe.label || `Vibe ${vibeIndex + 1}`,
              iconBg: SITMAR_ACTION_ICON_STYLES[vibeIndex].bg,
              iconColor: SITMAR_ACTION_ICON_STYLES[vibeIndex].color,
              disabled: true,
            })),
            {
              label: "Review post options",
              icon: "→",
              ariaLabel: "Review post options",
              accentCta: true,
              disabled: true,
            },
          ]),
        );
      }
    }
  } else if (turn.role === "user" && turn.type === "story_context") {
    thread.appendChild(buildStoryContextBubble(turn));
  } else if (turn.role === "user") {
    thread.appendChild(sitmarBubble("user", turn.text));
  }
}

function appendUnifiedIntroToThread(thread, scroll, company) {
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
  } else {
    const justUnlocked = consumeBrandHomeChatJustUnlocked();
    if (justUnlocked) {
      thread.appendChild(
        sitmarBubble("assistant", brandHomeNeedsBrandGreeting()),
      );
      thread.appendChild(
        sitmarBubble("assistant", "Great! Ready to draft your first post?"),
      );
    } else {
      thread.appendChild(sitmarBubble("assistant", brandHomeReadyGreeting()));
    }
    appendBrandHomeReadyChatActions(thread, scroll, company);
  }
  return phase;
}

function appendUnifiedCampaignComposer(shell, company, campaign) {
  const existing = shell.querySelector(".sitmar-chat-composer");
  if (existing) existing.remove();
  const campaignId = campaign.id;
  const composer = document.createElement("div");
  composer.className = "sitmar-chat-composer";
  const inputRow = document.createElement("div");
  inputRow.className = "sitmar-chat-input-row";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "sitmar-chat-input";
  const send = document.createElement("button");
  send.type = "button";
  send.className = "sitmar-chat-send-btn";
  send.setAttribute("aria-label", "Send");
  send.innerHTML = SITMAR_CHAT_SEND_ICON;
  const isComposerBlocked = () => {
    const live = findSitmarCampaignById(campaignId);
    const status = String(live?.status || "").toLowerCase();
    return status === "thinking" || status === "drafting";
  };
  const syncSendDisabled = () => {
    const blocked = isComposerBlocked();
    const live = findSitmarCampaignById(campaignId) || campaign;
    input.disabled = blocked;
    input.placeholder = sitmarComposerPlaceholder(live);
    send.disabled = blocked || !input.value.trim();
  };
  inputRow.appendChild(input);
  inputRow.appendChild(send);
  composer.appendChild(inputRow);
  shell.appendChild(composer);
  const doSend = () => {
    const text = input.value.trim();
    if (!text || isComposerBlocked()) return;
    input.value = "";
    syncSendDisabled();
    sitmarSendMessage(campaignId, text);
  };
  input.addEventListener("input", syncSendDisabled);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
  send.addEventListener("click", doSend);
  syncSendDisabled();
  syncUnifiedComposer(findSitmarCampaignById(campaignId) || campaign, company);
  syncSeedBanner(shell, findSitmarCampaignById(campaignId) || campaign);
}

function syncUnifiedComposer(campaign, company) {
  if (!unifiedChatShell?.isConnected) {
    resetUnifiedChat();
    return;
  }
  const composer = unifiedChatShell.querySelector(".sitmar-chat-composer");
  if (!composer) return;
  const input = composer.querySelector(".sitmar-chat-input");
  const send = composer.querySelector(".sitmar-chat-send-btn");
  if (!input) return;
  if (unifiedPhase !== "campaign" || !unifiedChatCampaignId) {
    return;
  }
  const blocked =
    campaign?.status === "thinking" || campaign?.status === "drafting";
  input.disabled = blocked;
  input.placeholder = sitmarComposerPlaceholder(campaign);
  if (send) {
    send.disabled = blocked || !input.value.trim();
  }
}

function syncSeedBanner(shell, campaign) {
  if (!shell) return;
  const resolved = campaign?.id
    ? findSitmarCampaignById(campaign.id) || campaign
    : campaign;
  if (!seedBannerShouldShow(resolved)) {
    shell.querySelector("[data-seed-banner]")?.remove();
    return;
  }
  const seed = resolved.selected_seed || {};
  const signature = `${seed.title}\n${seed.blurb || ""}`;
  let banner = shell.querySelector("[data-seed-banner]");
  if (banner) {
    const prev = banner.dataset.seedSignature || "";
    if (prev !== signature) {
      const next = contentSelectedSeedBanner(resolved);
      if (!next) return;
      next.dataset.seedBanner = "1";
      next.dataset.seedSignature = signature;
      banner.replaceWith(next);
      banner = next;
    }
  } else {
    banner = contentSelectedSeedBanner(resolved);
    if (!banner) return;
    banner.dataset.seedBanner = "1";
    banner.dataset.seedSignature = signature;
    const composer = shell.querySelector(".sitmar-chat-composer");
    if (composer) shell.insertBefore(banner, composer);
    else shell.appendChild(banner);
  }
  const composer = shell.querySelector(".sitmar-chat-composer");
  if (banner && composer && banner.nextElementSibling !== composer) {
    shell.insertBefore(banner, composer);
  }
}

function syncUnifiedSeedBanner(campaign) {
  const resolved = campaign || resolvedContentGenCampaign();
  syncSeedBanner(unifiedChatShell, resolved);
}

function syncUnifiedThread(campaign) {
  if (!unifiedChatShell?.isConnected) {
    resetUnifiedChat();
    return;
  }
  if (!campaign) {
    removeUnifiedTypingIndicator();
    unifiedChatThread.appendChild(homeChatTypingIndicator());
    if (unifiedChatScroll) {
      scrollUnifiedChatToBottom();
    }
    return;
  }
  const messages = campaign.messages || [];
  const hasNewMessages = unifiedRenderedCount < messages.length;
  removeUnifiedTypingIndicator();
  const { latestSeedTurn, latestVibeTurn } = computeLatestTurnIndices(messages);
  if (
    hasNewMessages ||
    campaign.status === "thinking" ||
    campaign.status === "drafting"
  ) {
    historicizeUnifiedActionGrids();
  }
  for (let i = unifiedRenderedCount; i < messages.length; i++) {
    appendSitmarTurn(unifiedChatThread, messages[i], campaign, {
      turnIndex: i,
      latestSeedTurn,
      latestVibeTurn,
    });
  }
  unifiedRenderedCount = messages.length;
  syncUnifiedSeedBanner(campaign);
  removeUnifiedTypingIndicator();
  if (shouldShowSitmarIdeating(campaign)) {
    unifiedChatThread.appendChild(sitmarIdeatingIndicator());
  }
  syncInlinePostsBlock(unifiedChatThread, campaign);
  const company = companies.find((c) => c.id === selectedBrandId);
  const status = String(campaign.status || "").toLowerCase();
  if (status === "error") {
    unifiedChatShell?.querySelector(".sitmar-chat-composer")?.remove();
    scrollUnifiedChatToBottom();
    return;
  }
  if (status === "drafting") {
    if (!sitmarHasDraftPosts(campaign)) {
      unifiedChatShell?.querySelector(".sitmar-chat-composer")?.remove();
    } else if (!unifiedChatShell?.querySelector(".sitmar-chat-composer")) {
      appendUnifiedCampaignComposer(unifiedChatShell, company, campaign);
    } else {
      syncUnifiedComposer(campaign, company);
    }
  } else if (!unifiedChatShell?.querySelector(".sitmar-chat-composer")) {
    appendUnifiedCampaignComposer(unifiedChatShell, company, campaign);
  } else {
    syncUnifiedComposer(campaign, company);
  }
  scrollUnifiedChatToBottom();
}

function syncUnifiedIntro(company) {
  if (!unifiedChatShell?.isConnected) {
    resetUnifiedChat();
    return;
  }
  if (unifiedPhase !== "intro") return;
  const phase = brandHomeChatPhase(company);
  if (phase === unifiedIntroPhase) return;
  unifiedIntroPhase = phase;
  unifiedChatThread.innerHTML = "";
  unifiedChatShell.querySelector(".sitmar-chat-composer")?.remove();
  appendUnifiedIntroToThread(unifiedChatThread, unifiedChatScroll, company);
  if (unifiedChatScroll) {
    scrollUnifiedChatToBottom();
  }
}

function mountUnifiedChat(company, campaign = null) {
  if (unifiedChatShell?.isConnected) resetUnifiedChat();
  const shell = document.createElement("div");
  shell.className = "brand-home-chat-shell sitmar-chat-shell";
  const scroll = document.createElement("div");
  scroll.className = "sitmar-chat-scroll";
  const thread = document.createElement("div");
  thread.className = "sitmar-chat-thread";
  scroll.appendChild(thread);
  shell.appendChild(scroll);
  unifiedChatShell = shell;
  unifiedChatScroll = scroll;
  unifiedChatThread = thread;

  const campaignId = contentDesktopSelectedCampaignId;
  const resolved = campaign || resolvedContentGenCampaign();
  const status = resolved
    ? String(resolved.status || "").toLowerCase()
    : effectiveCampaignStatus();

  if (campaignId && resolved && isUnifiedCampaignStatus(status)) {
    unifiedPhase = "campaign";
    unifiedChatCampaignId = campaignId;
    const messages = resolved.messages || [];
    if (messages.length) {
      const { latestSeedTurn, latestVibeTurn } =
        computeLatestTurnIndices(messages);
      messages.forEach((t, i) => {
        appendSitmarTurn(thread, t, resolved, {
          turnIndex: i,
          latestSeedTurn,
          latestVibeTurn,
        });
      });
      unifiedRenderedCount = messages.length;
      if (shouldShowSitmarIdeating(resolved)) {
        thread.appendChild(sitmarIdeatingIndicator());
      }
    } else {
      unifiedRenderedCount = 0;
      if (shouldShowSitmarIdeating(resolved)) {
        thread.appendChild(sitmarIdeatingIndicator());
      }
    }
    syncInlinePostsBlock(thread, resolved);
    if (resolved.status !== "drafting" && status !== "error") {
      appendUnifiedCampaignComposer(shell, company, resolved);
    }
    syncUnifiedSeedBanner(resolved);
  } else {
    unifiedPhase = "intro";
    unifiedIntroPhase = appendUnifiedIntroToThread(thread, scroll, company);
  }
  scrollUnifiedChatToBottom();
  return shell;
}

function applyUnifiedOptimisticThinking(campaign) {
  const live = findSitmarCampaignById(campaign.id) || campaign;
  removeUnifiedTypingIndicator();
  if (shouldShowSitmarIdeating(live)) {
    unifiedChatThread.appendChild(sitmarIdeatingIndicator());
  }
  syncInlinePostsBlock(unifiedChatThread, live);
  syncUnifiedSeedBanner(live);
  const company = companies.find((c) => c.id === selectedBrandId);
  syncUnifiedComposer(live, company);
  scrollUnifiedChatToBottom();
}

async function sitmarRegenerateSeeds(campaignId) {
  if (!(await requireSignIn())) return;
  if (sitmarSeedRegenInFlight.has(campaignId)) return;
  sitmarSeedRegenInFlight.add(campaignId);
  const campaign =
    sitmarDetailCampaign?.id === campaignId
      ? sitmarDetailCampaign
      : contentDesktopDetailCampaign?.id === campaignId
        ? contentDesktopDetailCampaign
        : sitmarCampaigns.find((c) => c.id === campaignId);
  if (campaign) {
    patchSitmarCampaignCaches(campaign, (c) => {
      c.messages = (c.messages || []).concat({
        role: "user",
        text: SITMAR_REGENERATE_LABEL,
      });
      c.status = "thinking";
    });
    if (isUnifiedChatActive(campaignId)) {
      unifiedChatThread
        .querySelectorAll(".sitmar-action-btn")
        .forEach((btn) => {
          btn.disabled = true;
        });
      unifiedChatThread.appendChild(
        sitmarBubble("user", SITMAR_REGENERATE_LABEL),
      );
      unifiedRenderedCount += 1;
      scrollUnifiedChatToBottom();
      applyUnifiedOptimisticThinking(campaign);
    } else {
      renderSitmarDetail(campaign);
    }
  }
  try {
    const { ok, status, body } = await api(
      `/api/sitmar/${encodeURIComponent(campaignId)}/message`,
      { method: "POST", body: { text: "", regenerate: true } },
    );
    if (status === 401) return;
    if (handleUpgradeRequired(status)) return;
    if (!ok) {
      showToast(apiErrorMessage(body, "Couldn't regenerate directions."));
      return selectSitmar(campaignId);
    }
    pendingSitmarJobs.add(campaignId);
    scheduleSitmarPolling(1200);
  } catch (err) {
    showToast("Network error: " + err.message);
    selectSitmar(campaignId);
  } finally {
    sitmarSeedRegenInFlight.delete(campaignId);
  }
}

function renderSitmarChat(campaign, inner) {
  const thinking = campaign.status === "thinking";
  const drafting = campaign.status === "drafting";

  const shell = document.createElement("div");
  shell.className = "sitmar-chat-shell";

  const scroll = document.createElement("div");
  scroll.className = "sitmar-chat-scroll";

  const thread = document.createElement("div");
  thread.className = "sitmar-chat-thread";
  const messages = campaign.messages || [];
  const { latestSeedTurn, latestVibeTurn } = computeLatestTurnIndices(messages);
  messages.forEach((t, i) => {
    appendSitmarTurn(thread, t, campaign, {
      turnIndex: i,
      latestSeedTurn,
      latestVibeTurn,
    });
  });
  if (shouldShowSitmarIdeating(campaign)) {
    thread.appendChild(sitmarIdeatingIndicator());
  }
  syncInlinePostsBlock(thread, campaign);
  scroll.appendChild(thread);
  shell.appendChild(scroll);

  if (!drafting || sitmarHasDraftPosts(campaign)) {
    const composer = document.createElement("div");
    composer.className = "sitmar-chat-composer";
    const inputRow = document.createElement("div");
    inputRow.className = "sitmar-chat-input-row";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "sitmar-chat-input";
    input.placeholder = sitmarComposerPlaceholder(campaign);
    input.disabled = thinking || drafting;
    const send = document.createElement("button");
    send.type = "button";
    send.className = "sitmar-chat-send-btn";
    send.setAttribute("aria-label", "Send");
    send.innerHTML = SITMAR_CHAT_SEND_ICON;
    const syncSendDisabled = () => {
      send.disabled = thinking || drafting || !input.value.trim();
    };
    syncSendDisabled();
    inputRow.appendChild(input);
    inputRow.appendChild(send);
    composer.appendChild(inputRow);

    const doSend = () => {
      const text = input.value.trim();
      if (text) {
        input.value = "";
        syncSendDisabled();
        sitmarSendMessage(campaign.id, text);
      }
    };
    input.addEventListener("input", syncSendDisabled);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });
    send.addEventListener("click", doSend);

    shell.appendChild(composer);
    syncSeedBanner(shell, campaign);
  }

  inner.appendChild(shell);

  scrollChatToBottom(scroll);
}

function renderSitmarDrafting(inner) {
  const wrap = document.createElement("div");
  wrap.className = "sitmar-rendering";
  wrap.appendChild(meleaStatusLine("Generating posts…", { ariaBusy: true }));
  inner.appendChild(wrap);
}

function appendSitmarErrorWithRetry(parent, campaign) {
  const err = document.createElement("div");
  err.className = "field-error";
  err.style.padding = "0 20px";
  setText(err, campaign.error || "Campaign generation failed.");
  parent.appendChild(err);
  if (String(campaign.selected_seed?.title || "").trim()) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "sitmar-tweet-regen";
    retry.style.margin = "12px 20px";
    setText(retry, "Retry");
    retry.addEventListener("click", () => sitmarRegenerateTweets(campaign.id));
    parent.appendChild(retry);
  }
}

let sitmarTweetIndex = 0;

const SITMAR_TWEET_VERIFIED_SVG =
  '<svg viewBox="0 0 22 22" aria-label="Verified" width="16" height="16"><path fill="currentColor" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.855-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.706 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></svg>';

function removeInlinePostsBlock(thread) {
  thread
    ?.querySelectorAll("[data-sitmar-inline-posts]")
    .forEach((el) => el.remove());
}

function sitmarBrandTweetMeta(campaign) {
  const bt = campaign.brand_twitter || {};
  return {
    avatarUrl: bt.profile_image_url || campaign.brand_logo_url || "",
    displayName: bt.name || campaign.brand_name || "Brand",
    handle: bt.handle ? `@${bt.handle}` : "",
  };
}

function autosizeTweetTextarea(textarea) {
  const fit = () => {
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  fit();
  textarea.addEventListener("input", fit);
}

function buildSitmarTweetCard(campaign, tweetIndex) {
  const tweets = campaign.tweets || [];
  const tweet = tweets[tweetIndex] || {};
  const { avatarUrl, displayName, handle } = sitmarBrandTweetMeta(campaign);

  const card = document.createElement("div");
  card.className = "sitmar-tweet-card";

  const header = document.createElement("div");
  header.className = "sitmar-tweet-header";
  const av = document.createElement("img");
  av.className = "sitmar-tweet-avatar";
  av.src = avatarUrl;
  av.alt = "";
  av.onerror = function () {
    this.style.display = "none";
  };
  header.appendChild(av);
  const nameCol = document.createElement("div");
  nameCol.className = "sitmar-tweet-name-col";
  const nameRow = document.createElement("div");
  nameRow.className = "sitmar-tweet-name-row";
  const nameEl = document.createElement("span");
  nameEl.className = "sitmar-tweet-name";
  setText(nameEl, displayName);
  nameRow.appendChild(nameEl);
  const badge = document.createElement("span");
  badge.className = "sitmar-tweet-verified";
  badge.innerHTML = SITMAR_TWEET_VERIFIED_SVG;
  nameRow.appendChild(badge);
  nameCol.appendChild(nameRow);
  if (handle) {
    const handleEl = document.createElement("div");
    handleEl.className = "sitmar-tweet-handle";
    setText(handleEl, handle);
    nameCol.appendChild(handleEl);
  }
  header.appendChild(nameCol);

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "sitmar-tweet-edit-btn";
  editBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="none" stroke="currentColor" stroke-width="2" d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path fill="none" stroke="currentColor" stroke-width="2" d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  editBtn.setAttribute("aria-label", "Edit tweet");
  header.appendChild(editBtn);
  card.appendChild(header);

  const textEl = document.createElement("div");
  textEl.className = "sitmar-tweet-text";
  setText(textEl, tweet.text || "");
  card.appendChild(textEl);

  const activateEdit = () => {
    if (textEl.querySelector("textarea")) return;
    textEl.innerHTML = "";
    const textarea = document.createElement("textarea");
    textarea.className = "sitmar-tweet-textarea";
    textarea.value = tweet.text || "";
    textarea.maxLength = 280;
    textEl.appendChild(textarea);
    autosizeTweetTextarea(textarea);
    textarea.focus();
    const save = () => {
      const newText = textarea.value.trim();
      if (newText && newText !== tweet.text) {
        tweet.text = newText;
        sitmarUpdateTweet(campaign.id, tweetIndex, newText);
      }
      textEl.innerHTML = "";
      setText(textEl, tweet.text || "");
    };
    textarea.addEventListener("blur", save);
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        textarea.blur();
      }
    });
  };
  editBtn.addEventListener("click", activateEdit);
  textEl.addEventListener("click", activateEdit);

  return card;
}

function sitmarExecutePostSelectedTweet(campaign, tweetIdx, postBtn) {
  void (async () => {
    if (postBtn) postBtn.disabled = true;
    const tweets = campaign.tweets || [];
    const intentUrl = buildTweetIntentUrl(tweets[tweetIdx]?.text);
    window.open(intentUrl, "_blank", "noopener");
    applySitmarPostedOptimistic(campaign, tweetIdx);
    renderSitmarDetail(campaign);
    try {
      const { ok, status, body } = await api(
        `/api/sitmar/${encodeURIComponent(campaign.id)}/posted`,
        { method: "POST", body: { tweet_index: tweetIdx } },
      );
      if (status === 401) {
        revertSitmarPostedOptimistic(campaign);
        renderSitmarDetail(campaign);
        return;
      }
      if (handleUpgradeRequired(status)) {
        revertSitmarPostedOptimistic(campaign);
        renderSitmarDetail(campaign);
        return;
      }
      if (!ok) {
        showToast(apiErrorMessage(body, "Couldn't mark as posted."));
        revertSitmarPostedOptimistic(campaign);
        renderSitmarDetail(campaign);
        return;
      }
      trackEvent("campaign_posted", {
        campaign_id: campaign.id,
        tweet_index: tweetIdx,
      });
      await loadSitmar();
      renderSitmarSidebar();
      if (contentDesktopSelectedCampaignId === campaign.id) {
        await fetchContentCampaignDetail(campaign.id);
      } else if (sitmarDetailCampaign?.id === campaign.id) {
        renderSitmarDetail(sitmarDetailCampaign);
      }
    } catch (err) {
      showToast("Network error: " + err.message);
      revertSitmarPostedOptimistic(campaign);
      renderSitmarDetail(campaign);
    } finally {
      if (postBtn) postBtn.disabled = false;
    }
  })();
}

function sitmarPostSelectedTweet(campaign, tweetIdx, postBtn) {
  gatePostOnXIntro(() =>
    sitmarExecutePostSelectedTweet(campaign, tweetIdx, postBtn),
  );
}

const SITMAR_TWEET_ROUTE_LABELS = {
  recommended: "Recommended",
  provocative: "Provocative",
  casual: "Casual",
};

function sitmarTweetLabel(tweet, index) {
  const route = String(tweet?.route || "")
    .trim()
    .toLowerCase();
  return SITMAR_TWEET_ROUTE_LABELS[route] || `Post ${index + 1}`;
}

function sitmarInlineTweets(campaign) {
  return (campaign.tweets || []).slice(0, 3);
}

function sitmarHasDraftPosts(campaign) {
  return sitmarInlineTweets(campaign).length > 0;
}

function sitmarActiveTweetIndex(campaign) {
  const tweets = sitmarInlineTweets(campaign);
  if (!tweets.length) return 0;
  return Math.max(0, Math.min(sitmarTweetIndex, tweets.length - 1));
}

function sitmarComposerPlaceholder(campaign) {
  const status = String(campaign?.status || "").toLowerCase();
  if (
    (status === "thinking" || status === "drafting") &&
    sitmarHasDraftPosts(campaign)
  ) {
    return "Edit the post";
  }
  if (status === "drafting") return "Generating posts…";
  if (status === "thinking") return "Ideating…";
  if (status === "drafted") return "Edit the post";
  if (status === "selected") return "Refine the direction…";
  return "Refine the directions…";
}

function sitmarMessagePayload(text, tweetIndex = null) {
  const body = { text };
  if (tweetIndex !== null) body.tweet_index = tweetIndex;
  return body;
}

function shouldShowInlinePosts(campaign) {
  const status = String(campaign?.status || "").toLowerCase();
  if (status === "drafted") return true;
  return status === "thinking" && sitmarHasDraftPosts(campaign);
}

function setInlinePostIndex(wrap, campaign, idx) {
  const tweets = sitmarInlineTweets(campaign);
  if (!tweets.length) return;
  sitmarTweetIndex = Math.max(0, Math.min(idx, tweets.length - 1));
  const cardSlot = wrap.querySelector(".sitmar-inline-post-card");
  if (cardSlot) {
    cardSlot.innerHTML = "";
    cardSlot.appendChild(buildSitmarTweetCard(campaign, sitmarTweetIndex));
  }
  const grid = wrap.querySelector(".sitmar-action-grid");
  if (grid) {
    grid.querySelectorAll(".sitmar-action-btn").forEach((btn, i) => {
      if (i < tweets.length) {
        btn.classList.toggle("is-primary", i === sitmarTweetIndex);
      }
    });
  }
}

function buildSitmarInlinePostsBlock(campaign) {
  const tweets = sitmarInlineTweets(campaign);
  if (!tweets.length) return null;
  if (sitmarTweetIndex >= tweets.length) sitmarTweetIndex = 0;

  const wrap = document.createElement("div");
  wrap.className = "sitmar-inline-posts";
  wrap.dataset.sitmarInlinePosts = "1";

  const row = document.createElement("div");
  row.className = "sitmar-inline-posts-row";

  const main = document.createElement("div");
  main.className = "sitmar-inline-post-main";

  const cardSlot = document.createElement("div");
  cardSlot.className = "sitmar-inline-post-card";
  cardSlot.appendChild(buildSitmarTweetCard(campaign, sitmarTweetIndex));
  main.appendChild(cardSlot);

  const actions = document.createElement("div");
  actions.className = "sitmar-inline-post-actions";
  const postBtn = document.createElement("button");
  postBtn.type = "button";
  postBtn.className = "sc-generate-btn cc-cta sitmar-tweet-post-btn";
  const postLabel = document.createElement("span");
  postLabel.className = "sitmar-tweet-post-label";
  setText(postLabel, "Post on");
  postBtn.appendChild(postLabel);
  postBtn.insertAdjacentHTML("beforeend", SITMAR_ICON_X);
  postBtn.addEventListener("click", () => {
    sitmarPostSelectedTweet(campaign, sitmarTweetIndex, postBtn);
  });
  actions.appendChild(postBtn);
  main.appendChild(actions);
  row.appendChild(main);

  const options = document.createElement("div");
  options.className = "sitmar-inline-post-options";

  const toggleItems = tweets.map((tweet, i) => ({
    label: sitmarTweetLabel(tweet, i),
    icon: String(i + 1),
    ariaLabel: sitmarTweetLabel(tweet, i),
    primary: i === sitmarTweetIndex,
    iconBg: SITMAR_ACTION_ICON_STYLES[i % SITMAR_ACTION_ICON_STYLES.length].bg,
    iconColor:
      SITMAR_ACTION_ICON_STYLES[i % SITMAR_ACTION_ICON_STYLES.length].color,
    onClick: () => setInlinePostIndex(wrap, campaign, i),
  }));
  options.appendChild(buildActionGrid(toggleItems, { columns: 1 }));
  row.appendChild(options);
  wrap.appendChild(row);

  return wrap;
}

function buildSitmarInlinePostsLoadingBlock() {
  return sitmarChatProgressLine("Generating posts…");
}

function buildSitmarInlinePostsErrorBlock(campaign) {
  const wrap = document.createElement("div");
  wrap.className = "sitmar-inline-posts";
  wrap.dataset.sitmarInlinePosts = "1";
  const row = document.createElement("div");
  row.className = "sitmar-inline-posts-row";
  const msg = document.createElement("div");
  msg.className = "field-error";
  setText(msg, campaign.error || "Couldn't generate posts.");
  row.appendChild(msg);
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "sitmar-tweet-regen";
  setText(retry, "Retry");
  retry.addEventListener("click", () => sitmarRegenerateTweets(campaign.id));
  row.appendChild(retry);
  wrap.appendChild(row);
  return wrap;
}

function syncInlinePostsBlock(thread, campaign) {
  if (!thread || !campaign) return;
  removeInlinePostsBlock(thread);
  const status = String(campaign.status || "").toLowerCase();
  if (status === "drafting" && !sitmarHasDraftPosts(campaign)) {
    thread.appendChild(buildSitmarInlinePostsLoadingBlock());
    return;
  }
  if (status === "error") {
    thread.appendChild(buildSitmarInlinePostsErrorBlock(campaign));
    return;
  }
  if (shouldShowInlinePosts(campaign)) {
    const block = buildSitmarInlinePostsBlock(campaign);
    if (block) thread.appendChild(block);
  }
}

function renderSitmarTweets(campaign, inner) {
  const thread = document.createElement("div");
  thread.className = "sitmar-chat-thread";
  syncInlinePostsBlock(thread, campaign);
  inner.appendChild(thread);
}

async function sitmarRegenerateTweets(campaignId) {
  const campaign = findSitmarCampaignById(campaignId);
  if (campaign) {
    patchSitmarCampaignCaches(campaign, (c) => {
      c.status = "drafting";
      c.error = null;
    });
    sitmarTweetIndex = 0;
    const updated = findSitmarCampaignById(campaignId);
    if (isUnifiedChatActive(campaignId)) {
      syncInlinePostsBlock(unifiedChatThread, updated);
      const company = companies.find((c) => c.id === selectedBrandId);
      if (sitmarHasDraftPosts(updated)) {
        if (!unifiedChatShell?.querySelector(".sitmar-chat-composer")) {
          appendUnifiedCampaignComposer(unifiedChatShell, company, updated);
        } else {
          syncUnifiedComposer(updated, company);
        }
      } else {
        unifiedChatShell?.querySelector(".sitmar-chat-composer")?.remove();
      }
      scrollUnifiedChatToBottom();
    } else if (
      currentView === "brands" &&
      brandHomeViewMode === "content-generation" &&
      contentDesktopSelectedCampaignId === campaignId
    ) {
      const co = companies.find((c) => c.id === selectedBrandId);
      if (co && !renderBrandHomeContentColOnly(co)) renderBrandDetail(co);
    } else if (sitmarDetailCampaign?.id === campaignId) {
      renderSitmarDetail(updated);
    } else if (contentDesktopSelectedCampaignId === campaignId) {
      renderContentDesktopView();
    }
  }
  try {
    const { ok, status, body } = await api(
      `/api/sitmar/${encodeURIComponent(campaignId)}/regenerate-tweets`,
      { method: "POST" },
    );
    if (status === 401) return;
    if (handleUpgradeRequired(status)) return;
    if (!ok) {
      showToast(apiErrorMessage(body, "Couldn't regenerate tweets."));
      return selectSitmar(campaignId);
    }
    pendingSitmarJobs.add(campaignId);
    scheduleSitmarPolling(1200);
  } catch (err) {
    showToast("Network error: " + err.message);
    selectSitmar(campaignId);
  }
}

async function sitmarUpdateTweet(campaignId, index, text) {
  try {
    await api(`/api/sitmar/${encodeURIComponent(campaignId)}/update-tweet`, {
      method: "POST",
      body: { index, text },
    });
  } catch (_) {
    /* best-effort */
  }
}

function renderSitmarPosted(campaign, inner) {
  inner.appendChild(buildSitmarDistributeShell(campaign));
}

function renderSitmarDetail(campaign) {
  if (
    contentDesktopSelectedCampaignId &&
    campaign.id === contentDesktopSelectedCampaignId
  ) {
    contentDesktopDetailCampaign = campaign;
    sitmarDetailCampaign = campaign;
    if (
      currentView === "brands" &&
      brandHomeViewMode === "content-generation"
    ) {
      const co = companies.find((c) => c.id === selectedBrandId);
      if (co && !renderBrandHomeContentColOnly(co)) renderBrandDetail(co);
      return;
    }
    renderContentDesktopView();
    return;
  }
  sitmarDetailCampaign = campaign;
  const root = $("detail");
  root.innerHTML = "";
  const inner = document.createElement("div");
  inner.className = "detail-inner sitmar-detail-inner";
  const isPosted = campaign.status === "posted";
  if (!isPosted) {
    inner.appendChild(sitmarHeaderRow(campaign));
    inner.appendChild(sitmarContextCols(campaign));
  }

  if (campaign.status === "error") {
    appendSitmarErrorWithRetry(inner, campaign);
  } else if (
    campaign.status === "drafting" ||
    campaign.status === "drafted" ||
    campaign.status === "ready" ||
    campaign.status === "thinking" ||
    campaign.status === "selected"
  ) {
    renderSitmarChat(campaign, inner);
  } else if (campaign.status === "posted") {
    renderSitmarPosted(campaign, inner);
  } else {
    renderSitmarChat(campaign, inner);
  }

  root.appendChild(inner);
}

function contentCol(title, extraClass = "") {
  const col = document.createElement("section");
  col.className = "content-desktop-col" + (extraClass ? ` ${extraClass}` : "");
  const header = document.createElement("div");
  header.className = "content-col-header";
  const h2 = document.createElement("h2");
  setText(h2, title);
  header.appendChild(h2);
  col.appendChild(header);
  const scroll = document.createElement("div");
  scroll.className = "content-col-scroll";
  col.appendChild(scroll);
  return { col, header, scroll };
}

function contentEmpty(text) {
  const empty = document.createElement("div");
  empty.className = "content-col-empty";
  setText(empty, text);
  return empty;
}

function contentLoading(text) {
  const loading = document.createElement("div");
  loading.className = "content-col-loading";
  const spinner = document.createElement("span");
  spinner.className = "spinner";
  loading.appendChild(spinner);
  loading.appendChild(document.createTextNode(text));
  return loading;
}

function buildContentHistoryDraftCta() {
  return buildActionGrid(
    [
      {
        label: "Draft a post",
        iconHtml: SITMAR_ICON_PENCIL,
        ariaLabel: "Draft a post",
        iconBg: SITMAR_ICON_DRAFT_POST.bg,
        iconColor: SITMAR_ICON_DRAFT_POST.color,
        onClick: () => {
          void (async () => {
            const company = currentContentDesktopBrand();
            if (
              !(await requireSignIn({
                intent: {
                  action: "draftPost",
                  companyId: company?.id || "",
                  via: "studio",
                },
              }))
            )
              return;
            brandHomePendingPostContent = true;
            enterContentGeneration();
          })();
        },
      },
    ],
    { columns: 1 },
  );
}

function appendContentHistorySections(scroll, sections) {
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
          ? buildContentDraftListItem(campaign)
          : buildContentCampaignCard(campaign),
      ),
    );
    section.appendChild(list);
    scroll.appendChild(section);
  });
}

function postedCampaignText(campaign) {
  const seed = campaign.selected_seed || {};
  const rawTweetIdx = Number(seed.posted_tweet_index || 0);
  const tweetIdx =
    Number.isInteger(rawTweetIdx) && rawTweetIdx >= 0 ? rawTweetIdx : 0;
  const tweets = Array.isArray(campaign.tweets) ? campaign.tweets : [];
  const tweet = tweets[tweetIdx] || tweets[0] || {};
  return String(tweet.text || "").trim();
}

const SITMAR_XPOST_VERIFIED_SVG =
  '<svg viewBox="0 0 22 22" aria-label="Verified" width="15" height="15"><path fill="currentColor" d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.855-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.706 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"/></svg>';

const SITMAR_XPOST_ENG_ICONS = [
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 8.6 8.6 0 0 1-3.2-.6L4 21l1.9-4.4a8 8 0 0 1-1.4-4.6A8.4 8.4 0 0 1 13 3.7a8.4 8.4 0 0 1 8 7.8z"/></svg>',
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 20V10M9 20V4M15 20v-8M21 20V8"/></svg>',
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M17 3H7a2 2 0 0 0-2 2v16l7-5 7 5V5a2 2 0 0 0-2-2z"/></svg>',
];

function buildSitmarPostedXPost(campaign, options = {}) {
  const { linkable = true, variant = "full" } = options;
  const condensed = variant === "condensed";
  const seed = campaign.selected_seed || {};
  const rawTweetIdx = Number(seed.posted_tweet_index || 0);
  const tweetIdx =
    Number.isInteger(rawTweetIdx) && rawTweetIdx >= 0 ? rawTweetIdx : 0;
  const tweets = Array.isArray(campaign.tweets) ? campaign.tweets : [];
  const tweet = tweets[tweetIdx] || tweets[0] || {};

  let card;
  if (linkable && campaign.post_url) {
    card = document.createElement("a");
    card.href = campaign.post_url;
    card.target = "_blank";
    card.rel = "noopener";
  } else {
    card = document.createElement("div");
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
    badge.innerHTML = SITMAR_XPOST_VERIFIED_SVG;
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
    SITMAR_XPOST_ENG_ICONS.forEach((icon, idx) => {
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

function bindContentCampaignCardClick(card, campaign) {
  card.addEventListener("click", (event) => {
    if (event.target.closest("a, button")) return;
    if (isCampaignLockedByPaywall(campaign)) {
      openUpgradeModal();
      return;
    }
    if (currentView === "brands") {
      contentDesktopSelectedCampaignId = campaign.id;
      contentDesktopDetailCampaign = null;
      pendingSitmarJobs.add(campaign.id);
      void loadSitmar().then(() => {
        scheduleSitmarPolling(1200);
        enterContentGeneration(campaign.story_id || "");
      });
      return;
    }
    if (contentDesktopSelectedCampaignId === campaign.id) {
      contentDesktopSelectedCampaignId = "";
      contentDesktopDetailCampaign = null;
      sitmarDetailCampaign = null;
    } else {
      contentDesktopSelectedCampaignId = campaign.id;
      contentDesktopDetailCampaign = null;
    }
    updateContentDesktopCardSelection();
    if (renderContentRightSide()) return;
    renderContentDesktopView();
  });
}

function buildContentCampaignCard(campaign) {
  const selected = contentDesktopSelectedCampaignId === campaign.id;
  const status = String(campaign.status || "").toLowerCase();

  if (status === "posted") {
    const card = document.createElement("div");
    card.dataset.campaignId = campaign.id;
    card.className =
      "content-campaign-card content-campaign-card-posted" +
      (selected ? " is-selected" : "");
    card.appendChild(
      buildSitmarPostedXPost(campaign, {
        linkable: false,
        variant: "condensed",
      }),
    );
    bindContentCampaignCardClick(card, campaign);
    return card;
  }

  const copy = contentCampaignCopy(campaign);
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

  bindContentCampaignCardClick(card, campaign);
  return card;
}

function buildContentDraftListItem(campaign) {
  const selected = contentDesktopSelectedCampaignId === campaign.id;
  const copy = contentCampaignCopy(campaign);
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
    ? CONTENT_DRAFT_ICON_TWITTER
    : CONTENT_DRAFT_ICON_MESSAGES_SQUARE;
  item.appendChild(icon);

  const body = document.createElement("div");
  body.className =
    "content-history-draft-body" + (isPost ? " is-post" : " is-react");

  if (isPost) {
    const tweet = document.createElement("div");
    tweet.className = "content-history-draft-tweet";
    setText(tweet, postedCampaignText(campaign) || "Untitled post");
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

  bindContentCampaignCardClick(item, campaign);
  return item;
}

const CONTENT_DRAFT_ICON_MESSAGES_SQUARE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.07.613l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"/></svg>';

const CONTENT_DRAFT_ICON_TWITTER =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/></svg>';

function contentCampaignCopy(campaign) {
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

function contentCampaignStatusLabel(status) {
  const value = String(status || "").toLowerCase();
  if (value === "posted") return "Distribute";
  if (value === "drafted") return "Post";
  return "React";
}

function buildContentCol1() {
  const sections = filteredContentHistorySections();
  const { col, scroll } = contentCol("Content", "content-col-content");
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
    scroll.appendChild(note);
  }
  if (!visibleCount) {
    const empty = document.createElement("div");
    empty.className = "content-history-empty";
    scroll.appendChild(empty);
    empty.appendChild(buildContentHistoryDraftCta());
    return col;
  }
  appendContentHistorySections(scroll, sections);
  return col;
}

function contentStoryKey(story) {
  return String(story.story_id || story.id || story.headline || "").trim();
}

function aggregateContentStories() {
  const company = currentContentDesktopBrand();
  if (!company) return [];
  return contentStoriesFeed.map((story) => ({
    ...story,
    _contentCompanyId: company.id,
    _contentCompany: company,
  }));
}

function contentStorySortParam() {
  if (contentDesktopStorySortMode === "brand_score") return "brand_score";
  if (contentDesktopStorySortMode === "activity") return "activity";
  return "recency";
}

async function loadContentStoriesPage({ append = false } = {}) {
  const company = currentContentDesktopBrand();
  if (!company) return [];
  const offset = append ? contentStoriesOffset : 0;
  const params = new URLSearchParams({
    limit: String(TREND_STORIES_PAGE_SIZE),
    offset: String(offset),
    company_id: company.id,
    sort: contentStorySortParam(),
    min_brand_score: "0.1",
    include_posts: "0",
    posts_per_story: "0",
  });
  const { ok, status, body } = await api(
    `/api/trends/stories?${params.toString()}`,
    {
      method: "GET",
    },
  );
  if (status === 401) {
    return null;
  }
  if (!ok) return null;
  const rows = Array.isArray(body?.stories) ? body.stories : [];
  if (append) contentStoriesFeed = contentStoriesFeed.concat(rows);
  else contentStoriesFeed = rows;
  contentStoriesOffset = contentStoriesFeed.length;
  contentStoriesHasMore = rows.length === TREND_STORIES_PAGE_SIZE;
  return rows;
}

async function maybeLoadMoreContentStories() {
  if (
    currentView !== "sitmar" ||
    contentDesktopSelectedCampaignId ||
    contentStoriesLoadingMore ||
    !contentStoriesHasMore
  ) {
    return;
  }
  contentStoriesLoadingMore = true;
  try {
    const rows = await loadContentStoriesPage({ append: true });
    if (rows === null) return;
    if (renderContentCol2Only()) return;
    renderContentDesktopView();
  } finally {
    contentStoriesLoadingMore = false;
  }
}

function bindContentStoriesScroll(el) {
  if (!el) return;
  el.addEventListener(
    "scroll",
    () => {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (remaining > 220) return;
      void maybeLoadMoreContentStories();
    },
    { passive: true },
  );
}

function buildContentStorySortButton() {
  const sortBtn = document.createElement("button");
  sortBtn.type = "button";
  sortBtn.className = "sc-sortbtn content-story-sort";
  sortBtn.setAttribute(
    "aria-label",
    "Sort stories by " + storySortLabel(contentDesktopStorySortMode),
  );
  sortBtn.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M6 12h12M10 18h4"/></svg>';
  const label = document.createElement("span");
  setText(label, storySortLabel(contentDesktopStorySortMode));
  sortBtn.appendChild(label);
  sortBtn.addEventListener("click", () => {
    const idx = CONTENT_DESKTOP_SORT_MODES.indexOf(contentDesktopStorySortMode);
    contentDesktopStorySortMode =
      CONTENT_DESKTOP_SORT_MODES[(idx + 1) % CONTENT_DESKTOP_SORT_MODES.length];
    contentStoriesFeed = [];
    contentStoriesOffset = 0;
    contentStoriesHasMore = true;
    contentStoriesLoadingMore = false;
    if (renderContentCol2Only()) return;
    renderContentDesktopView();
  });
  return sortBtn;
}

function ensureContentDesktopTrends() {
  if (
    !contentStoriesFeed.length &&
    contentStoriesHasMore &&
    !contentStoriesLoadingMore
  ) {
    contentStoriesLoadingMore = true;
    void loadContentStoriesPage({ append: false }).finally(() => {
      contentStoriesLoadingMore = false;
      if (currentView === "sitmar" && !contentDesktopSelectedCampaignId) {
        if (renderContentCol2Only()) return;
        renderContentDesktopView();
      }
    });
  }
  return contentStoriesLoadingMore && contentStoriesFeed.length === 0;
}

function buildContentStoryRow(story) {
  const tone = storyUrgency(story.story_last_seen_at).tone;
  const card = document.createElement("div");
  card.className = `sc-card content-story-card is-${tone}`;

  const top = document.createElement("div");
  top.className = "content-story-top";

  const info = document.createElement("div");
  info.className = "content-story-info";
  appendStoriesCardHeadAndStats(info, story, {
    generateBtn: buildScGenerateBtn({
      ariaLabel: "React with content",
      onClick: (event) => {
        event.stopPropagation();
        enterContentGuidedChat(story, story._contentCompanyId);
      },
    }),
  });
  top.appendChild(info);

  const detail = buildStoriesDetailContent(story, story._contentCompany, {
    contentMode: true,
    hideActions: true,
    onReact: () => enterContentGuidedChat(story, story._contentCompanyId),
  });

  card.appendChild(top);
  card.appendChild(detail);
  card.addEventListener("click", (event) => {
    if (event.target.closest("button, a")) return;
    enterContentGuidedChat(story, story._contentCompanyId);
  });
  return card;
}

function buildContentCol2(loading) {
  const { col, header, scroll } = contentCol("Stories", "content-col-stories");
  header.appendChild(buildContentStorySortButton());
  const stories = aggregateContentStories();
  if (loading && !stories.length) {
    scroll.appendChild(contentLoading("Loading stories…"));
    return col;
  }
  if (!stories.length) {
    scroll.appendChild(contentEmpty("No stories yet."));
    return col;
  }
  stories.forEach((story) => scroll.appendChild(buildContentStoryRow(story)));
  bindContentStoriesScroll(scroll);
  return col;
}

let contentDesktopRenderQueued = false;

function renderContentDesktopView() {
  if (contentDesktopRenderQueued) return;
  contentDesktopRenderQueued = true;
  requestAnimationFrame(() => {
    contentDesktopRenderQueued = false;
    if (currentView !== "sitmar") return;
    renderContentDesktopViewNow();
  });
}

function renderContentDesktopViewNow() {
  syncContentDesktopLayout();
  selectedSitmarId = null;
  $("sidebar-list").innerHTML = "";

  if (!companies.length) {
    contentDesktopBody = null;
    const root = $("detail");
    root.innerHTML = "";
    const inner = document.createElement("div");
    inner.className =
      "detail-inner content-desktop-detail stories-desktop-view sc-phone-view";
    const shell = document.createElement("div");
    shell.className = "content-desktop-shell";
    shell.appendChild(
      contentDesktopCompaniesLoadAttempted && !contentDesktopCompaniesLoad
        ? contentEmpty("No brands yet.")
        : contentLoading("Loading brands…"),
    );
    inner.appendChild(shell);
    root.appendChild(inner);
    if (!contentDesktopCompaniesLoad && !contentDesktopCompaniesLoadAttempted) {
      contentDesktopCompaniesLoad = loadCompanies().finally(() => {
        contentDesktopCompaniesLoad = null;
        contentDesktopCompaniesLoadAttempted = true;
        if (currentView === "sitmar") renderContentDesktopView();
      });
    }
    return;
  }

  const loading = ensureContentDesktopTrends();
  if (mountedContentDesktopBody()) {
    renderContentCol1Only();
    renderContentRightSide(loading);
    return;
  }
  const hasSelection = !!contentDesktopSelectedCampaignId;
  const root = $("detail");
  root.innerHTML = "";
  const inner = document.createElement("div");
  inner.className =
    "detail-inner content-desktop-detail stories-desktop-view sc-phone-view";
  const shell = document.createElement("div");
  shell.className = "content-desktop-shell";
  const body = document.createElement("div");
  body.className = "content-desktop-body" + (hasSelection ? " has-detail" : "");
  body.appendChild(buildContentCol1());
  if (hasSelection) {
    body.appendChild(buildContentDetailPane());
  } else {
    body.appendChild(buildContentCol2(loading));
  }
  shell.appendChild(body);
  inner.appendChild(shell);
  root.appendChild(inner);
  contentDesktopBody = body;
}

function buildContentDetailPane() {
  const pane = document.createElement("div");
  pane.className = "content-detail-pane";

  const campaign = contentDesktopDetailCampaign;
  const listCampaign = sitmarCampaigns.find(
    (c) => c.id === contentDesktopSelectedCampaignId,
  );

  if (!listCampaign) {
    contentDesktopSelectedCampaignId = "";
    return pane;
  }

  const listStatus = String(listCampaign.status || "").toLowerCase();
  const detailStatus = String(campaign?.status || "").toLowerCase();
  const status = listStatus || detailStatus;
  const needsDetail =
    status === "thinking" ||
    status === "ready" ||
    status === "selected" ||
    status === "drafted" ||
    status === "error" ||
    status === "posted";

  if (needsDetail && sitmarCampaignNeedsFullDetail(listCampaign, campaign)) {
    pane.appendChild(contentLoading("Loading…"));
    fetchContentCampaignDetail(listCampaign.id);
    return pane;
  }

  const source = needsDetail && campaign ? campaign : listCampaign;

  if (status === "posted") {
    renderContentPostedView(source, pane);
    return pane;
  }

  if (status === "error") {
    pane.appendChild(sitmarHeaderRow(source));
    appendSitmarErrorWithRetry(pane, source);
  } else if (isChatStatus(status)) {
    pane.classList.add("content-detail-chat");
    renderSitmarChat(source, pane);
  }

  if (isSitmarPending(source)) {
    pendingSitmarJobs.add(source.id);
    scheduleSitmarPolling(1500);
  }

  return pane;
}

function refreshSitmarDistributeView(campaignId) {
  if (contentDesktopSelectedCampaignId === campaignId) {
    if (currentView === "brands" && selectedBrandId) {
      const co = companies.find((c) => c.id === selectedBrandId);
      if (co && !renderBrandHomeContentColOnly(co)) renderBrandDetail(co);
      else if (co) {
        renderBrandHomeStoriesColOnly(co);
        renderBrandHomeContentColOnly(co);
      }
    } else if (currentView === "sitmar") {
      renderContentDesktopView();
    }
    return;
  }
  if (sitmarDetailCampaign?.id === campaignId) {
    renderSitmarDetail(sitmarDetailCampaign);
  }
}

function buildSitmarDistributeSidebarToggle(campaign) {
  const toggle = document.createElement("div");
  toggle.className =
    "distribute-seg-toggle distribute-sidebar-toggle distribute-tab-toggle";
  toggle.dataset.distributeToggle = "sidebar";
  const storyId = String(campaign.story_id || "").trim();
  const queueCount = getSitmarDistributeQueuePosts(storyId).length;
  const sentCount = sitmarDistributeSentPosts.size;

  const mkSeg = (icon, label, count, active, onClick) => {
    const el = active
      ? document.createElement("span")
      : document.createElement("button");
    if (!active) {
      el.type = "button";
      el.addEventListener("click", onClick);
    } else {
      el.setAttribute("aria-current", "true");
    }
    el.className = "distribute-seg" + (active ? " distribute-seg-on" : "");
    el.setAttribute("aria-label", label);
    el.innerHTML = sitmarDistributeSidebarSegHtml(icon, count);
    return el;
  };

  const showQueue = () => {
    sitmarDistributeTab = "queue";
    refreshSitmarDistributeView(campaign.id);
  };
  const showSent = () => {
    sitmarDistributeTab = "sent";
    refreshSitmarDistributeView(campaign.id);
  };

  if (sitmarDistributeTab === "queue") {
    toggle.appendChild(
      mkSeg(
        SITMAR_DISTRIBUTE_ICON_LAYOUT_LIST,
        "Reply queue",
        queueCount,
        true,
      ),
    );
    toggle.appendChild(
      mkSeg(
        SITMAR_DISTRIBUTE_ICON_SEND,
        "Sent replies",
        sentCount,
        false,
        showSent,
      ),
    );
  } else {
    toggle.appendChild(
      mkSeg(
        SITMAR_DISTRIBUTE_ICON_LAYOUT_LIST,
        "Reply queue",
        queueCount,
        false,
        showQueue,
      ),
    );
    toggle.appendChild(
      mkSeg(SITMAR_DISTRIBUTE_ICON_SEND, "Sent replies", sentCount, true),
    );
  }
  return toggle;
}

function buildSitmarDistributeSegToggle(campaign) {
  const toggle = document.createElement("div");
  toggle.className = "distribute-seg-toggle distribute-tab-toggle";
  const storyId = String(campaign.story_id || "").trim();
  const queueCount = getSitmarDistributeQueuePosts(storyId).length;
  const sentCount = sitmarDistributeSentPosts.size;
  const inSidebar = sitmarDistributeQueueInSidebar();
  const queueLabel = `${inSidebar ? "Reply" : "Queue"}${queueCount ? ` <span class="distribute-seg-n">${queueCount}</span>` : ""}`;
  const sentLabel = `Sent${sentCount ? ` <span class="distribute-seg-n">${sentCount}</span>` : ""}`;
  const mkActive = (html) => {
    const el = document.createElement("span");
    el.className = "distribute-seg distribute-seg-on";
    el.innerHTML = html;
    return el;
  };
  const mkInactive = (html, onClick) => {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "distribute-seg";
    el.innerHTML = html;
    el.addEventListener("click", onClick);
    return el;
  };
  if (sitmarDistributeTab === "queue") {
    toggle.appendChild(mkActive(queueLabel));
    toggle.appendChild(
      mkInactive(sentLabel, () => {
        sitmarDistributeTab = "sent";
        refreshSitmarDistributeView(campaign.id);
      }),
    );
  } else {
    toggle.appendChild(
      mkInactive(queueLabel, () => {
        sitmarDistributeTab = "queue";
        refreshSitmarDistributeView(campaign.id);
      }),
    );
    toggle.appendChild(mkActive(sentLabel));
  }
  return toggle;
}

function renderSitmarDistributeQueueList(campaign, host) {
  const storyId = String(campaign.story_id || "").trim();
  if (!storyId) return;

  host.innerHTML = "";
  const cached = sitmarDistributeStoryCache.get(storyId);
  if (!cached) {
    host.appendChild(contentLoading("Loading story conversation…"));
    fetchSitmarDistributeStory(campaign);
    return;
  }

  const posts = getSitmarDistributeQueuePosts(storyId);
  if (!posts.length) {
    const rawPosts = Array.isArray(cached.posts) ? cached.posts : [];
    host.appendChild(
      contentEmpty(
        rawPosts.length
          ? "Check back later for high-engagement posts to hijack."
          : "No story posts found yet.",
      ),
    );
    return;
  }

  const campaignId = campaign.id;
  const activeIdx = sitmarDistributeQueueIndex.get(campaignId) ?? 0;
  const activePost = posts[activeIdx] || posts[0];
  const activeKey = sitmarDistributePostKey(storyId, activePost);

  const list = document.createElement("div");
  list.className = "mobile-distribute-queue-list";

  posts.forEach((post) => {
    const postKey = sitmarDistributePostKey(storyId, post);
    const item = buildDistributeQueueListItem(post, {
      isActive: postKey === activeKey,
    });
    item.addEventListener("click", () =>
      selectSitmarDistributeQueuePost(campaign, post),
    );
    list.appendChild(item);
  });

  host.appendChild(list);
}

function renderSitmarDistributeSentSidebarList(campaign, host) {
  host.innerHTML = "";
  const entries = Array.from(sitmarDistributeSentPosts.values());
  if (!entries.length) {
    host.appendChild(contentEmpty("No replies sent yet."));
    return;
  }
  const list = document.createElement("div");
  list.className =
    "mobile-distribute-queue-list mobile-distribute-sent-sidebar-list";
  entries.reverse().forEach((entry) => {
    list.appendChild(buildDistributeSentListItem(entry, { readOnly: true }));
  });
  host.appendChild(list);
}

function renderSitmarDistributeSidebarList(campaign, host) {
  if (sitmarDistributeTab === "sent") {
    renderSitmarDistributeSentSidebarList(campaign, host);
  } else {
    renderSitmarDistributeQueueList(campaign, host);
  }
}

function renderSitmarDistributeSentView(host) {
  const entries = Array.from(sitmarDistributeSentPosts.values());
  if (!entries.length) {
    host.appendChild(contentEmpty("No replies sent yet."));
    return;
  }
  const list = document.createElement("div");
  list.className = "distribute-sent-list";
  entries.reverse().forEach((entry) => {
    list.appendChild(buildDistributeSentListItem(entry));
  });
  host.appendChild(list);
}

function renderSitmarDistributeStory(campaign, host) {
  const storyId = String(campaign.story_id || "").trim();
  if (!storyId) {
    host.appendChild(contentEmpty("No story linked to this campaign."));
    return;
  }

  const cached = sitmarDistributeStoryCache.get(storyId);
  const isFresh =
    cached && Date.now() - Number(cached.fetchedAt || 0) < 5 * 60 * 1000;

  if (isFresh) {
    renderSitmarDistributePostQueue(host, campaign);
    return;
  }

  host.appendChild(contentLoading("Loading story conversation…"));
  fetchSitmarDistributeStory(campaign);
}

function renderSitmarDistributePostQueue(host, campaign) {
  const storyId = String(campaign.story_id || "").trim();
  const campaignId = campaign.id;
  const cached = sitmarDistributeStoryCache.get(storyId);
  const rawPosts = Array.isArray(cached?.posts) ? cached.posts : [];
  const activePosts = () => getSitmarDistributeQueuePosts(storyId);

  host.innerHTML = "";
  if (!rawPosts.length) {
    host.appendChild(contentEmpty("No story posts found yet."));
    return;
  }
  if (!activePosts().length) {
    host.appendChild(
      contentEmpty("Check back later for high-engagement posts to hijack."),
    );
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
  replyBtn.className =
    "sitmar-tweet-post-btn sc-generate-btn cc-cta distribute-reply-btn";
  replyBtn.innerHTML =
    '<span class="sitmar-tweet-post-label">Reply on</span>' + SITMAR_ICON_X;

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

  let queueIndex = sitmarDistributeQueueIndex.get(campaignId) ?? 0;
  let postUrlInputOpen = false;
  let postUrlInputDraft = "";

  function replyKey(post) {
    return sitmarDistributeReplyKey(campaignId, post);
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
          setText(textEl, replyTextWithPostUrl(normalizeReplyDraftText(current)));
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
      if (!sitmarDistributeReplyInFlight.has(inflightKey)) return;
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
    if (sitmarDistributeReplyInFlight.has(inflightKey)) {
      await waitForReplyCache(key, inflightKey);
      if (distributeReplyDraftHas(key)) {
        paintReply(post, distributeReplyDraftGet(key));
      }
      return;
    }
    sitmarDistributeReplyInFlight.add(inflightKey);
    try {
      const { ok, status, body } = await api(
        `/api/sitmar/${encodeURIComponent(campaignId)}/reply`,
        {
          method: "POST",
          body: {
            post_text: post.text || "",
            post_author: post.author_name || post.author_handle || "",
            feedback: feedback || "",
          },
        },
      );
      if (status === 401) return;
      const reply = ok ? body?.reply || "" : "";
      if (reply) {
        distributeReplyDraftSet(key, reply);
        if (isReplyHostForPost(post)) paintReply(post, reply);
      }
    } catch {
      /* keep existing reply ui on transient failures */
    } finally {
      sitmarDistributeReplyInFlight.delete(inflightKey);
    }
  }

  function dismissCurrent({ persist = true } = {}) {
    const posts = activePosts();
    const post = posts[queueIndex];
    if (post) {
      sitmarDistributeDismissed.add(sitmarDistributePostKey(storyId, post));
      distributeReplyDraftDelete(replyKey(post));
      if (persist) persistSitmarDistributeSkip(campaign, post);
    }
    const remaining = activePosts();
    if (queueIndex >= remaining.length) {
      queueIndex = Math.max(0, remaining.length - 1);
    }
    sitmarDistributeQueueIndex.set(campaignId, queueIndex);
    syncSitmarDistributeToggleCounts(campaign);
    refreshSitmarDistributeQueueSidebar(campaign);
    renderCurrent();
  }

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
        const { ok, body: rb } = await api(
          `/api/sitmar/${encodeURIComponent(campaign.id)}/post-url`,
          { method: "POST", body: { post_url: url } },
        );
        if (!ok) {
          showToast(apiErrorMessage(rb, "Couldn't save post URL."));
          submitBtn.disabled = false;
          return;
        }
        campaign.post_url = url;
        patchSitmarCampaignCaches(campaign, (c) => {
          c.post_url = url;
        });
        postUrlInputOpen = false;
        postUrlInputDraft = "";
        renderPostUrlHost();
      } catch (err) {
        showToast("Network error: " + err.message);
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
    queueIndex = sitmarDistributeQueueIndex.get(campaignId) ?? queueIndex;
    const posts = activePosts();
    if (!posts.length) {
      sitmarDistributeQueueIndex.set(campaignId, 0);
      host.innerHTML = "";
      host.appendChild(
        contentEmpty("Check back later for high-engagement posts to hijack."),
      );
      syncSitmarDistributeToggleCounts(campaign);
      return;
    }

    if (queueIndex >= posts.length) queueIndex = 0;
    sitmarDistributeQueueIndex.set(campaignId, queueIndex);

    const post = posts[queueIndex];
    replyHost.dataset.replyKey = replyKey(post);
    cardHost.innerHTML = "";
    renderDistributeQueueCardStack(cardHost, posts, queueIndex, {
      showWindowBadge: true,
    });

    const cachedReply = distributeReplyDraftGet(replyKey(post));
    replyHost.innerHTML = "";
    if (cachedReply) {
      paintReply(post, cachedReply);
    } else {
      fetchReply(post);
    }

    renderPostUrlHost();

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
      const postKey = sitmarDistributePostKey(storyId, post);
      sitmarDistributeSentPosts.set(postKey, {
        post,
        sentAt: Date.now(),
        reply: sentText,
      });
      persistSitmarDistributeSent(campaign, post, sentText);
      trackEvent("distribute_reply_sent", {
        campaign_id: campaign.id,
        story_id: campaign.story_id || "",
      });
      showToast("Reply opened on X");
      syncSitmarDistributeToggleCounts(campaign);
      dismissCurrent({ persist: false });
      refreshSitmarDistributeQueueSidebar(campaign);
      window.open(intentUrl, "_blank", "noopener");
    };
    dismissBtn.onclick = () => dismissCurrent();
  };

  renderCurrent();
}

function buildSitmarDistributeShell(campaign) {
  const wrap = document.createElement("div");
  wrap.className =
    "content-posted-center stories-desktop-detail sitmar-distribute-shell";
  const inSidebar = sitmarDistributeQueueInSidebar();
  if (inSidebar) {
    wrap.classList.add("sitmar-distribute-shell-sidebar-queue");
  } else {
    wrap.appendChild(buildSitmarDistributeSegToggle(campaign));
  }
  const host = document.createElement("div");
  host.className = "distribute-content";
  wrap.appendChild(host);
  if (!inSidebar && sitmarDistributeTab === "sent") {
    renderSitmarDistributeSentView(host);
  } else {
    renderSitmarDistributeStory(campaign, host);
  }
  return wrap;
}

function renderContentPostedView(campaign, pane) {
  hydrateSitmarDistributeState(campaign, { force: true });
  pane.classList.add("content-detail-posted");
  pane.appendChild(buildSitmarDistributeShell(campaign));
  syncAppRouteFromState();
}

async function fetchContentCampaignDetail(campaignId) {
  const id = String(campaignId || "").trim();
  if (!id) return false;
  const cached = findSitmarCampaignById(id);
  if (cached && isCampaignLockedByPaywall(cached)) {
    openUpgradeModal();
    return false;
  }
  const existing = sitmarDetailInFlight.get(id);
  if (existing) return existing;
  const request = (async () => {
    try {
    const { ok, status, body } = await api(
      `/api/sitmar/${encodeURIComponent(id)}`,
      { method: "GET" },
    );
    if (status === 401) return false;
    if (!ok || !body || !body.campaign) {
      console.warn(
        "fetchContentCampaignDetail failed",
        id,
        status,
        body,
      );
      return false;
    }
    contentDesktopDetailCampaign = body.campaign;
    sitmarDetailCampaign = body.campaign;
    hydrateSitmarDistributeState(body.campaign, { force: true });
    if (contentDesktopSelectedCampaignId !== id) return true;
    const posted =
      String(body.campaign.status || "").toLowerCase() === "posted";
    if (
      posted &&
      document.querySelector(".sitmar-distribute-shell .distribute-content")
    ) {
      return true;
    }
    if (currentView === "brands" && selectedBrandId) {
      const co = companies.find((c) => c.id === selectedBrandId);
      if (co && brandHomeViewMode === "content-generation") {
        if (isUnifiedChatActive(id)) {
          const s = String(
            contentDesktopDetailCampaign?.status || "",
          ).toLowerCase();
          if (isUnifiedCampaignStatus(s)) {
            syncUnifiedThread(contentDesktopDetailCampaign);
            return true;
          }
        }
        if (!renderBrandHomeContentColOnly(co)) renderBrandDetail(co);
      }
    } else if (currentView === "sitmar") {
      renderContentDesktopView();
    }
    return true;
  } catch (err) {
    console.warn("fetchContentCampaignDetail error", id, err);
    return false;
    }
  })();
  sitmarDetailInFlight.set(id, request);
  try {
    return await request;
  } finally {
    if (sitmarDetailInFlight.get(id) === request) {
      sitmarDetailInFlight.delete(id);
    }
  }
}

async function startHomeCampaignFromStory({ companyId, story, errEl = null }) {
  if (!(await requireSignIn())) return null;
  const { ok, status, body } = await api("/api/home/start-campaign", {
    method: "POST",
    body: { company_id: companyId, story_id: story.story_id },
  });
  if (status === 401) {
    return null;
  }
  if (handleUpgradeRequired(status)) return null;
  if (!ok || !body || !body.campaign) {
    const message = apiErrorMessage(body, "Couldn't start the campaign.");
    if (errEl) setText(errEl, message);
    else showToast(message);
    return null;
  }
  return body.campaign;
}

async function createSitmarCampaignFromStory({
  companyId,
  story,
  systemPromptPrefix = null,
  errEl = null,
}) {
  if (!(await requireSignIn())) return null;
  const { ok, status, body } = await api("/api/sitmar", {
    method: "POST",
    body: {
      company_id: companyId,
      story_id: story.story_id,
      system_prompt_prefix: systemPromptPrefix,
    },
  });
  if (status === 401) {
    return null;
  }
  if (handleUpgradeRequired(status)) return null;
  if (!ok || !body || !body.campaign) {
    const message = apiErrorMessage(body, "Couldn't start the campaign.");
    if (errEl) setText(errEl, message);
    else showToast(message);
    return null;
  }
  trackEvent("campaign_created", { campaign_id: body.campaign.id });
  return body.campaign;
}

async function openContentCampaignChat(campaignId, storyId) {
  const cached = findSitmarCampaignById(campaignId);
  if (cached && isCampaignLockedByPaywall(cached)) {
    openUpgradeModal();
    return;
  }
  pendingSitmarJobs.add(campaignId);
  contentDesktopSelectedCampaignId = campaignId;
  if (
    !contentDesktopDetailCampaign ||
    contentDesktopDetailCampaign.id !== campaignId
  ) {
    contentDesktopDetailCampaign = null;
    const listCampaign = sitmarCampaigns.find((c) => c.id === campaignId);
    if (listCampaign) contentDesktopDetailCampaign = { ...listCampaign };
  }
  if (currentView === "brands" && selectedBrandId) {
    const co = companies.find((c) => c.id === selectedBrandId);
    if (co) {
      scheduleSitmarPolling(1200);
      enterContentGeneration(storyId || "");
      return;
    }
  }
  if (currentView === "sitmar") {
    await selectSitmar(campaignId);
    scheduleSitmarPolling(1200);
    return;
  }
  renderSitmarSidebar();
  await selectSitmar(campaignId);
  scheduleSitmarPolling(1200);
}

async function createAndOpenContentCampaignChat(story, companyId) {
  const key = `${companyId}:${story.story_id || ""}`;
  if (contentStoryCampaignStartInFlight.has(key)) return;
  contentStoryCampaignStartInFlight.add(key);
  try {
    const campaign = await startHomeCampaignFromStory({ companyId, story });
    if (!campaign) return;
    contentDesktopDetailCampaign = campaign;
    await openContentCampaignChat(campaign.id, story.story_id || "");
  } catch (err) {
    showToast("Network error: " + err.message);
  } finally {
    contentStoryCampaignStartInFlight.delete(key);
  }
}

function enterContentGuidedChat(story, companyId) {
  const company = companies.find((row) => row.id === companyId);
  if (!company) {
    showToast("Brand not found for this story.");
    return;
  }
  void createAndOpenContentCampaignChat(story, company.id);
}

async function sitmarSendMessage(campaignId, text) {
  if (!(await requireSignIn())) return;
  const campaign = findSitmarCampaignById(campaignId);
  const tweetIndex =
    campaign && String(campaign.status || "").toLowerCase() === "drafted"
      ? sitmarActiveTweetIndex(campaign)
      : null;
  if (campaign) {
    patchSitmarCampaignCaches(campaign, (c) => {
      c.messages = (c.messages || []).concat({ role: "user", text });
      c.status = "thinking";
    });
    if (isUnifiedChatActive(campaignId)) {
      unifiedChatThread.appendChild(sitmarBubble("user", text));
      unifiedRenderedCount += 1;
      scrollUnifiedChatToBottom();
      applyUnifiedOptimisticThinking(campaign);
    } else {
      renderSitmarDetail(campaign);
    }
  }
  try {
    const { ok, status, body } = await api(
      `/api/sitmar/${encodeURIComponent(campaignId)}/message`,
      { method: "POST", body: sitmarMessagePayload(text, tweetIndex) },
    );
    if (status === 401) return;
    if (handleUpgradeRequired(status)) return;
    if (!ok) {
      showToast(apiErrorMessage(body, "Couldn't send message."));
      return selectSitmar(campaignId);
    }
    pendingSitmarJobs.add(campaignId);
    scheduleSitmarPolling(1200);
  } catch (err) {
    showToast("Network error: " + err.message);
    selectSitmar(campaignId);
  }
}

async function sitmarSelectSeed(campaignId, seedIndex) {
  if (!(await requireSignIn())) return;
  const campaign = findSitmarCampaignById(campaignId);
  if (campaign) {
    const seeds = sitmarLatestSeeds(campaign);
    const chosen = seeds[seedIndex] || {};
    const chosenTitle =
      String(chosen.title || "").trim() || "Selected direction";
    patchSitmarCampaignCaches(campaign, (c) => {
      c.messages = (c.messages || []).concat({
        role: "user",
        text: chosenTitle,
      });
      c.status = "drafting";
      c.tweets = [];
      c.selected_seed = { title: chosen.title, blurb: chosen.blurb };
    });
    sitmarTweetIndex = 0;
    const updated = findSitmarCampaignById(campaignId);
    if (isUnifiedChatActive(campaignId)) {
      historicizeUnifiedActionGrids();
      unifiedChatThread.appendChild(sitmarBubble("user", chosenTitle));
      unifiedRenderedCount += 1;
      syncInlinePostsBlock(unifiedChatThread, updated);
      unifiedChatShell?.querySelector(".sitmar-chat-composer")?.remove();
      scrollUnifiedChatToBottom();
    } else if (
      currentView === "brands" &&
      brandHomeViewMode === "content-generation" &&
      contentDesktopSelectedCampaignId === campaignId
    ) {
      const co = companies.find((c) => c.id === selectedBrandId);
      if (co && !renderBrandHomeContentColOnly(co)) renderBrandDetail(co);
    } else {
      renderSitmarDetail(updated);
    }
  }
  try {
    const { ok, status, body } = await api(
      `/api/sitmar/${encodeURIComponent(campaignId)}/select`,
      { method: "POST", body: { seed_index: seedIndex } },
    );
    if (status === 401) return;
    if (handleUpgradeRequired(status)) return;
    if (!ok) {
      showToast(apiErrorMessage(body, "Couldn't start the campaign."));
      return selectSitmar(campaignId);
    }
    trackEvent("seed_selected", {
      campaign_id: campaignId,
      seed_index: seedIndex,
    });
    pendingSitmarJobs.add(campaignId);
    scheduleSitmarPolling(1200);
  } catch (err) {
    showToast("Network error: " + err.message);
    selectSitmar(campaignId);
  }
}

async function sitmarPostCampaign(campaignId) {
  if (!(await requireSignIn())) return;
  const campaign = findSitmarCampaignById(campaignId);
  if (campaign) {
    patchSitmarCampaignCaches(campaign, (c) => {
      c.status = "drafting";
      c.tweets = [];
    });
    sitmarTweetIndex = 0;
    renderSitmarDetail(campaign);
  }
  try {
    const { ok, status, body } = await api(
      `/api/sitmar/${encodeURIComponent(campaignId)}/post`,
      { method: "POST" },
    );
    if (status === 401) return;
    if (handleUpgradeRequired(status)) return;
    if (!ok) {
      showToast(apiErrorMessage(body, "Couldn't generate posts."));
      return selectSitmar(campaignId);
    }
    pendingSitmarJobs.add(campaignId);
    scheduleSitmarPolling(1200);
  } catch (err) {
    showToast("Network error: " + err.message);
    selectSitmar(campaignId);
  }
}

function scheduleSitmarPolling(delayMs = 1500) {
  if (!pendingSitmarJobs.size) {
    if (sitmarPollTimer) {
      clearTimeout(sitmarPollTimer);
      sitmarPollTimer = null;
    }
    return;
  }
  if (sitmarPollTimer) return;
  sitmarPollTimer = setTimeout(runSitmarPolling, delayMs);
}

async function pollCampaignStatus(campaignId) {
  try {
    const { ok, status, body } = await api(
      `/api/sitmar/${encodeURIComponent(campaignId)}/status`,
      { method: "GET" },
    );
    if (status === 401 || !ok || !body) return null;
    return body;
  } catch (_) {
    return null;
  }
}

async function runSitmarPolling() {
  sitmarPollTimer = null;
  if (!pendingSitmarJobs.size) return;
  const brandHomePolling =
    currentView === "brands" &&
    brandHomeViewMode === "content-generation" &&
    contentDesktopSelectedCampaignId;
  if (currentView !== "sitmar" && !brandHomePolling) return;
  if (sitmarPollInFlight) return scheduleSitmarPolling();
  sitmarPollInFlight = true;
  try {
    const ids = [...pendingSitmarJobs];
    const results = await Promise.all(ids.map(pollCampaignStatus));
    let changed = false;
    const fetchSelectedDetail = new Set();
    for (let i = 0; i < ids.length; i++) {
      const r = results[i];
      if (!r) continue;
      const id = ids[i];
      if (!isSitmarPending({ status: r.status })) {
        if (id === contentDesktopSelectedCampaignId) {
          fetchSelectedDetail.add(id);
        } else {
          pendingSitmarJobs.delete(id);
        }
        changed = true;
      }
      const cached = sitmarCampaigns.find((c) => c.id === id);
      if (cached && cached.status !== r.status) {
        cached.status = r.status;
        cached.updated_at = r.updated_at;
        changed = true;
        if (id === contentDesktopSelectedCampaignId)
          fetchSelectedDetail.add(id);
      }
    }
    if (contentDesktopSelectedCampaignId) {
      const sel = sitmarCampaigns.find(
        (c) => c.id === contentDesktopSelectedCampaignId,
      );
      if (
        sel &&
        (fetchSelectedDetail.has(contentDesktopSelectedCampaignId) ||
          sitmarCampaignNeedsFullDetail(sel, contentDesktopDetailCampaign))
      ) {
        const needsFetch = sitmarCampaignNeedsFullDetail(
          sel,
          contentDesktopDetailCampaign,
        );
        const hydrated = needsFetch
          ? await fetchContentCampaignDetail(contentDesktopSelectedCampaignId)
          : true;
        if (hydrated) {
          if (
            needsFetch &&
            isUnifiedChatActive(contentDesktopSelectedCampaignId)
          ) {
            syncUnifiedThread(
              contentDesktopDetailCampaign ||
                findSitmarCampaignById(contentDesktopSelectedCampaignId),
            );
          }
          if (!isSitmarPending(sel)) {
            pendingSitmarJobs.delete(contentDesktopSelectedCampaignId);
          }
        }
        return;
      }
    }
    if (changed) {
      if (brandHomePolling) {
        const co = companies.find((c) => c.id === selectedBrandId);
        if (co && !renderBrandHomeContentColOnly(co)) renderBrandDetail(co);
      } else {
        renderContentDesktopView();
      }
    }
  } finally {
    sitmarPollInFlight = false;
  }
  if (pendingSitmarJobs.size) scheduleSitmarPolling();
}

async function deleteSitmar(campaign) {
  const confirmed = await confirmModal({
    title: "Delete campaign?",
    body: `"${campaign.title || "Untitled"}" and its images will be permanently deleted. This can't be undone.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!confirmed) return;
  const { ok, status, body } = await api(
    `/api/sitmar/${encodeURIComponent(campaign.id)}`,
    { method: "DELETE" },
  );
  if (status === 401) return;
  if (!ok && status !== 204)
    return showToast(apiErrorMessage(body, "Delete failed."));
  if (selectedSitmarId === campaign.id) selectedSitmarId = null;
  pendingSitmarJobs.delete(campaign.id);
  await loadSitmar();
  renderSitmarSidebar();
  if (sitmarCampaigns.length) await selectSitmar(sitmarCampaigns[0].id);
  else renderDetailEmpty("sitmar");
}

// ----- add-campaign modal (4-step wizard) -----
//
// flow: brand -> audience -> story -> confirm. each step is a tile grid; tile
// clicks advance. state lives in module-level vars so submit at step 4 doesn't
// depend on DOM values.

const SITMAR_STEP_TITLES = {
  1: "Pick a brand",
  2: "Pick a story",
  3: "Edit prompt",
};
const SITMAR_STORY_SORT_LABELS = {
  recency: "recency",
  brand_score: "brand score",
  posts: "post count",
};

let sitmarStep = 1;
let sitmarModalMode = "create";
let sitmarSelected = {
  companyId: null,
  company: null,
  storyId: null,
  story: null,
};
let sitmarAudiencesByIndex = [];
let sitmarPromptDefaults = null;

function resetSitmarState() {
  sitmarStep = 1;
  sitmarStorySortMode = "recency";
  sitmarSelected = {
    companyId: null,
    company: null,
    storyId: null,
    story: null,
  };
  sitmarAudiencesByIndex = [];
  sitmarModalStories = [];
}

function syncAddSitmarSubmitLabel() {
  const submitBtn = $("add-sitmar-submit");
  if (!submitBtn) return;
  setText(
    submitBtn,
    sitmarModalMode === "customer_preview"
      ? "Back to campaigns"
      : "Start campaign",
  );
}

async function openAddSitmarModal(options = {}) {
  const modal = $("add-sitmar-modal");
  if (!modal) return;
  sitmarModalMode =
    options.mode === "customer_preview" ? "customer_preview" : "create";
  if (sitmarModalMode === "create" && currentView === "sitmar") {
    return;
  }
  if (!companies.length) await loadCompanies();
  resetSitmarState();
  setText($("add-sitmar-error"), "");
  if (options.company && options.story) {
    sitmarSelected.companyId = options.company.id;
    sitmarSelected.company = options.company;
    sitmarSelected.storyId = options.story.story_id;
    sitmarSelected.story = options.story;
    await renderSitmarPromptStep();
    setSitmarStep(3);
    const back = $("add-sitmar-back");
    if (back) back.hidden = true;
  } else {
    renderSitmarBrandStep();
    setSitmarStep(1);
  }
  syncAddSitmarSubmitLabel();
  modal.classList.remove("hidden");
}

function closeAddSitmarModal() {
  $("add-sitmar-modal").classList.add("hidden");
}

function setSitmarStep(n) {
  sitmarStep = n;
  const modal = $("add-sitmar-modal");
  if (!modal) return;
  const box = modal.querySelector(".sitmar-modal-box");
  if (box) box.dataset.step = String(n);
  modal.querySelectorAll(".sitmar-step").forEach((el) => {
    el.hidden = Number(el.dataset.step) !== n;
  });
  const back = $("add-sitmar-back");
  if (back) back.hidden = n === 1;
  setText($("add-sitmar-modal-title"), SITMAR_STEP_TITLES[n] || "New campaign");
}

function sitmarStepBack() {
  if (sitmarStep <= 1) return;
  if (sitmarStep === 2) {
    sitmarSelected.companyId = null;
    sitmarSelected.company = null;
    sitmarAudiencesByIndex = [];
    sitmarModalStories = [];
  } else if (sitmarStep === 3) {
    sitmarSelected.storyId = null;
    sitmarSelected.story = null;
  }
  setSitmarStep(sitmarStep - 1);
}

function clearGrid(el) {
  if (el) el.innerHTML = "";
}

function makeSitmarTile(className, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sitmar-tile " + className;
  btn.addEventListener("click", onClick);
  return btn;
}

// step 1
function renderSitmarBrandStep() {
  const grid = $("add-sitmar-brand-grid");
  const empty = $("add-sitmar-brand-empty");
  if (!grid) return;
  clearGrid(grid);
  if (!companies.length) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  companies.forEach((c) => {
    const tile = makeSitmarTile("sitmar-tile-brand", () =>
      onSitmarPickBrand(c),
    );
    const host = websiteDomain(c.website_url || "");
    let logo;
    if (host) {
      logo = document.createElement("img");
      logo.className = "sitmar-tile-logo";
      logo.alt = "";
      logo.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
      logo.referrerPolicy = "no-referrer";
      logo.onerror = () => {
        const fallback = avatarFor(host, "sitmar-tile-logo");
        logo.replaceWith(fallback);
      };
    } else {
      logo = avatarFor(c.id, "sitmar-tile-logo");
    }
    tile.appendChild(logo);
    const text = document.createElement("div");
    text.className = "sitmar-tile-text";
    const name = document.createElement("div");
    name.className = "sitmar-tile-name";
    setText(
      name,
      c.business_name ||
        c.website_synthesis_business_name ||
        websiteDomain(c.website_url) ||
        c.website_url ||
        c.id,
    );
    text.appendChild(name);
    const url = document.createElement("div");
    url.className = "sitmar-tile-url";
    setText(url, websiteDomain(c.website_url) || c.website_url || "");
    text.appendChild(url);
    tile.appendChild(text);
    grid.appendChild(tile);
  });
}

async function onSitmarPickBrand(company) {
  sitmarSelected.companyId = company.id;
  sitmarSelected.company = company;
  setText($("add-sitmar-error"), "");
  // show story grid with a loading placeholder while options load
  const storyGrid = $("add-sitmar-story-grid");
  clearGrid(storyGrid);
  const loading = document.createElement("div");
  loading.className = "sitmar-step-empty";
  setText(loading, "Loading stories…");
  storyGrid.appendChild(loading);
  setSitmarStep(2);
  try {
    const { ok, body } = await api(
      `/api/sitmar/options/${encodeURIComponent(company.id)}`,
      { method: "GET" },
    );
    if (sitmarSelected.companyId !== company.id) return;
    if (!ok) {
      clearGrid(storyGrid);
      const err = document.createElement("div");
      err.className = "sitmar-step-empty";
      setText(err, "Failed to load stories.");
      storyGrid.appendChild(err);
      return;
    }
    sitmarModalStories = (body && body.stories) || [];
    sitmarAudiencesByIndex = invertSitmarStoriesByAudience(sitmarModalStories);
    renderSitmarStoryStep();
  } catch (err) {
    clearGrid(storyGrid);
    const errEl = document.createElement("div");
    errEl.className = "sitmar-step-empty";
    setText(errEl, "Network error loading stories.");
    storyGrid.appendChild(errEl);
  }
}

// /api/sitmar/options returns stories[].audiences[]; we want audiences[].stories[].
// each brand-audience already carries its (story-specific) match score in the
// candidates list; we take the max across this audience's stories as the sort key.
function invertSitmarStoriesByAudience(stories) {
  const byIndex = new Map();
  stories.forEach((story) => {
    (story.audiences || []).forEach((a) => {
      const key = a.brand_index;
      let bucket = byIndex.get(key);
      if (!bucket) {
        bucket = {
          brand_index: key,
          title: a.title || "Audience",
          description: a.description || "",
          inhouse_title: a.inhouse_title || "",
          member_handle: a.member_handle || null,
          member_image_url: a.member_image_url || null,
          best_score: null,
          stories: [],
        };
        byIndex.set(key, bucket);
      }
      bucket.stories.push(story);
      const s = a.score == null ? null : Number(a.score);
      if (s != null && (bucket.best_score == null || s > bucket.best_score)) {
        bucket.best_score = s;
        bucket.inhouse_title = a.inhouse_title || bucket.inhouse_title;
        bucket.member_handle = a.member_handle || bucket.member_handle;
        bucket.member_image_url = a.member_image_url || bucket.member_image_url;
      }
    });
  });
  return Array.from(byIndex.values()).sort(
    (a, b) =>
      (b.best_score == null ? -Infinity : b.best_score) -
      (a.best_score == null ? -Infinity : a.best_score),
  );
}

// step 2
function sitmarStoryTimeMs(story) {
  const value = story.story_last_seen_at;
  if (value == null || value === "") return NaN;
  if (typeof value === "number")
    return value > 1_000_000_000_000 ? value : value * 1000;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? NaN : ms;
}

function sitmarStorySortKey(story) {
  if (sitmarStorySortMode === "brand_score") {
    if (story.brand_score == null || story.brand_score === "") return -Infinity;
    const n = Number(story.brand_score);
    return Number.isFinite(n) ? n : -Infinity;
  }
  if (sitmarStorySortMode === "posts") {
    const n = Number(story.post_count);
    return Number.isFinite(n) ? n : -Infinity;
  }
  const t = sitmarStoryTimeMs(story);
  return Number.isNaN(t) ? -Infinity : t;
}

function sortedSitmarStories(stories) {
  return stories
    .filter((story) => meetsBrandScoreThreshold(story.brand_score))
    .sort((a, b) => sitmarStorySortKey(b) - sitmarStorySortKey(a));
}

function updateSitmarStorySortButton() {
  const sortBtn = $("sitmar-story-sort-btn");
  const sortLabel = $("sitmar-story-sort-label");
  const label = SITMAR_STORY_SORT_LABELS[sitmarStorySortMode] || "recency";
  if (sortLabel) setText(sortLabel, "Sorting by " + label);
  if (!sortBtn) return;
  sortBtn.classList.toggle("active", sitmarStorySortMode !== "recency");
  sortBtn.title = "Sort: " + label;
  sortBtn.setAttribute("aria-label", "Sort stories by " + label);
}

function cycleSitmarStorySort() {
  sitmarStorySortMode =
    sitmarStorySortMode === "recency"
      ? "brand_score"
      : sitmarStorySortMode === "brand_score"
        ? "posts"
        : "recency";
  updateSitmarStorySortButton();
  showToast(
    "Sorting by " +
      (SITMAR_STORY_SORT_LABELS[sitmarStorySortMode] || "recency"),
  );
  renderSitmarStoryStep();
}

function sitmarStoryScoreLabel(story) {
  if (story.brand_score == null || story.brand_score === "") return "—";
  const bucket = customerBrandScoreBucket(story.brand_score);
  return bucket ? bucket.label : "—";
}

function sitmarStoryAgeLabel(story) {
  const t = sitmarStoryTimeMs(story);
  if (Number.isNaN(t)) return "—";
  return relativeTime(t / 1000).replace(" ago", "");
}

function sitmarStoryStat(value, label) {
  const stat = document.createElement("div");
  stat.className = "sitmar-tile-story-stat";
  const valueEl = document.createElement("div");
  valueEl.className = "sitmar-tile-story-stat-value";
  setText(valueEl, value);
  const labelEl = document.createElement("div");
  labelEl.className = "sitmar-tile-story-stat-label";
  setText(labelEl, label);
  stat.appendChild(valueEl);
  stat.appendChild(labelEl);
  return stat;
}

function renderSitmarStoryStep() {
  const grid = $("add-sitmar-story-grid");
  if (!grid) return;
  clearGrid(grid);
  updateSitmarStorySortButton();
  const stories = sitmarModalStories || [];
  sortedSitmarStories(stories).forEach((story) => {
    const tile = makeSitmarTile("sitmar-tile-story", () =>
      onSitmarPickStory(story),
    );

    const stats = document.createElement("div");
    stats.className = "sitmar-tile-story-stats";
    stats.appendChild(
      sitmarStoryStat(sitmarStoryScoreLabel(story), "brand score"),
    );
    stats.appendChild(sitmarStoryStat(sitmarStoryAgeLabel(story), "age"));
    stats.appendChild(
      sitmarStoryStat(formatCompactCount(story.post_count), "posts"),
    );
    tile.appendChild(stats);

    const main = document.createElement("div");
    main.className = "sitmar-tile-story-main";
    const headline = document.createElement("div");
    headline.className = "sitmar-tile-title";
    setText(headline, story.headline || story.story_id);
    main.appendChild(headline);
    if (story.summary) {
      const summary = document.createElement("div");
      summary.className = "sitmar-tile-summary";
      setText(summary, story.summary);
      main.appendChild(summary);
    }
    tile.appendChild(main);
    grid.appendChild(tile);
  });
}

function onSitmarPickStory(story) {
  sitmarSelected.storyId = story.story_id;
  sitmarSelected.story = story;
  renderSitmarPromptStep();
  setSitmarStep(3);
}

async function renderSitmarPromptStep() {
  const textarea = $("sitmar-prompt-prefix");
  const directivesEl = $("sitmar-prompt-directives");
  if (!textarea || !directivesEl) return;
  if (!sitmarPromptDefaults) {
    try {
      const { ok, body } = await api("/api/sitmar/prompt-defaults", {
        method: "GET",
      });
      if (ok && body) sitmarPromptDefaults = body;
    } catch (_) {
      /* use fallback empty */
    }
  }
  textarea.value = sitmarPromptDefaults ? sitmarPromptDefaults.prefix : "";
  setText(
    directivesEl,
    sitmarPromptDefaults ? sitmarPromptDefaults.directives : "",
  );
}

async function handleAddSitmarSubmit(e) {
  e.preventDefault();
  const errEl = $("add-sitmar-error");
  setText(errEl, "");
  const { companyId, story } = sitmarSelected;
  if (!companyId || !story) {
    setText(errEl, "Pick a brand and story first.");
    return;
  }
  const submitBtn = $("add-sitmar-submit");
  submitBtn.disabled = true;
  if (sitmarModalMode === "customer_preview") {
    closeAddSitmarModal();
    if (currentView === "sitmar") {
      renderContentDesktopView();
    }
    submitBtn.disabled = false;
    syncAddSitmarSubmitLabel();
    return;
  }
  setText(submitBtn, "Starting…");
  try {
    const promptPrefix = ($("sitmar-prompt-prefix") || {}).value;
    const campaign = await createSitmarCampaignFromStory({
      companyId,
      story,
      systemPromptPrefix: (promptPrefix && promptPrefix.trim()) || null,
      errEl,
    });
    if (!campaign) return;
    closeAddSitmarModal();
    await openContentCampaignChat(campaign.id, story.story_id || "");
  } catch (err) {
    setText(errEl, "Network error: " + err.message);
  } finally {
    submitBtn.disabled = false;
    syncAddSitmarSubmitLabel();
  }
}

function formatEpochTimestamp(ts) {
  const value = Number(ts);
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Date(value * 1000).toLocaleString();
}

function waitlistField(value) {
  const text = String(value || "").trim();
  return text || "—";
}

