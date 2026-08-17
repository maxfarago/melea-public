"""company onboarding pipeline helpers."""

from __future__ import annotations

from api.db.companies import CompanyStage

_TERMINAL = frozenset({"done", "error", "skipped", "completed"})


def _terminal(status: str | None) -> bool:
    return str(status or "").strip().lower() in _TERMINAL


def company_website_onboarding_processed(stages: dict[str, CompanyStage]) -> bool:
    synthesis = stages.get("website_synthesis")
    if synthesis and _terminal(synthesis.status):
        return True
    return False
