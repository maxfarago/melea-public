from __future__ import annotations

import json
import time
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest

from api.db.audiences import Audience
from api.db.sqlite import CoreDatabase
from api.features import brand_pipeline
from commons.config import settings


@pytest.fixture
async def pg_db(postgres_dsn, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "database_url", postgres_dsn)
    database = CoreDatabase(str(tmp_path / "company-stories.db"))
    await database.init()
    yield database
    await database.close()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_collect_company_stories_page_pagination_and_filters(pg_db):
    now = time.time()
    recent = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    stale = (datetime.now(UTC) - timedelta(hours=30)).isoformat().replace("+00:00", "Z")
    company = await pg_db.create_company(f"https://company-stories-{now}.example")
    company_id = company.id
    inhouse = await pg_db.create_audience(title="Runners", description="desc")
    await pg_db.set_audience_match_result(
        company_id,
        audiences=[
            {
                "title": "Marathon fans",
                "description": "People who follow endurance sports",
                "match": {
                    "audience_id": inhouse.id,
                    "title": "Runners",
                    "score": 0.9,
                },
            }
        ],
        model="test",
    )

    stories = [
        ("s-new", "Newest headline", recent),
        ("s-mid", "Middle headline", recent),
        ("s-old-recent", "Older recent headline", recent),
        ("s-stale", "Stale headline", stale),
        ("s-low", "Low score headline", recent),
    ]
    for story_id, headline, _seen in stories:
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
        audience_id=inhouse.id,
        story_id="s-new",
        rank_in_feed=1,
        seen_at=recent,
    )
    await pg_db.record_audience_story_sighting(
        audience_id=inhouse.id,
        story_id="s-mid",
        rank_in_feed=2,
        seen_at=(datetime.now(UTC) - timedelta(minutes=5)).isoformat().replace("+00:00", "Z"),
    )
    await pg_db.record_audience_story_sighting(
        audience_id=inhouse.id,
        story_id="s-old-recent",
        rank_in_feed=3,
        seen_at=(datetime.now(UTC) - timedelta(hours=2)).isoformat().replace("+00:00", "Z"),
    )
    await pg_db.record_audience_story_sighting(
        audience_id=inhouse.id,
        story_id="s-stale",
        rank_in_feed=4,
        seen_at=stale,
    )
    await pg_db.record_audience_story_sighting(
        audience_id=inhouse.id,
        story_id="s-low",
        rank_in_feed=5,
        seen_at=recent,
    )

    for story_id, score in (
        ("s-new", 0.8),
        ("s-mid", 0.7),
        ("s-old-recent", 0.6),
        ("s-stale", 0.9),
        ("s-low", 0.05),
    ):
        await pg_db.upsert_brand_story_score(
            company_id, story_id, score=score, method="embedding_cosine", model="test"
        )

    company = await pg_db.get_company(company_id)
    assert company is not None
    snapshot = company.to_dict()
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(brand_pipeline, "db", pg_db)
        mp.setattr(
            pg_db,
            "list_audiences",
            AsyncMock(
                return_value=[
                    Audience(
                        id=inhouse.id,
                        title="Runners",
                        description="desc",
                        created_at=now,
                        updated_at=now,
                    )
                ]
            ),
        )
        page0 = await brand_pipeline.collect_company_stories_page(
            company_id, snapshot, offset=0, limit=2, posts_per_story=0
        )
        page1 = await brand_pipeline.collect_company_stories_page(
            company_id, snapshot, offset=2, limit=2, posts_per_story=0
        )

    assert [s["story_id"] for s in page0] == ["s-new", "s-mid"]
    assert [s["story_id"] for s in page1] == ["s-old-recent"]
    assert all(s["story_id"] != "s-stale" for s in page0 + page1)
    assert all(s["story_id"] != "s-low" for s in page0 + page1)
    assert page0[0]["audiences"][0]["audience_id"] == inhouse.id


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_collect_company_stories_page_json_serializable_with_posts(pg_db):
    now = time.time()
    recent = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    company = await pg_db.create_company(f"https://company-stories-json-{now}.example")
    company_id = company.id
    inhouse = await pg_db.create_audience(title="Runners", description="desc")
    await pg_db.set_audience_match_result(
        company_id,
        audiences=[
            {
                "title": "Marathon fans",
                "description": "People who follow endurance sports",
                "match": {
                    "audience_id": inhouse.id,
                    "title": "Runners",
                    "score": 0.9,
                },
            }
        ],
        model="test",
    )
    story_id = "s-json"
    await pg_db.ingest_trending_story(
        {
            "capture_id": "c",
            "story_id": story_id,
            "headline": "JSON serializable headline",
            "topic_category": "Sports",
            "recency_label": "now",
            "post_count": 100,
            "rank_in_feed": 1,
        }
    )
    await pg_db.ingest_trending_post(
        {
            "post_id": f"post-json-{int(now)}",
            "url": "https://x.com/example/status/json",
            "category": "news",
            "author_handle": "runner",
            "text": "race day",
            "views": 1_250_000,
            "story_id": story_id,
        }
    )
    await pg_db.record_audience_story_sighting(
        audience_id=inhouse.id,
        story_id=story_id,
        rank_in_feed=1,
        seen_at=recent,
    )
    await pg_db.upsert_brand_story_score(
        company_id, story_id, score=0.8, method="embedding_cosine", model="test"
    )

    company = await pg_db.get_company(company_id)
    assert company is not None
    snapshot = company.to_dict()
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(brand_pipeline, "db", pg_db)
        mp.setattr(
            pg_db,
            "list_audiences",
            AsyncMock(
                return_value=[
                    Audience(
                        id=inhouse.id,
                        title="Runners",
                        description="desc",
                        created_at=now,
                        updated_at=now,
                    )
                ]
            ),
        )
        page = await brand_pipeline.collect_company_stories_page(
            company_id, snapshot, offset=0, limit=1, posts_per_story=3
        )

    assert len(page) == 1
    assert page[0]["story_id"] == story_id
    assert page[0]["posts"]
    payload = json.dumps(page)
    assert "1250000" in payload or "1250000.0" in payload
