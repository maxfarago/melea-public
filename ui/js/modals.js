// ============================================================
// add-brand modal
// ============================================================

function onboardingMessage(company) {
  return customerLoadingMessage(company) || PRE_BRAND_ONBOARDING_FALLBACK;
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
    : brandFavicon(company.website_url) ||
      avatarFor(companyDisplayName(company), "onboarding-logo", null);
  if (logoEl) logoEl.className = "onboarding-logo";
  content.appendChild(logoEl);

  const nameEl = document.createElement("div");
  nameEl.className = "onboarding-name";
  setText(nameEl, companyDisplayName(company));
  content.appendChild(nameEl);

  const statusLine = meleaStatusLine(onboardingMessage(company), {
    labelClass: "onboarding-status",
    showLogo: false,
  });
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
      statusEl.classList.add("onboarding-status-swap");
      setText(statusEl, msg);
      statusEl.addEventListener(
        "animationend",
        () => statusEl.classList.remove("onboarding-status-swap"),
        { once: true },
      );
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

async function openAddBrandModal() {
  const modal = $("add-brand-modal");
  if (!modal) return;
  const input = $("add-brand-url");
  input.value = "";
  input.removeAttribute("aria-invalid");
  setText($("add-brand-error"), "");
  modal.classList.remove("hidden");
  input.focus();
}

function closeAddBrandModal() {
  $("add-brand-modal").classList.add("hidden");
}

function meleaWordmarkSrc() {
  return "/static/assets/images/wordmark-sans-trans.png";
}

function setBrandCreateActive(active) {
  const app = $("app");
  if (app) app.classList.toggle("brand-create-active", !!active);
}

function brandCreateLogoEl() {
  const img = document.createElement("img");
  img.className = "brand-create-logo";
  img.src = meleaWordmarkSrc();
  img.alt = "melea";
  return img;
}

function clearBrandCreateView() {
  const root = $("detail");
  if (root) root.innerHTML = "";
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
async function submitBrandWebsite(
  url,
  { input, errEl, submitBtn, submitLabel = "Continue" },
) {
  setText(errEl, "");
  if (input) input.removeAttribute("aria-invalid");
  const trimmed = String(url || "").trim();
  if (!trimmed) {
    setText(errEl, "Add a website URL or domain first.");
    if (input) {
      input.setAttribute("aria-invalid", "true");
      input.focus();
    }
    return false;
  }
  if (submitBtn) {
    submitBtn.disabled = true;
    setText(submitBtn, "Looking it up…");
  }
  try {
    const { ok, status, body } = await api("/api/companies", {
      method: "POST",
      body: { website_url: trimmed },
    });
    if (status === 403 && body?.detail === "You already have a brand.") {
      setText(errEl, "You already have a brand in your account.");
      return false;
    }
    if (!ok) {
      setText(
        errEl,
        apiErrorMessage(
          body,
          "Couldn't add that brand. Enter a valid public website URL or domain.",
        ),
      );
      if (input) input.setAttribute("aria-invalid", "true");
      return false;
    }
    if (body && body.company && body.company.id) {
      let resolvedCompany = body.company;
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
        if ((!claimOk || !claimBody?.company_id) && !claimAuthRequired) {
          setText(errEl, apiErrorMessage(claimBody, "Brand created but attachment failed."));
          return false;
        }
        if (claimOk && claimBody?.company_id) {
          if (claimBody.company) resolvedCompany = claimBody.company;
        }
      }
      setStoredCompanyId(resolvedCompany.id);
      ensureCompanyStages(resolvedCompany);
      companies = [resolvedCompany];
      syncBrandsHeaderAdd();
      await finishBrandCreateTransition();
      if (
        body.created === false &&
        !shouldResumePreBrandOnboarding(resolvedCompany)
      ) {
        markDuplicateBrandOnboarding(false);
        setPreBrandExistingBrandLoad(resolvedCompany.id);
        showOnboardingScreen(resolvedCompany);
        void (async () => {
          try {
            await prefetchBrandDashboardData(resolvedCompany.id);
            await new Promise((resolve) =>
              setTimeout(resolve, EXISTING_BRAND_OVERLAY_HOLD_MS),
            );
          } finally {
            clearPreBrandExistingBrandLoad();
            clearPreBrandOnboardingStatusMessage();
            hideOnboardingScreen(() => {
              void bootCustomerBrand();
            });
          }
        })();
      } else {
        if (body.created === false) {
          markDuplicateBrandOnboarding(false);
          void prefetchBrandDashboardData(resolvedCompany.id);
        }
        showOnboardingScreen(resolvedCompany);
        startStagePolling(resolvedCompany.id, { onboarding: true, delayMs: 0 });
      }
    }
    return true;
  } catch (err) {
    setText(errEl, "Network error: " + err.message);
    return false;
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      setText(submitBtn, submitLabel);
    }
  }
}

async function renderBrandCreateView() {
  if (currentView !== "brands" || companies.length > 0) return;
  const root = $("detail");
  if (!root) return;
  setBrandCreateActive(true);
  root.innerHTML = "";
  const screen = document.createElement("div");
  screen.className = "brand-create-screen";
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
  input.name = "website_url";
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
  screen.appendChild(card);
  root.appendChild(screen);
  input.focus();
}

async function handleAddBrandSubmit(e) {
  e.preventDefault();
  const input = $("add-brand-url");
  const errEl = $("add-brand-error");
  const submitBtn = $("add-brand-submit");
  const ok = await submitBrandWebsite(input.value, {
    input,
    errEl,
    submitBtn,
    submitLabel: "Add brand",
  });
  if (ok) closeAddBrandModal();
}

let pendingGenerateRunCompany = null;

// Hooked up to the "+ new run" affordance in the brand-runs sidebar.
// Lost from master during the company-owned-twitter merge — restored
// verbatim so the button works again.
function openSelectedBrandNewRun() {
  showToast("Profile runs are removed.");
}

async function openGenerateRunModal(company) {
  showToast("Profile runs are removed.");
}

function closeGenerateRunModal() {
  $("generate-run-modal").classList.add("hidden");
  pendingGenerateRunCompany = null;
}

async function handleGenerateRunSubmit(e) {
  e.preventDefault();
  showToast("Profile runs are removed.");
}

// ===== Custom aggregate modal =====
// state held inside the modal between fetch and submit. only one of these
// flows can be in flight at a time (the modal is global).
let customAggregateModalState = null;

async function openCustomAggregateModal(company) {
  showToast("Profile runs are removed.");
}

function renderCustomAggregateRuns() {
  const list = $("custom-aggregate-runs");
  if (!list || !customAggregateModalState) return;
  list.innerHTML = "";
  const runs = customAggregateModalState.runs;
  if (!runs.length) {
    const empty = document.createElement("div");
    empty.className = "custom-aggregate-runs-empty";
    setText(empty, "Run selection is no longer available.");
    list.appendChild(empty);
    return;
  }
  runs.forEach((run) => {
    const row = document.createElement("label");
    row.className = "custom-aggregate-run";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = run.id;
    cb.checked = customAggregateModalState.selected.has(run.id);
    // a partial (running/queued/error) run can still contribute usable
    // step rows, so we let the operator include it. they see the status
    // and decide.
    cb.addEventListener("change", () => {
      if (cb.checked) customAggregateModalState.selected.add(run.id);
      else customAggregateModalState.selected.delete(run.id);
      updateCustomAggregateSubmitState();
    });
    row.appendChild(cb);
    const meta = document.createElement("span");
    meta.className = "custom-aggregate-run-meta";
    const status = document.createElement("span");
    status.className = "custom-aggregate-run-status " + (run.status || "");
    setText(status, run.status || "unknown");
    meta.appendChild(status);
    const when = document.createElement("span");
    when.className = "custom-aggregate-run-when";
    setText(when, relativeTime(run.started_at));
    meta.appendChild(when);
    if (run.is_override) {
      const ov = document.createElement("span");
      ov.className = "run-badge run-badge-override";
      setText(ov, "custom prompts");
      meta.appendChild(ov);
    }
    row.appendChild(meta);
    list.appendChild(row);
  });
}

function customAggregateSelectAll(selectAll) {
  if (!customAggregateModalState) return;
  customAggregateModalState.runs.forEach((run) => {
    if (selectAll) customAggregateModalState.selected.add(run.id);
    else customAggregateModalState.selected.delete(run.id);
  });
  renderCustomAggregateRuns();
  updateCustomAggregateSubmitState();
}

function updateCustomAggregateSubmitState() {
  const btn = $("custom-aggregate-submit");
  const count = $("custom-aggregate-count");
  if (!customAggregateModalState) return;
  const n = customAggregateModalState.selected.size;
  if (count) setText(count, `${n} selected`);
  if (btn) {
    btn.disabled = n === 0;
    setText(btn, `Build profile from ${n} run${n === 1 ? "" : "s"}`);
  }
}

function closeCustomAggregateModal() {
  const modal = $("custom-aggregate-modal");
  if (modal) modal.classList.add("hidden");
  customAggregateModalState = null;
}

function handleCustomAggregateSubmit() {
  if (!customAggregateModalState) return;
  const ids = Array.from(customAggregateModalState.selected);
  if (!ids.length) return;
  const company = customAggregateModalState.company;
  customAggregateState = { companyId: company.id, runIds: ids };
  saveCustomAggregateToStorage(company.id, ids);
  closeCustomAggregateModal();
  renderBrandDetail(company);
}

async function refreshSelectedBrand() {
  if (selectedBrandId) await refreshCompanyStages(selectedBrandId);
  else await loadCompanies();
  if (!selectedBrandId) return;
  const company = companies.find((c) => c.id === selectedBrandId);
  if (!company) {
    renderBrandsSidebar();
    renderDetailEmpty("brands");
    hideRunsSidebar();
    return;
  }
  renderBrandsSidebar();
  renderBrandDetail(company);
  hideRunsSidebar();
}
