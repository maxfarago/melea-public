(function () {
  "use strict";

  async function loadWaitlist() {
    try {
      const { ok, status, body } = await api("/api/ops/waitlist", { method: "GET" });
      if (status === 401) {
        showLogin();
        return;
      }
      if (!ok) {
        renderError(apiErrorMessage(body, "Failed to load waitlist."));
        return;
      }
      waitlistEntries = body.entries || [];
      waitlistStoredCount = waitlistEntries.length;
      renderWaitlistBadge(waitlistRemoteCount ?? waitlistStoredCount);
    } catch (err) {
      renderError("Network error: " + err.message);
    }
  }

  function renderWaitlistDetail() {
    const root = $("detail");
    root.innerHTML = "";
    const inner = document.createElement("div");
    inner.className = "detail-inner audience-detail-inner waitlist-detail-inner";
    const count = document.createElement("span");
    count.className = "waitlist-count";
    setText(
      count,
      `${waitlistEntries.length} entr${waitlistEntries.length === 1 ? "y" : "ies"}`,
    );
    const sec = section("Waitlist entries", "", count);
    sec.classList.add("waitlist-section");
    const body = sec.querySelector(".section-body");
    if (!waitlistEntries.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      setText(empty, "No waitlist entries yet.");
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
      "<thead><tr><th>Created</th><th>Email</th><th>Company website</th><th>X handle</th><th>Other contacts</th></tr></thead>";
    const tbody = document.createElement("tbody");
    waitlistEntries.forEach((entry) => {
      const tr = document.createElement("tr");
      const createdTd = document.createElement("td");
      setText(createdTd, formatEpochTimestamp(entry.created_at));
      tr.appendChild(createdTd);
      const emailTd = document.createElement("td");
      setText(emailTd, waitlistField(entry.email));
      tr.appendChild(emailTd);
      const websiteTd = document.createElement("td");
      const website = String(entry.company_website || "").trim();
      if (website) {
        const link = document.createElement("a");
        link.href = website;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        setText(link, website);
        websiteTd.appendChild(link);
      } else {
        setText(websiteTd, "—");
      }
      tr.appendChild(websiteTd);
      const xTd = document.createElement("td");
      setText(xTd, waitlistField(entry.x_handle));
      tr.appendChild(xTd);
      const contactsTd = document.createElement("td");
      setText(contactsTd, waitlistField(entry.other_contacts));
      tr.appendChild(contactsTd);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    body.appendChild(wrap);
    inner.appendChild(sec);
    root.appendChild(inner);
  }

  Object.assign(window, {
    loadWaitlist,
    renderWaitlistDetail,
  });
})();
