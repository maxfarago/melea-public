from __future__ import annotations

import re
from collections import defaultdict

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from api.auth import optional_bearer_claims, user_has_active_subscription
from api.db.common import _loads_json_list
from api.db.sqlite import db
from api.features import cdn_assets
from api.features.brand_pipeline import attach_brand_scores, matched_audience_ids

router = APIRouter()
_STATUS_URL_RE = re.compile(r"/status/(\d+)")


def _reply_intent_url(post_url: str) -> str | None:
    match = _STATUS_URL_RE.search(post_url)
    if not match:
        return None
    return f"https://twitter.com/intent/tweet?in_reply_to={match.group(1)}"


@router.get("/api/trends/stories")
async def list_trending_stories(
    request: Request,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    category: str = Query(default=""),
    since_hours: int | None = Query(default=None, ge=1, le=168),
    until_hours: int | None = Query(default=None, ge=0, le=168),
    company_id: str | None = Query(default=None),
    audience_ids: str = Query(default=""),
    sort: str = Query(default="recency"),
    include_posts: bool = Query(default=False),
    posts_per_story: int = Query(default=3, ge=0, le=20),
    min_brand_score: float | None = Query(default=None, ge=0.0, le=1.0),
) -> JSONResponse:
    claims = await optional_bearer_claims(request)
    user_id = str((claims or {}).get("sub") or "").strip()
    gated = not await user_has_active_subscription(user_id, claims)
    parsed_audience_ids = [part.strip() for part in audience_ids.split(",") if part.strip()]
    if parsed_audience_ids or min_brand_score is not None:
        stories = await _list_filtered_trending_stories(
            company_id=company_id,
            audience_ids=parsed_audience_ids,
            sort=sort,
            include_posts=include_posts,
            posts_per_story=posts_per_story,
            min_brand_score=min_brand_score,
            limit=limit,
            offset=offset,
        )
        return JSONResponse(content={"stories": stories, "gated": gated})

    stories = await db.list_trending_stories(
        limit=limit,
        offset=offset,
        topic_category=category.strip() or None,
        since_hours=since_hours,
        until_hours=until_hours,
    )
    story_ids = [str(story.get("story_id") or "") for story in stories]
    audiences_by_story = await db.list_story_audience_sightings_for_stories(story_ids)
    top_post_views = await db.list_top_post_views_for_stories(story_ids)
    posts_by_story: dict[str, list[dict]] = {}
    if include_posts and posts_per_story > 0:
        posts_by_story = await db.list_trending_posts_for_stories(
            story_ids,
            per_story_limit=posts_per_story,
        )
    for story in stories:
        story_id = str(story.get("story_id") or "")
        story["topic_categories"] = _loads_json_list(story.get("topic_categories"))
        story_audiences = audiences_by_story.get(story_id, [])
        for audience in story_audiences:
            image_key = str(audience.pop("member_profile_image_s3_key", "") or "").strip()
            audience["member_image_url"] = cdn_assets.cdn_url(image_key)
        story["audiences"] = story_audiences
        story["top_post_views"] = top_post_views.get(story_id, 0)
        story["story_last_seen_at"] = story.get("last_seen_at")
        if include_posts and posts_per_story > 0:
            story["posts"] = posts_by_story.get(story_id, [])
    if company_id:
        company = await db.get_company(company_id)
        if company is not None:
            existing = await db.get_brand_story_scores(company_id, story_ids)
            attach_brand_scores(stories, existing)
    return JSONResponse(content={"stories": stories, "gated": gated})


async def _list_filtered_trending_stories(
    *,
    company_id: str | None,
    audience_ids: list[str],
    sort: str,
    include_posts: bool,
    posts_per_story: int,
    min_brand_score: float | None,
    limit: int,
    offset: int,
) -> list[dict]:
    scoped_audience_ids: list[str] = []
    if company_id:
        company = await db.get_company(company_id)
        if company is None:
            raise HTTPException(status_code=404, detail="Company not found.")
        company_audiences = set(matched_audience_ids(company.to_dict()))
        if audience_ids:
            scoped_audience_ids = [
                audience_id for audience_id in audience_ids if audience_id in company_audiences
            ]
        else:
            scoped_audience_ids = list(company_audiences)
    else:
        scoped_audience_ids = audience_ids
    if not scoped_audience_ids:
        return []

    rows = await db.list_audience_story_sightings(scoped_audience_ids)
    audience_catalog = {aud.id: aud for aud in await db.list_audiences()}
    stories_by_id: dict[str, dict] = {}
    audiences_by_story: dict[str, set[str]] = defaultdict(set)
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
                "posts": [],
            }
            stories_by_id[story_id] = story
        audience_id = str(row.get("audience_id") or "").strip()
        if audience_id and audience_id not in audiences_by_story[story_id]:
            audiences_by_story[story_id].add(audience_id)
            image_key = str(row.get("member_profile_image_s3_key") or "").strip()
            story["audiences"].append(
                {
                    "audience_id": audience_id,
                    "title": (
                        audience_catalog.get(audience_id).title
                        if audience_catalog.get(audience_id)
                        else None
                    ),
                    "rank_in_feed": row.get("rank_in_feed"),
                    "last_seen_at": row.get("last_seen_at"),
                    "member_handle": row.get("member_handle"),
                    "member_image_url": cdn_assets.cdn_url(image_key),
                }
            )

    stories = list(stories_by_id.values())
    if company_id:
        existing = await db.get_brand_story_scores(
            company_id, [str(story.get("story_id") or "") for story in stories]
        )
        attach_brand_scores(stories, existing)
        if min_brand_score is not None:
            stories = [
                story
                for story in stories
                if isinstance(story.get("brand_score"), (int, float))
                and float(story["brand_score"]) >= min_brand_score
            ]

    normalized_sort = (sort or "recency").strip().lower()
    if normalized_sort == "brand_score":
        stories.sort(
            key=lambda story: (
                float(story.get("brand_score") or 0),
                str(story.get("story_last_seen_at") or ""),
            ),
            reverse=True,
        )
    elif normalized_sort == "views":
        stories.sort(
            key=lambda story: (
                int(story.get("top_post_views") or 0),
                str(story.get("story_last_seen_at") or ""),
            ),
            reverse=True,
        )
    elif normalized_sort == "activity":
        stories.sort(
            key=lambda story: (
                int(story.get("post_count") or 0),
                str(story.get("story_last_seen_at") or ""),
            ),
            reverse=True,
        )
    else:
        stories.sort(
            key=lambda story: str(
                story.get("last_updated_at") or story.get("story_last_seen_at") or ""
            ),
            reverse=True,
        )

    page = stories[offset : offset + limit]
    if include_posts and posts_per_story > 0:
        posts_by_story = await db.list_trending_posts_for_stories(
            [str(story.get("story_id") or "") for story in page],
            per_story_limit=posts_per_story,
        )
        for story in page:
            story["posts"] = posts_by_story.get(str(story.get("story_id") or ""), [])
    return page


@router.get("/api/trends/story/{story_id}")
async def get_trending_story_detail(
    story_id: str,
    limit: int = Query(default=25, ge=1, le=100),
) -> JSONResponse:
    story = await db.get_trending_story(story_id)
    if story is None:
        raise HTTPException(status_code=404, detail="Story not found.")
    story["topic_categories"] = _loads_json_list(story.get("topic_categories"))
    posts = await db.list_trending_posts_for_story(story_id, limit=limit)
    for post in posts:
        post_url = str(post.get("url") or "").strip()
        post["reply_intent_url"] = _reply_intent_url(post_url)
    audiences = await db.list_story_audience_sightings(story_id)
    for audience in audiences:
        image_key = str(audience.pop("member_profile_image_s3_key", "") or "").strip()
        audience["member_image_url"] = cdn_assets.cdn_url(image_key)
    brand_scores = await db.list_brand_scores_for_story(story_id)
    aliases = await db.get_story_aliases(story_id)
    return JSONResponse(
        content={
            "story": story,
            "posts": posts,
            "audiences": audiences,
            "brand_scores": brand_scores,
            "aliases": aliases,
        }
    )
