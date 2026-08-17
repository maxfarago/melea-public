"""YAML-seeded, DB-backed, versioned prompt registry.

Canonical prompt bodies live in `llm/prompts/*.yaml`. On startup,
`seed_prompts_from_yaml()` reads each YAML file and inserts the prompt if
missing, or bumps to a new version if the YAML body has changed since the
last seed. UI overrides create further versions at runtime.

Prompt `kind`:
    - llm_system: full system prompt for an LLM call
    - jina_search_query: a query template for s.jina.ai
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from importlib import resources
from pathlib import Path
from typing import Any, Literal, Mapping

import yaml
from pydantic import BaseModel, ConfigDict, Field

from api.db.sqlite import db as _master_db
from commons.config import settings

log = logging.getLogger(__name__)

PromptKind = Literal["llm_system", "jina_search_query"]


class Prompt(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    version: int
    kind: PromptKind
    body: str
    notes: str | None = None
    sampling: dict[str, Any] = Field(default_factory=dict)
    created_at: float = Field(default_factory=time.time)


class PromptSummary(BaseModel):
    name: str
    latest_version: int
    kind: PromptKind
    updated_at: float


def _row_to_prompt(row: Mapping[str, Any]) -> Prompt:
    return Prompt(
        id=row["id"],
        name=row["name"],
        version=int(row["version"]),
        kind=row["kind"],
        body=row["body"],
        notes=row["notes"],
        sampling=json.loads(row["sampling"]) if row["sampling"] else {},
        created_at=float(row["created_at"]),
    )


class PromptRepo:
    async def get_latest(self, name: str) -> Prompt | None:
        pool = _master_db._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT * FROM prompts
                WHERE name = %s
                ORDER BY version DESC
                LIMIT 1
                """,
                (name,),
            )
            row = await cur.fetchone()
        return _row_to_prompt(row) if row else None

    async def get_version(self, name: str, version: int) -> Prompt | None:
        pool = _master_db._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT * FROM prompts WHERE name = %s AND version = %s",
                (name, version),
            )
            row = await cur.fetchone()
        return _row_to_prompt(row) if row else None

    async def list_summaries(self) -> list[PromptSummary]:
        pool = _master_db._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT name, MAX(version) AS latest_version,
                       (SELECT kind FROM prompts p2 WHERE p2.name = prompts.name
                        ORDER BY version DESC LIMIT 1) AS kind,
                       MAX(created_at) AS updated_at
                FROM prompts
                GROUP BY name
                ORDER BY name
                """
            )
            rows = await cur.fetchall()
        return [
            PromptSummary(
                name=row["name"],
                latest_version=int(row["latest_version"]),
                kind=row["kind"],
                updated_at=float(row["updated_at"]),
            )
            for row in rows
        ]

    async def add_version(
        self,
        *,
        name: str,
        kind: PromptKind,
        body: str,
        sampling: dict | None = None,
        notes: str | None = None,
    ) -> Prompt:
        """Append a new version; bumps to MAX(version)+1 (1 for first insert)."""
        pid = str(uuid.uuid4())
        now = time.time()
        sampling_json = json.dumps(sampling or {})
        pool = _master_db._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                INSERT INTO prompts (id, name, version, kind, body, notes, sampling, created_at)
                SELECT
                    %s,
                    %s,
                    COALESCE((SELECT MAX(version) FROM prompts WHERE name = %s), 0) + 1,
                    %s,
                    %s,
                    %s,
                    %s,
                    %s
                """,
                (pid, name, name, kind, body, notes, sampling_json, now),
            )
            if (cur.rowcount or 0) == 0:
                raise RuntimeError("prompt version insert failed")
            cur = await conn.execute(
                "SELECT * FROM prompts WHERE id = %s",
                (pid,),
            )
            row = await cur.fetchone()
        if row is None:
            raise RuntimeError("prompt version readback failed")
        return _row_to_prompt(row)


prompt_repo = PromptRepo()


def _prompts_dir() -> Path:
    with resources.as_file(resources.files("llm")) as p:
        return Path(p) / "prompts"


def _iter_yaml_files() -> list[Path]:
    base = _prompts_dir()
    if not base.exists():
        return []
    return sorted(base.glob("*.yaml")) + sorted(base.glob("*.yml"))


def _validate_kind(value: Any) -> PromptKind:
    if value not in ("llm_system", "jina_search_query"):
        raise ValueError(f"unknown prompt kind: {value!r}")
    return value  # type: ignore[return-value]


async def seed_prompts_from_yaml() -> int:
    """Insert canonical v1 prompts for any name not yet in the DB.

    If a name is already present and the YAML body differs from the latest
    DB version, push a new version. Returns the count of newly seeded or
    bumped prompts.
    """
    if not settings.database_url.strip():
        return 0

    files = _iter_yaml_files()
    if not files:
        log.warning("prompts_no_yaml_files dir=%s", _prompts_dir())
        return 0

    seeded = 0
    for path in files:
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as e:
            log.error("prompts_yaml_parse_failed path=%s err=%r", path, e)
            continue

        name = str(raw.get("name") or path.stem)
        body = str(raw.get("body") or "").strip()
        if not body:
            log.warning("prompts_yaml_missing_body path=%s", path)
            continue

        try:
            kind = _validate_kind(raw.get("kind", "llm_system"))
        except ValueError as e:
            log.error("prompts_yaml_bad_kind path=%s err=%s", path, e)
            continue

        sampling = raw.get("sampling") or {}
        notes = raw.get("notes")

        existing = await prompt_repo.get_latest(name)
        if existing is not None:
            body_unchanged = existing.body.strip() == body.strip()
            sampling_unchanged = (existing.sampling or {}) == (sampling or {})
            if body_unchanged and sampling_unchanged:
                continue
            await prompt_repo.add_version(
                name=name,
                kind=kind,
                body=body,
                sampling=sampling,
                notes=str(notes) if notes else None,
            )
            seeded += 1
            log.info(
                "prompts_updated name=%s old_v=%d kind=%s body_changed=%s sampling_changed=%s",
                name,
                existing.version,
                kind,
                not body_unchanged,
                not sampling_unchanged,
            )
            continue

        await prompt_repo.add_version(
            name=name,
            kind=kind,
            body=body,
            sampling=sampling,
            notes=str(notes) if notes else None,
        )
        seeded += 1
        log.info("prompts_seeded name=%s kind=%s", name, kind)

    return seeded
