const DISTRIBUTE_REPLY_DRAFTS_KEY = "melea:distribute-reply-drafts";

function _loadDistributeReplyDrafts() {
  try {
    const raw = sessionStorage.getItem(DISTRIBUTE_REPLY_DRAFTS_KEY);
    if (!raw) return {};
    const data = JSON.parse(raw);
    if (data?.v !== 1 || typeof data.drafts !== "object" || !data.drafts)
      return {};
    return data.drafts;
  } catch (_) {
    return {};
  }
}

function _saveDistributeReplyDrafts(drafts) {
  try {
    if (!drafts || !Object.keys(drafts).length) {
      sessionStorage.removeItem(DISTRIBUTE_REPLY_DRAFTS_KEY);
      return;
    }
    sessionStorage.setItem(
      DISTRIBUTE_REPLY_DRAFTS_KEY,
      JSON.stringify({ v: 1, drafts }),
    );
  } catch (_) {}
}

function distributeReplyDraftHas(key) {
  const k = String(key || "").trim();
  if (!k) return false;
  return Object.prototype.hasOwnProperty.call(_loadDistributeReplyDrafts(), k);
}

function distributeReplyDraftGet(key) {
  const k = String(key || "").trim();
  if (!k) return "";
  return String(_loadDistributeReplyDrafts()[k] || "");
}

function distributeReplyDraftSet(key, text) {
  const k = String(key || "").trim();
  const value = String(text || "").trim();
  if (!k || !value) return;
  const drafts = _loadDistributeReplyDrafts();
  drafts[k] = value;
  _saveDistributeReplyDrafts(drafts);
}

function distributeReplyDraftDelete(key) {
  const k = String(key || "").trim();
  if (!k) return;
  const drafts = _loadDistributeReplyDrafts();
  if (!Object.prototype.hasOwnProperty.call(drafts, k)) return;
  delete drafts[k];
  _saveDistributeReplyDrafts(drafts);
}

function distributeReplyDraftSuffix(postKey) {
  const key = String(postKey || "").trim();
  const idx = key.indexOf(":");
  if (idx < 0) return "";
  return key.slice(idx + 1);
}

function distributeReplyDraftSyncCampaign(campaignId, postKeys) {
  const cid = String(campaignId || "").trim();
  if (!cid) return;
  const drafts = _loadDistributeReplyDrafts();
  let changed = false;
  for (const postKey of postKeys || []) {
    const suffix = distributeReplyDraftSuffix(postKey);
    if (!suffix) continue;
    const draftKey = `${cid}:${suffix}`;
    if (Object.prototype.hasOwnProperty.call(drafts, draftKey)) {
      delete drafts[draftKey];
      changed = true;
    }
  }
  if (changed) _saveDistributeReplyDrafts(drafts);
}
