from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

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


async def _insert_member(
    pg_db: CoreDatabase,
    *,
    member_id: str | None = None,
    audience_id: str | None = None,
    handle: str = "scraper1",
    auth_token: str = "token-abcdef",
    ct0: str = "ct0-ghijkl",
    active: int = 1,
    last_run_at: str | None = None,
) -> str:
    mid = member_id or f"mem_{uuid.uuid4().hex}"
    pool = pg_db._require_pool()
    async with pool.connection() as conn:
        await conn.execute(
            """
            INSERT INTO audience_members (
                id, audience_id, active, handle, email, auth_token, ct0, last_run_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                mid,
                audience_id,
                active,
                handle,
                f"{handle}@example.com",
                auth_token,
                ct0,
                last_run_at,
            ),
        )
    return mid


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_create_get_update_delete_audience(pg_db):
    created = await pg_db.create_audience(
        title="Founders",
        description="early-stage technical founders",
    )
    assert created.title == "Founders"
    assert created.description == "early-stage technical founders"

    fetched = await pg_db.get_audience(created.id)
    assert fetched is not None
    assert fetched.id == created.id

    updated = await pg_db.update_audience(
        created.id,
        title="Operators",
        description="ops leaders at startups",
    )
    assert updated is not None
    assert updated.title == "Operators"

    assert await pg_db.delete_audience(created.id) is True
    assert await pg_db.get_audience(created.id) is None


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_get_audience_members_masks_secrets(pg_db):
    audience = await pg_db.create_audience(title="A", description="B")
    member_id = await _insert_member(
        pg_db,
        audience_id=audience.id,
        auth_token="secret-token-1234",
        ct0="secret-ct0-5678",
    )
    members = await pg_db.get_audience_members([audience.id])
    member = members[audience.id]
    assert member["id"] == member_id
    assert member["has_auth_token"] == 1
    assert member["has_ct0"] == 1
    assert member["auth_token_last4"] == "1234"
    assert member["ct0_last4"] == "5678"
    assert "auth_token" not in member
    assert "ct0" not in member


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_assign_audience_member_replaces_existing(pg_db):
    audience = await pg_db.create_audience(title="A", description="B")
    first_id = await _insert_member(pg_db, handle="first")
    second_id = await _insert_member(pg_db, handle="second")

    assigned = await pg_db.assign_audience_member(
        audience_id=audience.id,
        member_id=first_id,
    )
    assert assigned is not None
    members = await pg_db.get_audience_members([audience.id])
    assert members[audience.id]["handle"] == "first"

    reassigned = await pg_db.assign_audience_member(
        audience_id=audience.id,
        member_id=second_id,
    )
    assert reassigned is not None
    members = await pg_db.get_audience_members([audience.id])
    assert members[audience.id]["handle"] == "second"
    unassigned = await pg_db.list_unassigned_audience_members()
    assert any(row["id"] == first_id for row in unassigned)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_claim_audience_member_respects_cooldown(pg_db):
    audience_recent = await pg_db.create_audience(title="A", description="B")
    audience_stale = await pg_db.create_audience(title="C", description="D")
    recent = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    stale = (datetime.now(timezone.utc) - timedelta(hours=1)).strftime("%Y-%m-%d %H:%M:%S")
    recent_id = await _insert_member(
        pg_db,
        audience_id=audience_recent.id,
        handle="recent",
        last_run_at=recent,
    )
    stale_id = await _insert_member(
        pg_db,
        audience_id=audience_stale.id,
        handle="stale",
        last_run_at=stale,
    )

    claimed = await pg_db.claim_audience_member()
    assert claimed is not None
    assert claimed["id"] == stale_id

    await pg_db.mark_audience_member_run(stale_id)
    claimed_again = await pg_db.claim_audience_member()
    assert claimed_again is None or claimed_again["id"] != recent_id


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_delete_audience_nulls_member_assignment(pg_db):
    audience = await pg_db.create_audience(title="A", description="B")
    member_id = await _insert_member(pg_db, audience_id=audience.id)
    assert await pg_db.delete_audience(audience.id) is True
    unassigned = await pg_db.list_unassigned_audience_members()
    assert any(row["id"] == member_id for row in unassigned)
