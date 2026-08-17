(function () {
  "use strict";

  window.currentView = "users";
  window.companies = [];
  window.audiences = [];
  window.waitlistEntries = [];
  window.usersData = [];
  window.selectedBrandId = "";
  window.selectedAudienceId = "";
  window.statusPollTimer = null;
  window.waitlistRemoteCount = null;
  window.waitlistStoredCount = null;

  function $(id) {
    return document.getElementById(id);
  }

  function setText(el, text) {
    if (!el) return;
    el.textContent = String(text ?? "");
  }

  function showToast(message) {
    const container = $("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "toast";
    setText(toast, message);
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("toast-visible"));
    setTimeout(() => {
      toast.classList.remove("toast-visible");
      toast.addEventListener("transitionend", () => toast.remove(), { once: true });
    }, 2000);
  }

  function apiErrorMessage(body, fallback) {
    const detail = body?.detail;
    if (typeof detail === "string" && detail.trim()) return detail.trim();
    const error = body?.error;
    if (typeof error === "string" && error.trim()) return error.trim();
    return fallback;
  }

  async function api(path, options = {}) {
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
    try {
      const token = window.Clerk?.session
        ? await window.Clerk.session.getToken()
        : null;
      if (token) headers.Authorization = "Bearer " + token;
    } catch (_) {}
    const req = { credentials: "same-origin", ...options, headers };
    if (req.body && typeof req.body !== "string") req.body = JSON.stringify(req.body);
    const resp = await fetch((window.API_BASE || "") + path, req);
    let body = null;
    try {
      body = await resp.json();
    } catch (_) {}
    return { ok: resp.ok, status: resp.status, body };
  }

  function websiteDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, "");
    } catch (_) {
      return String(url || "").replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    }
  }

  function companyDisplayName(company) {
    return (
      String(company?.business_name || "").trim() ||
      websiteDomain(company?.website_url || "") ||
      "untitled brand"
    );
  }

  function sidebarCompanyLogo(company) {
    const host = websiteDomain(company?.website_url || "");
    const logoUrl = String(company?.logo_url || "").trim();
    if (logoUrl) {
      const img = document.createElement("img");
      img.className = "job-company-logo";
      img.alt = "";
      img.src = logoUrl;
      img.referrerPolicy = "no-referrer";
      img.onerror = () => {
        const fallback = document.createElement("div");
        fallback.className = "job-logo";
        setText(fallback, (host[0] || "?").toUpperCase());
        img.replaceWith(fallback);
      };
      return img;
    }
    const logo = document.createElement("div");
    logo.className = "job-logo";
    setText(logo, (host[0] || "?").toUpperCase());
    return logo;
  }

  function formatEpochTimestamp(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num) || num <= 0) return "—";
    return new Date(num * 1000).toLocaleString();
  }

  function waitlistField(value) {
    const text = String(value || "").trim();
    return text || "—";
  }

  function renderError(message) {
    const detail = $("detail");
    if (!detail) return;
    detail.innerHTML = "";
    const inner = document.createElement("div");
    inner.className = "detail-inner";
    const state = document.createElement("div");
    state.className = "empty-state";
    setText(state, message || "Something went wrong.");
    inner.appendChild(state);
    detail.appendChild(inner);
  }

  function renderDetailEmpty(view) {
    const detail = $("detail");
    if (!detail) return;
    detail.innerHTML = "";
    const inner = document.createElement("div");
    inner.className = "detail-inner";
    const state = document.createElement("div");
    state.className = "empty-state";
    const copy = {
      users: "No users yet.",
      "ops-brands": "Select a brand to inspect.",
      audiences: "Select an audience.",
      waitlist: "No waitlist entries yet.",
    };
    setText(state, copy[view] || "Select an item.");
    inner.appendChild(state);
    detail.appendChild(inner);
  }

  function section(title, bodyHtml, headerAction = null) {
    const sec = document.createElement("div");
    sec.className = "section";
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
    if (bodyHtml) b.innerHTML = bodyHtml;
    sec.appendChild(h);
    sec.appendChild(b);
    return sec;
  }

  function setActiveNav(view) {
    document.querySelectorAll("[data-view]").forEach((btn) => {
      const active = btn.dataset.view === view;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-current", active ? "page" : "false");
    });
  }

  function syncOpsSidebarLayout(view) {
    const workspace = document.querySelector(".workspace");
    if (!workspace) return;
    workspace.classList.toggle(
      "ops-workspace-no-sidebar",
      view === "users" || view === "waitlist",
    );
  }

  async function switchView(view) {
    window.currentView = view;
    setActiveNav(view);
    syncOpsSidebarLayout(view);
    const title = $("sidebar-title");
    if (title && view !== "users" && view !== "waitlist") {
      const titles = {
        audiences: "Audiences",
      };
      setText(title, titles[view] || "Brands");
    }
    if (view === "users") {
      if (typeof loadUsers === "function") await loadUsers();
      if (typeof renderUsersDetail === "function") renderUsersDetail();
      return;
    }
    if (view === "audiences") {
      if (typeof loadAudiences === "function") await loadAudiences();
      if (typeof renderAudiencesSidebar === "function") renderAudiencesSidebar();
      if (typeof renderAudienceDetail === "function" && window.selectedAudienceId) {
        const row = audiences.find((entry) => entry.id === window.selectedAudienceId);
        if (row) renderAudienceDetail(row);
      } else {
        renderDetailEmpty("audiences");
      }
      return;
    }
    if (view === "waitlist") {
      if (typeof loadWaitlist === "function") await loadWaitlist();
      if (typeof renderWaitlistDetail === "function") renderWaitlistDetail();
      return;
    }
    if (typeof loadOpsCompanies === "function") await loadOpsCompanies();
    if (typeof renderOpsBrandsView === "function") renderOpsBrandsView();
  }

  async function showLogin() {
    try {
      await window.Clerk?.redirectToSignIn({ redirectUrl: window.location.href });
    } catch (_) {}
  }

  const FOCUSABLE_SELECTOR =
    'input:not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]';

  function installModalBehavior(overlayEl, onClose) {
    const box = overlayEl.querySelector(".modal-box");
    if (!box) return () => {};

    function onOverlayClick(e) {
      if (e.target === overlayEl && typeof onClose === "function") onClose();
    }
    function onKeydown(e) {
      if (e.key === "Escape" && typeof onClose === "function") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusables = Array.from(box.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    overlayEl.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeydown);
    return () => {
      overlayEl.removeEventListener("click", onOverlayClick);
      document.removeEventListener("keydown", onKeydown);
    };
  }

  function confirmModal(opts) {
    const {
      title = "Are you sure?",
      body = "",
      confirmLabel = "Confirm",
      cancelLabel = "Cancel",
      danger = false,
    } = opts || {};
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");

      const box = document.createElement("div");
      box.className = "modal-box";

      const h2 = document.createElement("h2");
      setText(h2, title);
      box.appendChild(h2);

      if (body) {
        const p = document.createElement("p");
        p.style.color = "var(--text-dim)";
        p.style.fontSize = "14px";
        p.style.margin = "0 0 16px 0";
        setText(p, body);
        box.appendChild(p);
      }

      const actions = document.createElement("div");
      actions.className = "modal-actions";

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      if (danger) confirmBtn.className = "btn-danger";
      setText(confirmBtn, confirmLabel);

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn-secondary";
      setText(cancelBtn, cancelLabel);

      actions.appendChild(confirmBtn);
      actions.appendChild(cancelBtn);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      const previouslyFocused = document.activeElement;
      let teardown = () => {};
      function close(result) {
        teardown();
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (previouslyFocused && typeof previouslyFocused.focus === "function") {
          previouslyFocused.focus();
        }
        resolve(result);
      }
      teardown = installModalBehavior(overlay, () => close(false));
      confirmBtn.addEventListener("click", () => close(true));
      cancelBtn.addEventListener("click", () => close(false));
      setTimeout(() => confirmBtn.focus(), 0);
    });
  }

  Object.assign(window, {
    $,
    setText,
    showToast,
    apiErrorMessage,
    api,
    websiteDomain,
    companyDisplayName,
    sidebarCompanyLogo,
    formatEpochTimestamp,
    waitlistField,
    renderError,
    renderDetailEmpty,
    section,
    switchView,
    showLogin,
    confirmModal,
  });
})();
