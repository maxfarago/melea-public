(() => {
  "use strict";

  function audienceSidebarAvatar(audience) {
    const url = String(audience?.profile_image_url || "").trim();
    if (url) {
      const img = document.createElement("img");
      img.className = "ops-audience-sidebar-avatar";
      img.src = url;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.onerror = () => {
        const fallback = document.createElement("div");
        fallback.className =
          "ops-audience-sidebar-avatar ops-audience-sidebar-avatar-fallback";
        setText(
          fallback,
          (String(audience.title || "?").trim()[0] || "?").toUpperCase(),
        );
        img.replaceWith(fallback);
      };
      return img;
    }
    const fallback = document.createElement("div");
    fallback.className = "ops-audience-sidebar-avatar ops-audience-sidebar-avatar-fallback";
    setText(
      fallback,
      (String(audience.title || "?").trim()[0] || "?").toUpperCase(),
    );
    return fallback;
  }

  function memberLocation(member) {
    const city = String(member?.city || "").trim();
    const state = String(member?.state || "").trim();
    if (city && state) return `${city}, ${state}`;
    return city || state || "";
  }

  function appendMetricRow(parent, label, value) {
    const text = String(value ?? "").trim();
    if (!text) return;
    const row = document.createElement("div");
    row.className = "ops-audience-metric";
    const left = document.createElement("span");
    left.className = "ops-audience-metric-label";
    setText(left, label);
    const right = document.createElement("span");
    right.className = "ops-audience-metric-value";
    setText(right, text);
    row.appendChild(left);
    row.appendChild(right);
    parent.appendChild(row);
  }

  function appendMetricRow(parent, label, value) {
    const sec = section("X Scraper Account");
    sec.classList.add("ops-audience-member-profile");
    const body = sec.querySelector(".section-body");
    if (!member) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      setText(empty, "No scraper member assigned.");
      body.appendChild(empty);
      return sec;
    }

    const top = document.createElement("div");
    top.className = "ops-audience-member-top";
    const avatarWrap = document.createElement("div");
    avatarWrap.className = "ops-audience-member-avatar-wrap";
    const imageUrl = String(member.profile_image_url || "").trim();
    if (imageUrl) {
      const img = document.createElement("img");
      img.className = "ops-audience-member-avatar";
      img.src = imageUrl;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      avatarWrap.appendChild(img);
    } else {
      const fallback = document.createElement("div");
      fallback.className = "ops-audience-member-avatar ops-audience-member-avatar-fallback";
      const handle = String(member.handle || "").trim();
      setText(fallback, (handle[0] || "?").toUpperCase());
      avatarWrap.appendChild(fallback);
    }
    top.appendChild(avatarWrap);

    const identity = document.createElement("div");
    identity.className = "ops-audience-member-identity";
    const handle = String(member.handle || "").trim();
    const handleEl = document.createElement("div");
    handleEl.className = "ops-audience-member-handle";
    setText(handleEl, handle ? `@${handle.replace(/^@/, "")}` : "—");
    identity.appendChild(handleEl);

    const location = memberLocation(member);
    if (location) {
      const locEl = document.createElement("div");
      locEl.className = "ops-audience-member-location";
      setText(locEl, location);
      identity.appendChild(locEl);
    }

    const email = String(member.email || "").trim();
    if (email) {
      const emailEl = document.createElement("div");
      emailEl.className = "ops-audience-member-email";
      setText(emailEl, email);
      identity.appendChild(emailEl);
    }

    top.appendChild(identity);
    body.appendChild(top);

    const metrics = document.createElement("div");
    metrics.className = "ops-audience-member-metrics";
    appendMetricRow(metrics, "Last scrape", member.last_run_at || "—");
    appendMetricRow(metrics, "Proxy", member.proxy_label || "—");
    appendMetricRow(
      metrics,
      "Auth token",
      member.has_auth_token ? `present ···${member.auth_token_last4 || ""}` : "missing",
    );
    appendMetricRow(
      metrics,
      "ct0",
      member.has_ct0 ? `present ···${member.ct0_last4 || ""}` : "missing",
    );
    appendMetricRow(metrics, "Status", member.active ? "active" : "inactive");
    body.appendChild(metrics);
    return sec;
  }

  function appendMetadataField(parent, label, value) {
    const field = document.createElement("div");
    field.className = "ops-audience-metadata-field";
    const labelEl = document.createElement("div");
    labelEl.className = "ops-audience-metadata-label";
    setText(labelEl, label);
    const valueEl = document.createElement("div");
    valueEl.className = "ops-audience-metadata-value";
    setText(valueEl, value);
    field.appendChild(labelEl);
    field.appendChild(valueEl);
    parent.appendChild(field);
  }

  function buildAudienceMetadataSection(audience) {
    const sec = section("Audience Metadata");
    sec.classList.add("ops-audience-metadata-section");
    const body = sec.querySelector(".section-body");
    appendMetadataField(
      body,
      "Title",
      String(audience.title || "").trim() || "Untitled audience",
    );
    appendMetadataField(
      body,
      "Description",
      String(audience.description || "").trim() || "No description.",
    );
    return sec;
  }

  function renderAudiencesSidebar() {
    const list = $("sidebar-list");
    if (!list) return;
    list.innerHTML = "";
    if (!audiences.length) {
      const empty = document.createElement("div");
      empty.className = "sidebar-empty";
      setText(empty, "No audiences yet.");
      list.appendChild(empty);
      return;
    }
    audiences.forEach((audience) => {
      const row = document.createElement("div");
      row.className = "job-item audience-sidebar-item";
      if (audience.id === selectedAudienceId) row.classList.add("active");
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      row.addEventListener("click", () => void selectAudience(audience.id));
      row.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        void selectAudience(audience.id);
      });
      row.appendChild(audienceSidebarAvatar(audience));
      const body = document.createElement("div");
      body.className = "job-item-body";
      const title = document.createElement("div");
      title.className = "job-name ops-audience-sidebar-title";
      setText(title, String(audience.title || "").trim() || "Untitled audience");
      body.appendChild(title);
      row.appendChild(body);
      list.appendChild(row);
    });
  }

  function renderAudienceDetail(audience) {
    const root = $("detail");
    if (!root) return;
    root.innerHTML = "";
    const inner = document.createElement("div");
    inner.className = "detail-inner audience-detail-inner";

    const top = document.createElement("div");
    top.className = "ops-audience-detail-top";
    top.appendChild(buildMemberProfile(audience.member || null));
    top.appendChild(buildAudienceMetadataSection(audience));
    inner.appendChild(top);
    root.appendChild(inner);
  }

  async function selectAudience(audienceId) {
    selectedAudienceId = audienceId;
    renderAudiencesSidebar();
    const { ok, status, body } = await api(
      `/api/ops/audience/${encodeURIComponent(audienceId)}`,
      { method: "GET" },
    );
    if (status === 401) {
      showLogin();
      return;
    }
    if (!ok || !body?.audience) {
      renderError(apiErrorMessage(body, "Failed to load audience."));
      return;
    }
    renderAudienceDetail(body.audience);
  }

  async function loadAudiences() {
    const { ok, status, body } = await api("/api/ops/audiences", { method: "GET" });
    if (status === 401) {
      showLogin();
      return;
    }
    if (!ok) {
      renderError(apiErrorMessage(body, "Failed to load audiences."));
      return;
    }
    audiences = body?.audiences || [];
    renderAudiencesSidebar();
    if (!audiences.length) {
      renderDetailEmpty("audiences");
      return;
    }
    const nextId =
      selectedAudienceId && audiences.some((row) => row.id === selectedAudienceId)
        ? selectedAudienceId
        : audiences[0].id;
    await selectAudience(nextId);
  }

  Object.assign(window, {
    loadAudiences,
    renderAudiencesSidebar,
    renderAudienceDetail,
    selectAudience,
  });
})();
