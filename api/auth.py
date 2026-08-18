"""open access for this public snapshot. prod used clerk + stripe."""

from __future__ import annotations

from typing import Any

from fastapi import Request

PUBLIC_USER = "public"


async def optional_bearer_claims(_request: Request) -> dict[str, Any] | None:
    return None


async def require_no_company_association(_request: Request) -> None:
    return None


async def resolve_user_company_id(user_id: str, _claims: dict[str, Any] | None = None) -> str:
    from api.db.sqlite import db

    row = await db.get_company_id_for_user(user_id)
    return row or ""


async def require_company_access(_request: Request, company_id: str) -> str:
    company_id = str(company_id or "").strip()
    if not company_id:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Company access denied.")
    return PUBLIC_USER


async def require_company_write(request: Request, company_id: str) -> str:
    return await require_company_access(request, company_id)


async def require_claims(_request: Request) -> dict[str, Any]:
    return {"sub": PUBLIC_USER}


async def require_auth(_request: Request) -> str:
    return PUBLIC_USER


async def user_has_active_subscription(
    _user_id: str,
    _claims: dict[str, Any] | None = None,
) -> bool:
    return True


async def check_campaign_quota(_user_id: str) -> None:
    return None


async def require_ops_auth(_request: Request) -> str:
    return PUBLIC_USER
