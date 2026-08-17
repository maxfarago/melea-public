// ============================================================
// stage status + spend chrome
// ============================================================

function renderRunningStatus(el) {
  el.innerHTML = '<span class="spinner"></span>running';
}

function appendSectionStatusPill(parent, status) {
  const statusEl = document.createElement("span");
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  let cls = "running";
  if (normalized === "done") cls = "done";
  else if (normalized === "error" || normalized === "skipped") cls = "error";
  statusEl.className = "crawl-source-status " + cls;
  parent.appendChild(statusEl);
  return statusEl;
}

function appendCrawlSummaryChevron(summary) {
  const chevron = document.createElement("span");
  chevron.className = "crawl-source-chevron";
  chevron.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
  summary.prepend(chevron);
}

function attachSectionToggle(titleWrap, body, stateKey) {
  const chevron = document.createElement("span");
  chevron.className =
    "brand-section-chevron" + (isBrandSectionOpen(stateKey) ? " open" : "");
  chevron.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
  titleWrap.prepend(chevron);
  titleWrap.classList.add("is-toggle");
  titleWrap.setAttribute("role", "button");
  titleWrap.tabIndex = 0;
  let open = isBrandSectionOpen(stateKey);
  body.classList.toggle("hidden", !open);
  const toggle = () => {
    open = !open;
    setBrandSectionOpen(stateKey, open);
    body.classList.toggle("hidden", !open);
    chevron.classList.toggle("open", open);
  };
  titleWrap.addEventListener("click", toggle);
  titleWrap.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  });
}

async function saveGeneratedAudience(item, saveBtn = null) {
  const title = String(item?.title || "").trim();
  const description = String(item?.description || "").trim();
  if (!title || !description) {
    showFlash("Could not save audience: title and description are required.", {
      kind: "error",
    });
    return;
  }
  if (saveBtn) saveBtn.disabled = true;
  try {
    const { ok, status, body } = await api("/api/audiences", {
      method: "POST",
      body: {
        title,
        description,
      },
    });
    if (status === 401) {
      showLogin();
      return;
    }
    if (!ok) {
      showFlash(apiErrorMessage(body, "Could not save audience."), {
        kind: "error",
      });
      return;
    }
    showFlash("Audience saved.");
  } catch (err) {
    showFlash("Network error: " + err.message, { kind: "error" });
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function replaceCompanyInCache(company) {
  if (!company?.id) return;
  if (!company.stages) company.stages = buildStagesFromLegacy(company);
  else mirrorStagesToLegacyFields(company, company.stages);
  const idx = companies.findIndex((c) => c.id === company.id);
  if (idx < 0) companies.unshift(company);
  else companies[idx] = company;
}

function replaceAudienceInCache(audience) {
  const idx = audiences.findIndex((a) => a.id === audience.id);
  if (idx >= 0) audiences[idx] = audience;
  else audiences.unshift(audience);
}

function resetAudienceEditState() {
  editingAudienceTitleId = null;
  editingAudienceDescriptionId = null;
  audienceTitleDraft = "";
  audienceDescriptionDraft = "";
}

async function fetchCompany(companyId) {
  const { ok, status, body } = await api(
    `/api/company/${encodeURIComponent(companyId)}`,
    { method: "GET" },
  );
  if (status === 401) {
    showLogin();
    return null;
  }
  if (!ok || !body || !body.company) return null;
  return body.company;
}
