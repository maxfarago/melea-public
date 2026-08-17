"""stripe subscription persistence."""

from __future__ import annotations


class StripeMixin:
    async def sync_user_subscription_from_clerk(
        self,
        clerk_user_id: str,
        *,
        plan: str,
        subscription_status: str,
    ) -> None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                """
                UPDATE users
                   SET plan = %s,
                       subscription_status = %s
                 WHERE clerk_user_id = %s
                """,
                (plan, subscription_status, clerk_user_id),
            )

    async def get_user_plan(self, clerk_user_id: str) -> tuple[str | None, str | None]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT plan, subscription_status FROM users WHERE clerk_user_id = %s",
                (clerk_user_id,),
            )
            row = await cur.fetchone()
        if row is None:
            return None, None
        plan = str(row["plan"]).strip() if row["plan"] else None
        status = str(row["subscription_status"]).strip() if row["subscription_status"] else None
        return plan, status

    async def get_clerk_id_by_stripe_customer(self, customer_id: str) -> str | None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT clerk_user_id FROM users WHERE stripe_customer_id = %s",
                (customer_id,),
            )
            row = await cur.fetchone()
        return str(row["clerk_user_id"]) if row else None

    async def upsert_stripe_checkout(
        self,
        clerk_user_id: str,
        *,
        customer_id: str | None,
        subscription_id: str | None,
        plan: str | None,
        subscription_status: str | None,
        current_period_end: int | None,
    ) -> None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                """
                UPDATE users
                   SET stripe_customer_id     = %s,
                       stripe_subscription_id = %s,
                       plan                   = %s,
                       subscription_status    = %s,
                       current_period_end     = %s
                 WHERE clerk_user_id = %s
                """,
                (
                    customer_id,
                    subscription_id,
                    plan,
                    subscription_status,
                    current_period_end,
                    clerk_user_id,
                ),
            )

    async def upsert_stripe_subscription(
        self,
        clerk_user_id: str,
        *,
        subscription_id: str | None,
        plan: str | None,
        subscription_status: str | None,
        current_period_end: int | None,
    ) -> None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                """
                UPDATE users
                   SET plan                   = %s,
                       subscription_status    = %s,
                       current_period_end     = %s,
                       stripe_subscription_id = %s
                 WHERE clerk_user_id = %s
                """,
                (
                    plan,
                    subscription_status,
                    current_period_end,
                    subscription_id,
                    clerk_user_id,
                ),
            )

    async def cancel_stripe_subscription(self, clerk_user_id: str) -> None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                """
                UPDATE users
                   SET plan = NULL, subscription_status = 'canceled'
                 WHERE clerk_user_id = %s
                """,
                (clerk_user_id,),
            )

    async def set_stripe_past_due(self, clerk_user_id: str) -> None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                "UPDATE users SET subscription_status = 'past_due' WHERE clerk_user_id = %s",
                (clerk_user_id,),
            )

    async def is_stripe_event_processed(self, event_id: str) -> bool:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT 1 FROM processed_stripe_events WHERE event_id = %s",
                (event_id,),
            )
            row = await cur.fetchone()
        return row is not None

    async def mark_stripe_event_processed(self, event_id: str, event_type: str) -> None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                """
                INSERT INTO processed_stripe_events (event_id, type)
                VALUES (%s, %s)
                ON CONFLICT (event_id) DO NOTHING
                """,
                (event_id, event_type),
            )
