"""ScrapingBee integration: generic JS-rendered page scrape -> visible text.

Used as the homepage fallback when Jina Reader is bot-gated, and by the
LinkedIn company-page scrape. Single request to app.scrapingbee.com with
render_js so client-rendered SPAs return real content.
"""

from __future__ import annotations

import logging
import re
import time
from html.parser import HTMLParser

import httpx

from commons.config import settings

log = logging.getLogger(__name__)

_SCRAPE_TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=20.0, pool=10.0)
_DEFAULT_MAX_CHARS = 16_000
_SPACE_RE = re.compile(r"\s+")


class ScrapingBeeError(Exception):
    pass


class _VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style", "noscript", "template", "svg"}:
            self._ignored_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "noscript", "template", "svg"}:
            self._ignored_depth = max(0, self._ignored_depth - 1)

    def handle_data(self, data: str) -> None:
        if self._ignored_depth > 0:
            return
        text = _SPACE_RE.sub(" ", (data or "").strip())
        if text:
            self.parts.append(text)

    def content(self) -> str:
        return "\n".join(self.parts).strip()


def extract_visible_text(html: str, *, max_chars: int) -> str:
    parser = _VisibleTextParser()
    parser.feed(html or "")
    parser.close()
    text = parser.content()
    if len(text) > max_chars:
        return text[:max_chars]
    return text


async def scrape_url(
    url: str,
    *,
    max_chars: int = _DEFAULT_MAX_CHARS,
    client: httpx.AsyncClient | None = None,
) -> str:
    """Scrape an arbitrary URL via ScrapingBee (JS-rendered) -> visible text.

    Raises ScrapingBeeError on missing key, request failure, non-HTML, or empty.
    """
    token = settings.scrapingbee_api_key.strip()
    if not token:
        raise ScrapingBeeError("SCRAPINGBEE_API_KEY is empty")
    target = (url or "").strip()
    if not target:
        raise ScrapingBeeError("url is empty")
    params = {
        "api_key": token,
        "url": target,
        "render_js": "true",
        "block_resources": "false",
        "country_code": "us",
    }
    own_client = client is None
    http = client or httpx.AsyncClient(timeout=_SCRAPE_TIMEOUT, follow_redirects=True)
    try:
        t0 = time.monotonic()
        try:
            resp = await http.get("https://app.scrapingbee.com/api/v1/", params=params)
        except httpx.HTTPError as e:
            raise ScrapingBeeError(f"scrapingbee request failed: {e}") from e
        elapsed = time.monotonic() - t0
        if resp.status_code >= 400:
            raise ScrapingBeeError(
                f"scrapingbee returned HTTP {resp.status_code}: {resp.text[:200]}"
            )
        content_type = (resp.headers.get("content-type") or "").lower()
        if "text/html" not in content_type and "<html" not in (resp.text or "").lower():
            raise ScrapingBeeError("scrapingbee response was not html")
        text = extract_visible_text(resp.text, max_chars=max_chars)
        if not text:
            raise ScrapingBeeError("scraped page was empty")
        log.info("scrapingbee_scraped url=%s chars=%d elapsed=%.2f", target, len(text), elapsed)
        return text
    finally:
        if own_client:
            await http.aclose()
