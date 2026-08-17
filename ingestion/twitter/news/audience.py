"""twitter audience account model + direct postgres claim/mark-run.

each audience member is a distinct x.com account assigned a residential proxy.
the scraper claims the least-recently-run assigned member directly from postgres,
launches chromium with that member's proxy, scrapes as that account, then stamps
last_run_at so the next run rotates to a different member.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

import psycopg
from psycopg.rows import dict_row

from api.db.common import utc_now_text


def _database_url(database_url: str | None = None) -> str:
    dsn = (database_url or os.environ.get("DATABASE_URL") or "").strip()
    if not dsn:
        raise RuntimeError("DATABASE_URL is not set")
    return dsn


def _connect(database_url: str | None = None) -> psycopg.Connection:
    return psycopg.connect(_database_url(database_url), row_factory=dict_row)


@dataclass
class AudienceMember:
    id: str
    audience_id: str | None
    active: bool
    handle: str | None
    email: str
    city: str | None
    state: str | None
    auth_token: str
    ct0: str
    proxy_server: str | None
    proxy_username: str | None
    proxy_password: str | None
    proxy_label: str | None
    last_run_at: str | None

    def proxy_playwright_dict(self) -> dict[str, str] | None:
        """return playwright proxy config dict, or None if no proxy is configured."""
        if not self.proxy_server:
            return None
        d: dict[str, str] = {"server": self.proxy_server}
        if self.proxy_username:
            d["username"] = self.proxy_username
        if self.proxy_password:
            d["password"] = self.proxy_password
        return d


def claim_member_from_db(
    database_url: str | None = None,
    exclude_member_ids: set[str] | None = None,
) -> AudienceMember | None:
    """select least-recently-run assigned member directly from postgres."""
    exclude_member_ids = exclude_member_ids or set()
    exclude_sql = ""
    params: list[str] = []
    if exclude_member_ids:
        placeholders = ", ".join("%s" for _ in exclude_member_ids)
        exclude_sql = f" AND id NOT IN ({placeholders})"
        params.extend(sorted(exclude_member_ids))

    with _connect(database_url) as conn:
        row = conn.execute(
            f"""
            SELECT id, audience_id, handle, email, city, state,
                   auth_token, ct0, proxy_server, proxy_username, proxy_password,
                   proxy_label, active, last_run_at
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
              {exclude_sql}
            ORDER BY last_run_at IS NOT NULL, last_run_at ASC
            LIMIT 1
            """,
            params,
        ).fetchone()
    if row is None:
        return None
    return AudienceMember(
        id=row["id"],
        audience_id=row["audience_id"],
        active=bool(row["active"]),
        handle=row["handle"],
        email=row["email"],
        city=row["city"],
        state=row["state"],
        auth_token=row["auth_token"],
        ct0=row["ct0"],
        proxy_server=row["proxy_server"],
        proxy_username=row["proxy_username"],
        proxy_password=row["proxy_password"],
        proxy_label=row["proxy_label"],
        last_run_at=row["last_run_at"],
    )


def query_member_pool_status(
    database_url: str | None = None,
    exclude_member_ids: set[str] | None = None,
) -> dict[str, int]:
    """return counts that explain why no assigned member is eligible."""
    exclude_member_ids = exclude_member_ids or set()
    exclude_sql = ""
    params: list[str] = []
    if exclude_member_ids:
        placeholders = ", ".join("%s" for _ in exclude_member_ids)
        exclude_sql = f" AND id NOT IN ({placeholders})"
        params.extend(sorted(exclude_member_ids))

    with _connect(database_url) as conn:
        total_assigned = conn.execute(
            "SELECT COUNT(*) AS n FROM audience_members WHERE audience_id IS NOT NULL"
        ).fetchone()["n"]
        total_active = conn.execute(
            """
            SELECT COUNT(*) AS n
            FROM audience_members
            WHERE audience_id IS NOT NULL
              AND active = 1
            """
        ).fetchone()["n"]
        total_eligible_now = conn.execute(
            f"""
            SELECT COUNT(*) AS n
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
              {exclude_sql}
            """,
            params,
        ).fetchone()["n"]
        return {
            "total_assigned": int(total_assigned),
            "total_active": int(total_active),
            "total_eligible_now": int(total_eligible_now),
        }


def deactivate_proxy_members(proxy_server: str, database_url: str | None = None) -> int:
    """mark every member using the proxy inactive."""
    with _connect(database_url) as conn:
        cur = conn.execute(
            """
            UPDATE audience_members
            SET active = 0
            WHERE proxy_server = %s
              AND active = 1
            """,
            (proxy_server,),
        )
        conn.commit()
        return cur.rowcount


def mark_run_in_db(member_id: str, database_url: str | None = None) -> None:
    """stamp last_run_at for the given member directly in postgres."""
    stamp = utc_now_text()
    with _connect(database_url) as conn:
        conn.execute(
            "UPDATE audience_members SET last_run_at = %s WHERE id = %s",
            (stamp, member_id),
        )
        conn.commit()
