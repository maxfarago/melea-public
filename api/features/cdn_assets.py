"""stable cloudfront urls for public s3 objects (personas, ad creatives, sitmar)."""

from __future__ import annotations

from typing import Any

from commons.config import settings

CACHE_CONTROL_IMMUTABLE = "public, max-age=31536000, immutable"


def cdn_url(key: str) -> str | None:
    key = (key or "").strip().lstrip("/")
    base = settings.cdn_base_url.strip().rstrip("/")
    if not key or not base:
        return None
    return f"{base}/{key}"


def member_avatar_key(member_id: str, *, ext: str = "jpg", variant: str = "avatar") -> str:
    member_id = (member_id or "").strip()
    if not member_id:
        raise ValueError("member_id is required")
    return f"members/{member_id}/{variant}.{ext}"


def put_public_object(
    s3: Any,
    *,
    bucket: str,
    key: str,
    body: bytes,
    content_type: str,
) -> None:
    s3.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType=content_type,
        CacheControl=CACHE_CONTROL_IMMUTABLE,
    )
