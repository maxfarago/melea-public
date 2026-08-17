from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, RedirectResponse

router = APIRouter()

STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "ui"


def _is_mobile(request: Request) -> bool:
    return "mobi" in (request.headers.get("user-agent") or "").lower()


def _is_ops_host(request: Request) -> bool:
    host = (request.headers.get("host") or "").lower()
    return host.startswith("ops.")


@router.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse(STATIC_DIR / "favicon.ico")


@router.get("/", include_in_schema=False)
async def root(request: Request):
    if _is_ops_host(request):
        return FileResponse(STATIC_DIR / "ops" / "index.html")
    if _is_mobile(request):
        return RedirectResponse(url="/m", status_code=307)
    return FileResponse(STATIC_DIR / "index.html")


@router.get("/ops", include_in_schema=False)
@router.get("/ops/brands", include_in_schema=False)
@router.get("/ops/audiences", include_in_schema=False)
@router.get("/ops/waitlist", include_in_schema=False)
async def ops_shell():
    return FileResponse(STATIC_DIR / "ops" / "index.html")


@router.get("/app", include_in_schema=False)
async def app_shell(request: Request):
    if _is_mobile(request):
        return RedirectResponse(url="/m", status_code=307)
    return RedirectResponse(url="/app/home", status_code=307)


@router.get("/app/home", include_in_schema=False)
@router.get("/app/content", include_in_schema=False)
@router.get("/app/distribute", include_in_schema=False)
@router.get("/app/login", include_in_schema=False)
async def app_shell_routes(request: Request):
    if _is_mobile(request):
        return RedirectResponse(url="/m", status_code=307)
    return FileResponse(STATIC_DIR / "index.html")


@router.get("/m", include_in_schema=False)
async def mobile_shell():
    return FileResponse(STATIC_DIR / "mobile" / "index.html")


@router.get("/privacy", include_in_schema=False)
async def privacy_page():
    return FileResponse(STATIC_DIR / "privacy.html")


@router.get("/terms", include_in_schema=False)
async def terms_page():
    return FileResponse(STATIC_DIR / "tos.html")


@router.get("/tos", include_in_schema=False)
async def tos_page():
    return FileResponse(STATIC_DIR / "tos.html")
