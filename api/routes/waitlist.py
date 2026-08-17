from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import AnyHttpUrl, BaseModel, field_validator

from api.db.sqlite import db

router = APIRouter()


class WaitlistEntryBody(BaseModel):
    company_website: AnyHttpUrl
    email: str
    x_handle: str | None = None
    other_contacts: str | None = None

    @field_validator("email")
    @classmethod
    def _validate_email(cls, v: str) -> str:
        normalized = (v or "").strip().lower()
        if not normalized or "@" not in normalized:
            raise ValueError("email must be valid")
        local, _, domain = normalized.partition("@")
        if not local or "." not in domain:
            raise ValueError("email must be valid")
        return normalized

    @field_validator("x_handle", "other_contacts")
    @classmethod
    def _normalize_optional_text(cls, v: str | None) -> str | None:
        if v is None:
            return None
        normalized = v.strip()
        return normalized or None


@router.post("/waitlist")
async def create_waitlist_entry(body: WaitlistEntryBody):
    inserted = await db.insert_waitlist_entry(
        email=str(body.email),
        company_website=str(body.company_website),
        x_handle=body.x_handle,
        other_contacts=body.other_contacts,
    )
    if not inserted:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="email already on waitlist",
        )
    return {"ok": True}


async def list_waitlist_entries() -> JSONResponse:
    entries = await db.list_waitlist_entries()
    return JSONResponse(content={"entries": entries})
