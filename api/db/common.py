"""shared db row helpers."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Mapping

_UTC_TEXT_FMT = "%Y-%m-%d %H:%M:%S"


def utc_now_text() -> str:
    return datetime.now(timezone.utc).strftime(_UTC_TEXT_FMT)


def _row_dict(row: Mapping[str, Any]) -> dict[str, Any]:
    return {k: float(v) if isinstance(v, Decimal) else v for k, v in row.items()}


def normalize_utc_text(value: str | None) -> str:
    if not value or not str(value).strip():
        return utc_now_text()
    raw = str(value).strip()
    if len(raw) == 19 and raw[4] == "-" and raw[10] == " " and "T" not in raw:
        return raw
    if "T" in raw or raw.endswith("Z") or "+" in raw[-6:]:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime(_UTC_TEXT_FMT)
    return raw


def _normalize_story_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()


def _merge_topic_categories(*groups: list[str] | None) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for group in groups:
        if not group:
            continue
        for item in group:
            label = str(item or "").strip()
            if not label:
                continue
            key = label.casefold()
            if key in seen:
                continue
            seen.add(key)
            out.append(label)
    return out


def _loads_json_list(raw: Any) -> list[Any]:
    if not raw:
        return []
    if isinstance(raw, list):
        return raw
    try:
        parsed = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return []
    return parsed if isinstance(parsed, list) else []


def _loads_json_dict(raw: Any) -> dict[str, Any] | None:
    if not raw:
        return None
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _normalize_follow_items(follows: list[Any] | None) -> list[dict[str, str]]:
    if not follows:
        return []
    normalized: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in follows:
        if isinstance(item, dict):
            handle = str(item.get("handle") or item.get("username") or "").strip()
            reason = str(item.get("reason") or "").strip()
        else:
            handle = str(item or "").strip()
            reason = ""
        handle = handle.lstrip("@").strip()
        key = handle.lower()
        if not handle or key in seen:
            continue
        seen.add(key)
        normalized.append({"handle": handle, "reason": reason})
    return normalized
