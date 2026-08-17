from __future__ import annotations

from api.db.common import _merge_topic_categories
from ingestion.twitter.news.scrape_news import (
    VOLATILE_PROFILE_PATHS,
    ScrapedStory,
    _clear_volatile_profile_state,
    _merge_parsed_story,
    _x_trend_id_from_url,
)


def test_x_trend_id_from_url_extracts_trending_id():
    assert (
        _x_trend_id_from_url("https://x.com/i/trending/1882000000000000000")
        == "1882000000000000000"
    )
    assert (
        _x_trend_id_from_url("https://x.com/i/events/1882000000000000001?foo=bar")
        == "1882000000000000001"
    )
    assert _x_trend_id_from_url("https://x.com/explore/tabs/news") is None
    assert _x_trend_id_from_url(None) is None


def test_merge_topic_categories_dedupes_explore_tab_and_tile():
    merged = _merge_topic_categories(["news"], ["Politics"])
    assert merged == ["news", "Politics"]
    again = _merge_topic_categories(merged, ["news", "Sports"])
    assert again == ["news", "Politics", "Sports"]


def test_merge_parsed_story_dedupes_by_headline_and_merges_categories():
    by_key: dict = {}
    drill_source: dict = {}
    story = ScrapedStory(
        headline="Knicks Win Championship",
        topic_category="Sports",
        topic_categories=["news", "Sports"],
        post_count_raw="50K posts",
        recency_label="1h",
        rank_in_feed=1,
    )
    dupe = ScrapedStory(
        headline="Knicks Win Championship",
        topic_category="Sports",
        topic_categories=["sports", "Sports"],
        post_count_raw="50K posts",
        recency_label="1h",
        rank_in_feed=2,
    )
    assert _merge_parsed_story(by_key, drill_source, story, "news", "https://x.com/news")
    assert not _merge_parsed_story(by_key, drill_source, dupe, "sports", "https://x.com/sports")
    assert len(by_key) == 1
    assert by_key[list(by_key.keys())[0]].topic_categories == ["news", "Sports"]
    assert drill_source[list(by_key.keys())[0]] == ("news", "https://x.com/news")


def test_merge_parsed_story_dedupes_by_x_trend_id():
    by_key: dict = {}
    drill_source: dict = {}
    a = ScrapedStory(
        headline="Story A",
        topic_category="News",
        topic_categories=["news", "News"],
        post_count_raw="10K posts",
        recency_label="now",
        rank_in_feed=1,
        x_trend_id="123",
        source_url="https://x.com/i/trending/123",
    )
    b = ScrapedStory(
        headline="Story A longer headline",
        topic_category="News",
        topic_categories=["entertainment", "News"],
        post_count_raw="10K posts",
        recency_label="now",
        rank_in_feed=1,
        x_trend_id="123",
    )
    assert _merge_parsed_story(by_key, drill_source, a, "news", "https://x.com/news")
    assert not _merge_parsed_story(by_key, drill_source, b, "entertainment", "https://x.com/ent")
    assert len(by_key) == 1


def test_clear_volatile_profile_state_preserves_identity_state(tmp_path):
    profile = tmp_path / "profile"
    preserved_paths = [
        profile / "Default" / "Cookies",
        profile / "Default" / "Local Storage" / "leveldb" / "state.log",
        profile / "Default" / "Session Storage" / "session.log",
        profile / "Default" / "Preferences",
    ]
    for path in preserved_paths:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("keep")

    for rel_path in VOLATILE_PROFILE_PATHS:
        path = profile / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        if rel_path.endswith("Network Persistent State"):
            path.write_text("drop")
        else:
            path.mkdir(parents=True)
            (path / "entry").write_text("drop")

    _clear_volatile_profile_state(profile)

    for rel_path in VOLATILE_PROFILE_PATHS:
        assert not (profile / rel_path).exists()
    for path in preserved_paths:
        assert path.exists()
