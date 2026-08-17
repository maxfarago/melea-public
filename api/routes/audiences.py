from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from api.db.sqlite import db
from api.features import cdn_assets

router = APIRouter()


class AudienceBody(BaseModel):
    title: str
    description: str

    @field_validator("title", "description")
    @classmethod
    def _validate_required_text(cls, v: str) -> str:
        normalized = (v or "").strip()
        if not normalized:
            raise ValueError("field is required")
        return normalized


class AudienceMemberAssignBody(BaseModel):
    member_id: str

    @field_validator("member_id")
    @classmethod
    def _validate_member_id(cls, v: str) -> str:
        normalized = str(v or "").strip()
        if not normalized:
            raise ValueError("member_id is required")
        return normalized


async def _hydrate_audience_payload(audience: Any) -> dict[str, Any]:
    payload = audience.to_dict()
    members = await db.get_audience_members([payload["id"]])
    member = members.get(payload["id"])
    if member is not None:
        image_key = str(member.get("profile_image_s3_key") or "").strip()
        member["profile_image_url"] = cdn_assets.cdn_url(image_key)
    payload["member"] = member
    return payload


async def list_audiences() -> JSONResponse:
    rows = await db.list_audiences_summary()
    audiences = []
    for row in rows:
        key = str(row.get("profile_image_s3_key") or "").strip()
        audiences.append(
            {
                "id": row["id"],
                "title": row["title"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "profile_image_url": cdn_assets.cdn_url(key) if key else None,
            }
        )
    return JSONResponse(content={"audiences": audiences})


async def list_unassigned_audience_members() -> JSONResponse:
    return JSONResponse(content={"members": await db.list_unassigned_audience_members()})


async def get_audience(
    audience_id: str,
) -> JSONResponse:
    audience = await db.get_audience(audience_id)
    if audience is None:
        raise HTTPException(status_code=404, detail="Audience not found.")
    return JSONResponse(content={"audience": await _hydrate_audience_payload(audience)})


async def get_audience_news(
    audience_id: str,
    limit: int = Query(default=5, ge=1, le=20),
) -> JSONResponse:
    audience = await db.get_audience(audience_id)
    if audience is None:
        raise HTTPException(status_code=404, detail="Audience not found.")
    stories = await db.list_recent_stories_for_audience(audience_id, limit=limit)
    return JSONResponse(content={"stories": stories})


async def create_audience(
    body: AudienceBody,
) -> JSONResponse:
    audience = await db.create_audience(
        title=body.title,
        description=body.description,
    )
    return JSONResponse(content={"audience": await _hydrate_audience_payload(audience)})


async def assign_audience_member_route(
    audience_id: str,
    body: AudienceMemberAssignBody,
) -> JSONResponse:
    audience = await db.assign_audience_member(
        audience_id=audience_id,
        member_id=body.member_id,
    )
    if audience is None:
        raise HTTPException(status_code=404, detail="Audience member not available.")
    return JSONResponse(content={"audience": await _hydrate_audience_payload(audience)})


async def update_audience(
    audience_id: str,
    body: AudienceBody,
) -> JSONResponse:
    audience = await db.update_audience(
        audience_id,
        title=body.title,
        description=body.description,
    )
    if audience is None:
        raise HTTPException(status_code=404, detail="Audience not found.")
    return JSONResponse(content={"audience": await _hydrate_audience_payload(audience)})


async def delete_audience(
    audience_id: str,
) -> None:
    deleted = await db.delete_audience(audience_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Audience not found.")
