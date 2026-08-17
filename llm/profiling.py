"""LLM helpers for the profile-generation pipeline."""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
from dataclasses import dataclass
from typing import Any

import anthropic
import httpx
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
)

from commons.config import settings
from llm.providers import LLMResult
from llm.providers import anthropic as anthropic_provider
from llm.providers import openai_compat

log = logging.getLogger(__name__)

_RETRY_STATUS_CODES: frozenset[int] = frozenset({429, 502, 503, 504, 520, 521, 522, 523, 524})
_RETRY_DELAYS_SECONDS: tuple[float, ...] = (5.0, 15.0, 30.0)

_PLACEHOLDER_RE = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)\}")


@dataclass
class HomepageSynthesis:
    business_name: str
    primary_search_term: str
    alternate_terms: list[str]
    brand_summary: str = ""

    def ordered_terms(self) -> list[str]:
        return [self.primary_search_term, *self.alternate_terms]


_WEBSITE_SYNTHESIS_MODEL = "claude-haiku-4-5"
_WEBSITE_SYNTHESIS_MAX_INPUT_CHARS = 10_000
_WEBSITE_SYNTHESIS_SYSTEM = """\
you analyze a company's homepage excerpt and produce strict-evidence synthesis.

requirements:
- business_name must be grounded in homepage evidence.
- primary_search_term and alternate_terms should maximize exact advertiser/page-name matches.
- alternate_terms max 5, no duplicates, avoid generic marketing words.
- brand_summary: 3-5 sentences, grounded in the homepage, covering what the brand
  does, who it serves, its category/positioning, and its tone. no marketing fluff.

respond with json only.\
"""
_WEBSITE_SYNTHESIS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "business_name": {"type": "string"},
        "primary_search_term": {"type": "string"},
        "alternate_terms": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 5,
        },
        "brand_summary": {"type": "string"},
    },
    "required": [
        "business_name",
        "primary_search_term",
        "alternate_terms",
        "brand_summary",
    ],
    "additionalProperties": False,
}
_META_TERM_ALLOWED_CHARS_RE = re.compile(r"[^A-Za-z0-9&\-\.\s']")
_META_TERM_SPACE_RE = re.compile(r"\s+")
_AUDIENCE_MODEL = "claude-opus-4-8"
_AUDIENCE_MAX_INPUT_CHARS = 6_000
_AUDIENCE_SYSTEM = """\
You identify distinct customer and user segments for a brand. For each segment,
provide a succinct descriptive title and 2-3 sentence description. Base your
analysis strictly on the provided brand signals. Return 1-5 segments representing
meaningfully different audience archetypes.
"""
_AUDIENCE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "audiences": {
            "type": "array",
            "minItems": 1,
            "maxItems": 5,
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["title", "description"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["audiences"],
    "additionalProperties": False,
}
_AUDIENCE_MATCH_MODEL = "claude-sonnet-4-6"

_BRAND_SYNTHESIS_MODEL = "claude-sonnet-4-6"
_BRAND_SYNTHESIS_MAX_INPUT_CHARS = 8_000
_BRAND_SYNTHESIS_SYSTEM = """\
You compose a tight brand identity blurb that downstream graders will read to
judge whether a news story is relevant to this brand.

Write a single coherent paragraph of 150-200 words covering:
- topical focus: what the brand is about, the categories and themes it lives in
- strategic positioning: who it serves, what problem it solves, how it differs
- tone of voice: how the brand sounds (when tone evidence is provided)

Do not bullet. Do not hedge. Write declarative, present-tense, third-person.
Ground every claim in the supplied evidence; do not invent facts. If a section
of evidence is missing, simply omit that angle rather than guessing.
Return strict json.\
"""
_BRAND_SYNTHESIS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"synthesis": {"type": "string"}},
    "required": ["synthesis"],
    "additionalProperties": False,
}

_AUDIENCE_MATCH_MIN_SCORE = 0.6
_AUDIENCE_MATCH_SYSTEM = """\
You match a brand's customer segments against an existing catalog of in-house
audiences. For each brand segment, pick the single catalog audience whose target
customer is most semantically similar. Score the match from 0 to 1, where 1 is a
near-identical target and 0 is unrelated. If no catalog audience is a genuine
fit, still return your closest pick but score it low. Give a one-sentence reason.
Base the judgment only on the titles and descriptions provided.
"""
_AUDIENCE_MATCH_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "matches": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "brand_index": {"type": "integer"},
                    "audience_id": {"type": "string"},
                    "score": {"type": "number"},
                    "reason": {"type": "string"},
                },
                "required": ["brand_index", "audience_id", "score", "reason"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["matches"],
    "additionalProperties": False,
}


def _normalize_meta_term(value: str, *, max_len: int = 80) -> str:
    cleaned = _META_TERM_ALLOWED_CHARS_RE.sub(" ", (value or "").strip())
    cleaned = _META_TERM_SPACE_RE.sub(" ", cleaned).strip(" -'\".")
    if not cleaned:
        return ""
    return cleaned[:max_len].strip()


def website_synthesis_model() -> str:
    return _WEBSITE_SYNTHESIS_MODEL


def audience_model() -> str:
    return _AUDIENCE_MODEL


def website_synthesis_system_prompt() -> str:
    return _WEBSITE_SYNTHESIS_SYSTEM


def build_website_synthesis_prompt(
    *,
    homepage_url: str,
    homepage_markdown_excerpt: str,
) -> str:
    excerpt = (homepage_markdown_excerpt or "").strip()
    if len(excerpt) > _WEBSITE_SYNTHESIS_MAX_INPUT_CHARS:
        excerpt = excerpt[:_WEBSITE_SYNTHESIS_MAX_INPUT_CHARS]
    return render(
        """\
homepage_url: {homepage_url}

homepage_content:
---
{excerpt}
---

analyze this homepage and produce the synthesis.\
""",
        homepage_url=homepage_url,
        excerpt=excerpt,
    )


def _coerce_website_synthesis(
    raw: dict[str, Any],
    *,
    fallback_term: str,
    fallback_business_name: str,
) -> HomepageSynthesis:
    primary_raw = str(raw.get("primary_search_term") or "")
    alternates_raw = raw.get("alternate_terms")
    business_name_raw = str(raw.get("business_name") or "")

    candidates: list[str] = []
    primary = _normalize_meta_term(primary_raw)
    if primary:
        candidates.append(primary)

    if isinstance(alternates_raw, list):
        for item in alternates_raw:
            normalized = _normalize_meta_term(str(item or ""))
            if normalized:
                candidates.append(normalized)

    fallback = _normalize_meta_term(fallback_term)
    if fallback:
        candidates.append(fallback)

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = candidate.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
        if len(deduped) >= 6:
            break

    if not deduped:
        deduped = [fallback_term.strip()]

    business_name = business_name_raw.strip() or fallback_business_name
    business_name = business_name[:120].strip()
    if not business_name:
        business_name = fallback_term

    return HomepageSynthesis(
        business_name=business_name,
        primary_search_term=deduped[0],
        alternate_terms=deduped[1:],
        brand_summary=str(raw.get("brand_summary") or "").strip(),
    )


async def generate_website_synthesis(
    *,
    homepage_url: str,
    homepage_markdown_excerpt: str,
    domain_slug: str,
) -> HomepageSynthesis:
    fallback = _normalize_meta_term(domain_slug)
    if not fallback:
        raise ValueError("domain_slug is empty")
    fallback_business_name = domain_slug.replace("-", " ").replace("_", " ").strip()
    if not settings.anthropic_api_key.strip():
        return HomepageSynthesis(
            business_name=fallback_business_name,
            primary_search_term=fallback,
            alternate_terms=[],
        )

    user_message = build_website_synthesis_prompt(
        homepage_url=homepage_url,
        homepage_markdown_excerpt=homepage_markdown_excerpt,
    )
    parsed, _ = await call_llm_json(
        system_prompt=_WEBSITE_SYNTHESIS_SYSTEM,
        user_message=user_message,
        sampling={"thinking": False, "max_tokens": 600, "temperature": 0.2},
        schema=_WEBSITE_SYNTHESIS_SCHEMA,
        model=_WEBSITE_SYNTHESIS_MODEL,
    )
    return _coerce_website_synthesis(
        parsed,
        fallback_term=fallback,
        fallback_business_name=fallback_business_name,
    )


async def generate_brand_audiences(
    *,
    homepage_url: str,
    business_name: str,
    synthesis_summary: str,
    linkedin_structured: dict | None,
) -> list[dict[str, str]]:
    if not settings.anthropic_api_key.strip():
        return []

    name = (business_name or "").strip() or "unknown"
    synthesis = (synthesis_summary or "").strip() or "not available"
    linkedin = linkedin_structured if isinstance(linkedin_structured, dict) else None
    specialties_raw = (linkedin or {}).get("specialties")
    specialties: list[str] = []
    if isinstance(specialties_raw, list):
        specialties = [
            str(item or "").strip() for item in specialties_raw if str(item or "").strip()
        ]

    user_message = render(
        """\
brand: {business_name}
website: {homepage_url}

homepage synthesis:
{synthesis_summary}

linkedin profile:
- industry: {industry}
- overview: {overview}
- specialties: {specialties}
- employees: {employees}

identify 1-5 distinct audience segments for this brand.\
""",
        business_name=name,
        homepage_url=(homepage_url or "").strip(),
        synthesis_summary=synthesis,
        industry=str((linkedin or {}).get("industry") or "").strip() or "not available",
        overview=str((linkedin or {}).get("overview") or "").strip() or "not available",
        specialties=", ".join(specialties) if specialties else "not available",
        employees=str((linkedin or {}).get("employees") or "").strip() or "not available",
    )
    if len(user_message) > _AUDIENCE_MAX_INPUT_CHARS:
        user_message = user_message[:_AUDIENCE_MAX_INPUT_CHARS]

    parsed, _ = await call_llm_json(
        system_prompt=_AUDIENCE_SYSTEM,
        user_message=user_message,
        sampling={"thinking": False, "max_tokens": 900},
        schema=_AUDIENCE_SCHEMA,
        model=_AUDIENCE_MODEL,
    )
    raw = parsed.get("audiences")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        description = str(row.get("description") or "").strip()
        if not title or not description:
            continue
        out.append({"title": title, "description": description})
        if len(out) >= 5:
            break
    return out


_USER_AUDIENCE_SYSTEM = """\
You identify distinct audience segments that a professional appears to be
addressing in their linkedin posts. For each segment, provide a succinct title
and 2-3 sentence description. Base your analysis strictly on the profile and
post excerpts provided. Return 1-5 segments representing meaningfully different
audience archetypes they seem to be posting for.
"""


async def generate_user_audiences(
    *,
    full_name: str,
    headline: str,
    company: str,
    position: str,
    tenure_months: int | None,
    posts: list[dict[str, Any]],
) -> list[dict[str, str]]:
    if not settings.anthropic_api_key.strip():
        return []

    name = (full_name or "").strip() or "unknown"
    tenure = f"{tenure_months} months" if tenure_months is not None else "unknown"
    post_lines: list[str] = []
    for i, post in enumerate(posts[:50]):
        if not isinstance(post, dict):
            continue
        text = str(post.get("text") or "").strip()
        if text:
            post_lines.append(f"{i + 1}. {text[:500]}")
    posts_block = "\n".join(post_lines) if post_lines else "no posts available"

    user_message = render(
        """\
professional: {full_name}
headline: {headline}
current role: {position} at {company}
tenure: {tenure}

recent linkedin posts:
{posts_block}

identify 1-5 distinct audience segments this person appears to be posting for.\
""",
        full_name=name,
        headline=(headline or "").strip() or "not available",
        company=(company or "").strip() or "not available",
        position=(position or "").strip() or "not available",
        tenure=tenure,
        posts_block=posts_block[:_AUDIENCE_MAX_INPUT_CHARS],
    )
    if len(user_message) > _AUDIENCE_MAX_INPUT_CHARS:
        user_message = user_message[:_AUDIENCE_MAX_INPUT_CHARS]

    parsed, _ = await call_llm_json(
        system_prompt=_USER_AUDIENCE_SYSTEM,
        user_message=user_message,
        sampling={"thinking": False, "max_tokens": 900},
        schema=_AUDIENCE_SCHEMA,
        model=_AUDIENCE_MODEL,
    )
    raw = parsed.get("audiences")
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        description = str(row.get("description") or "").strip()
        if not title or not description:
            continue
        out.append({"title": title, "description": description})
        if len(out) >= 5:
            break
    return out


def audience_match_model() -> str:
    return _AUDIENCE_MATCH_MODEL


def brand_synthesis_model() -> str:
    return _BRAND_SYNTHESIS_MODEL


async def generate_brand_synthesis(
    *,
    homepage_summary: str,
    audiences: list[dict[str, Any]],
    tone_of_voice: str | None = None,
) -> str:
    """compose a 150-200 word brand identity blurb from existing brand evidence.
    used as the brand-side input to brand-story relevance scoring."""
    if not settings.anthropic_api_key.strip():
        return ""

    summary = (homepage_summary or "").strip() or "not available"

    audience_lines: list[str] = []
    for a in (audiences or [])[:5]:
        if not isinstance(a, dict):
            continue
        title = str(a.get("title") or "").strip()
        desc = str(a.get("description") or "").strip()
        if not title:
            continue
        if desc and len(desc) > 400:
            desc = desc[:400].rstrip() + "…"
        audience_lines.append(f"- {title}: {desc}" if desc else f"- {title}")
    audiences_block = "\n".join(audience_lines) if audience_lines else "not available"

    tone = (tone_of_voice or "").strip()
    tone_block = tone if tone else "not available"

    user_message = render(
        """\
[HOMEPAGE SUMMARY]
{summary}

[AUDIENCES]
{audiences}

[TONE OF VOICE]
{tone}

Compose the brand synthesis paragraph now.\
""",
        summary=summary,
        audiences=audiences_block,
        tone=tone_block,
    )
    if len(user_message) > _BRAND_SYNTHESIS_MAX_INPUT_CHARS:
        user_message = user_message[:_BRAND_SYNTHESIS_MAX_INPUT_CHARS]

    parsed, _ = await call_llm_json(
        system_prompt=_BRAND_SYNTHESIS_SYSTEM,
        user_message=user_message,
        sampling={"thinking": False, "max_tokens": 600, "temperature": 0.3},
        schema=_BRAND_SYNTHESIS_SCHEMA,
        model=_BRAND_SYNTHESIS_MODEL,
    )
    return str(parsed.get("synthesis") or "").strip()


async def match_brand_audiences_to_catalog(
    *,
    brand_audiences: list[dict[str, str]],
    catalog: list[dict[str, str]],
    min_score: float = _AUDIENCE_MATCH_MIN_SCORE,
) -> list[dict[str, Any]]:
    """For each brand audience return its single best catalog match above
    min_score, else no entry. Returns rows of
    {brand_index, audience_id, score, reason}."""
    if not settings.anthropic_api_key.strip():
        return []
    if not brand_audiences or not catalog:
        return []

    catalog_ids = {
        str(c.get("id") or "").strip() for c in catalog if str(c.get("id") or "").strip()
    }
    brand_lines = [
        {
            "index": i,
            "title": (a.get("title") or "").strip(),
            "description": (a.get("description") or "").strip(),
        }
        for i, a in enumerate(brand_audiences)
    ]
    catalog_lines = [
        {
            "id": str(c.get("id") or "").strip(),
            "title": (c.get("title") or "").strip(),
            "description": (c.get("description") or "").strip(),
        }
        for c in catalog
        if str(c.get("id") or "").strip()
    ]
    user_message = (
        "brand segments (match each by its index):\n"
        + json.dumps(brand_lines, ensure_ascii=True)
        + "\n\nin-house audience catalog (pick audience_id from these):\n"
        + json.dumps(catalog_lines, ensure_ascii=True)
    )
    parsed, _ = await call_llm_json(
        system_prompt=_AUDIENCE_MATCH_SYSTEM,
        user_message=user_message,
        sampling={"thinking": False, "max_tokens": 800},
        schema=_AUDIENCE_MATCH_SCHEMA,
        model=_AUDIENCE_MATCH_MODEL,
    )
    raw = parsed.get("matches")
    if not isinstance(raw, list):
        return []
    seen: set[int] = set()
    out: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        try:
            idx = int(row.get("brand_index"))
        except (TypeError, ValueError):
            continue
        if idx in seen or idx < 0 or idx >= len(brand_audiences):
            continue
        audience_id = str(row.get("audience_id") or "").strip()
        if audience_id not in catalog_ids:
            continue
        try:
            score = float(row.get("score"))
        except (TypeError, ValueError):
            continue
        score = max(0.0, min(1.0, score))
        if score < min_score:
            continue
        seen.add(idx)
        out.append(
            {
                "brand_index": idx,
                "audience_id": audience_id,
                "score": score,
                "reason": str(row.get("reason") or "").strip(),
            }
        )
    return out


def render(body: str, **values: Any) -> str:
    """Interpolate `{placeholder}` tokens while preserving literal JSON braces."""

    def _replace(m: re.Match[str]) -> str:
        key = m.group(1)
        if key in values:
            return str(values[key])
        return m.group(0)

    return _PLACEHOLDER_RE.sub(_replace, body)


def _should_retry(exc: BaseException) -> tuple[bool, str]:
    """retry 5xx + 524 (cloudflare) + 429, plus transport timeouts and connection blips."""
    if isinstance(exc, APIStatusError):
        status = getattr(exc, "status_code", None)
        if status is None:
            resp = getattr(exc, "response", None)
            status = getattr(resp, "status_code", None)
        if status in _RETRY_STATUS_CODES:
            return True, f"status={status}"
        return False, f"status={status}"
    if isinstance(exc, (APITimeoutError, APIConnectionError)):
        return True, type(exc).__name__
    if isinstance(exc, anthropic.APIStatusError):
        status = getattr(exc, "status_code", None)
        if status is None:
            resp = getattr(exc, "response", None)
            status = getattr(resp, "status_code", None)
        if status in _RETRY_STATUS_CODES:
            return True, f"status={status}"
        return False, f"status={status}"
    if isinstance(exc, (anthropic.APITimeoutError, anthropic.APIConnectionError)):
        return True, type(exc).__name__
    if isinstance(exc, (httpx.TimeoutException, httpx.RemoteProtocolError, httpx.ReadError)):
        return True, type(exc).__name__
    return False, type(exc).__name__


async def _with_retry(coro_factory, *, label: str = "llm"):
    """call `coro_factory()` up to len(_RETRY_DELAYS_SECONDS)+1 times on transient errors.

    coro_factory must build a fresh awaitable each call — awaitables aren't reusable.
    """
    attempts = len(_RETRY_DELAYS_SECONDS) + 1
    last_exc: BaseException | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await coro_factory()
        except Exception as exc:
            retry, reason = _should_retry(exc)
            last_exc = exc
            if not retry or attempt == attempts:
                if retry:
                    log.error(
                        "%s_exhausted attempts=%d reason=%s err=%r",
                        label,
                        attempt,
                        reason,
                        exc,
                    )
                raise
            delay = _RETRY_DELAYS_SECONDS[attempt - 1]
            log.warning(
                "%s_retry attempt=%d/%d reason=%s sleep=%.1fs",
                label,
                attempt,
                attempts,
                reason,
                delay,
            )
            await asyncio.sleep(delay)
    assert last_exc is not None
    raise last_exc


def _should_retry_output(exc: BaseException) -> bool:
    if isinstance(exc, json.JSONDecodeError):
        return True
    if not isinstance(exc, ValueError):
        return False
    msg = str(exc).strip().lower()
    if not msg:
        return False
    if "not configured" in msg or msg.startswith("unsupported llm model"):
        return False
    return True


async def _with_output_retry(coro_factory, *, label: str = "llm_output"):
    """retry call_llm_json + post-parse validation on bad model output."""
    attempts = len(_RETRY_DELAYS_SECONDS) + 1
    last_exc: BaseException | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await coro_factory()
        except Exception as exc:
            last_exc = exc
            if not _should_retry_output(exc) or attempt == attempts:
                raise
            delay = _RETRY_DELAYS_SECONDS[attempt - 1]
            log.warning(
                "%s_retry attempt=%d/%d reason=%s sleep=%.1fs err=%r",
                label,
                attempt,
                attempts,
                type(exc).__name__,
                delay,
                exc,
            )
            await asyncio.sleep(delay)
    assert last_exc is not None
    raise last_exc


def _strip_json_fence(content: str) -> str:
    content = content.strip()
    content = content.removeprefix("```json\n").removeprefix("```")
    content = content.removesuffix("```").strip()
    return content


async def call_llm(
    *,
    system_prompt: str,
    user_message: str,
    sampling: dict[str, Any],
    schema: dict[str, Any] | None = None,
    model: str | None = None,
) -> LLMResult:
    if schema is None:
        raise ValueError("JSON schema is required for LLM calls")
    resolved_model = (model or "").strip()
    if not resolved_model:
        raise ValueError("model is required")

    async def _invoke() -> LLMResult:
        if resolved_model.startswith("claude-"):
            return await anthropic_provider.call_json(
                model=resolved_model,
                system_prompt=system_prompt,
                user_message=user_message,
                sampling=sampling,
                schema=schema,
            )
        if resolved_model.startswith("grok-"):
            api_key = settings.xai_api_key.strip()
            if not api_key:
                raise ValueError("XAI_API_KEY not configured")
            return await openai_compat.call_json(
                model=resolved_model,
                system_prompt=system_prompt,
                user_message=user_message,
                sampling=sampling,
                schema=schema,
                base_url="https://api.x.ai/v1",
                api_key=api_key,
            )
        raise ValueError(f"unsupported LLM model: {resolved_model}")

    result = await _with_retry(_invoke, label="llm_call")
    result.output_text = _strip_json_fence(result.output_text)
    return result


async def call_llm_json(
    *,
    system_prompt: str,
    user_message: str,
    sampling: dict[str, Any],
    schema: dict[str, Any],
    model: str | None = None,
) -> tuple[dict[str, Any], LLMResult]:
    """Wrap `call_llm` with structured output and parse the response."""
    result = await call_llm(
        system_prompt=system_prompt,
        user_message=user_message,
        sampling=sampling,
        schema=schema,
        model=model,
    )
    try:
        parsed = json.loads(result.output_text)
    except json.JSONDecodeError as e:
        raise ValueError(
            f"model did not return valid JSON. raw={result.output_text[:300]!r}"
        ) from e
    return parsed, result


# --- sitmar (situational marketing) campaign generation ---------------------

_SITMAR_CREATIVE_MODEL = "claude-opus-4-8"
_SITMAR_CHAT_MODEL = _SITMAR_CREATIVE_MODEL
_SITMAR_IMAGE_MODEL = "grok-imagine-image"
_SITMAR_MAX_INPUT_CHARS = 8_000
_SITMAR_SEED_COUNT = 3
SITMAR_REGENERATE_USER_TEXT = "Generate new directions"
_SITMAR_OPENER_MESSAGES = (
    "Here are 3 ways {brand_name} can turn this story into attention",
    "I found 3 angles that could turn this story into attention for {brand_name}",
    "This story has a few strong attention angles for {brand_name}",
    "3 ways {brand_name} could jump on this story",
    "A few angles on this story that fit {brand_name}'s world",
    "This story's got some takes {brand_name}'s audience would feel",
    "Here are 3 directions for reacting to this, tuned to {brand_name}'s crowd",
    "3 angles on this one, picked for what {brand_name}'s people actually care about",
    "Pulled 3 ways into this story that'd land with {brand_name}'s audience",
)
_SITMAR_CHAT_SYSTEM_PREFIX = """\
You are a sharp AI/startup Twitter creative director with excellent taste. You find angles that spread on X while feeling naturally relevant to the brand's audience.

Your job: pick 3 strong, genuinely different DIRECTIONS for a single situational X post reacting to the news. You are selecting angles, not drafting tweets, hooks, or copy.

USE THE BRAND AS CONTEXT
Read the brand to understand its audience, product category, the user pain it speaks to, its worldview, and its natural tone — i.e. what kind of take would feel credible coming from this account. An angle may mention the brand if it makes the take sharper or more credible, but never force it. No links, no CTAs, no product pitch. The post should spread on its own merit and never read as an ad.

WHERE GOOD ANGLES LIVE
At the intersection of (1) what's new, specific, or surprising in the news, (2) what the brand's audience already feels, wants, fears, or struggles with, and (3) what AI/startup/tech Twitter would actually debate, quote, or feel seen by.

Strong angles tend to: reframe what the news is really about; connect it to a pain the audience already feels; name a feeling people rarely say out loud; expose a contradiction, cope, or status game; make a concrete prediction; turn it into an insider observation; or land a sharp comparison people grasp instantly.

MAKE THE 3 MEANINGFULLY DIFFERENT
They should diverge on real axes — emotional lever, implied reaction, level of abstraction, relationship to the news, humor vs seriousness, closeness to user pain vs broader cultural shift. Don't manufacture diversity or fill category slots; pick the 3 that give the strongest, most distinct creative choices for THIS brand, news, and audience. At least one should sit close to a real user pain, at least one should be broader than the immediate update, and at least one should be sharper or funnier than the rest.

Each angle should be specific to the news, native to tech Twitter, opinionated enough to carry tension, and simple enough to become one strong tweet — clear enough that a user can choose it in 3 seconds, but not so polished it already reads as the final post.

TASTE
Be specific and internet-native. Sound like a smart human, not a content assistant. Avoid corporate or LinkedIn voice, generic AI hype, forced memes, cringe slang, abstract strategy talk, and VC discourse unless the news truly demands it. Never invent facts. Ban-list (and anything in their spirit): "game-changer," "this changes everything," "the future is here," "let that sink in," "buckle up," "hot take," "moat."

TENSION OVER SAFETY
Don't default to the safest angle. The best one may be slightly uncomfortable, unusually direct, dryly funny, or annoying because it's true — something a strategist would soften and people would argue with. Aim for "lol true," "wait, that's the point," "I hate that I agree," "someone finally said it." Don't be edgy, random, or offensive for its own sake — just don't dodge tension because it feels impolite. If an angle reads like a conference panel or a brand approved it, push it back toward the timeline."""
_SITMAR_CHAT_SYSTEM_DIRECTIVES = """\
Return JSON with exactly 3 seeds. Each seed has:
- title: a short, scannable selectable title (7–10 words, hard max 12). State what the post is about, not the full take. Keep it punchy — avoid compound clauses.
- blurb: ≤16 words. Why people reply, repost, or quote.

All directions are for single tweets — never threads, quote tweets, long-form, or multi-post formats.

Before returning, sanity-check: are the 3 instantly distinguishable, all specific to this news, all credible for this audience, and can each become one strong tweet? If one is weak or redundant, replace it.

On refinement, revise all 3 seeds in light of the marketer's feedback. Do not repeat prior directions unless feedback asks to keep one."""
_SITMAR_CHAT_SYSTEM = _SITMAR_CHAT_SYSTEM_PREFIX + "\n\n" + _SITMAR_CHAT_SYSTEM_DIRECTIVES
_SITMAR_SEED_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "blurb": {"type": "string"},
    },
    "required": ["title", "blurb"],
    "additionalProperties": False,
}
_SITMAR_SEEDS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "seeds": {
            "type": "array",
            "minItems": _SITMAR_SEED_COUNT,
            "maxItems": _SITMAR_SEED_COUNT,
            "items": _SITMAR_SEED_SCHEMA,
        },
    },
    "required": ["seeds"],
    "additionalProperties": False,
}


def build_sitmar_chat_system_prompt() -> tuple[str, str]:
    """returns (prefix, directives) — prefix is user-editable, directives are fixed."""
    return _SITMAR_CHAT_SYSTEM_PREFIX, _SITMAR_CHAT_SYSTEM_DIRECTIVES


def sitmar_opener_message(brand_name: str) -> str:
    name = (brand_name or "").strip() or "your brand"
    template = random.choice(_SITMAR_OPENER_MESSAGES)
    return render(template, brand_name=name)


def _sitmar_prior_seed_directions(
    messages: list[dict[str, Any]] | None,
) -> list[tuple[str, str]]:
    seen: set[tuple[str, str]] = set()
    out: list[tuple[str, str]] = []
    for turn in messages or []:
        if not isinstance(turn, dict) or turn.get("role") != "assistant":
            continue
        for row in turn.get("seeds") or []:
            if not isinstance(row, dict):
                continue
            title = str(row.get("title") or "").strip()
            blurb = str(row.get("blurb") or "").strip()
            if not title:
                continue
            key = (title.lower(), blurb.lower())
            if key in seen:
                continue
            seen.add(key)
            out.append((title, blurb))
    return out


def _sitmar_latest_seeds(
    messages: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    for turn in reversed(messages or []):
        if not isinstance(turn, dict) or turn.get("role") != "assistant":
            continue
        seeds = turn.get("seeds")
        if isinstance(seeds, list) and seeds:
            return [s for s in seeds if isinstance(s, dict)]
    return []


def _sitmar_is_opener(messages: list[dict[str, Any]] | None) -> bool:
    return not _sitmar_prior_seed_directions(messages)


def _sitmar_format_direction_lines(seeds: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for row in seeds:
        title = str(row.get("title") or "").strip()
        blurb = str(row.get("blurb") or "").strip()
        if title:
            lines.append(f"- {title}: {blurb}" if blurb else f"- {title}")
    return lines


def _sitmar_last_user_text(messages: list[dict[str, Any]] | None) -> str:
    for turn in reversed(messages or []):
        if (
            isinstance(turn, dict)
            and turn.get("role") == "user"
            and turn.get("type") != "story_context"
        ):
            return str(turn.get("text") or "").strip()
    return ""


def _sitmar_chat_user_message(
    *,
    brand_name: str,
    brand_synthesis: str,
    audience_title: str,
    audience_description: str,
    story_title: str,
    story_summary: str,
    messages: list[dict[str, Any]] | None,
) -> str:
    """brand/audience/story context plus opener, refine, or regenerate instructions."""
    context = render(
        """\
brand: {brand_name}

brand intelligence:
{brand_synthesis}

target audience: {audience_title}
{audience_description}

news story: {story_title}
{story_summary}\
""",
        brand_name=(brand_name or "").strip() or "unknown",
        brand_synthesis=(brand_synthesis or "").strip() or "not available",
        audience_title=(audience_title or "").strip() or "general audience",
        audience_description=(audience_description or "").strip() or "not available",
        story_title=(story_title or "").strip() or "not available",
        story_summary=(story_summary or "").strip() or "not available",
    )
    if len(context) > _SITMAR_MAX_INPUT_CHARS:
        context = context[:_SITMAR_MAX_INPUT_CHARS]

    if _sitmar_is_opener(messages):
        return f"{context}\n\nPick 3 directions for this brand reacting to this news."

    last_user = _sitmar_last_user_text(messages)
    regenerate = last_user == SITMAR_REGENERATE_USER_TEXT

    if regenerate:
        prior = _sitmar_prior_seed_directions(messages)
        prior_block = ""
        if prior:
            prior_lines = [
                f"- {title}: {blurb}" if blurb else f"- {title}" for title, blurb in prior
            ]
            prior_block = (
                "\n\nPreviously offered directions "
                "(do not repeat or lightly rephrase any of these):\n" + "\n".join(prior_lines)
            )
        return (
            f"{context}{prior_block}\n\n"
            "Return a fresh set of 3 directions that differ meaningfully from "
            "every direction listed above."
        )

    current_lines = _sitmar_format_direction_lines(_sitmar_latest_seeds(messages))
    current_block = "\n\nCurrent directions:\n" + "\n".join(current_lines) if current_lines else ""
    feedback = last_user or "Revise the directions."
    return (
        f"{context}{current_block}\n\n"
        f"Marketer feedback: {feedback}\n\n"
        "Return a revised set of 3 directions."
    )


async def generate_sitmar_chat_turn(
    *,
    brand_name: str,
    brand_synthesis: str,
    audience_title: str,
    audience_description: str,
    story_title: str,
    story_summary: str,
    messages: list[dict[str, Any]] | None = None,
    system_prompt_prefix: str | None = None,
) -> dict[str, Any]:
    """one guided-chat turn: {message, seeds:[3x {title,blurb}]}. empty messages =
    opener; otherwise revise in light of the latest user turn."""
    if not settings.anthropic_api_key.strip():
        raise ValueError("ANTHROPIC_API_KEY not configured")

    if system_prompt_prefix is not None:
        system_prompt = system_prompt_prefix.rstrip() + "\n\n" + _SITMAR_CHAT_SYSTEM_DIRECTIVES
    else:
        system_prompt = _SITMAR_CHAT_SYSTEM

    user_message = _sitmar_chat_user_message(
        brand_name=brand_name,
        brand_synthesis=brand_synthesis,
        audience_title=audience_title,
        audience_description=audience_description,
        story_title=story_title,
        story_summary=story_summary,
        messages=messages,
    )

    async def _turn() -> dict[str, Any]:
        parsed, _ = await call_llm_json(
            system_prompt=system_prompt,
            user_message=user_message,
            sampling={"thinking": False, "max_tokens": 1800},
            schema=_SITMAR_SEEDS_SCHEMA,
            model=_SITMAR_CHAT_MODEL,
        )
        seeds: list[dict[str, str]] = []
        for row in parsed.get("seeds") or []:
            if not isinstance(row, dict):
                continue
            title = str(row.get("title") or "").strip()
            blurb = str(row.get("blurb") or "").strip()
            if title and blurb:
                seeds.append({"title": title, "blurb": blurb})
        if len(seeds) < _SITMAR_SEED_COUNT:
            raise ValueError("chat turn returned too few seeds")
        message = sitmar_opener_message(brand_name) if _sitmar_is_opener(messages) else ""
        return {
            "role": "assistant",
            "message": message,
            "seeds": seeds[:_SITMAR_SEED_COUNT],
        }

    return await _with_output_retry(_turn, label="sitmar_chat_turn")


_SITMAR_TITLE_MODEL = "claude-haiku-4-5"
_SITMAR_TITLE_SYSTEM = """\
You write a short, punchy title (max 6 words) for a reactive marketing campaign
that pairs a brand with a news story. No quotes, no trailing punctuation.
"""
_SITMAR_TITLE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"title": {"type": "string"}},
    "required": ["title"],
    "additionalProperties": False,
}


async def generate_sitmar_title(*, brand_name: str, story_title: str) -> str:
    """short haiku-written campaign title; falls back to a composed string."""
    fallback = f"{(brand_name or 'Brand').strip()} × {(story_title or 'story').strip()}"[:80]
    if not settings.anthropic_api_key.strip():
        return fallback
    try:
        parsed, _ = await call_llm_json(
            system_prompt=_SITMAR_TITLE_SYSTEM,
            user_message=f"brand: {brand_name}\nnews story: {story_title}",
            sampling={"thinking": False, "max_tokens": 60},
            schema=_SITMAR_TITLE_SCHEMA,
            model=_SITMAR_TITLE_MODEL,
        )
        title = str(parsed.get("title") or "").strip().strip('"')
        return title[:80] if title else fallback
    except Exception as e:  # noqa: BLE001
        log.warning("sitmar_title_failed err=%r", e)
        return fallback


_SITMAR_SEED_CONFIRM_MODEL = _SITMAR_CREATIVE_MODEL
_SITMAR_VIBE_COUNT = 3
_SITMAR_SEED_CONFIRM_SYSTEM = """\
You are a senior creative director at a reactive-marketing agency. A marketer
has chosen a campaign direction (title + blurb) that ties a brand to a breaking
news story. Your job:

1. Write a short, enthusiastic 1-2 sentence confirmation message about the
   chosen direction. If the marketer gave feedback, acknowledge what changed.
2. Return the campaign title and blurb. The blurb MUST be 25 words or
   fewer — never longer. If feedback was provided, revise title and blurb
   to incorporate it; otherwise echo them back verbatim.
3. Generate exactly 3 vibe chips — short 2-4 word labels representing tonal or
   strategic shifts the marketer could try next (e.g. "Punchier", "Lead with
   data", "Add urgency", "Softer tone", "More contrarian"). Make them diverse,
   specific to the current direction, and never generic.

Return strict json.\
"""
_SITMAR_SEED_CONFIRM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "message": {"type": "string"},
        "title": {"type": "string"},
        "blurb": {"type": "string"},
        "vibes": {
            "type": "array",
            "minItems": _SITMAR_VIBE_COUNT,
            "maxItems": _SITMAR_VIBE_COUNT,
            "items": {
                "type": "object",
                "properties": {"label": {"type": "string"}},
                "required": ["label"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["message", "title", "blurb", "vibes"],
    "additionalProperties": False,
}


def _sitmar_parse_vibes(raw: Any) -> list[dict[str, str]]:
    vibes: list[dict[str, str]] = []
    for row in raw or []:
        if isinstance(row, dict):
            label = str(row.get("label") or "").strip()
        elif isinstance(row, str):
            label = row.strip()
        else:
            continue
        if label:
            vibes.append({"label": label})
    return vibes


async def generate_sitmar_seed_confirm(
    *,
    brand_name: str,
    brand_synthesis: str,
    story_title: str,
    story_summary: str,
    seed_title: str,
    seed_blurb: str,
    feedback: str | None = None,
) -> dict[str, Any]:
    if not settings.anthropic_api_key.strip():
        raise ValueError("ANTHROPIC_API_KEY not configured")
    parts = [
        render(
            """\
brand: {brand_name}
brand intelligence: {brand_synthesis}
news story: {story_title} — {story_summary}
selected direction: {seed_title} — {seed_blurb}\
""",
            brand_name=(brand_name or "").strip() or "unknown",
            brand_synthesis=(brand_synthesis or "").strip() or "not available",
            story_title=(story_title or "").strip() or "not available",
            story_summary=(story_summary or "").strip() or "not available",
            seed_title=(seed_title or "").strip(),
            seed_blurb=(seed_blurb or "").strip(),
        ),
    ]
    if feedback:
        parts.append(f"\nmarketer feedback: {feedback.strip()}")
        parts.append(
            "\nRevise the title and blurb to incorporate this feedback, then "
            "suggest 3 new vibe options."
        )
    else:
        parts.append(
            "\nThe marketer just selected this direction. Confirm it and "
            "suggest 3 vibe options for possible refinement."
        )
    user_message = "".join(parts)

    async def _confirm() -> dict[str, Any]:
        parsed, _ = await call_llm_json(
            system_prompt=_SITMAR_SEED_CONFIRM_SYSTEM,
            user_message=user_message,
            sampling={"thinking": False, "max_tokens": 800},
            schema=_SITMAR_SEED_CONFIRM_SCHEMA,
            model=_SITMAR_SEED_CONFIRM_MODEL,
        )
        message = str(parsed.get("message") or "").strip()
        title = str(parsed.get("title") or "").strip()
        blurb = str(parsed.get("blurb") or "").strip()
        vibes = _sitmar_parse_vibes(parsed.get("vibes"))
        if not message or not title or not blurb:
            raise ValueError("seed confirm returned empty message/title/blurb")
        if len(vibes) < _SITMAR_VIBE_COUNT:
            raise ValueError(
                f"seed confirm returned {len(vibes)} vibes, need {_SITMAR_VIBE_COUNT}. "
                f"raw={parsed.get('vibes')!r}"
            )
        return {
            "message": message,
            "title": title,
            "blurb": blurb,
            "vibes": vibes[:_SITMAR_VIBE_COUNT],
        }

    return await _with_output_retry(_confirm, label="sitmar_seed_confirm")


_SITMAR_TWEET_MODEL = _SITMAR_CREATIVE_MODEL
_SITMAR_TWEET_ROUTES = ("recommended", "provocative", "casual")
_SITMAR_TWEET_COUNT = len(_SITMAR_TWEET_ROUTES)
_SITMAR_TWEET_SYSTEM = """\
ROLE
You're an AI/startup Twitter senior copywriter — timeline-native instincts, good taste. You write posts that feel like they came off the timeline, not out of a content calendar.

The brand is hidden context only — use it for audience, category, user pain, relevance, and tone boundaries. Never mention, name, hint at, link to, or promote the brand or product. No CTA (try, buy, sign up, join, follow, learn more). The post earns its spread with nothing attached. Even if the chosen angle mentions the brand, the tweet must not.

TASK
Write exactly 3 ready-to-post single tweets from the chosen angle. The angle is the spine of all three — don't drift into a different take or into generic commentary about the news category. Use the news as proof, not a feature summary; one concrete detail is enough if it supports the take. You may name relevant tools, competitors, or categories if it makes the take sharper or funnier.

Each tweet must react clearly to the news, follow the angle, feel native to AI/startup/tech Twitter, open with a scroll-stopping first line, and work as one standalone post that earns replies, quotes, or reposts.

THE 3 ROUTES
All three are trying to win — the difference is the route to virality, not the quality. Never make one intentionally safe or bland. Vary the hook, structure, rhythm, length, and emotional lever so they're not one take reworded.

1. recommended — best default. Balanced but still sharp, strong first line, high repost potential. The one you'd show first. Recommended is still sharp — balanced means readable and repostable, not corporate or neutral.
2. provocative — more tension, more direct opinion, more likely to draw replies and quotes. Can annoy the right people and sit a little uncomfortable, but never forced, random, edgy, or a cheap dunk.
3. casual — effortless, throwaway-native. Shorter or looser, closer to "lol true." Sounds less written; easy to repost because it feels human and obvious.

VOICE
Write like a real person posting a sharp take. Casual, simple, specific, a little funny when it's natural. Short lines and sentence fragments. Lowercase when it feels native. One clear idea per post. A concrete example over an abstract claim.

Loosen the punctuation — this should feel posted, not proofread. Don't end every line with a period; skip the final period on short punchy lines. Use punctuation only when it helps the rhythm. Avoid "That's X. That's Y." endings and neat conclusion lines that re-explain the take.

DON'T
- Don't sound like an essay, a keynote, or LinkedIn. No abstract thesis sentences, fake profundity, dramatic metaphors, manifesto energy, or over-explaining.
- No corporate language, generic AI hype, forced slang, forced dunks, or engagement bait.
- No summary or thesis line at the end. The post shouldn't explain itself.

NEVER USE these words/phrases:
delve, dive into, landscape, tapestry, transformative, unleash, unlock, elevate, leverage (verb), crucial, vital, moreover, furthermore, "let's", "in today's fast-paced world", "in conclusion", "it's worth noting", "game-changer", "this changes everything", "the future is here" / "the future of", "let that sink in", "buckle up", "hot take", "as an AI", "it's not X — it's Y" / "this is not about X, it's about Y", "is the tell", "is the point", "the quiet admission", "the real shift", "the underrated part", "the correct direction", "what people miss", "insane behavior", "belongs in therapy", "brutal", "cursed", "dunks on".

HARD RULES
Front-load the most interesting words. Active voice. Single tweet only — no threads, quote tweets, CTAs, or links. No hashtags. No emoji in the first two lines. No semicolons. No dramatic em-dashes. No markdown or labels inside the post. Use "you" only when natural. Each tweet must be ≤280 characters.

OUTPUT
Return strict JSON with exactly 3 tweets, one per route: recommended, provocative, casual. Each item has route and text. Do not include route labels or markdown inside tweet text.

FINAL CHECK
Before returning each tweet: would a real tech-Twitter person post this without cringing? One clear idea, not too polished, not trying too hard to sound smart or edgy? Meaningfully different from the other two? If not, simplify it.\
"""
_SITMAR_TWEET_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "tweets": {
            "type": "array",
            "minItems": _SITMAR_TWEET_COUNT,
            "maxItems": _SITMAR_TWEET_COUNT,
            "items": {
                "type": "object",
                "properties": {
                    "route": {"type": "string", "enum": list(_SITMAR_TWEET_ROUTES)},
                    "text": {"type": "string"},
                },
                "required": ["route", "text"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["tweets"],
    "additionalProperties": False,
}


def build_sitmar_tweet_user_message(
    *,
    brand_name: str,
    brand_synthesis: str,
    audience_title: str,
    audience_description: str,
    story_title: str,
    story_summary: str,
    seed_title: str,
    seed_blurb: str,
) -> str:
    return render(
        """\
<brand_context>
brand: {brand_name}
{brand_synthesis}
</brand_context>

<audience>
{audience_title}
{audience_description}
</audience>

<news_context>
{story_title}
{story_summary}
</news_context>

<chosen_angle>
title: {seed_title}
why it spreads: {seed_blurb}
</chosen_angle>

Write exactly 3 ready-to-post tweets, one per route (recommended, provocative, casual).\
""",
        brand_name=(brand_name or "").strip() or "unknown",
        brand_synthesis=(brand_synthesis or "").strip() or "not available",
        audience_title=(audience_title or "").strip() or "general audience",
        audience_description=(audience_description or "").strip() or "not available",
        story_title=(story_title or "").strip() or "not available",
        story_summary=(story_summary or "").strip() or "not available",
        seed_title=(seed_title or "").strip(),
        seed_blurb=(seed_blurb or "").strip(),
    )


def _sitmar_parse_tweets(raw: Any) -> list[dict[str, str]]:
    by_route: dict[str, str] = {}
    for row in raw or []:
        if not isinstance(row, dict):
            continue
        route = str(row.get("route") or "").strip().lower()
        text = str(row.get("text") or "").strip()
        if route not in _SITMAR_TWEET_ROUTES or not text or route in by_route:
            continue
        by_route[route] = text[:280]
    tweets = [
        {"route": route, "text": by_route[route]}
        for route in _SITMAR_TWEET_ROUTES
        if route in by_route
    ]
    if len(tweets) < _SITMAR_TWEET_COUNT:
        raise ValueError(
            f"tweet generation returned {len(tweets)} tweets, need {_SITMAR_TWEET_COUNT}"
        )
    return tweets


async def generate_sitmar_tweets(
    *,
    brand_name: str,
    brand_synthesis: str,
    audience_title: str = "",
    audience_description: str = "",
    story_title: str,
    story_summary: str,
    seed_title: str,
    seed_blurb: str,
) -> list[dict[str, str]]:
    if not settings.anthropic_api_key.strip():
        raise ValueError("ANTHROPIC_API_KEY not configured")
    user_message = build_sitmar_tweet_user_message(
        brand_name=brand_name,
        brand_synthesis=brand_synthesis,
        audience_title=audience_title,
        audience_description=audience_description,
        story_title=story_title,
        story_summary=story_summary,
        seed_title=seed_title,
        seed_blurb=seed_blurb,
    )
    parsed, _ = await call_llm_json(
        system_prompt=_SITMAR_TWEET_SYSTEM,
        user_message=user_message,
        sampling={"thinking": False, "max_tokens": 1200},
        schema=_SITMAR_TWEET_SCHEMA,
        model=_SITMAR_TWEET_MODEL,
    )
    return _sitmar_parse_tweets(parsed.get("tweets"))


_SITMAR_TWEET_REFINE_SYSTEM = """\
You revise a single X/Twitter post for a reactive marketing campaign. The marketer is viewing one draft and sent feedback. Return only the revised post text.

Keep the same route, angle, and overall take unless feedback explicitly asks to change them. Apply only what the feedback requests — do not rewrite unrelated parts. Never mention the brand or product. No hashtags, CTAs, or links. ≤280 characters.

Match the voice of the original draft: casual, timeline-native, specific, not over-polished. No corporate slop, no "hot take", no thesis-line endings, no "game-changer" / "let that sink in" / "it's not X it's Y" patterns.\
"""
_SITMAR_TWEET_REFINE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"text": {"type": "string"}},
    "required": ["text"],
    "additionalProperties": False,
}


def build_sitmar_tweet_refine_user_message(
    *,
    brand_name: str,
    brand_synthesis: str,
    audience_title: str,
    audience_description: str,
    story_title: str,
    story_summary: str,
    seed_title: str,
    seed_blurb: str,
    route: str,
    current_text: str,
    feedback: str,
) -> str:
    context = build_sitmar_tweet_user_message(
        brand_name=brand_name,
        brand_synthesis=brand_synthesis,
        audience_title=audience_title,
        audience_description=audience_description,
        story_title=story_title,
        story_summary=story_summary,
        seed_title=seed_title,
        seed_blurb=seed_blurb,
    )
    route_label = (route or "").strip() or "recommended"
    return (
        f"{context}\n\n"
        f'<current_post route="{route_label}">\n'
        f"{(current_text or '').strip()}\n"
        f"</current_post>\n\n"
        f"Marketer feedback: {(feedback or '').strip()}\n\n"
        "Revise only this post. Return the updated text."
    )


async def generate_sitmar_tweet_refine(
    *,
    brand_name: str,
    brand_synthesis: str,
    audience_title: str = "",
    audience_description: str = "",
    story_title: str,
    story_summary: str,
    seed_title: str,
    seed_blurb: str,
    route: str,
    current_text: str,
    feedback: str,
) -> str:
    if not settings.anthropic_api_key.strip():
        raise ValueError("ANTHROPIC_API_KEY not configured")
    user_message = build_sitmar_tweet_refine_user_message(
        brand_name=brand_name,
        brand_synthesis=brand_synthesis,
        audience_title=audience_title,
        audience_description=audience_description,
        story_title=story_title,
        story_summary=story_summary,
        seed_title=seed_title,
        seed_blurb=seed_blurb,
        route=route,
        current_text=current_text,
        feedback=feedback,
    )

    async def _refine() -> str:
        parsed, _ = await call_llm_json(
            system_prompt=_SITMAR_TWEET_REFINE_SYSTEM,
            user_message=user_message,
            sampling={"thinking": False, "max_tokens": 500},
            schema=_SITMAR_TWEET_REFINE_SCHEMA,
            model=_SITMAR_TWEET_MODEL,
        )
        text = str(parsed.get("text") or "").strip()
        if not text:
            raise ValueError("tweet refine returned empty text")
        return text[:280]

    return await _with_output_retry(_refine, label="sitmar_tweet_refine")


_SITMAR_REPLY_MODEL = "claude-haiku-4-5"
_SITMAR_REPLY_SYSTEM = """\
You write a short reply from a brand's X/Twitter account to a third-party post,
as part of a reactive marketing campaign. The reply should feel like natural
conversation — pithy, warm, and confident. No hashtags, no emojis unless truly
fitting. Brevity is the soul of wit: if you can say it in fewer words, do.
Hard cap: 150 characters. Aim shorter.
"""
_SITMAR_REPLY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"reply": {"type": "string"}},
    "required": ["reply"],
    "additionalProperties": False,
}


async def generate_sitmar_reply(
    *,
    brand_name: str,
    brand_synthesis: str,
    brand_tweet: str,
    story_title: str,
    story_summary: str,
    target_post_text: str,
    target_post_author: str = "",
    feedback: str = "",
) -> str:
    if not settings.anthropic_api_key.strip():
        raise ValueError("ANTHROPIC_API_KEY not configured")
    parts = [
        f"brand: {(brand_name or '').strip() or 'unknown'}",
        f"brand intelligence: {(brand_synthesis or '').strip() or 'not available'}",
        f"news story: {(story_title or '').strip()} — {(story_summary or '').strip()}",
        f"the brand's own tweet: {(brand_tweet or '').strip()}",
        f"post to reply to (by {(target_post_author or 'someone').strip()}): {(target_post_text or '').strip()}",
        "",
        "Write one reply this brand would post under the above post.",
    ]
    if feedback and feedback.strip():
        parts.append(f"The user wants: {feedback.strip()}")
    parsed, _ = await call_llm_json(
        system_prompt=_SITMAR_REPLY_SYSTEM,
        user_message="\n".join(parts),
        sampling={"thinking": False, "max_tokens": 300},
        schema=_SITMAR_REPLY_SCHEMA,
        model=_SITMAR_REPLY_MODEL,
    )
    text = str(parsed.get("reply") or "").strip()
    if not text:
        raise ValueError("reply generation returned empty text")
    return text[:150]


def _compact_prompt_field(value: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 3)].rstrip() + "..."


def build_sitmar_image_prompt(
    *,
    brand_name: str,
    logline: str,
    concept: str,
    brand_context: str = "",
    audience_title: str = "",
    audience_description: str = "",
    story_title: str = "",
    story_summary: str = "",
) -> str:
    brand_line = _compact_prompt_field(brand_context, 220) or "not available"
    audience_line = (
        _compact_prompt_field(
            " - ".join(
                p
                for p in [
                    str(audience_title or "").strip(),
                    str(audience_description or "").strip(),
                ]
                if p
            ),
            220,
        )
        or "not available"
    )
    story_line = (
        _compact_prompt_field(
            " - ".join(
                p
                for p in [
                    str(story_title or "").strip(),
                    str(story_summary or "").strip(),
                ]
                if p
            ),
            260,
        )
        or "not available"
    )
    logline_text = _compact_prompt_field(logline, 180)
    concept_text = _compact_prompt_field(concept, 520)
    return render(
        """\
advertising campaign key art.

brand: {brand_name}
brand context: {brand_context}
target audience: {audience}
news hook: {story}
creative concept: {logline} {concept}

visual direction: bold, polished, editorial advertising photography style. make the metaphor instantly legible without text.
constraints: no text, no logos, no watermarks.\
""",
        brand_name=(brand_name or "").strip() or "unknown",
        brand_context=brand_line,
        audience=audience_line,
        story=story_line,
        logline=logline_text,
        concept=concept_text,
    ).strip()


# --- homepage story suggestions (haiku) -------------------------------------

_HOME_SUGGEST_MODEL = "claude-haiku-4-5"
_HOME_SUGGEST_SYSTEM = """\
You help a marketer pick trending news stories to react to with their brand.
From the numbered list, pick exactly 4:
1. The most active story (highest engagement across audiences).
2. The story with the highest brand score (semantic relevance to the brand).
3-4. Your choice — stories with an interesting angle for the brand, a good cultural moment, or creative potential.

Return a short message (25 words or fewer — never more) introducing your picks, and the 4 story indices with a one-sentence reason each.\
"""
_HOME_SUGGEST_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "message": {"type": "string"},
        "picks": {
            "type": "array",
            "minItems": 4,
            "maxItems": 4,
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "reason": {"type": "string"},
                },
                "required": ["index", "reason"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["message", "picks"],
    "additionalProperties": False,
}


async def generate_home_story_suggestions(
    *,
    brand_name: str,
    brand_synthesis: str,
    stories: list[dict[str, Any]],
) -> dict[str, Any]:
    """ask haiku to pick 4 stories from an abridged list for the homepage chat."""
    if not settings.anthropic_api_key.strip():
        raise ValueError("ANTHROPIC_API_KEY not configured")

    lines: list[str] = []
    for i, s in enumerate(stories):
        headline = str(s.get("headline") or "").strip()
        summary = str(s.get("summary") or "").strip()[:200]
        posts = s.get("post_count") or 0
        views = s.get("top_post_views") or 0
        brand_score = s.get("brand_score")
        score_text = (
            f", brand score {float(brand_score):.2f}"
            if isinstance(brand_score, (int, float))
            else ", brand score n/a"
        )
        lines.append(f"{i}. {headline} — {summary} ({posts} posts, {views} views{score_text})")

    user_message = render(
        """\
brand: {brand_name}

brand intelligence:
{brand_synthesis}

stories:
{story_list}\
""",
        brand_name=(brand_name or "").strip() or "unknown",
        brand_synthesis=(brand_synthesis or "").strip()[:3000] or "not available",
        story_list="\n".join(lines),
    )

    parsed, _ = await call_llm_json(
        system_prompt=_HOME_SUGGEST_SYSTEM,
        user_message=user_message,
        sampling={"thinking": False, "max_tokens": 800},
        schema=_HOME_SUGGEST_SCHEMA,
        model=_HOME_SUGGEST_MODEL,
    )
    message = str(parsed.get("message") or "").strip()
    picks: list[dict[str, Any]] = []
    for p in parsed.get("picks") or []:
        if not isinstance(p, dict):
            continue
        idx = p.get("index")
        reason = str(p.get("reason") or "").strip()
        if isinstance(idx, int) and 0 <= idx < len(stories) and reason:
            picks.append({"index": idx, "reason": reason})
    if len(picks) < 4:
        raise ValueError("haiku returned too few story picks")
    return {"message": message, "picks": picks[:4]}


# --- llm-authored grok image prompt -----------------------------------------
# instead of stapling raw context together (build_sitmar_image_prompt, now the
# fallback), sonnet writes a tight art-directed text-to-image prompt per concept.
_SITMAR_IMAGE_PROMPT_MODEL = "claude-sonnet-4-6"
_SITMAR_IMAGE_PROMPT_SYSTEM = """\
You are an expert at writing concise text-to-image prompts for advertising key
art. Given a brand, a news story, and a single creative concept, write ONE vivid
prompt that an image model can render directly. Translate the concept into
concrete visual direction: subject, composition, lighting, style, and mood. Keep
it tight (roughly 60-90 words), make the central metaphor instantly legible, and
favor bold, polished, editorial advertising photography. Hard constraints: no
text, no logos, no watermarks. Output only the prompt string.
"""
_SITMAR_IMAGE_PROMPT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"image_prompt": {"type": "string"}},
    "required": ["image_prompt"],
    "additionalProperties": False,
}


def build_image_prompt_request(
    *,
    brand_synthesis: str,
    story_title: str,
    story_summary: str,
    logline: str,
    concept: str,
) -> tuple[str, str]:
    """(system, user) for the sonnet call that authors the grok prompt. shared by
    the generator and the modal preview so the two can't drift."""
    story_line = (
        _compact_prompt_field(
            " - ".join(
                p
                for p in [
                    str(story_title or "").strip(),
                    str(story_summary or "").strip(),
                ]
                if p
            ),
            300,
        )
        or "not available"
    )
    user_message = render(
        """\
brand intelligence:
{brand_synthesis}

news hook: {story}

creative concept:
{logline} {concept}

write the image prompt.\
""",
        brand_synthesis=_compact_prompt_field(brand_synthesis, 600) or "not available",
        story=story_line,
        logline=_compact_prompt_field(logline, 200),
        concept=_compact_prompt_field(concept, 600),
    )
    if len(user_message) > _SITMAR_MAX_INPUT_CHARS:
        user_message = user_message[:_SITMAR_MAX_INPUT_CHARS]
    return _SITMAR_IMAGE_PROMPT_SYSTEM, user_message


async def generate_image_prompt(
    *,
    brand_synthesis: str,
    story_title: str,
    story_summary: str,
    logline: str,
    concept: str,
) -> str:
    """sonnet-authored grok image prompt; falls back to the deterministic template
    (build_sitmar_image_prompt) when the anthropic call is unavailable or fails."""

    def _fallback() -> str:
        return build_sitmar_image_prompt(
            brand_name="",
            brand_context=brand_synthesis,
            story_title=story_title,
            story_summary=story_summary,
            logline=logline,
            concept=concept,
        )

    if not settings.anthropic_api_key.strip():
        return _fallback()
    system_prompt, user_message = build_image_prompt_request(
        brand_synthesis=brand_synthesis,
        story_title=story_title,
        story_summary=story_summary,
        logline=logline,
        concept=concept,
    )
    try:
        parsed, _ = await call_llm_json(
            system_prompt=system_prompt,
            user_message=user_message,
            sampling={"thinking": False, "max_tokens": 400},
            schema=_SITMAR_IMAGE_PROMPT_SCHEMA,
            model=_SITMAR_IMAGE_PROMPT_MODEL,
        )
        prompt = str(parsed.get("image_prompt") or "").strip()
        return prompt or _fallback()
    except Exception as e:  # noqa: BLE001 - resilient: fall back to the template
        log.warning("sitmar_image_prompt_failed err=%r", e)
        return _fallback()


async def generate_concept_image(*, prompt: str) -> tuple[bytes, str] | None:
    """Generate one square campaign image via Grok Imagine. Timeout-bounded;
    returns (bytes, mime) or None on timeout/error (caller keeps concept text)."""
    api_key = settings.xai_api_key.strip()
    if not api_key:
        return None
    try:
        return await asyncio.wait_for(
            openai_compat.generate_image_b64(
                model=_SITMAR_IMAGE_MODEL,
                prompt=prompt,
                base_url="https://api.x.ai/v1",
                api_key=api_key,
                aspect_ratio="1:1",
            ),
            timeout=float(settings.sitmar_image_timeout_seconds),
        )
    except Exception as e:  # noqa: BLE001 - resilient by design (incl. timeout)
        log.warning("sitmar_image_failed err=%r", e)
        return None
