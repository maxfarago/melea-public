from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime, timedelta
from decimal import ROUND_CEILING, Decimal, InvalidOperation
from typing import Any

import httpx
from fastapi.responses import JSONResponse

from api.db.sqlite import db
from commons.config import settings

_ANTHROPIC_MESSAGES_USAGE_REPORT_URL = (
    "https://api.anthropic.com/v1/organizations/usage_report/messages"
)
_XAI_MANAGEMENT_API_URL = "https://management-api.x.ai"
_STATUS_CACHE_TTL_SECONDS = 120
_ANTHROPIC_USAGE_CHUNK_HOURS = 168
_anthropic_status_cache: dict[str, Any] = {"data": None, "fetched_at": 0.0}
_xai_status_cache: dict[str, Any] = {"data": None, "fetched_at": 0.0}
_TWITTER_USAGE_URL = "https://api.x.com/2/usage/tweets"
_twitter_status_cache: dict[str, Any] = {"data": None, "fetched_at": 0.0}
_TWITTER_READ_RATE = Decimal("0.005")  # per post, general read

_ANTHROPIC_MODEL_PRICING: tuple[tuple[str, Decimal, Decimal], ...] = (
    ("claude-haiku-4-5", Decimal("1"), Decimal("5")),
    ("claude-sonnet-4-6", Decimal("3"), Decimal("15")),
    ("claude-sonnet-4-5", Decimal("3"), Decimal("15")),
    ("claude-sonnet-4-", Decimal("3"), Decimal("15")),
    ("claude-opus-4-8", Decimal("5"), Decimal("25")),
    ("claude-opus-4-7", Decimal("5"), Decimal("25")),
    ("claude-opus-4-6", Decimal("5"), Decimal("25")),
    ("claude-opus-4-5", Decimal("5"), Decimal("25")),
    ("claude-opus-4-1", Decimal("15"), Decimal("75")),
    ("claude-opus-4-202", Decimal("15"), Decimal("75")),
)


def _current_month_range() -> tuple[datetime, datetime]:
    now = datetime.now(UTC)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0), now


def _rfc3339_seconds(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _xai_time(value: datetime) -> str:
    return value.replace(microsecond=0).strftime("%Y-%m-%d %H:%M:%S")


def _cost_amount(value: Any) -> Decimal:
    try:
        return Decimal(str(value or "0"))
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _anthropic_rates_for_model(model: str | None) -> tuple[Decimal, Decimal] | None:
    model_name = str(model or "")
    for prefix, input_rate, output_rate in _ANTHROPIC_MODEL_PRICING:
        if model_name.startswith(prefix):
            return input_rate, output_rate
    return None


def _estimate_anthropic_usage_cost(payload: dict[str, Any]) -> Decimal:
    total = Decimal("0")
    for bucket in payload.get("data") or []:
        if not isinstance(bucket, dict):
            continue
        for result in bucket.get("results") or []:
            if not isinstance(result, dict):
                continue
            rates = _anthropic_rates_for_model(result.get("model"))
            if rates is None:
                continue
            input_rate, output_rate = rates
            cache = result.get("cache_creation") or {}
            input_tokens = (
                Decimal(str(result.get("uncached_input_tokens") or 0))
                + Decimal(str(cache.get("ephemeral_5m_input_tokens") or 0)) * Decimal("1.25")
                + Decimal(str(cache.get("ephemeral_1h_input_tokens") or 0)) * Decimal("2")
                + Decimal(str(result.get("cache_read_input_tokens") or 0)) * Decimal("0.1")
            )
            output_tokens = Decimal(str(result.get("output_tokens") or 0))
            total += (input_tokens * input_rate + output_tokens * output_rate) / Decimal("1000000")
    return total


async def _fetch_anthropic_usage_chunk(
    client: httpx.AsyncClient,
    *,
    api_key: str,
    starting_at: datetime,
    ending_at: datetime,
) -> Decimal:
    headers = {
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }
    page: str | None = None
    total = Decimal("0")
    while True:
        params: list[tuple[str, str | int]] = [
            ("starting_at", _rfc3339_seconds(starting_at)),
            ("ending_at", _rfc3339_seconds(ending_at)),
            ("bucket_width", "1h"),
            ("group_by[]", "model"),
            ("limit", 168),
        ]
        if page:
            params.append(("page", page))
        resp = await client.get(
            _ANTHROPIC_MESSAGES_USAGE_REPORT_URL,
            params=params,
            headers=headers,
        )
        resp.raise_for_status()
        payload = resp.json()
        total += _estimate_anthropic_usage_cost(payload)
        if not payload.get("has_more"):
            break
        page = str(payload.get("next_page") or "")
        if not page:
            break
    return total


async def _fetch_anthropic_status() -> dict[str, float] | None:
    now = time.time()
    if now - float(_anthropic_status_cache["fetched_at"] or 0.0) < _STATUS_CACHE_TTL_SECONDS:
        return _anthropic_status_cache["data"]

    api_key = settings.anthropic_admin_key.strip()
    if not api_key:
        _anthropic_status_cache.update({"data": None, "fetched_at": now})
        return None

    starting_at, ending_at = _current_month_range()
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            cursor = starting_at
            dollars = Decimal("0")
            while cursor < ending_at:
                chunk_end = min(
                    cursor + timedelta(hours=_ANTHROPIC_USAGE_CHUNK_HOURS),
                    ending_at,
                )
                dollars += await _fetch_anthropic_usage_chunk(
                    client,
                    api_key=api_key,
                    starting_at=cursor,
                    ending_at=chunk_end,
                )
                cursor = chunk_end
    except Exception:
        _anthropic_status_cache.update({"data": None, "fetched_at": now})
        return None

    data = {"mtd_spend_usd": float(dollars.quantize(Decimal("0.01")))}
    _anthropic_status_cache.update({"data": data, "fetched_at": now})
    return data


def _sum_xai_usage_usd(payload: dict[str, Any]) -> Decimal:
    total = Decimal("0")
    for series in payload.get("timeSeries") or []:
        if not isinstance(series, dict):
            continue
        for point in series.get("dataPoints") or []:
            if not isinstance(point, dict):
                continue
            for value in point.get("values") or []:
                total += _cost_amount(value)
    return total


def _round_up_cents(value: Decimal) -> Decimal:
    if value <= 0:
        return Decimal("0.00")
    return value.quantize(Decimal("0.01"), rounding=ROUND_CEILING)


async def _fetch_xai_status() -> dict[str, float] | None:
    now = time.time()
    if now - float(_xai_status_cache["fetched_at"] or 0.0) < _STATUS_CACHE_TTL_SECONDS:
        return _xai_status_cache["data"]

    api_key = settings.xai_admin_key.strip()
    team_id = settings.xai_team_id.strip()
    if not api_key or not team_id:
        _xai_status_cache.update({"data": None, "fetched_at": now})
        return None

    headers = {"Authorization": f"Bearer {api_key}"}
    starting_at, ending_at = _current_month_range()
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{_XAI_MANAGEMENT_API_URL}/v1/billing/teams/{team_id}/usage",
                headers=headers,
                json={
                    "analyticsRequest": {
                        "timeRange": {
                            "startTime": _xai_time(starting_at),
                            "endTime": _xai_time(ending_at),
                            "timezone": "Etc/GMT",
                        },
                        "timeUnit": "TIME_UNIT_DAY",
                        "values": [{"name": "usd", "aggregation": "AGGREGATION_SUM"}],
                        "groupBy": ["description"],
                        "filters": [],
                    }
                },
            )
            resp.raise_for_status()
            payload = resp.json()
            dollars = _sum_xai_usage_usd(payload)
    except Exception:
        _xai_status_cache.update({"data": None, "fetched_at": now})
        return None

    data = {"mtd_spend_usd": float(_round_up_cents(dollars))}
    _xai_status_cache.update({"data": data, "fetched_at": now})
    return data


async def _fetch_twitter_status() -> dict[str, float] | None:
    now = time.time()
    if now - float(_twitter_status_cache["fetched_at"] or 0.0) < _STATUS_CACHE_TTL_SECONDS:
        return _twitter_status_cache["data"]

    bearer_token = settings.twitter_bearer_token.strip()
    if not bearer_token:
        _twitter_status_cache.update({"data": None, "fetched_at": now})
        return None

    month_start, _ = _current_month_range()
    days_to_request = max(1, (datetime.now(UTC).date() - month_start.date()).days + 1)
    current_month = datetime.now(UTC).month
    current_year = datetime.now(UTC).year

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                _TWITTER_USAGE_URL,
                params={"days": days_to_request, "usage.fields": "daily_project_usage"},
                headers={"Authorization": f"Bearer {bearer_token}"},
            )
            resp.raise_for_status()
            payload = resp.json()

        total_posts = 0
        daily = (payload.get("data") or {}).get("daily_project_usage") or {}
        for entry in daily.get("usage") or []:
            date_str = str(entry.get("date") or "")
            try:
                entry_dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
                if entry_dt.month == current_month and entry_dt.year == current_year:
                    total_posts += int(entry.get("usage") or 0)
            except (ValueError, TypeError):
                continue
    except Exception:
        _twitter_status_cache.update({"data": None, "fetched_at": now})
        return None

    dollars = (Decimal(total_posts) * _TWITTER_READ_RATE).quantize(Decimal("0.01"))
    data = {"mtd_spend_usd": float(dollars)}
    _twitter_status_cache.update({"data": data, "fetched_at": now})
    return data


async def _waitlist_count() -> int:
    return await db.count_waitlist_entries()


async def status() -> JSONResponse:
    twitter, anthropic, xai = await asyncio.gather(
        _fetch_twitter_status(),
        _fetch_anthropic_status(),
        _fetch_xai_status(),
    )
    waitlist_count = await _waitlist_count()
    return JSONResponse(
        content={
            "twitter": twitter,
            "anthropic": anthropic,
            "xai": xai,
            "waitlist_count": waitlist_count,
        }
    )
