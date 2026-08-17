"""tests for the twitter news consumer: transform functions and fuzzy matching."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.consumers.twitter_news import (  # noqa: E402
    _FUZZY_MODEL,
    _MAX_HAIKU_CANDIDATES,
    _deterministic_story_id,
    _exact_match_story_id,
    _parse_fuzzy_match_index,
    _rank_story_candidates,
    _story_similarity,
    _normalize_news_message,
    _parse_metric,
    _parse_recency_to_iso,
    _fuzzy_match_story_id,
    _resolve_story_id,
    ingest_news_stories,
)


# ============================================================
# transform helpers
# ============================================================
def test_parse_metric_basic():
    assert _parse_metric("1.3K") == 1300
    assert _parse_metric("199") == 199
    assert _parse_metric("2.5M") == 2_500_000
    assert _parse_metric("1,234") == 1234
    assert _parse_metric("12.5K posts") == 12_500
    assert _parse_metric(None) == 0
    assert _parse_metric("") == 0


def test_parse_recency_to_iso():
    now = datetime(2026, 6, 4, 12, 0, 0, tzinfo=timezone.utc)
    assert _parse_recency_to_iso("3 hours ago", now) == "2026-06-04T09:00:00Z"
    assert _parse_recency_to_iso("2 days ago", now) == "2026-06-02T12:00:00Z"
    assert _parse_recency_to_iso("1 week ago", now) == "2026-05-28T12:00:00Z"
    assert _parse_recency_to_iso("30 minutes ago", now) == "2026-06-04T11:30:00Z"
    assert _parse_recency_to_iso("Trending now", now) is None
    assert _parse_recency_to_iso("", now) is None


# ============================================================
# normalize_news_message: derives story fields from raw payload
# ============================================================
def _make_raw_payload(**overrides) -> str:
    base = {
        "type": "trends_twitter_news_v1",
        "capture_id": "cap-1",
        "captured_at": "2026-06-04T12:00:00Z",
        "source": "global_trending_scrape",
        "story": {
            "headline": "Gas Station Owner Acquitted in Fatal Shooting of Armed Teen",
            "topic_category": "US News",
            "post_count_raw": "18.4K posts",
            "recency_label": "3 hours ago",
            "rank_in_feed": 1,
            "summary": None,
            "last_updated_at": None,
            "linked_posts": [],
        },
    }
    base.update(overrides)
    return json.dumps(base)


def test_normalize_derives_post_count():
    now = datetime(2026, 6, 4, 12, 0, 0, tzinfo=timezone.utc)
    result = _normalize_news_message(_make_raw_payload(), now=now)
    assert result["post_count"] == 18_400
    assert result["post_count_raw"] == "18.4K posts"


def test_normalize_derives_approx_started_at():
    now = datetime(2026, 6, 4, 12, 0, 0, tzinfo=timezone.utc)
    result = _normalize_news_message(_make_raw_payload(), now=now)
    assert result["approx_started_at"] == "2026-06-04T09:00:00Z"


def test_normalize_rejects_missing_fields():
    payload = json.dumps(
        {
            "type": "trends_twitter_news_v1",
            "capture_id": "cap-1",
            "story": {"headline": "", "topic_category": "US News", "recency_label": "1 hour ago"},
        }
    )
    with pytest.raises(ValueError):
        _normalize_news_message(payload)


def test_normalize_handle_prefix():
    now = datetime(2026, 6, 4, 12, 0, 0, tzinfo=timezone.utc)
    raw = json.loads(_make_raw_payload())
    raw["story"]["linked_posts"] = [
        {
            "post_id": "p1",
            "url": "https://x.com/user/status/1",
            "text": "hello",
            "author_handle": "noatsign",
            "author_verified": False,
            "likes": 0,
            "retweets": 0,
            "replies": 0,
            "views": 0,
            "media_urls": [],
        }
    ]
    result = _normalize_news_message(json.dumps(raw), now=now)
    assert result["linked_posts"][0]["author_handle"] == "@noatsign"


# ============================================================
# fuzzy matching (haiku mocked)
# ============================================================
_GAS_STATION_ID = "existing-gs-001"
_NOWAK_ID = "existing-nk-001"

GAS_STATION_CANDIDATES = [
    {
        "story_id": _GAS_STATION_ID,
        "headline": "Gas Station Owner Acquitted in Fatal Shooting of Armed Teen",
    },
]

NOWAK_CANDIDATES = [
    {
        "story_id": _NOWAK_ID,
        "headline": "Henry Nowak Handcuffed by Police as He Died from Stab Wounds",
    },
]


def _mock_haiku(reply: str):
    """Patch the haiku client to return a fixed text response."""
    msg = MagicMock()
    msg.content = [MagicMock(text=reply)]
    client = MagicMock()
    client.messages.create = AsyncMock(return_value=msg)
    return patch("api.consumers.twitter_news._haiku_client", client)


class _FakeStoryDb:
    def __init__(self, candidates):
        self.candidates = candidates
        self.calls = []

    async def get_recent_stories_by_category(self, topic_category: str, since_hours: int):
        self.calls.append((topic_category, since_hours))
        return self.candidates


class _FakeCrossCategoryDb:
    """no same-category candidate; the duplicate lives under another category."""

    def __init__(self, cross_candidates):
        self.cross = cross_candidates

    async def get_recent_stories_by_category(self, topic_category: str, since_hours: int):
        return []

    async def get_recent_stories(self, since_hours: int):
        return self.cross


class _FakeXTrendIdDb:
    def __init__(self, story_id: str | None):
        self.story_id = story_id
        self.recent_called = False

    async def get_story_by_x_trend_id(self, x_trend_id: str | None):
        if x_trend_id != "1882000000000000000" or self.story_id is None:
            return None
        return {
            "story_id": self.story_id,
            "headline": "Existing X event headline",
        }

    async def get_recent_stories_by_category(self, topic_category: str, since_hours: int):
        self.recent_called = True
        return []


def test_fuzzy_uses_current_haiku_model():
    assert _FUZZY_MODEL == "claude-haiku-4-5"


def test_exact_match_reuses_same_normalized_headline():
    result = _exact_match_story_id(
        " gas station owner acquitted in fatal shooting of armed teen ",
        "us news",
        GAS_STATION_CANDIDATES,
    )
    assert result == _GAS_STATION_ID


def test_story_similarity_scores_expected_bands():
    assert (
        _story_similarity(
            "Lincoln Memorial reflecting pool refilled with American flag blue",
            "Lincoln Memorial reflecting pool refilled with American flag blue!",
        )
        >= 0.90
    )
    assert (
        0.50
        <= _story_similarity(
            "Gas Station Owner Acquitted in Shooting of 14-Year-Old Boy",
            "Gas Station Owner Acquitted in Fatal Shooting of Armed Teen",
        )
        < 0.90
    )
    assert (
        _story_similarity(
            "Earthquake Hits Pacific Coast, Tsunami Warning Issued",
            "Gas Station Owner Acquitted in Fatal Shooting of Armed Teen",
        )
        < 0.50
    )


def test_rank_story_candidates_orders_by_similarity():
    ranked = _rank_story_candidates(
        "Gas Station Owner Acquitted in Shooting of 14-Year-Old Boy",
        "US News",
        [
            {
                "story_id": "unrelated",
                "headline": "Earthquake Hits Pacific Coast, Tsunami Warning Issued",
            },
            *GAS_STATION_CANDIDATES,
        ],
    )
    assert ranked[0]["story_id"] == _GAS_STATION_ID
    assert ranked[0]["_similarity_score"] > ranked[1]["_similarity_score"]


def test_parse_fuzzy_match_index_accepts_json_and_legacy_integer():
    assert _parse_fuzzy_match_index('{"match_index": 2}') == 2
    assert _parse_fuzzy_match_index('```json\n{"match_index": -1}\n```') == -1
    assert _parse_fuzzy_match_index("0") == 0
    assert _parse_fuzzy_match_index("2, 4, 20") is None
    assert _parse_fuzzy_match_index("Looking at the incoming headline...") is None


@pytest.mark.asyncio
async def test_fuzzy_returns_match_when_haiku_says_0():
    with _mock_haiku("0"):
        result = await _fuzzy_match_story_id(
            "Gas Station Owner Acquitted in Shooting of 14-Year-Old Boy",
            GAS_STATION_CANDIDATES,
        )
    assert result == _GAS_STATION_ID


@pytest.mark.asyncio
async def test_fuzzy_returns_none_when_haiku_says_minus1():
    with _mock_haiku("-1"):
        result = await _fuzzy_match_story_id(
            "Earthquake Hits Pacific Coast, Tsunami Warning Issued",
            GAS_STATION_CANDIDATES,
        )
    assert result is None


@pytest.mark.asyncio
async def test_fuzzy_empty_candidates_skips_haiku():
    # no haiku call should be made when there are no candidates
    with patch("api.consumers.twitter_news._haiku_client") as mock_client:
        result = await _fuzzy_match_story_id("anything", [])
    mock_client.messages.create.assert_not_called()
    assert result is None


@pytest.mark.asyncio
async def test_fuzzy_haiku_failure_returns_none():
    client = MagicMock()
    client.messages.create = AsyncMock(side_effect=Exception("network error"))
    with patch("api.consumers.twitter_news._haiku_client", client):
        result = await _fuzzy_match_story_id("Some headline", GAS_STATION_CANDIDATES)
    assert result is None


@pytest.mark.asyncio
async def test_fuzzy_returns_match_when_haiku_says_json():
    with _mock_haiku('{"match_index": 0}'):
        result = await _fuzzy_match_story_id(
            "Gas Station Owner Acquitted in Shooting of 14-Year-Old Boy",
            GAS_STATION_CANDIDATES,
        )
    assert result == _GAS_STATION_ID


@pytest.mark.asyncio
async def test_fuzzy_bad_haiku_response_returns_none():
    with _mock_haiku("2, 4, 20"):
        result = await _fuzzy_match_story_id(
            "Gas Station Owner Acquitted in Shooting of 14-Year-Old Boy",
            GAS_STATION_CANDIDATES,
        )
    assert result is None


@pytest.mark.asyncio
async def test_resolve_story_id_x_trend_id_match_short_circuits_fuzzy():
    db = _FakeXTrendIdDb("story-from-x-trend-id")
    with patch(
        "api.consumers.twitter_news._fuzzy_match_story_id",
        AsyncMock(return_value=None),
    ) as mock_fuzzy:
        story_id, resolution = await _resolve_story_id(
            "Different headline for same X event",
            "Technology",
            db_instance=db,
            x_trend_id="1882000000000000000",
        )
    assert story_id == "story-from-x-trend-id"
    assert resolution["method"] == "x_trend_id"
    assert resolution["matched_headline"] == "Existing X event headline"
    assert db.recent_called is False
    mock_fuzzy.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_story_id_reuses_haiku_match():
    db = _FakeStoryDb(GAS_STATION_CANDIDATES)
    with _mock_haiku('{"match_index": 0}'):
        story_id, resolution = await _resolve_story_id(
            "Gas Station Owner Acquitted in Shooting of 14-Year-Old Boy",
            "US News",
            db_instance=db,
        )
    assert story_id == _GAS_STATION_ID
    assert resolution["method"] == "haiku"
    assert db.calls == [("US News", 72)]


@pytest.mark.asyncio
async def test_resolve_story_id_exact_match_skips_haiku():
    db = _FakeStoryDb(GAS_STATION_CANDIDATES)
    with patch(
        "api.consumers.twitter_news._fuzzy_match_story_id",
        AsyncMock(return_value=None),
    ) as mock_fuzzy:
        story_id, resolution = await _resolve_story_id(
            " gas station owner acquitted in fatal shooting of armed teen ",
            "US News",
            db_instance=db,
        )
    assert story_id == _GAS_STATION_ID
    assert resolution is None
    mock_fuzzy.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_story_id_high_similarity_skips_haiku():
    db = _FakeStoryDb(
        [
            {
                "story_id": "lincoln-1",
                "headline": "Lincoln Memorial reflecting pool refilled with American flag blue",
            }
        ]
    )
    with patch(
        "api.consumers.twitter_news._fuzzy_match_story_id",
        AsyncMock(return_value=None),
    ) as mock_fuzzy:
        story_id, resolution = await _resolve_story_id(
            "Lincoln Memorial reflecting pool refilled with American flag blue!",
            "News",
            db_instance=db,
        )
    assert story_id == "lincoln-1"
    assert resolution["method"] == "lexical"
    mock_fuzzy.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_story_id_sends_only_top_gray_candidates_to_haiku():
    async def _match_first_candidate(_headline, candidates):
        return candidates[0]["story_id"]

    candidates = [
        {
            "story_id": f"gas-{i}",
            "headline": f"Gas Station Owner Acquitted in Fatal Shooting of Armed Teen {i}",
        }
        for i in range(_MAX_HAIKU_CANDIDATES + 3)
    ]
    candidates.append(
        {
            "story_id": "unrelated",
            "headline": "Earthquake Hits Pacific Coast, Tsunami Warning Issued",
        }
    )
    db = _FakeStoryDb(candidates)
    with patch(
        "api.consumers.twitter_news._fuzzy_match_story_id",
        AsyncMock(side_effect=_match_first_candidate),
    ) as mock_fuzzy:
        story_id, resolution = await _resolve_story_id(
            "Gas Station Owner Acquitted in Shooting of 14-Year-Old Boy",
            "US News",
            db_instance=db,
        )
    assert story_id.startswith("gas-")
    assert resolution["method"] == "haiku"
    sent_candidates = mock_fuzzy.await_args.args[1]
    assert len(sent_candidates) == _MAX_HAIKU_CANDIDATES
    assert all(c["story_id"].startswith("gas-") for c in sent_candidates)


@pytest.mark.asyncio
async def test_resolve_story_id_dedups_same_event_across_categories():
    # same upgrade reported under a different trending category, worded
    # differently — it must still reach haiku and reuse the existing story.
    db = _FakeCrossCategoryDb(
        [
            {
                "story_id": "notebook-1",
                "headline": "Google upgrades NotebookLM with new audio overviews",
                "topic_category": "Technology",
            }
        ]
    )
    with (
        patch("api.consumers.twitter_news.has_embedding_config", return_value=False),
        _mock_haiku('{"match_index": 0}'),
    ):
        story_id, resolution = await _resolve_story_id(
            "NotebookLM gets a major upgrade from Google",
            "Business",
            db_instance=db,
        )
    assert story_id == "notebook-1"
    assert resolution["method"] == "haiku"


@pytest.mark.asyncio
async def test_resolve_story_id_cosine_auto_merges_without_haiku():
    # lexical match reaches the cosine tier; a near-identical embedding merges
    # the story outright, so haiku is never asked.
    db = _FakeCrossCategoryDb(
        [
            {
                "story_id": "notebook-1",
                "headline": "Google upgrades NotebookLM with new audio overviews",
                "topic_category": "Technology",
            }
        ]
    )
    with (
        patch("api.consumers.twitter_news.has_embedding_config", return_value=True),
        patch(
            "api.consumers.twitter_news.embed_texts_batched",
            AsyncMock(return_value=[[1.0, 0.0], [1.0, 0.0]]),
        ),
        patch(
            "api.consumers.twitter_news._fuzzy_match_story_id",
            AsyncMock(return_value=None),
        ) as mock_fuzzy,
    ):
        story_id, resolution = await _resolve_story_id(
            "NotebookLM gets a major upgrade from Google",
            "Business",
            db_instance=db,
        )
    assert story_id == "notebook-1"
    assert resolution["method"] == "cosine"
    assert resolution["cosine_score"] == 1.0
    mock_fuzzy.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_story_id_cosine_prunes_below_floor_before_haiku():
    # the lexical floor lets a candidate through, but a low cosine drops it, so
    # haiku gets nothing and the story is treated as new.
    db = _FakeCrossCategoryDb(
        [
            {
                "story_id": "notebook-1",
                "headline": "Google upgrades NotebookLM with new audio overviews",
                "topic_category": "Technology",
            }
        ]
    )
    with (
        patch("api.consumers.twitter_news.has_embedding_config", return_value=True),
        patch(
            "api.consumers.twitter_news.embed_texts_batched",
            AsyncMock(return_value=[[1.0, 0.0], [0.0, 1.0]]),
        ),
        patch(
            "api.consumers.twitter_news._fuzzy_match_story_id",
            AsyncMock(return_value="notebook-1"),
        ) as mock_fuzzy,
    ):
        story_id, resolution = await _resolve_story_id(
            "NotebookLM gets a major upgrade from Google",
            "Business",
            db_instance=db,
        )
    assert story_id == _deterministic_story_id(
        "NotebookLM gets a major upgrade from Google", "Business"
    )
    assert resolution is None
    mock_fuzzy.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_story_id_low_similarity_skips_haiku():
    db = _FakeStoryDb(GAS_STATION_CANDIDATES)
    with patch(
        "api.consumers.twitter_news._fuzzy_match_story_id",
        AsyncMock(return_value=None),
    ) as mock_fuzzy:
        story_id, resolution = await _resolve_story_id(
            "Earthquake Hits Pacific Coast, Tsunami Warning Issued",
            "US News",
            db_instance=db,
        )
    assert story_id == _deterministic_story_id(
        "Earthquake Hits Pacific Coast, Tsunami Warning Issued",
        "US News",
    )
    assert resolution is None
    mock_fuzzy.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_story_id_generates_stable_id_when_unmatched():
    db = _FakeStoryDb([])
    story_id, resolution = await _resolve_story_id(
        "Earthquake Hits Pacific Coast, Tsunami Warning Issued",
        "US News",
        db_instance=db,
    )
    assert story_id == _deterministic_story_id(
        "Earthquake Hits Pacific Coast, Tsunami Warning Issued",
        "US News",
    )
    assert resolution is None


# ============================================================
# ingest + audience attribution (real CoreDatabase)
# ============================================================
def _story(headline: str, *, rank: int = 1, category: str = "US News") -> SimpleNamespace:
    return SimpleNamespace(
        headline=headline,
        topic_category=category,
        topic_categories=[category],
        post_count_raw="1.2K posts",
        recency_label="3 hours ago",
        rank_in_feed=rank,
        summary=None,
        last_updated_at=None,
        x_trend_id=None,
        source_url=None,
    )


async def _pg_fetchone(db, sql: str, params: tuple = ()):
    pool = db._require_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(sql, params)
        return await cur.fetchone()


async def _pg_fetchall(db, sql: str, params: tuple = ()):
    pool = db._require_pool()
    async with pool.connection() as conn:
        cur = await conn.execute(sql, params)
        return await cur.fetchall()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_ingest_records_sighting_when_audience_set(pg_db):
    written = await ingest_news_stories(
        pg_db,
        [_story("Quake rocks the Pacific coast", rank=4)],
        [],
        capture_id="cap-x",
        captured_at="2026-06-05T00:00:00Z",
        source="global_trending_scrape",
        audience_id="aud-1",
        audience_member_id="mem-1",
    )
    assert written == (1, 0)
    rows = await pg_db.list_audience_story_sightings(["aud-1"])
    assert len(rows) == 1
    assert rows[0]["audience_id"] == "aud-1"
    assert rows[0]["rank_in_feed"] == 4
    row = await _pg_fetchone(
        pg_db,
        "SELECT audience_member_id FROM audience_story_sightings",
    )
    assert row["audience_member_id"] == "mem-1"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_ingest_without_audience_writes_no_sighting(pg_db):
    await ingest_news_stories(
        pg_db,
        [_story("Unattributed story")],
        [],
        capture_id="cap-y",
        captured_at="2026-06-05T00:00:00Z",
        source="global_trending_scrape",
    )
    row = await _pg_fetchone(
        pg_db,
        "SELECT COUNT(*) AS n FROM audience_story_sightings",
    )
    assert row["n"] == 0


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_ingest_persists_x_trend_id(pg_db):
    story = _story("Volcano erupts near the coast", rank=2)
    story.x_trend_id = "1882000000000000000"
    story.source_url = "https://x.com/i/trending/1882000000000000000"
    await ingest_news_stories(
        pg_db,
        [story],
        [],
        capture_id="cap-x-trend-id",
        captured_at="2026-06-05T00:00:00Z",
        source="global_trending_scrape",
    )
    row = await _pg_fetchone(
        pg_db,
        "SELECT x_trend_id, source_url FROM trending_stories WHERE headline = %s",
        ("Volcano erupts near the coast",),
    )
    assert row["x_trend_id"] == "1882000000000000000"
    assert row["source_url"].endswith("1882000000000000000")


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_ingest_reuses_story_by_x_trend_id(pg_db):
    first_story = _story("Volcano erupts near the coast", rank=2)
    first_story.x_trend_id = "1882000000000000000"
    second_story = _story("Coastal volcano eruption disrupts flights", rank=3)
    second_story.x_trend_id = "1882000000000000000"
    first = await ingest_news_stories(
        pg_db,
        [first_story],
        [],
        capture_id="cap-news-id-1",
        captured_at="2026-06-05T00:00:00Z",
        source="global_trending_scrape",
    )
    second = await ingest_news_stories(
        pg_db,
        [second_story],
        [],
        capture_id="cap-news-id-2",
        captured_at="2026-06-05T00:03:00Z",
        source="global_trending_scrape",
    )
    assert first == (1, 0)
    assert second == (0, 1)
    rows = await _pg_fetchall(
        pg_db,
        "SELECT story_id, headline, capture_count FROM trending_stories",
    )
    assert len(rows) == 1
    assert rows[0]["story_id"] == _deterministic_story_id(
        first_story.headline,
        first_story.topic_category,
    )
    assert rows[0]["headline"] == second_story.headline
    assert rows[0]["capture_count"] == 2
    aliases = await pg_db.get_story_aliases(rows[0]["story_id"])
    assert len(aliases) == 1
    assert aliases[0]["headline"] == second_story.headline
    assert aliases[0]["x_trend_id"] == "1882000000000000000"
    assert aliases[0]["method"] == "x_trend_id"
    assert aliases[0]["lexical_score"] is None
    assert aliases[0]["cosine_score"] is None


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_ingest_merges_topic_categories_on_upsert(pg_db):
    first = _story("Quake rocks the Pacific coast", rank=4, category="Politics")
    first.topic_categories = ["news", "Politics"]
    await ingest_news_stories(
        pg_db,
        [first],
        [],
        capture_id="cap-cats-1",
        captured_at="2026-06-05T00:00:00Z",
        source="global_trending_scrape",
    )
    second = _story("Quake rocks the Pacific coast", rank=2, category="Politics")
    second.topic_categories = ["sports", "Politics"]
    await ingest_news_stories(
        pg_db,
        [second],
        [],
        capture_id="cap-cats-2",
        captured_at="2026-06-05T00:03:00Z",
        source="global_trending_scrape",
    )
    row = await _pg_fetchone(
        pg_db,
        "SELECT topic_categories FROM trending_stories WHERE headline = %s",
        (first.headline,),
    )
    assert json.loads(row["topic_categories"]) == ["news", "Politics", "sports"]


@pytest.mark.parametrize("method", ["lexical", "cosine", "haiku"])
@pytest.mark.postgres
@pytest.mark.asyncio
async def test_ingest_writes_story_alias_for_fuzzy_resolution(pg_db, method):
    base = _story("Google upgrades NotebookLM with new audio overviews", category="Technology")
    await ingest_news_stories(
        pg_db,
        [base],
        [],
        capture_id="cap-alias-1",
        captured_at="2026-06-05T00:00:00Z",
        source="global_trending_scrape",
    )
    story_id = _deterministic_story_id(base.headline, base.topic_category)
    alias_story = _story(
        "NotebookLM gets a major upgrade from Google",
        category="Business",
    )
    alias_story.x_trend_id = "1882000000000000001"
    resolution = {
        "method": method,
        "matched_headline": base.headline,
        "lexical_score": 0.42,
        "cosine_score": 0.94 if method == "cosine" else None,
    }
    with patch(
        "api.consumers.twitter_news._resolve_story_id",
        AsyncMock(return_value=(story_id, resolution)),
    ):
        await ingest_news_stories(
            pg_db,
            [alias_story],
            [],
            capture_id="cap-alias-2",
            captured_at="2026-06-05T00:03:00Z",
            source="global_trending_scrape",
        )

    aliases = await pg_db.get_story_aliases(story_id)
    assert len(aliases) == 1
    assert aliases[0]["headline"] == alias_story.headline
    assert aliases[0]["x_trend_id"] == "1882000000000000001"
    assert aliases[0]["method"] == method
    assert aliases[0]["lexical_score"] == 0.42
    assert aliases[0]["cosine_score"] == (0.94 if method == "cosine" else None)


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_ingest_writes_no_alias_on_exact_match(pg_db):
    story = _story("Quake rocks the Pacific coast", rank=4)
    await ingest_news_stories(
        pg_db,
        [story],
        [],
        capture_id="cap-exact-1",
        captured_at="2026-06-05T00:00:00Z",
        source="global_trending_scrape",
    )
    await ingest_news_stories(
        pg_db,
        [_story(" quake rocks the pacific coast ", rank=2)],
        [],
        capture_id="cap-exact-2",
        captured_at="2026-06-05T00:03:00Z",
        source="global_trending_scrape",
    )
    story_id = _deterministic_story_id(story.headline, story.topic_category)
    assert await pg_db.get_story_aliases(story_id) == []


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_ingest_writes_no_alias_when_headline_unchanged(pg_db):
    story = _story("Quake rocks the Pacific coast", rank=4)
    await ingest_news_stories(
        pg_db,
        [story],
        [],
        capture_id="cap-same-headline-1",
        captured_at="2026-06-05T00:00:00Z",
        source="global_trending_scrape",
    )
    story_id = _deterministic_story_id(story.headline, story.topic_category)
    resolution = {
        "method": "haiku",
        "matched_headline": story.headline,
        "lexical_score": 0.55,
        "cosine_score": None,
    }
    with patch(
        "api.consumers.twitter_news._resolve_story_id",
        AsyncMock(return_value=(story_id, resolution)),
    ):
        await ingest_news_stories(
            pg_db,
            [_story(story.headline, rank=2)],
            [],
            capture_id="cap-same-headline-2",
            captured_at="2026-06-05T00:03:00Z",
            source="global_trending_scrape",
        )
    assert await pg_db.get_story_aliases(story_id) == []


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_ingest_reuses_exact_story_on_repeat_capture(pg_db):
    story = _story("Quake rocks the Pacific coast", rank=4)
    first = await ingest_news_stories(
        pg_db,
        [story],
        [],
        capture_id="cap-1",
        captured_at="2026-06-05T00:00:00Z",
        source="global_trending_scrape",
        audience_id="aud-1",
    )
    second = await ingest_news_stories(
        pg_db,
        [_story(" quake rocks the pacific coast ", rank=2)],
        [],
        capture_id="cap-2",
        captured_at="2026-06-05T00:03:00Z",
        source="global_trending_scrape",
        audience_id="aud-1",
    )

    assert first == (1, 0)
    assert second == (0, 1)
    rows = await _pg_fetchall(
        pg_db,
        "SELECT story_id, capture_count FROM trending_stories",
    )
    assert len(rows) == 1
    assert rows[0]["story_id"] == _deterministic_story_id(
        story.headline,
        story.topic_category,
    )
    assert rows[0]["capture_count"] == 2
    sightings = await pg_db.list_audience_story_sightings(["aud-1"])
    assert len(sightings) == 1
    assert sightings[0]["rank_in_feed"] == 2


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_ingest_dedups_fuzzy_collapsed_stories_within_run(pg_db):
    with patch(
        "api.consumers.twitter_news._resolve_story_id",
        AsyncMock(return_value=("same-story", None)),
    ):
        written = await ingest_news_stories(
            pg_db,
            [_story("Quake hits coast"), _story("Earthquake strikes the coast")],
            [],
            capture_id="cap-z",
            captured_at="2026-06-05T00:00:00Z",
            source="global_trending_scrape",
            audience_id="aud-1",
        )
    assert written == (1, 0)
    rows = await pg_db.list_audience_story_sightings(["aud-1"])
    assert len(rows) == 1


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_record_sighting_upsert_preserves_first_seen(pg_db):
    await pg_db.ingest_trending_story(
        {
            "capture_id": "c",
            "story_id": "s1",
            "headline": "h",
            "topic_category": "US News",
            "recency_label": "now",
            "post_count": 1,
            "rank_in_feed": 9,
        }
    )
    await pg_db.record_audience_story_sighting(
        audience_id="a",
        story_id="s1",
        rank_in_feed=9,
        audience_member_id="m",
        seen_at="2026-06-05T00:00:00Z",
    )
    await pg_db.record_audience_story_sighting(
        audience_id="a",
        story_id="s1",
        rank_in_feed=2,
        audience_member_id="m",
        seen_at="2026-06-05T05:00:00Z",
    )
    row = await _pg_fetchone(
        pg_db,
        "SELECT first_seen_at, last_seen_at, rank_in_feed "
        "FROM audience_story_sightings WHERE audience_id='a' AND story_id='s1'",
    )
    assert row["first_seen_at"] == "2026-06-05 00:00:00"
    assert row["last_seen_at"] == "2026-06-05 05:00:00"
    assert row["rank_in_feed"] == 2


@pytest.mark.skip(reason="sqlite migration only")
@pytest.mark.asyncio
async def test_exact_duplicate_migration_repoints_story_links():
    pass


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_collect_audience_trends_one_row_per_story(pg_db):
    from api.features import brand_pipeline

    a1 = await pg_db.create_audience(title="Runners", description="desc")
    a2 = await pg_db.create_audience(title="Cyclists", description="desc")

    await pg_db.ingest_trending_story(
        {
            "capture_id": "c",
            "story_id": "s1",
            "headline": "Marathon record falls",
            "topic_category": "Sports",
            "recency_label": "now",
            "post_count": 5000,
            "rank_in_feed": 1,
        }
    )
    await pg_db.record_audience_story_sighting(audience_id=a1.id, story_id="s1", rank_in_feed=3)
    await pg_db.record_audience_story_sighting(audience_id=a2.id, story_id="s1", rank_in_feed=7)

    with patch.object(brand_pipeline, "db", pg_db):
        stories = await brand_pipeline.collect_audience_trends([a1.id, a2.id])
    assert len(stories) == 1
    story = stories[0]
    assert story["story_id"] == "s1"
    titles = sorted(a["title"] for a in story["audiences"])
    assert titles == ["Cyclists", "Runners"]
