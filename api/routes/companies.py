from __future__ import annotations

import asyncio

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from api.auth import (
    optional_bearer_claims,
    require_company_access,
    require_no_company_association,
    user_has_active_subscription,
)
from api.db.sqlite import db
from api.features.brand_pipeline import (
    attach_brand_scores,
    collect_audience_trends,
    collect_audience_trends_for_companies,
    collect_brand_audiences,
    collect_company_stories_page,
    fetch_synthesis_homepage_excerpt,
    generate_and_store_website_synthesis,
    matched_audience_ids,
    maybe_resume_stalled_onboarding,
    run_audience_match_stage,
    run_audience_then_match,
    run_audience_trends_stage,
    run_brand_scoring_stage,
    run_brand_synthesis_stage,
    run_linkedin_company_stage,
    run_website_onboarding,
)
from api.features.companies import get_or_create_company
from api.features.company_pipeline import company_website_onboarding_processed
from ingestion.web.brand_site import WebsiteFetchError, normalize_public_website_url
from ingestion.web.jina import brand_name, domain_of

router = APIRouter()


class CreateCompanyBody(BaseModel):
    website_url: str

    @field_validator("website_url")
    @classmethod
    def _normalize_public_url(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("must not be empty")
        try:
            return normalize_public_website_url(v)
        except WebsiteFetchError as e:
            raise ValueError(str(e)) from e


class SocialEntry(BaseModel):
    platform: str
    handle: str
    url: str = ""
    source: str = "scraped"
    confidence: float | None = None

    @field_validator("platform")
    @classmethod
    def _platform(cls, v: str) -> str:
        v = (v or "").strip().lower()
        if not v:
            raise ValueError("platform must not be empty")
        return v

    @field_validator("handle")
    @classmethod
    def _handle(cls, v: str) -> str:
        v = (v or "").strip().lstrip("@")
        if not v:
            raise ValueError("handle must not be empty")
        return v


class UpdateSocialsBody(BaseModel):
    socials: list[SocialEntry] = Field(default_factory=list)


def _twitter_handle_from_socials(socials: list[SocialEntry]) -> str | None:
    for entry in socials:
        if entry.platform.lower() in ("twitter", "twitter.com", "x.com"):
            return entry.handle.lstrip("@").strip() or None
    return None


def _resolved_company_logo_url(website_url: str, logo_url: str | None) -> str:
    stored = str(logo_url or "").strip()
    if stored:
        return stored
    host = domain_of(str(website_url or ""))
    if not host:
        return ""
    return f"https://www.google.com/s2/favicons?domain={host}&sz=128"


async def list_companies() -> JSONResponse:
    summaries = await db.list_companies_summary()
    return JSONResponse(content={"companies": summaries})


async def list_ops_companies() -> JSONResponse:
    summaries = await db.list_companies_summary()
    companies = [
        {
            **row,
            "logo_url": _resolved_company_logo_url(row["website_url"], row.get("logo_url")),
        }
        for row in summaries
    ]
    return JSONResponse(content={"companies": companies})


@router.post("/api/companies")
async def create_company(
    body: CreateCompanyBody,
    _: None = Depends(require_no_company_association),
) -> JSONResponse:
    try:
        normalized = normalize_public_website_url(body.website_url)
    except WebsiteFetchError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    existing = await db.get_company_by_url(normalized)
    try:
        company = await get_or_create_company(body.website_url)
    except WebsiteFetchError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    created = existing is None
    status = "existing"
    if created:
        await db.reset_company_homepage_crawl(company.id)
        asyncio.create_task(run_website_onboarding(company.id, company.website_url))
        status = "onboarding_started"
    else:
        stages = await db.get_company_stages(company.id)
        if not company_website_onboarding_processed(stages):
            asyncio.create_task(run_website_onboarding(company.id, company.website_url))
            status = "onboarding_started"
    refreshed = await db.get_company(company.id)
    return JSONResponse(
        content={
            "company": (refreshed or company).to_dict(),
            "status": status,
            "created": created,
        }
    )


async def delete_company(
    company_id: str,
) -> None:
    deleted = await db.delete_company(company_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Company not found.")


def _stage_row(
    status: str | None,
    error: str | None,
    model: str | None,
    updated_at: float | None,
) -> dict[str, object]:
    return {
        "status": (status or "idle").strip().lower() or "idle",
        "error": error,
        "model": model,
        "updated_at": updated_at,
    }


@router.get("/api/company/{company_id}")
async def get_company(
    company_id: str,
    request: Request,
) -> JSONResponse:
    await require_company_access(request, company_id)
    company = await db.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    return JSONResponse(content={"company": company.to_dict()})


@router.get("/api/company/{company_id}/stages")
async def get_company_stages_endpoint(
    company_id: str,
    request: Request,
) -> JSONResponse:
    await require_company_access(request, company_id)
    asyncio.create_task(maybe_resume_stalled_onboarding(company_id))
    stages = await db.get_company_stages(company_id)
    if not stages:
        company = await db.get_company(company_id)
        if company is None:
            raise HTTPException(status_code=404, detail="Company not found.")
    return JSONResponse(
        content={
            "company_id": company_id,
            "stages": {
                name: _stage_row(s.status, s.error, s.model, s.updated_at)
                for name, s in stages.items()
            },
        }
    )


async def put_company_socials(
    company_id: str,
    body: UpdateSocialsBody,
) -> JSONResponse:
    company = await db.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")

    new_twitter_handle = _twitter_handle_from_socials(body.socials)
    if new_twitter_handle:
        conflict = await db.find_twitter_handle_conflict(
            new_twitter_handle,
            company_id,
        )
        if conflict is not None:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": f"Twitter handle @{new_twitter_handle} is already used by another tracked brand.",
                    "hint": "Each twitter handle can only point at one brand at a time.",
                    "conflicting_company_id": conflict["id"],
                    "conflicting_website_url": conflict["website_url"],
                },
            )

    serialized = [entry.model_dump() for entry in body.socials]
    await db.set_company_socials(
        company_id,
        serialized,
        twitter_handle_manual=True,
    )

    refreshed = await db.get_company(company_id)
    return JSONResponse(content={"company": (refreshed or company).to_dict()})


async def rediscover_company_socials(
    company_id: str,
) -> JSONResponse:
    company = await db.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")

    await db.clear_company_socials(company_id)

    refreshed = await db.get_company(company_id)
    return JSONResponse(content={"company": (refreshed or company).to_dict()})


async def refresh_website_synthesis(
    company_id: str,
) -> JSONResponse:
    company = await db.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    homepage_excerpt, homepage_excerpt_source = await fetch_synthesis_homepage_excerpt(
        company.website_url
    )
    terms = await generate_and_store_website_synthesis(
        company_id,
        homepage_url=company.website_url,
        homepage_markdown_excerpt=homepage_excerpt,
        source=homepage_excerpt_source,
    )
    refreshed = await db.get_company(company_id)
    # homepage_summary is an input to brand_synthesis; recompose in the
    # background so the change propagates to scoring without blocking this response.
    if refreshed and refreshed.audiences:
        asyncio.create_task(run_brand_synthesis_stage(company_id, refreshed.to_dict()))
    return JSONResponse(
        content={
            "status": "done",
            "search_terms": terms,
            "company": (refreshed or company).to_dict(),
        }
    )


async def refresh_audience(
    company_id: str,
    background: BackgroundTasks,
) -> dict[str, str]:
    company = await db.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    await db.set_audience_stage(company_id, status="running", error=None)
    await db.set_audience_match_stage(company_id, status="running", error=None)
    background.add_task(run_audience_then_match, company_id, company.to_dict())
    return {"status": "running"}


async def refresh_audience_match(
    company_id: str,
    background: BackgroundTasks,
) -> dict[str, str]:
    company = await db.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    await db.set_audience_match_stage(company_id, status="running", error=None)
    background.add_task(run_audience_match_stage, company_id, company.to_dict())
    return {"status": "running"}


async def refresh_brand_scoring(
    company_id: str,
    background: BackgroundTasks,
) -> dict[str, str]:
    company = await db.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    await db.set_brand_scoring_stage(company_id, status="running", error=None)
    background.add_task(run_brand_scoring_stage, company_id)
    return {"status": "running"}


async def refresh_brand_synthesis(
    company_id: str,
    background: BackgroundTasks,
) -> dict[str, str]:
    company = await db.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    await db.set_brand_synthesis_stage(company_id, status="running", error=None)
    background.add_task(run_brand_synthesis_stage, company_id, company.to_dict())
    return {"status": "running"}


@router.get("/api/company/{company_id}/stories")
async def get_company_stories(
    company_id: str,
    request: Request,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=10, ge=1, le=50),
    posts_per_story: int = Query(default=3, ge=0, le=20),
) -> JSONResponse:
    user_id = await require_company_access(request, company_id)
    company = await db.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    stories = await collect_company_stories_page(
        company_id,
        company.to_dict(),
        offset=offset,
        limit=limit,
        posts_per_story=posts_per_story,
    )
    claims = await optional_bearer_claims(request)
    gated = not await user_has_active_subscription(user_id, claims)
    return JSONResponse(content={"stories": stories, "gated": gated})


@router.get("/api/company/{company_id}/brand-audiences")
async def get_company_brand_audiences(
    company_id: str,
    request: Request,
) -> JSONResponse:
    await require_company_access(request, company_id)
    asyncio.create_task(maybe_resume_stalled_onboarding(company_id))
    company = await db.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    audiences = await collect_brand_audiences(company_id, company.to_dict())
    return JSONResponse(content={"audiences": audiences})


@router.get("/api/company/{company_id}/audience-trends")
async def get_company_audience_trends(
    company_id: str,
    request: Request,
    posts_per_story: int = Query(default=0, ge=0, le=20),
) -> JSONResponse:
    await require_company_access(request, company_id)
    company = await db.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    snapshot = company.to_dict()
    stories = await collect_audience_trends(
        matched_audience_ids(snapshot), per_story_post_limit=posts_per_story
    )

    story_ids = [str(s.get("story_id") or "") for s in stories]
    existing = await db.get_brand_story_scores(company_id, story_ids)
    attach_brand_scores(stories, existing)

    at_stage = company._stage("audience_trends")
    return JSONResponse(
        content={
            "status": at_stage.status,
            "error": at_stage.error,
            "updated_at": at_stage.updated_at,
            "stories": stories,
        }
    )


async def get_companies_audience_trends(
    posts_per_story: int = Query(default=3, ge=0, le=20),
    story_limit: int = Query(default=0, ge=0, le=200),
) -> JSONResponse:
    companies = await db.list_companies()
    company_audience_ids = {
        company.id: matched_audience_ids(company.to_dict()) for company in companies
    }
    stories_by_company = await collect_audience_trends_for_companies(
        company_audience_ids,
        per_story_post_limit=posts_per_story,
        per_company_story_limit=story_limit,
    )
    payload: dict[str, dict[str, object]] = {}
    for company in companies:
        stories = stories_by_company.get(company.id, [])
        story_ids = [str(story.get("story_id") or "") for story in stories]
        existing = await db.get_brand_story_scores(company.id, story_ids)
        attach_brand_scores(stories, existing)
        at_stage = company._stage("audience_trends")
        payload[company.id] = {
            "status": at_stage.status,
            "error": at_stage.error,
            "updated_at": at_stage.updated_at,
            "stories": stories,
        }
    return JSONResponse(content={"companies": payload})


async def refresh_audience_trends(
    company_id: str,
    background: BackgroundTasks,
) -> dict[str, str]:
    company = await db.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    await db.set_audience_trends_stage(company_id, status="running", error=None)
    background.add_task(run_audience_trends_stage, company_id, company.to_dict())
    return {"status": "running"}


async def refresh_linkedin_company(
    company_id: str,
    background: BackgroundTasks,
) -> dict[str, str]:
    company = await db.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")
    await db.set_linkedin_company_stage(company_id, status="running_discovery", error=None)
    syn = company.synthesis
    search_terms = (syn.website_synthesis_terms if syn else None) or [
        brand_name(domain_of(company.website_url))
    ]
    background.add_task(
        run_linkedin_company_stage,
        company_id,
        company.website_url,
        "",
        search_terms=search_terms,
    )
    return {"status": "running"}
