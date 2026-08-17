"""clerk backend api helpers for user metadata."""

from __future__ import annotations

import httpx

from commons.config import settings


class ClerkUserError(Exception):
    pass


def clerk_profile_from_user_body(body: dict) -> dict[str, str]:
    email = ""
    addrs = body.get("email_addresses")
    if isinstance(addrs, list):
        primary_id = str(body.get("primary_email_address_id") or "").strip()
        if primary_id:
            for item in addrs:
                if not isinstance(item, dict):
                    continue
                if str(item.get("id") or "").strip() == primary_id:
                    email = str(item.get("email_address") or "").strip()
                    break
        if not email:
            for item in addrs:
                if not isinstance(item, dict):
                    continue
                addr = str(item.get("email_address") or "").strip()
                if addr:
                    email = addr
                    break
    first = str(body.get("first_name") or "").strip()
    last = str(body.get("last_name") or "").strip()
    full_name = str(body.get("full_name") or "").strip()
    if not full_name and (first or last):
        full_name = f"{first} {last}".strip()
    image_url = str(body.get("image_url") or "").strip()
    if not image_url:
        image_url = str(body.get("profile_image_url") or "").strip()
    return {"email": email, "full_name": full_name, "image_url": image_url}


async def _fetch_clerk_user_json(user_id: str) -> dict:
    secret = settings.clerk_secret_key.strip()
    if not secret:
        return {}
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"https://api.clerk.com/v1/users/{user_id}",
                headers={"Authorization": f"Bearer {secret}"},
            )
    except httpx.HTTPError:
        return {}
    if resp.status_code != 200:
        return {}
    body = resp.json()
    return body if isinstance(body, dict) else {}


async def fetch_clerk_user_profile(user_id: str) -> dict[str, str]:
    body = await _fetch_clerk_user_json(user_id)
    if not body:
        return {"email": "", "full_name": "", "image_url": ""}
    return clerk_profile_from_user_body(body)
