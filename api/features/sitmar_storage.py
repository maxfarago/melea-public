"""s3 storage for sitmar campaign images; serve via cloudfront cdn urls on read."""

from __future__ import annotations

import asyncio
import logging

import boto3
from botocore.config import Config

from api.features.cdn_assets import cdn_url, put_public_object
from commons.config import settings

log = logging.getLogger(__name__)

_s3_client = None

_EXT_BY_MIME = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def _s3():
    global _s3_client
    if _s3_client is None:
        region = settings.aws_region
        _s3_client = boto3.client(
            "s3",
            region_name=region,
            endpoint_url=f"https://s3.{region}.amazonaws.com",
            config=Config(signature_version="s3v4"),
        )
    return _s3_client


def bucket() -> str:
    return settings.sitmar_images_s3_bucket.strip()


def concept_key(campaign_id: str, idx: int, mime: str = "image/jpeg") -> str:
    ext = _EXT_BY_MIME.get(mime, "jpg")
    return f"sitmar/{campaign_id}/{idx}.{ext}"


async def store_concept_image(campaign_id: str, idx: int, data: bytes, mime: str) -> str:
    """put image bytes, return the s3 key. raises if no bucket configured."""
    b = bucket()
    if not b:
        raise RuntimeError("SITMAR_IMAGES_S3_BUCKET not configured")
    key = concept_key(campaign_id, idx, mime)
    await asyncio.to_thread(
        put_public_object,
        _s3(),
        bucket=b,
        key=key,
        body=data,
        content_type=mime,
    )
    return key


def image_url(key: str) -> str | None:
    return cdn_url(key)


async def delete_campaign_images(campaign_id: str) -> None:
    """best-effort cleanup of all images under a campaign prefix."""
    b = bucket()
    if not b:
        return
    prefix = f"sitmar/{campaign_id}/"
    try:
        listed = await asyncio.to_thread(_s3().list_objects_v2, Bucket=b, Prefix=prefix)
        keys = [{"Key": o["Key"]} for o in listed.get("Contents", [])]
        if keys:
            await asyncio.to_thread(_s3().delete_objects, Bucket=b, Delete={"Objects": keys})
    except Exception as e:  # noqa: BLE001 - cleanup is best-effort
        log.warning("sitmar_image_cleanup_failed campaign=%s err=%r", campaign_id, e)
