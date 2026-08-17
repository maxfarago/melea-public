"""company crud and brand profile generation."""

from __future__ import annotations

from api.db.sqlite import Company, db
from commons.config import settings
from ingestion.web.brand_site import WebsiteFetchError, normalize_public_website_url


async def get_or_create_company(website_url: str) -> Company:
    normalized = normalize_public_website_url(website_url)
    existing = await db.get_company_by_url(normalized)
    if existing:
        return existing
    return await db.create_company(normalized)


async def get_melea_company_id() -> str | None:
    raw = settings.melea_company_website_url.strip()
    if not raw:
        return None
    try:
        normalized = normalize_public_website_url(raw)
    except WebsiteFetchError:
        return None
    company = await db.get_company_by_url(normalized)
    return company.id if company else None
