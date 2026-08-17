"""homepage chat endpoints — story suggestions + campaign creation."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.auth import require_auth, require_company_write, check_campaign_quota
from api.db.sqlite import db
from api.features.brand_pipeline import (
    attach_brand_scores,
    collect_audience_trends,
    matched_audience_ids,
)
from api.routes.sitmar import (
    SITMAR_TITLE_PLACEHOLDER,
    _enrich_campaign,
    _run_chat_turn,
    brand_synthesis_text,
    resolved_brand_logo,
    resolved_brand_name,
)
from llm.profiling import generate_home_story_suggestions

router = APIRouter()
log = logging.getLogger(__name__)


class SuggestStoriesBody(BaseModel):
    company_id: str


class StartCampaignBody(BaseModel):
    company_id: str
    story_id: str


@router.post("/api/home/suggest-stories")
async def suggest_stories(
    body: SuggestStoriesBody,
    request: Request,
    user_id: str = Depends(require_auth),
) -> JSONResponse:
    await require_company_write(request, body.company_id)
    company = await db.get_company(body.company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    snapshot = company.to_dict()
    audience_ids = matched_audience_ids(snapshot)
    if not audience_ids:
        raise HTTPException(status_code=400, detail="No audiences matched for this brand yet.")

    stories = await collect_audience_trends(
        audience_ids,
        per_story_post_limit=0,
        last_seen_within_hours=24,
        sort_by="recency",
    )
    if not stories:
        raise HTTPException(
            status_code=400,
            detail="No trending stories found for this brand's audiences in the last 24 hours.",
        )

    story_ids = [str(s.get("story_id") or "") for s in stories]
    existing = await db.get_brand_story_scores(body.company_id, story_ids)
    attach_brand_scores(stories, existing)

    abridged: list[dict[str, Any]] = []
    for s in stories[:20]:
        abridged.append(
            {
                "story_id": str(s.get("story_id") or ""),
                "headline": str(s.get("headline") or "").strip(),
                "summary": str(s.get("summary") or "").strip()[:200],
                "post_count": s.get("post_count") or 0,
                "top_post_views": s.get("top_post_views") or 0,
                "last_seen_at": s.get("audience_last_seen_at")
                or s.get("story_last_seen_at")
                or s.get("last_updated_at"),
                "brand_score": s.get("brand_score"),
            }
        )

    name = resolved_brand_name(snapshot)
    synthesis = brand_synthesis_text(snapshot)

    result = await generate_home_story_suggestions(
        brand_name=name,
        brand_synthesis=synthesis,
        stories=abridged,
    )

    picks: list[dict[str, Any]] = []
    for p in result["picks"]:
        idx = p["index"]
        if 0 <= idx < len(abridged):
            story = abridged[idx]
            picks.append(
                {
                    "story_id": story["story_id"],
                    "headline": story["headline"],
                    "summary": story["summary"],
                    "reason": p["reason"],
                }
            )

    return JSONResponse(content={"message": result["message"], "stories": picks})


@router.post("/api/home/start-campaign")
async def start_campaign(
    body: StartCampaignBody,
    request: Request,
    user_id: str = Depends(require_auth),
) -> JSONResponse:
    await check_campaign_quota(user_id)
    await require_company_write(request, body.company_id)
    company = await db.get_company(body.company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    snapshot = company.to_dict()

    story = await db.get_trending_story(body.story_id)
    if story is None:
        raise HTTPException(status_code=404, detail="Story not found.")

    story_title = str(story.get("headline") or "").strip()
    story_summary = str(story.get("summary") or "").strip()

    campaign = await db.create_situational_campaign(
        company_id=body.company_id,
        story_id=body.story_id,
        title=SITMAR_TITLE_PLACEHOLDER,
        brand_name=resolved_brand_name(snapshot),
        brand_synthesis=brand_synthesis_text(snapshot),
        brand_logo_url=resolved_brand_logo(snapshot),
        story_title=story_title,
        story_summary=story_summary,
        brand_audience=None,
        inhouse_audience=None,
        status="thinking",
        user_id=user_id,
    )
    await db.append_sitmar_message(
        campaign.id,
        {
            "role": "user",
            "type": "story_context",
            "story_id": body.story_id,
            "headline": story_title,
            "summary": story_summary,
            "topic_category": str(story.get("topic_category") or "").strip(),
            "post_count": story.get("post_count") or 0,
            "last_seen_at": story.get("last_updated_at"),
            "brand_score": story.get("brand_score"),
            "source_url": str(story.get("source_url") or "").strip(),
            "x_trend_id": str(story.get("x_trend_id") or "").strip(),
        },
    )
    campaign = await db.get_situational_campaign(campaign.id)
    asyncio.create_task(_run_chat_turn(campaign.id))
    return JSONResponse(
        content={
            "campaign": await _enrich_campaign(campaign),
            "status": "thinking",
        }
    )
