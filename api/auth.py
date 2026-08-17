"""
clerk bearer-token auth.

clerk is the source of truth. every protected endpoint depends on
`require_auth`, which verifies the `Authorization: Bearer <clerk token>`
header on each request and returns the current clerk user id. there is no
server-side session — revocation and expiry are enforced by the short token
lifetime.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException, Request, status
from starlette.concurrency import run_in_threadpool

from api.clerk import ClerkAuthError, get_ops_verifier, verify_token
from api.db.sqlite import db

log = logging.getLogger(__name__)

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Authentication required.",
    headers={"WWW-Authenticate": "Bearer"},
)
_COMPANY_FORBIDDEN = HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="Company access denied.",
)
_HAS_BRAND_FORBIDDEN = HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="You already have a brand.",
)
_UPGRADE_REQUIRED = HTTPException(
    status_code=402,
    detail="upgrade_required",
)
POSTED_CAMPAIGN_LIMIT = 5


async def optional_bearer_claims(request: Request) -> dict[str, Any] | None:
    header = request.headers.get("Authorization") or ""
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    try:
        return await run_in_threadpool(verify_token, token.strip())
    except ClerkAuthError:
        return None


async def require_no_company_association(request: Request) -> None:
    claims = await optional_bearer_claims(request)
    if not claims or not claims.get("sub"):
        return
    user_id = str(claims.get("sub") or "").strip()
    if await db.get_company_id_for_user(user_id):
        raise _HAS_BRAND_FORBIDDEN


async def resolve_user_company_id(user_id: str, claims: dict[str, Any] | None = None) -> str:
    row = await db.get_company_id_for_user(user_id)
    return row or ""


async def require_company_access(request: Request, company_id: str) -> str:
    """verify the caller may access company_id; return clerk user id or empty for anon."""
    company_id = str(company_id or "").strip()
    if not company_id:
        raise _COMPANY_FORBIDDEN
    claims = await optional_bearer_claims(request)
    if not claims:
        return ""
    user_id = str(claims.get("sub") or "").strip()
    if not user_id:
        return ""
    user_company_id = await resolve_user_company_id(user_id, claims)
    if user_company_id != company_id:
        raise _COMPANY_FORBIDDEN
    return user_id


async def require_company_write(request: Request, company_id: str) -> str:
    user_id = await require_company_access(request, company_id)
    if not user_id:
        raise _UNAUTHORIZED
    return user_id


def _bearer_token(request: Request) -> str:
    header = request.headers.get("Authorization") or ""
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise _UNAUTHORIZED
    return token.strip()


async def require_claims(request: Request) -> dict[str, Any]:
    """verify the clerk token and return its claims."""
    token = _bearer_token(request)
    try:
        claims = await run_in_threadpool(verify_token, token)
    except ClerkAuthError as e:
        raise _UNAUTHORIZED from e
    user_id = claims.get("sub")
    if not user_id:
        raise _UNAUTHORIZED
    return claims


async def require_auth(request: Request) -> str:
    """FastAPI dependency: verify the clerk token and return the user id.

    Usage:
        def my_endpoint(user: str = Depends(require_auth)): ...
    """
    claims = await require_claims(request)
    user_id = str(claims.get("sub") or "").strip()
    if not user_id:
        raise _UNAUTHORIZED
    return user_id


async def user_has_active_subscription(
    user_id: str,
    claims: dict[str, Any] | None = None,
) -> bool:
    user_id = str(user_id or "").strip()
    if not user_id:
        return False
    return await db.is_user_subscribed(user_id)


async def check_campaign_quota(user_id: str) -> None:
    if await user_has_active_subscription(user_id):
        return
    count = await db.count_user_posted_campaigns(user_id)
    if count >= POSTED_CAMPAIGN_LIMIT:
        raise _UPGRADE_REQUIRED


_OPS_NOT_CONFIGURED = HTTPException(
    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
    detail="Ops Clerk is not configured on this deployment.",
)


async def require_ops_auth(request: Request) -> str:
    """FastAPI dependency for ops endpoints.

    Verifies the bearer token against the ops Clerk instance (separate from
    customer Clerk). Membership in the ops Clerk app IS the authorization —
    no role check, no metadata fetch.

    Returns the ops user id (clerk `sub`). Raises 401 on invalid/missing
    token, 503 if the ops verifier is not configured (CLERK_OPS_* env vars
    empty on this deployment, e.g. local dev).
    """
    verifier = get_ops_verifier()
    if verifier is None:
        raise _OPS_NOT_CONFIGURED
    token = _bearer_token(request)
    try:
        claims = await run_in_threadpool(verifier.verify, token)
    except ClerkAuthError as e:
        log.warning("ops_auth_failed err=%r", str(e))
        raise _UNAUTHORIZED from e
    user_id = str(claims.get("sub") or "").strip()
    if not user_id:
        raise _UNAUTHORIZED
    return user_id
