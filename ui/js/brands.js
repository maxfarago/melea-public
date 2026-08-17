// ============================================================
// brands (sidebar + detail)
// ============================================================

function renderBrandSidebarItem(c) {
  const btn = document.createElement("div");
  btn.setAttribute("role", "button");
  btn.tabIndex = 0;
  btn.className = "job-item audience-sidebar-item";
  const active = c.id === selectedBrandId;
  if (active) {
    btn.classList.add("active");
    btn.setAttribute("aria-current", "page");
  }

  const showRunningSpinner = isPipelineInProgress(getStages(c));

  const logo = sidebarCompanyLogo(c.website_url, c.website_url);

  const body = document.createElement("div");
  body.className = "job-item-body";

  const name = companyDisplayName(c);
  const domainText = websiteDomain(c.website_url) || c.website_url;
  if (name && name !== domainText) {
    const nameEl = document.createElement("div");
    nameEl.className = "job-name";
    setText(nameEl, name);
    body.appendChild(nameEl);
  }
  const domain = document.createElement("div");
  domain.className = "job-domain";
  setText(domain, domainText);

  body.appendChild(domain);
  btn.appendChild(logo);
  btn.appendChild(body);
  if (showRunningSpinner) {
    const dot = document.createElement("span");
    dot.className = "job-verdict running";
    btn.appendChild(dot);
  } else if (active) {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "audience-sidebar-delete-btn";
    deleteBtn.title = "Delete brand";
    deleteBtn.setAttribute("aria-label", "Delete brand");
    deleteBtn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/></svg>';
    deleteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteBrand(c);
    });
    btn.appendChild(deleteBtn);
  }
  btn.addEventListener("click", () => selectBrand(c.id));
  btn.addEventListener("keydown", (e) => {
    if (e.target !== btn) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    selectBrand(c.id);
  });
  return btn;
}

async function deleteBrand(company) {
  const { ok, status, body } = await api(`/api/company/${company.id}`, {
    method: "DELETE",
  });
  if (!ok && status !== 204) {
    showError(
      "global-errors",
      apiErrorMessage(body, `Delete failed (${status})`),
    );
    return;
  }
  if (selectedBrandId === company.id) closeBrand();
  await loadCompanies();
  renderBrandsSidebar();
}

function renderBrandsSidebar() {
  const list = $("sidebar-list");
  list.innerHTML = "";
  if (currentView === "ops-brands") return;
  if (companies.length === 0) {
    const empty = document.createElement("div");
    empty.className = "sidebar-empty";
    const heading = document.createElement("div");
    heading.className = "sidebar-empty-heading";
    setText(heading, "No brands yet");
    const sub = document.createElement("div");
    sub.className = "sidebar-empty-sub";
    setText(sub, "Use + to add a brand.");
    empty.appendChild(heading);
    empty.appendChild(sub);
    list.appendChild(empty);
  }
}

function mostRecentBrand() {
  if (!companies.length) return null;
  return companies.reduce((latest, company) => {
    const latestCreated = Number(latest.created_at || 0);
    const companyCreated = Number(company.created_at || 0);
    return companyCreated > latestCreated ? company : latest;
  }, companies[0]);
}

function selectMostRecentBrand() {
  if (pendingBrandSelectionId) {
    const id = pendingBrandSelectionId;
    pendingBrandSelectionId = null;
    selectBrand(id);
    return;
  }
  const company = mostRecentBrand();
  if (company) {
    selectBrand(company.id);
    return;
  }
  renderBrandsSidebar();
  renderDetailEmpty("brands");
  hideRunsSidebar();
}

function selectBrand(companyId) {
  // the custom-aggregate selection is sticky per brand (persisted in
  // localStorage). switching brands just drops the in-memory cache; the
  // new brand's mode is hydrated from storage on its first render.
  const switchingBrand = selectedBrandId !== companyId;
  if (customAggregateState && customAggregateState.companyId !== companyId) {
    clearCustomAggregateState();
  }
  selectedBrandId = companyId;
  selectedRunId = null;
  brandCustomerSelectedAudienceId = "";
  brandCustomerExpandedAudiences = new Set();
  brandCustomerAudiencesAutoOpened = false;
  if (switchingBrand) {
    brandHomeViewMode = "default";
    brandHomeStoryFocus = false;
    brandHomeContentGenCollapsed = false;
    brandHomePendingPostContent = false;
    resetUnifiedChat();
  }
  saveNavState({ brandId: companyId, runId: null });
  stopRunDetailPolling();
  const runModal = $("run-detail-modal");
  if (runModal) runModal.classList.add("hidden");
  renderBrandsSidebar();
  syncBrandsHeaderAdd();
  setBrandCreateActive(false);
  const company = companies.find((c) => c.id === companyId);
  if (company) {
    renderBrandDetail(company);
    hideRunsSidebar();
  } else {
    renderDetailEmpty("brands");
    hideRunsSidebar();
  }
}

function closeBrand() {
  // drop the in-memory cache only — the brand's mode preference (custom
  // vs all) is persisted in localStorage so it's still there next time.
  clearCustomAggregateState();
  selectedBrandId = null;
  selectedRunId = null;
  saveNavState({ brandId: null, runId: null });
  stopRunDetailPolling();
  const runModal = $("run-detail-modal");
  if (runModal) runModal.classList.add("hidden");
  hideRunsSidebar();
  renderBrandsSidebar();
  renderDetailEmpty("brands");
}

function closeRun() {
  stopRunDetailPolling();
  const modal = $("run-detail-modal");
  if (modal) modal.classList.add("hidden");
  selectedRunId = null;
  saveNavState({ runId: null });
  hideRunsSidebar();
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

function preBrandInProgressCompany() {
  return companies.find((c) => shouldResumePreBrandOnboarding(c)) || null;
}

function renderBrandHomeEmpty({ resetSort = false } = {}) {
  teardownPreBrandSpotlight(true);
  if (typeof setBrandCreateActive === "function") setBrandCreateActive(false);
  if (typeof clearBrandCreateView === "function") clearBrandCreateView();
  renderBrandsSidebar();
  syncBrandsHeaderAdd();
  const root = $("detail");
  if (!root) return;
  root.innerHTML = "";
  const inner = document.createElement("div");
  inner.className =
    "detail-inner brand-customer-detail stories-desktop-view sc-phone-view";
  root.appendChild(inner);

  const shell = document.createElement("div");
  shell.className = "brand-ops-shell";
  shell.dataset.preBrand = "true";
  const bodyWrap = document.createElement("div");
  bodyWrap.className = "brand-home-body-wrap";
  const body = document.createElement("div");
  body.className = "brand-home-body";
  body.appendChild(buildPreBrandAudiencesCol());
  body.appendChild(buildBrandHomeStoriesCol(null));
  body.appendChild(buildBrandHomeContentCol(emptyHomeCompany()));
  bodyWrap.appendChild(body);
  shell.appendChild(bodyWrap);
  inner.appendChild(shell);
  hideRunsSidebar();
  if (resetSort) applyStoriesCustomerDefaultSortMode();

  const inProgressCompany = preBrandOverlayCompany();
  if (!inProgressCompany) {
    clearPreBrandOnboardingStatusMessage();
  } else {
    applyPreBrandProgressState(inProgressCompany);
  }

  const needsFetch = !storiesCustomerFeed.length && storiesCustomerHasMore;
  if (needsFetch && !storiesCustomerLoadingMore) {
    storiesCustomerLoadingMore = true;
    void loadStoriesCustomerPage({ append: false }).finally(() => {
      storiesCustomerLoadingMore = false;
      if (currentView === "brands" && !selectedBrandId) {
        if (!renderPreBrandStoriesColOnly()) renderBrandHomeEmpty();
        else if (storiesCustomerFeed.length) tryAutoExpandFirstBrandHomeStory();
      }
    });
  } else if (storiesCustomerFeed.length) {
    tryAutoExpandFirstBrandHomeStory();
  }
}

const PRE_BRAND_DUMMY_AUDIENCES = [
  "Tech Early Adopters",
  "Marketing Leaders",
  "Culture & Lifestyle",
  "Industry Analysts",
];
const PRE_BRAND_PREVIEW_LIMIT = 4;

function preBrandPreviewAudiences() {
  const overlayCompany = preBrandOverlayCompany();
  if (overlayCompany?.id) {
    const cached = brandAudiencesCache.get(overlayCompany.id);
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
  for (const story of storiesCustomerFeed || []) {
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

function preBrandMemberImages(audiences) {
  const map = new Map();
  audiences.forEach((item) => {
    const audienceId =
      item && item.match && typeof item.match === "object"
        ? String(item.match.audience_id || "").trim()
        : "";
    const imageUrl = brandAudienceImageUrl(item, null);
    if (!audienceId || !imageUrl) return;
    map.set(audienceId, {
      imageUrl,
      handle: String(item.member_handle || "").trim() || null,
    });
  });
  return map;
}

function buildPreBrandAudiencePlaceholder() {
  const placeholder = document.createElement("div");
  placeholder.className = "pre-brand-placeholder-lines";
  for (let i = 0; i < 3; i++) {
    const line = document.createElement("div");
    line.className = "pre-brand-placeholder-line";
    line.style.width = `${65 + Math.round(Math.random() * 30)}%`;
    placeholder.appendChild(line);
  }
  return placeholder;
}

function brandHomeTitleH1(label) {
  const h1 = document.createElement("h1");
  h1.className = "sc-title-h1";
  setText(h1, label);
  return h1;
}

const BRAND_HOME_TITLE_X_LOGO =
  '<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.254 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>';

function brandHomeTrendingOnXTitleH1() {
  const h1 = document.createElement("h1");
  h1.className = "sc-title-h1 sc-title-h1-with-icon";
  const text = document.createElement("span");
  setText(text, "Trending on");
  h1.appendChild(text);
  const xLogo = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  xLogo.setAttribute("class", "sc-title-x");
  xLogo.setAttribute("viewBox", "0 0 24 24");
  xLogo.setAttribute("aria-hidden", "true");
  xLogo.innerHTML = BRAND_HOME_TITLE_X_LOGO;
  h1.appendChild(xLogo);
  return h1;
}

function buildPreBrandAudiencesCol() {
  const previewAudiences = preBrandPreviewAudiences();
  const memberImages = preBrandMemberImages(previewAudiences);
  const col = document.createElement("div");
  col.className = "brand-home-audiences-col";

  // blurred dummy content
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
  previewAudiences.forEach((item) => {
    const matchedAudienceId =
      item && item.match && typeof item.match === "object"
        ? String(item.match.audience_id || "").trim()
        : "";
    const section = document.createElement("div");
    section.className = "brand-home-aud-section";
    if (matchedAudienceId) section.id = `brand-aud-${matchedAudienceId}`;
    section.appendChild(buildBrandHomeAudienceHeader(item, memberImages));
    if (matchedAudienceId) {
      section.appendChild(
        buildBrandHomeAudienceDetailContent(
          item,
          emptyHomeCompany(),
          storiesCustomerFeed,
        ),
      );
    } else {
      section.appendChild(buildPreBrandAudiencePlaceholder());
    }
    details.appendChild(section);
  });
  blur.appendChild(details);
  col.appendChild(blur);

  // creation overlay
  col.appendChild(buildPreBrandOverlay());
  return col;
}

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
  xLogo.innerHTML = BRAND_HOME_TITLE_X_LOGO;
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

  // input form
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

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className = "btn-primary brand-create-submit";
  setText(submitBtn, "Continue");
  form.appendChild(submitBtn);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void submitPreBrandWebsite(input, errEl, submitBtn, card);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submitPreBrandWebsite(input, errEl, submitBtn, card);
    }
  });
  card.appendChild(form);

  // progress state
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
    } else if (host) {
      logo.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
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

async function submitPreBrandWebsite(input, errEl, submitBtn, card) {
  const trimmed = String(input.value || "").trim();
  setText(errEl, "");
  input.removeAttribute("aria-invalid");
  if (!trimmed) {
    setText(errEl, "Add a website URL or domain first.");
    input.setAttribute("aria-invalid", "true");
    input.focus();
    return;
  }
  submitBtn.disabled = true;
  setText(submitBtn, "Looking it up…");
  try {
    const { ok, status, body } = await api("/api/companies", {
      method: "POST",
      body: { website_url: trimmed },
    });
    if (status === 403 && body?.detail === "You already have a brand.") {
      setText(errEl, "You already have a brand in your account.");
      return;
    }
    if (!ok) {
      setText(
        errEl,
        apiErrorMessage(
          body,
          "Couldn't add that brand. Enter a valid public website URL or domain.",
        ),
      );
      input.setAttribute("aria-invalid", "true");
      return;
    }
    if (body?.company?.id) {
      let resolvedCompany = body.company;
      ensureCompanyStages(resolvedCompany);
      const clerk = getClerk();
      if (clerk && clerk.user) {
        const {
          ok: claimOk,
          status: claimStatus,
          body: claimBody,
        } = await api("/api/me/claim", {
          method: "POST",
          body: { company_id: resolvedCompany.id },
        });
        const claimAuthRequired =
          claimStatus === 401 || claimBody?.detail === "Authentication required.";
        if (!claimOk || !claimBody?.company_id) {
          if (!claimAuthRequired) {
            setText(
              errEl,
              apiErrorMessage(claimBody, "Brand created but attachment failed."),
            );
            return;
          }
        }
        if (claimOk && claimBody?.company_id) {
          setStoredCompanyId(claimBody.company_id);
          storiesCustomerBrandId = claimBody.company_id;
          contentDesktopBrandId = claimBody.company_id;
          if (claimBody.company) {
            ensureCompanyStages(claimBody.company);
            resolvedCompany = claimBody.company;
          }
        }
      }
      companies = [resolvedCompany];
      setStoredCompanyId(resolvedCompany.id);
      syncBrandsHeaderAdd();
      renderBrandsSidebar();

      if (
        body.created === false &&
        !shouldResumePreBrandOnboarding(resolvedCompany)
      ) {
        markDuplicateBrandOnboarding(false);
        storiesCustomerBrandId = resolvedCompany.id;
        contentDesktopBrandId = resolvedCompany.id;
        applyPreBrandProgressState(resolvedCompany);
        if (currentView === "brands" && !selectedBrandId) {
          const progressLive = document.querySelector(
            ".pre-brand-overlay-card.is-progress",
          );
          if (
            !progressLive &&
            !renderBrandHomeContentColOnly(emptyHomeCompany())
          ) {
            renderBrandHomeEmpty();
          }
        }
        void finishSettledExistingBrandOverlay(resolvedCompany.id);
        return;
      }

      if (body.created === false) {
        markDuplicateBrandOnboarding(false);
        storiesCustomerBrandId = resolvedCompany.id;
        contentDesktopBrandId = resolvedCompany.id;
        void prefetchBrandDashboardData(resolvedCompany.id);
      }

      // transition overlay to progress
      applyPreBrandProgressState(resolvedCompany);
      startStagePolling(resolvedCompany.id, { onboarding: true, delayMs: 0 });
      if (currentView === "brands" && !selectedBrandId) {
        const progressLive = document.querySelector(
          ".pre-brand-overlay-card.is-progress",
        );
        if (
          !progressLive &&
          !renderBrandHomeContentColOnly(emptyHomeCompany())
        ) {
          renderBrandHomeEmpty();
        }
      }
    }
  } catch (err) {
    setText(errEl, "Network error: " + err.message);
  } finally {
    submitBtn.disabled = false;
    setText(submitBtn, "Continue");
  }
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
  const msg = customerLoadingMessage(company);
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
    const pct = onboardingProgressPct(company);
    fill.style.width = `${pct}%`;
  }
}

async function completePreBrandTransition(companyId) {
  stopStagePolling(companyId);
  clearPreBrandOnboardingStatusMessage();
  setBrandHomeChatJustUnlocked(true);
  const fresh = await fetchCompany(companyId);
  if (fresh) replaceCompanyInCache(fresh);
  applyStoriesCustomerDefaultSortMode();
  const blur = document.querySelector(".pre-brand-audiences-blur");
  const overlay = document.querySelector(".pre-brand-create-overlay");
  if (blur) blur.classList.add("pre-brand-unblur");
  if (overlay) overlay.classList.add("pre-brand-overlay-exit");
  setTimeout(() => selectBrand(companyId), 500);
}

function renderBrandDetail(company) {
  closeBrandCustomerPopover();
  const root = $("detail");
  root.innerHTML = "";
  const inner = document.createElement("div");
  inner.className =
    "detail-inner brand-customer-detail stories-desktop-view sc-phone-view";
  inner.dataset.brandId = company.id;
  root.appendChild(inner);
  renderBrandCustomerView(company, inner);
}

function brandFavicon(websiteUrl) {
  const host = websiteDomain(websiteUrl);
  if (!host) return null;
  const img = document.createElement("img");
  img.className = "brand-detail-favicon";
  img.alt = "";
  img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  img.referrerPolicy = "no-referrer";
  img.onerror = () => img.remove();
  return img;
}

function companyDisplayName(company) {
  return (
    String(company.business_name || "").trim() ||
    String(company.website_synthesis_business_name || "").trim() ||
    String(company.brand_name || "").trim() ||
    websiteDomain(company.website_url) ||
    String(company.website_url || "").trim()
  );
}

// ordered by pipeline sequence; weights ≈ estimated wall-clock seconds
const ONBOARDING_STAGE_WEIGHTS = [
  { stage: "website_synthesis", weight: 25 },
  { stage: "audience", weight: 30 },
  { stage: "audience_match", weight: 15 },
  { stage: "brand_synthesis", weight: 20 },
  { stage: "brand_scoring", weight: 10 },
  { stage: "audience_trends", weight: 3 },
];
const ONBOARDING_TOTAL_WEIGHT = ONBOARDING_STAGE_WEIGHTS.reduce(
  (s, e) => s + e.weight,
  0,
);

function onboardingProgressPct(company) {
  if (!company) return 0;
  let earned = 0;
  for (const { stage, weight } of ONBOARDING_STAGE_WEIGHTS) {
    const s = getStageStatus(company, stage);
    if (s === "done" || s === "skipped" || s === "error") {
      earned += weight;
    } else if (s === "running" || s.startsWith("running_")) {
      earned += weight * 0.5;
    }
  }
  return Math.min(99, Math.round((earned / ONBOARDING_TOTAL_WEIGHT) * 100));
}

function specificCustomerLoadingMessage(company) {
  const searchTermsStatus = getStageStatus(company, "website_synthesis");
  if (searchTermsStatus === "running_reader") {
    return "Reading your website...";
  }

  if (isStagePendingOrRunning(company, "website_synthesis")) {
    return "Understanding your brand...";
  }

  const audienceStatus = getStageStatus(company, "audience");
  if (isStagePendingOrRunning(company, "audience")) {
    return "Identifying your audiences...";
  }

  const matchStatus = getStageStatus(company, "audience_match");
  if (isStagePendingOrRunning(company, "audience_match")) {
    return "Matching to our audience network...";
  }

  const synthesisStatus = getStageStatus(company, "brand_synthesis");
  if (isStagePendingOrRunning(company, "brand_synthesis")) {
    if (String(company.brand_synthesis || "").trim()) return null;
    if (
      searchTermsStatus === "done" &&
      audienceStatus === "done" &&
      matchStatus === "done"
    ) {
      return null;
    }
    return "Writing your brand story...";
  }

  const scoringStatus = getStageStatus(company, "brand_scoring");
  if (isStagePendingOrRunning(company, "brand_scoring")) {
    return "Scoring news stories to your brand...";
  }

  const trendsStatus = getStageStatus(company, "audience_trends");
  if (isStagePendingOrRunning(company, "audience_trends")) {
    return "Collecting relevant trends...";
  }

  return null;
}

function customerLoadingMessage(company) {
  if (!company) {
    clearPreBrandOnboardingStatusMessage();
    return null;
  }
  if (preBrandExistingBrandId && company.id === preBrandExistingBrandId) {
    return preBrandOnboardingStatusMessage || EXISTING_BRAND_ONBOARDING_MESSAGE;
  }
  const specific = specificCustomerLoadingMessage(company);
  if (specific) {
    preBrandOnboardingStatusMessage = specific;
    return specific;
  }
  if (preBrandExistingBrandId && company.id === preBrandExistingBrandId) {
    return preBrandOnboardingStatusMessage || EXISTING_BRAND_ONBOARDING_MESSAGE;
  }
  if (preBrandOnboardingStatusMessage === EXISTING_BRAND_ONBOARDING_MESSAGE) {
    return preBrandOnboardingStatusMessage;
  }
  if (shouldResumePreBrandOnboarding(company)) {
    return preBrandOnboardingStatusMessage || PRE_BRAND_ONBOARDING_FALLBACK;
  }
  clearPreBrandOnboardingStatusMessage();
  return null;
}

function brandStoriesForAudience(stories, audienceId) {
  return (stories || [])
    .filter((story) =>
      Array.isArray(story.audiences)
        ? story.audiences.some(
            (a) => String(a.audience_id || "") === audienceId,
          )
        : false,
    )
    .filter((story) => meetsBrandScoreThreshold(story.brand_score))
    .sort((a, b) => {
      const aa = (a.audiences || []).find(
        (row) => String(row.audience_id || "") === audienceId,
      );
      const bb = (b.audiences || []).find(
        (row) => String(row.audience_id || "") === audienceId,
      );
      const aTime = customerStoryTimeMs(
        aa && aa.last_seen_at ? aa.last_seen_at : a.story_last_seen_at,
      );
      const bTime = customerStoryTimeMs(
        bb && bb.last_seen_at ? bb.last_seen_at : b.story_last_seen_at,
      );
      return bTime - aTime;
    })
    .slice(0, 2);
}

function openStoryInCustomerStoriesView(companyId, story) {
  const storyId = customerStoryId(story);
  if (currentView === "brands") {
    if (storyId) storiesCustomerExpanded.add(storyId);
    const company = companies.find(
      (c) => c.id === (companyId || selectedBrandId),
    );
    if (company) renderBrandDetail(company);
    return;
  }
  storiesCustomerBrandId = companyId || "";
  storiesCustomerReturnBrandId = companyId || "";
  storiesCustomerSelectedId = storyId;
  storiesCustomerExpanded = new Set(storyId ? [storyId] : []);
  storiesCustomerAutoOpened = true;
  storiesCustomerFeed = [];
  storiesCustomerWindowIndex = 0;
  storiesCustomerOffset = 0;
  storiesCustomerHasMore = true;
  storiesCustomerLoadingMore = false;
  storiesCustomerDetailCache.clear();
  storiesCustomerDetailInFlight.clear();
  try {
    localStorage.setItem(STORIES_BRAND_KEY, storiesCustomerBrandId);
  } catch (_) {}
  void switchView("twitter");
}

function returnToBrandFromStories() {
  const brandId = storiesCustomerReturnBrandId;
  storiesCustomerReturnBrandId = "";
  if (!brandId) return;
  pendingBrandSelectionId = brandId;
  saveNavState({ view: "brands", brandId });
  void switchView("brands");
}

function buildStoriesCustomerBackButton() {
  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "sc-back-btn";
  backBtn.setAttribute("aria-label", "Back to brand");
  backBtn.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  backBtn.addEventListener("click", () => returnToBrandFromStories());
  return backBtn;
}

function ensureBrandCustomerAudienceSelection(audiences) {
  const ids = audiences
    .map((item) =>
      item && item.match && typeof item.match === "object"
        ? String(item.match.audience_id || "").trim()
        : "",
    )
    .filter(Boolean);
  if (!ids.length) {
    brandCustomerSelectedAudienceId = "";
    return null;
  }
  if (!ids.includes(brandCustomerSelectedAudienceId)) {
    brandCustomerSelectedAudienceId = ids[0];
  }
  return (
    audiences.find(
      (item) =>
        item &&
        item.match &&
        String(item.match.audience_id || "") ===
          brandCustomerSelectedAudienceId,
    ) || audiences[0]
  );
}

function buildBrandAudienceListRow(item, idx, selected, company) {
  const titleText = String(item.title || "").trim();
  const matchedAudienceId =
    item && item.match && typeof item.match === "object"
      ? String(item.match.audience_id || "").trim()
      : "";
  const row = document.createElement("div");
  row.className =
    "sc-card sc-list-row collapsed" + (selected ? " is-selected" : "");
  const head = document.createElement("div");
  head.className = "sc-card-head";
  const titleCol = document.createElement("div");
  titleCol.className = "sc-card-title";
  const chip = document.createElement("span");
  chip.className = "sc-audience-chip";
  const av = document.createElement("span");
  av.className = "sc-audience-av";
  av.style.background =
    STORIES_ACCENT_PALETTE[idx % STORIES_ACCENT_PALETTE.length];
  setText(av, (titleText || "?")[0].toUpperCase());
  chip.appendChild(av);
  const label = document.createElement("span");
  label.className = "sc-audience-chip-label";
  setText(label, titleText || "Untitled audience");
  chip.appendChild(label);
  titleCol.appendChild(chip);
  head.appendChild(titleCol);
  row.appendChild(head);
  row.addEventListener("click", () => {
    brandCustomerSelectedAudienceId = matchedAudienceId;
    renderBrandDetail(company);
  });
  return row;
}

const BRAND_STORY_EXPANDED_KEY = "melea:brand_story_expanded:";

function brandStoryExpandedKey(companyId) {
  return BRAND_STORY_EXPANDED_KEY + (companyId || "");
}

function isBrandStoryExpanded(companyId) {
  try {
    return localStorage.getItem(brandStoryExpandedKey(companyId)) === "1";
  } catch (_) {
    return false;
  }
}

function setBrandStoryExpanded(companyId, expanded) {
  try {
    localStorage.setItem(
      brandStoryExpandedKey(companyId),
      expanded ? "1" : "0",
    );
  } catch (_) {}
}

function brandCustomerStageReadable(status, opts = {}) {
  const skipDone = opts.skipDone === true;
  const s = String(status || "")
    .trim()
    .toLowerCase();
  if (!s || s === "idle") return null;
  if (s === "done") return skipDone ? null : "Done";
  if (s === "error") return "Failed";
  if (s === "skipped") return "Skipped";
  if (isRunningStageStatus(s)) return "In progress";
  return null;
}

const BRAND_DATA_SOCIAL_LABEL = {
  "twitter.com": "X",
  "instagram.com": "Instagram",
  "linkedin.com": "LinkedIn",
  "tiktok.com": "TikTok",
  "youtube.com": "YouTube",
  "facebook.com": "Facebook",
  "threads.net": "Threads",
};

function brandDataSocialAgg(company) {
  return {
    social_handles: Array.isArray(company.socials) ? company.socials : [],
  };
}

function companySocialsPayload(company) {
  const handlesByPlatform = socialHandlesByPlatform(
    brandDataSocialAgg(company),
    company,
  );
  const socials = [];
  for (const platform of EDIT_SOCIAL_PLATFORMS) {
    const row = handlesByPlatform[platform];
    if (!row || !row.handle) continue;
    socials.push({
      platform,
      handle: String(row.handle).replace(/^@/, "").trim(),
      url: row.url || "",
      source: row.source || "scraped",
    });
  }
  return socials;
}

function patchCompanySocials(company, platform, rawValue) {
  const socials = companySocialsPayload(company);
  const cleaned = String(rawValue || "")
    .trim()
    .replace(/^@/, "");
  const idx = socials.findIndex((s) => s.platform === platform);
  if (!cleaned) {
    if (idx >= 0) socials.splice(idx, 1);
  } else if (idx >= 0) {
    socials[idx] = { ...socials[idx], handle: cleaned };
  } else {
    socials.push({
      platform,
      handle: cleaned,
      url: "",
      source: "scraped",
    });
  }
  return socials;
}

function brandDataSocialPlatformsUsed(company) {
  const used = new Set();
  for (const entry of brandCustomerDataEntries(company)) {
    if (entry.platform) used.add(entry.platform);
  }
  return used;
}

function brandDataSocialPlatformsAvailable(company) {
  const used = brandDataSocialPlatformsUsed(company);
  return EDIT_SOCIAL_PLATFORMS.filter((p) => !used.has(p));
}

function formatBrandDataLinkedinDisplay(urlOrHandle) {
  let display = String(urlOrHandle || "")
    .trim()
    .replace(/^https?:\/\/(www\.)?/i, "");
  if (display && !display.includes("linkedin.com")) {
    display = `linkedin.com/company/${display.replace(/^\/+/, "")}`;
  }
  if (display.length > 48) display = `${display.slice(0, 45)}…`;
  return display;
}

function formatBrandDataTwitterDisplay(handle) {
  const h = String(handle || "")
    .trim()
    .replace(/^@/, "");
  return h ? `@${h}` : "";
}

function brandDataSocialDisplayValue(platform, company) {
  if (platform === "linkedin.com") {
    const url = String(company.linkedin_company_url || "").trim();
    if (url) return formatBrandDataLinkedinDisplay(url);
    const row = socialHandlesByPlatform(brandDataSocialAgg(company), company)[
      "linkedin.com"
    ];
    if (row?.handle) return formatBrandDataLinkedinDisplay(row.handle);
    return (
      brandCustomerStageReadable(getStageStatus(company, "linkedin"), {
        skipDone: true,
      }) || ""
    );
  }
  if (platform === "twitter.com") {
    const handle = String(company.twitter_handle || "").trim();
    if (handle) return formatBrandDataTwitterDisplay(handle);
    const row = socialHandlesByPlatform(brandDataSocialAgg(company), company)[
      "twitter.com"
    ];
    if (row?.handle) return formatBrandDataTwitterDisplay(row.handle);
    return "";
  }
  const row = socialHandlesByPlatform(brandDataSocialAgg(company), company)[
    platform
  ];
  if (row?.handle) return `@${String(row.handle).replace(/^@/, "")}`;
  return "";
}

function brandDataSocialEditSeed(platform, company) {
  if (platform === "linkedin.com") {
    const url = String(company.linkedin_company_url || "").trim();
    if (url) return url.replace(/^https?:\/\/(www\.)?/i, "");
    const row = socialHandlesByPlatform(brandDataSocialAgg(company), company)[
      "linkedin.com"
    ];
    if (!row?.handle) return "";
    const h = String(row.handle).replace(/^@/, "").trim();
    if (h.includes("linkedin.com")) {
      return h.replace(/^https?:\/\/(www\.)?/i, "");
    }
    return h;
  }
  if (platform === "twitter.com") {
    const handle = String(company.twitter_handle || "")
      .trim()
      .replace(/^@/, "");
    if (handle) return handle;
    const row = socialHandlesByPlatform(brandDataSocialAgg(company), company)[
      "twitter.com"
    ];
    return row?.handle ? String(row.handle).replace(/^@/, "") : "";
  }
  const row = socialHandlesByPlatform(brandDataSocialAgg(company), company)[
    platform
  ];
  return row?.handle ? String(row.handle).replace(/^@/, "") : "";
}

function brandDataSocialPlaceholder(platform) {
  if (platform === "linkedin.com") return "linkedin.com/company/…";
  return "@handle";
}

function mountBrandDataEditableValue(row, company, entry) {
  const { label, platform } = entry;
  const val = document.createElement("button");
  val.type = "button";
  val.className = "sc-brand-data-value is-editable";
  val.title = `Edit ${label}`;
  setText(val, entry.value);

  const startEdit = () => {
    if (val.dataset.editing === "1") return;
    val.dataset.editing = "1";
    const seed = brandDataSocialEditSeed(platform, company);
    const originalDisplay = val.textContent;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "sc-brand-data-value-input";
    input.value = seed;
    input.placeholder = brandDataSocialPlaceholder(platform);

    let cancelled = false;
    const remount = (text) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sc-brand-data-value is-editable";
      btn.title = `Edit ${label}`;
      setText(btn, text);
      btn.addEventListener("click", startEdit);
      row.replaceChild(btn, input);
    };
    const cancel = () => remount(originalDisplay);
    const save = async () => {
      if (cancelled) return;
      const raw = input.value.trim();
      if (raw === seed) {
        cancel();
        return;
      }
      input.disabled = true;
      const socials = patchCompanySocials(company, platform, raw);
      try {
        const ok = await persistCompanySocials(company, socials, {
          onSuccess: async (fresh) => renderBrandDetail(fresh),
        });
        if (!ok) input.disabled = false;
      } catch (_) {
        input.disabled = false;
      }
    };

    val.replaceWith(input);
    input.focus();
    input.select();
    input.addEventListener("blur", save);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        cancelled = true;
        e.preventDefault();
        input.removeEventListener("blur", save);
        cancel();
      }
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      }
    });
  };

  val.addEventListener("click", startEdit);
  return val;
}

function mountBrandDataAddSocialTrigger(list, company) {
  const row = document.createElement("div");
  row.className = "sc-brand-data-row sc-brand-data-add-trigger";
  const link = document.createElement("button");
  link.type = "button";
  link.className = "sc-brand-data-value is-editable sc-brand-data-add-link";
  setText(link, "Add Social");
  link.addEventListener("click", () => {
    if (list.querySelector(".sc-brand-data-add-row")) return;
    openBrandDataAddSocialRow(row, list, company);
  });
  row.appendChild(link);
  list.appendChild(row);
}

function restoreBrandDataAddSocialTrigger(row, list, company) {
  row.className = "sc-brand-data-row sc-brand-data-add-trigger";
  row.replaceChildren();
  const link = document.createElement("button");
  link.type = "button";
  link.className = "sc-brand-data-value is-editable sc-brand-data-add-link";
  setText(link, "Add Social");
  link.addEventListener("click", () => {
    if (list.querySelector(".sc-brand-data-add-row")) return;
    openBrandDataAddSocialRow(row, list, company);
  });
  row.appendChild(link);
}

function openBrandDataAddSocialRow(row, list, company) {
  const available = brandDataSocialPlatformsAvailable(company);
  if (!available.length) {
    row.remove();
    return;
  }

  row.className = "sc-brand-data-row sc-brand-data-add-row";
  row.replaceChildren();

  const fields = document.createElement("div");
  fields.className = "sc-brand-data-add-fields";

  const select = document.createElement("select");
  select.className = "sc-brand-data-add-select";
  available.forEach((platform) => {
    const opt = document.createElement("option");
    opt.value = platform;
    setText(opt, BRAND_DATA_SOCIAL_LABEL[platform] || prettyPlatform(platform));
    select.appendChild(opt);
  });

  const input = document.createElement("input");
  input.type = "text";
  input.className = "sc-brand-data-value-input";
  input.placeholder = brandDataSocialPlaceholder(select.value);
  select.addEventListener("change", () => {
    input.placeholder = brandDataSocialPlaceholder(select.value);
  });

  fields.appendChild(select);
  fields.appendChild(input);
  row.appendChild(fields);

  let saving = false;
  let cancelled = false;
  const cancel = () => {
    if (!saving) restoreBrandDataAddSocialTrigger(row, list, company);
  };
  const save = async () => {
    if (cancelled || saving) return;
    const raw = input.value.trim();
    if (!raw) {
      cancel();
      return;
    }
    saving = true;
    input.disabled = true;
    select.disabled = true;
    const socials = patchCompanySocials(company, select.value, raw);
    try {
      const ok = await persistCompanySocials(company, socials, {
        onSuccess: async (fresh) => renderBrandDetail(fresh),
      });
      if (!ok) {
        saving = false;
        input.disabled = false;
        select.disabled = false;
      }
    } catch (_) {
      saving = false;
      input.disabled = false;
      select.disabled = false;
    }
  };

  const onRowFocusOut = (e) => {
    if (saving || cancelled) return;
    const next = e.relatedTarget;
    if (next && row.contains(next)) return;
    setTimeout(() => {
      if (saving || cancelled) return;
      if (row.contains(document.activeElement)) return;
      save();
    }, 0);
  };
  row.addEventListener("focusout", onRowFocusOut);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      cancelled = true;
      e.preventDefault();
      row.removeEventListener("focusout", onRowFocusOut);
      cancel();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  });
  select.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      cancelled = true;
      e.preventDefault();
      cancel();
    }
  });

  input.focus();
}

function brandCustomerDataEntries(company) {
  const entries = [];

  const websiteLabel = brandCustomerStageReadable(
    getStageStatus(company, "website_synthesis"),
    {
      skipDone: true,
    },
  );
  if (websiteLabel === "Failed") {
    entries.push({ label: "Website", value: websiteLabel });
  }

  const linkedinDisplay = brandDataSocialDisplayValue("linkedin.com", company);
  if (linkedinDisplay) {
    entries.push({
      label: "LinkedIn",
      value: linkedinDisplay,
      platform: "linkedin.com",
      editableSocial: true,
    });
  }

  const twitterDisplay = brandDataSocialDisplayValue("twitter.com", company);
  if (twitterDisplay) {
    entries.push({
      label: "X",
      value: twitterDisplay,
      platform: "twitter.com",
      editableSocial: true,
    });
  }

  const handlesByPlatform = socialHandlesByPlatform(
    brandDataSocialAgg(company),
    company,
  );
  for (const platform of EDIT_SOCIAL_PLATFORMS) {
    if (platform === "twitter.com" || platform === "linkedin.com") continue;
    const row = handlesByPlatform[platform];
    if (!row?.handle) continue;
    entries.push({
      label: BRAND_DATA_SOCIAL_LABEL[platform] || prettyPlatform(platform),
      value: `@${String(row.handle).replace(/^@/, "")}`,
      platform,
      editableSocial: true,
    });
  }

  const created = Number(company.created_at || 0);
  if (Number.isFinite(created) && created > 0) {
    entries.push({ label: "Joined", value: formatEpochTimestamp(created) });
  }

  return entries;
}

function buildBrandCustomerDataSection(company) {
  const entries = brandCustomerDataEntries(company);
  const canAdd = brandDataSocialPlatformsAvailable(company).length > 0;
  if (!entries.length && !canAdd) return null;

  const wrap = document.createElement("div");
  wrap.className = "sc-brand-overview-data";

  const head = document.createElement("div");
  head.className = "sc-brand-data-head";
  const headLabel = document.createElement("div");
  headLabel.className = "sc-detail-label";
  setText(headLabel, "Brand data");
  head.appendChild(headLabel);

  const list = document.createElement("div");
  list.className = "sc-brand-data-rows";
  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "sc-brand-data-row";
    const lbl = document.createElement("span");
    lbl.className = "sc-brand-data-label";
    setText(lbl, entry.label);
    row.appendChild(lbl);
    if (entry.editableSocial) {
      row.appendChild(mountBrandDataEditableValue(row, company, entry));
    } else {
      const val = document.createElement("span");
      val.className = "sc-brand-data-value";
      setText(val, entry.value);
      row.appendChild(val);
    }
    list.appendChild(row);
  });

  if (canAdd) mountBrandDataAddSocialTrigger(list, company);

  wrap.appendChild(head);
  wrap.appendChild(list);
  attachSectionToggle(head, list, `brand:${company.id}:section:brand-data`);
  return wrap;
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

function buildBrandOverviewSection(synthesis, companyId) {
  const detail = document.createElement("div");
  detail.className = "sc-card-detail";
  const block = document.createElement("div");
  const detailHead = document.createElement("div");
  detailHead.className = "sc-detail-head";
  const label = document.createElement("div");
  label.className = "sc-detail-label";
  setText(label, "Brand story");
  detailHead.appendChild(label);
  const summary = document.createElement("p");
  summary.className = "sc-detail-summary";
  setText(summary, synthesis);
  const canCollapse = synthesis.length > 140;
  if (canCollapse) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "customer-mobile-audience-expand";
    const expanded = isBrandStoryExpanded(companyId);
    if (expanded) {
      summary.classList.add("is-expanded");
      toggle.classList.add("is-expanded");
      toggle.setAttribute("aria-label", "Show less");
    } else {
      toggle.setAttribute("aria-label", "Show more");
    }
    toggle.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const isExpanded = summary.classList.toggle("is-expanded");
      toggle.classList.toggle("is-expanded", isExpanded);
      toggle.setAttribute("aria-label", isExpanded ? "Show less" : "Show more");
      setBrandStoryExpanded(companyId, isExpanded);
    });
    detailHead.appendChild(toggle);
  }
  block.appendChild(detailHead);
  block.appendChild(summary);
  detail.appendChild(block);
  return detail;
}

function buildBrandStoryCard(story, company) {
  const tone = storyUrgency(story.story_last_seen_at).tone;
  const card = document.createElement("div");
  card.className = `sc-card is-${tone}`;
  appendStoriesCardHeadAndStats(card, story, {
    generateBtn: buildScGenerateBtn({
      ariaLabel: "React with content",
      className: "brand-consuming-cta",
      onClick: (event) => {
        event.stopPropagation();
        enterContentGuidedChat(story, company.id);
      },
    }),
  });
  card.appendChild(
    buildStoriesDetailContent(story, company, {
      viewInStories: true,
      hideSeenBy: true,
      hideActions: true,
      showAllPosts: true,
    }),
  );
  return card;
}

function brandStoryAudienceSighting(story, audienceId) {
  return Array.isArray(story.audiences)
    ? story.audiences.find(
        (row) => String(row.audience_id || "") === audienceId,
      )
    : null;
}

function brandHomeRecentStoryCardShape(story) {
  const lastSeenAt = story.last_seen_at || story.story_last_seen_at;
  const strength = storyUrgency(lastSeenAt);
  return {
    ...story,
    title: story.headline || story.title || "Story",
    story_last_seen_at: lastSeenAt,
    strength,
  };
}

function brandHomeAudienceStoryObjects(stories, audienceId) {
  return brandStoriesForAudience(stories, audienceId).map((story) => {
    const sighting = brandStoryAudienceSighting(story, audienceId);
    const lastSeenAt =
      sighting && sighting.last_seen_at
        ? sighting.last_seen_at
        : story.story_last_seen_at;
    const strength = storyUrgency(lastSeenAt);
    return {
      ...story,
      title: story.headline || story.title || "Story",
      strength,
      story_last_seen_at: lastSeenAt,
      posts: Array.isArray(story.posts) ? story.posts : [],
    };
  });
}

function ensureBrandHomeBodyWrap() {
  const shell = document.querySelector(".brand-ops-shell[data-brand-id]");
  if (!shell) return null;
  let body = shell.querySelector(".brand-home-body");
  if (!body) return null;
  let wrap = shell.querySelector(".brand-home-body-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "brand-home-body-wrap";
    body.parentNode.insertBefore(wrap, body);
    wrap.appendChild(body);
  }
  return { wrap, body };
}

function applyBrandHomeStoryFocus() {
  brandHomeStoryFocus = true;
  const mounted = ensureBrandHomeBodyWrap();
  if (!mounted) return;
  const { body } = mounted;
  const audCol = body.querySelector(".brand-home-audiences-col");
  if (!audCol) return;
  const gap = parseFloat(getComputedStyle(body).gap) || 16;
  body.style.setProperty(
    "--brand-home-shift",
    `${audCol.getBoundingClientRect().width + gap}px`,
  );
  body.classList.add("is-story-focus");
}

function clearBrandHomeStoryFocus() {
  brandHomeStoryFocus = false;
  document
    .querySelector(".brand-home-body.is-story-focus")
    ?.classList.remove("is-story-focus");
}

function brandHomeStoriesAccordionOptions(company, story) {
  const storyId = customerStoryId(story);
  return {
    onReact: () => void brandHomeStartCampaignFromStory(company, story),
    reactBtnVariant: "outlined",
    onAccordionClick: () => brandHomeStoryAccordionClick(company, storyId),
  };
}

function brandHomeStoryAccordionClick(company, storyId) {
  if (!storyId) return;
  if (storiesCustomerExpanded.has(storyId)) {
    storiesCustomerExpanded.delete(storyId);
    patchBrandHomeStoriesAccordion();
    return;
  }
  const list = brandHomeStoriesList();
  const card = list?.querySelector(`[data-story-id="${CSS.escape(storyId)}"]`);
  const expandCard = () => {
    storiesCustomerExpanded.add(storyId);
    if (!list) {
      brandHomeStoriesAccordionToggle(company);
      return;
    }
    patchBrandHomeStoriesAccordion();
    triggerBrandHomeStoryOpenAnimation(storyId);
  };
  if (!list || !card) {
    expandCard();
    return;
  }
  scrollListToElement(list, card, expandCard);
}

async function brandHomeStartCampaignFromStory(company, story) {
  const storyId = customerStoryId(story);
  const resolvedCompany = company?.id
    ? company
    : preBrandOverlayCompany() || null;
  if (!resolvedCompany?.id) {
    if (!(await requireSignIn())) return;
    showToast("Add your brand first!");
    focusPreBrandCreateInput();
    return;
  }
  if (
    !(await requireSignIn({
      intent: {
        action: "startCampaign",
        companyId: resolvedCompany.id,
        storyId,
      },
    }))
  )
    return;
  const key = `${resolvedCompany.id}:${storyId}`;
  if (contentStoryCampaignStartInFlight.has(key)) return;
  contentStoryCampaignStartInFlight.add(key);
  // slide into content-gen immediately; the chat shows a loading state until the
  // campaign create returns, so the animation no longer waits on the round-trip
  contentDesktopSelectedCampaignId = "";
  contentDesktopDetailCampaign = null;
  brandHomeContentGenStarting = true;
  dashboardRightMode = "chat";
  enterContentGeneration(storyId, story);
  try {
    const { ok, status, body } = await api("/api/home/start-campaign", {
      method: "POST",
      body: {
        company_id: resolvedCompany.id,
        story_id: story.story_id || storyId,
      },
    });
    if (handleUpgradeRequired(status)) {
      brandHomeContentGenStarting = false;
      exitContentGeneration(resolvedCompany);
      return;
    }
    if (!ok || !body?.campaign) {
      brandHomeContentGenStarting = false;
      exitContentGeneration(resolvedCompany);
      showToast("Couldn't create the campaign. Try again.");
      return;
    }
    brandHomeContentGenStarting = false;
    contentDesktopSelectedCampaignId = body.campaign.id;
    contentDesktopDetailCampaign = body.campaign;
    pendingSitmarJobs.add(body.campaign.id);
    trackEvent("campaign_created", { campaign_id: body.campaign.id });
    void loadSitmar().then(() => scheduleSitmarPolling(1200));
    if (!renderBrandHomeContentColOnly(resolvedCompany))
      renderBrandDetail(resolvedCompany);
  } catch (err) {
    brandHomeContentGenStarting = false;
    exitContentGeneration(resolvedCompany);
    showToast("Network error: " + (err.message || ""));
  } finally {
    contentStoryCampaignStartInFlight.delete(key);
  }
}

function enterContentGeneration(storyId, story) {
  const company = companies.find((c) => c.id === selectedBrandId);
  if (!company) return;

  if (
    brandHomeViewMode === "content-generation" &&
    brandHomeContentGenCollapsed
  ) {
    if (storyId) {
      storiesCustomerSelectedId = storyId;
      storiesCustomerExpanded.add(storyId);
      if (
        story &&
        !storiesCustomerFeed.some((row) => customerStoryId(row) === storyId)
      ) {
        storiesCustomerFeed = [story, ...storiesCustomerFeed];
      }
    }
    if (storyId) {
      if (!renderBrandHomeStoriesColOnly(company)) renderBrandDetail(company);
      scheduleBrandHomeStoryScroll(storyId);
    } else if (!renderBrandHomeContentColOnly(company)) {
      renderBrandDetail(company);
    }
    syncAppRouteFromState();
    return;
  }

  brandHomeViewMode = "content-generation";
  brandHomeStoryFocus = true;
  brandHomeContentGenCollapsed = false;
  if (storyId) {
    storiesCustomerSelectedId = storyId;
    storiesCustomerExpanded.add(storyId);
    if (
      story &&
      !storiesCustomerFeed.some((row) => customerStoryId(row) === storyId)
    ) {
      storiesCustomerFeed = [story, ...storiesCustomerFeed];
    } else if (
      !storiesCustomerFeed.some((row) => customerStoryId(row) === storyId)
    ) {
      const cached = storiesCustomerDetailCache.get(storyId);
      if (cached) storiesCustomerFeed = [cached, ...storiesCustomerFeed];
    }
  }

  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const existingBody = document.querySelector(".brand-home-body");
  const existingAudCol = existingBody?.querySelector(
    ".brand-home-audiences-col",
  );
  const existingContentCol = existingBody?.querySelector(
    ".brand-home-content-col",
  );
  const existingStoriesCol = existingBody?.querySelector(
    ".brand-home-stories-col",
  );

  if (existingBody && existingAudCol && existingContentCol && !reducedMotion) {
    // fade content col header out before it vanishes in re-render
    const existingHeader = existingContentCol.querySelector(
      ":scope > .content-col-header",
    );
    if (existingHeader) {
      existingHeader.style.transition =
        "opacity 0.2s ease, min-height 0.24s ease, padding-top 0.24s ease, padding-bottom 0.24s ease";
      void existingHeader.offsetHeight;
      existingHeader.style.opacity = "0";
      existingHeader.style.minHeight = "0";
      existingHeader.style.paddingTop = "0";
      existingHeader.style.paddingBottom = "0";
      existingHeader.style.overflow = "hidden";
    }

    // fade the current stories list out before it becomes the single selected card
    if (existingStoriesCol) {
      existingStoriesCol.style.transition = "opacity 0.2s ease";
      void existingStoriesCol.offsetHeight;
      existingStoriesCol.style.opacity = "0";
    }

    // freeze aud col width so the CSS transition starts from a known value
    const w = existingAudCol.offsetWidth;
    existingAudCol.style.width = w + "px";
    existingAudCol.style.flexBasis = w + "px";
    existingAudCol.style.minWidth = w + "px";
    existingAudCol.style.maxWidth = w + "px";

    requestAnimationFrame(() => {
      existingAudCol.style.removeProperty("width");
      existingAudCol.style.removeProperty("flex-basis");
      existingAudCol.style.removeProperty("min-width");
      existingAudCol.style.removeProperty("max-width");
      existingBody.classList.remove("is-story-focus");
      existingBody.classList.add("is-content-gen", "is-content-gen-entering");
      brandHomeContentGenCollapsed = true;

      // swap content + stories cols mid-transition — the single story card
      // fades in via .is-content-gen-entering
      window.setTimeout(() => {
        if (!renderBrandHomeContentColOnly(company)) renderBrandDetail(company);
        if (!renderBrandHomeStoriesColOnly(company)) renderBrandDetail(company);
      }, 200);

      window.setTimeout(() => {
        existingBody.classList.remove("is-content-gen-entering");
      }, 700);
    });
  } else {
    renderBrandDetail(company);
    requestAnimationFrame(() => {
      const body = document.querySelector(".brand-home-body");
      if (!body) {
        brandHomeContentGenCollapsed = true;
        return;
      }
      const audCol = body.querySelector(".brand-home-audiences-col");
      if (audCol) {
        const w = audCol.offsetWidth;
        audCol.style.width = w + "px";
        audCol.style.flexBasis = w + "px";
        audCol.style.minWidth = w + "px";
        audCol.style.maxWidth = w + "px";
      }
      requestAnimationFrame(() => {
        if (audCol) {
          audCol.style.removeProperty("width");
          audCol.style.removeProperty("flex-basis");
          audCol.style.removeProperty("min-width");
          audCol.style.removeProperty("max-width");
        }
        body.classList.add("is-content-gen");
        brandHomeContentGenCollapsed = true;
        if (storyId) scheduleBrandHomeStoryScroll(storyId);
      });
    });
  }
  syncAppRouteFromState();
}

function exitContentGeneration(company) {
  brandHomeViewMode = "default";
  brandHomeStoryFocus = false;
  brandHomeContentGenCollapsed = false;
  brandHomePendingPostContent = false;
  storiesCustomerSelectedId = "";
  contentDesktopSelectedCampaignId = "";
  contentDesktopDetailCampaign = null;
  resetUnifiedChat();
  dashboardRightMode = "content";
  document
    .querySelector(".brand-home-body")
    ?.classList.remove(
      "is-content-gen",
      "is-content-gen-entering",
      "is-story-focus",
    );
  renderBrandDetail(company);
  syncAppRouteFromState();
}

function brandHomeStoriesList() {
  return document.querySelector(
    ".brand-home-stories-col .stories-desktop-list",
  );
}

function syncBrandHomeStoryAccordion(storyId) {
  const list = brandHomeStoriesList();
  if (!list) return;
  list.querySelectorAll(".sc-card[data-story-id]").forEach((card) => {
    const id = card.dataset.storyId || "";
    const expanded = storiesCustomerExpanded.has(id);
    const shell = card.querySelector(".sc-card-detail-shell");
    if (!expanded) {
      shell?.classList.remove("is-detail-settled");
      if (shell) void shell.offsetHeight;
    }
    card.classList.toggle("collapsed", !expanded);
    if (expanded) {
      syncStoryCardDetailShell(card, true);
      const story = storiesCustomerFeed.find(
        (row) => customerStoryId(row) === id,
      );
      if (story && !String(story.summary || "").trim()) {
        void ensureStoriesCustomerDetail(id);
      }
    }
  });
}

function markBrandHomePageFadeComplete() {
  pageFadeInComplete = true;
  tryAutoExpandFirstBrandHomeStory();
}

function scheduleBrandHomeFirstStoryOpen(openFn) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    openFn();
    return;
  }
  window.setTimeout(() => requestAnimationFrame(openFn), 160);
}

function triggerBrandHomeStoryOpenAnimation(storyId) {
  triggerStoryCardOpenAnimation(brandHomeStoriesList(), storyId);
}

function openBrandHomeStoryAccordionAnimated(storyId) {
  storiesCustomerExpanded.add(storyId);
  if (!patchBrandHomeStoriesAccordion()) return;
  triggerBrandHomeStoryOpenAnimation(storyId);
}

function tryAutoExpandFirstBrandHomeStory(company) {
  if (brandHomeDesktopStoriesAutoOpened) return;
  if (!pageFadeInComplete) return;
  if (currentView !== "brands") return;
  if (brandHomeViewMode !== "default") return;
  if (storiesCustomerExpanded.size > 0) {
    brandHomeDesktopStoriesAutoOpened = true;
    return;
  }
  const rows = storiesForDisplay(company || null);
  const first = rows.find((row) => String(row.summary || "").trim()) || rows[0];
  if (!first) return;
  const storyId = customerStoryId(first);
  if (!storyId) return;
  brandHomeDesktopStoriesAutoOpened = true;

  const runOpen = () => openBrandHomeStoryAccordionAnimated(storyId);

  if (!brandHomeStoriesList()) {
    const resolved =
      company || companies.find((c) => c.id === selectedBrandId) || null;
    if (resolved && renderBrandHomeStoriesColOnly(resolved)) {
      scheduleBrandHomeFirstStoryOpen(runOpen);
      return;
    }
    if (!selectedBrandId) renderBrandHomeEmpty();
    return;
  }

  scheduleBrandHomeFirstStoryOpen(runOpen);
}

function patchBrandHomeStoriesAccordion() {
  const list = brandHomeStoriesList();
  if (!list) return false;
  syncBrandHomeStoryAccordion();
  return true;
}

function brandHomeStoriesAccordionToggle(company) {
  if (patchBrandHomeStoriesAccordion()) return;
  renderBrandDetail(company);
}

let brandHomeStoriesScrollFrame = null;

function easeInOutQuint(t) {
  return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
}

function scrollListToElement(list, el, onComplete) {
  if (brandHomeStoriesScrollFrame) {
    cancelAnimationFrame(brandHomeStoriesScrollFrame);
    brandHomeStoriesScrollFrame = null;
  }
  const finish = () => {
    brandHomeStoriesScrollFrame = null;
    if (typeof onComplete === "function") onComplete();
  };
  const snap = () => {
    list.scrollTop = brandHomeStoryScrollTop(list, el);
    finish();
  };
  const start = list.scrollTop;
  const target = brandHomeStoryScrollTop(list, el);
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
    brandHomeStoriesScrollFrame = requestAnimationFrame(step);
  }
  brandHomeStoriesScrollFrame = requestAnimationFrame(step);
}

function brandHomeStoryScrollTop(list, el) {
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

function scrollBrandHomeStoryIntoView(storyId) {
  const list = brandHomeStoriesList();
  if (!list || !storyId) return;
  const card = list.querySelector(`[data-story-id="${CSS.escape(storyId)}"]`);
  if (card) scrollListToElement(list, card);
}

function scheduleBrandHomeStoryScroll(storyId) {
  if (!storyId) return;
  const runScroll = () => {
    const list = brandHomeStoriesList();
    if (!list) return;
    if (!list.clientHeight) {
      requestAnimationFrame(runScroll);
      return;
    }
    scrollBrandHomeStoryIntoView(storyId);
  };
  const body = document.querySelector(".brand-home-body");
  if (!body) {
    window.setTimeout(runScroll, 48);
    return;
  }
  const finish = () => runScroll();
  const onTransitionEnd = (e) => {
    if (e.target !== body || e.propertyName !== "transform") return;
    body.removeEventListener("transitionend", onTransitionEnd);
    finish();
  };
  body.addEventListener("transitionend", onTransitionEnd);
  window.setTimeout(finish, 560);
}

function mountBrandHomeStoriesList(company) {
  const col = document.querySelector(".brand-home-stories-col");
  if (!col) return false;
  if (brandHomeStoriesList()) return true;
  col.querySelector(".sc-empty")?.remove();
  if (!storiesCustomerFeed.length) return false;
  const list = document.createElement("div");
  list.className = "stories-desktop-list sc-pad";
  const rerender = () => brandHomeStoriesAccordionToggle(company);
  let rows = storiesForDisplay(company);
  if (brandHomeViewMode === "content-generation") {
    const filterId =
      storiesCustomerSelectedId ||
      String(resolvedContentGenCampaign()?.story_id || "").trim();
    if (filterId) {
      rows = rows.filter((s) => customerStoryId(s) === filterId);
    }
  }
  rows.forEach((row) => {
    list.appendChild(
      buildStoriesAccordionCard(
        row,
        company,
        rerender,
        brandHomeStoriesAccordionOptions(company, row),
      ),
    );
  });
  if (brandHomeViewMode !== "content-generation") {
    list.appendChild(buildStoriesCustomerLoadFooter());
    bindStoriesCustomerListScroll(list);
  }
  col.appendChild(list);
  stampStoriesCardEnterAnimation(list);
  return true;
}

function appendBrandHomeStoryCards(company, newRows, listEl) {
  const list = listEl || brandHomeStoriesList();
  if (!list || !company) {
    if (!renderBrandHomeStoriesColOnly(company)) renderBrandDetail(company);
    return;
  }
  if (brandHomeViewMode === "content-generation" && storiesCustomerSelectedId) {
    return;
  }
  const scrollTop = list.scrollTop;
  const footer =
    list.querySelector(".stories-customer-load-footer") ||
    buildStoriesCustomerLoadFooter();
  const rerender = () => brandHomeStoriesAccordionToggle(company);
  const seen = new Set(
    [...list.querySelectorAll(".sc-card[data-story-id]")].map(
      (card) => card.dataset.storyId || "",
    ),
  );
  const frag = document.createDocumentFragment();
  let added = 0;
  for (const story of Array.isArray(newRows) ? newRows : []) {
    const storyId = customerStoryId(story);
    if (!storyId || seen.has(storyId)) continue;
    seen.add(storyId);
    frag.appendChild(
      buildStoriesAccordionCard(
        story,
        company,
        rerender,
        brandHomeStoriesAccordionOptions(company, story),
      ),
    );
    added += 1;
  }
  if (added) {
    list.insertBefore(frag, footer);
    if (!footer.isConnected) list.appendChild(footer);
  } else if (!footer.isConnected) {
    list.appendChild(footer);
  }
  list.scrollTop = scrollTop;
}

function patchBrandHomeStorySelection(company, story, storyId) {
  const list = brandHomeStoriesList();
  if (!list) return false;
  let card = list.querySelector(`[data-story-id="${CSS.escape(storyId)}"]`);
  if (!card) {
    const rerender = () => brandHomeStoriesAccordionToggle(company);
    card = buildStoriesAccordionCard(
      story,
      company,
      rerender,
      brandHomeStoriesAccordionOptions(company, story),
    );
    list.insertBefore(card, list.firstChild);
  }
  syncBrandHomeStoryAccordion(storyId);
  applyBrandHomeStoryFocus();
  scheduleBrandHomeStoryScroll(storyId);
  return true;
}

function openBrandHomeStoryDetail(company, story) {
  void brandHomeStartCampaignFromStory(company, story);
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

function buildBrandHomeAudienceStoryCard(story, company) {
  const tone =
    story.strength?.tone || storyUrgency(story.story_last_seen_at).tone;
  const card = document.createElement("button");
  card.type = "button";
  card.className = `brand-consuming-story sc-card is-${tone}`;
  card.addEventListener("click", () => {
    openBrandHomeStoryDetail(company, story);
  });

  const title = document.createElement("span");
  title.className = "brand-consuming-story-title";
  setText(title, story.title || story.headline || "Story");
  card.setAttribute(
    "aria-label",
    `Open story: ${title.textContent || "Story"}`,
  );
  card.appendChild(title);

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
  card.appendChild(action);

  return card;
}

function buildBrandHomeAudienceDetailContent(item, company, trendsStories) {
  const detail = document.createElement("div");
  detail.className = "brand-home-aud-detail";
  const descriptionText = String(item.description || "").trim();
  const matchedAudienceId =
    item && item.match && typeof item.match === "object"
      ? String(item.match.audience_id || "").trim()
      : "";

  if (descriptionText) {
    const desc = document.createElement("p");
    desc.className = "brand-home-aud-description";
    setText(desc, descriptionText);
    detail.appendChild(desc);
  }

  const consumingWrap = document.createElement("div");
  consumingWrap.className =
    "brand-consuming-stories brand-consuming-stories-compact";
  consumingWrap.appendChild(buildEngagingNowLabel());

  const currentStories = Array.isArray(item.recent_stories)
    ? item.recent_stories.map(brandHomeRecentStoryCardShape)
    : matchedAudienceId
      ? brandHomeAudienceStoryObjects(trendsStories, matchedAudienceId)
      : [];
  if (currentStories.length) {
    currentStories.forEach((story) => {
      consumingWrap.appendChild(
        buildBrandHomeAudienceStoryCard(story, company),
      );
    });
  } else {
    const empty = document.createElement("div");
    empty.className = "sc-empty";
    setText(
      empty,
      matchedAudienceId
        ? "No connected stories yet."
        : "No matched in-house audience yet.",
    );
    consumingWrap.appendChild(empty);
  }

  detail.appendChild(consumingWrap);
  return detail;
}

function buildBrandAudienceChip(item, idx, memberImages) {
  const titleText = String(item.title || "").trim();
  const matchedAudienceId =
    item && item.match && typeof item.match === "object"
      ? String(item.match.audience_id || "").trim()
      : "";
  const memberProfile = matchedAudienceId
    ? memberImages.get(matchedAudienceId) || null
    : null;
  const chip = document.createElement("span");
  chip.className = "sc-audience-chip";
  const av = document.createElement("span");
  av.className = "sc-audience-av";
  av.style.background =
    STORIES_ACCENT_PALETTE[idx % STORIES_ACCENT_PALETTE.length];
  const audienceImageUrl = brandAudienceImageUrl(item, memberProfile);
  if (audienceImageUrl) {
    const img = document.createElement("img");
    img.src = audienceImageUrl;
    img.alt = "";
    img.onerror = () => {
      img.remove();
      setText(av, (titleText || "?")[0].toUpperCase());
    };
    av.appendChild(img);
  } else {
    setText(av, (titleText || "?")[0].toUpperCase());
  }
  chip.appendChild(av);
  const label = document.createElement("span");
  label.className = "sc-audience-chip-label";
  setText(label, titleText || "Untitled audience");
  chip.appendChild(label);
  return chip;
}

function brandAudienceImageUrl(item, memberProfile) {
  const direct = String(item?.member_image_url || "").trim();
  if (direct) return direct;
  const match =
    item && item.match && typeof item.match === "object" ? item.match : null;
  return (
    String(
      memberProfile?.imageUrl ||
        memberProfile?.profile_image_url ||
        memberProfile?.image_url ||
        match?.member_image_url ||
        match?.profile_image_url ||
        item?.profile_image_url ||
        "",
    ).trim() || null
  );
}

function buildBrandHomeAudienceHeader(item, memberImages) {
  const titleText = String(item.title || "").trim();
  const descriptionText = String(item.description || "").trim();
  const matchedAudienceId =
    item && item.match && typeof item.match === "object"
      ? String(item.match.audience_id || "").trim()
      : "";
  const memberProfile =
    memberImages && matchedAudienceId
      ? memberImages.get(matchedAudienceId) || null
      : null;
  const memberHandle =
    String(item.member_handle || memberProfile?.handle || "").trim() || null;
  const header = document.createElement("div");
  header.className = "brand-home-aud-section-head";
  header.appendChild(
    avatarFor(
      memberHandle || titleText || "audience",
      "brand-home-aud-section-avatar",
      brandAudienceImageUrl(item, memberProfile),
    ),
  );
  const title = document.createElement("h3");
  title.className = "brand-home-aud-section-title";
  setText(title, titleText || "Untitled audience");
  header.appendChild(title);
  if (descriptionText) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "brand-home-aud-section-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Show audience description");
    toggle.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const section = header.closest(".brand-home-aud-section");
      const desc = section?.querySelector(".brand-home-aud-description");
      if (!desc) return;
      const expanded = desc.classList.toggle("is-expanded");
      toggle.classList.toggle("is-expanded", expanded);
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      toggle.setAttribute(
        "aria-label",
        expanded ? "Hide audience description" : "Show audience description",
      );
    });
    header.appendChild(toggle);
  }
  return header;
}

function buildBrandAudienceDetailContent(
  item,
  idx,
  company,
  trendsStories,
  memberImages,
) {
  const detail = document.createElement("div");
  detail.className = "sc-card-detail";

  const descriptionText = String(item.description || "").trim();
  const matchedAudienceId =
    item && item.match && typeof item.match === "object"
      ? String(item.match.audience_id || "").trim()
      : "";

  if (descriptionText) {
    const descWrap = document.createElement("div");
    const descHead = document.createElement("div");
    descHead.className = "sc-detail-head";
    const descLabel = document.createElement("div");
    descLabel.className = "sc-detail-label";
    setText(descLabel, "About");
    descHead.appendChild(descLabel);
    const desc = document.createElement("p");
    desc.className = "sc-detail-summary";
    setText(desc, descriptionText);
    if (descriptionText.length > 140) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "customer-mobile-audience-expand";
      toggle.setAttribute("aria-label", "Show more");
      toggle.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const isExpanded = desc.classList.toggle("is-expanded");
        toggle.classList.toggle("is-expanded", isExpanded);
        toggle.setAttribute(
          "aria-label",
          isExpanded ? "Show less" : "Show more",
        );
      });
      descHead.appendChild(toggle);
    }
    descWrap.appendChild(descHead);
    descWrap.appendChild(desc);
    detail.appendChild(descWrap);
  }

  const consumingWrap = document.createElement("div");
  consumingWrap.className = "brand-consuming-stories";
  consumingWrap.appendChild(buildEngagingNowLabel());

  const matchedStories = brandStoriesForAudience(
    trendsStories,
    matchedAudienceId,
  );
  if (matchedStories.length) {
    matchedStories.forEach((story) => {
      consumingWrap.appendChild(buildBrandStoryCard(story, company));
    });
  } else {
    const empty = document.createElement("div");
    empty.className = "sc-empty";
    setText(
      empty,
      matchedAudienceId
        ? "No connected stories yet."
        : "No matched in-house audience yet.",
    );
    consumingWrap.appendChild(empty);
  }
  detail.appendChild(consumingWrap);

  return detail;
}

function buildBrandAudienceDetailPane(
  item,
  idx,
  company,
  trendsStories,
  memberImages,
) {
  const titleText = String(item.title || "").trim();
  const pane = document.createElement("div");
  pane.className = "stories-desktop-detail-inner";
  const head = document.createElement("div");
  head.className = "stories-desktop-detail-head";
  const h2 = document.createElement("h2");
  setText(h2, titleText || "Untitled audience");
  head.appendChild(h2);
  pane.appendChild(head);
  pane.appendChild(
    buildBrandAudienceDetailContent(
      item,
      idx,
      company,
      trendsStories,
      memberImages,
    ),
  );
  return pane;
}

function buildBrandAudienceAccordionCard(
  item,
  idx,
  company,
  trendsStories,
  memberImages,
) {
  const matchedAudienceId =
    item && item.match && typeof item.match === "object"
      ? String(item.match.audience_id || "").trim()
      : "";
  const expanded = brandCustomerExpandedAudiences.has(matchedAudienceId);
  const card = document.createElement("div");
  card.className = `sc-card${expanded ? "" : " collapsed"}`;
  card.addEventListener("click", (event) => {
    if (event.target.closest("button, a, input, select, textarea, label"))
      return;
    if (brandCustomerExpandedAudiences.has(matchedAudienceId)) {
      brandCustomerExpandedAudiences.delete(matchedAudienceId);
    } else {
      brandCustomerExpandedAudiences.add(matchedAudienceId);
    }
    renderBrandDetail(company);
  });

  const head = document.createElement("div");
  head.className = "sc-card-head";
  const titleCol = document.createElement("div");
  titleCol.className = "sc-card-title";
  titleCol.appendChild(buildBrandAudienceChip(item, idx, memberImages));
  head.appendChild(titleCol);
  card.appendChild(head);
  card.appendChild(
    buildBrandAudienceDetailContent(
      item,
      idx,
      company,
      trendsStories,
      memberImages,
    ),
  );
  return card;
}

function appendBrandCustomerAudiences(
  shell,
  company,
  audiences,
  trendsStories,
  memberImages,
) {
  if (!audiences.length) return;

  const narrow = storiesCustomerNarrow();
  if (narrow) {
    if (
      !brandCustomerAudiencesAutoOpened &&
      brandCustomerExpandedAudiences.size === 0 &&
      audiences.length > 0
    ) {
      const firstId = String(audiences[0]?.match?.audience_id || "").trim();
      if (firstId) brandCustomerExpandedAudiences.add(firstId);
      brandCustomerAudiencesAutoOpened = true;
    }
    const pad = document.createElement("div");
    pad.className = "sc-pad stories-desktop-narrow-feed";
    audiences.forEach((item, idx) => {
      pad.appendChild(
        buildBrandAudienceAccordionCard(
          item,
          idx,
          company,
          trendsStories,
          memberImages,
        ),
      );
    });
    const listCol = document.createElement("div");
    listCol.className = "stories-desktop-listcol";
    listCol.appendChild(pad);
    shell.appendChild(listCol);
    return;
  }

  const selectedItem = ensureBrandCustomerAudienceSelection(audiences);
  const selectedIdx = Math.max(
    0,
    audiences.findIndex(
      (item) =>
        item &&
        item.match &&
        String(item.match.audience_id || "") ===
          brandCustomerSelectedAudienceId,
    ),
  );

  const body = document.createElement("div");
  body.className = "stories-desktop-body";

  const listCol = document.createElement("div");
  listCol.className = "stories-desktop-listcol";
  const list = document.createElement("div");
  list.className = "stories-desktop-list sc-pad";
  audiences.forEach((item, idx) => {
    list.appendChild(
      buildBrandAudienceListRow(item, idx, item === selectedItem, company),
    );
  });
  listCol.appendChild(list);

  const detail = document.createElement("div");
  detail.className = "stories-desktop-detail";
  if (selectedItem) {
    detail.appendChild(
      buildBrandAudienceDetailPane(
        selectedItem,
        selectedIdx,
        company,
        trendsStories,
        memberImages,
      ),
    );
  } else {
    const emptyDetail = document.createElement("div");
    emptyDetail.className = "sc-empty stories-desktop-detail-empty";
    setText(emptyDetail, "Select an audience from the list.");
    detail.appendChild(emptyDetail);
  }

  body.appendChild(listCol);
  body.appendChild(detail);
  shell.appendChild(body);
}

function renderBrandCustomerView(company, inner) {
  closeBrandCustomerPopover();
  inner.innerHTML = "";

  const synthesis = String(company.brand_synthesis || "").trim();
  const audiences = brandAudiencesCache.get(company.id) || [];
  ensureBrandAudiences(company.id);

  renderBrandSynthesisPanel(company, inner, {
    synthesis,
    audiences,
  });
}

function buildBrandHomeAudiencesBackButton() {
  const headRow = document.createElement("div");
  headRow.className =
    "mobile-campaign-chat-head brand-home-audiences-back-head";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "sc-sortbtn mobile-campaign-chat-back";
  back.setAttribute("aria-label", "Back to audiences");
  back.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 6l-6 6 6 6"/></svg><span>Audiences</span>';
  back.addEventListener("click", () => {
    if (brandHomeViewMode === "content-generation") {
      const company = companies.find((c) => c.id === selectedBrandId);
      if (company) exitContentGeneration(company);
      return;
    }
    clearBrandHomeStoryFocus();
  });
  headRow.appendChild(back);
  return headRow;
}

function buildBrandHomeAudiencesBackButtonInline() {
  const back = document.createElement("button");
  back.type = "button";
  back.className = "sc-sortbtn brand-home-back-inline";
  back.setAttribute("aria-label", "Back to audiences");
  back.innerHTML =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M15 6l-6 6 6 6"/></svg>' +
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>';
  back.addEventListener("click", () => {
    const company = companies.find((c) => c.id === selectedBrandId);
    if (company) exitContentGeneration(company);
  });
  return back;
}

function buildGatedStoryCard(story, company, rerender, options) {
  const card = buildStoriesAccordionCard(story, company, rerender, options);
  card.classList.add("sc-card-gated");
  return card;
}

function buildStoriesGateCTA() {
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
    else requireSignIn();
  });
  cta.appendChild(btn);
  return cta;
}

function wrapStoriesGateAnchor(card, cta) {
  const anchor = document.createElement("div");
  anchor.className = "stories-gate-anchor";
  anchor.appendChild(card);
  anchor.appendChild(cta);
  return anchor;
}

function buildBrandHomeStoriesCol(company) {
  const isContentGen = brandHomeViewMode === "content-generation";
  const col = document.createElement("div");
  col.className = "brand-home-stories-col";

  if (!isContentGen) {
    col.appendChild(buildBrandHomeAudiencesBackButton());
  }

  const listHead = document.createElement("div");
  listHead.className = "sc-listhead sc-listhead-actions";

  if (!isContentGen) {
    const controls = document.createElement("div");
    controls.className = "sc-list-controls";

    const sortBtn = document.createElement("button");
    sortBtn.type = "button";
    sortBtn.className = "sc-sortbtn";
    sortBtn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M6 12h12M10 18h4"/></svg>';
    const sortLabelEl = document.createElement("span");
    normalizeStoriesCustomerSortMode();
    setText(sortLabelEl, storySortLabel(storiesCustomerSortMode));
    sortBtn.appendChild(sortLabelEl);
    sortBtn.addEventListener("click", () => {
      normalizeStoriesCustomerSortMode();
      const modes = storiesCustomerSortModes();
      const idx = modes.indexOf(storiesCustomerSortMode);
      storiesCustomerSortMode = modes[(idx + 1) % modes.length];
      if (company) {
        if (!renderBrandHomeStoriesColOnly(company)) renderBrandDetail(company);
      } else if (!renderPreBrandStoriesColOnly()) {
        renderBrandHomeEmpty();
      }
    });
    controls.appendChild(sortBtn);
    listHead.appendChild(controls);
  }

  const contentGenCampaign = isContentGen
    ? resolvedContentGenCampaign() || contentDesktopDetailCampaign
    : null;
  const isPostedDistribute =
    isContentGen &&
    String(contentGenCampaign?.status || "").toLowerCase() === "posted";

  const titleStack = document.createElement("div");
  titleStack.className = "sc-title-stack";
  if (isContentGen) {
    titleStack.classList.add("sc-title-stack-inline");
    titleStack.appendChild(buildBrandHomeAudiencesBackButtonInline());
  } else {
    titleStack.appendChild(brandHomeTrendingOnXTitleH1());
  }
  listHead.classList.add("sc-listhead-with-title");
  listHead.prepend(titleStack);
  if (isPostedDistribute && contentGenCampaign) {
    const controls = document.createElement("div");
    controls.className = "sc-list-controls";
    controls.appendChild(
      buildSitmarDistributeSidebarToggle(contentGenCampaign),
    );
    listHead.appendChild(controls);
  }
  col.appendChild(listHead);

  if (isPostedDistribute && contentGenCampaign) {
    hydrateSitmarDistributeState(contentGenCampaign, { force: true });
    const list = document.createElement("div");
    list.className =
      "stories-desktop-list sc-pad stories-desktop-distribute-queue";
    renderSitmarDistributeSidebarList(contentGenCampaign, list);
    col.appendChild(list);
    return col;
  }

  let stories = storiesForDisplay(company);
  if (isContentGen) {
    const filterId =
      storiesCustomerSelectedId ||
      String(contentGenCampaign?.story_id || "").trim();
    if (filterId) {
      stories = stories.filter((s) => customerStoryId(s) === filterId);
    }
  }
  if (!stories.length) {
    const empty = document.createElement("div");
    empty.className = "sc-empty";
    setText(
      empty,
      storiesCustomerEmptyMessage({
        audienceFilterEmpty: !!storiesCustomerFeed.length,
      }),
    );
    col.appendChild(empty);
    return col;
  }

  const list = document.createElement("div");
  list.className = "stories-desktop-list sc-pad";
  const rerender = () =>
    company
      ? brandHomeStoriesAccordionToggle(company)
      : renderPreBrandStoriesColOnly() || renderBrandHomeEmpty();
  const GATED_VISIBLE = 2;
  const visible = storiesCustomerGated
    ? stories.slice(0, GATED_VISIBLE)
    : stories;
  visible.forEach((story) => {
    const opts = brandHomeStoriesAccordionOptions(company, story);
    if (isContentGen) opts.static = true;
    list.appendChild(buildStoriesAccordionCard(story, company, rerender, opts));
  });
  if (storiesCustomerGated && stories.length > GATED_VISIBLE) {
    const gated = stories.slice(GATED_VISIBLE, GATED_VISIBLE + 8);
    const gateCta = buildStoriesGateCTA();
    gated.forEach((story, index) => {
      const card = buildGatedStoryCard(
        story,
        company,
        rerender,
        brandHomeStoriesAccordionOptions(company, story),
      );
      list.appendChild(
        index === 0 ? wrapStoriesGateAnchor(card, gateCta) : card,
      );
    });
  }
  if (!storiesCustomerGated && !isContentGen) {
    list.appendChild(buildStoriesCustomerLoadFooter());
    bindStoriesCustomerListScroll(list);
  }
  col.appendChild(list);
  stampStoriesCardEnterAnimation(list);
  return col;
}

function buildBrandHomeAudiencesCol(company, audiences) {
  const col = document.createElement("div");
  col.className = "brand-home-audiences-col";

  const nav = document.createElement("div");
  nav.className = "brand-home-aud-nav";
  const navHead = document.createElement("div");
  navHead.className = "brand-home-aud-head";
  const titleStack = document.createElement("div");
  titleStack.className = "sc-title-stack";
  titleStack.appendChild(brandHomeTitleH1("Target Audiences"));
  navHead.appendChild(titleStack);
  nav.appendChild(navHead);

  const details = document.createElement("div");
  details.className = "brand-home-aud-details";
  details.appendChild(buildBrandHomeAudiencesBrandHeader(company));

  if (!audiences.length) {
    const empty = document.createElement("div");
    empty.className = "sc-empty";
    const audienceStatus = getStageStatus(company, "audience");
    const matchStatus = getStageStatus(company, "audience_match");
    let emptyMsg = "No audiences yet.";
    if (isStagePendingOrRunning(company, "audience")) {
      emptyMsg = "Identifying your audiences...";
    } else if (
      isStagePendingOrRunning(company, "audience_match") ||
      !isStageSettled(company, "audience_match")
    ) {
      emptyMsg = "Matching to our audience network...";
    }
    setText(empty, emptyMsg);
    col.appendChild(nav);
    col.appendChild(details);
    col.appendChild(empty);
    return col;
  }

  col.appendChild(nav);

  audiences.forEach((item, idx) => {
    const matchedAudienceId =
      item && item.match && typeof item.match === "object"
        ? String(item.match.audience_id || "").trim()
        : "";
    const section = document.createElement("div");
    section.className = "brand-home-aud-section";
    if (matchedAudienceId) section.id = `brand-aud-${matchedAudienceId}`;
    section.appendChild(buildBrandHomeAudienceHeader(item));
    section.appendChild(buildBrandHomeAudienceDetailContent(item, company));
    details.appendChild(section);
  });
  col.appendChild(details);
  return col;
}

function brandHomeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function brandHomeNeedsBrandGreeting() {
  return `${brandHomeGreeting()}! Enter your company's website to start generating custom content for your brand.`;
}

function brandHomeReadyGreeting() {
  return `${brandHomeGreeting()}. Ready to draft a post?`;
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

let _spotlightState = null;

function teardownPreBrandSpotlight(immediate) {
  if (!_spotlightState) return;
  const state = _spotlightState;
  window.clearTimeout(state.autoHide);
  document.removeEventListener("pointerdown", state.onPointerDown, {
    capture: true,
  });
  if (immediate || state.fading) {
    state.el.remove();
    _spotlightState = null;
    return;
  }
  state.fading = true;
  state.el.classList.add("is-fading-out");
  state.el.addEventListener(
    "animationend",
    (e) => {
      if (e.animationName !== "pre-brand-spotlight-out") return;
      state.el.remove();
      if (_spotlightState === state) _spotlightState = null;
    },
    { once: true },
  );
}

function showPreBrandSpotlight() {
  teardownPreBrandSpotlight(true);
  const card = document.querySelector(".pre-brand-overlay-card");
  if (!card) return;
  const rect = card.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const el = document.createElement("div");
  el.className = "pre-brand-spotlight";
  el.style.setProperty("--sx", cx + "px");
  el.style.setProperty("--sy", cy + "px");
  el.style.setProperty("--srx", rect.width / 2 + 140 + "px");
  el.style.setProperty("--sry", rect.height / 2 + 140 + "px");
  document.body.appendChild(el);
  function onPointerDown(e) {
    if (!card.contains(e.target)) removePreBrandSpotlight();
  }
  document.addEventListener("pointerdown", onPointerDown, { capture: true });
  const autoHide = window.setTimeout(removePreBrandSpotlight, 2000);
  _spotlightState = { el, onPointerDown, autoHide, fading: false };
}

function removePreBrandSpotlight() {
  teardownPreBrandSpotlight(false);
}

function pulsePreBrandInput() {
  const input = document.querySelector(".pre-brand-overlay-input");
  if (!input) return;
  input.scrollIntoView({ behavior: "smooth", block: "center" });
  showPreBrandSpotlight();
  input.classList.add("is-input-highlighted");
  input.addEventListener(
    "animationend",
    () => input.classList.remove("is-input-highlighted"),
    { once: true },
  );
  requestAnimationFrame(() => input.focus());
}

function focusPreBrandCreateInput() {
  pulsePreBrandInput();
}

function homeChatTypingIndicator() {
  const el = document.createElement("div");
  el.className = "sitmar-bubble sitmar-bubble-assistant sitmar-chat-loading";
  const dots = document.createElement("span");
  dots.className = "sitmar-typing";
  dots.innerHTML = "<span></span><span></span><span></span>";
  el.appendChild(dots);
  return el;
}

function homeChatProgressLine(text) {
  return meleaStatusLine(text);
}

function appendBrandHomeReadyChatActions(thread, _scroll, company) {
  thread.appendChild(
    buildActionGrid([
      {
        label: "Draft a post",
        iconHtml: SITMAR_ICON_PENCIL,
        ariaLabel: "Draft a post",
        iconBg: SITMAR_ICON_DRAFT_POST.bg,
        iconColor: SITMAR_ICON_DRAFT_POST.color,
        onClick: () => {
          void (async () => {
            if (
              !(await requireSignIn({
                intent: {
                  action: "draftPost",
                  companyId: company.id,
                  via: "studio",
                  dashboardRightMode: "chat",
                },
              }))
            )
              return;
            dashboardRightMode = "chat";
            brandHomePendingPostContent = true;
            enterContentGeneration();
          })();
        },
      },
    ]),
  );
}

function buildBrandHomeIntroChat(company) {
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

  scroll.appendChild(thread);
  shell.appendChild(scroll);

  return shell;
}

function startDraftPostFlow(company) {
  const thread = unifiedChatThread;
  const scrollEl = unifiedChatScroll;
  if (!thread || !scrollEl) return;
  thread.appendChild(sitmarBubble("user", "Draft a post"));
  const progress = homeChatProgressLine("Finding a few different options…");
  thread.appendChild(progress);
  scrollChatToBottom(scrollEl);
  void handleHomeChatPostContent(company, thread, scrollEl, progress);
}

async function handleHomeChatPostContent(company, thread, scroll, loading) {
  if (!(await requireSignIn())) {
    loading.remove();
    return;
  }
  try {
    const { ok, body } = await api("/api/home/suggest-stories", {
      method: "POST",
      body: { company_id: company.id },
    });
    loading.remove();
    if (!ok || !body || !Array.isArray(body.stories) || !body.stories.length) {
      thread.appendChild(
        sitmarBubble(
          "assistant",
          "I couldn't find stories for this brand right now. Try again later.",
        ),
      );
      scrollChatToBottom(scroll);
      return;
    }
    thread.appendChild(
      sitmarBubble(
        "assistant",
        body.message || "Here are some stories to react to:",
      ),
    );
    const storyGrid = buildActionGrid(
      body.stories.map((story, storyIndex) => ({
        label: story.headline || "",
        subtitle: story.reason || story.summary || "",
        icon: String(storyIndex + 1),
        ariaLabel: story.headline || `Story ${storyIndex + 1}`,
        iconBg: SITMAR_ACTION_ICON_STYLES[storyIndex].bg,
        iconColor: SITMAR_ACTION_ICON_STYLES[storyIndex].color,
        onClick: () => {
          storyGrid.querySelectorAll(".sitmar-action-btn").forEach((btn) => {
            btn.disabled = true;
          });
          storyGrid.remove();
          thread.appendChild(
            buildStoryContextBubble({
              role: "user",
              type: "story_context",
              headline: story.headline || "",
              summary: story.reason || story.summary || "",
              post_count: story.post_count || 0,
              last_seen_at: story.last_seen_at || story.last_updated_at,
              brand_score: story.brand_score,
            }),
          );
          scrollChatToBottom(scroll);
          const campLoading = homeChatTypingIndicator();
          thread.appendChild(campLoading);
          scrollChatToBottom(scroll);
          void handleHomeChatStartCampaign(
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
    unifiedPhase = "stories";
    scrollChatToBottom(scroll);
  } catch (err) {
    loading.remove();
    thread.appendChild(
      sitmarBubble("assistant", "Something went wrong. " + (err.message || "")),
    );
    scrollChatToBottom(scroll);
  }
}

async function handleHomeChatStartCampaign(
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
  try {
    const { ok, status, body } = await api("/api/home/start-campaign", {
      method: "POST",
      body: { company_id: company.id, story_id: story.story_id },
    });
    loading.remove();
    if (handleUpgradeRequired(status)) return;
    if (!ok || !body || !body.campaign) {
      thread.appendChild(
        sitmarBubble("assistant", "Couldn't create the campaign. Try again."),
      );
      scrollChatToBottom(scroll);
      return;
    }
    const campaignId = body.campaign.id;
    contentDesktopSelectedCampaignId = campaignId;
    contentDesktopDetailCampaign = body.campaign;
    sitmarDetailCampaign = body.campaign;
    unifiedChatCampaignId = campaignId;
    unifiedPhase = "campaign";
    pendingSitmarJobs.add(campaignId);
    sitmarCampaigns.unshift(body.campaign);
    trackEvent("campaign_created", { campaign_id: campaignId });
    scheduleSitmarPolling(1200);
    const storyId = String(story.story_id || customerStoryId(story) || "").trim();
    if (storyId) {
      storiesCustomerSelectedId = storyId;
      storiesCustomerExpanded.add(storyId);
      if (
        !storiesCustomerFeed.some((row) => customerStoryId(row) === storyId)
      ) {
        storiesCustomerFeed = [story, ...storiesCustomerFeed];
      }
    }
    if (!transitionUnifiedCampaignChat(body.campaign)) {
      const co = companies.find((c) => c.id === selectedBrandId);
      if (co && !renderBrandHomeContentColOnly(co)) renderBrandDetail(co);
    }
    const co = companies.find((c) => c.id === selectedBrandId);
    if (co && storyId && !renderBrandHomeStoriesColOnly(co)) {
      renderBrandDetail(co);
    }
  } catch (err) {
    loading.remove();
    thread.appendChild(
      sitmarBubble("assistant", "Something went wrong. " + (err.message || "")),
    );
    scrollChatToBottom(scroll);
  }
}

function swapContentColBody(col, company) {
  resetUnifiedChat();
  col.classList.toggle("is-chat", dashboardRightMode === "chat");
  col.querySelectorAll(".content-col-header .content-tab-btn").forEach((b) => {
    b.classList.toggle("is-on", b.dataset.mode === dashboardRightMode);
  });
  const scroll = col.querySelector(".content-col-scroll");
  if (scroll) {
    scroll.innerHTML = "";
    appendUpgradeUpbarIfNeeded(scroll);
    if (dashboardRightMode === "content") {
      const inner = buildContentCol1();
      const innerHeader = inner.querySelector(".content-col-header");
      const campaignTabs = innerHeader?.querySelector(".content-tab-toggle");
      if (campaignTabs) scroll.appendChild(campaignTabs);
      const innerScroll = inner.querySelector(".content-col-scroll");
      if (innerScroll) {
        while (innerScroll.firstChild)
          scroll.appendChild(innerScroll.firstChild);
      }
    } else {
      scroll.appendChild(buildBrandHomeIntroChat(company));
    }
  }
}

const CONTENT_TAB_ICON_MESSAGES_SQUARE =
  '<svg class="content-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/><path d="M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.07.613l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"/></svg>';
const CONTENT_TAB_ICON_HISTORY =
  '<svg class="content-tab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>';

function buildDashboardRightToggle(company) {
  const tabs = document.createElement("div");
  tabs.className = "content-tab-toggle";
  [
    { key: "chat", label: "Create", icon: CONTENT_TAB_ICON_MESSAGES_SQUARE },
    { key: "content", label: "History", icon: CONTENT_TAB_ICON_HISTORY },
  ].forEach((tab) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.mode = tab.key;
    btn.className =
      "content-tab-btn" + (dashboardRightMode === tab.key ? " is-on" : "");
    btn.setAttribute("aria-label", tab.label);
    btn.innerHTML = tab.icon;
    if (tab.key === "content") {
      applyContentStudioHistoryButtonState(btn, company?.id);
    }
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      if (dashboardRightMode === tab.key) return;
      dashboardRightMode = tab.key;
      const col = btn.closest(".brand-home-content-col");
      if (col) {
        swapContentColBody(col, company);
      } else {
        renderBrandDetail(company);
      }
    });
    tabs.appendChild(btn);
  });
  return tabs;
}

function buildBrandHomeContentCol(company) {
  const isContentGen = brandHomeViewMode === "content-generation";
  if (
    dashboardRightMode === "content" &&
    !contentHistoryCountForCompany(company?.id)
  ) {
    dashboardRightMode = "chat";
  }
  const { col, header, scroll } = contentCol("", "content-col-content");
  col.className =
    "brand-home-content-col" +
    (dashboardRightMode === "chat" || isContentGen ? " is-chat" : "");

  header.innerHTML = "";
  if (!isContentGen) {
    const titleStack = document.createElement("div");
    titleStack.className = "sc-title-stack";
    titleStack.appendChild(brandHomeTitleH1("Content Studio"));
    header.appendChild(titleStack);
    if (brandHomeChatPhase(company) === "ready") {
      header.appendChild(buildDashboardRightToggle(company));
    }
  }

  appendUpgradeUpbarIfNeeded(scroll);

  if (isContentGen) {
    if (brandHomeContentGenStarting && !contentDesktopSelectedCampaignId) {
      scroll.appendChild(contentLoading("Starting new campaign…"));
      return col;
    }
    if (contentDesktopSelectedCampaignId) {
      const status = effectiveCampaignStatus();
      if (isUnifiedCampaignStatus(status)) {
        const campaign = resolvedContentGenCampaign();
        if (!campaign || (!campaign.messages && status !== "error")) {
          scroll.appendChild(contentLoading("Loading…"));
          fetchContentCampaignDetail(contentDesktopSelectedCampaignId);
          return col;
        }
        scroll.appendChild(mountUnifiedChat(company, campaign));
        if (brandHomePendingPostContent) {
          brandHomePendingPostContent = false;
          startDraftPostFlow(company);
        }
      } else {
        const detailWrap = document.createElement("div");
        detailWrap.className = "brand-home-campaign-detail";
        detailWrap.appendChild(buildContentDetailPane());
        scroll.appendChild(detailWrap);
      }
    } else {
      scroll.appendChild(mountUnifiedChat(company));
      if (brandHomePendingPostContent) {
        brandHomePendingPostContent = false;
        startDraftPostFlow(company);
      }
    }
  } else if (dashboardRightMode === "content") {
    const inner = buildContentCol1();
    const innerScroll = inner.querySelector(".content-col-scroll");
    if (innerScroll) {
      while (innerScroll.firstChild) scroll.appendChild(innerScroll.firstChild);
    }
  } else {
    scroll.appendChild(buildBrandHomeIntroChat(company));
  }
  return col;
}

function mountedPreBrandHomeShell() {
  const root = $("detail");
  const shell =
    root && root.querySelector('.brand-ops-shell[data-pre-brand="true"]');
  return shell || null;
}

function renderPreBrandStoriesColOnly() {
  const shell = mountedPreBrandHomeShell();
  if (!shell) return false;
  const existing = shell.querySelector(".brand-home-stories-col");
  if (!existing) return false;
  existing.replaceWith(buildBrandHomeStoriesCol(null));
  if (brandHomeStoryFocus && storiesCustomerSelectedId) {
    scheduleBrandHomeStoryScroll(storiesCustomerSelectedId);
  }
  return true;
}

function mountedBrandHomeShell(companyId) {
  const root = $("detail");
  const shell = root && root.querySelector(".brand-ops-shell");
  if (!shell || shell.dataset.brandId !== companyId) return null;
  return shell;
}

function ensureBrandHomeStoriesLoad(company) {
  if (
    !company?.id ||
    storiesCustomerFeed.length ||
    storiesCustomerLoadingMore
  ) {
    return;
  }
  storiesCustomerHasMore = true;
  storiesCustomerLoadingMore = true;
  void loadStoriesCustomerPage({ append: false });
}

function renderBrandHomeAudiencesColOnly(company) {
  if (
    brandHomeViewMode !== "default" &&
    brandHomeViewMode !== "content-generation"
  )
    return false;
  const shell = mountedBrandHomeShell(company.id);
  if (!shell) return false;
  const existing = shell.querySelector(".brand-home-audiences-col");
  if (!existing) return false;
  const audiences = brandAudiencesCache.get(company.id) || [];
  existing.replaceWith(buildBrandHomeAudiencesCol(company, audiences));
  return true;
}

function renderBrandHomeStoriesColOnly(company) {
  if (
    brandHomeViewMode !== "default" &&
    brandHomeViewMode !== "content-generation"
  )
    return false;
  const shell = mountedBrandHomeShell(company.id);
  if (!shell) return false;
  const existing = shell.querySelector(".brand-home-stories-col");
  if (!existing) return false;
  existing.replaceWith(buildBrandHomeStoriesCol(company));
  if (brandHomeStoryFocus && storiesCustomerSelectedId) {
    scheduleBrandHomeStoryScroll(storiesCustomerSelectedId);
  }
  return true;
}

function renderBrandHomeContentColOnly(company) {
  if (
    brandHomeViewMode !== "default" &&
    brandHomeViewMode !== "content-generation"
  )
    return false;
  const shell = mountedBrandHomeShell(company.id);
  if (!shell) return false;
  const existing = shell.querySelector(".brand-home-content-col");
  if (!existing) return false;

  if (unifiedChatShell?.isConnected) {
    const status = effectiveCampaignStatus();
    if (!contentDesktopSelectedCampaignId) {
      syncUnifiedIntro(company);
      return true;
    }
    if (isUnifiedCampaignStatus(status)) {
      syncUnifiedThread(
        resolvedContentGenCampaign() || contentDesktopDetailCampaign,
      );
      return true;
    }
    resetUnifiedChat();
  }

  existing.replaceWith(buildBrandHomeContentCol(company));
  return true;
}

function renderBrandSynthesisPanel(company, inner, { synthesis, audiences }) {
  const shell = document.createElement("div");
  shell.className = "brand-ops-shell";
  shell.dataset.brandId = company.id;

  // sync stories brand
  if (storiesCustomerBrandId !== company.id) {
    storiesCustomerBrandId = company.id;
    storiesCustomerFeed = [];
    storiesCustomerWindowIndex = 0;
    storiesCustomerOffset = 0;
    storiesCustomerHasMore = true;
    storiesCustomerLoadingMore = false;
    storiesCustomerDetailCache.clear();
    storiesCustomerDetailInFlight.clear();
    brandHomeDesktopStoriesAutoOpened = false;
  } else if (
    !shouldResumePreBrandOnboarding(company) &&
    storiesCustomerFeed.length &&
    storiesCustomerFeed.some(
      (story) => !Object.prototype.hasOwnProperty.call(story, "brand_score"),
    )
  ) {
    storiesCustomerFeed = [];
    storiesCustomerWindowIndex = 0;
    storiesCustomerOffset = 0;
    storiesCustomerHasMore = true;
    storiesCustomerLoadingMore = false;
    storiesCustomerDetailCache.clear();
    storiesCustomerDetailInFlight.clear();
    brandHomeDesktopStoriesAutoOpened = false;
  }
  // sync content brand (directly, no setContentDesktopBrand which triggers content-page re-render)
  contentDesktopBrandId = company.id;

  ensureBrandHomeStoriesLoad(company);
  // load campaigns if needed
  if (!sitmarCampaigns.length) {
    void loadSitmar().then(() => {
      if (currentView === "brands" && selectedBrandId === company.id) {
        if (!renderBrandHomeContentColOnly(company)) renderBrandDetail(company);
      }
    });
  }

  const body = document.createElement("div");
  let bodyCls = "brand-home-body";
  if (
    brandHomeViewMode === "content-generation" &&
    brandHomeContentGenCollapsed
  ) {
    bodyCls += " is-content-gen";
  } else if (brandHomeStoryFocus) {
    bodyCls += " is-story-focus";
  }
  body.className = bodyCls;

  body.appendChild(buildBrandHomeAudiencesCol(company, audiences));
  body.appendChild(buildBrandHomeStoriesCol(company));
  body.appendChild(buildBrandHomeContentCol(company));

  const bodyWrap = document.createElement("div");
  bodyWrap.className = "brand-home-body-wrap";
  bodyWrap.appendChild(body);
  shell.appendChild(bodyWrap);
  inner.appendChild(shell);
  if (brandHomeStoryFocus && brandHomeViewMode === "default") {
    requestAnimationFrame(() => applyBrandHomeStoryFocus());
  }
  if (storiesCustomerFeed.length) {
    tryAutoExpandFirstBrandHomeStory(company);
  }
}

function showCustomerSynthesisOverlay(synthesisText) {
  closeBrandCustomerPopover();
  const overlay = document.createElement("div");
  overlay.className = "customer-mobile-inspector-overlay";
  const panel = document.createElement("div");
  panel.className = "customer-mobile-inspector-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.innerHTML = `
    <div class="customer-mobile-inspector-head">
      <div>
        <div class="customer-mobile-inspector-kicker">Brand inspector</div>
        <h2>Brand story</h2>
      </div>
      <button class="customer-mobile-inspector-close" type="button" aria-label="Close brand story">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>
  `;
  const summary = document.createElement("div");
  summary.className = "customer-mobile-inspector-summary";
  appendProseParagraphs(summary, synthesisText);
  panel.appendChild(summary);
  overlay.appendChild(panel);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeBrandCustomerPopover();
  });
  panel
    .querySelector(".customer-mobile-inspector-close")
    ?.addEventListener("click", closeBrandCustomerPopover);
  document.body.appendChild(overlay);
  brandCustomerOpenPopover = overlay;
}

// custom-aggregate selection is sticky per brand. there's only one
// profile view for a brand and it's either the auto "all runs" view or
// the operator's saved custom selection — whichever they used last.
// stored in localStorage so it survives reload, and the in-memory cache
// mirrors what's on disk so reads stay sync.
const CUSTOM_AGGREGATE_STORAGE_PREFIX = "melea:custom_aggregate:";
let customAggregateState = null;

function customAggregateStorageKey(companyId) {
  return CUSTOM_AGGREGATE_STORAGE_PREFIX + companyId;
}

function loadCustomAggregateFromStorage(companyId) {
  try {
    const raw = localStorage.getItem(customAggregateStorageKey(companyId));
    if (!raw) return null;
    const ids = JSON.parse(raw);
    if (!Array.isArray(ids) || ids.length === 0) return null;
    const onlyStrings = ids.filter((v) => typeof v === "string" && v);
    return onlyStrings.length ? onlyStrings : null;
  } catch (e) {
    return null;
  }
}

function saveCustomAggregateToStorage(companyId, ids) {
  try {
    localStorage.setItem(
      customAggregateStorageKey(companyId),
      JSON.stringify(ids),
    );
  } catch (e) {
    // quota errors are non-fatal — worst case we lose stickiness for one brand.
  }
}

function clearCustomAggregateFromStorage(companyId) {
  try {
    localStorage.removeItem(customAggregateStorageKey(companyId));
  } catch (e) {
    // see above.
  }
}

function hydrateCustomAggregateForCompany(companyId) {
  if (customAggregateState && customAggregateState.companyId === companyId) {
    return customAggregateState.runIds.slice();
  }
  const ids = loadCustomAggregateFromStorage(companyId);
  if (ids) {
    customAggregateState = { companyId, runIds: ids };
    return ids.slice();
  }
  return null;
}

function customAggregateRunIdsFor(companyId) {
  return hydrateCustomAggregateForCompany(companyId);
}

function clearCustomAggregateState() {
  customAggregateState = null;
}

function exitCustomAggregateMode(companyId) {
  clearCustomAggregateFromStorage(companyId);
  if (customAggregateState && customAggregateState.companyId === companyId) {
    clearCustomAggregateState();
  }
}

function crawlStatusLabel(status) {
  if (status === "running" || status === "pending") return "running";
  if (status === "done") return "done";
  if (status === "error") return "error";
  if (status === "skipped") return "skipped";
  return "idle";
}

function appendCrawlSourcePanel(parent, label, status, content, fallbackText) {
  const details = document.createElement("details");
  details.className = "crawl-source-panel";
  initBrandDetailsToggle(details, null);

  const summary = document.createElement("summary");
  summary.className = "crawl-source-summary";
  appendCrawlSummaryChevron(summary);
  const title = document.createElement("span");
  title.className = "crawl-source-title";
  setText(title, label);
  const statusEl = document.createElement("span");
  statusEl.className = "crawl-source-status " + crawlStatusLabel(status);
  summary.appendChild(title);
  summary.appendChild(statusEl);
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "crawl-source-body";
  if ((content || "").trim()) {
    const prose = document.createElement("div");
    prose.className = "brand-prose";
    appendMarkdown(prose, content);
    body.appendChild(prose);
  } else {
    const empty = document.createElement("div");
    empty.className = "meta-row";
    setText(empty, fallbackText);
    body.appendChild(empty);
  }
  details.appendChild(body);
  parent.appendChild(details);
}

function renderSearchTermsBody(parent, company, status) {
  const terms = metaSearchTerms(company);
  const model = String(company.website_synthesis_model || "").trim();
  const source = String(company.website_synthesis_source || "").trim();
  const prompt = String(company.website_synthesis_prompt || "").trim();
  let systemPrompt = "";
  let userPrompt = "";
  if (prompt) {
    try {
      const parsedPrompt = JSON.parse(prompt);
      if (parsedPrompt && typeof parsedPrompt === "object") {
        systemPrompt = String(parsedPrompt.system || "").trim();
        userPrompt = String(parsedPrompt.user || "").trim();
      }
    } catch (_) {
      // keep legacy prompt rendering below when payload is plain text
    }
  }
  const businessName = String(
    company.business_name || company.website_synthesis_business_name || "",
  ).trim();
  const resultsCol = document.createElement("div");
  resultsCol.className = "synthesis-results-col";
  const metaCol = document.createElement("div");
  metaCol.className = "synthesis-meta-col";
  const grid = document.createElement("div");
  grid.className = "synthesis-grid";

  // SUMMARY header at the top (matches the PROMPT header formatting so the two
  // columns align); the summary text itself stays below the business name row.
  const brandSummary = String(company.homepage_summary || "").trim();
  if (brandSummary) {
    const summaryHeaderRow = document.createElement("div");
    summaryHeaderRow.className = "synthesis-prompt-toggle-row";
    const summaryHeaderLabel = document.createElement("span");
    summaryHeaderLabel.className = "synthesis-prompt-toggle-label";
    setText(summaryHeaderLabel, "Summary");
    summaryHeaderRow.appendChild(summaryHeaderLabel);
    resultsCol.appendChild(summaryHeaderRow);
  }

  if (status === "running" || status === "pending") {
    const waiting = document.createElement("div");
    waiting.className = "meta-row";
    waiting.innerHTML =
      '<span class="spinner"></span>Generating website summary...';
    resultsCol.appendChild(waiting);
  }

  if (businessName) {
    const nameRow = document.createElement("div");
    nameRow.className = "meta-row";
    setText(nameRow, `Business name: ${businessName}`);
    resultsCol.appendChild(nameRow);
  }

  if (brandSummary) {
    const summaryRow = document.createElement("div");
    summaryRow.className = "meta-row synthesis-summary-text";
    setText(summaryRow, brandSummary);
    resultsCol.appendChild(summaryRow);
  }

  if (terms.length > 0) {
    const info = document.createElement("div");
    info.className = "meta-row";
    setText(info, `Primary search term: ${terms[0]}`);
    resultsCol.appendChild(info);
    if (terms.length > 1) {
      const alternates = document.createElement("div");
      alternates.className = "meta-row";
      setText(alternates, `Alternate terms: ${terms.slice(1).join(", ")}`);
      resultsCol.appendChild(alternates);
    }
  }

  // single fixed-height textarea with a System/User toggle (mirrors the sitmar
  // modal); falls back to a lone textarea for legacy plain-text prompts.
  const promptTabs = [];
  if (systemPrompt) promptTabs.push(["System", systemPrompt]);
  if (userPrompt) promptTabs.push(["User", userPrompt]);
  if (!promptTabs.length && prompt) promptTabs.push(["Prompt", prompt]);
  if (promptTabs.length) {
    const promptText = document.createElement("textarea");
    promptText.className = "linkedin-scrape-textarea";
    promptText.readOnly = true;
    promptText.style.height = "250px";
    promptText.style.overflowY = "auto";
    promptText.style.resize = "none";

    const promptRow = document.createElement("div");
    promptRow.className = "synthesis-prompt-toggle-row";
    const promptRowLabel = document.createElement("span");
    promptRowLabel.className = "synthesis-prompt-toggle-label";
    setText(promptRowLabel, "Prompt");
    promptRow.appendChild(promptRowLabel);
    if (promptTabs.length > 1) {
      const toggle = document.createElement("div");
      toggle.className = "sitmar-prompt-toggle synthesis-prompt-toggle";
      promptTabs.forEach(([label], idx) => {
        const btn = document.createElement("button");
        btn.type = "button";
        if (idx === 0) btn.className = "active";
        setText(btn, label);
        btn.addEventListener("click", () => {
          toggle
            .querySelectorAll("button")
            .forEach((b) => b.classList.toggle("active", b === btn));
          promptText.value = promptTabs[idx][1];
        });
        toggle.appendChild(btn);
      });
      promptRow.appendChild(toggle);
    }
    if (model) {
      const modelInline = document.createElement("span");
      modelInline.className = "synthesis-prompt-model";
      setText(modelInline, `(${model})`);
      promptRow.appendChild(modelInline);
    }
    metaCol.appendChild(promptRow);
    metaCol.appendChild(promptText);
    promptText.value = promptTabs[0][1];
  }

  const errText = String(company.website_synthesis_error || "").trim();
  if (status === "error") {
    const err = document.createElement("div");
    err.className = "meta-row";
    setText(err, errText || "Website summary failed.");
    resultsCol.appendChild(err);
  }

  if (status === "skipped") {
    const skipped = document.createElement("div");
    skipped.className = "meta-row";
    setText(skipped, "Website summary skipped.");
    resultsCol.appendChild(skipped);
  }

  if (
    status === "idle" &&
    !terms.length &&
    !prompt &&
    !model &&
    !source &&
    !businessName &&
    !errText
  ) {
    const idle = document.createElement("div");
    idle.className = "meta-row";
    setText(idle, "Waiting to generate website summary.");
    resultsCol.appendChild(idle);
  }
  grid.appendChild(resultsCol);
  grid.appendChild(metaCol);
  parent.appendChild(grid);
}

function appendHomepageSynthesisPanel(parent, company, status) {
  const details = document.createElement("details");
  details.className = "crawl-source-panel";
  initBrandDetailsToggle(details, `brand:${company.id}:panel:synthesis`);

  const summary = document.createElement("summary");
  summary.className = "crawl-source-summary";
  appendCrawlSummaryChevron(summary);
  const title = document.createElement("span");
  title.className = "crawl-source-title";
  setText(title, "Website Summary");
  const statusEl = document.createElement("span");
  if (status === "done") statusEl.className = "crawl-source-status done";
  else if (status === "error" || status === "skipped")
    statusEl.className = "crawl-source-status error";
  else statusEl.className = "crawl-source-status running";
  summary.appendChild(title);
  summary.appendChild(statusEl);
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "crawl-source-body";
  renderSearchTermsBody(body, company, status);
  details.appendChild(body);
  const autosizeSystemPrompts = () => {
    body
      .querySelectorAll('textarea[data-autosize="true"]')
      .forEach((el) => autosizeReadonlyTextarea(el));
  };
  details.addEventListener("toggle", () => {
    if (!details.open) return;
    requestAnimationFrame(autosizeSystemPrompts);
  });
  requestAnimationFrame(autosizeSystemPrompts);
  parent.appendChild(details);
}

function appendLinkedinCompanyPanel(parent, company, status) {
  const body = document.createElement("div");
  body.className = "crawl-source-body linkedin-profile-body";
  parent.appendChild(body);

  if (
    status === "running" ||
    status === "pending" ||
    status === "running_discovery" ||
    status === "running_fetch"
  ) {
    const waiting = document.createElement("div");
    waiting.className = "meta-row";
    if (status === "running_fetch") {
      waiting.innerHTML =
        '<span class="spinner"></span>Retrieving LinkedIn profile data...';
    } else {
      waiting.innerHTML =
        '<span class="spinner"></span>Finding LinkedIn company profile...';
    }
    body.appendChild(waiting);
    return;
  }

  const linkedinUrl = String(company.linkedin_company_url || "").trim();
  const linkedinText = String(company.linkedin_company_text || "").trim();
  const linkedinValid =
    company.linkedin_company_valid === true ||
    company.linkedin_company_valid === 1 ||
    company.linkedin_company_valid === "1";
  const linkedinValidationReason = String(
    company.linkedin_company_validation_reason || "",
  ).trim();
  const linkedinStructured =
    company &&
    company.linkedin_company_structured &&
    typeof company.linkedin_company_structured === "object"
      ? company.linkedin_company_structured
      : null;
  const grid = document.createElement("div");
  grid.className = "linkedin-profile-grid";
  const left = document.createElement("div");
  left.className = "linkedin-profile-col";
  const right = document.createElement("div");
  right.className = "linkedin-profile-col linkedin-profile-col-right";
  if (linkedinStructured) {
    const fields = [
      ["Company name", linkedinStructured.company_name],
      ["Tagline", linkedinStructured.tagline],
      ["Industry", linkedinStructured.industry],
      ["Location", linkedinStructured.location],
      ["Employees", linkedinStructured.employees],
      ["Followers", linkedinStructured.followers],
      ["Founded year", linkedinStructured.founded_year],
      ["Overview", linkedinStructured.overview],
    ];
    fields.forEach(([label, value]) => {
      const text = String(value || "").trim();
      if (!text) return;
      const row = document.createElement("div");
      row.className = "meta-row";
      setText(row, `${label}: ${text}`);
      left.appendChild(row);
    });
    const specialtiesRaw = linkedinStructured.specialties;
    if (Array.isArray(specialtiesRaw) && specialtiesRaw.length) {
      const chips = specialtiesRaw
        .map((item) => String(item || "").trim())
        .filter(Boolean);
      if (chips.length) {
        const label = document.createElement("div");
        label.className = "meta-row";
        setText(label, "Specialties:");
        left.appendChild(label);
        appendChipRow(left, chips);
      }
    }
  } else {
    const emptyExtracted = document.createElement("div");
    emptyExtracted.className = "meta-row";
    setText(emptyExtracted, "No extracted profile fields yet.");
    left.appendChild(emptyExtracted);
  }

  if (linkedinUrl) {
    const row = document.createElement("div");
    row.className = "meta-row";
    row.appendChild(document.createTextNode("Profile URL: "));
    const link = document.createElement("a");
    link.href = linkedinUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    setText(link, linkedinUrl);
    row.appendChild(link);
    right.appendChild(row);
  }
  const validationRow = document.createElement("div");
  validationRow.className = "meta-row";
  if (
    company.linkedin_company_valid === null ||
    company.linkedin_company_valid === undefined
  ) {
    setText(validationRow, "Validation: pending");
  } else if (linkedinValid) {
    setText(validationRow, "Validation: valid (brand domain found)");
  } else {
    setText(
      validationRow,
      `Validation: invalid${linkedinValidationReason ? ` - ${linkedinValidationReason}` : ""}`,
    );
  }
  right.appendChild(validationRow);
  if (linkedinText) {
    const textLabel = document.createElement("div");
    textLabel.className = "meta-row";
    setText(textLabel, "Scraped profile text:");
    right.appendChild(textLabel);

    const textBody = document.createElement("textarea");
    textBody.className = "linkedin-scrape-textarea";
    textBody.readOnly = true;
    textBody.value = linkedinText;
    right.appendChild(textBody);
  }

  const linkedinError = String(company.linkedin_company_error || "").trim();
  if (linkedinError) {
    const err = document.createElement("div");
    err.className = "meta-row";
    setText(err, linkedinError);
    right.appendChild(err);
  }

  if (!linkedinUrl && !linkedinText && !linkedinError && !linkedinStructured) {
    const empty = document.createElement("div");
    empty.className = "meta-row";
    setText(empty, "No LinkedIn profile collected yet.");
    right.appendChild(empty);
  }
  grid.appendChild(left);
  grid.appendChild(right);
  body.appendChild(grid);
}

async function openSavedAudience(audienceId) {
  if (currentView !== "audiences") {
    await switchView("audiences");
  }
  if (!audiences.find((row) => row.id === audienceId)) {
    await loadAudiences();
    renderAudiencesSidebar();
  }
  await selectAudience(audienceId);
}

function appendAudienceMatch(card, item, company) {
  const matchStatus = getStageStatus(company, "audience_match");
  const match = item && typeof item.match === "object" ? item.match : null;
  if (match && match.audience_id) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "audience-card-match";
    const score = Number(match.score);
    const pct = Number.isFinite(score) ? ` · ${Math.round(score * 100)}%` : "";
    setText(
      row,
      `In-house match: ${String(match.title || "").trim() || "audience"}${pct}`,
    );
    const reason = String(match.reason || "").trim();
    if (reason) row.title = reason;
    row.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSavedAudience(match.audience_id);
    });
    card.appendChild(row);
    return;
  }
  if (matchStatus === "done") {
    const none = document.createElement("div");
    none.className = "audience-card-match audience-card-match-none";
    setText(none, "No in-house match");
    card.appendChild(none);
  }
}

function appendAudiencePanel(parent, company, status) {
  if (status === "running" || status === "pending") {
    const waiting = document.createElement("div");
    waiting.className = "meta-row";
    waiting.innerHTML = '<span class="spinner"></span>Generating audience...';
    parent.appendChild(waiting);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "audience-grid";

  // left: audience cards
  const left = document.createElement("div");
  left.className = "audience-col";

  const audiences = Array.isArray(company.audience) ? company.audience : [];
  if (status === "error") {
    const err = document.createElement("div");
    err.className = "meta-row";
    setText(
      err,
      String(company.audience_error || "").trim() ||
        "Audience generation failed.",
    );
    left.appendChild(err);
  }
  if (status !== "error" && !audiences.length) {
    const empty = document.createElement("div");
    empty.className = "meta-row";
    setText(empty, "No audiences generated yet.");
    left.appendChild(empty);
  }
  audiences.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const titleText = String(item.title || "").trim();
    const descriptionText = String(item.description || "").trim();
    if (!titleText && !descriptionText) return;
    const card = document.createElement("div");
    card.className = "audience-card";
    if (titleText) {
      const titleEl = document.createElement("div");
      titleEl.className = "audience-card-title";
      const titleLabel = document.createElement("span");
      setText(titleLabel, titleText);
      titleEl.appendChild(titleLabel);

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "audience-card-save-btn";
      saveBtn.title = "Save audience";
      saveBtn.setAttribute("aria-label", "Save audience");
      saveBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      saveBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        saveGeneratedAudience(item, saveBtn);
      });
      titleEl.appendChild(saveBtn);
      card.appendChild(titleEl);
    }
    if (descriptionText) {
      const descriptionEl = document.createElement("div");
      descriptionEl.className = "audience-card-description";
      setText(descriptionEl, descriptionText);
      card.appendChild(descriptionEl);
    }
    appendAudienceMatch(card, item, company);
    left.appendChild(card);
  });

  // right: model, prompt, regenerate button
  const right = document.createElement("div");
  right.className = "audience-col audience-meta-col";

  const modelLabel = document.createElement("div");
  modelLabel.className = "audience-prompt-label";
  setText(modelLabel, `Model: ${company.audience_model || "claude-opus-4-8"}`);
  right.appendChild(modelLabel);

  const systemPrompt =
    "You identify distinct customer and user segments for a brand. For each segment, " +
    "provide a succinct descriptive title and 2-3 sentence description. Base your " +
    "analysis strictly on the provided brand signals. Return 1-5 segments representing " +
    "meaningfully different audience archetypes.";

  const sysLabel = document.createElement("div");
  sysLabel.className = "audience-prompt-label";
  setText(sysLabel, "System prompt:");
  right.appendChild(sysLabel);

  const sysEl = document.createElement("div");
  sysEl.className = "audience-prompt-text";
  setText(sysEl, systemPrompt);
  right.appendChild(sysEl);

  // reconstruct user prompt from available company fields
  const primaryTerm = String(
    company.website_synthesis_primary_term || "",
  ).trim();
  const businessName = String(
    company.business_name || company.website_synthesis_business_name || "",
  ).trim();
  const selectedTerm = String(
    company.website_synthesis_selected_term || "",
  ).trim();
  const synthLines = [];
  if (primaryTerm) synthLines.push(`- primary search term: ${primaryTerm}`);
  if (businessName)
    synthLines.push(`- inferred business name: ${businessName}`);
  if (selectedTerm) synthLines.push(`- selected search term: ${selectedTerm}`);
  const synthSummary = synthLines.length
    ? synthLines.join("\n")
    : "- not available";

  const linkedin =
    company.linkedin_company_structured &&
    typeof company.linkedin_company_structured === "object"
      ? company.linkedin_company_structured
      : null;
  const specialties = Array.isArray(linkedin && linkedin.specialties)
    ? linkedin.specialties
        .map((s) => String(s || "").trim())
        .filter(Boolean)
        .join(", ")
    : "not available";

  const userPromptText = [
    `brand: ${businessName || company.website_url || ""}`,
    `website: ${company.website_url || ""}`,
    ``,
    `website summary:`,
    synthSummary,
    ``,
    `linkedin profile:`,
    `- industry: ${String((linkedin || {}).industry || "").trim() || "not available"}`,
    `- overview: ${String((linkedin || {}).overview || "").trim() || "not available"}`,
    `- specialties: ${specialties}`,
    `- employees: ${String((linkedin || {}).employees || "").trim() || "not available"}`,
    ``,
    `identify 1-5 distinct audience segments for this brand.`,
  ].join("\n");

  const userLabel = document.createElement("div");
  userLabel.className = "audience-prompt-label";
  setText(userLabel, "User prompt:");
  right.appendChild(userLabel);

  const userEl = document.createElement("div");
  userEl.className = "audience-prompt-text audience-prompt-scrollable";
  setText(userEl, userPromptText);
  right.appendChild(userEl);

  grid.appendChild(left);
  grid.appendChild(right);
  parent.appendChild(grid);
}

function appendAudienceTrendsSection(host, company) {
  // depends on in-house matches existing; the stories come from the news
  // collected by the members of those matched audiences.
  if (getStageStatus(company, "audience_match") !== "done") return;
  const status = getStageStatus(company, "audience_trends");

  const top = document.createElement("div");
  top.className = "brand-website-head";
  const left = document.createElement("div");
  left.className = "brand-website-title-wrap";
  const title = document.createElement("h3");
  title.className = "brand-website-title";
  left.appendChild(title);
  const right = document.createElement("div");
  right.className = "brand-website-head-right";
  top.appendChild(left);
  top.appendChild(right);
  host.appendChild(top);

  const body = document.createElement("div");
  body.className = "brand-website-body audience-trends-body";
  host.appendChild(body);

  // null/empty status = a brand that predates this stage (matched before deploy,
  // or onboarded before it existed). the data is a live query, so treat it as an
  // idle/collected state that fetches + exposes refresh — not a stuck spinner.
  const isRunning =
    status === "running" ||
    (status === "pending" &&
      !isStalePending(getStage(company, "audience_trends")));
  if (isRunning) {
    setText(title, "Collecting audience trends...");
  } else if (status === "done") {
    setText(title, "Audience trends collected");
  } else if (status === "error") {
    setText(title, "Audience trends failed");
  } else if (status === "skipped") {
    setText(title, "Audience trends skipped");
  } else {
    setText(title, "Audience trends");
  }
  const pillStatus = isRunning
    ? "running"
    : status === "pending"
      ? "error"
      : status || "done";
  const statusEl = appendSectionStatusPill(right, pillStatus);
  attachSectionToggle(
    left,
    body,
    `brand:${company.id}:section:audience-trends`,
  );
  right.appendChild(statusEl);

  if (isRunning) {
    const waiting = document.createElement("div");
    waiting.className = "meta-row";
    waiting.innerHTML =
      '<span class="spinner"></span>Collecting audience trends...';
    body.appendChild(waiting);
    return;
  }
  if (status === "pending") {
    const note = document.createElement("div");
    note.className = "meta-row";
    setText(
      note,
      "Audience trends collection appears stalled. Re-collect to retry.",
    );
    body.appendChild(note);
    return;
  }
  if (status === "skipped") {
    const note = document.createElement("div");
    note.className = "meta-row";
    setText(
      note,
      String(company.audience_trends_error || "").trim() ||
        "Audience trends skipped.",
    );
    body.appendChild(note);
    return;
  }
  let trendsPanelRendered = false;
  const renderTrendsPanelOnce = () => {
    if (trendsPanelRendered) return;
    trendsPanelRendered = true;
    void populateAudienceTrendsPanel(body, company);
  };
  const maybeRenderTrends = () => {
    if (!body.classList.contains("hidden")) {
      renderTrendsPanelOnce();
    }
  };
  maybeRenderTrends();
  left.addEventListener("click", () =>
    requestAnimationFrame(maybeRenderTrends),
  );
  left.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    requestAnimationFrame(maybeRenderTrends);
  });
}

function appendBrandSynthesisSection(host, company) {
  const status = getStageStatus(company, "brand_synthesis");
  const synthesis = String(company.brand_synthesis || "").trim();
  const audiences = Array.isArray(company.audience) ? company.audience : [];
  if (!status && !synthesis && !audiences.length) return;

  const top = document.createElement("div");
  top.className = "brand-website-head";
  const left = document.createElement("div");
  left.className = "brand-website-title-wrap";
  const title = document.createElement("h3");
  title.className = "brand-website-title";
  left.appendChild(title);
  const right = document.createElement("div");
  right.className = "brand-website-head-right";
  top.appendChild(left);
  top.appendChild(right);
  host.appendChild(top);

  const body = document.createElement("div");
  body.className = "brand-website-body";
  host.appendChild(body);

  const isRunning = status === "running" || status === "pending";
  const isDone = status === "done" || (!!synthesis && !status);
  const isMissing = !status && !synthesis;
  if (isRunning) {
    setText(title, "Generating synthesis...");
  } else if (isDone) {
    setText(title, "Brand synthesis written");
  } else if (status === "error") {
    setText(title, "Brand synthesis failed");
  } else if (status === "skipped") {
    setText(title, "Brand synthesis skipped");
  } else if (isMissing) {
    setText(title, "Brand synthesis missing");
  } else {
    setText(title, "Brand synthesis");
  }

  const statusEl = appendSectionStatusPill(
    right,
    isRunning ? "running" : isDone ? "done" : status || "error",
  );
  attachSectionToggle(
    left,
    body,
    `brand:${company.id}:section:brand-synthesis`,
  );
  right.appendChild(statusEl);

  if (isRunning) {
    const waiting = document.createElement("div");
    waiting.className = "meta-row";
    waiting.innerHTML =
      '<span class="spinner"></span>Generating brand synthesis...';
    body.appendChild(waiting);
    return;
  }
  if (status === "error" || status === "skipped") {
    const note = document.createElement("div");
    note.className = "meta-row";
    setText(
      note,
      String(company.brand_synthesis_error || "").trim() ||
        (status === "skipped"
          ? "Brand synthesis skipped."
          : "Brand synthesis failed."),
    );
    body.appendChild(note);
    return;
  }
  if (isMissing) {
    const note = document.createElement("div");
    note.className = "meta-row";
    setText(note, "No brand synthesis has been written yet.");
    body.appendChild(note);
    return;
  }
  if (synthesis) {
    const prose = document.createElement("div");
    prose.className = "brand-prose";
    appendProseParagraphs(prose, synthesis);
    body.appendChild(prose);
  }
}

const AUDIENCE_TRENDS_SORT_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/></svg>';

function audienceTrendsStorySortKey(story) {
  if (audienceTrendsSortMode === "recency") {
    const stamps = [story.last_updated_at];
    (story.audiences || []).forEach((a) => stamps.push(a.last_seen_at));
    return stamps.reduce((max, s) => {
      const t = s ? Date.parse(s) : NaN;
      return Number.isNaN(t) ? max : Math.max(max, t);
    }, 0);
  }
  const n = Number(story.post_count);
  return Number.isFinite(n) ? n : 0;
}

async function populateAudienceTrendsPanel(body, company) {
  const {
    ok,
    status: httpStatus,
    body: payload,
  } = await api(
    `/api/company/${company.id}/audience-trends?posts_per_story=0`,
    { method: "GET" },
  );
  if (httpStatus === 401) {
    showLogin();
    return;
  }
  if (!ok) {
    const err = document.createElement("div");
    err.className = "meta-row";
    setText(err, apiErrorMessage(payload, "Could not load audience trends."));
    body.appendChild(err);
    return;
  }
  const stories = Array.isArray(payload.stories) ? payload.stories : [];
  if (!stories.length) {
    const empty = document.createElement("div");
    empty.className = "meta-row";
    setText(empty, "No news stories collected for the matched audiences yet.");
    body.appendChild(empty);
    return;
  }

  const postsCache = new Map();
  let selectedId = null;

  const panel = document.createElement("div");
  panel.className = "audience-trends-panel";
  const grid = document.createElement("div");
  grid.className = "audience-trends-grid";
  const leftCol = document.createElement("div");
  leftCol.className = "audience-trends-left";
  const head = document.createElement("div");
  head.className = "audience-trends-head";
  const headTitle = document.createElement("span");
  setText(headTitle, "Trends");
  head.appendChild(headTitle);
  const listEl = document.createElement("div");
  listEl.className = "audience-trends-list";
  const detailEl = document.createElement("div");
  detailEl.className = "audience-trends-detail";
  leftCol.appendChild(head);
  leftCol.appendChild(listEl);
  grid.appendChild(leftCol);
  grid.appendChild(detailEl);
  panel.appendChild(grid);
  body.appendChild(panel);

  function sorted() {
    return [...stories].sort(
      (a, b) => audienceTrendsStorySortKey(b) - audienceTrendsStorySortKey(a),
    );
  }

  async function renderDetail(story) {
    detailEl.innerHTML = "";

    const h = document.createElement("div");
    h.className = "audience-card-title";
    setText(h, String(story.headline || "").trim() || "(untitled story)");
    detailEl.appendChild(h);

    const summary = String(story.summary || "").trim();
    if (summary) {
      const sec = section("Summary", "");
      appendProseParagraphs(sec.querySelector(".section-body"), summary);
      detailEl.appendChild(sec);
    }

    const seenTitles = (story.audiences || [])
      .map((a) => String(a.title || "").trim())
      .filter(Boolean);
    if (seenTitles.length) {
      const seen = section(`Seen by (${seenTitles.length})`, "");
      appendChipRow(seen.querySelector(".section-body"), seenTitles);
      detailEl.appendChild(seen);
    }

    const postsSec = section("Posts", "");
    const postsBody = postsSec.querySelector(".section-body");
    detailEl.appendChild(postsSec);

    let posts = postsCache.get(story.story_id);
    if (!posts) {
      const loading = document.createElement("div");
      loading.className = "meta-row";
      loading.innerHTML = '<span class="spinner"></span>Loading posts...';
      postsBody.appendChild(loading);
      try {
        const { ok: pOk, body: pBody } = await api(
          `/api/trends/story/${encodeURIComponent(story.story_id)}?limit=50`,
          { method: "GET" },
        );
        posts = pOk && Array.isArray(pBody.posts) ? pBody.posts : [];
      } catch (_) {
        posts = [];
      }
      postsCache.set(story.story_id, posts);
      // bail if the user navigated to another story while we were loading
      if (selectedId !== story.story_id) return;
      postsBody.innerHTML = "";
    }
    if (!posts.length) {
      const empty = document.createElement("div");
      empty.className = "meta-row";
      setText(empty, "No posts captured for this story.");
      postsBody.appendChild(empty);
    } else {
      posts.forEach((p) => postsBody.appendChild(renderTrendPostCard(p)));
    }
  }

  function selectStory(story) {
    selectedId = story.story_id;
    listEl.querySelectorAll(".audience-trends-row").forEach((r) => {
      r.classList.toggle("active", r.dataset.storyId === story.story_id);
    });
    renderDetail(story);
  }

  function renderList() {
    listEl.innerHTML = "";
    const ordered = sorted();
    ordered.forEach((story) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "audience-trends-row";
      row.dataset.storyId = story.story_id;
      if (story.story_id === selectedId) row.classList.add("active");

      const title = document.createElement("div");
      title.className = "audience-trends-row-title";
      setText(title, String(story.headline || "").trim() || "(untitled story)");
      row.appendChild(title);

      const metaBits = [];
      const topic = String(story.topic_category || "").trim();
      if (topic) metaBits.push(topic);
      metaBits.push(`${formatCompactCount(story.post_count)} posts`);
      const meta = document.createElement("div");
      meta.className = "audience-trends-row-meta";
      setText(meta, metaBits.join(" · "));
      row.appendChild(meta);

      row.addEventListener("click", () => selectStory(story));
      listEl.appendChild(row);
    });
    return ordered;
  }

  const sortBtn = document.createElement("button");
  sortBtn.type = "button";
  sortBtn.className = "sidebar-header-action";
  sortBtn.setAttribute("aria-label", "Sort");
  sortBtn.title = "Sort";
  sortBtn.innerHTML = AUDIENCE_TRENDS_SORT_ICON;
  sortBtn.addEventListener("click", () => {
    audienceTrendsSortMode =
      audienceTrendsSortMode === "posts" ? "recency" : "posts";
    showToast(
      audienceTrendsSortMode === "posts"
        ? "Sorting by number of posts"
        : "Sorting by recency",
    );
    const ordered = renderList();
    if (ordered.length) selectStory(ordered[0]);
  });
  head.appendChild(sortBtn);

  renderList();
}

function appendAudienceMatchSection(host, company, audienceStatus) {
  // only surface once brand audiences exist to match against
  if (audienceStatus !== "done") return;
  const matchStatus = getStageStatus(company, "audience_match");

  const top = document.createElement("div");
  top.className = "brand-website-head";
  const left = document.createElement("div");
  left.className = "brand-website-title-wrap";
  const title = document.createElement("h3");
  title.className = "brand-website-title";
  left.appendChild(title);
  const right = document.createElement("div");
  right.className = "brand-website-head-right";
  top.appendChild(left);
  top.appendChild(right);
  host.appendChild(top);

  const body = document.createElement("div");
  body.className = "brand-website-body";
  appendAudienceMatchPanel(body, company, matchStatus);
  host.appendChild(body);

  const isRunning = matchStatus === "running" || matchStatus === "pending";
  const pillStatus = isRunning || !matchStatus ? "running" : matchStatus;
  if (isRunning) {
    setText(title, "Matching in-house audiences...");
  } else if (matchStatus === "done") {
    setText(title, "In-house audiences matched");
  } else if (matchStatus === "error") {
    setText(title, "In-house audience matching failed");
  } else if (matchStatus === "skipped") {
    setText(title, "In-house audience matching skipped");
  } else {
    setText(title, "Match in-house audiences");
  }
  const statusEl = appendSectionStatusPill(right, pillStatus);
  attachSectionToggle(left, body, `brand:${company.id}:section:audience-match`);
  right.appendChild(statusEl);
}

function appendAudienceMatchPanel(parent, company, status) {
  if (status === "running" || status === "pending") {
    const waiting = document.createElement("div");
    waiting.className = "meta-row";
    waiting.innerHTML =
      '<span class="spinner"></span>Matching in-house audiences...';
    parent.appendChild(waiting);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "audience-grid";

  const left = document.createElement("div");
  left.className = "audience-col";

  if (status === "error") {
    const err = document.createElement("div");
    err.className = "meta-row";
    setText(
      err,
      String(company.audience_match_error || "").trim() ||
        "In-house audience matching failed.",
    );
    left.appendChild(err);
  } else if (status === "skipped") {
    const note = document.createElement("div");
    note.className = "meta-row";
    setText(
      note,
      String(company.audience_match_error || "").trim() ||
        "In-house audience matching skipped.",
    );
    left.appendChild(note);
  }

  const audiences = Array.isArray(company.audience) ? company.audience : [];
  const matched = audiences.filter(
    (item) => item && typeof item.match === "object" && item.match,
  );
  if (status === "done" && !matched.length) {
    const empty = document.createElement("div");
    empty.className = "meta-row";
    setText(empty, "No in-house matches found.");
    left.appendChild(empty);
  }
  // group brand audiences by the in-house audience they matched; an in-house
  // audience appears once with all its source brand audiences stacked beneath
  const groups = new Map();
  matched.forEach((item) => {
    const match = item.match;
    const id = match.audience_id;
    if (!groups.has(id)) groups.set(id, { match, sources: [] });
    const score = Number(match.score);
    groups.get(id).sources.push({
      title: String(item.title || "").trim(),
      description: String(item.description || "").trim(),
      score: Number.isFinite(score) ? score : null,
    });
  });
  const bestScore = (g) =>
    g.sources.reduce((m, s) => Math.max(m, s.score ?? 0), 0);
  const ordered = [...groups.values()].sort(
    (a, b) => bestScore(b) - bestScore(a),
  );

  ordered.forEach((group) => {
    const match = group.match;
    const card = document.createElement("div");
    card.className = "audience-card";

    const titleEl = document.createElement("div");
    titleEl.className = "audience-card-title";
    const titleLabel = document.createElement("span");
    setText(titleLabel, String(match.title || "").trim() || "Audience");
    titleEl.appendChild(titleLabel);

    const openBtn = document.createElement("button");
    openBtn.type = "button";
    openBtn.className = "audience-card-save-btn";
    openBtn.title = "Open in-house audience";
    openBtn.setAttribute("aria-label", "Open in-house audience");
    openBtn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    openBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSavedAudience(match.audience_id);
    });
    titleEl.appendChild(openBtn);
    card.appendChild(titleEl);

    const descText = String(match.description || "").trim();
    if (descText) {
      const descEl = document.createElement("div");
      descEl.className = "audience-card-description";
      setText(descEl, descText);
      card.appendChild(descEl);
    }

    // stacked source brand-generated audiences, collapsed + de-emphasized
    group.sources.forEach((src) => {
      if (!src.title && !src.description) return;
      const details = document.createElement("details");
      details.className = "audience-source-details";
      const summary = document.createElement("summary");
      const pct = src.score != null ? ` · ${Math.round(src.score * 100)}%` : "";
      setText(
        summary,
        `Generated audience: ${src.title || "(untitled)"}${pct}`,
      );
      details.appendChild(summary);
      if (src.description) {
        const sourceDesc = document.createElement("div");
        sourceDesc.className = "audience-source-description";
        setText(sourceDesc, src.description);
        details.appendChild(sourceDesc);
      }
      card.appendChild(details);
    });

    left.appendChild(card);
  });

  // right: model + prompt info, de-emphasized
  const right = document.createElement("div");
  right.className = "audience-col audience-meta-col";

  const modelLabel = document.createElement("div");
  modelLabel.className = "audience-prompt-label";
  setText(
    modelLabel,
    `Model: ${company.audience_match_model || "claude-sonnet-4-6"}`,
  );
  right.appendChild(modelLabel);

  const systemPrompt =
    "You match a brand's customer segments against an existing catalog of in-house " +
    "audiences. For each brand segment, pick the single catalog audience whose target " +
    "customer is most semantically similar. Score the match from 0 to 1, where 1 is a " +
    "near-identical target and 0 is unrelated. If no catalog audience is a genuine fit, " +
    "still return your closest pick but score it low. Give a one-sentence reason. Base " +
    "the judgment only on the titles and descriptions provided.";

  const sysLabel = document.createElement("div");
  sysLabel.className = "audience-prompt-label";
  setText(sysLabel, "System prompt:");
  right.appendChild(sysLabel);

  const sysEl = document.createElement("div");
  sysEl.className = "audience-prompt-text";
  setText(sysEl, systemPrompt);
  right.appendChild(sysEl);

  const noteLabel = document.createElement("div");
  noteLabel.className = "audience-prompt-label";
  setText(noteLabel, "Matching:");
  right.appendChild(noteLabel);

  const audiences2 = Array.isArray(company.audience) ? company.audience : [];
  const noteEl = document.createElement("div");
  noteEl.className = "audience-prompt-text";
  setText(
    noteEl,
    `${audiences2.length} brand segment(s) ranked against the saved in-house ` +
      `audience catalog; only matches above the confidence cutoff are kept.`,
  );
  right.appendChild(noteEl);

  grid.appendChild(left);
  grid.appendChild(right);
  parent.appendChild(grid);
}

function profileSection(title, headerAction = null) {
  const sec = document.createElement("div");
  sec.className = "section profile-section";
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
  sec.appendChild(h);
  sec.appendChild(b);
  return sec;
}

function appendChipRow(parent, values, extraClass = "") {
  if (!values || values.length === 0) return false;
  const row = document.createElement("div");
  row.className = "chip-row";
  values.forEach((v) => {
    const chip = document.createElement("span");
    chip.className = "chip" + (extraClass ? " " + extraClass : "");
    setText(chip, String(v));
    row.appendChild(chip);
  });
  parent.appendChild(row);
  return true;
}

function appendLabeledRow(parent, label, value) {
  if (value === null || value === undefined || value === "") return false;
  const row = document.createElement("div");
  row.className = "profile-row";
  const l = document.createElement("div");
  l.className = "profile-row-label";
  setText(l, label);
  const v = document.createElement("div");
  v.className = "profile-row-value";
  setText(v, String(value));
  row.appendChild(l);
  row.appendChild(v);
  parent.appendChild(row);
  return true;
}

function appendLabeledChips(parent, label, values, extraClass = "") {
  if (!values || values.length === 0) return false;
  const row = document.createElement("div");
  row.className = "profile-row";
  const l = document.createElement("div");
  l.className = "profile-row-label";
  setText(l, label);
  const v = document.createElement("div");
  v.className = "profile-row-value";
  const chips = document.createElement("div");
  chips.className = "chip-row";
  values.forEach((value) => {
    const chip = document.createElement("span");
    chip.className = "chip" + (extraClass ? " " + extraClass : "");
    setText(chip, String(value));
    chips.appendChild(chip);
  });
  v.appendChild(chips);
  row.appendChild(l);
  row.appendChild(v);
  parent.appendChild(row);
  return true;
}

function appendProseParagraphs(parent, text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return false;
  const paragraphs = trimmed
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  paragraphs.forEach((p) => {
    const el = document.createElement("p");
    el.className = "brand-prose-paragraph";
    setText(el, p);
    parent.appendChild(el);
  });
  return paragraphs.length > 0;
}

function appendInlineMarkdown(parent, text) {
  const pattern =
    /(`[^`]+`)|(!?\[[^\]]*\]\((https?:\/\/[^\s)]+)\))|((https?:\/\/[^\s<]+))/g;
  let last = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      parent.appendChild(
        document.createTextNode(text.slice(last, match.index)),
      );
    }
    if (match[1]) {
      const code = document.createElement("code");
      setText(code, match[1].slice(1, -1));
      parent.appendChild(code);
    } else if (match[2] && match[3]) {
      const labelMatch = /\[([^\]]+)\]/.exec(match[2]);
      const isImage = match[2].startsWith("![");
      const a = document.createElement("a");
      a.href = match[3];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      if (isImage) {
        setText(a, `[image: ${labelMatch ? labelMatch[1] || "link" : "link"}]`);
      } else {
        setText(a, labelMatch ? labelMatch[1] : match[3]);
      }
      parent.appendChild(a);
    } else if (match[4]) {
      const a = document.createElement("a");
      a.href = match[4];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      setText(a, match[4]);
      parent.appendChild(a);
    }
    last = pattern.lastIndex;
  }
  if (last < text.length) {
    parent.appendChild(document.createTextNode(text.slice(last)));
  }
}

function appendMarkdown(parent, text) {
  let trimmed = (text || "").trim();
  const marker = "\nMarkdown Content:\n";
  const markerPos = trimmed.indexOf(marker);
  if (markerPos >= 0) {
    trimmed = trimmed.slice(markerPos + marker.length).trim();
  }
  if (!trimmed) return false;
  const lines = trimmed.replace(/\r\n/g, "\n").split("\n");
  let inCode = false;
  let codeLines = [];
  let paragraph = [];
  const listStack = [];

  function currentParent() {
    return listStack.length ? listStack[listStack.length - 1].list : parent;
  }

  function flushParagraph() {
    if (!paragraph.length) return;
    const p = document.createElement("p");
    p.className = "brand-prose-paragraph";
    appendInlineMarkdown(p, paragraph.join(" "));
    currentParent().appendChild(p);
    paragraph = [];
  }

  function flushCode() {
    if (!inCode) return;
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    setText(code, codeLines.join("\n"));
    pre.appendChild(code);
    parent.appendChild(pre);
    inCode = false;
    codeLines = [];
  }

  function closeListsToIndent(indent) {
    while (
      listStack.length &&
      listStack[listStack.length - 1].indent > indent
    ) {
      listStack.pop();
    }
  }

  lines.forEach((line) => {
    if (line.trim().startsWith("```")) {
      flushParagraph();
      if (inCode) {
        flushCode();
      } else {
        closeListsToIndent(-1);
        inCode = true;
        codeLines = [];
      }
      return;
    }
    if (inCode) {
      codeLines.push(line);
      return;
    }

    if (!line.trim()) {
      flushParagraph();
      return;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line.trim());
    if (heading) {
      flushParagraph();
      closeListsToIndent(-1);
      const h = document.createElement(`h${heading[1].length}`);
      appendInlineMarkdown(h, heading[2].trim());
      parent.appendChild(h);
      return;
    }

    const list = /^(\s*)[-*+]\s+(.+)$/.exec(line);
    if (list) {
      flushParagraph();
      const indent = list[1].length;
      closeListsToIndent(indent);
      let node = listStack.find((entry) => entry.indent === indent);
      if (!node) {
        const ul = document.createElement("ul");
        if (listStack.length) {
          const topLi = listStack[listStack.length - 1].lastLi;
          if (topLi) {
            topLi.appendChild(ul);
          } else {
            listStack[listStack.length - 1].list.appendChild(ul);
          }
        } else {
          parent.appendChild(ul);
        }
        node = { indent, list: ul, lastLi: null };
        listStack.push(node);
      }
      const li = document.createElement("li");
      appendInlineMarkdown(li, list[2].trim());
      node.list.appendChild(li);
      node.lastLi = li;
      return;
    }

    if (listStack.length) {
      const top = listStack[listStack.length - 1];
      if (line.match(/^\s{2,}\S/)) {
        if (top.lastLi) {
          top.lastLi.appendChild(document.createTextNode(" " + line.trim()));
        }
        return;
      }
      closeListsToIndent(-1);
    }

    paragraph.push(line.trim());
  });

  flushParagraph();
  flushCode();
  closeListsToIndent(-1);
  return true;
}

const SOCIAL_PLATFORM_LABEL = {
  "twitter.com": "Twitter / X",
  "x.com": "X",
  "instagram.com": "Instagram",
  "linkedin.com": "LinkedIn",
  "tiktok.com": "TikTok",
  "youtube.com": "YouTube",
  "facebook.com": "Facebook",
  "threads.net": "Threads",
};

const SOCIAL_SIDEBAR_PLATFORMS = [
  "twitter.com",
  "linkedin.com",
  "instagram.com",
  "tiktok.com",
  "facebook.com",
];

const SOCIAL_PLATFORM_ALIASES = {
  "twitter.com": ["twitter.com", "x.com"],
  "linkedin.com": ["linkedin.com"],
  "instagram.com": ["instagram.com"],
  "tiktok.com": ["tiktok.com"],
  "facebook.com": ["facebook.com"],
};

const NUCLEO_SOCIAL_SVG = {
  xtwitter:
    '<svg class="social-logo-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M18.42,14.009L27.891,3h-2.244l-8.224,9.559L10.855,3H3.28l9.932,14.455L3.28,29h2.244l8.684-10.095,6.936,10.095h7.576l-10.301-14.991h0Zm-3.074,3.573l-1.006-1.439L6.333,4.69h3.447l6.462,9.243,1.006,1.439,8.4,12.015h-3.447l-6.854-9.804h0Z"/></svg>',
  linkedin:
    '<svg class="social-logo-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M26.111,3H5.889c-1.595,0-2.889,1.293-2.889,2.889V26.111c0,1.595,1.293,2.889,2.889,2.889H26.111c1.595,0,2.889-1.293,2.889-2.889V5.889c0-1.595-1.293-2.889-2.889-2.889ZM10.861,25.389h-3.877V12.87h3.877v12.519Zm-1.957-14.158c-1.267,0-2.293-1.034-2.293-2.31s1.026-2.31,2.293-2.31,2.292,1.034,2.292,2.31-1.026,2.31-2.292,2.31Zm16.485,14.158h-3.858v-6.571c0-1.802-.685-2.809-2.111-2.809-1.551,0-2.362,1.048-2.362,2.809v6.571h-3.718V12.87h3.718v1.686s1.118-2.069,3.775-2.069,4.556,1.621,4.556,4.975v7.926Z" fill-rule="evenodd"/></svg>',
  instagram:
    '<svg class="social-logo-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M10.202,2.098c-1.49,.07-2.507,.308-3.396,.657-.92,.359-1.7,.84-2.477,1.619-.776,.779-1.254,1.56-1.61,2.481-.345,.891-.578,1.909-.644,3.4-.066,1.49-.08,1.97-.073,5.771s.024,4.278,.096,5.772c.071,1.489,.308,2.506,.657,3.396,.359,.92,.84,1.7,1.619,2.477,.779,.776,1.559,1.253,2.483,1.61,.89,.344,1.909,.579,3.399,.644,1.49,.065,1.97,.08,5.771,.073,3.801-.007,4.279-.024,5.773-.095s2.505-.309,3.395-.657c.92-.36,1.701-.84,2.477-1.62s1.254-1.561,1.609-2.483c.345-.89,.579-1.909,.644-3.398,.065-1.494,.081-1.971,.073-5.773s-.024-4.278-.095-5.771-.308-2.507-.657-3.397c-.36-.92-.84-1.7-1.619-2.477s-1.561-1.254-2.483-1.609c-.891-.345-1.909-.58-3.399-.644s-1.97-.081-5.772-.074-4.278,.024-5.771,.096m.164,25.309c-1.365-.059-2.106-.286-2.6-.476-.654-.252-1.12-.557-1.612-1.044s-.795-.955-1.05-1.608c-.192-.494-.423-1.234-.487-2.599-.069-1.475-.084-1.918-.092-5.656s.006-4.18,.071-5.656c.058-1.364,.286-2.106,.476-2.6,.252-.655,.556-1.12,1.044-1.612s.955-.795,1.608-1.05c.493-.193,1.234-.422,2.598-.487,1.476-.07,1.919-.084,5.656-.092,3.737-.008,4.181,.006,5.658,.071,1.364,.059,2.106,.285,2.599,.476,.654,.252,1.12,.555,1.612,1.044s.795,.954,1.051,1.609c.193,.492,.422,1.232,.486,2.597,.07,1.476,.086,1.919,.093,5.656,.007,3.737-.006,4.181-.071,5.656-.06,1.365-.286,2.106-.476,2.601-.252,.654-.556,1.12-1.045,1.612s-.955,.795-1.608,1.05c-.493,.192-1.234,.422-2.597,.487-1.476,.069-1.919,.084-5.657,.092s-4.18-.007-5.656-.071M21.779,8.517c.002,.928,.755,1.679,1.683,1.677s1.679-.755,1.677-1.683c-.002-.928-.755-1.679-1.683-1.677,0,0,0,0,0,0-.928,.002-1.678,.755-1.677,1.683m-12.967,7.496c.008,3.97,3.232,7.182,7.202,7.174s7.183-3.232,7.176-7.202c-.008-3.97-3.233-7.183-7.203-7.175s-7.182,3.233-7.174,7.203m2.522-.005c-.005-2.577,2.08-4.671,4.658-4.676,2.577-.005,4.671,2.08,4.676,4.658,.005,2.577-2.08,4.671-4.658,4.676-2.577,.005-4.671-2.079-4.676-4.656h0"/></svg>',
  tiktok:
    '<svg class="social-logo-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M24.562,7.613c-1.508-.983-2.597-2.557-2.936-4.391-.073-.396-.114-.804-.114-1.221h-4.814l-.008,19.292c-.081,2.16-1.859,3.894-4.039,3.894-.677,0-1.315-.169-1.877-.465-1.288-.678-2.169-2.028-2.169-3.582,0-2.231,1.815-4.047,4.046-4.047,.417,0,.816,.069,1.194,.187v-4.914c-.391-.053-.788-.087-1.194-.087-4.886,0-8.86,3.975-8.86,8.86,0,2.998,1.498,5.65,3.783,7.254,1.439,1.01,3.19,1.606,5.078,1.606,4.886,0,8.86-3.975,8.86-8.86V11.357c1.888,1.355,4.201,2.154,6.697,2.154v-4.814c-1.345,0-2.597-.4-3.647-1.085Z"/></svg>',
  facebook:
    '<svg class="social-logo-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M16,2c-7.732,0-14,6.268-14,14,0,6.566,4.52,12.075,10.618,13.588v-9.31h-2.887v-4.278h2.887v-1.843c0-4.765,2.156-6.974,6.835-6.974,.887,0,2.417,.174,3.043,.348v3.878c-.33-.035-.904-.052-1.617-.052-2.296,0-3.183,.87-3.183,3.13v1.513h4.573l-.786,4.278h-3.787v9.619c6.932-.837,12.304-6.74,12.304-13.897,0-7.732-6.268-14-14-14Z"/></svg>',
  google:
    '<svg class="social-logo-icon" viewBox="0 0 32 32" aria-hidden="true"><path d="M29.44,16.318c0-.993-.089-1.947-.255-2.864h-13.185v5.422h7.535c-.331,1.744-1.324,3.22-2.813,4.213v3.525h4.544c2.647-2.444,4.175-6.033,4.175-10.296Z" opacity=".4"/><path d="M16,30c3.78,0,6.949-1.247,9.265-3.385l-4.544-3.525c-1.247,.84-2.838,1.349-4.722,1.349-3.64,0-6.733-2.456-7.84-5.765l-2.717,2.09-1.941,1.525c2.304,4.569,7.025,7.713,12.498,7.713Z"/><path d="M8.16,18.66c-.28-.84-.445-1.731-.445-2.66s.165-1.82,.445-2.66v-3.615H3.502c-.955,1.884-1.502,4.009-1.502,6.275s.547,4.391,1.502,6.275h3.332s1.327-3.615,1.327-3.615Z" opacity=".4"/><path d="M16,7.575c2.062,0,3.895,.713,5.358,2.087l4.009-4.009c-2.431-2.265-5.587-3.653-9.367-3.653-5.473,0-10.195,3.144-12.498,7.725l4.658,3.615c1.107-3.309,4.2-5.765,7.84-5.765Z"/></svg>',
};

const SOCIAL_PLATFORM_ICONS = {
  "twitter.com": NUCLEO_SOCIAL_SVG.xtwitter,
  "linkedin.com": NUCLEO_SOCIAL_SVG.linkedin,
  "instagram.com": NUCLEO_SOCIAL_SVG.instagram,
  "tiktok.com": NUCLEO_SOCIAL_SVG.tiktok,
  "facebook.com": NUCLEO_SOCIAL_SVG.facebook,
};

function prettyPlatform(platform) {
  return SOCIAL_PLATFORM_LABEL[platform] || platform;
}

const AD_LIBRARY_PLATFORMS = ["meta", "google", "linkedin"];

const AD_LIBRARY_LABELS = {
  meta: "Meta Ad Library",
  google: "Google Ads Transparency",
  linkedin: "LinkedIn Ad Library",
};

// maps pipeline source_used values to the sidebar platform key
const AD_PLATFORM_SOURCE_MAP = {
  meta_ad_library: "meta",
};

const AD_LIBRARY_ICONS = {
  meta: NUCLEO_SOCIAL_SVG.facebook,
  google: NUCLEO_SOCIAL_SVG.google,
  linkedin: NUCLEO_SOCIAL_SVG.linkedin,
};

function socialHandleForPlatform(platform, handleByPlatform, companyTwitter) {
  if (platform === "twitter.com" && companyTwitter) {
    const existing =
      handleByPlatform["twitter.com"] || handleByPlatform["x.com"] || {};
    const handle = String(existing.handle || companyTwitter || "")
      .replace(/^@/, "")
      .trim();
    if (!handle) return null;
    return { ...existing, platform: "twitter.com", handle };
  }
  const aliases = SOCIAL_PLATFORM_ALIASES[platform] || [platform];
  for (const key of aliases) {
    const row = handleByPlatform[key];
    if (row && row.handle) {
      const handle = String(row.handle).replace(/^@/, "").trim();
      if (handle) return { ...row, platform, handle };
    }
  }
  return null;
}

function socialScanForPlatform(platform, platforms) {
  const aliases = SOCIAL_PLATFORM_ALIASES[platform] || [platform];
  for (const key of aliases) {
    const scan = platforms.find((p) => p && p.platform === key);
    if (scan) return scan;
  }
  return null;
}

function renderSocialPlatformPrimary(
  panel,
  platform,
  handleRow,
  scan,
  agg,
  company,
) {
  panel.innerHTML = "";
  if (!handleRow || !handleRow.handle) {
    const empty = document.createElement("div");
    empty.className = "socials-primary-empty";
    setText(empty, "No handle set for this platform.");
    panel.appendChild(empty);
    return;
  }

  if (platform === "twitter.com") {
    const tweets = (agg.recent_tweets || []).filter((p) => {
      if (!p || !p.author_handle) return false;
      const pa = String(p.author_handle).replace(/^@/, "").toLowerCase();
      const ha = String(handleRow.handle).replace(/^@/, "").toLowerCase();
      return pa === ha;
    });
    const layout = document.createElement("div");
    layout.className = "socials-twitter-layout";
    const left = document.createElement("div");
    left.className = "socials-twitter-account";
    const right = document.createElement("div");
    right.className = "socials-twitter-posts";

    const followers = tweets.reduce((max, p) => {
      const n = Number(p.author_followers || 0);
      return Number.isFinite(n) && n > max ? n : max;
    }, 0);
    const totals = tweets.reduce(
      (acc, p) => {
        acc.likes += Number(p.like_count || 0);
        acc.retweets += Number(p.retweet_count || 0);
        acc.replies += Number(p.reply_count || 0);
        acc.quotes += Number(p.quote_count || 0);
        acc.bookmarks += Number(p.bookmark_count || 0);
        acc.views += Number(p.view_count || 0);
        return acc;
      },
      { likes: 0, retweets: 0, replies: 0, quotes: 0, bookmarks: 0, views: 0 },
    );
    const interactions =
      totals.likes +
      totals.retweets +
      totals.replies +
      totals.quotes +
      totals.bookmarks;
    const engagementRate =
      totals.views > 0 ? (interactions / totals.views) * 100 : null;

    const bannerUrl =
      tweets.find((p) => p && p.author_banner_url)?.author_banner_url || "";
    const avatarUrl =
      tweets.find((p) => p && p.author_avatar)?.author_avatar || "";
    const accountTop = document.createElement("div");
    accountTop.className = "socials-twitter-account-top";
    if (bannerUrl) {
      const banner = document.createElement("img");
      banner.className = "socials-twitter-banner";
      banner.alt = "";
      banner.src = String(bannerUrl);
      banner.referrerPolicy = "no-referrer";
      accountTop.appendChild(banner);
    }
    if (avatarUrl) {
      const avatar = document.createElement("img");
      avatar.className = "socials-twitter-avatar";
      avatar.alt = "";
      avatar.src = String(avatarUrl);
      avatar.referrerPolicy = "no-referrer";
      accountTop.appendChild(avatar);
    }
    const handle = document.createElement("div");
    handle.className = "socials-twitter-handle";
    setText(handle, "@" + String(handleRow.handle).replace(/^@/, ""));
    accountTop.appendChild(handle);
    left.appendChild(accountTop);

    const section = (subtitle = "") => {
      const wrap = document.createElement("div");
      wrap.className = "socials-twitter-section";
      if (subtitle) {
        const s = document.createElement("div");
        s.className = "socials-twitter-section-subtitle";
        setText(s, subtitle);
        wrap.appendChild(s);
      }
      left.appendChild(wrap);
      return wrap;
    };

    const addMetric = (label, value) => {
      const row = document.createElement("div");
      row.className = "socials-twitter-metric";
      const l = document.createElement("span");
      l.className = "socials-twitter-metric-label";
      setText(l, label);
      const v = document.createElement("span");
      v.className = "socials-twitter-metric-value";
      setText(v, value);
      row.appendChild(l);
      row.appendChild(v);
      return row;
    };

    const accountSection = section();
    accountSection.appendChild(
      addMetric(
        "followers",
        followers > 0 ? formatCompactCount(followers) : "—",
      ),
    );

    const publicSection = section();
    publicSection.appendChild(
      addMetric("likes", formatCompactCount(totals.likes)),
    );
    publicSection.appendChild(
      addMetric("reposts", formatCompactCount(totals.retweets)),
    );
    publicSection.appendChild(
      addMetric("replies", formatCompactCount(totals.replies)),
    );
    publicSection.appendChild(
      addMetric("quotes", formatCompactCount(totals.quotes)),
    );
    publicSection.appendChild(
      addMetric("bookmarks", formatCompactCount(totals.bookmarks)),
    );
    publicSection.appendChild(
      addMetric("impressions", formatCompactCount(totals.views)),
    );

    const derivedSection = section(
      `from ${tweets.length} collected post${tweets.length === 1 ? "" : "s"}`,
    );
    derivedSection.classList.add("socials-twitter-callout");
    derivedSection.appendChild(
      addMetric(
        "views",
        totals.views > 0 ? formatCompactCount(totals.views) : "0",
      ),
    );
    derivedSection.appendChild(
      addMetric("engagement", formatCompactCount(interactions)),
    );
    derivedSection.appendChild(
      addMetric(
        "engagement rate",
        engagementRate !== null ? `${engagementRate.toFixed(2)}%` : "—",
      ),
    );

    if (tweets.length === 0) {
      const empty = document.createElement("div");
      empty.className = "socials-primary-empty";
      setText(
        empty,
        `Waiting for first tweet from @${String(handleRow.handle).replace(/^@/, "")}…`,
      );
      right.appendChild(empty);
    } else {
      tweets.forEach((p) => {
        const authorHandle = String(p.author_handle || "").replace(/^@/, "");
        const tweetUrl =
          authorHandle && p.tweet_id
            ? `https://twitter.com/${authorHandle}/status/${p.tweet_id}`
            : null;
        const item = tweetUrl
          ? document.createElement("a")
          : document.createElement("div");
        item.className = "socials-twitter-post";
        if (tweetUrl) {
          item.href = tweetUrl;
          item.target = "_blank";
          item.rel = "noopener noreferrer";
        }
        const summary = document.createElement("div");
        summary.className = "socials-twitter-post-summary";
        setText(summary, p.summary_text || p.tweet_text || "—");
        item.appendChild(summary);
        const engagement = buildEngagementRow(p);
        if (engagement) {
          engagement.classList.add("socials-twitter-post-engagement");
          item.appendChild(engagement);
        }
        right.appendChild(item);
      });
    }

    layout.appendChild(left);
    layout.appendChild(right);
    panel.appendChild(layout);
    return;
  }

  if (scan && scan.data_basis === "llm_inference") {
    return;
  }

  if (!scan) return;

  if (scan.voice_summary) {
    const voice = document.createElement("div");
    voice.className = "social-voice";
    setText(voice, scan.voice_summary);
    panel.appendChild(voice);
  }
  if (scan.themes && scan.themes.length) {
    const tr = document.createElement("div");
    tr.className = "chip-row";
    scan.themes.slice(0, 8).forEach((t) => {
      const c = document.createElement("span");
      c.className = "chip";
      setText(c, t);
      tr.appendChild(c);
    });
    panel.appendChild(tr);
  }
  if (scan.post_examples && scan.post_examples.length) {
    const det = document.createElement("details");
    det.className = "social-posts";
    const sum = document.createElement("summary");
    setText(sum, `Recent posts (${scan.post_examples.length})`);
    det.appendChild(sum);
    const list = document.createElement("ul");
    list.className = "profile-list";
    scan.post_examples.forEach((post) => {
      const li = document.createElement("li");
      setText(li, post);
      list.appendChild(li);
    });
    det.appendChild(list);
    panel.appendChild(det);
  }
}

function renderProfileAggregate(host, agg, company) {
  // 1. socials
  const handles = agg.social_handles || [];
  const platforms = agg.social_platforms || [];
  // always render the section now that Twitter is editable — even with no
  // discovered handles, the operator may want to add one manually.
  if (
    handles.length ||
    platforms.length ||
    agg.social_voice_summary ||
    company
  ) {
    let headerAction = null;
    if (company) {
      const actions = document.createElement("div");
      actions.className = "section-header-actions";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "section-header-icon-btn";
      editBtn.title = "Edit socials";
      editBtn.ariaLabel = "Edit socials";
      editBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
      editBtn.addEventListener("click", () =>
        openEditSocialsModal(company, agg),
      );
      actions.appendChild(editBtn);

      const rediscoverBtn = document.createElement("button");
      rediscoverBtn.type = "button";
      rediscoverBtn.className = "section-header-icon-btn";
      rediscoverBtn.title = "Re-discover socials";
      rediscoverBtn.ariaLabel = "Re-discover socials";
      rediscoverBtn.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"/></svg>';
      rediscoverBtn.addEventListener("click", () => rediscoverSocials(company));
      actions.appendChild(rediscoverBtn);
      headerAction = actions;
    }
    const sec = profileSection("Socials", headerAction);
    const body = sec.querySelector(".section-body");
    renderSocialsCard(body, agg, company);
    host.appendChild(sec);
  }

  // 3. news
  if (agg.news_summary || (agg.news_items && agg.news_items.length)) {
    const sec = profileSection("Recent news");
    const body = sec.querySelector(".section-body");
    if (agg.news_items && agg.news_items.length) {
      const list = document.createElement("ul");
      list.className = "profile-list";
      agg.news_items.forEach((item) => {
        const li = document.createElement("li");
        const title = item.title || item.headline || "(untitled)";
        const date = item.date || item.published_at || "";
        setText(li, date ? `${title} · ${date}` : title);
        list.appendChild(li);
      });
      body.appendChild(list);
    } else if (agg.news_summary) {
      appendProseParagraphs(body, agg.news_summary);
    }
    host.appendChild(sec);
  }

  // 4. voice & positioning
  const voiceFields = [
    ["Voice & tone", agg.voice_and_tone],
    ["Cultural positioning", agg.cultural_positioning],
    ["Audience", agg.audience],
    ["Reactive stance", agg.reactive_stance],
    ["Brand archetype", agg.brand_archetype],
  ].filter(([, v]) => v);
  if (voiceFields.length > 0) {
    const sec = profileSection("Voice & positioning");
    const body = sec.querySelector(".section-body");
    voiceFields.forEach(([label, value]) =>
      appendLabeledRow(body, label, value),
    );
    host.appendChild(sec);
  }

  // 5. topics
  const cares = agg.topics_they_care_about || [];
  const avoids = agg.topics_they_avoid || [];
  const reds = agg.red_flag_topics || [];
  if (cares.length || avoids.length || reds.length) {
    const sec = profileSection("Topics");
    const body = sec.querySelector(".section-body");
    appendLabeledChips(body, "Cares about", cares);
    appendLabeledChips(body, "Avoids", avoids, "chip-warn");
    appendLabeledChips(body, "Red flags", reds, "chip-danger");
    host.appendChild(sec);
  }

  // 6. voice rules
  const dos = agg.voice_dos_and_donts || [];
  const phrases = agg.signature_phrases || [];
  if (dos.length || phrases.length) {
    const sec = profileSection("Voice rules");
    const body = sec.querySelector(".section-body");
    if (dos.length > 0) {
      const label = document.createElement("div");
      label.className = "profile-row-label";
      setText(label, "Do's and don'ts");
      body.appendChild(label);
      const list = document.createElement("ul");
      list.className = "profile-list";
      dos.forEach((d) => {
        const li = document.createElement("li");
        setText(li, d);
        list.appendChild(li);
      });
      body.appendChild(list);
    }
    if (phrases.length > 0) {
      appendLabeledChips(body, "Signature phrases", phrases, "chip-mono");
    }
    host.appendChild(sec);
  }

  // 7. strategic context
  const strategicFields = [
    ["Online engagement style", agg.online_engagement_style],
    ["Strategic context", agg.strategic_context],
  ].filter(([, v]) => v);
  if (strategicFields.length > 0) {
    const sec = profileSection("Strategic context");
    const body = sec.querySelector(".section-body");
    strategicFields.forEach(([label, value]) =>
      appendLabeledRow(body, label, value),
    );
    host.appendChild(sec);
  }

  // 8. audience reception
  if (agg.audience_reception) {
    const sec = profileSection("Audience reception");
    const body = sec.querySelector(".section-body");
    renderReceptionCard(body, agg.audience_reception);
    host.appendChild(sec);
  }

  // 9. ad campaigns
  const sec9 = profileSection("Ad campaigns");
  const body9 = sec9.querySelector(".section-body");
  renderAdsCard(body9, agg, company);
  host.appendChild(sec9);

  // 10. general knowledge (compact)
  if (agg.general_knowledge) {
    const sec = profileSection("Base-model snapshot");
    const body = sec.querySelector(".section-body");
    renderGeneralKnowledgeCard(body, agg.general_knowledge);
    host.appendChild(sec);
  }
}

// Twitter platform keys that map to the company-owned Twitter ingestion
// pipeline. Posts ingested via GraphQL (brand_poll) or the firehose are
// rendered as a real tweet timeline; everything else falls back to the
// LLM-inferred snapshot.
const TWITTER_PLATFORMS = new Set(["twitter.com", "x.com"]);

function renderSocialsCard(body, agg, company) {
  const handles = agg.social_handles || [];
  const platforms = agg.social_platforms || [];
  const handleByPlatform = {};
  handles.forEach((h) => {
    if (h.platform) handleByPlatform[h.platform] = h;
  });
  const companyTwitter =
    company && company.twitter_handle
      ? company.twitter_handle.replace(/^@/, "")
      : null;

  const layout = document.createElement("div");
  layout.className = "socials-layout";
  const sidebar = document.createElement("div");
  sidebar.className = "socials-platform-sidebar";
  const primary = document.createElement("div");
  primary.className = "socials-primary";

  const rows = SOCIAL_SIDEBAR_PLATFORMS.map((platform) => {
    const handleRow = socialHandleForPlatform(
      platform,
      handleByPlatform,
      companyTwitter,
    );
    const scan = socialScanForPlatform(platform, platforms);
    return { platform, handleRow, scan };
  });

  let selected = rows.find((r) => r.handleRow) || null;
  rows.forEach((row) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "socials-platform-btn";
    btn.title = prettyPlatform(row.platform);
    btn.ariaLabel = prettyPlatform(row.platform);
    btn.innerHTML = SOCIAL_PLATFORM_ICONS[row.platform] || "";
    if (!row.handleRow) {
      btn.disabled = true;
      btn.classList.add("is-disabled");
    } else {
      btn.addEventListener("click", () => {
        selected = row;
        sidebar.querySelectorAll(".socials-platform-btn").forEach((el) => {
          el.classList.remove("active");
        });
        btn.classList.add("active");
        renderSocialPlatformPrimary(
          primary,
          row.platform,
          row.handleRow,
          row.scan,
          agg,
          company,
        );
      });
    }
    if (selected && selected.platform === row.platform && row.handleRow) {
      btn.classList.add("active");
    }
    sidebar.appendChild(btn);
  });

  if (selected && selected.handleRow) {
    renderSocialPlatformPrimary(
      primary,
      selected.platform,
      selected.handleRow,
      selected.scan,
      agg,
      company,
    );
  } else {
    const empty = document.createElement("div");
    empty.className = "socials-primary-empty";
    setText(
      empty,
      "No known social handles yet. Use the pencil icon to add one.",
    );
    primary.appendChild(empty);
  }

  layout.appendChild(sidebar);
  layout.appendChild(primary);
  body.appendChild(layout);
}

async function rediscoverSocials(company) {
  if (
    !confirm(
      "Re-discover socials for this brand?\n\n" +
        "This clears the brand's social handles and removes any tweets that " +
        "were ingested via the per-brand poller (firehose tweets are kept). " +
        "Run a new profile to rediscover them.",
    )
  )
    return;
  try {
    const { ok, status, body } = await api(
      `/api/company/${company.id}/socials/rediscover`,
      { method: "POST" },
    );
    if (!ok) {
      showError(
        "global-errors",
        apiErrorMessage(body, `Re-discover failed (${status})`),
      );
      return;
    }
    showFlash("Socials cleared. Run a new profile to rediscover.");
    await loadCompanies();
    renderBrandsSidebar();
    const fresh = companies.find((c) => c.id === company.id) || company;
    renderBrandDetail(fresh);
  } catch (err) {
    showError("global-errors", "Network error: " + err.message);
  }
}

function renderAdLibraryPrimary(panel, plat, source) {
  panel.innerHTML = "";

  const head = document.createElement("div");
  head.className = "socials-primary-head";

  const label = document.createElement("span");
  label.className = "profile-row-label";
  setText(label, AD_LIBRARY_LABELS[plat] || plat);
  head.appendChild(label);

  if (source.campaigns && source.campaigns.length) {
    const count = document.createElement("span");
    count.className = "chip chip-mono";
    setText(count, `${source.campaigns.length} campaigns`);
    head.appendChild(count);
  }
  if (source.genre_summary) {
    const genre = document.createElement("span");
    genre.className = "chip";
    setText(genre, source.genre_summary);
    head.appendChild(genre);
  }
  panel.appendChild(head);

  if (source.narrative) {
    const narr = document.createElement("p");
    narr.className = "meta-row";
    narr.style.marginTop = "8px";
    setText(narr, source.narrative);
    panel.appendChild(narr);
  }

  if (source.campaigns && source.campaigns.length) {
    const cLabel = document.createElement("div");
    cLabel.className = "profile-row-label";
    setText(cLabel, "Campaigns");
    panel.appendChild(cLabel);
    const list = document.createElement("ul");
    list.className = "profile-list";
    source.campaigns.forEach((c) => {
      const li = document.createElement("li");
      const name = c.name || "(untitled)";
      const yr = c.year_range ? ` (${c.year_range})` : "";
      const tagline = c.tagline ? ` — "${c.tagline}"` : "";
      const agency = c.agency ? ` · ${c.agency}` : "";
      const summary = c.summary ? ` — ${c.summary}` : "";
      setText(li, `${name}${yr}${tagline}${agency}${summary}`);
      list.appendChild(li);
    });
    panel.appendChild(list);
  }

  if (source.taglines && source.taglines.length) {
    appendLabeledChips(panel, "Taglines", source.taglines, "chip-mono");
  }
  if (source.creative_motifs && source.creative_motifs.length) {
    appendLabeledChips(panel, "Creative motifs", source.creative_motifs);
  }
}

function renderAdsCard(body, agg, company) {
  const sources = agg.ad_library_sources || [];

  const sourceByPlatform = {};
  sources.forEach((s) => {
    const plat = AD_PLATFORM_SOURCE_MAP[s.source];
    if (plat && !sourceByPlatform[plat]) sourceByPlatform[plat] = s;
  });

  const layout = document.createElement("div");
  layout.className = "socials-layout";
  const sidebar = document.createElement("div");
  sidebar.className = "socials-platform-sidebar";
  const primary = document.createElement("div");
  primary.className = "socials-primary";

  const renderPanel = (sel) => {
    renderAdLibraryPrimary(primary, sel.plat, sel.source);
  };

  let selected = null;
  AD_LIBRARY_PLATFORMS.forEach((plat) => {
    const source = sourceByPlatform[plat] || null;
    const enabled = !!source;
    if (!selected && enabled) selected = { plat, source };

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "socials-platform-btn";
    btn.title = AD_LIBRARY_LABELS[plat];
    btn.ariaLabel = AD_LIBRARY_LABELS[plat];
    btn.innerHTML = AD_LIBRARY_ICONS[plat] || plat;

    if (!enabled) {
      btn.disabled = true;
      btn.classList.add("is-disabled");
    } else {
      btn.addEventListener("click", () => {
        selected = { plat, source };
        sidebar
          .querySelectorAll(".socials-platform-btn")
          .forEach((el) => el.classList.remove("active"));
        btn.classList.add("active");
        renderPanel(selected);
      });
    }
    if (selected && selected.plat === plat) btn.classList.add("active");
    sidebar.appendChild(btn);
  });

  if (selected) {
    renderPanel(selected);
  } else {
    const empty = document.createElement("div");
    empty.className = "socials-primary-empty";
    setText(
      empty,
      "No ad library data found for this brand. Run an ad_campaigns step to populate.",
    );
    primary.appendChild(empty);
  }

  layout.appendChild(sidebar);
  layout.appendChild(primary);
  body.appendChild(layout);
}

// Edit-socials modal — built dynamically and mounted to document.body so
// we don't bloat index.html. One input per known platform, plus an
// inline status badge ("In core" / "Polled"). Save -> PUT, then refresh
// the brand detail and toast the deletion summary.
const EDIT_SOCIAL_PLATFORMS = [
  "twitter.com",
  "instagram.com",
  "linkedin.com",
  "tiktok.com",
  "youtube.com",
  "facebook.com",
  "threads.net",
];

// opens the tweet detail (same content as the Posts-view detail pane,
// reusing renderPostDetail) in a floating modal so the brand profile
// behind it stays put. Used from the brand-profile Twitter timeline so
// drilling into a tweet never bounces the operator back to /posts.
async function openTweetDetailModal(postId) {
  const existing = document.getElementById("tweet-detail-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "tweet-detail-modal";
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const box = document.createElement("div");
  box.className = "modal-box is-wide";

  const inner = document.createElement("div");
  inner.className = "detail-inner tweet-detail-modal-body";
  const loading = document.createElement("div");
  loading.className = "section-spinner";
  setText(loading, "Loading tweet…");
  inner.appendChild(loading);
  box.appendChild(inner);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  installModalBehavior(overlay, () => overlay.remove());

  try {
    const { ok, status, body } = await api(`/api/post/${postId}`, {
      method: "GET",
    });
    if (status === 401) {
      overlay.remove();
      showLogin();
      return;
    }
    if (!ok) {
      inner.innerHTML = "";
      const err = document.createElement("div");
      err.className = "empty-state";
      setText(err, apiErrorMessage(body, "Tweet not found."));
      inner.appendChild(err);
      return;
    }
    renderPostDetail(body, inner);
  } catch (err) {
    inner.innerHTML = "";
    const errBox = document.createElement("div");
    errBox.className = "empty-state";
    setText(errBox, "Network error: " + err.message);
    inner.appendChild(errBox);
  }
}

function socialHandlesByPlatform(agg, company) {
  const handlesByPlatform = {};
  (agg.social_handles || []).forEach((row) => {
    if (row && row.platform) handlesByPlatform[row.platform] = row;
  });
  if (company && company.twitter_handle && !handlesByPlatform["twitter.com"]) {
    handlesByPlatform["twitter.com"] = {
      platform: "twitter.com",
      handle: company.twitter_handle.replace(/^@/, ""),
      url: "",
      source: "scraped",
    };
  }
  return handlesByPlatform;
}

function socialsFromInputs(inputs) {
  const socials = [];
  for (const platform of EDIT_SOCIAL_PLATFORMS) {
    const raw = (inputs[platform].value || "").trim().replace(/^@/, "");
    if (!raw) continue;
    socials.push({
      platform,
      handle: raw,
      url: "",
      source: "scraped",
    });
  }
  return socials;
}

async function persistCompanySocials(company, socials, opts = {}) {
  const currentTwitter = (company.twitter_handle || "")
    .replace(/^@/, "")
    .toLowerCase();
  const nextTwitter = (
    socials.find((s) => s.platform === "twitter.com")?.handle || ""
  ).toLowerCase();
  if (currentTwitter && nextTwitter !== currentTwitter && !company.is_in_core) {
    if (
      !confirm(
        `Changing Twitter handle from @${currentTwitter} to @${nextTwitter || "(none)"}.\n\n` +
          "Tweets polled for the old handle will be permanently removed " +
          "(firehose-covered tweets are preserved). Continue?",
      )
    ) {
      return false;
    }
  }
  const { ok, status, body } = await api(`/api/company/${company.id}/socials`, {
    method: "PUT",
    body: { socials },
  });
  if (!ok) {
    const msg = apiErrorMessage(body, `Save failed (${status})`);
    if (opts.onError) opts.onError(msg);
    return false;
  }
  const summary = (body && body.summary) || {};
  const parts = [];
  if (summary.brand_poll_deleted) {
    parts.push(
      `${summary.brand_poll_deleted} polled tweet${summary.brand_poll_deleted === 1 ? "" : "s"} removed`,
    );
  }
  if (summary.firehose_detached) {
    parts.push(
      `${summary.firehose_detached} firehose tweet${summary.firehose_detached === 1 ? "" : "s"} preserved`,
    );
  }
  if (summary.firehose_attached) {
    parts.push(
      `${summary.firehose_attached} firehose tweet${summary.firehose_attached === 1 ? "" : "s"} re-attached`,
    );
  }
  showFlash(parts.length ? `Saved · ${parts.join(", ")}` : "Saved");
  await loadCompanies();
  renderBrandsSidebar();
  const fresh = companies.find((c) => c.id === company.id) || company;
  if (opts.onSuccess) await opts.onSuccess(fresh);
  return true;
}

function openEditSocialsModal(company, agg) {
  const existing = document.getElementById("edit-socials-modal");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "edit-socials-modal";
  overlay.className = "modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const box = document.createElement("div");
  box.className = "modal-box is-wide";

  const h = document.createElement("h2");
  setText(h, "Edit socials");
  box.appendChild(h);

  const hint = document.createElement("div");
  hint.className = "field-hint";
  setText(
    hint,
    "Editing the Twitter handle removes tweets we polled for the old handle " +
      "(firehose-covered tweets are preserved). Other handles are metadata only.",
  );
  box.appendChild(hint);

  const handlesByPlatform = socialHandlesByPlatform(agg, company);

  const inputs = {};
  const rows = document.createElement("div");
  rows.className = "edit-socials-rows";
  Object.assign(rows.style, {
    display: "grid",
    gridTemplateColumns: "140px 1fr auto",
    gap: "10px 12px",
    alignItems: "center",
    marginTop: "12px",
  });
  EDIT_SOCIAL_PLATFORMS.forEach((platform) => {
    const label = document.createElement("label");
    setText(label, prettyPlatform(platform));
    rows.appendChild(label);

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "@handle";
    const existingRow = handlesByPlatform[platform];
    if (existingRow && existingRow.handle) {
      input.value = "@" + String(existingRow.handle).replace(/^@/, "");
    }
    inputs[platform] = input;
    rows.appendChild(input);

    const badge = document.createElement("span");
    badge.className = "chip";
    if (TWITTER_PLATFORMS.has(platform)) {
      if (agg.is_in_core) {
        badge.classList.add("chip-core");
        badge.title = "Already in the core firehose.";
        setText(badge, "Core");
      } else {
        badge.title = "Polled every 5 minutes.";
        setText(badge, "Polled");
      }
    } else {
      badge.title = "Metadata only — not actively ingested.";
      setText(badge, "Info");
    }
    rows.appendChild(badge);
  });
  box.appendChild(rows);

  const errBox = document.createElement("div");
  errBox.className = "field-error";
  errBox.style.marginTop = "10px";
  box.appendChild(errBox);

  const actions = document.createElement("div");
  actions.className = "modal-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  setText(saveBtn, "Save");
  actions.appendChild(saveBtn);

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className = "btn-secondary";
  setText(cancelBtn, "Cancel");
  cancelBtn.addEventListener("click", () => overlay.remove());
  actions.appendChild(cancelBtn);

  saveBtn.addEventListener("click", async () => {
    setText(errBox, "");
    const socials = socialsFromInputs(inputs);
    saveBtn.disabled = true;
    setText(saveBtn, "Saving…");
    try {
      const ok = await persistCompanySocials(company, socials, {
        onError: (msg) => setText(errBox, msg),
        onSuccess: async (fresh) => {
          overlay.remove();
          renderBrandDetail(fresh);
        },
      });
      if (!ok) {
        saveBtn.disabled = false;
        setText(saveBtn, "Save");
      }
    } catch (err) {
      setText(errBox, "Network error: " + err.message);
      saveBtn.disabled = false;
      setText(saveBtn, "Save");
    }
  });

  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  installModalBehavior(overlay, () => overlay.remove());
  const firstInput = inputs["twitter.com"];
  if (firstInput) firstInput.focus();
}

function renderReceptionCard(body, reception) {
  if (reception.narrative) {
    const para = document.createElement("p");
    para.className = "brand-prose-paragraph";
    setText(para, reception.narrative);
    body.appendChild(para);
  }
  const praise = Array.isArray(reception.praise_themes)
    ? reception.praise_themes
    : [];
  const crit = Array.isArray(reception.criticism_themes)
    ? reception.criticism_themes
    : [];
  const comms = Array.isArray(reception.communities)
    ? reception.communities
    : [];
  if (praise.length) appendLabeledChips(body, "Praise", praise);
  if (crit.length) appendLabeledChips(body, "Criticism", crit, "chip-warn");
  if (comms.length) appendLabeledChips(body, "Communities", comms);
  if (reception.sentiment) {
    appendLabeledRow(body, "Sentiment", reception.sentiment);
  }
}

function renderGeneralKnowledgeCard(body, gk) {
  appendLabeledRow(body, "Summary", gk.summary);
  const products = Array.isArray(gk.products_or_services)
    ? gk.products_or_services
    : [];
  if (products.length) appendLabeledChips(body, "Products", products);
  const competitors = Array.isArray(gk.competitors) ? gk.competitors : [];
  if (competitors.length) appendLabeledChips(body, "Competitors", competitors);
  appendLabeledRow(body, "Target audience", gk.target_audience);
  appendLabeledRow(body, "Cultural reputation", gk.cultural_reputation);
}

function renderCompanyLogo(domain, sourceUrl) {
  const wrap = document.createElement("div");
  wrap.className = "company-logo-wrap";

  const placeholder = document.createElement("div");
  placeholder.className = "company-logo-placeholder";
  setText(placeholder, initials(domain));

  const urls = sourceUrl
    ? [sourceUrl]
    : domain
      ? [
          `https://${domain}/apple-touch-icon.png`,
          `https://${domain}/apple-touch-icon-precomposed.png`,
          `https://${domain}/favicon.ico`,
        ]
      : [];

  if (!urls.length) {
    wrap.appendChild(placeholder);
    return wrap;
  }

  const img = document.createElement("img");
  img.className = "company-logo";
  img.alt = "";
  img.loading = "lazy";

  let attempt = 0;
  const tryNext = () => {
    if (attempt >= urls.length) {
      img.classList.add("hidden");
      placeholder.classList.remove("hidden");
      return;
    }
    img.src = urls[attempt++];
  };
  img.addEventListener("error", tryNext);
  tryNext();

  placeholder.classList.add("hidden");
  wrap.appendChild(img);
  wrap.appendChild(placeholder);
  return wrap;
}

function renderReasoningToggle(traceText) {
  const wrap = document.createElement("div");
  wrap.className = "reasoning-toggle-wrap";

  const link = document.createElement("span");
  link.className = "show-reasoning-link";
  link.role = "button";
  link.tabIndex = 0;
  setText(link, "Show reasoning");

  const trace = document.createElement("div");
  trace.className = "reasoning-trace hidden";
  if (traceText) {
    trace.innerHTML = DOMPurify.sanitize(marked.parse(traceText));
  }

  const toggle = () => {
    const hidden = trace.classList.toggle("hidden");
    setText(link, hidden ? "Show reasoning" : "Hide reasoning");
  };
  link.addEventListener("click", toggle);
  link.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    toggle();
  });

  wrap.appendChild(link);
  wrap.appendChild(trace);
  return wrap;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("theme", theme);
  const btn = $("theme-toggle");
  if (btn)
    btn.setAttribute(
      "data-label",
      theme === "light" ? "Switch to dark" : "Switch to light",
    );
  const logo = $("brand-logo");
  if (logo) {
    logo.src =
      theme === "light"
        ? "/static/assets/images/Turq%20on%20White%20Sq.png"
        : "/static/assets/images/Turq%20Trans.png";
  }
}
