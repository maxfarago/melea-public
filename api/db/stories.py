"""trending story persistence methods."""

from __future__ import annotations

import json
import time
from typing import Any

from api.db.common import (
    _loads_json_list,
    _merge_topic_categories,
    _row_dict,
    normalize_utc_text,
)

_PG_NOW = "to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')"


class StoriesMixin:
    # --- trending ---

    async def ingest_trending_post(self, payload: dict[str, Any]) -> bool:
        """upsert a trending post. returns True when the row was newly inserted."""
        post_id = str(payload["post_id"])
        category = str(payload["category"])
        source = str(payload.get("source") or "global_trending_scrape")
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT 1 FROM trending_posts WHERE post_id = %s",
                (post_id,),
            )
            inserted = await cur.fetchone() is None

            await conn.execute(
                f"""
                INSERT INTO trending_posts (
                    post_id, url, category, subcategory, rank_in_category,
                    author_handle, author_name, author_avatar, author_verified, text, posted_at, media_urls,
                    likes, retweets, replies, views, story_id, source, first_seen_at, last_seen_at, capture_count
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, {_PG_NOW}, {_PG_NOW}, 1
                )
                ON CONFLICT(post_id) DO UPDATE SET
                    url = excluded.url,
                    category = excluded.category,
                    subcategory = excluded.subcategory,
                    rank_in_category = excluded.rank_in_category,
                    author_handle = excluded.author_handle,
                    author_name = excluded.author_name,
                    author_avatar = COALESCE(excluded.author_avatar, trending_posts.author_avatar),
                    author_verified = excluded.author_verified,
                    text = excluded.text,
                    posted_at = COALESCE(excluded.posted_at, trending_posts.posted_at),
                    media_urls = excluded.media_urls,
                    likes = excluded.likes,
                    retweets = excluded.retweets,
                    replies = excluded.replies,
                    views = excluded.views,
                    story_id = COALESCE(trending_posts.story_id, excluded.story_id),
                    last_seen_at = {_PG_NOW},
                    capture_count = trending_posts.capture_count + 1
                """,
                (
                    post_id,
                    str(payload["url"]),
                    category,
                    payload.get("subcategory"),
                    int(payload.get("rank_in_category") or 0),
                    str(payload["author_handle"]),
                    payload.get("author_name"),
                    payload.get("author_avatar"),
                    1 if payload.get("author_verified") else 0,
                    str(payload["text"]),
                    payload.get("posted_at"),
                    json.dumps(payload.get("media_urls") or []),
                    int(payload.get("likes") or 0),
                    int(payload.get("retweets") or 0),
                    int(payload.get("replies") or 0),
                    int(payload.get("views") or 0),
                    payload.get("story_id"),
                    source,
                ),
            )
            return inserted

    async def get_story_by_exact_headline(self, headline: str, topic_category: str) -> str | None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT story_id FROM trending_stories
                WHERE lower(trim(topic_category)) = lower(trim(%s))
                  AND lower(trim(headline)) = lower(trim(%s))
                ORDER BY last_seen_at DESC
                LIMIT 1
                """,
                (topic_category, headline),
            )
            row = await cur.fetchone()
        return str(row["story_id"]) if row else None

    async def get_story_by_x_trend_id(self, x_trend_id: str | None) -> dict[str, Any] | None:
        key = str(x_trend_id or "").strip()
        if not key:
            return None
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT story_id, headline FROM trending_stories
                WHERE x_trend_id = %s
                ORDER BY last_seen_at DESC
                LIMIT 1
                """,
                (key,),
            )
            row = await cur.fetchone()
        return _row_dict(row) if row else None

    async def get_recent_stories_by_category(
        self, topic_category: str, since_hours: int = 72
    ) -> list[dict[str, Any]]:
        """return lightweight story rows (story_id, headline) for fuzzy dedup."""
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                f"""
                SELECT story_id, headline FROM trending_stories
                WHERE topic_category = %s
                  AND last_seen_at >= to_char(
                    now() AT TIME ZONE 'UTC' - make_interval(hours => %s),
                    'YYYY-MM-DD HH24:MI:SS'
                  )
                ORDER BY last_seen_at DESC
                """,
                (topic_category, since_hours),
            )
            rows = await cur.fetchall()
        return [{"story_id": r["story_id"], "headline": r["headline"]} for r in rows]

    async def get_recent_stories(self, since_hours: int = 72) -> list[dict[str, Any]]:
        """recent story rows across every category — lets fuzzy dedup catch the
        same event filed under a different trending category."""
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                f"""
                SELECT story_id, headline, topic_category FROM trending_stories
                WHERE last_seen_at >= to_char(
                  now() AT TIME ZONE 'UTC' - make_interval(hours => %s),
                  'YYYY-MM-DD HH24:MI:SS'
                )
                ORDER BY last_seen_at DESC
                """,
                (since_hours,),
            )
            rows = await cur.fetchall()
        return [
            {
                "story_id": r["story_id"],
                "headline": r["headline"],
                "topic_category": r["topic_category"],
            }
            for r in rows
        ]

    async def insert_story_alias(
        self,
        *,
        story_id: str,
        headline: str,
        x_trend_id: str | None,
        method: str,
        lexical_score: float | None,
        cosine_score: float | None,
        capture_id: str | None,
    ) -> None:
        if not str(headline or "").strip():
            return
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                """
                INSERT INTO trending_story_aliases (
                    story_id, headline, x_trend_id, method, lexical_score,
                    cosine_score, capture_id
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (story_id, headline) DO NOTHING
                """,
                (
                    story_id,
                    headline,
                    x_trend_id,
                    method,
                    lexical_score,
                    cosine_score,
                    capture_id,
                ),
            )

    async def get_story_aliases(self, story_id: str) -> list[dict[str, Any]]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT
                    id, story_id, headline, x_trend_id, method,
                    lexical_score, cosine_score, capture_id, seen_at
                FROM trending_story_aliases
                WHERE story_id = %s
                ORDER BY seen_at ASC
                """,
                (story_id,),
            )
            return [_row_dict(row) for row in await cur.fetchall()]

    async def ingest_trending_story(self, payload: dict[str, Any]) -> bool:
        """upsert a trending story. returns True when the row was newly inserted."""
        story_id = str(payload["story_id"])
        topic_category = str(payload["topic_category"])
        source = str(payload.get("source") or "global_trending_scrape")
        incoming_categories = payload.get("topic_categories")
        if isinstance(incoming_categories, str):
            incoming_categories = _loads_json_list(incoming_categories)
        elif not isinstance(incoming_categories, list):
            incoming_categories = []
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT topic_categories FROM trending_stories WHERE story_id = %s",
                (story_id,),
            )
            existing_row = await cur.fetchone()
            inserted = existing_row is None
            existing_categories = (
                _loads_json_list(existing_row["topic_categories"]) if existing_row else []
            )
            merged_categories = _merge_topic_categories(
                existing_categories,
                incoming_categories,
            )
            merged_categories_json = json.dumps(merged_categories)

            await conn.execute(
                f"""
                INSERT INTO trending_stories (
                    story_id, headline, topic_category, topic_categories,
                    post_count, post_count_raw,
                    recency_label, approx_started_at, rank_in_feed, summary, last_updated_at,
                    x_trend_id, source_url, source,
                    first_seen_at, last_seen_at, capture_count
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, {_PG_NOW}, {_PG_NOW}, 1
                )
                ON CONFLICT(story_id) DO UPDATE SET
                    headline = excluded.headline,
                    topic_category = excluded.topic_category,
                    topic_categories = excluded.topic_categories,
                    post_count = excluded.post_count,
                    post_count_raw = excluded.post_count_raw,
                    recency_label = excluded.recency_label,
                    approx_started_at = COALESCE(excluded.approx_started_at, trending_stories.approx_started_at),
                    rank_in_feed = excluded.rank_in_feed,
                    summary = COALESCE(excluded.summary, trending_stories.summary),
                    last_updated_at = COALESCE(excluded.last_updated_at, trending_stories.last_updated_at),
                    x_trend_id = COALESCE(excluded.x_trend_id, trending_stories.x_trend_id),
                    source_url = COALESCE(excluded.source_url, trending_stories.source_url),
                    last_seen_at = {_PG_NOW},
                    capture_count = trending_stories.capture_count + 1
                """,
                (
                    story_id,
                    str(payload["headline"]),
                    topic_category,
                    merged_categories_json,
                    int(payload.get("post_count") or 0),
                    payload.get("post_count_raw"),
                    str(payload["recency_label"]),
                    payload.get("approx_started_at"),
                    int(payload.get("rank_in_feed") or 0),
                    payload.get("summary"),
                    payload.get("last_updated_at"),
                    payload.get("x_trend_id"),
                    payload.get("source_url"),
                    source,
                ),
            )
            return inserted

    async def list_stories_for_embedding(self) -> list[dict[str, Any]]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT story_id, headline, topic_category, topic_categories, summary,
                       story_embedding_input, story_embedding_vector,
                       story_embedding_model, story_embedding_version,
                       story_embedding_updated_at
                FROM trending_stories
                ORDER BY last_seen_at DESC
                """
            )
            return [_row_dict(row) for row in await cur.fetchall()]

    async def get_story_for_embedding(self, story_id: str) -> dict[str, Any] | None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT story_id, headline, topic_category, topic_categories, summary,
                       story_embedding_input, story_embedding_vector,
                       story_embedding_model, story_embedding_version,
                       story_embedding_updated_at
                FROM trending_stories
                WHERE story_id = %s
                """,
                (story_id,),
            )
            row = await cur.fetchone()
            return _row_dict(row) if row else None

    async def store_story_embedding(
        self,
        story_id: str,
        *,
        input_text: str,
        vector: list[float],
        model: str,
        version: str,
    ) -> None:
        pool = self._require_pool()
        now = time.time()
        async with pool.connection() as conn:
            await conn.execute(
                """
                UPDATE trending_stories SET
                    story_embedding_input = %s,
                    story_embedding_vector = %s,
                    story_embedding_model = %s,
                    story_embedding_version = %s,
                    story_embedding_updated_at = %s
                WHERE story_id = %s
                """,
                (input_text, vector, model, version, now, story_id),
            )

    async def list_story_embeddings(self) -> list[dict[str, Any]]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT story_id, story_embedding_vector, story_embedding_model,
                       story_embedding_version
                FROM trending_stories
                WHERE story_embedding_vector IS NOT NULL
                """
            )
            return [_row_dict(row) for row in await cur.fetchall()]

    async def record_audience_story_sighting(
        self,
        *,
        audience_id: str,
        story_id: str,
        rank_in_feed: int | None = None,
        audience_member_id: str | None = None,
        seen_at: str | None = None,
    ) -> None:
        """upsert which audience persona saw which story. latest snapshot per
        (audience, story); first_seen_at is preserved across sightings."""
        seen_text = normalize_utc_text(seen_at)
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                f"""
                INSERT INTO audience_story_sightings (
                    audience_id, story_id, first_seen_at, last_seen_at,
                    rank_in_feed, audience_member_id
                ) VALUES (
                    %s, %s, %s, %s, %s, %s
                )
                ON CONFLICT(audience_id, story_id) DO UPDATE SET
                    last_seen_at = COALESCE(excluded.last_seen_at, {_PG_NOW}),
                    rank_in_feed = excluded.rank_in_feed,
                    audience_member_id = excluded.audience_member_id
                """,
                (
                    audience_id,
                    story_id,
                    seen_text,
                    seen_text,
                    rank_in_feed,
                    audience_member_id,
                ),
            )

    async def list_trending_stories(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        topic_category: str | None = None,
        since_hours: int | None = None,
        until_hours: int | None = None,
    ) -> list[dict[str, Any]]:
        pool = self._require_pool()
        clauses: list[str] = []
        params: list[Any] = []
        if topic_category:
            clauses.append("topic_category = %s")
            params.append(topic_category)
        if since_hours is not None:
            clauses.append(
                "last_seen_at >= to_char("
                "now() AT TIME ZONE 'UTC' - make_interval(hours => %s), "
                "'YYYY-MM-DD HH24:MI:SS')"
            )
            params.append(since_hours)
        if until_hours is not None and until_hours > 0:
            clauses.append(
                "last_seen_at < to_char("
                "now() AT TIME ZONE 'UTC' - make_interval(hours => %s), "
                "'YYYY-MM-DD HH24:MI:SS')"
            )
            params.append(until_hours)
        where_sql = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        async with pool.connection() as conn:
            cur = await conn.execute(
                f"""
                SELECT
                    story_id,
                    headline,
                    topic_category,
                    topic_categories,
                    post_count,
                    post_count_raw,
                    recency_label,
                    approx_started_at,
                    rank_in_feed,
                    summary,
                    last_updated_at,
                    x_trend_id,
                    source_url,
                    source,
                    first_seen_at,
                    last_seen_at,
                    capture_count
                FROM trending_stories
                {where_sql}
                ORDER BY last_seen_at DESC
                LIMIT %s
                OFFSET %s
                """,
                (*params, limit, offset),
            )
            return [_row_dict(row) for row in await cur.fetchall()]

    async def list_top_post_views_for_stories(self, story_ids: list[str]) -> dict[str, int]:
        ids = [str(story_id or "").strip() for story_id in story_ids if str(story_id or "").strip()]
        if not ids:
            return {}
        placeholders = ",".join("%s" for _ in ids)
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                f"""
                SELECT story_id, COALESCE(SUM(views), 0) AS top_post_views
                FROM trending_posts
                WHERE story_id IN ({placeholders})
                GROUP BY story_id
                """,
                ids,
            )
            rows = await cur.fetchall()
        return {str(row["story_id"]): int(row["top_post_views"]) for row in rows}

    async def get_trending_story(self, story_id: str) -> dict[str, Any] | None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT
                    story_id,
                    headline,
                    topic_category,
                    topic_categories,
                    post_count,
                    post_count_raw,
                    recency_label,
                    approx_started_at,
                    rank_in_feed,
                    summary,
                    last_updated_at,
                    x_trend_id,
                    source_url,
                    source,
                    first_seen_at,
                    last_seen_at,
                    capture_count
                FROM trending_stories
                WHERE story_id = %s
                """,
                (story_id,),
            )
            row = await cur.fetchone()
            return _row_dict(row) if row else None

    async def list_trending_posts_for_story(
        self, story_id: str, *, limit: int = 25
    ) -> list[dict[str, Any]]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT
                    post_id,
                    url,
                    category,
                    subcategory,
                    rank_in_category,
                    author_handle,
                    author_name,
                    author_avatar,
                    author_verified,
                    text,
                    posted_at,
                    media_urls,
                    likes,
                    retweets,
                    replies,
                    views,
                    story_id,
                    source,
                    first_seen_at,
                    last_seen_at,
                    capture_count
                FROM trending_posts
                WHERE story_id = %s
                ORDER BY last_seen_at DESC
                LIMIT %s
                """,
                (story_id, limit),
            )
            rows = await cur.fetchall()
            out: list[dict[str, Any]] = []
            for row in rows:
                item = _row_dict(row)
                item["author_verified"] = bool(item["author_verified"])
                item["media_urls"] = _loads_json_list(item["media_urls"])
                out.append(item)
            return out

    async def list_trending_posts_for_stories(
        self,
        story_ids: list[str],
        *,
        per_story_limit: int = 2,
    ) -> dict[str, list[dict[str, Any]]]:
        ids = [str(story_id or "").strip() for story_id in story_ids if str(story_id or "").strip()]
        if not ids or per_story_limit <= 0:
            return {}
        placeholders = ",".join("%s" for _ in ids)
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                f"""
                SELECT
                    post_id,
                    url,
                    category,
                    subcategory,
                    rank_in_category,
                    author_handle,
                    author_name,
                    author_avatar,
                    author_verified,
                    text,
                    posted_at,
                    media_urls,
                    likes,
                    retweets,
                    replies,
                    views,
                    story_id,
                    source,
                    first_seen_at,
                    last_seen_at,
                    capture_count
                FROM (
                    SELECT
                        tp.*,
                        ROW_NUMBER() OVER (
                            PARTITION BY tp.story_id
                            ORDER BY COALESCE(tp.views, 0) DESC, tp.last_seen_at DESC
                        ) AS rn
                    FROM trending_posts tp
                    WHERE tp.story_id IN ({placeholders})
                ) ranked
                WHERE rn <= %s
                ORDER BY story_id ASC, rn ASC
                """,
                (*ids, per_story_limit),
            )
            rows = await cur.fetchall()
        out: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            item = _row_dict(row)
            item.pop("rn", None)
            item["author_verified"] = bool(item["author_verified"])
            item["media_urls"] = _loads_json_list(item["media_urls"])
            story_id = str(item.get("story_id") or "")
            if not story_id:
                continue
            out.setdefault(story_id, []).append(item)
        return out

    async def list_audience_story_sightings(self, audience_ids: list[str]) -> list[dict[str, Any]]:
        """raw (audience, story) sightings joined to story content for the given
        audiences. one row per (audience, story); caller aggregates by story."""
        ids = [str(a) for a in audience_ids if str(a or "").strip()]
        if not ids:
            return []
        placeholders = ",".join("%s" for _ in ids)
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                f"""
                WITH sighting_stories AS (
                    SELECT DISTINCT sight.story_id
                    FROM audience_story_sightings sight
                    WHERE sight.audience_id IN ({placeholders})
                ),
                story_views AS (
                    SELECT tp.story_id, COALESCE(SUM(tp.views), 0) AS top_post_views
                    FROM trending_posts tp
                    INNER JOIN sighting_stories ss ON ss.story_id = tp.story_id
                    GROUP BY tp.story_id
                )
                SELECT
                    s.story_id, s.headline, s.topic_category, s.topic_categories, s.post_count,
                    s.post_count_raw, s.summary, s.last_updated_at, s.last_seen_at AS story_last_seen_at,
                    s.x_trend_id, s.source_url,
                    COALESCE(sv.top_post_views, 0) AS top_post_views,
                    sight.audience_id, sight.rank_in_feed, sight.last_seen_at,
                    m.handle AS member_handle,
                    m.profile_image_s3_key AS member_profile_image_s3_key
                FROM audience_story_sightings sight
                JOIN trending_stories s ON s.story_id = sight.story_id
                LEFT JOIN story_views sv ON sv.story_id = s.story_id
                LEFT JOIN audience_members m ON m.audience_id = sight.audience_id
                WHERE sight.audience_id IN ({placeholders})
                ORDER BY s.post_count DESC, sight.last_seen_at DESC
                """,
                (*ids, *ids),
            )
            rows = await cur.fetchall()
        return [_row_dict(r) for r in rows]

    async def list_story_audience_sightings(self, story_id: str) -> list[dict[str, Any]]:
        """reverse lookup: which audiences saw a given story, newest first."""
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT
                    sight.audience_id, a.title, sight.rank_in_feed, sight.last_seen_at,
                    m.handle AS member_handle,
                    m.profile_image_s3_key AS member_profile_image_s3_key
                FROM audience_story_sightings sight
                JOIN audiences a ON a.id = sight.audience_id
                LEFT JOIN audience_members m ON m.audience_id = sight.audience_id
                WHERE sight.story_id = %s
                ORDER BY sight.last_seen_at DESC
                """,
                (story_id,),
            )
            rows = await cur.fetchall()
        return [_row_dict(r) for r in rows]

    async def list_story_audience_sightings_for_stories(
        self, story_ids: list[str]
    ) -> dict[str, list[dict[str, Any]]]:
        ids = [str(story_id or "").strip() for story_id in story_ids if str(story_id or "").strip()]
        if not ids:
            return {}
        placeholders = ",".join("%s" for _ in ids)
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                f"""
                SELECT
                    sight.story_id, sight.audience_id, a.title,
                    sight.rank_in_feed, sight.last_seen_at,
                    m.handle AS member_handle,
                    m.profile_image_s3_key AS member_profile_image_s3_key
                FROM audience_story_sightings sight
                JOIN audiences a ON a.id = sight.audience_id
                LEFT JOIN audience_members m ON m.audience_id = sight.audience_id
                WHERE sight.story_id IN ({placeholders})
                ORDER BY sight.last_seen_at DESC
                """,
                ids,
            )
            rows = await cur.fetchall()
        out: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            story_id = str(row["story_id"])
            out.setdefault(story_id, []).append(
                {
                    "audience_id": row["audience_id"],
                    "title": row["title"],
                    "rank_in_feed": row["rank_in_feed"],
                    "last_seen_at": row["last_seen_at"],
                    "member_handle": row["member_handle"],
                    "member_profile_image_s3_key": row["member_profile_image_s3_key"],
                }
            )
        return out

    async def list_recent_stories_for_audience(
        self, audience_id: str, *, limit: int = 5
    ) -> list[dict[str, Any]]:
        """latest stories seen by one audience persona."""
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT
                    s.story_id,
                    s.headline,
                    s.topic_category,
                    s.summary,
                    s.post_count,
                    s.last_updated_at,
                    s.last_seen_at AS story_last_seen_at,
                    sight.last_seen_at,
                    sight.rank_in_feed
                FROM audience_story_sightings sight
                JOIN trending_stories s ON s.story_id = sight.story_id
                WHERE sight.audience_id = %s
                ORDER BY sight.last_seen_at DESC
                LIMIT %s
                """,
                (audience_id, limit),
            )
            rows = await cur.fetchall()
        return [_row_dict(r) for r in rows]

    async def get_brand_story_scores(
        self, brand_id: str, story_ids: list[str]
    ) -> dict[str, dict[str, Any]]:
        """returns {story_id: {score, model, computed_at}} for the supplied pairs."""
        ids = [str(s) for s in story_ids if str(s or "").strip()]
        if not ids:
            return {}
        placeholders = ",".join("%s" for _ in ids)
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                f"""
                SELECT story_id, score, method, model, computed_at
                FROM brand_story_scores
                WHERE brand_id = %s AND story_id IN ({placeholders})
                """,
                [brand_id, *ids],
            )
            rows = await cur.fetchall()
        return {
            str(r["story_id"]): {
                "score": float(r["score"]),
                "method": r["method"],
                "model": r["model"],
                "computed_at": float(r["computed_at"]),
            }
            for r in rows
        }

    async def list_brand_scores_for_story(self, story_id: str) -> list[dict[str, Any]]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT
                    s.brand_id,
                    COALESCE(
                        NULLIF(TRIM(c.business_name), ''),
                        NULLIF(TRIM(syn.website_synthesis_business_name), ''),
                        c.website_url,
                        s.brand_id
                    ) AS brand_name,
                    c.website_url,
                    s.score,
                    s.method,
                    s.model,
                    s.computed_at
                FROM brand_story_scores s
                LEFT JOIN companies c ON c.id = s.brand_id
                LEFT JOIN company_synthesis syn ON syn.company_id = c.id
                WHERE s.story_id = %s
                ORDER BY s.score DESC, brand_name ASC
                """,
                (story_id,),
            )
            rows = await cur.fetchall()
        return [
            {
                "brand_id": str(row["brand_id"] or ""),
                "brand_name": str(row["brand_name"] or "").strip(),
                "website_url": str(row["website_url"] or "").strip() or None,
                "score": float(row["score"]),
                "method": str(row["method"] or "").strip(),
                "model": str(row["model"] or "").strip(),
                "computed_at": float(row["computed_at"])
                if row["computed_at"] is not None
                else None,
            }
            for row in rows
        ]

    async def upsert_brand_story_score(
        self,
        brand_id: str,
        story_id: str,
        *,
        score: float,
        model: str,
        method: str = "embedding_cosine",
    ) -> None:
        pool = self._require_pool()
        now = time.time()
        async with pool.connection() as conn:
            await conn.execute(
                """
                INSERT INTO brand_story_scores (brand_id, story_id, score, method, model, computed_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT(brand_id, story_id) DO UPDATE SET
                    score = excluded.score,
                    method = excluded.method,
                    model = excluded.model,
                    computed_at = excluded.computed_at
                """,
                (brand_id, story_id, float(score), method, model, now),
            )

    async def upsert_brand_story_scores_bulk(
        self,
        rows: list[dict[str, Any]],
        *,
        method: str = "embedding_cosine",
        model: str,
    ) -> None:
        if not rows:
            return
        now = time.time()
        pool = self._require_pool()
        async with pool.connection() as conn, conn.cursor() as cur:
            await cur.executemany(
                """
                INSERT INTO brand_story_scores (brand_id, story_id, score, method, model, computed_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT(brand_id, story_id) DO UPDATE SET
                    score = excluded.score,
                    method = excluded.method,
                    model = excluded.model,
                    computed_at = excluded.computed_at
                """,
                [
                    (
                        str(row["brand_id"]),
                        str(row["story_id"]),
                        float(row["score"]),
                        method,
                        model,
                        now,
                    )
                    for row in rows
                ],
            )

    async def clear_brand_story_scores(self) -> None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute("DELETE FROM brand_story_scores")
