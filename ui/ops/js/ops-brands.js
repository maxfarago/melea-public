(function () {
  "use strict";

  let opsBrandsSelectedId = null;

  async function loadOpsCompanies() {
    try {
      const { ok, status, body } = await api("/api/ops/companies", { method: "GET" });
      if (status === 401 || status === 403) {
        showLogin();
        return;
      }
      if (ok && body) {
        companies = body.companies || [];
      }
    } catch (_) {}
  }

  async function submitAddBrand(event) {
    event.preventDefault();
    const input = $("ops-add-brand-input");
    if (!input) return;
    const url = String(input.value || "").trim();
    if (!url) return;
    const { ok, body } = await api("/api/companies", {
      method: "POST",
      body: { website_url: url },
    });
    if (!ok) {
      showToast(apiErrorMessage(body, "Could not add brand."));
      return;
    }
    input.value = "";
    await loadOpsCompanies();
    if (body?.company?.id) {
      opsBrandsSelectedId = body.company.id;
      await selectOpsBrand(body.company.id);
    } else {
      renderOpsBrandsView();
    }
  }

  function renderAddBrandRow(list) {
    const wrap = document.createElement("form");
    wrap.className = "ops-add-brand-form";
    const field = document.createElement("div");
    field.className = "ops-add-brand-field";
    const input = document.createElement("input");
    input.type = "text";
    input.id = "ops-add-brand-input";
    input.className = "ops-add-brand-input";
    input.placeholder = "brand.com";
    const button = document.createElement("button");
    button.type = "submit";
    button.className = "ops-add-brand-btn";
    button.setAttribute("aria-label", "Add brand");
    button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
    field.appendChild(input);
    field.appendChild(button);
    wrap.appendChild(field);
    wrap.addEventListener("submit", submitAddBrand);
    list.appendChild(wrap);
  }

  function renderOpsBrandsView() {
    renderOpsBrandsSidebar();
    if (!opsBrandsSelectedId && companies.length) {
      selectOpsBrand(companies[0].id);
    } else if (opsBrandsSelectedId) {
      const company = companies.find((c) => c.id === opsBrandsSelectedId);
      if (company) renderOpsBrandsDetail(company);
      else renderDetailEmpty("ops-brands");
    } else {
      renderDetailEmpty("ops-brands");
    }
  }

  function renderOpsBrandsSidebar() {
    const list = $("sidebar-list");
    if (!list) return;
    list.innerHTML = "";
    renderAddBrandRow(list);
    if (!companies.length) {
      const empty = document.createElement("div");
      empty.className = "sidebar-empty";
      setText(empty, "No brands yet.");
      list.appendChild(empty);
      return;
    }
    companies.forEach((c) => {
      const btn = document.createElement("div");
      btn.setAttribute("role", "button");
      btn.tabIndex = 0;
      btn.className = "job-item audience-sidebar-item";
      if (c.id === opsBrandsSelectedId) {
        btn.classList.add("active");
        btn.setAttribute("aria-current", "page");
      }

      const logo = sidebarCompanyLogo(c);
      const body = document.createElement("div");
      body.className = "job-item-body";
      const businessName = String(c.business_name || "").trim();
      const domainText = websiteDomain(c.website_url) || c.website_url;
      if (businessName) {
        const nameEl = document.createElement("div");
        nameEl.className = "job-name";
        setText(nameEl, businessName);
        body.appendChild(nameEl);
      }
      const domain = document.createElement("div");
      domain.className = "job-domain";
      setText(domain, domainText);
      body.appendChild(domain);

      btn.appendChild(logo);
      btn.appendChild(body);
      btn.addEventListener("click", () => selectOpsBrand(c.id));
      btn.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        selectOpsBrand(c.id);
      });
      list.appendChild(btn);
    });
  }

  function selectOpsBrand(companyId) {
    opsBrandsSelectedId = companyId;
    renderOpsBrandsSidebar();
    void (async () => {
      const { ok, body } = await api(
        `/api/company/${encodeURIComponent(companyId)}`,
        { method: "GET" },
      );
      if (ok && body && body.company) {
        const idx = companies.findIndex((c) => c.id === companyId);
        if (idx >= 0) companies[idx] = body.company;
        else companies.push(body.company);
        renderOpsBrandsDetail(body.company);
      } else {
        renderDetailEmpty("ops-brands");
      }
    })();
  }

  function renderOpsBrandsDetail(company) {
    const root = $("detail");
    if (!root) return;
    root.innerHTML = "";
    const inner = document.createElement("div");
    inner.className = "detail-inner ops-brands-detail";
    inner.dataset.brandId = company.id;
    root.appendChild(inner);

    const adminSection = document.createElement("div");
    adminSection.className = "brand-customer-ops";
    const aggregateHost = document.createElement("div");
    aggregateHost.id = "brand-aggregate-host";
    aggregateHost.className = "brand-customer-ops-host";
    adminSection.appendChild(aggregateHost);
    inner.appendChild(adminSection);

    loadAndRenderProfileAggregate(company);
  }

  Object.assign(window, {
    loadOpsCompanies,
    renderOpsBrandsView,
    renderOpsBrandsDetail,
    selectOpsBrand,
  });

  Object.defineProperty(window, "opsBrandsSelectedId", {
    configurable: true,
    get() {
      return opsBrandsSelectedId;
    },
    set(value) {
      opsBrandsSelectedId = value;
    },
  });
})();
