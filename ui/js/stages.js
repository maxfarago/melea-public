// ============================================================
// company pipeline stage accessors + unified polling
// ============================================================

const STAGE_NAMES = [
  "website_synthesis",
  "audience",
  "audience_match",
  "brand_synthesis",
  "brand_scoring",
  "audience_trends",
];

const STAGE_LEGACY = {
  website_synthesis: {
    status: "website_synthesis_status",
    error: "website_synthesis_error",
    model: "website_synthesis_model",
    updated_at: "website_synthesis_updated_at",
  },
  linkedin: {
    status: "linkedin_company_status",
    error: "linkedin_company_error",
    model: "linkedin_company_extraction_model",
    updated_at: "linkedin_company_updated_at",
  },
  audience: {
    status: "audience_status",
    error: "audience_error",
    model: "audience_model",
    updated_at: "audience_generated_at",
  },
  audience_match: {
    status: "audience_match_status",
    error: "audience_match_error",
    model: "audience_match_model",
    updated_at: "audience_match_generated_at",
  },
  brand_synthesis: {
    status: "brand_synthesis_status",
    error: "brand_synthesis_error",
    model: "brand_synthesis_model",
    updated_at: "brand_synthesis_updated_at",
  },
  brand_scoring: {
    status: "brand_scoring_status",
    error: "brand_scoring_error",
    model: null,
    updated_at: null,
  },
  audience_trends: {
    status: "audience_trends_status",
    error: "audience_trends_error",
    model: null,
    updated_at: "audience_trends_updated_at",
  },
};

const STALE_PENDING_MS = 5 * 60 * 1000;
const STAGE_POLL_INTERVAL_MS = 1200;

const stagePollTargets = new Set();
let stagePollTimer = null;
let stagePollInFlight = false;
let onboardingCompanyId = "";

const POST_SYNTHESIS_STAGES = ["audience", "brand_scoring"];

function emptyStageRow() {
  return { status: "idle", error: null, model: null, updated_at: null };
}

function normalizeStageRow(row) {
  if (!row || typeof row !== "object") return emptyStageRow();
  return {
    status: String(row.status || "idle")
      .trim()
      .toLowerCase() || "idle",
    error: row.error != null ? String(row.error) : null,
    model: row.model != null ? String(row.model) : null,
    updated_at:
      row.updated_at != null && Number.isFinite(Number(row.updated_at))
        ? Number(row.updated_at)
        : null,
  };
}

function inferLegacyStatus(company, name, raw) {
  const status = String(raw || "")
    .trim()
    .toLowerCase();
  if (status) return status;
  switch (name) {
    case "website_synthesis":
      return metaSearchTerms(company).length || hasHomepageContent(company)
        ? "done"
        : "idle";
    case "linkedin":
      return String(company.linkedin_company_url || "").trim() ? "done" : "idle";
    default:
      return "idle";
  }
}

function legacyStageRow(company, name) {
  const fields = STAGE_LEGACY[name];
  if (!fields) return emptyStageRow();
  const rawStatus = fields.status ? company[fields.status] : null;
  const updatedAtKey = fields.updated_at;
  let updatedAt = updatedAtKey ? company[updatedAtKey] : null;
  if (updatedAt == null) {
    updatedAt = company.updated_at || company.created_at || null;
  }
  return {
    status: inferLegacyStatus(company, name, rawStatus),
    error: fields.error && company[fields.error] != null
      ? String(company[fields.error])
      : null,
    model: fields.model && company[fields.model] != null
      ? String(company[fields.model])
      : null,
    updated_at:
      updatedAt != null && Number.isFinite(Number(updatedAt))
        ? Number(updatedAt)
        : null,
  };
}

function getStage(company, name) {
  if (!company) return emptyStageRow();
  if (company.stages && company.stages[name]) {
    const row = normalizeStageRow(company.stages[name]);
    if (row.status === "idle" && !company.stages[name].status) {
      return legacyStageRow(company, name);
    }
    return row;
  }
  return legacyStageRow(company, name);
}

function getStageStatus(company, name) {
  return getStage(company, name).status;
}

function getStages(company) {
  const stages = {};
  for (const name of STAGE_NAMES) {
    stages[name] = getStage(company, name);
  }
  return stages;
}

function ensureCompanyStages(company) {
  if (!company) return;
  if (company.stages && typeof company.stages === "object") return;
  company.stages = {};
  for (const name of STAGE_NAMES) {
    company.stages[name] = legacyStageRow(company, name);
  }
}

function buildStagesFromLegacy(company) {
  const stages = {};
  for (const name of STAGE_NAMES) {
    stages[name] = legacyStageRow(company, name);
  }
  return stages;
}

function mirrorStagesToLegacyFields(company, stages) {
  if (!company || !stages) return;
  for (const name of STAGE_NAMES) {
    const row = normalizeStageRow(stages[name]);
    const fields = STAGE_LEGACY[name];
    if (!fields) continue;
    if (fields.status) company[fields.status] = row.status === "idle" ? null : row.status;
    if (fields.error) company[fields.error] = row.error;
    if (fields.model) company[fields.model] = row.model;
    if (fields.updated_at && row.updated_at != null) {
      company[fields.updated_at] = row.updated_at;
    }
  }
}

function isTerminalStatus(status) {
  const value = String(status || "")
    .trim()
    .toLowerCase();
  return (
    value === "done" ||
    value === "completed" ||
    value === "error" ||
    value === "skipped" ||
    value === "idle"
  );
}

function isRunningStatus(status) {
  const value = String(status || "")
    .trim()
    .toLowerCase();
  return (
    value === "pending" || value === "running" || value.startsWith("running_")
  );
}

function isRunningStageStatus(status) {
  return isRunningStatus(status);
}

function isStagePendingOrRunning(company, stageName) {
  const row = getStage(company, stageName);
  const status = row.status;
  if (status === "running" || status.startsWith("running_")) return true;
  if (status !== "pending") return false;
  if (isStalePending(row)) return false;
  const idx = STAGE_NAMES.indexOf(stageName);
  if (idx <= 0) return true;
  for (let i = 0; i < idx; i++) {
    if (!isStageSettled(company, STAGE_NAMES[i])) return false;
  }
  return true;
}

function isStalePending(stageRow) {
  if (!stageRow || stageRow.status !== "pending") return false;
  const ts = Number(stageRow.updated_at || 0);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return Date.now() - ts * 1000 > STALE_PENDING_MS;
}

function isStageSettled(company, name) {
  const row = getStage(company, name);
  if (isTerminalStatus(row.status)) return true;
  return isStalePending(row);
}

function isOnboardingUxComplete(stages) {
  const s = String(stages?.audience_trends?.status || "")
    .trim()
    .toLowerCase();
  if (s === "done" || s === "completed" || s === "error" || s === "skipped") {
    return true;
  }
  return isPipelineStalled(stages);
}

function isPipelineStalled(stages) {
  const synthesis = normalizeStageRow(stages?.website_synthesis);
  if (!isTerminalStatus(synthesis.status) || synthesis.status === "done") {
    return false;
  }
  const audience = normalizeStageRow(stages?.audience);
  if (audience.status !== "pending") return false;
  const running = STAGE_NAMES.some((name) => {
    const status = normalizeStageRow(stages?.[name]).status;
    return status === "running" || status.startsWith("running_");
  });
  if (running) return false;
  const ts = Number(synthesis.updated_at || 0);
  if (!ts) return true;
  return Date.now() - ts * 1000 > 15000;
}

function isBackgroundPollComplete(stages) {
  const synthesis = normalizeStageRow(stages?.website_synthesis);
  if (!isTerminalStatus(synthesis.status) && !isStalePending(synthesis)) {
    return false;
  }
  if (synthesis.status === "done") {
    for (const name of POST_SYNTHESIS_STAGES) {
      const row = normalizeStageRow(stages?.[name]);
      if (!isTerminalStatus(row.status) && !isStalePending(row)) return false;
    }
  }
  return true;
}

function isPipelineInProgress(stages) {
  return !isBackgroundPollComplete(stages);
}

function isCompanyPipelineActive(company) {
  if (!company) return false;
  return STAGE_NAMES.some((name) => !isStageSettled(company, name));
}

function shouldResumePreBrandOnboarding(company) {
  if (!company) return false;
  ensureCompanyStages(company);
  return (
    isCompanyPipelineActive(company) &&
    !isOnboardingUxComplete(getStages(company))
  );
}

function stagesChanged(prev, next) {
  return STAGE_NAMES.some((n) => {
    const a = prev[n] || {};
    const b = next[n] || {};
    return a.status !== b.status || a.error !== b.error;
  });
}

async function refreshCompanySnapshot(companyId) {
  const fresh = await fetchCompany(companyId);
  if (!fresh) return null;
  replaceCompanyInCache(fresh);
  return companies.find((c) => c.id === companyId) || fresh;
}

async function fetchCompanyStages(companyId) {
  const { ok, status, body } = await api(
    `/api/company/${encodeURIComponent(companyId)}/stages`,
    { method: "GET" },
  );
  if (status === 401) {
    showLogin();
    return null;
  }
  if (!ok || !body || !body.stages) return null;
  return body.stages;
}

function mergeStagesIntoCompany(companyId, stages) {
  const idx = companies.findIndex((c) => c.id === companyId);
  if (idx < 0) return null;
  const company = companies[idx];
  company.stages = stages;
  mirrorStagesToLegacyFields(company, stages);
  companies[idx] = company;
  return company;
}

function stopOnboardingPoll() {
  onboardingCompanyId = "";
}

function clearStagePollTimer() {
  if (stagePollTimer) clearTimeout(stagePollTimer);
  stagePollTimer = null;
}

function scheduleStagePoll(delayMs = STAGE_POLL_INTERVAL_MS) {
  if (!stagePollTargets.size) {
    clearStagePollTimer();
    return;
  }
  if (stagePollTimer) return;
  stagePollTimer = setTimeout(runStagePoll, delayMs);
}

function startStagePolling(companyId, options = {}) {
  if (!companyId) return;
  if (options.onboarding) onboardingCompanyId = companyId;
  stagePollTargets.add(companyId);
  const delayMs = options.delayMs ?? STAGE_POLL_INTERVAL_MS;
  if (delayMs <= 0) {
    void runStagePoll();
  } else {
    scheduleStagePoll(delayMs);
  }
}

function stopStagePolling(companyId) {
  if (!companyId) return;
  stagePollTargets.delete(companyId);
  if (!stagePollTargets.size) stopAllStagePolling();
}

function stopAllStagePolling() {
  stagePollTargets.clear();
  clearStagePollTimer();
  stagePollInFlight = false;
}

function syncStagePollingFromCompanies() {
  for (const c of companies) {
    if (!c?.id) continue;
    ensureCompanyStages(c);
    if (isCompanyPipelineActive(c)) {
      startStagePolling(c.id);
    }
  }
}

async function onStagesUpdated(company, prevStages, nextStages) {
  if (!company || !stagesChanged(prevStages, nextStages)) return;

  const companyId = company.id;
  const current = (await refreshCompanySnapshot(companyId)) || company;
  const onboardingActive =
    companyId === onboardingCompanyId &&
    document.querySelector("#onboarding-screen");

  if (onboardingActive) updateOnboardingScreen(current);

  if (isOnboardingUxComplete(nextStages) && onboardingActive) {
    stopOnboardingPoll();
    hideOnboardingScreen(() => selectBrand(companyId));
  }

  const preBrandOverlay = document.querySelector(".pre-brand-create-overlay");
  if (preBrandOverlay) {
    if (typeof updatePreBrandOverlay === "function") updatePreBrandOverlay(current);
    if (isOnboardingUxComplete(nextStages)) {
      if (typeof completePreBrandTransition === "function") {
        void completePreBrandTransition(companyId);
      }
      return;
    }
  }

  if (currentView === "brands") {
    if (selectedBrandId === companyId) renderBrandDetail(current);
    renderBrandsSidebar();
  }

  if (
    currentView === "ops-brands" &&
    opsBrandsSelectedId === companyId
  ) {
    renderOpsBrandsDetail(current);
  }
}

async function runStagePoll() {
  clearStagePollTimer();
  if (!stagePollTargets.size) return;
  if (stagePollInFlight) {
    scheduleStagePoll();
    return;
  }
  stagePollInFlight = true;
  try {
    const ids = Array.from(stagePollTargets);
    await Promise.all(
      ids.map(async (id) => {
        const stages = await fetchCompanyStages(id);
        if (!stages) return;
        const companyBefore = companies.find((c) => c.id === id);
        const prev = companyBefore ? getStages(companyBefore) : {};
        const company = mergeStagesIntoCompany(id, stages);
        if (company) await onStagesUpdated(company, prev, getStages(company));
        if (company && !isCompanyPipelineActive(company)) {
          stagePollTargets.delete(id);
        }
      }),
    );
  } finally {
    stagePollInFlight = false;
  }
  if (stagePollTargets.size) scheduleStagePoll();
}

async function refreshCompanyStages(companyId) {
  const stages = await fetchCompanyStages(companyId);
  if (!stages) return;
  const companyBefore = companies.find((c) => c.id === companyId);
  const prev = companyBefore ? getStages(companyBefore) : {};
  const company = mergeStagesIntoCompany(companyId, stages);
  if (company) await onStagesUpdated(company, prev, getStages(company));
  if (company && isCompanyPipelineActive(company)) {
    startStagePolling(companyId);
  }
}
