"""
melea: trending stories scraper.

scrapes the news, sports, and entertainment tabs of x.com's explore feed and
writes directly to postgres.

auth is account-driven: each run claims the least-recently-run assigned member
from postgres and authenticates by injecting that member's auth_token/ct0 cookies
into a per-account persistent playwright profile. x personalizes explore, so
attribution (`audience_story_sightings`) is the point of the farm — not just
getting past the login wall.

- parse_stories_from_html(html) — pure function, testable against saved snapshots.
- _scrape_live() — playwright driver; navigates, scrolls, drills into stories.
- write_stories_to_db() — normalizes + writes via ingest_news_stories (fuzzy dedup).
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import os
import re
import shutil
import sys
import time
import uuid
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup
from bs4.element import Tag

from api.db.common import _merge_topic_categories

# sibling module; scrape_news.py is run from its own dir (run_news_scraper.sh
# cd's into SCRIPT_DIR), so a plain import resolves. fall back to path-load
# for `python3 -m` style invocations.
try:
    import audience
except ImportError:  # pragma: no cover
    _spec = importlib.util.spec_from_file_location(
        "audience", Path(__file__).resolve().parent / "audience.py"
    )
    audience = importlib.util.module_from_spec(_spec)  # type: ignore[arg-type]
    sys.modules["audience"] = audience
    _spec.loader.exec_module(audience)  # type: ignore[union-attr]


# ============================================================
# config
# ============================================================
# base dir; each account gets its own persistent profile at <base>/<audience_id>
DEFAULT_USER_DATA_DIR = Path.home() / ".melea" / "playwright-x"
# The Explore page with the News feed surfaces at /explore/tabs/news
# but the exact URL has varied; the parser is robust to either.
NEWS_URL = "https://x.com/explore/tabs/news"
# each Explore tab exposes the same trend dom under a different category; news
# alone surfaces ~5 drilled stories per run, so we also sweep sports and
# entertainment to widen coverage without changing the parser.
EXPLORE_TABS: tuple[tuple[str, str], ...] = (
    ("news", NEWS_URL),
    ("sports", "https://x.com/explore/tabs/sports"),
    ("entertainment", "https://x.com/explore/tabs/entertainment"),
)
PAGE_LOAD_TIMEOUT_MS = 60_000
TREND_WAIT_TIMEOUT_MS = 60_000
TREND_TIMEOUT_EXTRA_WAIT_MS = 5_000
TREND_TIMEOUT_RETRY_DELAY_SECONDS = float(os.getenv("TREND_TIMEOUT_RETRY_DELAY_SECONDS", "5"))
SCROLL_PAUSE_MS = 1_000
MAX_SCROLLS = 10
MAX_STORIES_PER_TAB = 5
MAX_STORIES_TOTAL = MAX_STORIES_PER_TAB * len(EXPLORE_TABS)
SOURCE_TAG = "global_trending_scrape"
POSTS_PER_STORY = 10
# shared across every tab; news drills first so it keeps priority on the clock.
DRILLDOWN_BUDGET_SECONDS = 480
PROXY_RETRY_DELAY_SECONDS = float(os.getenv("PROXY_RETRY_DELAY_SECONDS", "5"))
PROXY_ERROR_CLASSES = (
    "ERR_TIMED_OUT",
    "ERR_TUNNEL_CONNECTION_FAILED",
    "ERR_PROXY_CONNECTION_FAILED",
    "ERR_CONNECTION_TIMED_OUT",
)
X_ERROR_SHELL_MARKERS = (
    "something went wrong, but don’t fret",
    "something went wrong, but don't fret",
)
VOLATILE_PROFILE_PATHS = (
    "Default/Cache",
    "Default/Code Cache",
    "Default/GPUCache",
    "Default/Service Worker",
    "Default/Network Persistent State",
    "Default/TransportSecurity",
    "Default/Reporting and NEL",
    "ShaderCache",
    "GrShaderCache",
)


# ============================================================
# data shape
# ============================================================
# Hash invariant: story_id is hashed from the headline as first observed
# in the feed. Once a story is drilled, `headline` may be overwritten with
# the canonical headline_detail (often cleaner). The original feed-headline
# value can be approximately recovered by inverting the hash via lookup,
# but is NOT preserved as a separate column — we treat the drift between
# feed and detail headlines as informational, not load-bearing.
@dataclass
class ScrapedStory:
    headline: str
    topic_category: str
    post_count_raw: str | None
    recency_label: str
    rank_in_feed: int
    topic_categories: list[str] = field(default_factory=list)
    # populated by drill-down only; None for feed-only captures.
    summary: str | None = None
    last_updated_at: str | None = None
    # x's trend/event id off the detail url.
    x_trend_id: str | None = None
    source_url: str | None = None


@dataclass
class StoryPost:
    story: ScrapedStory
    post: Any


class ProxyNavigationError(RuntimeError):
    def __init__(self, error_class: str, message: str):
        super().__init__(message)
        self.error_class = error_class


class TrendLoadTimeoutError(RuntimeError):
    def __init__(self, diagnostics: dict[str, Any]):
        summary = (
            "trend selector timeout "
            f"url={diagnostics.get('url')} "
            f"auth_gate={diagnostics.get('auth_gate_present')} "
            f"trend_after_extra_wait={diagnostics.get('trend_count_after_extra_wait')}"
        )
        super().__init__(summary)
        self.diagnostics = diagnostics


def _proxy_error_class(exc: Exception) -> str | None:
    text = str(exc)
    for error_class in PROXY_ERROR_CLASSES:
        if error_class in text:
            return error_class
    if "Page.goto" in text and "Timeout" in text:
        return "PAGE_GOTO_TIMEOUT"
    return None


def _is_x_error_shell_page(page: Any) -> bool:
    try:
        html = page.content().lower()
    except Exception:
        return False
    return any(marker in html for marker in X_ERROR_SHELL_MARKERS)


def _safe_locator_count(page: Any, selector: str) -> int | None:
    try:
        return page.locator(selector).count()
    except Exception:
        return None


def _collect_trend_timeout_diagnostics(
    page: Any, user_data_dir: Path, exc: Exception
) -> dict[str, Any]:
    diagnostics: dict[str, Any] = {
        "error_type": type(exc).__name__,
        "error_message": str(exc).splitlines()[0],
        "url": page.url,
        "auth_gate_present": False,
        "trend_count_after_extra_wait": None,
        "primary_column_count": _safe_locator_count(page, '[data-testid="primaryColumn"]'),
        "html_path": None,
        "screenshot_path": None,
    }
    if TREND_TIMEOUT_EXTRA_WAIT_MS > 0:
        try:
            page.wait_for_timeout(TREND_TIMEOUT_EXTRA_WAIT_MS)
        except Exception:
            pass
    diagnostics["trend_count_after_extra_wait"] = _safe_locator_count(page, '[data-testid="trend"]')
    login_button_count = _safe_locator_count(page, '[data-testid="loginButton"]') or 0
    login_flow_link_count = _safe_locator_count(page, 'a[href*="/i/flow/login"]') or 0
    diagnostics["auth_gate_present"] = bool(
        "/i/flow/login" in (page.url or "") or login_button_count > 0 or login_flow_link_count > 0
    )
    debug_dir = user_data_dir / "debug"
    debug_dir.mkdir(parents=True, exist_ok=True)
    stamp = f"{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{uuid.uuid4().hex[:8]}"
    html_path = debug_dir / f"trend-timeout-{stamp}.html"
    screenshot_path = debug_dir / f"trend-timeout-{stamp}.png"
    try:
        html_path.write_text(page.content())
        diagnostics["html_path"] = str(html_path)
    except Exception:
        pass
    try:
        page.screenshot(path=str(screenshot_path), full_page=True)
        diagnostics["screenshot_path"] = str(screenshot_path)
    except Exception:
        pass
    return diagnostics


def _log_trend_timeout(
    member: audience.AudienceMember, diagnostics: dict[str, Any], attempt: int
) -> None:
    print(
        "trend timeout "
        f"member={member.id} "
        f"attempt={attempt} "
        f"url={diagnostics.get('url')} "
        f"auth_gate={diagnostics.get('auth_gate_present')} "
        f"trend_after_extra_wait={diagnostics.get('trend_count_after_extra_wait')} "
        f"primary_column={diagnostics.get('primary_column_count')} "
        f"html={diagnostics.get('html_path') or '-'} "
        f"screenshot={diagnostics.get('screenshot_path') or '-'}",
        file=sys.stderr,
    )


def _emit_proxy_deactivation(
    *,
    member: audience.AudienceMember,
    error: ProxyNavigationError,
    retry_delay_seconds: float,
    deactivated_count: int,
) -> None:
    payload = {
        "event": "proxy_deactivated",
        "time_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "proxy_server": member.proxy_server,
        "proxy_label": member.proxy_label,
        "error_class": error.error_class,
        "retry_delay_seconds": retry_delay_seconds,
        "deactivated_count": deactivated_count,
        "member_id": member.id,
        "audience_id": member.audience_id,
        "handle": member.handle,
        "email": member.email,
    }
    print(f"PROXY_DEACTIVATED_JSON={json.dumps(payload, sort_keys=True)}")


def _load_trending_parser() -> tuple[Any, Any]:
    module_path = Path(__file__).resolve().parent.parent / "trending" / "scrape_trending.py"
    spec = importlib.util.spec_from_file_location("_scrape_trending", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"failed to load trending parser from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["_scrape_trending"] = module
    spec.loader.exec_module(module)
    return module.parse_articles_from_html, module.ScrapedPost


parse_articles_from_html, ScrapedPost = _load_trending_parser()


# ============================================================
# pure parser: HTML -> [ScrapedStory]
# verified against /mnt/user-data/uploads/news.html (May 2026)
# ============================================================
# Metadata line for a story cluster: "<recency> · <category> · <N> posts"
# Metadata line for a topic trend: "<category> · Trending"
# We split on " · " (or "·" with surrounding whitespace) and inspect.
_DOT_SEP_RE = re.compile(r"\s*·\s*")
_POSTS_TOKEN_RE = re.compile(r"^\s*([\d.,]+\s*[KMB]?)\s+posts?\s*$", re.IGNORECASE)
# x's news/trend detail urls look like /i/trending/<id> (and sometimes
# /i/events/<id>); the trailing digits are the id the search-by-id api keys on.
_X_TREND_ID_RE = re.compile(r"/i/(?:trending|events)/(\d+)")


def _x_trend_id_from_url(url: str | None) -> str | None:
    if not url:
        return None
    m = _X_TREND_ID_RE.search(url)
    return m.group(1) if m else None


def _classify_trend_metadata(meta_text: str) -> tuple[str, str, str] | None:
    """Given the second 'dir=ltr' line inside a trend element, decide:
    - Is this a story cluster? Return (recency_label, topic_category, post_count_raw)
    - Otherwise (topic trend, malformed, etc.): return None
    """
    parts = _DOT_SEP_RE.split(meta_text.strip())
    parts = [p.strip() for p in parts if p.strip()]
    if len(parts) < 3:
        return None
    recency, category, post_count_raw = parts[0], parts[1], parts[2]
    if not category:
        return None
    if not _POSTS_TOKEN_RE.match(post_count_raw):
        return None
    return recency, category, post_count_raw


def _clean_text(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def _parse_trend(trend: Tag, rank: int, explore_tab: str) -> ScrapedStory | None:
    """Parse a single <div data-testid="trend"> into a ScrapedStory.
    Returns None if the element is not a news story (e.g. a topic trend).
    """
    # Each trend has 2-3 dir='ltr' divs. The first holds the headline (for
    # news stories) or "<category> · Trending" (for topic trends). The
    # second is the metadata line.
    ltr_divs = trend.find_all(attrs={"dir": "ltr"})
    if len(ltr_divs) < 2:
        return None

    headline_text = _clean_text(ltr_divs[0].get_text(" ", strip=True))
    meta_text = _clean_text(ltr_divs[1].get_text(" ", strip=True))

    # Topic-trend rows have the category in the FIRST ltr div (e.g.
    # "Technology · Trending") and the topic in the second ("Claude").
    # Their meta_text won't match the news pattern, so we filter cleanly.
    classified = _classify_trend_metadata(meta_text)
    if classified is None:
        return None
    recency_label, topic_category, post_count_raw = classified

    # best-effort: some news tiles wrap a /i/trending/<id> anchor in the feed,
    # so we can grab the id without drilling. drill-down fills it in otherwise.
    source_url: str | None = None
    x_trend_id: str | None = None
    for anchor in trend.find_all("a", href=True):
        candidate = _x_trend_id_from_url(str(anchor.get("href")))
        if candidate:
            source_url = str(anchor["href"])
            x_trend_id = candidate
            break

    return ScrapedStory(
        headline=headline_text,
        topic_category=topic_category,
        topic_categories=_merge_topic_categories([explore_tab], [topic_category]),
        post_count_raw=post_count_raw,
        recency_label=recency_label,
        rank_in_feed=rank,
        x_trend_id=x_trend_id,
        source_url=source_url,
    )


def parse_stories_from_html(
    html: str,
    max_stories: int = MAX_STORIES_PER_TAB,
    explore_tab: str = "news",
) -> list[ScrapedStory]:
    """Pure parser: extract news stories from a rendered Explore/News DOM."""
    soup = BeautifulSoup(html, "lxml")
    stories: list[ScrapedStory] = []
    seen: set[tuple[str, str]] = set()
    feed_rank = 0
    for trend in soup.select('[data-testid="trend"]'):
        feed_rank += 1
        s = _parse_trend(trend, rank=feed_rank, explore_tab=explore_tab)
        if s is None:
            continue
        key = (s.topic_category.lower(), s.headline.lower())
        if key in seen:
            continue
        stories.append(s)
        seen.add(key)
        if len(stories) >= max_stories:
            break
    return stories


# ============================================================
# detail-page parser
# ============================================================
# The detail page (rendered after clicking into a story) has a header block
# above the article list containing the canonical headline, last-updated
# timestamp, a Grok-generated summary, and a disclaimer. The header block
# has no data-testid; we locate it positionally as the first direct child
# of aria-label="Home timeline" that contains substantive text but no
# cellInnerDiv and no <nav>. Inside that block, X uses four dir-attributed
# divs in a fixed order: headline (dir="auto"), last-updated, summary,
# disclaimer.
def parse_story_detail_from_html(html: str) -> dict[str, str | None]:
    """Pure parser: extract the canonical headline, summary, and
    last_updated_at timestamp from a rendered story-detail DOM.

    Returns a dict with keys headline_detail, summary, last_updated_at.
    Any field we can't find is None — the caller can decide whether to
    treat that as a failure.
    """
    out: dict[str, str | None] = {
        "headline_detail": None,
        "summary": None,
        "last_updated_at": None,
    }
    soup = BeautifulSoup(html, "lxml")
    home_tl = soup.find(attrs={"aria-label": "Home timeline"})
    if home_tl is None:
        return out

    # Find the header block: a direct child of home_tl that contains
    # substantive text but NO cellInnerDiv and is not <nav>.
    header_block: Tag | None = None
    for child in home_tl.children:
        if not getattr(child, "name", None):
            continue
        if child.name == "nav":
            continue
        if child.select_one('[data-testid="cellInnerDiv"]'):
            continue
        text_len = len(child.get_text(" ", strip=True))
        if text_len > 50:  # spacer divs are empty; header has hundreds of chars
            header_block = child
            break
    if header_block is None:
        return out

    # Within the header, X uses dir-attributed divs in a fixed order:
    # [0] headline (dir="auto"), [1] last-updated (dir="ltr", has <time>),
    # [2] summary (dir="ltr", longest text), [3] disclaimer (dir="ltr").
    dir_divs = [
        d
        for d in header_block.find_all(attrs={"dir": True})
        if not any(c.get("dir") for c in d.find_all(attrs={"dir": True}))
    ]

    # Headline: prefer the dir="auto" div; fall back to first dir div.
    for d in dir_divs:
        if d.get("dir") == "auto":
            out["headline_detail"] = _clean_text(d.get_text(" ", strip=True))
            break
    if out["headline_detail"] is None and dir_divs:
        out["headline_detail"] = _clean_text(dir_divs[0].get_text(" ", strip=True))

    # Last updated: the dir div that contains a <time datetime="..."> child.
    for d in dir_divs:
        t = d.find("time")
        if t and t.get("datetime"):
            out["last_updated_at"] = t.get("datetime")
            break

    # Summary: the longest dir="ltr" div that ISN'T the last-updated div
    # and doesn't end with the Grok disclaimer phrase. Length heuristic
    # works because the summary is ~500+ chars and other lines are short.
    DISCLAIMER_MARK = "Grok can make mistakes"
    summary_candidates = []
    for d in dir_divs:
        if d.find("time"):
            continue  # skip the last-updated div
        text = _clean_text(d.get_text(" ", strip=True))
        if not text or DISCLAIMER_MARK in text:
            continue
        if d.get("dir") == "auto":
            continue  # skip the headline div
        summary_candidates.append(text)
    if summary_candidates:
        out["summary"] = max(summary_candidates, key=len)

    return out


# ============================================================
# Playwright driver (SQS-publish only; scraper holds no DB connection)
# ============================================================
def _drill_into_story(page: Any, story: ScrapedStory, max_posts_per_story: int) -> list[Any]:
    """Click into a story tile and extract: (a) detail-page header data
    (canonical headline, Grok summary, last_updated_at) which is mutated
    onto the passed-in `story` object, and (b) up to N Top-tab posts which
    are returned.

    Side-effect on `story`: if the detail header is found, story.headline
    is overwritten with the canonical detail headline (story_id is NOT
    rehashed — see invariant note on ScrapedStory), and story.summary /
    story.last_updated_at are set. Missing fields leave the story's
    existing values untouched.
    """
    posts: list[Any] = []
    try:
        tile = page.locator('[data-testid="trend"]').filter(has_text=story.headline).first
        tile.click(timeout=10_000)
    except Exception:
        return posts

    try:
        page.wait_for_selector('article[data-testid="tweet"]', timeout=10_000)
    except Exception:
        pass

    # the detail url carries x's news/trend id; keep it for a future
    # search-by-id rehydrate. only overwrite when the feed href didn't supply one.
    try:
        detail_url = page.url
        detail_x_trend_id = _x_trend_id_from_url(detail_url)
        if detail_x_trend_id and not story.x_trend_id:
            story.x_trend_id = detail_x_trend_id
            story.source_url = detail_url
    except Exception:
        pass

    for _ in range(MAX_SCROLLS):
        count = page.locator('article[data-testid="tweet"]').count()
        if count >= max_posts_per_story:
            break
        page.mouse.wheel(0, 2500)
        page.wait_for_timeout(SCROLL_PAUSE_MS)

    primary = page.locator('[data-testid="primaryColumn"]').first
    try:
        html = primary.inner_html(timeout=5000)
    except Exception:
        html = page.content()

    # Extract the story-detail header (canonical headline + summary +
    # last_updated_at) and mutate the story object so the SQS payload builder
    # picks up the enriched fields.
    try:
        detail = parse_story_detail_from_html(html)
        if detail.get("headline_detail"):
            story.headline = detail["headline_detail"]  # type: ignore[assignment]
        if detail.get("summary"):
            story.summary = detail["summary"]
        if detail.get("last_updated_at"):
            story.last_updated_at = detail["last_updated_at"]
    except Exception:
        # Detail parse failures are non-fatal; we still return whatever
        # posts we can extract below.
        pass

    try:
        posts = parse_articles_from_html(
            html,
            category=story.topic_category,
            max_posts=max_posts_per_story,
        )
    except Exception:
        return []
    return posts


def _story_dedup_key_headline(headline: str) -> str:
    return re.sub(r"\s+", " ", (headline or "").strip().lower())


def _story_dedup_key(story: ScrapedStory) -> str:
    if story.x_trend_id:
        return f"x:{story.x_trend_id}"
    return f"h:{_story_dedup_key_headline(story.headline)}"


def _merge_parsed_story(
    stories_by_key: dict[str, ScrapedStory],
    drill_source: dict[str, tuple[str, str]],
    story: ScrapedStory,
    explore_tab: str,
    url: str,
) -> bool:
    key = _story_dedup_key(story)
    if key in stories_by_key:
        kept = stories_by_key[key]
        kept.topic_categories = _merge_topic_categories(
            kept.topic_categories,
            story.topic_categories,
        )
        if story.x_trend_id and not kept.x_trend_id:
            kept.x_trend_id = story.x_trend_id
            kept.source_url = story.source_url
        return False
    stories_by_key[key] = story
    drill_source[key] = (explore_tab, url)
    return True


def _load_tab_feed(page: Any, url: str, *, max_stories: int) -> str:
    try:
        page.goto(url, timeout=PAGE_LOAD_TIMEOUT_MS, wait_until="domcontentloaded")
    except Exception as exc:
        error_class = _proxy_error_class(exc)
        if error_class:
            raise ProxyNavigationError(error_class, str(exc)) from exc
        raise
    page.wait_for_selector('[data-testid="trend"]', timeout=PAGE_LOAD_TIMEOUT_MS)

    for _ in range(MAX_SCROLLS):
        count = page.locator('[data-testid="trend"]').count()
        if count >= max_stories:
            break
        page.mouse.wheel(0, 2500)
        page.wait_for_timeout(SCROLL_PAUSE_MS)

    primary = page.locator('[data-testid="primaryColumn"]').first
    try:
        return primary.inner_html(timeout=5000)
    except Exception:
        return page.content()


def _parse_tab_stories(
    page: Any,
    *,
    explore_tab: str,
    url: str,
    max_stories: int,
) -> list[ScrapedStory]:
    """parse story tiles from one Explore tab without drilling."""
    html = _load_tab_feed(page, url, max_stories=max_stories)
    stories = parse_stories_from_html(html, max_stories=max_stories, explore_tab=explore_tab)
    trend_rows_count = page.locator('[data-testid="trend"]').count()
    print(f"Parsed {len(stories)} {explore_tab} stories from {trend_rows_count} trend rows")
    return stories


def _drill_story_queue(
    page: Any,
    *,
    stories_by_key: dict[str, ScrapedStory],
    drill_source: dict[str, tuple[str, str]],
    max_stories: int,
    max_posts_per_story: int,
    drill_deadline: float | None,
    drill_metrics: dict[str, int],
) -> tuple[list[ScrapedStory], list[StoryPost]]:
    persisted_stories: list[ScrapedStory] = []
    story_posts: list[StoryPost] = []
    for key, story in stories_by_key.items():
        if len(persisted_stories) >= max_stories:
            break
        if drill_deadline is not None and time.time() >= drill_deadline:
            drill_metrics["stories_skipped_budget"] += 1
            continue
        _explore_tab, url = drill_source[key]
        drill_metrics["stories_attempted"] += 1
        try:
            page.goto(url, timeout=PAGE_LOAD_TIMEOUT_MS, wait_until="domcontentloaded")
            page.wait_for_selector('[data-testid="trend"]', timeout=PAGE_LOAD_TIMEOUT_MS)
        except Exception:
            break
        posts = _drill_into_story(
            page=page,
            story=story,
            max_posts_per_story=max_posts_per_story,
        )
        if not story.x_trend_id:
            drill_metrics["missing_x_trend_id"] += 1
        if not story.summary:
            drill_metrics["missing_summary"] += 1
        if not (story.x_trend_id and story.summary):
            continue
        if posts:
            drill_metrics["stories_with_posts"] += 1
        persisted_stories.append(story)
        for post in posts:
            story_posts.append(StoryPost(story=story, post=post))
        drill_metrics["posts_collected"] += len(posts)
    unique = len(stories_by_key)
    print(
        f"Drilled {drill_metrics['stories_attempted']} unique stories "
        f"({unique} parsed, {len(persisted_stories)} persisted)",
        file=sys.stderr,
    )
    return persisted_stories, story_posts


def _scrape_live(
    user_data_dir: Path,
    max_stories: int = MAX_STORIES_TOTAL,
    *,
    auth_token: str | None = None,
    ct0: str | None = None,
    proxy: dict | None = None,
    drilldown_posts: bool = False,
    max_posts_per_story: int = POSTS_PER_STORY,
    drilldown_budget_seconds: int = DRILLDOWN_BUDGET_SECONDS,
) -> tuple[list[ScrapedStory], list[str], list[StoryPost], dict[str, int]]:
    """Sweep the Explore tabs and optional story-top posts without touching the DB."""
    from playwright.sync_api import sync_playwright

    launch_kwargs: dict = {
        "headless": True,
        "viewport": {"width": 1280, "height": 900},
    }
    if proxy:
        launch_kwargs["proxy"] = proxy

    def _run_once() -> tuple[list[ScrapedStory], list[str], list[StoryPost], dict[str, int]]:
        _clear_volatile_profile_state(user_data_dir)
        all_stories: list[ScrapedStory] = []
        story_posts: list[StoryPost] = []
        stories_by_key: dict[str, ScrapedStory] = {}
        drill_metrics = {
            "stories_attempted": 0,
            "stories_with_posts": 0,
            "posts_collected": 0,
            "stories_skipped_budget": 0,
            "missing_x_trend_id": 0,
            "missing_summary": 0,
        }
        drill_deadline = (
            time.time() + drilldown_budget_seconds if drilldown_budget_seconds > 0 else None
        )
        ctx = p.chromium.launch_persistent_context(
            str(user_data_dir),
            **launch_kwargs,
        )
        try:
            if auth_token and ct0:
                ctx.add_cookies(
                    [
                        {
                            "name": "auth_token",
                            "value": auth_token,
                            "domain": ".x.com",
                            "path": "/",
                            "httpOnly": True,
                            "secure": True,
                            "sameSite": "None",
                        },
                        {
                            "name": "ct0",
                            "value": ct0,
                            "domain": ".x.com",
                            "path": "/",
                            "httpOnly": False,
                            "secure": True,
                            "sameSite": "None",
                        },
                    ]
                )
            page = ctx.new_page()
            drill_source: dict[str, tuple[str, str]] = {}
            for explore_tab, url in EXPLORE_TABS:
                try:
                    parsed = _parse_tab_stories(
                        page,
                        explore_tab=explore_tab,
                        url=url,
                        max_stories=MAX_STORIES_PER_TAB,
                    )
                except ProxyNavigationError:
                    raise
                except Exception as exc:
                    print(f"tab {explore_tab} failed: {exc!r}", file=sys.stderr)
                    continue
                new_keys = 0
                for story in parsed:
                    if _merge_parsed_story(stories_by_key, drill_source, story, explore_tab, url):
                        new_keys += 1
                print(
                    f"tab {explore_tab}: kept {new_keys} new stories ({len(stories_by_key)} total)",
                    file=sys.stderr,
                )
            if drilldown_posts and stories_by_key:
                all_stories, story_posts = _drill_story_queue(
                    page,
                    stories_by_key=stories_by_key,
                    drill_source=drill_source,
                    max_stories=max_stories,
                    max_posts_per_story=max_posts_per_story,
                    drill_deadline=drill_deadline,
                    drill_metrics=drill_metrics,
                )
        finally:
            ctx.close()
        categories_scraped = sorted({s.topic_category for s in all_stories})
        return all_stories, categories_scraped, story_posts, drill_metrics

    with sync_playwright() as p:
        return _run_once()


def _clear_volatile_profile_state(user_data_dir: Path) -> None:
    for rel_path in VOLATILE_PROFILE_PATHS:
        path = user_data_dir / rel_path
        if not path.exists():
            continue
        try:
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
        except FileNotFoundError:
            pass


def write_stories_to_db(
    stories: list[ScrapedStory],
    story_posts: list[StoryPost],
    capture_id: str,
    captured_at: str,
    source: str = SOURCE_TAG,
    *,
    audience_id: str | None = None,
    audience_member_id: str | None = None,
) -> tuple[int, int]:
    """write scraped stories + posts to postgres. returns new and updated counts."""
    from api.db.sqlite import Database
    from api.consumers.twitter_news import ingest_news_stories

    async def _write() -> tuple[int, int]:
        _db = Database()
        await _db.init()
        try:
            return await ingest_news_stories(
                _db,
                stories,
                story_posts,
                capture_id=capture_id,
                captured_at=captured_at,
                source=source,
                audience_id=audience_id,
                audience_member_id=audience_member_id,
            )
        finally:
            await _db.close()

    return asyncio.run(_write())


# ============================================================
# CLI
# ============================================================
def _run_member(args: argparse.Namespace, member: audience.AudienceMember) -> None:
    proxy = None if args.no_proxy else member.proxy_playwright_dict()
    if proxy is None and not args.no_proxy:
        raise SystemExit(
            f"member {member.id} ({member.email}) has no proxy configured; "
            "provision proxy fields via manage_audience_members.py or pass --no-proxy for local runs"
        )

    profile_dir = Path(args.user_data_dir) / member.id
    profile_dir.mkdir(parents=True, exist_ok=True)
    print(
        f"selected member {member.id} audience={member.audience_id} ({member.email}) "
        f"proxy={member.proxy_label or member.proxy_server or 'none'} "
        f"last_run={member.last_run_at or 'never'} profile={profile_dir}",
        file=sys.stderr,
    )

    capture_id = args.capture_id or str(uuid.uuid4())
    captured_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    t0 = time.time()
    stories, cats, story_posts, drill_metrics = _scrape_live(
        user_data_dir=profile_dir,
        max_stories=args.max_stories,
        auth_token=member.auth_token,
        ct0=member.ct0,
        proxy=proxy,
        drilldown_posts=True,
        max_posts_per_story=POSTS_PER_STORY,
        drilldown_budget_seconds=DRILLDOWN_BUDGET_SECONDS,
    )
    skip_summary = {
        "missing_x_trend_id": drill_metrics.get("missing_x_trend_id", 0),
        "missing_summary": drill_metrics.get("missing_summary", 0),
        "budget_skips": drill_metrics.get("stories_skipped_budget", 0),
        "persisted": len(stories),
    }
    print(f"STORIES_SKIPPED_JSON={json.dumps(skip_summary)}")
    sent_new, sent_updated = write_stories_to_db(
        stories,
        story_posts,
        capture_id,
        captured_at,
        audience_id=member.audience_id,
        audience_member_id=member.id,
    )
    audience.mark_run_in_db(member.id)
    print(
        f"Done in {time.time() - t0:.1f}s: wrote {sent_new} new + {sent_updated} updated stories "
        f"across {len(cats)} topic categories capture_id={capture_id}"
    )
    print(
        "Drill-down metrics: "
        f"attempted={drill_metrics['stories_attempted']} "
        f"stories_with_posts={drill_metrics['stories_with_posts']} "
        f"posts_collected={drill_metrics['posts_collected']} "
        f"budget_skips={drill_metrics['stories_skipped_budget']}"
    )


def main():
    ap = argparse.ArgumentParser(
        description="Scrape x.com News stories and write to postgres"
    )
    ap.add_argument(
        "--user-data-dir",
        default=str(DEFAULT_USER_DATA_DIR),
        help="Base profile dir; a per-account subdir <member_id> is created under it",
    )
    ap.add_argument("--max-stories", type=int, default=MAX_STORIES_TOTAL)
    ap.add_argument(
        "--no-proxy",
        action="store_true",
        help="Skip proxy (local testing; scrapes direct from host IP)",
    )
    ap.add_argument(
        "--capture-id",
        default="",
        help="Optional capture id override",
    )
    ap.add_argument(
        "--parse-only",
        metavar="HTML_FILE",
        help="Parse a saved HTML snapshot and print stories. Offline; no DB.",
    )
    args = ap.parse_args()

    if args.parse_only:
        html = Path(args.parse_only).read_text()
        stories = parse_stories_from_html(html, max_stories=args.max_stories)
        for s in stories:
            print(json.dumps(asdict(s), default=str, indent=2))
        print(f"\n{len(stories)} stories parsed from {args.parse_only}")
        return

    if not os.getenv("DATABASE_URL", "").strip():
        raise SystemExit("DATABASE_URL env var is required")

    attempted_member_ids: set[str] = set()
    while True:
        member = audience.claim_member_from_db(
            exclude_member_ids=attempted_member_ids,
        )
        if member is None:
            status = audience.query_member_pool_status(
                exclude_member_ids=attempted_member_ids,
            )
            reason = (
                "pool_empty"
                if status["total_assigned"] == 0
                else "all_inactive"
                if status["total_active"] == 0
                else "all_in_cooldown"
            )
            print(
                f"no eligible member, skipping reason={reason} "
                f"assigned={status['total_assigned']} "
                f"active={status['total_active']} "
                f"eligible_now={status['total_eligible_now']}",
                file=sys.stderr,
            )
            return

        attempted_member_ids.add(member.id)
        try:
            _run_member(args, member)
            return
        except ProxyNavigationError as exc:
            if args.no_proxy or not member.proxy_server:
                raise
            proxy_name = member.proxy_label or member.proxy_server
            print(
                f"proxy failure {exc.error_class} for {proxy_name} "
                f"member={member.id} attempt=1 retrying_in={PROXY_RETRY_DELAY_SECONDS:g}s",
                file=sys.stderr,
            )
            if PROXY_RETRY_DELAY_SECONDS > 0:
                time.sleep(PROXY_RETRY_DELAY_SECONDS)
            try:
                _run_member(args, member)
                print(
                    f"proxy retry succeeded for {proxy_name} member={member.id}",
                    file=sys.stderr,
                )
                return
            except ProxyNavigationError as retry_exc:
                if retry_exc.error_class != exc.error_class:
                    print(
                        f"proxy retry changed error for {proxy_name} member={member.id} "
                        f"first={exc.error_class} retry={retry_exc.error_class}",
                        file=sys.stderr,
                    )
                    raise
                deactivated = audience.deactivate_proxy_members(
                    member.proxy_server,
                )
                _emit_proxy_deactivation(
                    member=member,
                    error=retry_exc,
                    retry_delay_seconds=PROXY_RETRY_DELAY_SECONDS,
                    deactivated_count=deactivated,
                )
                print(
                    f"deactivated {deactivated} audience members with proxy={proxy_name} "
                    f"after repeated {retry_exc.error_class}",
                    file=sys.stderr,
                )
        except TrendLoadTimeoutError as exc:
            _log_trend_timeout(member, exc.diagnostics, attempt=1)
            if TREND_TIMEOUT_RETRY_DELAY_SECONDS > 0:
                time.sleep(TREND_TIMEOUT_RETRY_DELAY_SECONDS)
            try:
                _run_member(args, member)
                print(
                    f"trend timeout retry succeeded for member={member.id}",
                    file=sys.stderr,
                )
                return
            except TrendLoadTimeoutError as retry_exc:
                _log_trend_timeout(member, retry_exc.diagnostics, attempt=2)
                print(
                    f"trend timeout repeated for member={member.id}; rotating_to_next_member=1",
                    file=sys.stderr,
                )
                continue


if __name__ == "__main__":
    main()
