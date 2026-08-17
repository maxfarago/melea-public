const UPGRADE_ZAP_ICON =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.38231 5.9681C7.92199 4.73647 9.87499 4 12 4C14.125 4 16.078 4.73647 17.6177 5.9681L19.0711 4.51472L20.4853 5.92893L19.0319 7.38231C20.2635 8.92199 21 10.875 21 13C21 17.9706 16.9706 22 12 22C7.02944 22 3 17.9706 3 13C3 10.875 3.73647 8.92199 4.9681 7.38231L3.51472 5.92893L4.92893 4.51472L6.38231 5.9681ZM12 20C15.866 20 19 16.866 19 13C19 9.13401 15.866 6 12 6C8.13401 6 5 9.13401 5 13C5 16.866 8.13401 20 12 20ZM13 12H16L11 18.5V14H8L13 7.4952V12ZM8 1H16V3H8V1Z"/></svg>';

const UPGRADE_CHECK_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

const UPGRADE_GROWTH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16l5-5 4 4 7-9"/><path d="M15 6h5v5"/></svg>';

const UPGRADE_X_ICON =
  '<svg class="upgrade-modal-x" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.254 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';

const UPGRADE_PLAN_NOTE =
  "Based on a low-follower account — you'll likely see more if you already have an audience.";

const UPGRADE_PLANS = {
  rise: {
    name: "Rise",
    tagline: "Real reach. Real revenue.",
    monthly: 129,
    annual: 99,
    annualYear: 1188,
    save: 360,
    growthHeadline: "Grow to ~300K impressions/mo",
    growthVisitsClicks:
      '~6,000 profile visits · <span class="upgrade-modal-stat-good">~1,200 website clicks</span>',
    growthFollowers:
      '+800 new followers / mo <span class="upgrade-modal-plan-growth-est">(est. if you stay consistent)</span>',
    perks: [
      "<b>60</b> posts · <b>6,000</b> replies",
      "<b>Hourly</b> refresh · <b>5</b> audiences",
    ],
  },
  grow: {
    name: "Grow",
    tagline: "Become #1 in your category.",
    monthly: 299,
    annual: 239,
    annualYear: 2868,
    save: 720,
    growthHeadline: "Grow to ~1.2M impressions/mo",
    growthVisitsClicks:
      '~24,000 profile visits · <span class="upgrade-modal-stat-good">~4,800 website clicks</span>',
    growthFollowers:
      '+3,200 new followers / mo <span class="upgrade-modal-plan-growth-est">(est. if you stay consistent)</span>',
    perks: [
      "<b>Unlimited</b> posts &amp; replies",
      "<b>Real-time</b> · priority support",
    ],
  },
};

const _SUBSCRIBED_STATUSES = ["active", "trialing", "past_due"];
let _upgradeStripeLinks = null;
let _upgradeStripeLinksReady = null;
let _subscriptionVisibilityRefreshInFlight = false;

function upgradeMoney(amount) {
  return "$" + amount.toLocaleString();
}

function buildUpgradeMascot() {
  const img = document.createElement("img");
  img.className = "upgrade-modal-mascot";
  img.src = "/static/assets/images/melea-charmark-bg.png";
  img.alt = "";
  img.setAttribute("aria-hidden", "true");
  return img;
}

function buildUpgradePerk(html) {
  const li = document.createElement("li");
  li.innerHTML = `${UPGRADE_CHECK_ICON}<span>${html}</span>`;
  return li;
}

async function fetchUpgradeStripeLinks() {
  if (_upgradeStripeLinks) return _upgradeStripeLinks;
  if (!_upgradeStripeLinksReady) {
    _upgradeStripeLinksReady = (async () => {
      try {
        const resp = await fetch((window.API_BASE || "") + "/api/config", {
          credentials: "same-origin",
        });
        const cfg = await resp.json();
        _upgradeStripeLinks = cfg?.stripe_links || {};
      } catch (_) {
        _upgradeStripeLinks = {};
      }
      return _upgradeStripeLinks;
    })();
  }
  return _upgradeStripeLinksReady;
}

function upgradeCheckoutLink(links, planKey, billing) {
  if (!links) return "";
  const legacyKey =
    planKey === "rise" ? "starter" : planKey === "grow" ? "pro" : "";
  const tier = links[planKey] || (legacyKey ? links[legacyKey] : null);
  return String(tier?.[billing] || "").trim();
}

function buildUpgradeCheckoutUrl(base) {
  const url = String(base || "").trim();
  if (!url) return "";
  const clerk = typeof getClerk === "function" ? getClerk() : null;
  const userId = clerk?.user?.id;
  if (!userId) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("client_reference_id", userId);
    return parsed.toString();
  } catch (_) {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}client_reference_id=${encodeURIComponent(userId)}`;
  }
}

function isUserSubscribed() {
  return !!(
    currentUserPlan && _SUBSCRIBED_STATUSES.includes(currentSubscriptionStatus)
  );
}

function allUserCampaignsForQuota() {
  const seen = new Set();
  const out = [];
  const add = (list) => {
    if (!Array.isArray(list)) return;
    list.forEach((campaign) => {
      const id = campaign?.id;
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push(campaign);
    });
  };
  if (typeof sitmarCampaigns !== "undefined") add(sitmarCampaigns);
  if (typeof contentHistorySections !== "undefined") {
    add(contentHistorySections.active);
    add(contentHistorySections.draft);
    add(contentHistorySections.inactive);
  }
  if (typeof state !== "undefined" && Array.isArray(state?.campaigns)) {
    add(state.campaigns);
  }
  return out;
}

function isOverCampaignLimit() {
  if (isUserSubscribed()) return false;
  const posted = allUserCampaignsForQuota().filter(
    (campaign) => String(campaign.status || "").toLowerCase() === "posted",
  );
  return posted.length >= 5;
}

function isCampaignLockedByPaywall(campaign) {
  if (!campaign) return false;
  if (String(campaign.status || "").toLowerCase() === "posted") return false;
  return isOverCampaignLimit();
}

function handleUpgradeRequired(status) {
  if (status !== 402) return false;
  openUpgradeModal();
  return true;
}

function buildUpgradePlanOption(planKey) {
  const plan = UPGRADE_PLANS[planKey];
  const opt = document.createElement("button");
  opt.type = "button";
  opt.className = "upgrade-modal-plan";
  opt.dataset.plan = planKey;

  const head = document.createElement("div");
  head.className = "upgrade-modal-plan-head";

  const name = document.createElement("div");
  name.className = "upgrade-modal-plan-name";
  setText(name, plan.name);

  const tagline = document.createElement("div");
  tagline.className = "upgrade-modal-plan-tagline";
  setText(tagline, plan.tagline);

  head.appendChild(name);
  head.appendChild(tagline);

  const price = document.createElement("div");
  price.className = "upgrade-modal-plan-price";
  const amt = document.createElement("span");
  amt.className = "upgrade-modal-plan-amt";
  amt.dataset.planAmt = planKey;
  const per = document.createElement("span");
  per.className = "upgrade-modal-plan-per";
  setText(per, "/mo");
  price.appendChild(amt);
  price.appendChild(per);

  const sub = document.createElement("div");
  sub.className = "upgrade-modal-plan-sub";
  sub.dataset.planSub = planKey;

  const growth = document.createElement("div");
  growth.className = "upgrade-modal-plan-growth";
  const growthIcon = document.createElement("span");
  growthIcon.className = "upgrade-modal-plan-growth-icon";
  growthIcon.innerHTML = UPGRADE_GROWTH_ICON;
  const growthBody = document.createElement("div");
  growthBody.className = "upgrade-modal-plan-growth-body";
  const growthHead = document.createElement("div");
  growthHead.className = "upgrade-modal-plan-growth-head";
  setText(growthHead, plan.growthHeadline);
  const growthVisits = document.createElement("div");
  growthVisits.className = "upgrade-modal-plan-growth-line";
  growthVisits.innerHTML = plan.growthVisitsClicks;
  const growthFollowers = document.createElement("div");
  growthFollowers.className = "upgrade-modal-plan-growth-line";
  growthFollowers.innerHTML = plan.growthFollowers;
  growthBody.appendChild(growthHead);
  growthBody.appendChild(growthVisits);
  growthBody.appendChild(growthFollowers);
  growth.appendChild(growthIcon);
  growth.appendChild(growthBody);

  const note = document.createElement("div");
  note.className = "upgrade-modal-plan-note";
  setText(note, UPGRADE_PLAN_NOTE);

  const perks = document.createElement("ul");
  perks.className = "upgrade-modal-plan-perks";
  plan.perks.forEach((html) => perks.appendChild(buildUpgradePerk(html)));

  opt.appendChild(head);
  opt.appendChild(price);
  opt.appendChild(sub);
  opt.appendChild(growth);
  opt.appendChild(note);
  opt.appendChild(perks);
  return opt;
}

function installUpgradeModalDismiss(overlay, onClose) {
  function onOverlayClick(e) {
    if (e.target === overlay) onClose();
  }
  function onKeydown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }
  overlay.addEventListener("click", onOverlayClick);
  document.addEventListener("keydown", onKeydown);
  return () => {
    overlay.removeEventListener("click", onOverlayClick);
    document.removeEventListener("keydown", onKeydown);
  };
}

function openUpgradeModal(initialPlan) {
  if (document.getElementById("upgrade-modal-overlay")) return;

  let billing = "annual";
  let selectedPlan = initialPlan === "grow" ? "grow" : "rise";

  void fetchUpgradeStripeLinks();

  const overlay = document.createElement("div");
  overlay.id = "upgrade-modal-overlay";
  overlay.className = "login-overlay upgrade-modal-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "upgrade-modal-title");

  const box = document.createElement("div");
  box.className = "login-box upgrade-modal-box";

  const head = document.createElement("div");
  head.className = "upgrade-modal-head";
  const headText = document.createElement("div");
  const title = document.createElement("div");
  title.id = "upgrade-modal-title";
  title.className = "upgrade-modal-name";
  setText(title, "melea");
  const tag = document.createElement("div");
  tag.className = "upgrade-modal-tag";
  tag.innerHTML =
    '<span class="upgrade-modal-live" aria-hidden="true"></span> watching 𝕏 for your brand';
  headText.appendChild(title);
  headText.appendChild(tag);
  head.appendChild(buildUpgradeMascot());
  head.appendChild(headText);

  const msg = document.createElement("div");
  msg.className = "upgrade-modal-msg";
  const upgradeIntroMobile = `hi — i'm melea, built to grow your brand on ${UPGRADE_X_ICON} and drive real reach and revenue.`;
  const upgradeIntroDesktop = `${upgradeIntroMobile}<br>pick a plan and let's compound your engagement, every day:`;
  msg.innerHTML = window.location.pathname.startsWith("/m")
    ? upgradeIntroMobile
    : upgradeIntroDesktop;

  const billingRow = document.createElement("div");
  billingRow.className = "upgrade-modal-billing";
  const billingToggle = document.createElement("div");
  billingToggle.className = "upgrade-modal-billing-toggle";
  const billingSeg = document.createElement("div");
  billingSeg.className = "content-tab-toggle";
  const annualBtn = document.createElement("button");
  annualBtn.type = "button";
  annualBtn.className = "content-tab-btn is-on";
  annualBtn.dataset.billing = "annual";
  setText(annualBtn, "Annual");
  const monthlyBtn = document.createElement("button");
  monthlyBtn.type = "button";
  monthlyBtn.className = "content-tab-btn";
  monthlyBtn.dataset.billing = "monthly";
  setText(monthlyBtn, "Monthly");
  billingSeg.appendChild(annualBtn);
  billingSeg.appendChild(monthlyBtn);
  billingToggle.appendChild(billingSeg);
  billingRow.appendChild(billingToggle);

  const plans = document.createElement("div");
  plans.className = "upgrade-modal-plans";
  const riseOpt = buildUpgradePlanOption("rise");
  const growOpt = buildUpgradePlanOption("grow");
  plans.appendChild(riseOpt);
  plans.appendChild(growOpt);

  const cta = document.createElement("button");
  cta.type = "button";
  cta.className = "upgrade-modal-cta";
  const ctaMain = document.createElement("span");
  ctaMain.className = "upgrade-modal-cta-main";
  setText(ctaMain, "Start growing — $99/mo");
  cta.appendChild(ctaMain);

  const foot = document.createElement("div");
  foot.className = "upgrade-modal-foot";
  const fine = document.createElement("span");
  fine.className = "upgrade-modal-fine";
  setText(fine, "cancel anytime");
  foot.appendChild(fine);

  box.appendChild(head);
  box.appendChild(msg);
  box.appendChild(billingRow);
  box.appendChild(plans);
  box.appendChild(cta);
  box.appendChild(foot);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  const previouslyFocused = document.activeElement;

  function renderUpgradeModal() {
    const annual = billing === "annual";
    billingRow.classList.toggle("is-monthly", !annual);
    annualBtn.classList.toggle("is-on", annual);
    monthlyBtn.classList.toggle("is-on", !annual);

    Object.keys(UPGRADE_PLANS).forEach((key) => {
      const plan = UPGRADE_PLANS[key];
      const amtEl = box.querySelector(`[data-plan-amt="${key}"]`);
      const subEl = box.querySelector(`[data-plan-sub="${key}"]`);
      if (amtEl)
        setText(amtEl, upgradeMoney(annual ? plan.annual : plan.monthly));
      if (subEl) {
        subEl.innerHTML = annual
          ? `<span class="upgrade-modal-save">save ${upgradeMoney(plan.save)}/yr</span>`
          : "billed monthly";
      }
    });

    plans.querySelectorAll(".upgrade-modal-plan").forEach((el) => {
      el.classList.toggle("is-selected", el.dataset.plan === selectedPlan);
    });

    const plan = UPGRADE_PLANS[selectedPlan];
    if (plan) {
      setText(
        ctaMain,
        `Start growing — ${upgradeMoney(annual ? plan.annual : plan.monthly)}/mo`,
      );
    }
  }

  let closed = false;
  let teardown = () => {};

  function close() {
    if (closed) return;
    closed = true;
    document.body.style.overflow = prevBodyOverflow;
    teardown();
    overlay.remove();
    if (previouslyFocused?.focus) previouslyFocused.focus();
  }

  teardown = installUpgradeModalDismiss(overlay, close);

  billingSeg.addEventListener("click", (e) => {
    const btn = e.target.closest(".content-tab-btn");
    if (!btn) return;
    billing = btn.dataset.billing;
    renderUpgradeModal();
  });

  plans.addEventListener("click", (e) => {
    const opt = e.target.closest(".upgrade-modal-plan");
    if (!opt) return;
    selectedPlan = opt.dataset.plan;
    renderUpgradeModal();
  });

  cta.addEventListener("click", () => {
    const checkoutUrl = buildUpgradeCheckoutUrl(
      upgradeCheckoutLink(_upgradeStripeLinks, selectedPlan, billing),
    );
    if (!checkoutUrl) {
      if (typeof showToast === "function") {
        showToast("Checkout link not configured.");
      }
      void fetchUpgradeStripeLinks().then(() => {
        const retryUrl = buildUpgradeCheckoutUrl(
          upgradeCheckoutLink(_upgradeStripeLinks, selectedPlan, billing),
        );
        if (retryUrl) window.open(retryUrl, "_blank", "noopener,noreferrer");
      });
      return;
    }
    window.open(checkoutUrl, "_blank", "noopener,noreferrer");
    close();
  });

  renderUpgradeModal();
  cta.focus();
}

function shouldShowUpgradeUpbar() {
  const clerk = typeof getClerk === "function" ? getClerk() : null;
  return !!(clerk && clerk.user) && !isUserSubscribed();
}

function buildUpgradeUpbar() {
  const bar = document.createElement("button");
  bar.type = "button";
  bar.className = "upbar";
  bar.addEventListener("click", openUpgradeModal);

  const icon = document.createElement("span");
  icon.className = "upbar-icon";
  icon.innerHTML = UPGRADE_ZAP_ICON;

  const text = document.createElement("div");
  text.className = "upbar-text";

  const heading = document.createElement("div");
  heading.className = "upbar-heading";
  setText(heading, "More reach.  More revenue.");

  const sub = document.createElement("div");
  sub.className = "upbar-sub";
  sub.innerHTML =
    'Engagement that compounds. <span class="upbar-price">$99/mo</span>.';

  text.appendChild(heading);
  text.appendChild(sub);

  const cta = document.createElement("span");
  cta.className = "upbar-cta";
  setText(cta, "Upgrade");

  bar.appendChild(icon);
  bar.appendChild(text);
  bar.appendChild(cta);
  return bar;
}

function appendUpgradeUpbarIfNeeded(container) {
  if (!container || !shouldShowUpgradeUpbar()) return;
  container.appendChild(buildUpgradeUpbar());
}

function removeUpgradeUpbars() {
  document.querySelectorAll(".upbar").forEach((el) => el.remove());
  const host = document.getElementById("mobile-upbar-host");
  if (host) {
    host.classList.add("hidden");
    host.querySelectorAll(".upbar").forEach((el) => el.remove());
  }
  document.documentElement.classList.remove("mobile-upbar-visible");
  document.documentElement.style.removeProperty("--mobile-upbar-h");
}

function syncMobileUpbar() {
  const shell = document.getElementById("shell");
  let host = document.getElementById("mobile-upbar-host");
  if (!host && shell) {
    host = document.createElement("div");
    host.id = "mobile-upbar-host";
    host.className = "mobile-upbar-host hidden";
    shell.insertBefore(host, shell.firstChild);
  }
  if (!host) return;

  const onCustomerHome = !!document.querySelector(
    "#brand-detail-content .customer-tab-shell",
  );
  const show = shouldShowUpgradeUpbar() && onCustomerHome;
  const existing = host.querySelector(".upbar");
  if (show && !existing) {
    host.appendChild(buildUpgradeUpbar());
  } else if (!show && existing) {
    existing.remove();
  }
  host.classList.toggle("hidden", !show);
  document.documentElement.classList.toggle("mobile-upbar-visible", show);

  const setUpbarHeight = () => {
    if (!show) {
      document.documentElement.style.removeProperty("--mobile-upbar-h");
      return;
    }
    document.documentElement.style.setProperty(
      "--mobile-upbar-h",
      `${host.offsetHeight}px`,
    );
  };
  if (show) requestAnimationFrame(setUpbarHeight);
  else setUpbarHeight();
}

function syncDesktopUpbar() {
  if (typeof renderBrandHomeContentColOnly !== "function") return;
  if (!document.querySelector(".brand-home-content-col")) return;
  let company = null;
  if (
    typeof selectedBrandId !== "undefined" &&
    selectedBrandId &&
    typeof companies !== "undefined"
  ) {
    company = companies.find((c) => c.id === selectedBrandId);
  }
  if (!company && typeof emptyHomeCompany === "function") {
    company = emptyHomeCompany();
  }
  if (company) renderBrandHomeContentColOnly(company);
}

function syncUpgradeChrome() {
  if (!shouldShowUpgradeUpbar()) {
    removeUpgradeUpbars();
    reconcileStoriesSubscriptionGate();
    return;
  }
  syncMobileUpbar();
  syncDesktopUpbar();
}

function reconcileStoriesSubscriptionGate() {
  if (!isUserSubscribed()) return;
  if (typeof storiesCustomerGated === "undefined" || !storiesCustomerGated) return;
  if (typeof storiesCustomerFeed !== "undefined") storiesCustomerFeed = [];
  if (typeof loadStoriesCustomerPage !== "function") return;
  void loadStoriesCustomerPage({ append: false }).then(() => {
    let company = null;
    if (
      typeof selectedBrandId !== "undefined" &&
      selectedBrandId &&
      typeof companies !== "undefined"
    ) {
      company = companies.find((c) => c.id === selectedBrandId);
    }
    if (!company && typeof emptyHomeCompany === "function") {
      company = emptyHomeCompany();
    }
    if (!company) return;
    if (typeof renderBrandHomeStoriesColOnly === "function") {
      if (
        !renderBrandHomeStoriesColOnly(company) &&
        typeof renderBrandDetail === "function"
      ) {
        renderBrandDetail(company);
      }
    }
  });
}

async function refreshSubscriptionOnVisibility() {
  if (document.visibilityState !== "visible") return;
  if (_subscriptionVisibilityRefreshInFlight) return;
  const clerk = typeof getClerk === "function" ? getClerk() : null;
  if (!clerk?.user) return;
  _subscriptionVisibilityRefreshInFlight = true;
  const wasSubscribed = isUserSubscribed();
  try {
    const { ok, body } = await api("/api/me", { method: "GET" });
    if (ok && body) {
      currentUserPlan = body.plan || null;
      currentSubscriptionStatus = body.subscription_status || null;
    }
  } catch (_) {
    // no-op
  } finally {
    const isSubscribed = isUserSubscribed();
    syncUpgradeChrome();
    if (!wasSubscribed && isSubscribed) {
      if (typeof checkAndShowWelcomePaidModal === "function") {
        checkAndShowWelcomePaidModal();
      }
      if (typeof storiesCustomerFeed !== "undefined") storiesCustomerFeed = [];
      if (typeof bootCustomerBrand === "function") void bootCustomerBrand();
    }
    _subscriptionVisibilityRefreshInFlight = false;
  }
}

document.addEventListener("visibilitychange", () => {
  void refreshSubscriptionOnVisibility();
});
