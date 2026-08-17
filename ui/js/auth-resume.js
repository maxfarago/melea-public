// ============================================================
// oauth return — replay regwall intent after full-page redirect
// ============================================================

function authResumeShell() {
  return window.location.pathname.startsWith("/m") ? "mobile" : "desktop";
}

function desktopCompanyById(companyId) {
  if (!companyId || typeof companies === "undefined") return null;
  return companies.find((row) => String(row.id) === String(companyId)) || null;
}

function mobileCompanyById(companyId) {
  if (!companyId || typeof state === "undefined") return null;
  return (
    state.companies.find((row) => String(row.id) === String(companyId)) || null
  );
}

function desktopStoryById(storyId) {
  if (!storyId) return null;
  const fromFeed =
    typeof storiesCustomerFeed !== "undefined"
      ? storiesCustomerFeed.find(
          (row) =>
            customerStoryId(row) === storyId ||
            String(row.story_id || "") === String(storyId),
        )
      : null;
  if (fromFeed) return fromFeed;
  if (typeof storiesCustomerDetailCache !== "undefined") {
    return storiesCustomerDetailCache.get(storyId) || null;
  }
  return null;
}

function mobileStoryById(storyId, companyId) {
  if (!storyId || typeof state === "undefined") return null;
  const feedKey = companyId || MOBILE_ANONYMOUS_STORIES_KEY;
  const stories = state.storiesFeedCache.get(feedKey) || [];
  return (
    stories.find(
      (row) =>
        customerStoryId(row) === storyId ||
        String(row.story_id || "") === String(storyId),
    ) || null
  );
}

async function resumeDraftPostDesktop(company, intent) {
  if (!company) return false;
  if (intent.via === "studio") {
    if (intent.dashboardRightMode) {
      dashboardRightMode = intent.dashboardRightMode;
    }
    brandHomePendingPostContent = true;
    enterContentGeneration();
    return true;
  }
  if (typeof startDraftPostFlow === "function") {
    startDraftPostFlow(company);
    return true;
  }
  return false;
}

async function resumeDraftPostMobile(company, intent) {
  if (!company) return false;
  if (intent.contentStudioMode) {
    state.contentStudioMode = intent.contentStudioMode;
  } else {
    state.contentStudioMode = "chat";
  }
  if (typeof syncCustomerContentPanel === "function") {
    syncCustomerContentPanel();
  }
  if (typeof startMobileDraftPostFlow === "function") {
    startMobileDraftPostFlow(company);
    return true;
  }
  return false;
}

async function resumeStartCampaignDesktop(company, intent) {
  if (!company) return false;
  const story = desktopStoryById(intent.storyId);
  if (!story) {
    showToast("Couldn't find that story. Try again from the feed.");
    return false;
  }
  if (typeof brandHomeStartCampaignFromStory === "function") {
    await brandHomeStartCampaignFromStory(company, story);
    return true;
  }
  return false;
}

async function resumeStartCampaignMobile(company, intent) {
  const story = mobileStoryById(intent.storyId, intent.companyId);
  if (!story) {
    showToast("Couldn't find that story. Try again from the feed.");
    return false;
  }
  if (typeof mobileStartCampaignFromStory === "function") {
    await mobileStartCampaignFromStory(company, story);
    return true;
  }
  return false;
}

async function dispatchAuthResumeIntent(stash) {
  const intent = stash.intent;
  if (!intent || !intent.action) return false;
  const shell = authResumeShell();
  if (stash.shell !== shell) return false;

  const company =
    shell === "mobile"
      ? mobileCompanyById(intent.companyId)
      : desktopCompanyById(intent.companyId);

  if (intent.action === "draftPost") {
    return shell === "mobile"
      ? resumeDraftPostMobile(company, intent)
      : resumeDraftPostDesktop(company, intent);
  }
  if (intent.action === "startCampaign") {
    return shell === "mobile"
      ? resumeStartCampaignMobile(company, intent)
      : resumeStartCampaignDesktop(company, intent);
  }
  return false;
}

async function resumeAfterAuth() {
  const stash = consumeAuthReturn();
  if (!stash || stash.shell !== authResumeShell()) return false;

  if (stash.mobileTab && typeof setTab === "function") {
    setTab(stash.mobileTab);
  } else if (
    stash.path &&
    typeof isAppShellPath === "function" &&
    isAppShellPath() &&
    typeof applyAppRouteFromPath === "function" &&
    window.location.pathname !== stash.path
  ) {
    await applyAppRouteFromPath(stash.path);
    if (typeof navigateAppRoute === "function") {
      navigateAppRoute(stash.path, { replace: true, skipApply: true });
    }
  }

  if (stash.contentStudioMode && typeof state === "object" && state) {
    state.contentStudioMode = stash.contentStudioMode;
  }

  return dispatchAuthResumeIntent(stash);
}
