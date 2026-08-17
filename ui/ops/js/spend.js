(function () {
  "use strict";

  async function pollStatus() {
    try {
      const { ok, body } = await api("/api/ops/status", { method: "GET" });
      if (!ok || !body) return;
      renderTwitterSpend(body.twitter);
      renderAnthropicSpend(body.anthropic);
      renderXaiSpend(body.xai);
      renderWaitlistBadge(body.waitlist_count);
    } catch (_) {}
  }

  function startStatusPolling() {
    pollStatus();
    if (statusPollTimer) clearInterval(statusPollTimer);
    statusPollTimer = setInterval(pollStatus, 60000);
  }

  function renderTwitterSpend(data) {
    const el = $("rail-twitter");
    if (!el) return;
    const amountEl = $("rail-twitter-amount") || el;
    if (
      !data ||
      data.mtd_spend_usd === null ||
      data.mtd_spend_usd === undefined
    ) {
      el.className = "rail-status-text rail-twitter-spend";
      setText(amountEl, "—");
      return;
    }
    const amount = Number(data.mtd_spend_usd);
    el.className = "rail-status-text rail-twitter-spend";
    setText(amountEl, Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "—");
  }

  function renderAnthropicSpend(data) {
    const el = $("rail-anthropic");
    if (!el) return;
    const amountEl = $("rail-anthropic-amount") || el;
    if (
      !data ||
      data.mtd_spend_usd === null ||
      data.mtd_spend_usd === undefined
    ) {
      el.className = "rail-status-text rail-anthropic-spend";
      setText(amountEl, "—");
      return;
    }
    const amount = Number(data.mtd_spend_usd);
    el.className = "rail-status-text rail-anthropic-spend";
    setText(amountEl, Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "—");
  }

  function renderXaiSpend(data) {
    const el = $("rail-xai");
    if (!el) return;
    const amountEl = $("rail-xai-amount") || el;
    if (
      !data ||
      data.mtd_spend_usd === null ||
      data.mtd_spend_usd === undefined
    ) {
      el.className = "rail-status-text rail-xai-spend";
      setText(amountEl, "—");
      return;
    }
    const amount = Number(data.mtd_spend_usd);
    el.className = "rail-status-text rail-xai-spend";
    setText(amountEl, Number.isFinite(amount) ? `$${amount.toFixed(2)}` : "—");
  }

  function renderWaitlistBadge(count) {
    const el = $("waitlist-badge");
    if (!el) return;
    const remoteCount = Number(count || 0);
    if (!Number.isFinite(remoteCount)) {
      waitlistRemoteCount = null;
      el.classList.add("hidden");
      setText(el, "");
      return;
    }
    waitlistRemoteCount = remoteCount;
    if (waitlistStoredCount === null) waitlistStoredCount = remoteCount;
    const value = Math.max(0, remoteCount - waitlistStoredCount);
    if (value <= 0) {
      el.classList.add("hidden");
      setText(el, "");
      return;
    }
    setText(el, value > 99 ? "99+" : String(value));
    el.classList.remove("hidden");
  }

  Object.assign(window, {
    pollStatus,
    startStatusPolling,
    renderTwitterSpend,
    renderAnthropicSpend,
    renderXaiSpend,
    renderWaitlistBadge,
  });
})();
