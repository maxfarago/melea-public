"""content assistant history bucketing for sitmar list responses."""

from __future__ import annotations

import time
from typing import Any

TWENTY_FOUR_HOURS_S = 24 * 60 * 60


def _ts(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def content_history_bucket(campaign: dict[str, Any], *, now: float | None = None) -> str:
    now_s = now if now is not None else time.time()
    status = str(campaign.get("status") or "").lower()
    if status == "posted":
        updated = _ts(campaign.get("updated_at"))
        if not updated or now_s - updated <= TWENTY_FOUR_HOURS_S:
            return "active"
        return "inactive"
    created = _ts(campaign.get("created_at"))
    if not created or now_s - created <= TWENTY_FOUR_HOURS_S:
        return "draft"
    return "archived"


def _posted_sort_key(campaign: dict[str, Any]) -> tuple[float, float]:
    return (_ts(campaign.get("updated_at")), _ts(campaign.get("created_at")))


def _draft_sort_key(campaign: dict[str, Any]) -> float:
    return _ts(campaign.get("created_at"))


def bucket_content_history(
    campaigns: list[dict[str, Any]], *, now: float | None = None
) -> dict[str, Any]:
    sections: dict[str, list[dict[str, Any]]] = {
        "active": [],
        "draft": [],
        "inactive": [],
    }
    archived_count = 0
    for row in campaigns:
        bucket = content_history_bucket(row, now=now)
        if bucket == "archived":
            archived_count += 1
            continue
        item = dict(row)
        item["bucket"] = bucket
        sections[bucket].append(item)

    sections["active"].sort(key=_posted_sort_key, reverse=True)
    sections["inactive"].sort(key=_posted_sort_key, reverse=True)
    sections["draft"].sort(key=_draft_sort_key, reverse=True)

    ordered = sections["active"] + sections["draft"] + sections["inactive"]
    return {
        "campaigns": ordered,
        "sections": sections,
        "archived_count": archived_count,
    }
