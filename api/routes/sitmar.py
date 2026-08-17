"""sitmar (situational marketing) — guided-chat reactive campaign generation.

a campaign is a frozen snapshot of (brand x news story x brand-audience). after the
operator picks those, they drop into a guided chat: opus proposes 4 campaign seeds,
the operator refines via freeform messages, and committing one seed renders a single
image (sonnet authors the grok prompt -> grok imagine -> s3). the snapshot is frozen
so re-scrapes / audience regen never mutate an existing campaign; the conversation
and the committed seed are the mutable layer on top."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from api.auth import require_auth, require_company_access, check_campaign_quota
from api.db.sitmar import SituationalCampaign
from api.db.sqlite import db
from api.features import cdn_assets
from api.features import sitmar_storage
from api.db.common import _loads_json_dict, _loads_json_list
from api.features.content_history import bucket_content_history
from api.features.brand_pipeline import (
    attach_brand_scores,
    collect_audience_trends,
    matched_audience_ids,
)
from ingestion.web.jina import brand_name, domain_of
from llm.profiling import (
    SITMAR_REGENERATE_USER_TEXT,
    build_sitmar_chat_system_prompt,
    generate_sitmar_chat_turn,
    generate_sitmar_reply,
    generate_sitmar_seed_confirm,
    generate_sitmar_title,
    generate_sitmar_tweet_refine,
    generate_sitmar_tweets,
)

router = APIRouter()
log = logging.getLogger(__name__)

SITMAR_TITLE_PLACEHOLDER = "Starting new campaign…"


class CreateSitmarBody(BaseModel):
    company_id: str
    story_id: str
    brand_audience_index: int | None = None
    system_prompt_prefix: str | None = None


class SitmarMessageBody(BaseModel):
    text: str = ""
    regenerate: bool = False
    tweet_index: int | None = None


class SitmarSelectBody(BaseModel):
    seed_index: int


class SitmarUpdateTweetBody(BaseModel):
    index: int
    text: str


class SitmarPostedBody(BaseModel):
    post_url: str | None = None
    tweet_index: int


class SitmarReplyBody(BaseModel):
    post_text: str
    post_author: str = ""
    feedback: str = ""


class SitmarDistributeSentBody(BaseModel):
    post_key: str
    reply: str = ""
    post: dict[str, Any] = {}


class SitmarDistributeSkipBody(BaseModel):
    post_key: str


class SitmarPostUrlBody(BaseModel):
    post_url: str


def brand_synthesis_text(snapshot: dict[str, Any]) -> str:
    synthesis = str(snapshot.get("brand_synthesis") or "").strip()
    return synthesis if synthesis else "not available"


def resolved_brand_name(snapshot: dict[str, Any]) -> str:
    name = str(
        snapshot.get("business_name") or snapshot.get("website_synthesis_business_name") or ""
    ).strip()
    if name:
        return name
    return brand_name(domain_of(str(snapshot.get("website_url") or "")))


def resolved_brand_logo(snapshot: dict[str, Any]) -> str:
    """promoted brand logo if one was extracted, else a favicon for the domain."""
    logo = str(snapshot.get("website_synthesis_business_logo_url") or "").strip()
    if logo:
        return logo
    host = domain_of(str(snapshot.get("website_url") or ""))
    if not host:
        return ""
    return f"https://www.google.com/s2/favicons?domain={host}&sz=128"


def _audience_candidates_for_story(
    brand_audiences: list[Any], inhouse_ids: set[str]
) -> list[dict[str, Any]]:
    """brand-audiences whose matched in-house audience saw this story, score desc."""
    out: list[dict[str, Any]] = []
    for i, ba in enumerate(brand_audiences):
        if not isinstance(ba, dict):
            continue
        match = ba.get("match")
        if not isinstance(match, dict):
            continue
        aid = str(match.get("audience_id") or "").strip()
        if not aid or aid not in inhouse_ids:
            continue
        out.append(
            {
                "brand_index": i,
                "title": str(ba.get("title") or "").strip(),
                "description": str(ba.get("description") or "").strip(),
                "score": match.get("score"),
                "inhouse_audience_id": aid,
                "inhouse_title": str(match.get("title") or "").strip(),
                "inhouse_description": str(match.get("description") or "").strip(),
            }
        )
    out.sort(key=lambda c: (c["score"] is not None, c["score"] or 0), reverse=True)
    return out


async def _brand_twitter_for_company(company_id: str) -> dict[str, Any] | None:
    company = await db.get_company(company_id)
    if not company:
        return None
    handle = str(company.twitter_handle or "").strip().lstrip("@")
    if not handle:
        return None
    name = str(company.business_name or "").strip() or None
    return {
        "handle": handle,
        "name": name,
        "profile_image_url": str(company.logo_url or "").strip() or None,
        "verified": None,
    }


def _parse_list_campaign_row(row: dict[str, Any]) -> dict[str, Any]:
    item = {k: v for k, v in row.items() if not k.endswith("_json")}
    if "selected_seed_json" in row:
        item["selected_seed"] = _loads_json_dict(row["selected_seed_json"]) or None
    if "tweets_json" in row:
        item["tweets"] = _loads_json_list(row["tweets_json"])
    return item


async def _enrich_campaign(campaign: Any) -> dict[str, Any]:
    """campaign dict enriched with the brand's twitter account info."""
    data = campaign.to_dict()
    inhouse = data.get("inhouse_audience")
    if isinstance(inhouse, dict):
        audience_id = str(inhouse.get("id") or "").strip()
        if audience_id and not inhouse.get("member_image_url"):
            member = (await db.get_audience_members([audience_id])).get(audience_id)
            if member:
                image_key = str(member.get("profile_image_s3_key") or "").strip()
                inhouse["member_handle"] = str(member.get("handle") or "").strip() or None
                inhouse["member_image_url"] = cdn_assets.cdn_url(image_key)
        brand_audience = data.get("brand_audience")
        if isinstance(brand_audience, dict):
            brand_audience.setdefault("member_handle", inhouse.get("member_handle"))
            brand_audience.setdefault("member_image_url", inhouse.get("member_image_url"))
    data["brand_twitter"] = await _brand_twitter_for_company(campaign.company_id)
    return data


async def _require_campaign_owner(campaign_id: str, user_id: str) -> SituationalCampaign:
    campaign = await db.get_situational_campaign(campaign_id)
    if campaign is None:
        raise HTTPException(status_code=404, detail="Campaign not found.")
    if campaign.user_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden.")
    return campaign


@router.get("/api/sitmar")
async def list_sitmar(user_id: str = Depends(require_auth)) -> JSONResponse:
    raw = await db.list_user_campaigns(user_id)
    brand_twitter_cache: dict[str, dict[str, Any] | None] = {}
    campaigns: list[dict[str, Any]] = []
    for row in raw:
        item = _parse_list_campaign_row(row)
        if str(item.get("status") or "").lower() == "posted":
            company_id = str(item.get("company_id") or "")
            if company_id and company_id not in brand_twitter_cache:
                brand_twitter_cache[company_id] = await _brand_twitter_for_company(company_id)
            item["brand_twitter"] = brand_twitter_cache.get(company_id)
        campaigns.append(item)
    return JSONResponse(content=bucket_content_history(campaigns))


@router.get("/api/sitmar/prompt-defaults")
async def sitmar_prompt_defaults() -> JSONResponse:
    prefix, directives = build_sitmar_chat_system_prompt()
    return JSONResponse(content={"prefix": prefix, "directives": directives})


@router.get("/api/sitmar/options/{company_id}")
async def sitmar_options(company_id: str, request: Request) -> JSONResponse:
    """stories connected to the brand via an audience, each with the selectable
    brand-audiences that saw it (default = highest match score)."""
    await require_company_access(request, company_id)
    company = await db.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    snapshot = company.to_dict()
    brand_audiences = snapshot.get("audience") or []
    stories = await collect_audience_trends(matched_audience_ids(snapshot))
    story_ids = [str(s.get("story_id") or "") for s in stories]
    existing = await db.get_brand_story_scores(company_id, story_ids)
    attach_brand_scores(stories, existing)
    options: list[dict[str, Any]] = []
    all_inhouse_ids: set[str] = set()
    for story in stories:
        for a in story.get("audiences", []):
            aid = str(a.get("audience_id") or "").strip()
            if aid:
                all_inhouse_ids.add(aid)
    members = await db.get_audience_members(list(all_inhouse_ids)) if all_inhouse_ids else {}
    for story in stories:
        inhouse_ids = {str(a.get("audience_id") or "") for a in story.get("audiences", [])}
        candidates = _audience_candidates_for_story(brand_audiences, inhouse_ids)
        if not candidates:
            continue
        for c in candidates:
            m = members.get(c["inhouse_audience_id"])
            image_key = str((m or {}).get("profile_image_s3_key") or "").strip()
            c["member_handle"] = str((m or {}).get("handle") or "").strip() if m else None
            c["member_image_key"] = image_key or None
            c["member_image_url"] = cdn_assets.cdn_url(image_key)
        options.append(
            {
                "story_id": story["story_id"],
                "headline": story.get("headline"),
                "summary": story.get("summary"),
                "topic_category": story.get("topic_category"),
                "post_count": story.get("post_count"),
                "brand_score": story.get("brand_score"),
                "story_last_seen_at": story.get("story_last_seen_at"),
                "audiences": candidates,
            }
        )
    return JSONResponse(content={"stories": options})


@router.get("/api/sitmar/{campaign_id}/status")
async def get_sitmar_status(campaign_id: str, user_id: str = Depends(require_auth)) -> JSONResponse:
    campaign = await _require_campaign_owner(campaign_id, user_id)
    return JSONResponse(
        content={
            "id": campaign.id,
            "status": campaign.status,
            "updated_at": campaign.updated_at,
        }
    )


@router.get("/api/sitmar/{campaign_id}")
async def get_sitmar(campaign_id: str, user_id: str = Depends(require_auth)) -> JSONResponse:
    campaign = await _require_campaign_owner(campaign_id, user_id)
    return JSONResponse(content={"campaign": await _enrich_campaign(campaign)})


async def _resolve_campaign_inputs(body: CreateSitmarBody) -> dict[str, Any]:
    """validate the brand/story/audience selection and resolve the snapshot fields."""
    company = await db.get_company(body.company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    snapshot = company.to_dict()
    brand_audiences = snapshot.get("audience") or []

    stories = await collect_audience_trends(matched_audience_ids(snapshot))
    story = next((s for s in stories if s["story_id"] == body.story_id), None)
    if story is None:
        raise HTTPException(status_code=400, detail="Story is not connected to this brand.")

    inhouse_ids = {str(a.get("audience_id") or "") for a in story.get("audiences", [])}
    candidates = _audience_candidates_for_story(brand_audiences, inhouse_ids)
    if not candidates:
        raise HTTPException(status_code=400, detail="No audience has seen this story.")
    if body.brand_audience_index is None:
        chosen = candidates[0]
    else:
        chosen = next(
            (c for c in candidates if c["brand_index"] == body.brand_audience_index), None
        )
        if chosen is None:
            raise HTTPException(status_code=400, detail="Selected audience did not see this story.")

    return {
        "snapshot": snapshot,
        "chosen": chosen,
        "brand_name": resolved_brand_name(snapshot),
        "brand_synthesis": brand_synthesis_text(snapshot),
        "story_title": str(story.get("headline") or "").strip(),
        "story_summary": str(story.get("summary") or "").strip(),
        "story": story,
    }


@router.post("/api/sitmar")
async def create_sitmar(
    body: CreateSitmarBody, user_id: str = Depends(require_auth)
) -> JSONResponse:
    await check_campaign_quota(user_id)
    r = await _resolve_campaign_inputs(body)
    chosen = r["chosen"]
    campaign = await db.create_situational_campaign(
        company_id=body.company_id,
        story_id=body.story_id,
        title=SITMAR_TITLE_PLACEHOLDER,
        brand_name=r["brand_name"],
        brand_synthesis=r["brand_synthesis"],
        brand_logo_url=resolved_brand_logo(r["snapshot"]),
        story_title=r["story_title"],
        story_summary=r["story_summary"],
        brand_audience={
            "title": chosen["title"],
            "description": chosen["description"],
            "member_handle": chosen.get("member_handle"),
            "member_image_url": chosen.get("member_image_url"),
        },
        inhouse_audience={
            "id": chosen["inhouse_audience_id"],
            "title": chosen["inhouse_title"],
            "description": chosen["inhouse_description"],
            "member_handle": chosen.get("member_handle"),
            "member_image_url": chosen.get("member_image_url"),
        },
        status="thinking",
        user_id=user_id,
    )
    story = r["story"]
    await db.append_sitmar_message(
        campaign.id,
        {
            "role": "user",
            "type": "story_context",
            "story_id": body.story_id,
            "headline": r["story_title"],
            "summary": r["story_summary"],
            "topic_category": str(story.get("topic_category") or "").strip(),
            "post_count": story.get("post_count") or 0,
            "last_seen_at": story.get("story_last_seen_at") or story.get("last_updated_at"),
            "brand_score": story.get("brand_score"),
            "source_url": str(story.get("source_url") or "").strip(),
            "x_trend_id": str(story.get("x_trend_id") or "").strip(),
        },
    )
    campaign = await db.get_situational_campaign(campaign.id)
    asyncio.create_task(_run_chat_turn(campaign.id, system_prompt_prefix=body.system_prompt_prefix))
    return JSONResponse(
        content={"campaign": await _enrich_campaign(campaign), "status": "thinking"}
    )


@router.post("/api/sitmar/{campaign_id}/message")
async def sitmar_message(
    campaign_id: str, body: SitmarMessageBody, user_id: str = Depends(require_auth)
) -> dict[str, str]:
    campaign = await _require_campaign_owner(campaign_id, user_id)
    if campaign.status != "posted":
        await check_campaign_quota(user_id)
    text = (body.text or "").strip()
    if body.regenerate:
        if campaign.status != "ready":
            raise HTTPException(status_code=400, detail="Regenerate only allowed in ready state.")
        await db.append_sitmar_message(
            campaign_id,
            {"role": "user", "text": SITMAR_REGENERATE_USER_TEXT},
        )
        await db.set_sitmar_stage(campaign_id, status="thinking", error=None)
        asyncio.create_task(_run_chat_turn(campaign_id))
        return {"status": "thinking"}

    if not text:
        raise HTTPException(status_code=400, detail="Message is empty.")

    if campaign.status == "drafted":
        tweets = campaign.tweets or []
        if body.tweet_index is None or not (0 <= body.tweet_index < len(tweets)):
            raise HTTPException(status_code=400, detail="Invalid tweet index.")
        await db.append_sitmar_message(campaign_id, {"role": "user", "text": text})
        await db.set_sitmar_stage(campaign_id, status="thinking", error=None)
        asyncio.create_task(_run_tweet_refine(campaign_id, body.tweet_index, text))
        return {"status": "thinking"}

    await db.append_sitmar_message(campaign_id, {"role": "user", "text": text})
    await db.set_sitmar_stage(campaign_id, status="thinking", error=None)
    if campaign.status == "selected":
        asyncio.create_task(_run_seed_confirm(campaign_id, feedback=text))
    else:
        asyncio.create_task(_run_chat_turn(campaign_id))
    return {"status": "thinking"}


@router.post("/api/sitmar/{campaign_id}/select")
async def sitmar_select(
    campaign_id: str, body: SitmarSelectBody, user_id: str = Depends(require_auth)
) -> dict[str, str]:
    campaign = await _require_campaign_owner(campaign_id, user_id)
    await check_campaign_quota(user_id)
    seeds = _latest_seeds(campaign.messages)
    if not (0 <= body.seed_index < len(seeds)):
        raise HTTPException(status_code=400, detail="Invalid seed selection.")
    chosen = seeds[body.seed_index]
    chosen_title = str(chosen.get("title") or "").strip()
    await db.set_sitmar_selected_seed(
        campaign_id,
        {
            "title": chosen_title,
            "blurb": str(chosen.get("blurb") or "").strip(),
        },
    )
    await db.append_sitmar_message(
        campaign_id,
        {"role": "user", "text": chosen_title or "Selected direction"},
    )
    await db.set_sitmar_stage(campaign_id, status="drafting", error=None)
    asyncio.create_task(_run_tweet_gen(campaign_id))
    return {"status": "drafting"}


@router.post("/api/sitmar/{campaign_id}/post")
async def sitmar_post(campaign_id: str, user_id: str = Depends(require_auth)) -> dict[str, str]:
    campaign = await _require_campaign_owner(campaign_id, user_id)
    await check_campaign_quota(user_id)
    if campaign.status != "selected":
        raise HTTPException(status_code=400, detail="Campaign not in selected state.")
    await db.set_sitmar_stage(campaign_id, status="drafting", error=None)
    asyncio.create_task(_run_tweet_gen(campaign_id))
    return {"status": "drafting"}


@router.post("/api/sitmar/{campaign_id}/regenerate-tweets")
async def sitmar_regenerate_tweets(
    campaign_id: str, user_id: str = Depends(require_auth)
) -> dict[str, str]:
    await _require_campaign_owner(campaign_id, user_id)
    await check_campaign_quota(user_id)
    await db.set_sitmar_stage(campaign_id, status="drafting", error=None)
    asyncio.create_task(_run_tweet_gen(campaign_id))
    return {"status": "drafting"}


@router.post("/api/sitmar/{campaign_id}/update-tweet")
async def sitmar_update_tweet(
    campaign_id: str, body: SitmarUpdateTweetBody, user_id: str = Depends(require_auth)
) -> dict[str, str]:
    campaign = await _require_campaign_owner(campaign_id, user_id)
    await check_campaign_quota(user_id)
    tweets = campaign.tweets or []
    if not (0 <= body.index < len(tweets)):
        raise HTTPException(status_code=400, detail="Invalid tweet index.")
    tweets[body.index]["text"] = body.text.strip()[:280]
    await db.set_sitmar_tweets(campaign_id, tweets)
    return {"status": "ok"}


@router.post("/api/sitmar/{campaign_id}/posted")
async def sitmar_posted(
    campaign_id: str, body: SitmarPostedBody, user_id: str = Depends(require_auth)
) -> dict[str, str]:
    campaign = await _require_campaign_owner(campaign_id, user_id)
    await check_campaign_quota(user_id)
    if campaign.status != "drafted":
        raise HTTPException(status_code=400, detail="Campaign not in drafted state.")
    url = (body.post_url or "").strip() or None
    if url and not (url.startswith("https://x.com/") or url.startswith("https://twitter.com/")):
        raise HTTPException(status_code=400, detail="URL must be an x.com or twitter.com link.")
    tweets = campaign.tweets or []
    if not (0 <= body.tweet_index < len(tweets)):
        raise HTTPException(status_code=400, detail="Invalid tweet index.")
    await db.set_sitmar_posted(campaign_id, post_url=url, posted_tweet_index=body.tweet_index)
    return {"status": "posted"}


@router.post("/api/sitmar/{campaign_id}/reply")
async def sitmar_reply(
    campaign_id: str, body: SitmarReplyBody, user_id: str = Depends(require_auth)
) -> dict[str, str]:
    campaign = await _require_campaign_owner(campaign_id, user_id)
    if campaign.status != "posted":
        raise HTTPException(status_code=400, detail="Campaign must be posted.")
    seed = campaign.selected_seed or {}
    tweet_idx = seed.get("posted_tweet_index") or 0
    tweets = campaign.tweets or []
    brand_tweet = tweets[tweet_idx]["text"] if tweet_idx < len(tweets) else ""
    reply = await generate_sitmar_reply(
        brand_name=campaign.brand_name or "",
        brand_synthesis=campaign.brand_synthesis or "",
        brand_tweet=brand_tweet,
        story_title=campaign.story_title or "",
        story_summary=campaign.story_summary or "",
        target_post_text=(body.post_text or "").strip(),
        target_post_author=(body.post_author or "").strip(),
        feedback=(body.feedback or "").strip(),
    )
    return {"reply": reply}


@router.post("/api/sitmar/{campaign_id}/distribute-sent")
async def sitmar_distribute_sent(
    campaign_id: str,
    body: SitmarDistributeSentBody,
    user_id: str = Depends(require_auth),
) -> dict[str, str]:
    campaign = await _require_campaign_owner(campaign_id, user_id)
    if campaign.status != "posted":
        raise HTTPException(status_code=400, detail="Campaign must be posted.")
    post_key = (body.post_key or "").strip()
    if not post_key:
        raise HTTPException(status_code=400, detail="post_key is required.")
    await db.append_sitmar_distribute_sent(
        campaign_id,
        post_key=post_key,
        reply=(body.reply or "").strip(),
        post=body.post or {},
    )
    return {"status": "ok"}


@router.post("/api/sitmar/{campaign_id}/distribute-skip")
async def sitmar_distribute_skip(
    campaign_id: str,
    body: SitmarDistributeSkipBody,
    user_id: str = Depends(require_auth),
) -> dict[str, str]:
    campaign = await _require_campaign_owner(campaign_id, user_id)
    if campaign.status != "posted":
        raise HTTPException(status_code=400, detail="Campaign must be posted.")
    post_key = (body.post_key or "").strip()
    if not post_key:
        raise HTTPException(status_code=400, detail="post_key is required.")
    await db.append_sitmar_distribute_dismissed(campaign_id, post_key=post_key)
    return {"status": "ok"}


@router.post("/api/sitmar/{campaign_id}/post-url")
async def sitmar_update_post_url(
    campaign_id: str, body: SitmarPostUrlBody, user_id: str = Depends(require_auth)
) -> dict[str, str]:
    campaign = await _require_campaign_owner(campaign_id, user_id)
    if campaign.status != "posted":
        raise HTTPException(status_code=400, detail="Campaign must be posted.")
    url = (body.post_url or "").strip()
    if not (url.startswith("https://x.com/") or url.startswith("https://twitter.com/")):
        raise HTTPException(status_code=400, detail="URL must be an x.com or twitter.com link.")
    await db.set_sitmar_post_url(campaign_id, post_url=url)
    return {"status": "ok", "post_url": url}


@router.delete("/api/sitmar/{campaign_id}", status_code=204)
async def delete_sitmar(campaign_id: str, user_id: str = Depends(require_auth)) -> None:
    await _require_campaign_owner(campaign_id, user_id)
    await sitmar_storage.delete_campaign_images(campaign_id)
    deleted = await db.delete_situational_campaign(campaign_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Campaign not found.")


def _latest_seeds(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """the live tappable chips = the seeds of the latest assistant turn."""
    for turn in reversed(messages or []):
        if isinstance(turn, dict) and turn.get("role") == "assistant":
            seeds = turn.get("seeds")
            return seeds if isinstance(seeds, list) else []
    return []


async def _run_chat_turn(campaign_id: str, *, system_prompt_prefix: str | None = None) -> None:
    """generate one assistant turn (opener or revise) + set the title on opener."""
    campaign = await db.get_situational_campaign(campaign_id)
    if campaign is None:
        return
    is_opener = not _latest_seeds(campaign.messages)
    try:
        turn = await generate_sitmar_chat_turn(
            brand_name=campaign.brand_name,
            brand_synthesis=campaign.brand_synthesis,
            audience_title=str(campaign.brand_audience.get("title") or ""),
            audience_description=str(campaign.brand_audience.get("description") or ""),
            story_title=campaign.story_title,
            story_summary=campaign.story_summary,
            messages=campaign.messages,
            system_prompt_prefix=system_prompt_prefix,
        )
        await db.append_sitmar_message(campaign_id, turn)
        if is_opener:
            title = await generate_sitmar_title(
                brand_name=campaign.brand_name, story_title=campaign.story_title
            )
            await db.set_sitmar_title(campaign_id, title)
        await db.set_sitmar_stage(campaign_id, status="ready", error=None)
        log.info("sitmar_chat_turn campaign=%s opener=%s", campaign_id, is_opener)
    except Exception as e:  # noqa: BLE001
        await _settle_placeholder_title(campaign)
        await db.set_sitmar_stage(
            campaign_id,
            status="error",
            error=(str(e).strip() or "chat turn failed")[:500],
        )
        log.warning("sitmar_chat_turn_failed campaign=%s err=%r", campaign_id, e)


async def _run_seed_confirm(campaign_id: str, feedback: str | None = None) -> None:
    """second turn before tweets: confirm the seed and offer vibe chips.

    a freeform chat message here revises the seed instead of jumping to drafts.
    """
    campaign = await db.get_situational_campaign(campaign_id)
    if campaign is None:
        return
    seed = campaign.selected_seed or {}
    try:
        result = await generate_sitmar_seed_confirm(
            brand_name=campaign.brand_name,
            brand_synthesis=campaign.brand_synthesis,
            story_title=campaign.story_title,
            story_summary=campaign.story_summary,
            seed_title=str(seed.get("title") or ""),
            seed_blurb=str(seed.get("blurb") or ""),
            feedback=feedback,
        )
        await db.append_sitmar_message(
            campaign_id,
            {
                "role": "assistant",
                "message": result["message"],
                "vibes": result["vibes"],
            },
        )
        await db.set_sitmar_selected_seed(
            campaign_id,
            {
                "title": result["title"],
                "blurb": result["blurb"],
            },
        )
        await db.set_sitmar_stage(campaign_id, status="selected", error=None)
        log.info("sitmar_seed_confirm campaign=%s feedback=%s", campaign_id, feedback is not None)
    except Exception as e:  # noqa: BLE001
        await db.set_sitmar_stage(
            campaign_id,
            status="error",
            error=(str(e).strip() or "seed confirm failed")[:500],
        )
        log.warning("sitmar_seed_confirm_failed campaign=%s err=%r", campaign_id, e)


async def _run_tweet_gen(campaign_id: str) -> None:
    """generate 3 draft tweets (recommended / provocative / casual) from the seed."""
    campaign = await db.get_situational_campaign(campaign_id)
    if campaign is None:
        return
    seed = campaign.selected_seed or {}
    audience = campaign.brand_audience or {}
    try:
        tweets = await generate_sitmar_tweets(
            brand_name=campaign.brand_name,
            brand_synthesis=campaign.brand_synthesis,
            audience_title=str(audience.get("title") or ""),
            audience_description=str(audience.get("description") or ""),
            story_title=campaign.story_title,
            story_summary=campaign.story_summary,
            seed_title=str(seed.get("title") or ""),
            seed_blurb=str(seed.get("blurb") or ""),
        )
        await db.set_sitmar_tweets(campaign_id, tweets)
        await db.set_sitmar_stage(campaign_id, status="drafted", error=None)
        log.info("sitmar_tweet_gen campaign=%s count=%d", campaign_id, len(tweets))
    except Exception as e:  # noqa: BLE001
        await db.set_sitmar_stage(
            campaign_id, status="error", error=(str(e).strip() or "tweet gen failed")[:500]
        )
        log.warning("sitmar_tweet_gen_failed campaign=%s err=%r", campaign_id, e)


async def _run_tweet_refine(campaign_id: str, tweet_index: int, feedback: str) -> None:
    """revise one draft tweet from marketer feedback; other tweets unchanged."""
    campaign = await db.get_situational_campaign(campaign_id)
    if campaign is None:
        return
    tweets = list(campaign.tweets or [])
    if not (0 <= tweet_index < len(tweets)):
        await db.set_sitmar_stage(
            campaign_id,
            status="error",
            error="invalid tweet index for refine",
        )
        return
    tweet = tweets[tweet_index]
    seed = campaign.selected_seed or {}
    audience = campaign.brand_audience or {}
    try:
        revised = await generate_sitmar_tweet_refine(
            brand_name=campaign.brand_name,
            brand_synthesis=campaign.brand_synthesis,
            audience_title=str(audience.get("title") or ""),
            audience_description=str(audience.get("description") or ""),
            story_title=campaign.story_title,
            story_summary=campaign.story_summary,
            seed_title=str(seed.get("title") or ""),
            seed_blurb=str(seed.get("blurb") or ""),
            route=str(tweet.get("route") or ""),
            current_text=str(tweet.get("text") or ""),
            feedback=feedback,
        )
        tweets[tweet_index] = {**tweet, "text": revised}
        await db.set_sitmar_tweets(campaign_id, tweets)
        await db.set_sitmar_stage(campaign_id, status="drafted", error=None)
        log.info("sitmar_tweet_refine campaign=%s index=%d", campaign_id, tweet_index)
    except Exception as e:  # noqa: BLE001
        await db.set_sitmar_stage(
            campaign_id,
            status="error",
            error=(str(e).strip() or "tweet refine failed")[:500],
        )
        log.warning("sitmar_tweet_refine_failed campaign=%s err=%r", campaign_id, e)


async def _settle_placeholder_title(campaign: Any) -> None:
    """on opener failure, replace the placeholder so the sidebar doesn't read as
    if a job were still running."""
    if campaign.title == SITMAR_TITLE_PLACEHOLDER:
        fallback = f"{campaign.brand_name or 'Brand'} × {campaign.story_title or 'story'}"[:80]
        await db.set_sitmar_title(campaign.id, fallback)
