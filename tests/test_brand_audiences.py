from __future__ import annotations

import time
from unittest.mock import AsyncMock

import pytest

from api.db.sqlite import CoreDatabase
from api.features import brand_pipeline
from commons.config import settings


@pytest.fixture
async def pg_db(postgres_dsn, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "database_url", postgres_dsn)
    database = CoreDatabase(str(tmp_path / "brand-audiences.db"))
    await database.init()
    yield database
    await database.close()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_collect_brand_audiences_top_stories_and_score_threshold(pg_db):
    now = time.time()
    company = await pg_db.create_company(f"https://brand-audiences-{now}.example")
    company_id = company.id
    in_1 = await pg_db.create_audience(title="Runners", description="desc")
    in_2 = await pg_db.create_audience(title="Cyclists", description="desc")
    await pg_db.set_audience_match_result(
        company_id,
        audiences=[
            {
                "title": "Marathon fans",
                "description": "People who follow endurance sports",
                "match": {
                    "audience_id": in_1.id,
                    "title": "Runners",
                    "score": 0.9,
                },
            },
            {
                "title": "Bike commuters",
                "description": "Urban cyclists",
                "match": {
                    "audience_id": in_2.id,
                    "title": "Cyclists",
                    "score": 0.8,
                },
            },
        ],
        model="test",
    )

    for story_id, headline in (
        ("s-old", "Older marathon headline"),
        ("s-new", "Newer marathon headline"),
        ("s-low", "Low score headline"),
    ):
        await pg_db.ingest_trending_story(
            {
                "capture_id": "c",
                "story_id": story_id,
                "headline": headline,
                "topic_category": "Sports",
                "recency_label": "now",
                "post_count": 100,
                "rank_in_feed": 1,
            }
        )

    await pg_db.record_audience_story_sighting(
        audience_id=in_1.id,
        story_id="s-old",
        rank_in_feed=3,
        seen_at="2026-06-05T00:00:00Z",
    )
    await pg_db.record_audience_story_sighting(
        audience_id=in_1.id,
        story_id="s-new",
        rank_in_feed=2,
        seen_at="2026-06-05T00:03:00Z",
    )
    await pg_db.record_audience_story_sighting(
        audience_id=in_1.id,
        story_id="s-low",
        rank_in_feed=1,
        seen_at="2026-06-05T00:05:00Z",
    )
    await pg_db.record_audience_story_sighting(
        audience_id=in_2.id,
        story_id="s-new",
        rank_in_feed=4,
        seen_at="2026-06-05T00:04:00Z",
    )

    await pg_db.upsert_brand_story_score(
        company_id, "s-old", score=0.5, method="embedding_cosine", model="test"
    )
    await pg_db.upsert_brand_story_score(
        company_id, "s-new", score=0.6, method="embedding_cosine", model="test"
    )
    await pg_db.upsert_brand_story_score(
        company_id, "s-low", score=0.05, method="embedding_cosine", model="test"
    )

    company = await pg_db.get_company(company_id)
    assert company is not None
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(brand_pipeline, "db", pg_db)
        mp.setattr(pg_db, "get_audience_members", AsyncMock(return_value={}))
        audiences = await brand_pipeline.collect_brand_audiences(company_id, company.to_dict())

    assert len(audiences) == 2
    audiences.sort(key=lambda row: float(row["match"]["score"]), reverse=True)
    assert audiences[0]["title"] == "Marathon fans"
    assert audiences[0]["match"]["audience_id"] == in_1.id
    recent = audiences[0]["recent_stories"]
    assert len(recent) == 2
    assert [s["story_id"] for s in recent] == ["s-new", "s-old"]
    assert audiences[1]["recent_stories"][0]["story_id"] == "s-new"
