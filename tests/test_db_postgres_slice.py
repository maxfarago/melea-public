from __future__ import annotations

import time
import uuid

import pytest

from api.db.sqlite import CoreDatabase
from commons.config import settings


@pytest.fixture
async def pg_db(postgres_dsn, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "database_url", postgres_dsn)
    db = CoreDatabase(str(tmp_path / "melea.db"))
    await db.init()
    yield db
    await db.close()


def test_waitlist_requires_database_url(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "database_url", "")

    async def _run() -> None:
        db = CoreDatabase(str(tmp_path / "melea.db"))
        await db.init()
        try:
            with pytest.raises(RuntimeError, match="DATABASE_URL"):
                await db.insert_waitlist_entry(
                    email="a@example.com",
                    company_website="https://example.com",
                    x_handle=None,
                    other_contacts=None,
                )
        finally:
            await db.close()

    import asyncio

    asyncio.run(_run())


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_waitlist_insert_and_citext_duplicate(pg_db):
    suffix = uuid.uuid4().hex[:8]
    first = await pg_db.insert_waitlist_entry(
        email=f"test-{suffix}@example.com",
        company_website="https://example.com",
        x_handle=None,
        other_contacts=None,
    )
    dup = await pg_db.insert_waitlist_entry(
        email=f"TeSt-{suffix}@Example.com",
        company_website="https://other.example",
        x_handle=None,
        other_contacts=None,
    )
    assert first is True
    assert dup is False
    assert await pg_db.count_waitlist_entries() >= 1


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_upsert_user_profile_idempotent(pg_db):
    clerk_id = f"user_{uuid.uuid4().hex}"
    await pg_db.upsert_user_profile(
        clerk_id,
        email="a@example.com",
        full_name="Ada",
        image_url="https://img.example/a.png",
    )
    await pg_db.upsert_user_profile(
        clerk_id,
        email="b@example.com",
        full_name="Ada Lovelace",
        image_url="https://img.example/b.png",
    )
    user = await pg_db.get_user_by_clerk_id(clerk_id)
    assert user is not None
    assert user.email == "b@example.com"
    assert user.full_name == "Ada Lovelace"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_list_users_with_company_join(pg_db):
    company_id = f"co_{uuid.uuid4().hex}"
    clerk_id = f"user_{uuid.uuid4().hex}"
    now = time.time()
    pool = pg_db._require_pool()
    async with pool.connection() as conn:
        await conn.execute(
            """
            INSERT INTO companies (id, website_url, business_name, created_at, updated_at)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (company_id, "https://ares.example", "Ares", now, now),
        )
    await pg_db.upsert_user(
        clerk_id,
        company_id,
        email="founder@ares.example",
        full_name="Founder",
    )
    rows = await pg_db.list_users_with_company()
    match = next(r for r in rows if r["clerk_user_id"] == clerk_id)
    assert match["company_id"] == company_id
    assert match["business_name"] == "Ares"
    assert match["website_url"] == "https://ares.example"
