"""optional site-wide password gate for staging builds."""

from __future__ import annotations

import hmac
import secrets
from hashlib import sha256
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel

from api.routes.root import STATIC_DIR
from commons.config import settings

router = APIRouter()

COOKIE_NAME = "melea_site_access"
COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
COOKIE_PAYLOAD = b"melea-site-gate-v1"

GATE_ALLOWLIST = frozenset(
    {
        "/gate",
        "/api/health",
        "/api/site-gate/status",
        "/api/site-gate/unlock",
        "/waitlist",
        "/webhooks/stripe",
        "/webhooks/clerk",
        "/privacy",
        "/terms",
        "/tos",
    }
)

REDIRECT_EXACT_PATHS = frozenset(
    {"/", "/app", "/m", "/app/home", "/app/content", "/app/distribute", "/app/login"}
)


def gate_enabled() -> bool:
    return bool(settings.site_access_password.strip())


def _cookie_secret() -> str:
    explicit = settings.site_gate_cookie_secret.strip()
    if explicit:
        return explicit
    return settings.clerk_secret_key.strip()


def expected_cookie_value() -> str:
    secret = _cookie_secret()
    if not secret:
        return ""
    return hmac.new(secret.encode(), COOKIE_PAYLOAD, sha256).hexdigest()


def is_unlocked(request: Request) -> bool:
    expected = expected_cookie_value()
    if not expected:
        return False
    actual = request.cookies.get(COOKIE_NAME, "")
    return bool(actual) and secrets.compare_digest(actual, expected)


def _request_is_secure(request: Request) -> bool:
    forwarded = (request.headers.get("x-forwarded-proto") or "").split(",")[0].strip().lower()
    if forwarded:
        return forwarded == "https"
    return request.url.scheme == "https"


def _cookie_flags(request: Request) -> dict[str, str | int | bool]:
    flags: dict[str, str | int | bool] = {
        "httponly": True,
        "path": "/",
        "samesite": "lax",
        "max_age": COOKIE_MAX_AGE_SECONDS,
    }
    if _request_is_secure(request):
        flags["secure"] = True
    return flags


def set_unlock_cookie(response: Response, request: Request) -> None:
    response.set_cookie(
        COOKIE_NAME,
        expected_cookie_value(),
        **_cookie_flags(request),
    )


def _path_allowlisted(path: str) -> bool:
    return path in GATE_ALLOWLIST


def _should_redirect(request: Request, path: str) -> bool:
    if path in REDIRECT_EXACT_PATHS:
        return True
    if path.startswith("/static"):
        return True
    accept = request.headers.get("accept") or ""
    return "text/html" in accept.lower()


def _gate_redirect(request: Request) -> RedirectResponse:
    next_path = request.url.path
    if request.url.query:
        next_path = f"{next_path}?{request.url.query}"
    if not next_path.startswith("/"):
        next_path = "/app"
    return RedirectResponse(
        url=f"/gate?next={quote(next_path, safe='')}",
        status_code=302,
    )


async def site_gate_middleware(request: Request, call_next):
    if not gate_enabled():
        return await call_next(request)
    if is_unlocked(request):
        return await call_next(request)

    path = request.url.path
    if _path_allowlisted(path):
        return await call_next(request)

    if _should_redirect(request, path):
        return _gate_redirect(request)

    return JSONResponse(
        status_code=status.HTTP_401_UNAUTHORIZED,
        content={"detail": "Site access required."},
    )


class UnlockBody(BaseModel):
    password: str
    next: str = "/app"


def _safe_next_path(raw: str) -> str:
    value = (raw or "").strip()
    if not value.startswith("/") or value.startswith("//"):
        return "/app"
    return value


@router.get("/gate", include_in_schema=False)
async def gate_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "gate.html")


@router.get("/api/site-gate/status")
async def site_gate_status(request: Request) -> JSONResponse:
    enabled = gate_enabled()
    return JSONResponse(
        content={
            "enabled": enabled,
            "unlocked": (not enabled) or is_unlocked(request),
        }
    )


@router.post("/api/site-gate/unlock")
async def site_gate_unlock(body: UnlockBody, request: Request) -> JSONResponse:
    next_path = _safe_next_path(body.next)
    if not gate_enabled():
        response = JSONResponse(content={"ok": True, "next": next_path})
        return response

    expected = settings.site_access_password
    provided = body.password or ""
    if not secrets.compare_digest(provided, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect password.",
        )

    if not _cookie_secret():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Site gate is misconfigured.",
        )

    response = JSONResponse(content={"ok": True, "next": next_path})
    set_unlock_cookie(response, request)
    return response
