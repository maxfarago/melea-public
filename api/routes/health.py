from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()


@router.get("/api/health")
async def health(request: Request) -> JSONResponse:
    payload: dict = {"status": "ok", "version": request.app.version}
    return JSONResponse(content=payload)
