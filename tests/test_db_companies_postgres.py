from __future__ import annotations

import asyncio
import uuid

import pytest

from api.db.sqlite import CoreDatabase
from commons.config import settings
from llm.embeddings import coerce_vector


@pytest.fixture
async def pg_db(postgres_dsn, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "database_url", postgres_dsn)
    db = CoreDatabase(str(tmp_path / "melea.db"))
    await db.init()
    yield db
    await db.close()


def _embedding_vector(first: float = 1.0) -> list[float]:
    return [first] + [0.0] * 1535


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_create_get_and_satellites_roundtrip(pg_db):
    suffix = uuid.uuid4().hex[:8]
    created = await pg_db.create_company(f"https://roundtrip-{suffix}.example")
    company_id = created.id

    await pg_db.set_stage(company_id, "website_synthesis", status="done", model="test-model")
    await pg_db.update_company_website_synthesis_context(
        company_id,
        terms=["term-a"],
        primary_term="term-a",
        selected_term="term-a",
        brand_summary="homepage summary",
    )
    await pg_db.update_linkedin_company_payload(
        company_id,
        url="https://linkedin.com/company/example",
        text="linkedin raw text",
    )
    await pg_db.set_audience_result(
        company_id,
        audiences=[{"title": "Founders", "description": "startup founders"}],
        model="audience-model",
    )

    company = await pg_db.get_company(company_id)
    assert company is not None
    assert company.website_url == f"https://roundtrip-{suffix}.example"
    assert company.stages["website_synthesis"].status == "done"
    assert company.stages["website_synthesis"].model == "test-model"
    assert company.synthesis is not None
    assert company.synthesis.homepage_summary == "homepage summary"
    assert company.linkedin is not None
    assert company.linkedin.url == "https://linkedin.com/company/example"
    assert len(company.audiences) == 1
    assert company.audiences[0].title == "Founders"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_set_stage_coalesce_preserves_model(pg_db):
    company = await pg_db.create_company(f"https://stage-{uuid.uuid4().hex[:8]}.example")
    await pg_db.set_stage(
        company.id,
        "audience",
        status="running",
        model="opus-4-8",
    )
    await pg_db.set_stage(company.id, "audience", status="done", model=None)

    stages = await pg_db.get_company_stages(company.id)
    assert stages["audience"].status == "done"
    assert stages["audience"].model == "opus-4-8"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_audience_and_match_results(pg_db):
    company = await pg_db.create_company(f"https://audience-{uuid.uuid4().hex[:8]}.example")
    inhouse = await pg_db.create_audience(title="Runners", description="endurance athletes")

    await pg_db.set_audience_result(
        company.id,
        audiences=[{"title": "Marathon fans", "description": "follow endurance sports"}],
        model="audience-model",
    )
    after_audience = await pg_db.get_company(company.id)
    assert after_audience is not None
    assert len(after_audience.audiences) == 1
    assert after_audience.stages["audience"].status == "done"

    await pg_db.set_audience_match_result(
        company.id,
        audiences=[
            {
                "title": "Marathon fans",
                "description": "follow endurance sports",
                "match": {
                    "audience_id": inhouse.id,
                    "title": "Runners",
                    "description": "endurance athletes",
                    "score": 0.92,
                    "reason": "strong overlap",
                },
            }
        ],
        model="match-model",
    )
    matched = await pg_db.get_company(company.id)
    assert matched is not None
    assert matched.audiences[0].match_audience_id == inhouse.id
    assert matched.audiences[0].match_score == pytest.approx(0.92)
    assert matched.stages["audience_match"].status == "done"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_set_audience_result_serializes_concurrent_writes(pg_db):
    company = await pg_db.create_company(f"https://concurrent-{uuid.uuid4().hex[:8]}.example")

    async def write_batch(label: str) -> None:
        await pg_db.set_audience_result(
            company.id,
            audiences=[{"title": label, "description": f"audience for {label}"}],
            model="concurrent-model",
        )

    await asyncio.gather(write_batch("batch-a"), write_batch("batch-b"))
    final = await pg_db.get_company(company.id)
    assert final is not None
    assert len(final.audiences) == 1
    titles = {aud.title for aud in final.audiences}
    assert titles <= {"batch-a", "batch-b"}


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_store_company_embedding_roundtrip(pg_db):
    company = await pg_db.create_company(f"https://embed-{uuid.uuid4().hex[:8]}.example")
    vector = _embedding_vector()
    await pg_db.store_company_embedding(
        company.id,
        input_text="brand name: Ares",
        vector=vector,
        model="text-embedding-3-small",
        version="brand-story-v1",
    )

    row = await pg_db.get_company_for_embedding(company.id)
    assert row is not None
    assert row["brand_embedding_input"] == "brand name: Ares"
    assert coerce_vector(row["brand_embedding_vector"]) == pytest.approx(
        coerce_vector(vector)
    )


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_delete_company_removes_domain_rows(pg_db):
    company = await pg_db.create_company(f"https://delete-{uuid.uuid4().hex[:8]}.example")
    company_id = company.id
    await pg_db.set_stage(company_id, "website_synthesis", status="done")
    await pg_db.update_company_website_synthesis_context(
        company_id,
        terms=["term"],
        primary_term="term",
        selected_term="term",
        brand_summary="summary",
    )
    await pg_db.update_linkedin_company_payload(
        company_id,
        url="https://linkedin.com/company/delete-me",
        text="raw",
    )
    await pg_db.set_audience_result(
        company_id,
        audiences=[{"title": "Fans", "description": "brand fans"}],
        model="audience-model",
    )

    assert await pg_db.delete_company(company_id) is True
    assert await pg_db.get_company(company_id) is None
    assert await pg_db.get_company_stages(company_id) == {}
    assert await pg_db.get_company_synthesis(company_id) is None
    assert await pg_db.get_company_linkedin(company_id) is None
    assert await pg_db.get_company_audiences(company_id) == []
