(function () {
  "use strict";

  function userBrandLabel(user) {
    const name = String(user?.business_name || "").trim();
    if (name) return name;
    const host = websiteDomain(user?.website_url || "");
    return host || "—";
  }

  function userPlanLabel(plan) {
    const key = String(plan || "")
      .trim()
      .toLowerCase();
    if (key === "pro" || key === "grow") return "Grow";
    if (key === "starter" || key === "rise") return "Rise";
    return key ? key : "—";
  }

  function userStatusLabel(status) {
    const text = String(status || "").trim();
    return text || "—";
  }

  function userPeriodEndLabel(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num) || num <= 0) return "—";
    return new Date(num * 1000).toLocaleString();
  }

  function userDisplayEmail(user) {
    const email = String(user?.email || "").trim();
    if (email) return email;
    return String(user?.clerk_user_id || "").trim() || "this user";
  }

  async function clearUserBrand(user) {
    const clerkUserId = String(user?.clerk_user_id || "").trim();
    if (!clerkUserId || !user?.company_id) return;

    const label = userDisplayEmail(user);
    const brand = userBrandLabel(user);
    const confirmed = await confirmModal({
      title: `Clear brand for ${label}?`,
      body:
        `Removes the link to "${brand}" so the user can go through brand creation again. ` +
        "Profile and subscription data are kept. Campaign history is not deleted.",
      confirmLabel: "Clear brand",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!confirmed) return;

    try {
      const { ok, status, body } = await api(
        `/api/ops/users/${encodeURIComponent(clerkUserId)}/reset-brand`,
        { method: "POST" },
      );
      if (status === 401) {
        showLogin();
        return;
      }
      if (!ok) {
        showToast(apiErrorMessage(body, "Failed to clear brand."));
        return;
      }
      showToast(
        body?.changed ? "Brand cleared." : "User had no brand to clear.",
      );
      await loadUsers();
      renderUsersDetail();
    } catch (err) {
      showToast("Network error: " + err.message);
    }
  }

  async function loadUsers() {
    try {
      const { ok, status, body } = await api("/api/ops/users", {
        method: "GET",
      });
      if (status === 401) {
        showLogin();
        return;
      }
      if (!ok) {
        renderError(apiErrorMessage(body, "Failed to load users."));
        return;
      }
      window.usersData = body.users || [];
    } catch (err) {
      renderError("Network error: " + err.message);
    }
  }

  function renderUsersDetail() {
    const root = $("detail");
    root.innerHTML = "";
    const inner = document.createElement("div");
    inner.className =
      "detail-inner audience-detail-inner waitlist-detail-inner";
    const count = document.createElement("span");
    count.className = "waitlist-count";
    setText(
      count,
      `${window.usersData.length} user${window.usersData.length === 1 ? "" : "s"}`,
    );
    const sec = section("Users", "", count);
    sec.classList.add("waitlist-section");
    const body = sec.querySelector(".section-body");
    if (!window.usersData.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      setText(empty, "No users yet.");
      body.appendChild(empty);
      inner.appendChild(sec);
      root.appendChild(inner);
      return;
    }
    const wrap = document.createElement("div");
    wrap.className = "waitlist-table-wrap";
    const table = document.createElement("table");
    table.className = "waitlist-table";
    table.innerHTML =
      "<thead><tr><th>Signed up</th><th>Email</th><th>Name</th><th>Brand</th><th>Plan</th><th>Status</th><th>Period end</th><th>Stripe customer ID</th></tr></thead>";
    const tbody = document.createElement("tbody");
    window.usersData.forEach((user) => {
      const tr = document.createElement("tr");
      const createdTd = document.createElement("td");
      setText(createdTd, formatEpochTimestamp(user.created_at));
      tr.appendChild(createdTd);
      const emailTd = document.createElement("td");
      setText(emailTd, waitlistField(user.email || user.clerk_user_id));
      tr.appendChild(emailTd);
      const nameTd = document.createElement("td");
      setText(nameTd, waitlistField(user.full_name));
      tr.appendChild(nameTd);
      const brandTd = document.createElement("td");
      brandTd.className = "ops-user-brand-cell";
      const brandText = userBrandLabel(user);
      if (user.company_id && brandText !== "—") {
        const label = document.createElement("span");
        label.className = "ops-user-brand-label";
        setText(label, brandText);
        brandTd.appendChild(label);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ops-user-clear-brand";
        btn.setAttribute("aria-label", `Clear brand ${brandText}`);
        btn.title = "Clear brand";
        setText(btn, "×");
        btn.addEventListener("click", () => {
          void clearUserBrand(user);
        });
        brandTd.appendChild(btn);
      } else {
        setText(brandTd, brandText);
      }
      tr.appendChild(brandTd);
      const planTd = document.createElement("td");
      setText(planTd, userPlanLabel(user.plan));
      tr.appendChild(planTd);
      const statusTd = document.createElement("td");
      setText(statusTd, userStatusLabel(user.subscription_status));
      tr.appendChild(statusTd);
      const periodTd = document.createElement("td");
      setText(periodTd, userPeriodEndLabel(user.current_period_end));
      tr.appendChild(periodTd);
      const stripeTd = document.createElement("td");
      setText(stripeTd, waitlistField(user.stripe_customer_id));
      tr.appendChild(stripeTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    body.appendChild(wrap);
    inner.appendChild(sec);
    root.appendChild(inner);
  }

  Object.assign(window, {
    loadUsers,
    renderUsersDetail,
  });
})();
