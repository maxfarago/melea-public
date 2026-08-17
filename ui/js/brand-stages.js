function getStageStatus(company, name) {
  const row = company?.stages?.[name];
  if (row && typeof row === "object") {
    const status = String(row.status || "").trim().toLowerCase();
    if (status) return status;
  }
  const legacy = {
    website_synthesis: "website_synthesis_status",
    linkedin: "linkedin_status",
    audience: "audience_status",
    audience_match: "audience_match_status",
    brand_synthesis: "brand_synthesis_status",
    audience_trends: "audience_trends_status",
  };
  return String(company?.[legacy[name]] || "idle").trim().toLowerCase() || "idle";
}

function isTerminalStatus(status) {
  const value = String(status || "").trim().toLowerCase();
  return (
    value === "done" ||
    value === "completed" ||
    value === "error" ||
    value === "skipped" ||
    value === "idle"
  );
}

function appendSectionStatusPill(parent, status) {
  const normalized = String(status || "").trim().toLowerCase();
  let cls = "running";
  if (normalized === "done") cls = "done";
  else if (normalized === "error" || normalized === "skipped") cls = "error";
  const pill = document.createElement("span");
  pill.className = "crawl-source-status " + cls;
  parent.appendChild(pill);
  return pill;
}

function attachSectionToggle(titleWrap, body, stateKey) {
  const key = String(stateKey || "");
  const chevron = document.createElement("span");
  chevron.className = "brand-section-chevron";
  chevron.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>';
  titleWrap.prepend(chevron);
  titleWrap.classList.add("is-toggle");
  titleWrap.setAttribute("role", "button");
  titleWrap.tabIndex = 0;
  let open = true;
  try {
    const raw = localStorage.getItem(key);
    if (raw === "0") open = false;
  } catch (_) {}
  body.classList.toggle("hidden", !open);
  chevron.classList.toggle("open", open);
  const toggle = () => {
    open = !open;
    body.classList.toggle("hidden", !open);
    chevron.classList.toggle("open", open);
    try {
      localStorage.setItem(key, open ? "1" : "0");
    } catch (_) {}
  };
  titleWrap.addEventListener("click", toggle);
  titleWrap.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  });
}

function crawlStatusLabel(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "running" || value === "pending") return "running";
  if (value === "done") return "done";
  if (value === "error") return "error";
  if (value === "skipped") return "skipped";
  return "idle";
}

function appendHomepageSynthesisPanel(parent, company, status) {
  const details = document.createElement("details");
  details.className = "crawl-source-panel";
  details.open = true;

  const summary = document.createElement("summary");
  summary.className = "crawl-source-summary";
  const title = document.createElement("span");
  title.className = "crawl-source-title";
  setText(title, "Website summary");
  const statusEl = document.createElement("span");
  statusEl.className = "crawl-source-status " + crawlStatusLabel(status);
  summary.appendChild(title);
  summary.appendChild(statusEl);
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "crawl-source-body";
  const summaryText = String(company?.homepage_summary || "").trim();
  const row = document.createElement("div");
  row.className = "meta-row";
  setText(
    row,
    summaryText || "No website summary generated yet.",
  );
  body.appendChild(row);
  details.appendChild(body);
  parent.appendChild(details);
}
