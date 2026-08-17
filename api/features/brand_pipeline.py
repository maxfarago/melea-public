"""Brand-onboarding pipeline.

`run_website_onboarding` is the entry point fired as a background task
on company creation. It orchestrates the staged onboarding flow:

    website synthesis (Jina homepage text, scrapingbee fallback)
      -> LinkedIn discovery + scrape
        -> audience generation
          -> audience-match against the in-house catalog
            -> brand synthesis + embedding relevance scoring
            -> audience-trends marker

Each stage writes its own status onto `company_stages` so the UI can
poll. Stage runners (`run_*_stage`) are individually exposed so the
`/refresh` routes can re-run a single stage.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import UTC, datetime, timedelta
from urllib.parse import unquote, urlparse

import httpx

from api.db.common import _loads_json_list
from api.db.sqlite import db
from api.features import cdn_assets
from api.features.story_relevance import score_brand_against_all_stories
from commons.config import settings
from ingestion.linkedin import company_page as linkedin_company_page
from ingestion.web.jina import brand_name, domain_of, fetch_reader, fetch_search
from ingestion.web.scrapingbee import ScrapingBeeError, scrape_url
from llm.profiling import (
    audience_match_model,
    audience_model,
    brand_synthesis_model,
    build_website_synthesis_prompt,
    generate_brand_audiences,
    generate_brand_synthesis,
    generate_website_synthesis,
    match_brand_audiences_to_catalog,
    website_synthesis_system_prompt,
    website_synthesis_model,
)

log = logging.getLogger(__name__)

# jina homepage output shorter than this is treated as a soft block -> scrapingbee
_MIN_HOMEPAGE_EXCERPT_CHARS = 200


def _compose_synthesis_excerpt_from_reader(
    *,
    title: str,
    description: str,
    content: str,
) -> str:
    parts: list[str] = []
    if (title or "").strip():
        parts.append(f"title: {(title or '').strip()}")
    if (description or "").strip():
        parts.append(f"description: {(description or '').strip()}")
    if (content or "").strip():
        parts.append(f"content:\n{(content or '').strip()}")
    return "\n\n".join(parts).strip()


async def fetch_synthesis_homepage_excerpt(homepage_url: str) -> tuple[str, str]:
    """Homepage text for synthesis: Jina primary, ScrapingBee fallback.

    Jina raising (hard block/4xx) OR returning suspiciously thin content
    (soft block: cookie wall, unrendered SPA shell) both trigger the
    ScrapingBee JS-rendered scrape.
    """
    jina_err: Exception | None = None
    try:
        reader = await fetch_reader(
            homepage_url,
            json_response=True,
            images_summary=False,
            image_alt=False,
            links_summary=False,
            use_readerlm=False,
            max_chars=12_000,
        )
        excerpt = _compose_synthesis_excerpt_from_reader(
            title=str(reader.title or ""),
            description=str(reader.description or ""),
            content=str(reader.content or ""),
        )
        if len(excerpt) >= _MIN_HOMEPAGE_EXCERPT_CHARS:
            return excerpt, "jina"
        jina_err = ValueError(f"jina returned thin homepage content ({len(excerpt)} chars)")
        log.warning(
            "homepage_synthesis_jina_thin homepage_url=%s chars=%d",
            homepage_url,
            len(excerpt),
        )
    except Exception as e:
        jina_err = e
        log.warning(
            "homepage_synthesis_jina_failed homepage_url=%s err=%r",
            homepage_url,
            e,
        )

    try:
        excerpt = (await scrape_url(homepage_url, max_chars=12_000)).strip()
    except ScrapingBeeError as sb_err:
        raise ValueError(
            f"homepage synthesis source unavailable: jina failed ({jina_err}) "
            f"and scrapingbee fallback failed ({sb_err})"
        ) from sb_err
    if not excerpt:
        raise ValueError(
            "homepage synthesis source unavailable: scrapingbee fallback returned empty content"
        ) from jina_err
    return excerpt, "scrapingbee"


async def run_linkedin_company_stage(
    company_id: str,
    homepage_url: str,
    homepage_markdown_excerpt: str,
    *,
    search_terms: list[str] | None = None,
) -> None:
    if not settings.jina_api_key.strip():
        await db.set_linkedin_company_stage(
            company_id,
            status="skipped",
            error="linkedin scrape skipped: JINA_API_KEY is empty",
        )
        return
    if not settings.scrapingbee_api_key.strip():
        await db.set_linkedin_company_stage(
            company_id,
            status="skipped",
            error="linkedin scrape skipped: SCRAPINGBEE_API_KEY is empty",
        )
        return
    await db.set_linkedin_company_stage(company_id, status="running_discovery", error=None)
    try:
        terms = search_terms or await generate_and_store_website_synthesis(
            company_id,
            homepage_url=homepage_url,
            homepage_markdown_excerpt=homepage_markdown_excerpt,
        )
        company = await db.get_company(company_id)
        business_name = str(
            ((company.business_name or company.website_synthesis_business_name) if company else "")
            or ""
        ).strip()
        first_term = business_name or str((terms[0] if terms else "") or "").strip()
        if not first_term:
            raise ValueError("no generated search terms available for linkedin lookup")
        linkedin_url, _ = await linkedin_company_page.discover_company_url(
            search_term=first_term,
            website_url=homepage_url,
        )
        if not linkedin_url:
            raise linkedin_company_page.LinkedInDiscoveryError(
                f"no linkedin company url found for search term '{first_term}'"
            )
        await db.set_linkedin_company_stage(company_id, status="running_fetch", error=None)
        scraped_text = await linkedin_company_page.scrape_company_page(linkedin_url=linkedin_url)
        is_valid, validation_reason = linkedin_company_page.validate_profile_domain(
            profile_text=scraped_text,
            website_url=homepage_url,
        )
        structured: dict[str, object] | None = None
        extraction_model: str | None = None
        if is_valid:
            structured = await linkedin_company_page.extract_company_profile(
                profile_text=scraped_text,
                linkedin_url=linkedin_url,
            )
            extraction_model = str((structured or {}).get("extraction_model") or "").strip() or None
        await db.update_linkedin_company_payload(
            company_id,
            url=linkedin_url,
            text=scraped_text,
        )
        await db.set_linkedin_company_enrichment(
            company_id,
            is_valid=is_valid,
            validation_reason=validation_reason,
            structured=structured,
            extraction_model=extraction_model,
        )
        if not is_valid:
            await db.set_linkedin_company_stage(
                company_id,
                status="error",
                error=validation_reason or "linkedin profile validation failed",
            )
            return
        log.info(
            "linkedin_company_scraped company_id=%s search_term=%r url=%s chars=%d",
            company_id,
            first_term,
            linkedin_url,
            len(scraped_text),
        )
    except Exception as e:
        message = str(e).strip() or "linkedin company scrape failed"
        await db.set_linkedin_company_stage(company_id, status="error", error=message[:500])
        log.warning("linkedin_company_scrape_failed company_id=%s err=%r", company_id, e)


def _audience_synthesis_summary(company_snapshot: dict[str, object]) -> str:
    return str(company_snapshot.get("homepage_summary") or "").strip() or "not available"


async def run_audience_stage(company_id: str, company_snapshot: dict[str, object]) -> None:
    if not settings.anthropic_api_key.strip():
        await db.set_audience_stage(
            company_id,
            status="skipped",
            error="audience skipped: ANTHROPIC_API_KEY is empty",
        )
        return
    await db.set_audience_stage(company_id, status="running", error=None)
    try:
        website_url = str(company_snapshot.get("website_url") or "").strip()
        business_name = str(
            company_snapshot.get("business_name")
            or company_snapshot.get("website_synthesis_business_name")
            or ""
        ).strip() or brand_name(domain_of(website_url))
        synthesis_summary = _audience_synthesis_summary(company_snapshot)
        linkedin_structured = company_snapshot.get("linkedin_company_structured")
        if not isinstance(linkedin_structured, dict):
            linkedin_structured = None
        audiences = await generate_brand_audiences(
            homepage_url=website_url,
            business_name=business_name,
            synthesis_summary=synthesis_summary,
            linkedin_structured=linkedin_structured,
        )
        await db.set_audience_result(
            company_id,
            audiences=audiences,
            model=audience_model(),
        )
    except Exception as e:
        await db.set_audience_stage(
            company_id, status="error", error=(str(e).strip() or "audience generation failed")[:500]
        )
        log.warning("audience_generation_failed company_id=%s err=%r", company_id, e)


async def run_audience_match_stage(company_id: str, company_snapshot: dict[str, object]) -> None:
    """match each brand-generated audience to the closest in-house saved audience."""
    if not settings.anthropic_api_key.strip():
        await db.set_audience_match_stage(
            company_id,
            status="skipped",
            error="audience match skipped: ANTHROPIC_API_KEY is empty",
        )
        return
    brand_audiences = company_snapshot.get("audience")
    if not isinstance(brand_audiences, list) or not brand_audiences:
        await db.set_audience_match_stage(
            company_id,
            status="skipped",
            error="audience match skipped: no brand audiences",
        )
        return
    catalog = await db.list_audiences()
    if not catalog:
        await db.set_audience_match_stage(
            company_id,
            status="skipped",
            error="audience match skipped: no in-house audiences to match",
        )
        return
    await db.set_audience_match_stage(company_id, status="running", error=None)
    try:
        catalog_by_id = {a.id: a for a in catalog}
        matches = await match_brand_audiences_to_catalog(
            brand_audiences=[
                {"title": str(a.get("title") or ""), "description": str(a.get("description") or "")}
                for a in brand_audiences
            ],
            catalog=[{"id": a.id, "title": a.title, "description": a.description} for a in catalog],
        )
        match_by_index = {m["brand_index"]: m for m in matches}
        enriched: list[dict[str, object]] = []
        for i, a in enumerate(brand_audiences):
            entry = {k: v for k, v in a.items() if k != "match"}
            m = match_by_index.get(i)
            if m and m["audience_id"] in catalog_by_id:
                matched = catalog_by_id[m["audience_id"]]
                entry["match"] = {
                    "audience_id": m["audience_id"],
                    "title": matched.title,
                    "description": matched.description,
                    "score": m["score"],
                    "reason": m["reason"],
                }
            else:
                entry["match"] = None
            enriched.append(entry)
        unmatched = [i for i, e in enumerate(enriched) if e.get("match") is None]
        if unmatched and catalog:
            fallback_matches = await match_brand_audiences_to_catalog(
                brand_audiences=[
                    {
                        "title": str(brand_audiences[i].get("title") or ""),
                        "description": str(brand_audiences[i].get("description") or ""),
                    }
                    for i in unmatched
                ],
                catalog=[
                    {"id": a.id, "title": a.title, "description": a.description} for a in catalog
                ],
                min_score=0.0,
            )
            fb_by_idx = {m["brand_index"]: m for m in fallback_matches}
            for j, orig_idx in enumerate(unmatched):
                m = fb_by_idx.get(j)
                if m and m["audience_id"] in catalog_by_id:
                    matched = catalog_by_id[m["audience_id"]]
                    enriched[orig_idx]["match"] = {
                        "audience_id": m["audience_id"],
                        "title": matched.title,
                        "description": matched.description,
                        "score": m["score"],
                        "reason": m["reason"],
                    }
        await db.set_audience_match_result(
            company_id,
            audiences=enriched,
            model=audience_match_model(),
        )
    except Exception as e:
        await db.set_audience_match_stage(
            company_id,
            status="error",
            error=(str(e).strip() or "audience match failed")[:500],
        )
        log.warning("audience_match_failed company_id=%s err=%r", company_id, e)


async def run_brand_synthesis_stage(company_id: str, company_snapshot: dict[str, object]) -> None:
    """compose a 150-200 word brand identity blurb (sonnet 4-6) from the
    website synthesis + brand audiences. used as input to brand-story scoring.
    runs after audience-match so the audiences exist on the snapshot."""
    if not settings.anthropic_api_key.strip():
        await db.set_brand_synthesis_stage(
            company_id,
            status="skipped",
            error="brand synthesis skipped: ANTHROPIC_API_KEY is empty",
        )
        return
    homepage_summary = str(company_snapshot.get("homepage_summary") or "").strip()
    audiences = company_snapshot.get("audience")
    has_audiences = isinstance(audiences, list) and any(
        isinstance(a, dict) and str(a.get("title") or "").strip() for a in audiences
    )
    if not homepage_summary:
        await db.set_brand_synthesis_stage(
            company_id,
            status="skipped",
            error="brand synthesis skipped: no homepage summary",
        )
        return
    if not has_audiences:
        await db.set_brand_synthesis_stage(
            company_id,
            status="skipped",
            error="brand synthesis skipped: no brand audiences",
        )
        return
    await db.set_brand_synthesis_stage(company_id, status="running", error=None)
    try:
        synthesis = await generate_brand_synthesis(
            homepage_summary=homepage_summary,
            audiences=audiences if isinstance(audiences, list) else [],
            tone_of_voice=None,
        )
        if not synthesis:
            await db.set_brand_synthesis_stage(
                company_id,
                status="error",
                error="brand synthesis returned empty",
            )
            return
        await db.set_brand_synthesis_result(
            company_id,
            synthesis=synthesis,
            model=brand_synthesis_model(),
        )
    except Exception as e:
        await db.set_brand_synthesis_stage(
            company_id,
            status="error",
            error=(str(e).strip() or "brand synthesis failed")[:500],
        )
        log.warning("brand_synthesis_failed company_id=%s err=%r", company_id, e)


async def run_brand_scoring_stage(company_id: str) -> None:
    """score the brand embedding against all known stories and persist results."""
    await db.set_brand_scoring_stage(company_id, status="running", error=None)
    try:
        await score_brand_against_all_stories(company_id)
        await db.set_brand_scoring_stage(company_id, status="done", error=None)
    except Exception as e:
        await db.set_brand_scoring_stage(
            company_id,
            status="error",
            error=(str(e).strip() or "brand scoring failed")[:500],
        )
        log.warning("brand_scoring_failed company_id=%s err=%r", company_id, e)


def matched_audience_ids(company_snapshot: dict[str, object]) -> list[str]:
    """distinct in-house audience ids the brand's audiences were matched to."""
    brand_audiences = company_snapshot.get("audience")
    if not isinstance(brand_audiences, list):
        return []
    ids: list[str] = []
    seen: set[str] = set()
    for entry in brand_audiences:
        match = entry.get("match") if isinstance(entry, dict) else None
        if not isinstance(match, dict):
            continue
        aid = str(match.get("audience_id") or "").strip()
        if aid and aid not in seen:
            seen.add(aid)
            ids.append(aid)
    return ids


def _parse_sighting_time(value: object) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        if " " in text and "T" not in text:
            text = text.replace(" ", "T", 1)
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=UTC)
        return dt
    except ValueError:
        return None


async def collect_audience_trends(
    audience_ids: list[str],
    *,
    per_story_post_limit: int = 100,
    last_seen_within_hours: int | None = None,
    sort_by: str = "activity",
) -> list[dict[str, object]]:
    """live join: one row per story seen by the given audiences, with the
    matched audiences that saw it."""
    if not audience_ids:
        return []
    rows = await db.list_audience_story_sightings(audience_ids)
    catalog = {a.id: a for a in await db.list_audiences()}
    stories: dict[str, dict[str, object]] = {}
    for r in rows:
        sid = str(r["story_id"])
        story = stories.get(sid)
        if story is None:
            story = {
                "story_id": sid,
                "headline": r["headline"],
                "topic_category": r["topic_category"],
                "topic_categories": _loads_json_list(r.get("topic_categories")),
                "post_count": r["post_count"],
                "post_count_raw": r["post_count_raw"],
                "top_post_views": r.get("top_post_views", 0),
                "summary": r["summary"],
                "last_updated_at": r["last_updated_at"],
                "story_last_seen_at": r["story_last_seen_at"],
                "x_trend_id": r.get("x_trend_id"),
                "source_url": r.get("source_url"),
                "audiences": [],
                "audience_last_seen_at": None,
            }
            stories[sid] = story
        aid = str(r["audience_id"])
        matched = catalog.get(aid)
        seen_at = r["last_seen_at"]
        story["audiences"].append(
            {
                "audience_id": aid,
                "title": matched.title if matched else None,
                "rank_in_feed": r["rank_in_feed"],
                "last_seen_at": seen_at,
            }
        )
        seen_dt = _parse_sighting_time(seen_at)
        prev_dt = _parse_sighting_time(story.get("audience_last_seen_at"))
        if seen_dt is not None and (prev_dt is None or seen_dt > prev_dt):
            story["audience_last_seen_at"] = seen_at
    if per_story_post_limit > 0:
        posts_by_story = await db.list_trending_posts_for_stories(
            list(stories.keys()),
            per_story_limit=per_story_post_limit,
        )
        for sid, story in stories.items():
            story["posts"] = posts_by_story.get(sid, [])

    result = list(stories.values())
    if last_seen_within_hours is not None:
        cutoff = datetime.now(UTC) - timedelta(hours=last_seen_within_hours)
        result = [
            story
            for story in result
            if (seen_dt := _parse_sighting_time(story.get("audience_last_seen_at"))) is not None
            and seen_dt >= cutoff
        ]
    if sort_by == "recency":
        result.sort(
            key=lambda story: (
                _parse_sighting_time(story.get("audience_last_seen_at"))
                or datetime.min.replace(tzinfo=UTC)
            ),
            reverse=True,
        )
    else:
        result.sort(
            key=lambda story: (
                int(story.get("post_count") or 0),
                _parse_sighting_time(story.get("audience_last_seen_at"))
                or datetime.min.replace(tzinfo=UTC),
            ),
            reverse=True,
        )
    return result


BRAND_AUDIENCE_SCORE_THRESHOLD = 0.1
BRAND_AUDIENCE_MAX_AUDIENCES = 3
BRAND_AUDIENCE_MAX_RECENT_STORIES = 2


def _brand_audience_entry_eligible(entry: object) -> bool:
    if not isinstance(entry, dict):
        return False
    match = entry.get("match")
    if not isinstance(match, dict):
        return False
    if not str(match.get("audience_id") or "").strip():
        return False
    title = str(entry.get("title") or "").strip()
    description = str(entry.get("description") or "").strip()
    return bool(title or description)


async def collect_brand_audiences(
    company_id: str,
    company_snapshot: dict[str, object],
) -> list[dict[str, object]]:
    """audience-centric payload for the brand dashboard left column."""
    brand_audiences = company_snapshot.get("audience")
    if not isinstance(brand_audiences, list):
        return []

    selected: list[dict[str, object]] = []
    for entry in brand_audiences:
        if not _brand_audience_entry_eligible(entry):
            continue
        selected.append(entry)
        if len(selected) >= BRAND_AUDIENCE_MAX_AUDIENCES:
            break
    if not selected:
        return []

    inhouse_ids: list[str] = []
    seen_ids: set[str] = set()
    for entry in selected:
        match = entry.get("match")
        assert isinstance(match, dict)
        aid = str(match.get("audience_id") or "").strip()
        if aid and aid not in seen_ids:
            seen_ids.add(aid)
            inhouse_ids.append(aid)

    sighting_rows = await db.list_audience_story_sightings(inhouse_ids)
    by_audience: dict[str, list[dict[str, object]]] = {}
    all_story_ids: set[str] = set()
    for row in sighting_rows:
        aid = str(row.get("audience_id") or "").strip()
        sid = str(row.get("story_id") or "").strip()
        if not aid or not sid:
            continue
        by_audience.setdefault(aid, []).append(row)
        all_story_ids.add(sid)

    scores = await db.get_brand_story_scores(company_id, list(all_story_ids))
    members = await db.get_audience_members(inhouse_ids) if inhouse_ids else {}

    result: list[dict[str, object]] = []
    for entry in selected:
        match = entry.get("match")
        assert isinstance(match, dict)
        inhouse_id = str(match.get("audience_id") or "").strip()
        candidates: list[tuple[dict[str, object], float]] = []
        for row in by_audience.get(inhouse_id, []):
            sid = str(row.get("story_id") or "").strip()
            cached = scores.get(sid)
            if cached is None:
                continue
            score = float(cached["score"])
            if score < BRAND_AUDIENCE_SCORE_THRESHOLD:
                continue
            candidates.append((row, score))
        candidates.sort(
            key=lambda pair: (
                _parse_sighting_time(pair[0].get("last_seen_at"))
                or datetime.min.replace(tzinfo=UTC)
            ),
            reverse=True,
        )
        recent_stories: list[dict[str, object]] = []
        for row, score in candidates[:BRAND_AUDIENCE_MAX_RECENT_STORIES]:
            recent_stories.append(
                {
                    "story_id": str(row.get("story_id") or ""),
                    "headline": row.get("headline"),
                    "last_seen_at": row.get("last_seen_at"),
                    "brand_score": score,
                }
            )

        member = members.get(inhouse_id) or {}
        image_key = str(member.get("profile_image_s3_key") or "").strip()
        member_handle = str(member.get("handle") or "").strip() or None
        result.append(
            {
                "title": entry.get("title"),
                "description": entry.get("description"),
                "match": {
                    "audience_id": inhouse_id,
                    "title": match.get("title"),
                    "score": match.get("score"),
                },
                "member_image_url": cdn_assets.cdn_url(image_key),
                "member_handle": member_handle,
                "recent_stories": recent_stories,
            }
        )
    return result


COMPANY_STORIES_WITHIN_HOURS = 24


async def collect_company_stories_page(
    company_id: str,
    company_snapshot: dict[str, object],
    *,
    offset: int = 0,
    limit: int = 10,
    posts_per_story: int = 3,
    within_hours: int = COMPANY_STORIES_WITHIN_HOURS,
) -> list[dict[str, object]]:
    """paginated story feed for the brand dashboard center column."""
    audience_ids = matched_audience_ids(company_snapshot)
    if not audience_ids:
        return []

    rows = await db.list_audience_story_sightings(audience_ids)
    audience_catalog = {a.id: a for a in await db.list_audiences()}
    stories_by_id: dict[str, dict[str, object]] = {}
    audiences_by_story: dict[str, set[str]] = {}

    for row in rows:
        story_id = str(row.get("story_id") or "").strip()
        if not story_id:
            continue
        story = stories_by_id.get(story_id)
        if story is None:
            story = {
                "story_id": story_id,
                "headline": row.get("headline"),
                "topic_category": row.get("topic_category"),
                "topic_categories": _loads_json_list(row.get("topic_categories")),
                "post_count": row.get("post_count"),
                "post_count_raw": row.get("post_count_raw"),
                "top_post_views": row.get("top_post_views", 0),
                "summary": row.get("summary"),
                "last_updated_at": row.get("last_updated_at"),
                "story_last_seen_at": row.get("story_last_seen_at"),
                "x_trend_id": row.get("x_trend_id"),
                "source_url": row.get("source_url"),
                "audiences": [],
                "audience_last_seen_at": None,
                "posts": [],
            }
            stories_by_id[story_id] = story
            audiences_by_story[story_id] = set()

        audience_id = str(row.get("audience_id") or "").strip()
        seen_at = row.get("last_seen_at")
        seen_dt = _parse_sighting_time(seen_at)
        prev_dt = _parse_sighting_time(story.get("audience_last_seen_at"))
        if seen_dt is not None and (prev_dt is None or seen_dt > prev_dt):
            story["audience_last_seen_at"] = seen_at

        if audience_id and audience_id not in audiences_by_story[story_id]:
            audiences_by_story[story_id].add(audience_id)
            matched = audience_catalog.get(audience_id)
            image_key = str(row.get("member_profile_image_s3_key") or "").strip()
            story["audiences"].append(
                {
                    "audience_id": audience_id,
                    "title": matched.title if matched else None,
                    "rank_in_feed": row.get("rank_in_feed"),
                    "last_seen_at": seen_at,
                    "member_handle": row.get("member_handle"),
                    "member_image_url": cdn_assets.cdn_url(image_key),
                }
            )

    cutoff = datetime.now(UTC) - timedelta(hours=within_hours)
    stories = [
        story
        for story in stories_by_id.values()
        if (seen_dt := _parse_sighting_time(story.get("audience_last_seen_at"))) is not None
        and seen_dt >= cutoff
    ]

    story_ids = [str(story.get("story_id") or "") for story in stories]
    existing = await db.get_brand_story_scores(company_id, story_ids)
    attach_brand_scores(stories, existing)
    stories = [
        story
        for story in stories
        if isinstance(story.get("brand_score"), (int, float))
        and float(story["brand_score"]) >= BRAND_AUDIENCE_SCORE_THRESHOLD
    ]
    stories.sort(
        key=lambda story: (
            _parse_sighting_time(story.get("audience_last_seen_at"))
            or datetime.min.replace(tzinfo=UTC)
        ),
        reverse=True,
    )

    page = stories[offset : offset + limit]
    if posts_per_story > 0 and page:
        posts_by_story = await db.list_trending_posts_for_stories(
            [str(story.get("story_id") or "") for story in page],
            per_story_limit=posts_per_story,
        )
        for story in page:
            sid = str(story.get("story_id") or "")
            story["posts"] = posts_by_story.get(sid, [])
    return page


async def collect_audience_trends_for_companies(
    company_audience_ids: dict[str, list[str]],
    *,
    per_story_post_limit: int = 3,
    per_company_story_limit: int = 0,
) -> dict[str, list[dict[str, object]]]:
    audience_to_company_ids: dict[str, set[str]] = {}
    for company_id, audience_ids in company_audience_ids.items():
        for audience_id in audience_ids:
            aid = str(audience_id or "").strip()
            if not aid:
                continue
            audience_to_company_ids.setdefault(aid, set()).add(company_id)

    if not audience_to_company_ids:
        return {company_id: [] for company_id in company_audience_ids}

    all_audience_ids = list(audience_to_company_ids.keys())
    rows = await db.list_audience_story_sightings(all_audience_ids)
    catalog = {a.id: a for a in await db.list_audiences()}
    stories_by_company: dict[str, dict[str, dict[str, object]]] = {
        company_id: {} for company_id in company_audience_ids
    }

    for row in rows:
        story_id = str(row.get("story_id") or "").strip()
        audience_id = str(row.get("audience_id") or "").strip()
        if not story_id or not audience_id:
            continue
        company_ids = audience_to_company_ids.get(audience_id) or set()
        for company_id in company_ids:
            stories = stories_by_company[company_id]
            story = stories.get(story_id)
            if story is None:
                story = {
                    "story_id": story_id,
                    "headline": row["headline"],
                    "topic_category": row["topic_category"],
                    "topic_categories": _loads_json_list(row.get("topic_categories")),
                    "post_count": row["post_count"],
                    "post_count_raw": row["post_count_raw"],
                    "top_post_views": row.get("top_post_views", 0),
                    "summary": row["summary"],
                    "last_updated_at": row["last_updated_at"],
                    "story_last_seen_at": row["story_last_seen_at"],
                    "x_trend_id": row.get("x_trend_id"),
                    "source_url": row.get("source_url"),
                    "audiences": [],
                }
                stories[story_id] = story
            matched = catalog.get(audience_id)
            story["audiences"].append(
                {
                    "audience_id": audience_id,
                    "title": matched.title if matched else None,
                    "rank_in_feed": row["rank_in_feed"],
                    "last_seen_at": row["last_seen_at"],
                }
            )

    all_story_ids = list(
        {story_id for stories in stories_by_company.values() for story_id in stories.keys()}
    )
    posts_by_story = await db.list_trending_posts_for_stories(
        all_story_ids,
        per_story_limit=per_story_post_limit,
    )
    for stories in stories_by_company.values():
        for story_id, story in stories.items():
            story["posts"] = posts_by_story.get(story_id, [])

    result: dict[str, list[dict[str, object]]] = {}
    for company_id, stories in stories_by_company.items():
        vals = list(stories.values())
        if per_company_story_limit > 0:
            vals = vals[:per_company_story_limit]
        result[company_id] = vals
    return result


async def run_audience_trends_stage(company_id: str, company_snapshot: dict[str, object]) -> None:
    """attribute the brand to the news stories its matched audiences saw.

    the status is a thin marker — the GET endpoint does the live join — but
    running it confirms there is something to show and surfaces empty/skip states.
    """
    audience_ids = matched_audience_ids(company_snapshot)
    if not audience_ids:
        await db.set_audience_trends_stage(
            company_id,
            status="skipped",
            error="audience trends skipped: no matched audiences",
        )
        return
    await db.set_audience_trends_stage(company_id, status="running", error=None)
    try:
        await collect_audience_trends(audience_ids)
        await db.set_audience_trends_stage(company_id, status="done", error=None)
    except Exception as e:
        await db.set_audience_trends_stage(
            company_id,
            status="error",
            error=(str(e).strip() or "audience trends collection failed")[:500],
        )
        log.warning("audience_trends_failed company_id=%s err=%r", company_id, e)


async def run_audience_then_match(company_id: str, company_snapshot: dict[str, object]) -> None:
    """regenerate brand audiences, re-match against the catalog, recompose brand
    synthesis (since audiences feed into it), then refresh trends."""
    await run_audience_stage(company_id, company_snapshot)
    refreshed = await db.get_company(company_id)
    if refreshed:
        await run_audience_match_stage(company_id, refreshed.to_dict())
        rematched = await db.get_company(company_id)
        if rematched:
            await run_brand_synthesis_stage(company_id, rematched.to_dict())
            await run_brand_scoring_stage(company_id)
            resynthesized = await db.get_company(company_id)
            if resynthesized:
                await run_audience_trends_stage(company_id, resynthesized.to_dict())


def attach_brand_scores(
    stories: list[dict[str, object]],
    existing_scores: dict[str, dict[str, object]],
) -> None:
    """mutates each story dict to attach a top-level `brand_score`."""
    for story in stories:
        sid = str(story.get("story_id") or "").strip()
        cached = existing_scores.get(sid) if sid else None
        if cached is not None:
            story["brand_score"] = cached["score"]
            continue
        story["brand_score"] = None


async def generate_and_store_website_synthesis(
    company_id: str,
    *,
    homepage_url: str,
    homepage_markdown_excerpt: str,
    source: str | None = None,
) -> list[str]:
    await db.set_company_website_synthesis_stage(company_id, status="running", error=None)
    search_name = brand_name(domain_of(homepage_url))
    user_prompt_text = build_website_synthesis_prompt(
        homepage_url=homepage_url,
        homepage_markdown_excerpt=homepage_markdown_excerpt,
    )
    system_prompt_text = website_synthesis_system_prompt()
    prompt_text = json.dumps(
        {
            "system": system_prompt_text,
            "user": user_prompt_text,
        },
        ensure_ascii=True,
    )
    model_name = website_synthesis_model()
    search_terms: list[str] = [search_name]
    business_name: str | None = search_name
    brand_summary: str | None = None
    try:
        generated = await generate_website_synthesis(
            homepage_url=homepage_url,
            homepage_markdown_excerpt=homepage_markdown_excerpt,
            domain_slug=search_name,
        )
        business_name = generated.business_name
        brand_summary = generated.brand_summary or None
        normalized_business_name = " ".join(str(business_name or "").split()).strip()
        search_terms = [normalized_business_name or search_name]
        await db.set_company_website_synthesis_stage(company_id, status="done", error=None)
    except Exception as e:
        log.warning("homepage_synthesis_fallback company_id=%s err=%r", company_id, e)
        await db.set_company_website_synthesis_stage(
            company_id,
            status="error",
            error=(str(e).strip() or "homepage synthesis failed")[:500],
        )

    await db.update_company_website_synthesis_context(
        company_id,
        terms=search_terms,
        primary_term=search_terms[0] if search_terms else None,
        selected_term=None,
        prompt=prompt_text,
        model=model_name,
        source=source,
        business_name=business_name,
        business_logo_url=None,
        brand_summary=brand_summary,
    )
    return search_terms


_stalled_resume_in_flight: set[str] = set()


async def maybe_resume_stalled_onboarding(company_id: str) -> None:
    if company_id in _stalled_resume_in_flight:
        return
    stages = await db.get_company_stages(company_id)
    synthesis = stages.get("website_synthesis")
    audience = stages.get("audience")
    if not synthesis or not audience:
        return
    syn_status = str(synthesis.status or "").strip().lower()
    aud_status = str(audience.status or "").strip().lower()
    # resume only when the website step settled but audience never started
    if syn_status not in ("done", "error", "skipped") or aud_status != "pending":
        return
    for row in stages.values():
        status = str(row.status or "").strip().lower()
        if status == "running" or status.startswith("running_"):
            return
    _stalled_resume_in_flight.add(company_id)
    try:
        await _run_post_pipeline(company_id)
    finally:
        _stalled_resume_in_flight.discard(company_id)


async def _run_post_pipeline(company_id: str) -> None:
    company_for_audience = await db.get_company(company_id)
    if not company_for_audience:
        return
    await run_audience_stage(company_id, company_for_audience.to_dict())
    refreshed = await db.get_company(company_id)
    if refreshed:
        await run_audience_match_stage(company_id, refreshed.to_dict())
        rematched = await db.get_company(company_id)
        if rematched:
            await run_brand_synthesis_stage(company_id, rematched.to_dict())
            await run_brand_scoring_stage(company_id)
            resynthesized = await db.get_company(company_id)
            if resynthesized:
                await run_audience_trends_stage(company_id, resynthesized.to_dict())


async def run_website_onboarding(company_id: str, homepage_url: str) -> None:
    """Homepage synthesis -> linkedin -> audience/synthesis/scoring/trends.

    Jina (with a scrapingbee fallback) provides the homepage text; there is
    no separate site crawl. If no homepage text can be fetched at all, the
    dependent stages are skipped.
    """
    await db.set_company_website_synthesis_stage(company_id, status="running_reader", error=None)

    search_terms: list[str] = [brand_name(domain_of(homepage_url))]
    synthesis_excerpt = ""
    synthesis_source: str | None = None
    try:
        synthesis_excerpt, synthesis_source = await fetch_synthesis_homepage_excerpt(homepage_url)
        search_terms = await generate_and_store_website_synthesis(
            company_id,
            homepage_url=homepage_url,
            homepage_markdown_excerpt=synthesis_excerpt,
            source=synthesis_source,
        )
    except Exception as e:
        await db.set_company_website_synthesis_stage(
            company_id,
            status="error",
            error=(str(e).strip() or "homepage synthesis failed")[:500],
        )
        log.warning("homepage_synthesis_fetch_failed company_id=%s err=%r", company_id, e)
        # no homepage text -> can't build a brand; skip dependent stages
        await db.set_linkedin_company_stage(
            company_id, status="skipped", error="linkedin scrape skipped: no homepage content"
        )
        await db.set_audience_stage(
            company_id, status="skipped", error="audience skipped: no homepage content"
        )
        await db.set_audience_trends_stage(
            company_id,
            status="skipped",
            error="audience trends skipped: no homepage content",
        )
        return

    # linkedin is manual-only enrichment (ops-triggered via /linkedin/refresh),
    # not part of automatic onboarding
    await db.set_linkedin_company_stage(
        company_id, status="skipped", error="linkedin enrichment is manual-only"
    )
    await _run_post_pipeline(company_id)
