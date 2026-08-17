"""news story processing: normalization, fuzzy dedup, and DB writes.

used both by the direct scraper path (scrape_news.py calls ingest_news_stories)
and by the legacy SQS consumer path (if trends_news_sqs_queue_url is configured).
"""

from __future__ import annotations

import asyncio
import difflib
import json
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from api.db.sqlite import db
from api.features.story_relevance import score_story_against_all_brands
from commons.config import settings
from llm.embeddings import (
    cosine,
    embed_texts_batched,
    has_embedding_config,
    normalize_vector,
)

log = logging.getLogger(__name__)

# ============================================================
# transform helpers (pure functions)
# ============================================================
_METRIC_SUFFIX = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}


def _parse_metric(raw: str | None) -> int:
    """'1.3K' -> 1300, '199' -> 199, '2.5M' -> 2500000."""
    if not raw:
        return 0
    s = raw.strip().lower().replace(",", "")
    s = re.sub(r"\s+(posts?|tweets?)$", "", s)
    if not s:
        return 0
    m = re.match(r"^(\d+(?:\.\d+)?)\s*([kmb])?$", s)
    if not m:
        try:
            return int(float(s))
        except ValueError:
            return 0
    num = float(m.group(1))
    suffix = m.group(2)
    if suffix:
        num *= _METRIC_SUFFIX[suffix]
    return int(num)


_RECENCY_AGO_RE = re.compile(r"^\s*(\d+)\s+(minute|hour|day|week)s?\s+ago\s*$", re.IGNORECASE)


def _parse_recency_to_iso(recency_label: str, now: datetime) -> str | None:
    """'18 hours ago' -> ISO 8601 string, None for non-parseable labels."""
    m = _RECENCY_AGO_RE.match(recency_label)
    if not m:
        return None
    n = int(m.group(1))
    unit = m.group(2).lower()
    delta = {
        "minute": timedelta(minutes=n),
        "hour": timedelta(hours=n),
        "day": timedelta(days=n),
        "week": timedelta(weeks=n),
    }[unit]
    return (now - delta).isoformat(timespec="seconds").replace("+00:00", "Z")


# ============================================================
# fuzzy headline matching via haiku
# ============================================================
_FUZZY_WINDOW_HOURS = 72
_FUZZY_MODEL = "claude-haiku-4-5"
_STORY_ID_NAMESPACE = uuid.UUID("4eebf51f-c7f1-4a02-9c2a-12f2803265ea")
_AUTO_DEDUPE_SIMILARITY = 0.90
# low floor on purpose: same-event headlines worded differently (e.g.
# "Google upgrades NotebookLM" vs "NotebookLM gets a major upgrade") land
# around 0.30, while unrelated stories sit near 0.10. haiku is the precision
# gate — this floor only decides which candidates it gets to judge.
_ASK_HAIKU_SIMILARITY = 0.25
_MAX_HAIKU_CANDIDATES = 8
# middle tier: openai embedding cosine sits between the lexical floor and haiku.
# embeddings catch same-event/different-wording pairs the token blend misses.
# a near-identical cosine is a confident merge with no llm call; only clearly
# unrelated pairs are dropped before haiku — haiku stays the precision gate, so
# the floor errs low to avoid suppressing it. measured on real story headlines
# (text-embedding-3-small, scripts/validate_dedupe.py): same-event 0.65-0.93,
# related-but-different ~0.50, unrelated <0.15.
_COSINE_AUTO_MERGE = 0.93
_COSINE_HAIKU_FLOOR = 0.50
_TOKEN_RE = re.compile(r"[a-z0-9]+")

_haiku_client: Any = None
StoryResolution = tuple[str, dict[str, Any] | None]


def _get_haiku_client() -> Any:
    global _haiku_client
    if _haiku_client is None:
        import anthropic

        _haiku_client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _haiku_client


def _normalize_story_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()


def _story_tokens(value: str) -> set[str]:
    return set(_TOKEN_RE.findall(_normalize_story_text(value)))


def _jaccard(left: set[str], right: set[str]) -> float:
    if not left and not right:
        return 1.0
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def _overlap(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0
    return len(left & right) / min(len(left), len(right))


def _story_similarity(left: str, right: str) -> float:
    left_norm = _normalize_story_text(left)
    right_norm = _normalize_story_text(right)
    if left_norm == right_norm:
        return 1.0
    left_tokens = _story_tokens(left_norm)
    right_tokens = _story_tokens(right_norm)
    sequence_score = difflib.SequenceMatcher(None, left_norm, right_norm).ratio()
    token_score = _jaccard(left_tokens, right_tokens)
    overlap_score = _overlap(left_tokens, right_tokens)
    return (sequence_score * 0.45) + (token_score * 0.40) + (overlap_score * 0.15)


def _story_key(headline: str, topic_category: str) -> tuple[str, str]:
    return (
        _normalize_story_text(topic_category),
        _normalize_story_text(headline),
    )


def _deterministic_story_id(headline: str, topic_category: str) -> str:
    category_key, headline_key = _story_key(headline, topic_category)
    return str(uuid.uuid5(_STORY_ID_NAMESPACE, f"{category_key}\n{headline_key}"))


def _exact_match_story_id(
    headline: str,
    topic_category: str,
    candidates: list[dict[str, Any]],
) -> str | None:
    target = _story_key(headline, topic_category)
    for candidate in candidates:
        candidate_category = str(candidate.get("topic_category") or topic_category)
        if _story_key(str(candidate.get("headline") or ""), candidate_category) == target:
            return str(candidate["story_id"])
    return None


def _rank_story_candidates(
    headline: str,
    topic_category: str,
    candidates: list[dict[str, Any]],
    *,
    same_category_only: bool = True,
) -> list[dict[str, Any]]:
    ranked: list[dict[str, Any]] = []
    category_key = _normalize_story_text(topic_category)
    for candidate in candidates:
        candidate_headline = str(candidate.get("headline") or "")
        candidate_category = str(candidate.get("topic_category") or topic_category)
        if same_category_only and _normalize_story_text(candidate_category) != category_key:
            continue
        item = dict(candidate)
        item["_similarity_score"] = _story_similarity(headline, candidate_headline)
        ranked.append(item)
    return sorted(
        ranked,
        key=lambda c: (
            float(c.get("_similarity_score") or 0.0),
            str(c.get("headline") or ""),
        ),
        reverse=True,
    )


def _strip_markdown_json(raw: str) -> str:
    value = raw.strip()
    if value.startswith("```json"):
        value = value.removeprefix("```json").strip()
    elif value.startswith("```"):
        value = value.removeprefix("```").strip()
    if value.endswith("```"):
        value = value.removesuffix("```").strip()
    return value


def _parse_fuzzy_match_index(raw: str) -> int | None:
    value = _strip_markdown_json(raw)
    if re.fullmatch(r"-?\d+", value):
        return int(value)
    try:
        payload = json.loads(value)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    idx = payload.get("match_index")
    if isinstance(idx, int):
        return idx
    if isinstance(idx, str) and re.fullmatch(r"-?\d+", idx.strip()):
        return int(idx.strip())
    return None


async def _fuzzy_match_story_id(
    headline: str,
    candidates: list[dict[str, Any]],
) -> str | None:
    if not candidates:
        return None
    numbered = "\n".join(
        f"{i}. {c['headline']} (similarity={float(c.get('_similarity_score') or 0.0):.2f})"
        for i, c in enumerate(candidates)
    )
    prompt = (
        f"Incoming headline:\n{headline}\n\n"
        f"Existing headlines:\n{numbered}\n\n"
        "Do any of the existing headlines refer to the same news story as the "
        "incoming headline? Reply only as compact JSON: "
        '{"match_index": <number>}. Use -1 when none match.'
    )
    try:
        resp = await _get_haiku_client().messages.create(
            model=_FUZZY_MODEL,
            max_tokens=32,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = resp.content[0].text.strip()
    except Exception as e:
        log.warning("fuzzy_match haiku call failed: %r", e)
        return None
    idx = _parse_fuzzy_match_index(raw)
    if idx is None:
        log.warning(
            "fuzzy_match bad_response candidate_count=%d raw=%r",
            len(candidates),
            raw[:200],
        )
        return None
    if idx < 0 or idx >= len(candidates):
        return None
    matched = candidates[idx]
    log.debug("fuzzy_match incoming=%r matched=%r", headline, matched["headline"])
    return matched["story_id"]


async def _cosine_filter_candidates(
    headline: str,
    candidates: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """middle dedup tier: embed the incoming headline + candidate headlines and
    score by cosine. returns (auto_merge_candidate, candidates_for_haiku).

    a near-identical cosine auto-merges without asking haiku; candidates below
    the floor are dropped so haiku only judges the ambiguous middle. degrades to
    the lexical candidates untouched when embeddings are unconfigured or fail —
    the haiku tier still runs.
    """
    if not candidates or not has_embedding_config():
        return None, candidates
    try:
        texts = [headline] + [str(c.get("headline") or "") for c in candidates]
        vectors = await embed_texts_batched(texts)
    except Exception:
        log.exception("cosine dedup embed failed; falling back to lexical candidates")
        return None, candidates
    base = normalize_vector(vectors[0]) if vectors else []
    if not base:
        return None, candidates
    scored: list[dict[str, Any]] = []
    for candidate, vector in zip(candidates, vectors[1:]):
        item = dict(candidate)
        item["_cosine_score"] = cosine(base, normalize_vector(vector))
        scored.append(item)
    scored.sort(key=lambda c: float(c.get("_cosine_score") or 0.0), reverse=True)
    if scored and float(scored[0].get("_cosine_score") or 0.0) >= _COSINE_AUTO_MERGE:
        return scored[0], []
    survivors = [c for c in scored if float(c.get("_cosine_score") or 0.0) >= _COSINE_HAIKU_FLOOR]
    return None, survivors


def _resolution_meta(method: str, candidate: dict[str, Any]) -> dict[str, Any]:
    return {
        "method": method,
        "matched_headline": str(candidate.get("headline") or ""),
        "lexical_score": candidate.get("_similarity_score"),
        "cosine_score": candidate.get("_cosine_score"),
    }


async def _record_story_alias(
    db_instance: Any,
    *,
    story_id: str,
    headline: str,
    x_trend_id: str | None,
    capture_id: str | None,
    resolution: dict[str, Any] | None,
) -> None:
    if not resolution or not hasattr(db_instance, "insert_story_alias"):
        return
    matched_headline = str(resolution.get("matched_headline") or "")
    if _normalize_story_text(headline) == _normalize_story_text(matched_headline):
        return
    try:
        await db_instance.insert_story_alias(
            story_id=story_id,
            headline=headline,
            x_trend_id=x_trend_id,
            method=str(resolution["method"]),
            lexical_score=resolution.get("lexical_score"),
            cosine_score=resolution.get("cosine_score"),
            capture_id=capture_id,
        )
    except Exception:
        log.exception("story alias write failed story_id=%s", story_id)


async def _resolve_story_id(
    headline: str,
    topic_category: str,
    *,
    db_instance: Any = None,
    x_trend_id: str | None = None,
) -> StoryResolution:
    """Return a matched existing story_id, or a stable id for an unmatched story."""
    _db = db_instance if db_instance is not None else db
    if hasattr(_db, "get_story_by_x_trend_id"):
        matched_by_x_trend_id = await _db.get_story_by_x_trend_id(x_trend_id)
        if matched_by_x_trend_id:
            return str(matched_by_x_trend_id["story_id"]), _resolution_meta(
                "x_trend_id",
                matched_by_x_trend_id,
            )
    if hasattr(_db, "get_story_by_exact_headline"):
        exact = await _db.get_story_by_exact_headline(headline, topic_category)
        if exact:
            return str(exact), None
    same_category = await _db.get_recent_stories_by_category(
        topic_category, since_hours=_FUZZY_WINDOW_HOURS
    )
    exact = _exact_match_story_id(headline, topic_category, same_category)
    if exact:
        return exact, None
    # a strong lexical match inside the same category is a safe auto-merge.
    ranked_same = _rank_story_candidates(headline, topic_category, same_category)
    if (
        ranked_same
        and float(ranked_same[0].get("_similarity_score") or 0.0) >= _AUTO_DEDUPE_SIMILARITY
    ):
        return str(ranked_same[0]["story_id"]), _resolution_meta("lexical", ranked_same[0])
    # the same event often resurfaces with different wording — and, across persona
    # feeds, under a different trending category — so let haiku adjudicate the
    # closest recent headlines regardless of category.
    recent = (
        await _db.get_recent_stories(since_hours=_FUZZY_WINDOW_HOURS)
        if hasattr(_db, "get_recent_stories")
        else same_category
    )
    ranked = _rank_story_candidates(headline, topic_category, recent, same_category_only=False)
    lexical_candidates = [
        c for c in ranked if float(c.get("_similarity_score") or 0.0) >= _ASK_HAIKU_SIMILARITY
    ][:_MAX_HAIKU_CANDIDATES]
    # tier 2: embedding cosine auto-merges the obvious dups and narrows the set
    # haiku has to judge. tier 3: haiku adjudicates whatever survives.
    cosine_match, haiku_candidates = await _cosine_filter_candidates(headline, lexical_candidates)
    if cosine_match is not None:
        return str(cosine_match["story_id"]), _resolution_meta("cosine", cosine_match)
    matched = await _fuzzy_match_story_id(headline, haiku_candidates) if haiku_candidates else None
    if matched is not None:
        matched_candidate = next(
            (c for c in haiku_candidates if str(c.get("story_id")) == str(matched)),
            None,
        )
        if matched_candidate is not None:
            return str(matched), _resolution_meta("haiku", matched_candidate)
        return str(matched), None
    return _deterministic_story_id(headline, topic_category), None


# ============================================================
# shared DB write path
# ============================================================
async def _write_story_to_db(
    db_instance: Any,
    normalized: dict[str, Any],
) -> tuple[bool, int]:
    """Upsert one story + its linked posts. Returns (story_inserted, posts_count)."""
    try:
        inserted = await db_instance.ingest_trending_story(normalized)
    except Exception:
        log.exception("db ingest failed story_id=%s", normalized.get("story_id"))
        return False, 0

    ingested_posts = 0
    for post_payload in normalized.get("linked_posts") or []:
        try:
            if await db_instance.ingest_trending_post(post_payload):
                ingested_posts += 1
        except Exception:
            log.exception(
                "linked_post ingest failed story_id=%s post_id=%s",
                normalized.get("story_id"),
                post_payload.get("post_id"),
            )

    if hasattr(db_instance, "get_story_for_embedding"):
        try:
            await score_story_against_all_brands(
                str(normalized["story_id"]),
                db_instance=db_instance,
            )
        except Exception:
            log.exception("story relevance scoring failed story_id=%s", normalized.get("story_id"))

    if inserted:
        log.info(
            "news_story_ingested capture_id=%s story_id=%s topic_category=%s linked_posts=%d",
            normalized["capture_id"],
            normalized["story_id"],
            normalized["topic_category"],
            ingested_posts,
        )
    else:
        log.debug(
            "news_story_duplicate capture_id=%s story_id=%s",
            normalized["capture_id"],
            normalized["story_id"],
        )
    return inserted, ingested_posts


# ============================================================
# direct ingestion entry point (used by scrape_news.py)
# ============================================================
async def ingest_news_stories(
    db_instance: Any,
    stories: list[Any],  # list[ScrapedStory] — typed as Any to avoid circular import
    story_posts: list[Any],  # list[StoryPost]
    *,
    capture_id: str,
    captured_at: str,
    source: str,
    audience_id: str | None = None,
    audience_member_id: str | None = None,
) -> tuple[int, int]:
    """write scraped stories + posts directly to db. returns new and updated counts.

    When audience_id is set (the scraper claims an assigned member), each story
    is also attributed to that audience via audience_story_sightings.
    """
    now = datetime.now(timezone.utc)

    # index posts by story headline for O(1) lookup
    posts_by_headline: dict[str, list[Any]] = {}
    for sp in story_posts:
        posts_by_headline.setdefault(sp.story.headline.lower(), []).append(sp.post)

    # within-run dedup: fuzzy matching can collapse two feed entries onto one
    # story_id; process each resolved story once. (replaces the dropped capture
    # junction guard.)
    seen_story_ids: set[str] = set()
    seen_post_ids: set[str] = set()

    new = 0
    updated = 0
    for story in stories:
        post_count = _parse_metric(story.post_count_raw)
        approx_started_at = _parse_recency_to_iso(story.recency_label, now)
        x_trend_id = getattr(story, "x_trend_id", None)
        topic_categories = getattr(story, "topic_categories", None)
        if not isinstance(topic_categories, list):
            topic_categories = []

        story_id, resolution = await _resolve_story_id(
            story.headline,
            story.topic_category,
            db_instance=db_instance,
            x_trend_id=x_trend_id,
        )
        if story_id in seen_story_ids:
            await _record_story_alias(
                db_instance,
                story_id=story_id,
                headline=story.headline,
                x_trend_id=x_trend_id,
                capture_id=capture_id,
                resolution=resolution,
            )
            continue
        seen_story_ids.add(story_id)

        linked_posts: list[dict[str, Any]] = []
        for post in posts_by_headline.get(story.headline.lower(), []):
            author_handle = str(post.author_handle or "").strip()
            if author_handle and not author_handle.startswith("@"):
                author_handle = f"@{author_handle.lstrip('@')}"
            if not post.post_id or not post.url or not post.text or not author_handle:
                continue
            if post.post_id in seen_post_ids:
                continue
            seen_post_ids.add(post.post_id)
            media_urls = post.media_urls if isinstance(post.media_urls, list) else []
            linked_posts.append(
                {
                    "story_id": story_id,
                    "capture_id": capture_id,
                    "source": source,
                    "post_id": post.post_id,
                    "url": post.url,
                    "category": post.category or story.topic_category,
                    "subcategory": getattr(post, "subcategory", None) or story.headline,
                    "rank_in_category": int(post.rank_in_category or 0),
                    "author_handle": author_handle,
                    "author_name": post.author_name,
                    "author_avatar": post.author_avatar,
                    "author_verified": bool(post.author_verified),
                    "text": post.text,
                    "posted_at": post.posted_at,
                    "media_urls": media_urls,
                    "likes": int(post.likes or 0),
                    "retweets": int(post.retweets or 0),
                    "replies": int(post.replies or 0),
                    "views": int(post.views or 0),
                }
            )

        normalized: dict[str, Any] = {
            "capture_id": capture_id,
            "captured_at": captured_at,
            "source": source,
            "story_id": story_id,
            "headline": story.headline,
            "topic_category": story.topic_category,
            "topic_categories": topic_categories,
            "post_count": post_count,
            "post_count_raw": story.post_count_raw,
            "recency_label": story.recency_label,
            "approx_started_at": approx_started_at,
            "rank_in_feed": story.rank_in_feed,
            "summary": story.summary,
            "last_updated_at": story.last_updated_at,
            "x_trend_id": x_trend_id,
            "source_url": getattr(story, "source_url", None),
            "linked_posts": linked_posts,
        }

        inserted, _ = await _write_story_to_db(db_instance, normalized)
        await _record_story_alias(
            db_instance,
            story_id=story_id,
            headline=story.headline,
            x_trend_id=x_trend_id,
            capture_id=capture_id,
            resolution=resolution,
        )
        if inserted:
            new += 1
        else:
            updated += 1

        if audience_id:
            try:
                await db_instance.record_audience_story_sighting(
                    audience_id=audience_id,
                    story_id=story_id,
                    rank_in_feed=story.rank_in_feed,
                    audience_member_id=audience_member_id,
                    seen_at=captured_at,
                )
            except Exception:
                log.exception(
                    "sighting write failed audience_id=%s story_id=%s",
                    audience_id,
                    story_id,
                )

    return new, updated


# ============================================================
# legacy SQS consumer path (kept for optional use; not active by default)
# ============================================================
def _normalize_news_message(
    raw_body: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    payload = json.loads(raw_body)
    if payload.get("type") != "trends_twitter_news_v1":
        raise ValueError("unsupported trends news payload type")

    capture_id = str(payload.get("capture_id") or "").strip()
    source = str(payload.get("source") or "global_trending_scrape").strip()
    captured_at_raw = str(payload.get("captured_at") or "").strip()
    story = payload.get("story") if isinstance(payload.get("story"), dict) else {}

    headline = str(story.get("headline") or "").strip()
    topic_category = str(story.get("topic_category") or "").strip()
    recency_label = str(story.get("recency_label") or "").strip()
    if not capture_id or not headline or not topic_category or not recency_label:
        raise ValueError("missing required trends news story fields")

    post_count_raw = story.get("post_count_raw")
    post_count = _parse_metric(post_count_raw)
    _now = now or datetime.now(timezone.utc)
    approx_started_at = _parse_recency_to_iso(recency_label, _now)

    linked_posts_raw = story.get("linked_posts")
    linked_posts: list[dict[str, Any]] = []
    if isinstance(linked_posts_raw, list):
        for raw in linked_posts_raw:
            if not isinstance(raw, dict):
                continue
            post_id = str(raw.get("post_id") or "").strip()
            url = str(raw.get("url") or "").strip()
            text = str(raw.get("text") or "").strip()
            author_handle = str(raw.get("author_handle") or "").strip()
            if not author_handle.startswith("@"):
                author_handle = f"@{author_handle.lstrip('@')}" if author_handle else ""
            if not post_id or not url or not text or not author_handle:
                continue
            media_urls = raw.get("media_urls")
            if not isinstance(media_urls, list):
                media_urls = []
            linked_posts.append(
                {
                    "capture_id": capture_id,
                    "source": source,
                    "post_id": post_id,
                    "url": url,
                    "category": str(raw.get("category") or topic_category).strip()
                    or topic_category,
                    "subcategory": raw.get("subcategory") or headline,
                    "rank_in_category": int(raw.get("rank_in_category") or 0),
                    "author_handle": author_handle,
                    "author_name": raw.get("author_name"),
                    "author_avatar": raw.get("author_avatar"),
                    "author_verified": bool(raw.get("author_verified")),
                    "text": text,
                    "posted_at": raw.get("posted_at"),
                    "media_urls": media_urls,
                    "likes": int(raw.get("likes") or 0),
                    "retweets": int(raw.get("retweets") or 0),
                    "replies": int(raw.get("replies") or 0),
                    "views": int(raw.get("views") or 0),
                }
            )

    return {
        "capture_id": capture_id,
        "captured_at": captured_at_raw,
        "source": source,
        "headline": headline,
        "topic_category": topic_category,
        "topic_categories": (
            story.get("topic_categories") if isinstance(story.get("topic_categories"), list) else []
        ),
        "post_count": post_count,
        "post_count_raw": post_count_raw,
        "recency_label": recency_label,
        "approx_started_at": approx_started_at,
        "rank_in_feed": int(story.get("rank_in_feed") or 0),
        "summary": story.get("summary"),
        "last_updated_at": story.get("last_updated_at"),
        "x_trend_id": story.get("x_trend_id") or story.get("news_id"),
        "source_url": story.get("source_url"),
        "linked_posts": linked_posts,
    }


async def _process_sqs_message(
    sqs_client: Any, queue_url: str, raw_body: str, receipt: str
) -> None:
    from api.consumers.runner import delete_message

    try:
        normalized = _normalize_news_message(raw_body)
    except (json.JSONDecodeError, ValueError, TypeError) as e:
        log.warning("news_sqs invalid payload err=%r", e)
        await asyncio.to_thread(delete_message, sqs_client, queue_url, receipt)
        return

    story_id, resolution = await _resolve_story_id(
        headline=normalized["headline"],
        topic_category=normalized["topic_category"],
        x_trend_id=normalized.get("x_trend_id"),
    )
    normalized["story_id"] = story_id

    for post in normalized["linked_posts"]:
        post["story_id"] = story_id

    await _write_story_to_db(db, normalized)
    await _record_story_alias(
        db,
        story_id=story_id,
        headline=normalized["headline"],
        x_trend_id=normalized.get("x_trend_id"),
        capture_id=normalized.get("capture_id"),
        resolution=resolution,
    )
    await asyncio.to_thread(delete_message, sqs_client, queue_url, receipt)
