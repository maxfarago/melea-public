"""clerk user → company membership."""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Mapping


@dataclass
class User:
    clerk_user_id: str
    company_id: str | None
    created_at: float
    email: str = ""
    full_name: str = ""
    image_url: str = ""

    def to_dict(self) -> dict[str, str | float | None]:
        return {
            "clerk_user_id": self.clerk_user_id,
            "company_id": self.company_id,
            "created_at": self.created_at,
            "email": self.email,
            "full_name": self.full_name,
            "image_url": self.image_url,
        }


def _row_to_user(row: Mapping[str, Any]) -> User:
    company_id = row["company_id"]
    return User(
        clerk_user_id=str(row["clerk_user_id"]),
        company_id=str(company_id) if company_id else None,
        created_at=float(row["created_at"]),
        email=str(row["email"] or ""),
        full_name=str(row["full_name"] or ""),
        image_url=str(row["image_url"] or ""),
    )


_SUBSCRIBED_STATUSES = {"active", "trialing", "past_due"}


class UserMixin:
    async def is_user_subscribed(self, clerk_user_id: str) -> bool:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT plan, subscription_status FROM users WHERE clerk_user_id = %s",
                (clerk_user_id,),
            )
            row = await cur.fetchone()
        if not row:
            return False
        plan = str(row["plan"] or "").strip()
        status = str(row["subscription_status"] or "").strip().lower()
        return bool(plan) and status in _SUBSCRIBED_STATUSES

    async def get_user_by_clerk_id(self, clerk_user_id: str) -> User | None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT * FROM users WHERE clerk_user_id = %s",
                (clerk_user_id,),
            )
            row = await cur.fetchone()
        return _row_to_user(row) if row else None

    async def get_company_id_for_user(self, clerk_user_id: str) -> str | None:
        user = await self.get_user_by_clerk_id(clerk_user_id)
        return user.company_id if user and user.company_id else None

    async def upsert_user_profile(
        self,
        clerk_user_id: str,
        *,
        email: str,
        full_name: str,
        image_url: str,
    ) -> None:
        now = time.time()
        pool = self._require_pool()
        async with pool.connection() as conn, conn.transaction():
            await conn.execute(
                """
                INSERT INTO users (
                    clerk_user_id, company_id, created_at, email, full_name, image_url
                )
                VALUES (%s, NULL, %s, %s, %s, %s)
                ON CONFLICT (clerk_user_id) DO NOTHING
                """,
                (
                    clerk_user_id,
                    now,
                    email.strip(),
                    full_name.strip(),
                    image_url.strip(),
                ),
            )
            await conn.execute(
                """
                UPDATE users
                SET email = %s, full_name = %s, image_url = %s
                WHERE clerk_user_id = %s
                """,
                (
                    email.strip(),
                    full_name.strip(),
                    image_url.strip(),
                    clerk_user_id,
                ),
            )

    async def upsert_user(
        self,
        clerk_user_id: str,
        company_id: str | None,
        *,
        email: str = "",
        full_name: str = "",
        image_url: str = "",
    ) -> User:
        now = time.time()
        pool = self._require_pool()
        async with pool.connection() as conn, conn.transaction():
            await conn.execute(
                """
                INSERT INTO users (
                    clerk_user_id, company_id, created_at, email, full_name, image_url
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (clerk_user_id) DO NOTHING
                """,
                (
                    clerk_user_id,
                    company_id,
                    now,
                    email.strip(),
                    full_name.strip(),
                    image_url.strip(),
                ),
            )
            if company_id:
                await conn.execute(
                    """
                    UPDATE users
                    SET company_id = %s
                    WHERE clerk_user_id = %s
                    """,
                    (company_id, clerk_user_id),
                )
            if email.strip() or full_name.strip() or image_url.strip():
                await conn.execute(
                    """
                    UPDATE users
                    SET email = CASE WHEN %s != '' THEN %s ELSE email END,
                        full_name = CASE WHEN %s != '' THEN %s ELSE full_name END,
                        image_url = CASE WHEN %s != '' THEN %s ELSE image_url END
                    WHERE clerk_user_id = %s
                    """,
                    (
                        email.strip(),
                        email.strip(),
                        full_name.strip(),
                        full_name.strip(),
                        image_url.strip(),
                        image_url.strip(),
                        clerk_user_id,
                    ),
                )
        user = await self.get_user_by_clerk_id(clerk_user_id)
        if user is None:
            raise RuntimeError("user upsert failed")
        return user

    async def create_user(
        self,
        clerk_user_id: str,
        company_id: str,
        *,
        email: str = "",
        full_name: str = "",
        image_url: str = "",
    ) -> User:
        return await self.upsert_user(
            clerk_user_id,
            company_id,
            email=email,
            full_name=full_name,
            image_url=image_url,
        )

    async def update_user_profile(
        self,
        clerk_user_id: str,
        *,
        email: str,
        full_name: str,
        image_url: str,
    ) -> None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                """
                UPDATE users
                SET email = %s, full_name = %s, image_url = %s
                WHERE clerk_user_id = %s
                """,
                (
                    email.strip(),
                    full_name.strip(),
                    image_url.strip(),
                    clerk_user_id,
                ),
            )

    async def delete_user_by_clerk_id(self, clerk_user_id: str) -> bool:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "DELETE FROM users WHERE clerk_user_id = %s",
                (clerk_user_id,),
            )
            return (cur.rowcount or 0) > 0

    async def clear_user_company_association(self, clerk_user_id: str) -> bool:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "UPDATE users SET company_id = NULL WHERE clerk_user_id = %s",
                (clerk_user_id,),
            )
            return (cur.rowcount or 0) > 0

    async def list_users_with_company(self) -> list[dict[str, str | float | int | None]]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT u.clerk_user_id,
                       u.email,
                       u.full_name,
                       u.plan,
                       u.subscription_status,
                       u.current_period_end,
                       u.created_at,
                       u.stripe_customer_id,
                       c.id AS company_id,
                       c.business_name,
                       c.website_url
                  FROM users u
                  LEFT JOIN companies c ON u.company_id = c.id
                 ORDER BY u.created_at DESC
                """
            )
            rows = await cur.fetchall()
        out: list[dict[str, str | float | int | None]] = []
        for row in rows:
            period_end = row["current_period_end"]
            out.append(
                {
                    "clerk_user_id": str(row["clerk_user_id"]),
                    "email": str(row["email"] or ""),
                    "full_name": str(row["full_name"] or ""),
                    "plan": str(row["plan"]).strip() if row["plan"] else None,
                    "subscription_status": (
                        str(row["subscription_status"]).strip()
                        if row["subscription_status"]
                        else None
                    ),
                    "current_period_end": int(period_end) if period_end is not None else None,
                    "created_at": float(row["created_at"]),
                    "stripe_customer_id": (
                        str(row["stripe_customer_id"]).strip()
                        if row["stripe_customer_id"]
                        else None
                    ),
                    "company_id": str(row["company_id"]) if row["company_id"] else None,
                    "business_name": str(row["business_name"] or "") or None,
                    "website_url": str(row["website_url"] or "") or None,
                }
            )
        return out
