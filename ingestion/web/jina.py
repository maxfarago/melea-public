"""Jina integration: Reader (r.jina.ai) + Search (s.jina.ai).

Reader is the workhorse for URL-to-clean-markdown conversion. We pass
several headers to push quality up:

    Accept: application/json          -> structured response w/ title + content
    x-with-generated-alt: true        -> caption images via Jina VLM
    x-with-links-summary: true        -> appended "Buttons & Links" section,
                                         the source of truth for deterministic
                                         social-handle extraction
    x-respond-with: readerlm-v2       -> higher-quality HTML->Markdown on
                                         dynamic/JS-heavy sites (3x token cost)
    x-target-selector / x-remove-selector / x-wait-for-selector
                                      -> platform-specific tuning for socials

Search is a lightweight SERP. Profile news scan uses Google News RSS
discovery + article fetch + structured extraction.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any
from xml.etree import ElementTree as ET
from urllib.parse import quote, urlparse, urlunparse

import httpx

from commons.config import settings

log = logging.getLogger(__name__)


_DEFAULT_MAX_CHARS = 14_000
_READER_TIMEOUT = 60.0
_SEARCH_TIMEOUT = 30.0

_BOT_GATE_SIGNALS = (
    "just a moment",
    "enable javascript and cookies",
    "cf-browser-verification",
    "ray id",
    "checking your browser",
    "please wait while we check your browser",
    "ddos-guard",
    "access denied",
    "403 forbidden",
)


# Platform-specific Reader config for social pages. Selectors are best-effort
# and may need tweaking as sites change. The wait selector lets the headless
# browser render dynamic content; remove strips chrome we don't want in the
# LLM context.
SOCIAL_FETCH_CONFIG: dict[str, dict[str, str]] = {
    "twitter.com": {"wait_for": "article", "remove": "nav, aside"},
    "x.com": {"wait_for": "article", "remove": "nav, aside"},
    "linkedin.com": {"wait_for": ".org-top-card", "remove": "footer"},
    "instagram.com": {"wait_for": "main", "remove": "nav, footer"},
    "tiktok.com": {"wait_for": "main", "remove": "nav, header"},
    "youtube.com": {"wait_for": "#contents", "remove": "ytd-watch-next-secondary-results-renderer"},
}


class JinaError(Exception):
    pass


@dataclass
class ReaderResult:
    url: str
    title: str = ""
    description: str = ""
    content: str = ""
    links: list[dict[str, str]] = field(default_factory=list)
    images: dict[str, str] = field(default_factory=dict)
    metadata: dict[str, str] = field(default_factory=dict)
    external: dict[str, Any] = field(default_factory=dict)
    fetched_at: float = field(default_factory=time.time)
    elapsed_seconds: float = 0.0
    source: str = "reader"


@dataclass
class SearchResult:
    query: str
    raw_text: str
    elapsed_seconds: float = 0.0


@dataclass
class NewsCandidate:
    title: str
    url: str
    outlet: str
    published_at: str
    snippet: str


def _auth_headers() -> dict[str, str]:
    headers: dict[str, str] = {}
    if settings.jina_api_key:
        headers["Authorization"] = f"Bearer {settings.jina_api_key}"
    return headers


def normalize_url(raw: str) -> str:
    raw = raw.strip()
    if not raw:
        raise JinaError("Empty URL.")
    if "://" not in raw:
        raw = "https://" + raw
    parsed = urlparse(raw)
    if not parsed.netloc:
        raise JinaError(f"Could not parse a domain from {raw!r}.")
    path = parsed.path if parsed.path else "/"
    return urlunparse(("https", parsed.netloc, path, "", "", ""))


def domain_of(url: str) -> str:
    return urlparse(normalize_url(url)).netloc


def brand_name(domain: str) -> str:
    host = domain.removeprefix("www.")
    return host.split(".")[0]


def _is_bot_gate(text: str) -> bool:
    sample = text[:2000].lower()
    return any(signal in sample for signal in _BOT_GATE_SIGNALS)


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + "\n\n[...content truncated...]"


def _reader_headers(
    *,
    json_response: bool,
    images_summary: bool,
    image_alt: bool,
    links_summary: bool,
    use_readerlm: bool,
    wait_for_selector: str | None,
    remove_selector: str | None,
    target_selector: str | None,
    no_cache: bool,
    include_auth: bool,
) -> dict[str, str]:
    headers = _auth_headers() if include_auth else {}
    headers["Accept"] = "application/json" if json_response else "text/plain"
    if images_summary:
        headers["x-with-images-summary"] = "true"
    if image_alt:
        headers["x-with-generated-alt"] = "true"
    if links_summary:
        headers["x-with-links-summary"] = "true"
    if use_readerlm:
        headers["x-respond-with"] = "readerlm-v2"
    if wait_for_selector:
        headers["x-wait-for-selector"] = wait_for_selector
    if remove_selector:
        headers["x-remove-selector"] = remove_selector
    if target_selector:
        headers["x-target-selector"] = target_selector
    if no_cache:
        headers["x-no-cache"] = "true"
    return headers


def _normalize_links(raw: Any) -> list[dict[str, str]]:
    """Reader returns `links` as a dict {title: url} OR list of {title, url}."""
    if not raw:
        return []
    if isinstance(raw, dict):
        return [{"title": str(k), "url": str(v)} for k, v in raw.items()]
    if isinstance(raw, list):
        out: list[dict[str, str]] = []
        for item in raw:
            if isinstance(item, dict):
                out.append({"title": str(item.get("title", "")), "url": str(item.get("url", ""))})
            elif isinstance(item, str):
                out.append({"title": "", "url": item})
        return out
    return []


def _parse_reader_response(resp: httpx.Response, url: str, elapsed: float) -> ReaderResult:
    content_type = resp.headers.get("content-type", "")
    if "application/json" in content_type:
        body = resp.json()
        data = body.get("data", body)
        return ReaderResult(
            url=str(data.get("url", url)),
            title=str(data.get("title", "")),
            description=str(data.get("description", "")),
            content=str(data.get("content", "") or data.get("text", "")),
            links=_normalize_links(data.get("links")),
            images=(
                {str(k): str(v) for k, v in data.get("images", {}).items()}
                if isinstance(data.get("images"), dict)
                else {}
            ),
            metadata=(
                {str(k): str(v) for k, v in data.get("metadata", {}).items()}
                if isinstance(data.get("metadata"), dict)
                else {}
            ),
            external=(data.get("external", {}) if isinstance(data.get("external"), dict) else {}),
            elapsed_seconds=elapsed,
        )
    text = resp.text
    return ReaderResult(url=url, content=text, elapsed_seconds=elapsed)


async def fetch_reader(
    url: str,
    *,
    client: httpx.AsyncClient | None = None,
    json_response: bool = True,
    images_summary: bool = False,
    image_alt: bool = True,
    links_summary: bool = True,
    use_readerlm: bool = True,
    wait_for_selector: str | None = None,
    remove_selector: str | None = None,
    target_selector: str | None = None,
    no_cache: bool = False,
    include_auth: bool = True,
    max_chars: int = _DEFAULT_MAX_CHARS,
    max_attempts: int = 3,
) -> ReaderResult:
    """Fetch a URL via Jina Reader. Raises JinaError on hard failure.

    Retries on HTTP 5xx and bot-gate pages with linear backoff.
    """
    normalized = normalize_url(url)
    reader_url = f"https://r.jina.ai/{normalized}"
    headers = _reader_headers(
        json_response=json_response,
        images_summary=images_summary,
        image_alt=image_alt,
        links_summary=links_summary,
        use_readerlm=use_readerlm,
        wait_for_selector=wait_for_selector,
        remove_selector=remove_selector,
        target_selector=target_selector,
        no_cache=no_cache,
        include_auth=include_auth,
    )

    last_error = ""
    own_client = client is None
    http = client or httpx.AsyncClient(timeout=_READER_TIMEOUT, follow_redirects=True)
    try:
        for attempt in range(1, max_attempts + 1):
            t0 = time.monotonic()
            try:
                resp = await http.get(reader_url, headers=headers)
            except httpx.HTTPError as e:
                last_error = f"HTTPError: {e}"
                log.warning(
                    "jina_reader_http_error url=%s attempt=%d err=%r", normalized, attempt, e
                )
                if attempt < max_attempts:
                    await asyncio.sleep(2.0 * attempt)
                continue
            elapsed = time.monotonic() - t0

            if resp.status_code == 429:
                last_error = "HTTP 429 rate limited"
                log.warning("jina_reader_rate_limited url=%s attempt=%d", normalized, attempt)
                if attempt < max_attempts:
                    await asyncio.sleep(5.0 * attempt)
                continue

            if resp.status_code >= 400:
                last_error = f"HTTP {resp.status_code}"
                if attempt < max_attempts and resp.status_code >= 500:
                    await asyncio.sleep(2.0 * attempt)
                    continue
                raise JinaError(f"Reader {normalized} -> {last_error}: {resp.text[:200]}")

            result = _parse_reader_response(resp, normalized, elapsed)

            if _is_bot_gate(result.content):
                last_error = "bot-gate page"
                log.warning("jina_reader_bot_gate url=%s attempt=%d", normalized, attempt)
                if attempt < max_attempts:
                    await asyncio.sleep(3.0 * attempt)
                continue

            result.content = _truncate(result.content, max_chars)
            log.info(
                "jina_reader_ok url=%s chars=%d links=%d elapsed=%.2f",
                normalized,
                len(result.content),
                len(result.links),
                elapsed,
            )
            return result

        raise JinaError(f"Reader exhausted retries for {normalized}: {last_error}")
    finally:
        if own_client:
            await http.aclose()


async def fetch_social_page(
    handle_url: str,
    *,
    client: httpx.AsyncClient | None = None,
    max_chars: int = _DEFAULT_MAX_CHARS,
) -> ReaderResult:
    """Fetch a social URL with platform-specific Reader headers.

    Falls back to s.jina.ai/site:{platform} on Reader failure so the
    pipeline always has *something* to feed the voice-analysis LLM step.
    """
    domain = domain_of(handle_url)
    canonical = domain.removeprefix("www.")
    config = SOCIAL_FETCH_CONFIG.get(canonical, {})

    try:
        return await fetch_reader(
            handle_url,
            client=client,
            json_response=True,
            image_alt=True,
            links_summary=False,
            use_readerlm=True,
            wait_for_selector=config.get("wait_for"),
            remove_selector=config.get("remove"),
            max_chars=max_chars,
        )
    except JinaError as e:
        log.warning("social_fetch_fell_back_to_search url=%s err=%s", handle_url, e)
        from urllib.parse import urlparse as _up

        path = _up(handle_url).path.strip("/")
        query = f"site:{canonical} {path}".strip()
        search = await fetch_search(query, client=client, max_chars=max_chars)
        return ReaderResult(
            url=handle_url,
            title=f"(fallback search) {canonical}",
            content=search.raw_text,
            links=[],
            elapsed_seconds=search.elapsed_seconds,
            source="search_fallback",
        )


async def fetch_search(
    query: str,
    *,
    client: httpx.AsyncClient | None = None,
    max_chars: int = _DEFAULT_MAX_CHARS // 2,
) -> SearchResult:
    """Run s.jina.ai for the query. Returns combined text of top results."""
    headers = _auth_headers()
    headers["Accept"] = "text/plain"
    encoded = quote(query)
    url = f"https://s.jina.ai/{encoded}"

    own_client = client is None
    http = client or httpx.AsyncClient(timeout=_SEARCH_TIMEOUT, follow_redirects=True)
    try:
        t0 = time.monotonic()
        try:
            resp = await http.get(url, headers=headers)
        except httpx.HTTPError as e:
            log.warning("jina_search_http_error query=%r err=%r", query, e)
            return SearchResult(query=query, raw_text="", elapsed_seconds=time.monotonic() - t0)
        elapsed = time.monotonic() - t0

        if resp.status_code >= 400:
            log.warning("jina_search_status query=%r status=%d", query, resp.status_code)
            return SearchResult(query=query, raw_text="", elapsed_seconds=elapsed)

        text = _truncate(resp.text.strip(), max_chars)
        log.info("jina_search_ok query=%r chars=%d elapsed=%.2f", query, len(text), elapsed)
        return SearchResult(query=query, raw_text=text, elapsed_seconds=elapsed)
    finally:
        if own_client:
            await http.aclose()


_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(text: str) -> str:
    return _TAG_RE.sub("", text or "").strip()


def _first_text(node: ET.Element, path: str) -> str:
    child = node.find(path)
    return (child.text or "").strip() if child is not None and child.text else ""


def _extract_news_items(xml_text: str) -> list[NewsCandidate]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []
    out: list[NewsCandidate] = []
    for item in root.findall("./channel/item"):
        title = _first_text(item, "title")
        url = _first_text(item, "link")
        published_at = _first_text(item, "pubDate")
        # Google News RSS has <description> HTML and optional <source>.
        snippet = _strip_html(_first_text(item, "description"))
        source = item.find("source")
        outlet = (source.text or "").strip() if source is not None and source.text else ""
        if not title or not url:
            continue
        out.append(
            NewsCandidate(
                title=title,
                url=url,
                outlet=outlet,
                published_at=published_at,
                snippet=snippet,
            )
        )
    return out


async def fetch_google_news_rss(
    query: str,
    *,
    when: str = "1y",
    max_results: int = 25,
    client: httpx.AsyncClient | None = None,
) -> list[NewsCandidate]:
    """Fetch Google News RSS search results for `query` over a time window."""
    q = f"{query.strip()} when:{when}".strip()
    encoded = quote(q)
    url = f"https://news.google.com/rss/search?q={encoded}&hl=en-US&gl=US&ceid=US:en"

    own_client = client is None
    http = client or httpx.AsyncClient(timeout=_SEARCH_TIMEOUT, follow_redirects=True)
    try:
        t0 = time.monotonic()
        try:
            resp = await http.get(url, headers={"Accept": "application/rss+xml"})
        except httpx.HTTPError as e:
            log.warning("google_news_rss_http_error query=%r err=%r", query, e)
            return []
        elapsed = time.monotonic() - t0
        if resp.status_code >= 400:
            log.warning("google_news_rss_status query=%r status=%d", query, resp.status_code)
            return []
        items = _extract_news_items(resp.text)
        if max_results > 0:
            items = items[:max_results]
        log.info(
            "google_news_rss_ok query=%r items=%d elapsed=%.2f",
            query,
            len(items),
            elapsed,
        )
        return items
    finally:
        if own_client:
            await http.aclose()
