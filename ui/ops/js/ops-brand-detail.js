(function () {
  "use strict";

  async function refreshStage(companyId, path, successMessage) {
    const { ok, body } = await api(path, { method: "POST" });
    if (!ok) {
      showToast(apiErrorMessage(body, "Refresh failed."));
      return false;
    }
    showToast(successMessage);
    await loadOpsCompanies();
    await selectOpsBrand(companyId);
    return true;
  }

  function buildSection(host, company, stageKey, titleText, bodyText, refreshPath) {
    const top = document.createElement("div");
    top.className = "brand-website-head";
    const left = document.createElement("div");
    left.className = "brand-website-title-wrap";
    const title = document.createElement("h3");
    title.className = "brand-website-title";
    setText(title, titleText);
    left.appendChild(title);
    const right = document.createElement("div");
    right.className = "brand-website-head-right";
    appendSectionStatusPill(right, getStageStatus(company, stageKey));
    if (refreshPath) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ops-refresh-btn";
      button.setAttribute("aria-label", "Refresh");
      button.title = "Refresh";
      button.innerHTML =
        '<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><path d="M256 388c-72.597 0-132-59.405-132-132 0-72.601 59.403-132 132-132 36.3 0 69.299 15.4 92.406 39.601L278 234h154V80l-51.698 51.702C348.406 99.798 304.406 80 256 80c-96.797 0-176 79.203-176 176s78.094 176 176 176c81.045 0 148.287-54.134 169.401-128H378.85c-18.745 49.561-67.138 84-122.85 84z"></path></svg>';
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await refreshStage(
            company.id,
            refreshPath,
            `${titleText} refresh started.`,
          );
        } finally {
          button.disabled = false;
        }
      });
      right.appendChild(button);
    }
    top.appendChild(left);
    top.appendChild(right);
    host.appendChild(top);

    const body = document.createElement("div");
    body.className = "brand-website-body";
    const row = document.createElement("div");
    row.className = "meta-row";
    setText(row, bodyText);
    body.appendChild(row);
    attachSectionToggle(left, body, `ops:${company.id}:section:${stageKey}`);
    host.appendChild(body);
  }

  function loadAndRenderProfileAggregate(company) {
    const host = $("brand-aggregate-host");
    if (!host) return;
    host.innerHTML = "";

    const summaryStatus = getStageStatus(company, "website_synthesis");
    const websiteWrap = document.createElement("div");
    websiteWrap.className = "brand-website-body";
    appendHomepageSynthesisPanel(websiteWrap, company, summaryStatus);
    host.appendChild(websiteWrap);

    buildSection(
      host,
      company,
      "linkedin",
      "LinkedIn profile",
      String(company.linkedin_company_url || "No LinkedIn profile discovered yet."),
      `/api/ops/company/${encodeURIComponent(company.id)}/linkedin/refresh`,
    );
    buildSection(
      host,
      company,
      "audience",
      "Audiences",
      `Generated audiences: ${Array.isArray(company.audience) ? company.audience.length : 0}`,
      `/api/ops/company/${encodeURIComponent(company.id)}/audience/refresh`,
    );
    buildSection(
      host,
      company,
      "audience_match",
      "Audience matching",
      "Match generated audiences to internal audience catalog.",
      `/api/ops/company/${encodeURIComponent(company.id)}/audience-match/refresh`,
    );
    buildSection(
      host,
      company,
      "brand_synthesis",
      "Brand synthesis",
      String(company.brand_synthesis || "No synthesis yet."),
      `/api/ops/company/${encodeURIComponent(company.id)}/brand-synthesis/refresh`,
    );
    buildSection(
      host,
      company,
      "audience_trends",
      "Audience trends",
      "Trend join status for matched audiences.",
      `/api/ops/company/${encodeURIComponent(company.id)}/audience-trends/refresh`,
    );
  }

  Object.assign(window, { loadAndRenderProfileAggregate });
})();
