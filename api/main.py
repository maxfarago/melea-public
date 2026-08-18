"""FastAPI entrypoint for the Melea API."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from importlib.metadata import version as pkg_version
from importlib.metadata import PackageNotFoundError

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.db.sqlite import db
from api.prompts import seed_prompts_from_yaml
from api.routes.audiences import router as audiences_router
from api.routes.companies import router as companies_router
from api.routes.health import router as health_router
from api.routes.home import router as home_router
from api.routes.identity import router as identity_router
from api.routes.ops import router as ops_router
from api.routes.posts import router as posts_router
from api.routes.root import STATIC_DIR, router as root_router
from api.routes.sitmar import router as sitmar_router
from api.routes.waitlist import router as waitlist_router
from commons.log import configure_logging

log = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    configure_logging()
    await db.init()
    await seed_prompts_from_yaml()

    try:
        yield
    finally:
        await db.close()


try:
    APP_VERSION = pkg_version("melea-api")
except PackageNotFoundError:
    APP_VERSION = "0.0.0"

app = FastAPI(
    title="Melea API",
    version=APP_VERSION,
    lifespan=lifespan,
)

# api.melea.ai is called cross-origin by the app SPA (app.melea.ai).
# same-origin calls bypass this entirely. the optional `.dev` segment covers
# dev hosts (app.dev.melea.ai, api.dev.melea.ai).
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=(
        r"^https://(app|api|www|melea)(\.dev)?\.melea\.ai$"
        r"|^https://melea\.ai$"
        r"|^http://localhost(:\d+)?$"
        r"|^http://127\.0\.0\.1(:\d+)?$"
    ),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.middleware("http")
async def waitlist_cors(request: Request, call_next):
    if request.url.path != "/waitlist":
        return await call_next(request)

    headers = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    }
    if request.method == "OPTIONS":
        return Response(status_code=204, headers=headers)

    response = await call_next(request)
    for key, value in headers.items():
        response.headers[key] = value
    return response


app.include_router(root_router)
app.include_router(identity_router)
app.include_router(health_router)
app.include_router(posts_router)
app.include_router(companies_router)
app.include_router(audiences_router)
app.include_router(ops_router)
app.include_router(sitmar_router)
app.include_router(home_router)
app.include_router(waitlist_router)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
