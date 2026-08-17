from __future__ import annotations

import logging
import re
import time
from typing import Any
from urllib.parse import quote, unquote, urlparse

import httpx

from commons.config import settings
from ingestion.web.scrapingbee import ScrapingBeeError, scrape_url
from llm.profiling import call_llm_json

log = logging.getLogger(__name__)

_SEARCH_TIMEOUT = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=5.0)
_DEFAULT_MAX_CHARS = 16_000

_JINA_URL_SOURCE_RE = re.compile(
    r"^\[\d+\]\s+URL Source:\s+(https?://[^\s]+)$",
    re.IGNORECASE | re.MULTILINE,
)
_LINKEDIN_COMPANY_RE = re.compile(
    r"^https?://(?:[a-z]{2,3}\.)?linkedin\.com/company/[A-Za-z0-9\-_%]+/?(?:\?.*)?$",
    re.IGNORECASE,
)
_SPACE_RE = re.compile(r"\s+")
_TERM_WORD_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9&\-\._]*")
_YEAR_RE = re.compile(r"\b(19\d{2}|20\d{2})\b")
_FOLLOWERS_RE = re.compile(r"\b([\d][\d,\.]*\s*[kKmM]?)\s+followers\b", re.IGNORECASE)
_EMPLOYEES_RE = re.compile(r"\b([\d][\d,\.]*(?:\s*-\s*[\d][\d,\.]*)?)\s+employees\b", re.IGNORECASE)
_LINKEDIN_EXTRACT_MODEL = "claude-haiku-4-5"
_LINKEDIN_EXTRACT_MAX_INPUT_CHARS = 14_000
_LINKEDIN_EXTRACT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "company_name": {"type": "string"},
        "tagline": {"type": "string"},
        "industry": {"type": "string"},
        "location": {"type": "string"},
        "employees": {"type": "string"},
        "followers": {"type": "string"},
        "overview": {"type": "string"},
        "founded_year": {"type": "string"},
        "specialties": {"type": "array", "items": {"type": "string"}, "maxItems": 20},
    },
    "required": [
        "company_name",
        "tagline",
        "industry",
        "location",
        "employees",
        "followers",
        "overview",
        "founded_year",
        "specialties",
    ],
    "additionalProperties": False,
}


class LinkedInDiscoveryError(Exception):
    pass


class LinkedInScrapeError(Exception):
    pass


def _jina_auth_headers() -> dict[str, str]:
    headers: dict[str, str] = {"Accept": "text/plain"}
    if settings.jina_api_key.strip():
        headers["Authorization"] = f"Bearer {settings.jina_api_key.strip()}"
    return headers


def _base_domain(url: str) -> str:
    host = (urlparse((url or "").strip()).netloc or "").lower().removeprefix("www.")
    return host


def _extract_first_linkedin_company_url(search_text: str) -> str | None:
    for match in _JINA_URL_SOURCE_RE.finditer(search_text or ""):
        candidate = match.group(1).strip()
        normalized = _normalize_linkedin_company_url(candidate)
        if normalized:
            return normalized
    return None


def _candidate_queries_for_term(term: str) -> list[str]:
    cleaned = _SPACE_RE.sub(" ", (term or "").strip())
    words = _TERM_WORD_RE.findall(cleaned)
    candidates: list[str] = []
    if cleaned:
        candidates.append(f'site:linkedin.com/company/ "{cleaned} linkedin"')
        candidates.append(f"site:linkedin.com/company/ {cleaned} linkedin")
        candidates.append(f'site:linkedin.com/company/ "{cleaned}"')
        candidates.append(f"site:linkedin.com/company/ {cleaned}")
    if words:
        short = " ".join(words[:3]).strip()
        if short:
            candidates.append(f'site:linkedin.com/company/ "{short} linkedin"')
            candidates.append(f"site:linkedin.com/company/ {short} linkedin")
            candidates.append(f'site:linkedin.com/company/ "{short}"')
            candidates.append(f"site:linkedin.com/company/ {short}")
        brandish = " ".join(words[:2]).strip()
        if brandish:
            candidates.append(f'site:linkedin.com/company/ "{brandish} linkedin"')
            candidates.append(f'site:linkedin.com/company/ "{brandish}"')
    deduped: list[str] = []
    seen: set[str] = set()
    for q in candidates:
        key = q.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(q)
    return deduped


def _candidate_queries_for_website(website_url: str) -> list[str]:
    domain = _base_domain(website_url)
    if not domain:
        return []
    root = domain.split(".")[0].strip()
    root_words = _TERM_WORD_RE.findall(root)
    root_phrase = " ".join(root_words).strip()
    candidates: list[str] = [
        f'site:linkedin.com/company/ "{domain}"',
        f"site:linkedin.com/company/ {domain}",
    ]
    if root_phrase:
        candidates.extend(
            [
                f'site:linkedin.com/company/ "{root_phrase} linkedin"',
                f"site:linkedin.com/company/ {root_phrase} linkedin",
                f'site:linkedin.com/company/ "{root_phrase}"',
                f"site:linkedin.com/company/ {root_phrase}",
            ]
        )
    deduped: list[str] = []
    seen: set[str] = set()
    for q in candidates:
        key = q.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(q)
    return deduped


def _normalize_linkedin_company_url(url: str) -> str | None:
    raw = (url or "").strip()
    if not _LINKEDIN_COMPANY_RE.match(raw):
        return None
    parsed = urlparse(raw)
    host = (parsed.netloc or "").lower()
    if host.endswith(".linkedin.com") or host == "linkedin.com":
        pass
    else:
        return None
    segments = [seg for seg in (parsed.path or "").split("/") if seg]
    if len(segments) < 2 or segments[0].lower() != "company":
        return None
    slug = unquote(segments[1]).strip().strip("/")
    if not slug:
        return None
    slug = re.sub(r"[^A-Za-z0-9\-_]+", "-", slug).strip("-").lower()
    if not slug:
        return None
    return f"https://www.linkedin.com/company/{slug}"


def validate_profile_domain(*, profile_text: str, website_url: str) -> tuple[bool, str | None]:
    domain = _base_domain(website_url)
    if not domain:
        return False, "brand website domain is empty"
    haystack = (profile_text or "").lower()
    if domain.lower() in haystack:
        return True, None
    return False, f"linkedin profile validation failed: domain {domain} not found in profile text"


def _deterministic_profile_fallback(*, profile_text: str, linkedin_url: str) -> dict[str, Any]:
    text = _SPACE_RE.sub(" ", (profile_text or "").strip())
    lines = [line.strip() for line in (profile_text or "").splitlines() if line.strip()]
    slug = ""
    parsed = urlparse(linkedin_url or "")
    segments = [seg for seg in (parsed.path or "").split("/") if seg]
    if len(segments) >= 2 and segments[0].lower() == "company":
        slug = segments[1].replace("-", " ").strip()
    company_name = lines[0][:120] if lines else slug
    followers_match = _FOLLOWERS_RE.search(text)
    employees_match = _EMPLOYEES_RE.search(text)
    founded_year = ""
    if "founded" in text.lower() or "since" in text.lower():
        ym = _YEAR_RE.search(text)
        founded_year = ym.group(1) if ym else ""
    return {
        "company_name": company_name or slug,
        "tagline": "",
        "industry": "",
        "location": "",
        "employees": (employees_match.group(1).strip() if employees_match else ""),
        "followers": (followers_match.group(1).strip() if followers_match else ""),
        "overview": "",
        "founded_year": founded_year,
        "specialties": [],
        "extraction_model": "deterministic",
    }


async def extract_company_profile(*, profile_text: str, linkedin_url: str) -> dict[str, Any]:
    excerpt = (profile_text or "").strip()
    if len(excerpt) > _LINKEDIN_EXTRACT_MAX_INPUT_CHARS:
        excerpt = excerpt[:_LINKEDIN_EXTRACT_MAX_INPUT_CHARS]
    if not excerpt:
        return _deterministic_profile_fallback(profile_text=profile_text, linkedin_url=linkedin_url)
    if not settings.anthropic_api_key.strip():
        return _deterministic_profile_fallback(profile_text=profile_text, linkedin_url=linkedin_url)

    system = (
        "extract structured company profile fields from linkedin company page text. "
        "if a field is missing, return empty string. specialties should be short phrases."
    )
    user = (
        f"linkedin_url: {linkedin_url}\n\n"
        "return json with fields:\n"
        "- company_name\n- tagline\n- industry\n- location\n- employees\n- followers\n"
        "- overview\n- founded_year\n- specialties\n\n"
        "profile_text:\n---\n"
        f"{excerpt}\n---"
    )
    try:
        parsed, _ = await call_llm_json(
            system_prompt=system,
            user_message=user,
            sampling={"thinking": False, "max_tokens": 500, "temperature": 0.2},
            schema=_LINKEDIN_EXTRACT_SCHEMA,
            model=_LINKEDIN_EXTRACT_MODEL,
        )
    except Exception:
        return _deterministic_profile_fallback(profile_text=profile_text, linkedin_url=linkedin_url)

    out = _deterministic_profile_fallback(profile_text=profile_text, linkedin_url=linkedin_url)
    for key in [
        "company_name",
        "tagline",
        "industry",
        "location",
        "employees",
        "followers",
        "overview",
        "founded_year",
    ]:
        out[key] = str(parsed.get(key) or "").strip()
    raw_specs = parsed.get("specialties")
    if isinstance(raw_specs, list):
        specs: list[str] = []
        seen: set[str] = set()
        for item in raw_specs:
            value = _SPACE_RE.sub(" ", str(item or "").strip())
            if not value:
                continue
            key = value.lower()
            if key in seen:
                continue
            seen.add(key)
            specs.append(value)
            if len(specs) >= 20:
                break
        out["specialties"] = specs
    out["extraction_model"] = _LINKEDIN_EXTRACT_MODEL
    return out


async def discover_company_url(
    *,
    search_term: str,
    website_url: str = "",
    max_chars: int = _DEFAULT_MAX_CHARS,
    client: httpx.AsyncClient | None = None,
) -> tuple[str | None, str]:
    term = (search_term or "").strip()
    website = (website_url or "").strip()
    if not term and not website:
        raise LinkedInDiscoveryError("search term and website url are empty")
    query_specs: list[tuple[str, str]] = []
    for query in _candidate_queries_for_website(website):
        query_specs.append((query, "website"))
    for query in _candidate_queries_for_term(term):
        query_specs.append((query, "name"))
    deduped_specs: list[tuple[str, str]] = []
    seen_queries: set[str] = set()
    for query, source in query_specs:
        key = query.lower()
        if key in seen_queries:
            continue
        seen_queries.add(key)
        deduped_specs.append((query, source))
    own_client = client is None
    http = client or httpx.AsyncClient(timeout=_SEARCH_TIMEOUT, follow_redirects=True)
    try:
        last_error: str | None = None
        for query, query_source in deduped_specs:
            url = f"https://s.jina.ai/{quote(query)}"
            t0 = time.monotonic()
            try:
                resp = await http.get(url, headers=_jina_auth_headers())
            except httpx.HTTPError as e:
                raise LinkedInDiscoveryError(f"jina linkedin search failed: {e}") from e
            elapsed = time.monotonic() - t0
            if resp.status_code >= 400:
                last_error = (
                    f"jina linkedin search returned HTTP {resp.status_code}: {resp.text[:200]}"
                )
                log.warning(
                    "linkedin_url_discovery_retry term=%r website=%r query=%r source=%s status=%d",
                    term,
                    website,
                    query,
                    query_source,
                    resp.status_code,
                )
                continue
            text = (resp.text or "").strip()
            if len(text) > max_chars:
                text = text[:max_chars]
            linkedin_url = _extract_first_linkedin_company_url(text)
            log.info(
                "linkedin_url_discovery term=%r website=%r query=%r source=%s found=%s elapsed=%.2f",
                term,
                website,
                query,
                query_source,
                bool(linkedin_url),
                elapsed,
            )
            if linkedin_url:
                return linkedin_url, text
        if last_error:
            raise LinkedInDiscoveryError(last_error)
        return None, ""
    finally:
        if own_client:
            await http.aclose()


async def scrape_company_page(
    *,
    linkedin_url: str,
    max_chars: int = _DEFAULT_MAX_CHARS,
    client: httpx.AsyncClient | None = None,
) -> str:
    url = (linkedin_url or "").strip()
    if not _LINKEDIN_COMPANY_RE.match(url):
        raise LinkedInScrapeError("linkedin url is not a company page")
    try:
        return await scrape_url(url, max_chars=max_chars, client=client)
    except ScrapingBeeError as e:
        raise LinkedInScrapeError(str(e)) from e
