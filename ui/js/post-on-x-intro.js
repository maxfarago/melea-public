const POST_ON_X_INTRO_KEY_PREFIX = "melea:post_on_x_intro_seen:";
const WELCOME_PAID_KEY_PREFIX = "melea:welcome_paid_seen:";
const WELCOME_PAID_SUBSCRIBED_STATUSES = ["active", "trialing", "past_due"];

const POST_ON_X_INTRO_BTN_X =
  '<svg class="sitmar-tweet-post-x" viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.254 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';

const POST_ON_X_INTRO_X_ICON =
  '<svg class="post-on-x-intro-step-icon" viewBox="0 0 24 24" width="32" height="32" aria-hidden="true"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.254 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';

const POST_ON_X_INTRO_DIST_ICON =
  '<svg class="post-on-x-intro-step-icon" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 8.6 8.6 0 0 1-3.2-.6L4 21l1.9-4.4a8 8 0 0 1-1.4-4.6A8.4 8.4 0 0 1 13 3.7a8.4 8.4 0 0 1 8 7.8z"/></svg>';

const POST_ON_X_INTRO_ARROW =
  '<svg class="post-on-x-intro-arrow-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';

const POST_ON_X_INTRO_ZAP_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></svg>';

const POST_ON_X_INTRO_COPY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

const WELCOME_PAID_ENGAGE_ICON =
  '<svg class="welcome-paid-engage-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>';

const POST_ON_X_INTRO_ICON_PX = 32;
const POST_ON_X_INTRO_ARROW_PX = 22;

function postOnXIntroUserId() {
  const clerk = typeof getClerk === "function" ? getClerk() : null;
  return clerk?.user?.id ? String(clerk.user.id).trim() : "";
}

function hasSeenPostOnXIntro() {
  const userId = postOnXIntroUserId();
  if (!userId) return true;
  try {
    return localStorage.getItem(POST_ON_X_INTRO_KEY_PREFIX + userId) === "1";
  } catch {
    return true;
  }
}

function markPostOnXIntroSeen() {
  const userId = postOnXIntroUserId();
  if (!userId) return;
  try {
    localStorage.setItem(POST_ON_X_INTRO_KEY_PREFIX + userId, "1");
  } catch {
    /* ignore */
  }
}

function normalizePlanKey(planValue) {
  const plan = String(planValue || "")
    .trim()
    .toLowerCase();
  if (plan === "grow" || plan === "pro") return "grow";
  if (plan === "rise" || plan === "starter") return "rise";
  return "";
}

function welcomePaidPlanLabel(planKey) {
  if (planKey === "grow") return "Grow";
  if (planKey === "rise") return "Rise";
  return "Paid";
}

function hasSeenWelcomePaidModal() {
  const userId = postOnXIntroUserId();
  if (!userId) return true;
  try {
    return localStorage.getItem(WELCOME_PAID_KEY_PREFIX + userId) === "1";
  } catch {
    return true;
  }
}

function markWelcomePaidModalSeen() {
  const userId = postOnXIntroUserId();
  if (!userId) return;
  try {
    localStorage.setItem(WELCOME_PAID_KEY_PREFIX + userId, "1");
  } catch {
    /* ignore */
  }
}

function getWelcomePaidPlanInfo() {
  const status = String(currentSubscriptionStatus || "")
    .trim()
    .toLowerCase();
  if (!WELCOME_PAID_SUBSCRIBED_STATUSES.includes(status)) return null;
  const key = normalizePlanKey(currentUserPlan);
  if (!key) return null;
  return {
    key,
    label: welcomePaidPlanLabel(key),
  };
}

function installPostOnXIntroDismiss(overlay, onClose) {
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

function postOnXIntroIconSlot(svgHtml, sizePx) {
  const slot = document.createElement("span");
  slot.className = "post-on-x-intro-icon-slot";
  slot.style.width = `${sizePx}px`;
  slot.style.height = `${sizePx}px`;
  slot.innerHTML = svgHtml;
  const svg = slot.querySelector("svg");
  if (svg) {
    svg.setAttribute("width", String(sizePx));
    svg.setAttribute("height", String(sizePx));
    svg.style.width = `${sizePx}px`;
    svg.style.height = `${sizePx}px`;
    svg.style.maxWidth = `${sizePx}px`;
    svg.style.maxHeight = `${sizePx}px`;
  }
  return slot;
}

function postOnXIntroStep(label, svgHtml) {
  const step = document.createElement("div");
  step.className = "post-on-x-intro-step";
  step.appendChild(postOnXIntroIconSlot(svgHtml, POST_ON_X_INTRO_ICON_PX));
  const labelEl = document.createElement("span");
  labelEl.className = "post-on-x-intro-step-label";
  setText(labelEl, label);
  step.appendChild(labelEl);
  return step;
}

function buildPostOnXIntroGraphic() {
  const graphic = document.createElement("div");
  graphic.className = "post-on-x-intro-graphic";
  graphic.setAttribute("aria-hidden", "true");

  const arrow = document.createElement("div");
  arrow.className = "post-on-x-intro-arrow";
  arrow.appendChild(postOnXIntroIconSlot(POST_ON_X_INTRO_ARROW, POST_ON_X_INTRO_ARROW_PX));

  graphic.appendChild(postOnXIntroStep("Post on X", POST_ON_X_INTRO_X_ICON));
  graphic.appendChild(arrow);
  graphic.appendChild(
    postOnXIntroStep("Distribute", POST_ON_X_INTRO_DIST_ICON),
  );
  return graphic;
}

function buildPostOnXConfettiBurst(origin) {
  const burst = document.createElement("div");
  burst.className = "post-on-x-intro-confetti";
  burst.setAttribute("aria-hidden", "true");
  burst.style.setProperty("--burst-x", `${origin.xPct}%`);
  burst.style.setProperty("--burst-y", `${origin.yPct}%`);

  const colors = [
    "var(--accent)",
    "var(--accent-dim)",
    "var(--good)",
    "var(--warn)",
    "#f472b6",
    "#fbbf24",
  ];
  const count = 12;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("span");
    piece.className = "post-on-x-intro-confetti-piece";
    const angle = (360 / count) * i + (Math.random() * 28 - 14);
    const dist = 42 + Math.random() * 52;
    const rad = (angle * Math.PI) / 180;
    const size = 5 + Math.random() * 7;
    piece.style.setProperty("--confetti-x", `${Math.cos(rad) * dist}px`);
    piece.style.setProperty("--confetti-y", `${Math.sin(rad) * dist}px`);
    piece.style.setProperty("--confetti-size", `${size}px`);
    piece.style.setProperty(
      "--confetti-delay",
      `${origin.stagger + Math.random() * 0.04}s`,
    );
    piece.style.setProperty(
      "--confetti-duration",
      `${0.75 + Math.random() * 0.4}s`,
    );
    piece.style.background = colors[(i + origin.colorOffset) % colors.length];
    burst.appendChild(piece);
  }
  return burst;
}

function buildPostOnXIntroTitle(text) {
  const wrap = document.createElement("div");
  wrap.className = "post-on-x-intro-title-wrap";

  [
    { xPct: 22, yPct: 36, stagger: 0, colorOffset: 0 },
    { xPct: 50, yPct: 54, stagger: 0.28, colorOffset: 2 },
    { xPct: 78, yPct: 72, stagger: 0.56, colorOffset: 4 },
  ].forEach((origin) => wrap.appendChild(buildPostOnXConfettiBurst(origin)));

  const title = document.createElement("h2");
  title.id = "post-on-x-intro-title";
  title.className = "post-on-x-intro-title";
  setText(title, text);

  wrap.appendChild(title);
  return wrap;
}

function buildPostOnXIntroCallout(variant, iconHtml, textHtml) {
  const callout = document.createElement("div");
  callout.className = `post-on-x-intro-callout post-on-x-intro-callout-${variant}`;
  const icon = document.createElement("span");
  icon.className = "post-on-x-intro-callout-icon";
  icon.innerHTML = iconHtml;
  const text = document.createElement("p");
  text.className = "post-on-x-intro-callout-text";
  text.innerHTML = textHtml;
  callout.appendChild(icon);
  callout.appendChild(text);
  return callout;
}

function showPostOnXIntro(onConfirm) {
  if (document.getElementById("post-on-x-intro-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "post-on-x-intro-overlay";
  overlay.className = "login-overlay post-on-x-intro-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "post-on-x-intro-title");

  const box = document.createElement("div");
  box.className = "login-box post-on-x-intro-box";

  const body = document.createElement("div");
  body.className = "post-on-x-intro-body";
  const lead = document.createElement("p");
  lead.className = "post-on-x-intro-body-p";
  setText(
    lead,
    "We'll open your draft in a new tab to post on X. When you come back, melea lines up the top threads on your story.",
  );
  body.appendChild(lead);
  body.appendChild(
    buildPostOnXIntroCallout(
      "reach",
      POST_ON_X_INTRO_ZAP_ICON,
      "Reply into those threads and your post can reach <b>10x more people</b> — that's where the engagement is.",
    ),
  );
  body.appendChild(
    buildPostOnXIntroCallout(
      "url",
      POST_ON_X_INTRO_COPY_ICON,
      "Don't forget: <b>copy your post's URL</b> before you head back — melea will use it in generated replies.",
    ),
  );

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className =
    "sc-generate-btn cc-cta sitmar-tweet-post-btn post-on-x-intro-confirm";
  const confirmLabel = document.createElement("span");
  confirmLabel.className = "sitmar-tweet-post-label";
  setText(confirmLabel, "Got it — take me to");
  confirmBtn.appendChild(confirmLabel);
  confirmBtn.insertAdjacentHTML("beforeend", POST_ON_X_INTRO_BTN_X);

  box.appendChild(buildPostOnXIntroTitle("Your first post with melea!"));
  box.appendChild(buildPostOnXIntroGraphic());
  box.appendChild(body);
  box.appendChild(confirmBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.body.style.overflow = prevBodyOverflow;
    teardown();
    overlay.remove();
  };

  let teardown = installPostOnXIntroDismiss(overlay, close);
  if (typeof installModalBehavior === "function") {
    const utilsTeardown = installModalBehavior(overlay, close);
    const baseTeardown = teardown;
    teardown = () => {
      baseTeardown();
      utilsTeardown();
    };
  }

  confirmBtn.addEventListener("click", () => {
    if (closed) return;
    closed = true;
    document.body.style.overflow = prevBodyOverflow;
    markPostOnXIntroSeen();
    teardown();
    overlay.remove();
    onConfirm();
  });

  confirmBtn.focus();
}

function gatePostOnXIntro(onConfirm) {
  if (hasSeenPostOnXIntro()) {
    onConfirm();
    return;
  }
  showPostOnXIntro(onConfirm);
}

function showWelcomePaidModal() {
  if (document.getElementById("welcome-paid-overlay")) return;
  const planInfo = getWelcomePaidPlanInfo();
  if (!planInfo) return;
  if (typeof syncUpgradeChrome === "function") syncUpgradeChrome();

  const overlay = document.createElement("div");
  overlay.id = "welcome-paid-overlay";
  overlay.className = "login-overlay welcome-paid-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", "welcome-paid-title");

  const box = document.createElement("div");
  box.className = "login-box welcome-paid-box";

  const body = document.createElement("div");
  body.className = "welcome-paid-body";

  const lead = document.createElement("p");
  lead.className = "welcome-paid-body-p";
  setText(
    lead,
    "You're all set. melea finds your audience in their info bubble — and gets your brand into their conversations and feeds.",
  );

  const callout = document.createElement("div");
  callout.className = "welcome-paid-plan-callout";
  const calloutLabel = document.createElement("span");
  calloutLabel.className = "welcome-paid-plan-label";
  setText(calloutLabel, "Current plan");
  const calloutValue = document.createElement("span");
  calloutValue.className = `welcome-paid-plan-badge welcome-paid-plan-${planInfo.key}`;
  setText(calloutValue, planInfo.label);
  callout.appendChild(calloutLabel);
  callout.appendChild(calloutValue);

  body.appendChild(lead);
  body.appendChild(callout);

  const confirmBtn = document.createElement("button");
  confirmBtn.type = "button";
  confirmBtn.className =
    "sc-generate-btn cc-cta sitmar-tweet-post-btn welcome-paid-confirm";
  const confirmLabel = document.createElement("span");
  confirmLabel.className = "sitmar-tweet-post-label";
  setText(confirmLabel, "Engage");
  confirmBtn.appendChild(confirmLabel);
  confirmBtn.insertAdjacentHTML("beforeend", WELCOME_PAID_ENGAGE_ICON);

  const titleWrap = buildPostOnXIntroTitle(`You're on melea ${planInfo.label}!`);
  titleWrap.classList.add("welcome-paid-title-wrap");
  const title = titleWrap.querySelector(".post-on-x-intro-title");
  if (title) title.id = "welcome-paid-title";

  box.appendChild(titleWrap);
  box.appendChild(body);
  box.appendChild(confirmBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    markWelcomePaidModalSeen();
    document.body.style.overflow = prevBodyOverflow;
    teardown();
    overlay.remove();
  };

  let teardown = installPostOnXIntroDismiss(overlay, close);
  if (typeof installModalBehavior === "function") {
    const utilsTeardown = installModalBehavior(overlay, close);
    const baseTeardown = teardown;
    teardown = () => {
      baseTeardown();
      utilsTeardown();
    };
  }

  confirmBtn.addEventListener("click", close);
  confirmBtn.focus();
}

function checkAndShowWelcomePaidModal() {
  if (hasSeenWelcomePaidModal()) return false;
  const planInfo = getWelcomePaidPlanInfo();
  if (!planInfo) return false;
  showWelcomePaidModal();
  return true;
}

function buildTweetIntentUrl(text) {
  return (
    "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text || "")
  );
}
