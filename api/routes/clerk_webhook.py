"""clerk webhook — sync user profile on signup and profile updates."""

from __future__ import annotations

import base64
import hmac
import json
import logging
import time
from hashlib import sha256

from fastapi import APIRouter, HTTPException, Request, Response

from api.clerk_users import clerk_profile_from_user_body
from api.db.sqlite import db
from commons.config import settings

log = logging.getLogger(__name__)

router = APIRouter()

_SVIX_TOLERANCE_SECONDS = 300


def _decode_svix_secret(secret: str) -> bytes:
    raw = secret.strip()
    if raw.startswith("whsec_"):
        raw = raw[len("whsec_") :]
    return base64.b64decode(raw)


def _verify_svix_signature(payload: bytes, headers: dict[str, str], secret: str) -> bool:
    msg_id = headers.get("svix-id", "")
    timestamp = headers.get("svix-timestamp", "")
    signature_header = headers.get("svix-signature", "")
    if not msg_id or not timestamp or not signature_header:
        return False
    try:
        ts = int(timestamp)
    except ValueError:
        return False
    if abs(time.time() - ts) > _SVIX_TOLERANCE_SECONDS:
        return False
    signed = f"{msg_id}.{timestamp}.{payload.decode('utf-8')}".encode("utf-8")
    key = _decode_svix_secret(secret)
    expected = base64.b64encode(hmac.new(key, signed, sha256).digest()).decode("utf-8")
    for part in signature_header.split():
        if not part.startswith("v1,"):
            continue
        candidate = part[3:]
        if hmac.compare_digest(candidate, expected):
            return True
    return False


@router.post("/webhooks/clerk")
async def clerk_webhook(request: Request) -> Response:
    webhook_secret = settings.clerk_webhook_secret.strip()
    if not webhook_secret:
        raise HTTPException(status_code=503, detail="clerk webhook not configured")

    payload = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}
    if not _verify_svix_signature(payload, headers, webhook_secret):
        log.warning("rejected clerk webhook: invalid signature")
        raise HTTPException(status_code=400, detail="invalid signature")

    try:
        body = json.loads(payload)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="invalid json")

    event_type = str(body.get("type") or "")
    if event_type not in ("user.created", "user.updated"):
        return Response(status_code=200)

    data = body.get("data")
    if not isinstance(data, dict):
        return Response(status_code=200)

    user_id = str(data.get("id") or "").strip()
    if not user_id:
        log.warning("clerk webhook %s missing user id", event_type)
        return Response(status_code=200)

    profile = clerk_profile_from_user_body(data)
    if not profile.get("email"):
        log.warning("clerk webhook %s user=%s missing email", event_type, user_id)
        return Response(status_code=200)

    await db.upsert_user_profile(user_id, **profile)
    return Response(status_code=200)
