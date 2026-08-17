from __future__ import annotations

import uuid

import pytest

from api.db.sqlite import CoreDatabase
from api.prompts import prompt_repo
from commons.config import settings


@pytest.fixture
async def pg_db(postgres_dsn, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "database_url", postgres_dsn)
    test_db = CoreDatabase(str(tmp_path / "melea.db"))
    await test_db.init()
    monkeypatch.setattr("api.prompts._master_db", test_db)
    yield test_db
    await test_db.close()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_add_version_and_get_roundtrip(pg_db):
    name = f"prompt_{uuid.uuid4().hex}"
    created = await prompt_repo.add_version(
        name=name,
        kind="llm_system",
        body="hello world",
        sampling={"temperature": 0.2},
        notes="v1",
    )
    assert created.version == 1
    assert created.body == "hello world"
    assert created.sampling == {"temperature": 0.2}

    latest = await prompt_repo.get_latest(name)
    assert latest is not None
    assert latest.id == created.id

    by_version = await prompt_repo.get_version(name, 1)
    assert by_version is not None
    assert by_version.notes == "v1"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_add_version_bumps(pg_db):
    name = f"prompt_{uuid.uuid4().hex}"
    await prompt_repo.add_version(name=name, kind="llm_system", body="first")
    second = await prompt_repo.add_version(name=name, kind="llm_system", body="second")
    assert second.version == 2
    latest = await prompt_repo.get_latest(name)
    assert latest is not None
    assert latest.version == 2
    assert latest.body == "second"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_list_summaries_returns_aliased_fields(pg_db):
    name = f"prompt_{uuid.uuid4().hex}"
    await prompt_repo.add_version(name=name, kind="jina_search_query", body="query {term}")
    summaries = await prompt_repo.list_summaries()
    match = next(item for item in summaries if item.name == name)
    assert match.latest_version == 1
    assert match.kind == "jina_search_query"
    assert match.updated_at > 0
