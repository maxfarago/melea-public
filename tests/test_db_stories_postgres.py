from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from llm.embeddings import coerce_vector


def _embedding_vector(first: float = 1.0) -> list[float]:
    return [first] + [0.0] * 1535


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_ingest_story_and_sighting_roundtrip(pg_db):
    audience_id = f"aud-{uuid.uuid4().hex[:8]}"
    story_id = f"story-{uuid.uuid4().hex[:8]}"
    await pg_db.ingest_trending_story(
        {
            "story_id": story_id,
            "headline": "Marathon record falls",
            "topic_category": "Sports",
            "recency_label": "now",
            "post_count": 100,
            "rank_in_feed": 1,
        }
    )
    await pg_db.record_audience_story_sighting(
        audience_id=audience_id,
        story_id=story_id,
        rank_in_feed=3,
        audience_member_id="mem-1",
        seen_at="2026-06-05T00:00:00Z",
    )
    sightings = await pg_db.list_audience_story_sightings([audience_id])
    assert len(sightings) == 1
    assert sightings[0]["audience_id"] == audience_id
    assert sightings[0]["last_seen_at"] == "2026-06-05 00:00:00"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_sighting_iso_normalization_and_since_hours_window(pg_db):
    from api.db.common import utc_now_text

    audience_id = f"aud-{uuid.uuid4().hex[:8]}"
    recent_id = f"recent-{uuid.uuid4().hex[:8]}"
    old_id = f"old-{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc)
    recent_ts = utc_now_text()
    old_ts = (now - timedelta(hours=48)).strftime("%Y-%m-%d %H:%M:%S")

    for story_id, headline, last_seen in (
        (recent_id, "Recent headline", recent_ts),
        (old_id, "Old headline", old_ts),
    ):
        pool = pg_db._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                """
                INSERT INTO trending_stories (
                    story_id, headline, topic_category, recency_label,
                    post_count, rank_in_feed, first_seen_at, last_seen_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (story_id, headline, "News", "now", 1, 1, last_seen, last_seen),
            )

    await pg_db.record_audience_story_sighting(
        audience_id=audience_id,
        story_id=recent_id,
        seen_at="2026-06-04T12:00:00Z",
    )
    await pg_db.record_audience_story_sighting(
        audience_id=audience_id,
        story_id=old_id,
        seen_at="2026-06-03T08:30:00Z",
    )
    sightings = await pg_db.list_audience_story_sightings([audience_id])
    assert sightings[0]["story_id"] == recent_id
    assert sightings[1]["story_id"] == old_id

    stories_24h = await pg_db.list_trending_stories(since_hours=24)
    story_ids = {row["story_id"] for row in stories_24h}
    assert recent_id in story_ids
    assert old_id not in story_ids


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_store_story_embedding_roundtrip(pg_db):
    story_id = f"story-{uuid.uuid4().hex[:8]}"
    vector = _embedding_vector(0.6)
    await pg_db.ingest_trending_story(
        {
            "story_id": story_id,
            "headline": "Embedding test",
            "topic_category": "Tech",
            "recency_label": "now",
            "post_count": 1,
            "rank_in_feed": 1,
        }
    )
    await pg_db.store_story_embedding(
        story_id,
        input_text="headline: Embedding test",
        vector=vector,
        model="text-embedding-3-small",
        version="v1",
    )
    row = await pg_db.get_story_for_embedding(story_id)
    assert row is not None
    assert coerce_vector(row["story_embedding_vector"])[:2] == pytest.approx(
        vector[:2], rel=1e-5
    )


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_alias_on_conflict_do_nothing(pg_db):
    story_id = f"story-{uuid.uuid4().hex[:8]}"
    await pg_db.ingest_trending_story(
        {
            "story_id": story_id,
            "headline": "Alias headline",
            "topic_category": "News",
            "recency_label": "now",
            "post_count": 1,
            "rank_in_feed": 1,
        }
    )
    await pg_db.insert_story_alias(
        story_id=story_id,
        headline="Variant headline",
        x_trend_id=None,
        method="lexical",
        lexical_score=0.5,
        cosine_score=None,
        capture_id="cap-1",
    )
    await pg_db.insert_story_alias(
        story_id=story_id,
        headline="Variant headline",
        x_trend_id=None,
        method="lexical",
        lexical_score=0.9,
        cosine_score=None,
        capture_id="cap-2",
    )
    aliases = await pg_db.get_story_aliases(story_id)
    assert len(aliases) == 1
    assert aliases[0]["lexical_score"] == 0.5


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_list_brand_scores_for_story_joins_company(pg_db):
    suffix = uuid.uuid4().hex[:8]
    company = await pg_db.create_company(f"https://brand-{suffix}.example")
    story_id = f"story-{suffix}"
    await pg_db.ingest_trending_story(
        {
            "story_id": story_id,
            "headline": "Brand join test",
            "topic_category": "News",
            "recency_label": "now",
            "post_count": 1,
            "rank_in_feed": 1,
        }
    )
    await pg_db.upsert_brand_story_score(
        company.id,
        story_id,
        score=0.88,
        model="text-embedding-3-small",
    )
    scores = await pg_db.list_brand_scores_for_story(story_id)
    assert len(scores) == 1
    assert scores[0]["brand_id"] == company.id
    assert scores[0]["website_url"] == f"https://brand-{suffix}.example"
    assert scores[0]["score"] == pytest.approx(0.88)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_list_audience_story_sightings_coerces_aggregate_numeric(pg_db):
    audience_id = f"aud-{uuid.uuid4().hex[:8]}"
    story_id = f"story-{uuid.uuid4().hex[:8]}"
    recent = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    await pg_db.ingest_trending_story(
        {
            "story_id": story_id,
            "headline": "Viral marathon headline",
            "topic_category": "Sports",
            "recency_label": "now",
            "post_count": 100,
            "rank_in_feed": 1,
        }
    )
    await pg_db.ingest_trending_post(
        {
            "post_id": f"post-{uuid.uuid4().hex[:8]}",
            "url": "https://x.com/example/status/1",
            "category": "news",
            "author_handle": "runner",
            "text": "big race today",
            "views": 2_500_000,
            "story_id": story_id,
        }
    )
    await pg_db.record_audience_story_sighting(
        audience_id=audience_id,
        story_id=story_id,
        rank_in_feed=1,
        seen_at=recent,
    )

    rows = await pg_db.list_audience_story_sightings([audience_id])
    assert len(rows) == 1
    top_views = rows[0]["top_post_views"]
    assert not isinstance(top_views, Decimal)
    assert top_views == 2_500_000
    json.dumps(rows)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_list_trending_posts_for_stories_is_json_serializable(pg_db):
    story_id = f"story-{uuid.uuid4().hex[:8]}"
    await pg_db.ingest_trending_story(
        {
            "story_id": story_id,
            "headline": "Posts json test",
            "topic_category": "News",
            "recency_label": "now",
            "post_count": 1,
            "rank_in_feed": 1,
        }
    )
    await pg_db.ingest_trending_post(
        {
            "post_id": f"post-{uuid.uuid4().hex[:8]}",
            "url": "https://x.com/example/status/2",
            "category": "news",
            "author_handle": "newsdesk",
            "text": "breaking",
            "likes": 12_500,
            "retweets": 900,
            "replies": 40,
            "views": 9_876_543,
            "story_id": story_id,
        }
    )

    posts_by_story = await pg_db.list_trending_posts_for_stories([story_id], per_story_limit=3)
    posts = posts_by_story[story_id]
    assert len(posts) == 1
    for key in ("likes", "retweets", "replies", "views"):
        assert not isinstance(posts[0][key], Decimal)
    json.dumps(posts_by_story)
