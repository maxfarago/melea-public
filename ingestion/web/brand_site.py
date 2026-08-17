"""URL normalization helpers for company website input."""

from __future__ import annotations

import re
from urllib.parse import urlparse, urlunparse


class WebsiteFetchError(Exception):
    """Raised when a company site URL is invalid."""


_PUBLIC_HOST_RE = re.compile(
    r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$",
    re.IGNORECASE,
)


def normalize_url(raw: str) -> str:
    """Coerce 'example.com', 'http://example.com', etc. into a full https URL."""
    raw = raw.strip()
    if not raw:
        raise WebsiteFetchError("Empty website URL.")
    if "://" not in raw:
        raw = "https://" + raw
    parsed = urlparse(raw)
    if not parsed.netloc:
        raise WebsiteFetchError(f"Could not parse a domain from {raw!r}.")
    path = parsed.path if parsed.path else "/"
    return urlunparse(("https", parsed.netloc, path, "", "", ""))


def normalize_public_website_url(raw: str) -> str:
    """Normalize and require a public domain host like nike.com."""
    normalized = normalize_url(raw)
    parsed = urlparse(normalized)
    host = (parsed.hostname or "").strip().lower()
    if host.startswith("www."):
        host = host.removeprefix("www.")
    if not host or not _PUBLIC_HOST_RE.fullmatch(host):
        raise WebsiteFetchError(
            "Enter a valid public website URL or domain (for example, nike.com)."
        )
    path = parsed.path if parsed.path else "/"
    return urlunparse(("https", host, path, "", "", ""))
