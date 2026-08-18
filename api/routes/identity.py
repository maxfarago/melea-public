from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from api.auth import PUBLIC_USER, require_ops_auth, resolve_user_company_id
from api.db.sqlite import db
from commons.config import settings

router = APIRouter()


def _profile_payload(user_row) -> dict[str, str | None]:
    if user_row is None:
        return {"email": None, "full_name": None, "image_url": None}
    return {
        "email": user_row.email or None,
        "full_name": user_row.full_name or None,
        "image_url": user_row.image_url or None,
    }


@router.get("/api/config")
async def config() -> dict:
    return {"ga_measurement_id": settings.ga_measurement_id.strip()}


@router.get("/api/me")
async def me() -> dict:
    company_id = await resolve_user_company_id(PUBLIC_USER)
    user_row = await db.get_user_by_clerk_id(PUBLIC_USER)
    return {
        "user_id": PUBLIC_USER,
        "company_id": company_id or None,
        "plan": "pro",
        "subscription_status": "active",
        **_profile_payload(user_row),
    }


class ClaimCompanyBody(BaseModel):
    company_id: str = Field(default="")


@router.post("/api/me/claim")
async def claim_company(body: ClaimCompanyBody) -> dict:
    existing = await db.get_user_by_clerk_id(PUBLIC_USER)
    if existing and existing.company_id:
        company = await db.get_company(existing.company_id)
        if company is None:
            raise HTTPException(status_code=404, detail="Company not found.")
        return {
            "company_id": existing.company_id,
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
    await db.upsert_user(PUBLIC_USER, company_id, email="", full_name="", image_url="")
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
