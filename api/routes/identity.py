from __future__ import annotations

from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from api.auth import (
    require_auth,
    require_claims,
    require_ops_auth,
    resolve_user_company_id,
)
from api.clerk_users import fetch_clerk_user_profile
from api.db.sqlite import db
from commons.config import settings

router = APIRouter()


def _request_ui_host(request: Request) -> str:
    origin = (request.headers.get("origin") or "").strip()
    if origin:
        return (urlparse(origin).hostname or "").lower()
    return (request.headers.get("host") or "").lower().split(":", 1)[0]


def _is_ops_ui_request(request: Request) -> bool:
    return _request_ui_host(request).startswith("ops.")


def _profile_payload(user_row) -> dict[str, str | None]:
    if user_row is None:
        return {"email": None, "full_name": None, "image_url": None}
    return {
        "email": user_row.email or None,
        "full_name": user_row.full_name or None,
        "image_url": user_row.image_url or None,
    }


async def _user_row_with_profile(user_id: str):
    row = await db.get_user_by_clerk_id(user_id)
    if row is None:
        return None
    if row.email or row.full_name or row.image_url:
        return row
    profile = await fetch_clerk_user_profile(user_id)
    if not any(profile.values()):
        return row
    await db.update_user_profile(user_id, **profile)
    return await db.get_user_by_clerk_id(user_id)


async def _create_user_with_profile(user_id: str, company_id: str):
    profile = await fetch_clerk_user_profile(user_id)
    return await db.upsert_user(user_id, company_id, **profile)


@router.get("/api/config")
async def config(request: Request) -> dict:
    """public bootstrap config for the no-build frontend.

    Returns the publishable key for whichever Clerk app the UI belongs to.
    Cross-origin static sites call from `Origin`; same-origin/local falls back
    to `Host` (ops.localhost, nginx-served dev, etc.).

    Only publishable keys are exposed (safe by design — they're public).
    """
    publishable_key = (
        settings.clerk_ops_publishable_key
        if _is_ops_ui_request(request)
        else settings.clerk_publishable_key
    )
    return {
        "clerk_publishable_key": publishable_key,
        "ga_measurement_id": settings.ga_measurement_id.strip(),
        "stripe_links": {
            "rise": {
                "monthly": settings.stripe_link_starter_monthly.strip(),
                "annual": settings.stripe_link_starter_annual.strip(),
            },
            "grow": {
                "monthly": settings.stripe_link_pro_monthly.strip(),
                "annual": settings.stripe_link_pro_annual.strip(),
            },
        },
    }


@router.get("/api/me")
async def me(request: Request, user: str = Depends(require_auth)) -> dict:
    claims = await require_claims(request)
    company_id = await resolve_user_company_id(user, claims)
    user_row = await _user_row_with_profile(user)
    plan, subscription_status = await db.get_user_plan(user)
    return {
        "user_id": user,
        "company_id": company_id or None,
        "plan": plan,
        "subscription_status": subscription_status,
        **_profile_payload(user_row),
    }


class ClaimCompanyBody(BaseModel):
    company_id: str = Field(default="")


@router.post("/api/me/claim")
async def claim_company(
    body: ClaimCompanyBody,
    request: Request,
    user: str = Depends(require_auth),
) -> dict:
    claims = await require_claims(request)
    existing = await db.get_user_by_clerk_id(user)
    if existing and existing.company_id:
        company = await db.get_company(existing.company_id)
        if company is None:
            raise HTTPException(status_code=404, detail="Company not found.")
        return {
            "company_id": existing.company_id,
            "company": company.to_dict(),
            "claimed": False,
        }

    from_metadata = await resolve_user_company_id(user, claims)
    if from_metadata:
        company = await db.get_company(from_metadata)
        if company is None:
            raise HTTPException(status_code=404, detail="Company not found.")
        await _create_user_with_profile(user, from_metadata)
        return {
            "company_id": from_metadata,
            "company": company.to_dict(),
            "claimed": False,
        }

    company_id = str(body.company_id or "").strip()
    if not company_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="company_id is required.",
        )

    company = await db.get_company(company_id)
    if company is None:
        raise HTTPException(status_code=404, detail="Company not found.")

    await _create_user_with_profile(user, company_id)
    return {
        "company_id": company_id,
        "company": company.to_dict(),
        "claimed": True,
    }


async def reset_user_brand(clerk_user_id: str) -> dict[str, bool]:
    clerk_user_id = str(clerk_user_id or "").strip()
    if not clerk_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="clerk_user_id is required.",
        )

    user = await db.get_user_by_clerk_id(clerk_user_id)
    if not user or not user.company_id:
        return {"ok": True, "changed": False}

    await db.clear_user_company_association(clerk_user_id)
    return {"ok": True, "changed": True}


async def reset_brand_for_ops(
    user: str = Depends(require_ops_auth),
) -> dict[str, bool]:
    return await reset_user_brand(user)
