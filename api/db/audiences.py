"""audience persistence models and methods."""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Mapping

_MEMBER_MASK_COLS = """
    id, audience_id, handle, email, city, state,
    active, profile_image_s3_key, last_run_at, created_at,
    CASE WHEN auth_token != '' THEN 1 ELSE 0 END AS has_auth_token,
    CASE WHEN ct0        != '' THEN 1 ELSE 0 END AS has_ct0,
    right(auth_token, 4) AS auth_token_last4,
    right(ct0, 4) AS ct0_last4,
    proxy_label,
    CASE WHEN proxy_password IS NOT NULL AND proxy_password != '' THEN 1 ELSE 0 END AS has_proxy_password
"""


@dataclass
class Audience:
    id: str
    title: str
    description: str
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "description": self.description,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def _row_to_audience(row: Mapping[str, Any]) -> Audience:
    return Audience(
        id=row["id"],
        title=row["title"] or "",
        description=row["description"] or "",
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


class AudienceMixin:
    async def list_audiences_summary(self) -> list[dict[str, Any]]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT a.id,
                       a.title,
                       a.created_at,
                       a.updated_at,
                       m.profile_image_s3_key
                  FROM audiences a
                  LEFT JOIN audience_members m ON m.audience_id = a.id
                 ORDER BY a.created_at DESC
                """
            )
            rows: list[dict[str, Any]] = []
            for row in await cur.fetchall():
                key = row["profile_image_s3_key"]
                rows.append(
                    {
                        "id": str(row["id"]),
                        "title": str(row["title"] or ""),
                        "created_at": float(row["created_at"]),
                        "updated_at": float(row["updated_at"]),
                        "profile_image_s3_key": str(key).strip() if key else None,
                    }
                )
            return rows

    async def list_audiences(self) -> list[Audience]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT id, title, description, created_at, updated_at
                FROM audiences
                ORDER BY created_at DESC
                """
            )
            return [_row_to_audience(row) for row in await cur.fetchall()]

    async def get_audience(self, audience_id: str) -> Audience | None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT id, title, description, created_at, updated_at
                FROM audiences
                WHERE id = %s
                LIMIT 1
                """,
                (audience_id,),
            )
            row = await cur.fetchone()
        return _row_to_audience(row) if row else None

    async def get_audience_members(self, audience_ids: list[str]) -> dict[str, dict[str, Any]]:
        """fetch audience_members keyed by audience_id. empty input -> {}."""
        ids = [str(aid) for aid in audience_ids if str(aid or "").strip()]
        if not ids:
            return {}
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                f"""
                SELECT {_MEMBER_MASK_COLS}
                FROM audience_members
                WHERE audience_id = ANY(%s)
                """,
                (ids,),
            )
            return {row["audience_id"]: dict(row) for row in await cur.fetchall()}

    async def claim_audience_member(self) -> dict[str, Any] | None:
        """select least-recently-run assigned member; return full row including secrets."""
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT id, audience_id, handle, email, city, state,
                       auth_token, ct0, proxy_server, proxy_username, proxy_password, proxy_label,
                       last_run_at
                FROM audience_members
                WHERE audience_id IS NOT NULL
                  AND active = 1
                  AND (
                    last_run_at IS NULL
                    OR last_run_at <= to_char(
                      now() AT TIME ZONE 'UTC' - interval '30 minutes',
                      'YYYY-MM-DD HH24:MI:SS'
                    )
                  )
                ORDER BY last_run_at IS NOT NULL, last_run_at ASC
                LIMIT 1
                """
            )
            row = await cur.fetchone()
        return dict(row) if row else None

    async def mark_audience_member_run(self, member_id: str) -> None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                """
                UPDATE audience_members
                SET last_run_at = to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
                WHERE id = %s
                """,
                (member_id,),
            )

    async def list_unassigned_audience_members(self) -> list[dict[str, Any]]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                f"""
                SELECT {_MEMBER_MASK_COLS}
                FROM audience_members
                WHERE audience_id IS NULL
                ORDER BY created_at DESC
                """
            )
            return [dict(row) for row in await cur.fetchall()]

    async def assign_audience_member(self, *, audience_id: str, member_id: str) -> Audience | None:
        pool = self._require_pool()
        async with pool.connection() as conn, conn.transaction():
            cur = await conn.execute(
                "SELECT id FROM audiences WHERE id = %s LIMIT 1",
                (audience_id,),
            )
            if await cur.fetchone() is None:
                return None
            member_cur = await conn.execute(
                """
                SELECT id
                FROM audience_members
                WHERE id = %s AND audience_id IS NULL
                LIMIT 1
                FOR UPDATE
                """,
                (member_id,),
            )
            if await member_cur.fetchone() is None:
                return None
            await conn.execute(
                "UPDATE audience_members SET audience_id = NULL WHERE audience_id = %s",
                (audience_id,),
            )
            await conn.execute(
                "UPDATE audience_members SET audience_id = %s WHERE id = %s",
                (audience_id, member_id),
            )
        return await self.get_audience(audience_id)

    async def create_audience(
        self,
        *,
        title: str,
        description: str,
    ) -> Audience:
        aid = str(uuid.uuid4())
        now = time.time()
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                """
                INSERT INTO audiences (id, title, description, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (aid, title, description, now, now),
            )
        audience = await self.get_audience(aid)
        if audience is None:
            raise RuntimeError("audience create failed")
        return audience

    async def update_audience(
        self,
        audience_id: str,
        *,
        title: str,
        description: str,
    ) -> Audience | None:
        pool = self._require_pool()
        async with pool.connection() as conn, conn.transaction():
            existing_cur = await conn.execute(
                "SELECT created_at FROM audiences WHERE id = %s LIMIT 1",
                (audience_id,),
            )
            if await existing_cur.fetchone() is None:
                return None
            now = time.time()
            await conn.execute(
                """
                UPDATE audiences SET
                    title = %s,
                    description = %s,
                    updated_at = %s
                WHERE id = %s
                """,
                (title, description, now, audience_id),
            )
        return await self.get_audience(audience_id)

    async def delete_audience(self, audience_id: str) -> bool:
        pool = self._require_pool()
        async with pool.connection() as conn, conn.transaction():
            await conn.execute(
                "UPDATE audience_members SET audience_id = NULL WHERE audience_id = %s",
                (audience_id,),
            )
            cur = await conn.execute(
                "DELETE FROM audiences WHERE id = %s",
                (audience_id,),
            )
            return (cur.rowcount or 0) > 0
