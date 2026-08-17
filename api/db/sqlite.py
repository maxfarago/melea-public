"""sqlite persistence facade.

postgres is the store. sqlite still opens on init as leftover scaffold
from the sqlite→pg cutover; domain mixins require DATABASE_URL.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from contextlib import asynccontextmanager
from typing import Any

import aiosqlite
from pgvector.psycopg import register_vector_async
from psycopg import AsyncConnection, rows
from psycopg_pool import AsyncConnectionPool

from api.db.audiences import Audience as Audience, AudienceMixin
from api.db.common import _loads_json_dict
from api.db.companies import Company as Company, CompanyMixin
from api.db.migrations import MigrationsMixin
from api.db.sitmar import SituationalCampaign as SituationalCampaign, SitmarMixin
from api.db.stories import StoriesMixin
from api.db.stripe import StripeMixin
from api.db.users import UserMixin
from commons.config import settings


_SQLITE_TIMEOUT_SECONDS = 30.0
_SQLITE_BUSY_TIMEOUT_MS = 30_000


async def _configure_pg_connection(conn: AsyncConnection) -> None:
    await conn.set_autocommit(True)
    conn.row_factory = rows.dict_row
    await register_vector_async(conn)


_SCHEMA = """
CREATE TABLE IF NOT EXISTS posts (
    id                   TEXT PRIMARY KEY,
    tweet_id             TEXT NOT NULL UNIQUE,
    author_handle        TEXT NOT NULL DEFAULT '',
    author_name          TEXT,
    author_uid           TEXT,
    author_avatar        TEXT,
    author_followers     INTEGER,
    tweet_text           TEXT NOT NULL DEFAULT '',
    tweet_type           TEXT NOT NULL DEFAULT 'tweet',
    quoted_tweet_id      TEXT,
    quoted_author_handle TEXT,
    quoted_author_name   TEXT,
    quoted_author_avatar TEXT,
    quoted_text          TEXT,
    quoted_media_urls    TEXT,
    media_urls           TEXT,
    gmgn_raw             TEXT,
    ingested_at          REAL NOT NULL,
    summarized_at        REAL,
    summary_topics       TEXT,
    summary_sentiment    TEXT,
    summary_text         TEXT,
    company_id           TEXT,
    source               TEXT NOT NULL DEFAULT 'firehose'
);

CREATE TABLE IF NOT EXISTS companies (
    id                    TEXT PRIMARY KEY,
    website_url           TEXT NOT NULL UNIQUE,
    business_name         TEXT,
    logo_url              TEXT,
    twitter_handle        TEXT,
    twitter_handle_manual INTEGER NOT NULL DEFAULT 0,
    socials_json          TEXT,
    created_at            REAL NOT NULL,
    updated_at            REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS company_stages (
    company_id TEXT NOT NULL,
    stage      TEXT NOT NULL,
    status     TEXT,
    error      TEXT,
    model      TEXT,
    updated_at REAL,
    PRIMARY KEY (company_id, stage)
);

CREATE TABLE IF NOT EXISTS company_synthesis (
    company_id                     TEXT PRIMARY KEY,
    homepage_summary               TEXT,
    website_synthesis_terms_json   TEXT,
    website_synthesis_primary_term TEXT,
    website_synthesis_selected_term TEXT,
    website_synthesis_prompt        TEXT,
    website_synthesis_model         TEXT,
    website_synthesis_source        TEXT,
    website_synthesis_business_name TEXT,
    website_synthesis_updated_at    REAL,
    brand_synthesis                 TEXT,
    brand_synthesis_model           TEXT,
    brand_synthesis_updated_at      REAL,
    brand_embedding_input           TEXT,
    brand_embedding_vector          BLOB,
    brand_embedding_model           TEXT,
    brand_embedding_version         TEXT,
    brand_embedding_updated_at      REAL
);

CREATE TABLE IF NOT EXISTS company_linkedin (
    company_id         TEXT PRIMARY KEY,
    url                TEXT,
    raw_text           TEXT,
    is_valid           INTEGER,
    validation_reason  TEXT,
    structured_json    TEXT,
    extraction_model   TEXT,
    enriched_at        REAL
);

CREATE TABLE IF NOT EXISTS company_crawl (
    company_id           TEXT PRIMARY KEY,
    meta_page_id         TEXT,
    tiktok_biz_id        TEXT,
    tiktok_adv_name      TEXT,
    tiktok_ads_scraped_at REAL
);

CREATE TABLE IF NOT EXISTS company_audiences (
    id                 TEXT PRIMARY KEY,
    company_id         TEXT NOT NULL,
    title              TEXT,
    description        TEXT,
    extra_json         TEXT,
    model              TEXT,
    generated_at       REAL,
    match_audience_id  TEXT,
    match_title        TEXT,
    match_description  TEXT,
    match_score        REAL,
    match_reason       TEXT,
    match_model        TEXT,
    match_generated_at REAL
);

CREATE INDEX IF NOT EXISTS idx_company_audiences_company ON company_audiences(company_id);

CREATE TABLE IF NOT EXISTS tiktok_ads (
    company_id         TEXT NOT NULL,
    ad_id              TEXT NOT NULL,
    advertiser_name    TEXT,
    first_shown        REAL,
    last_shown         REAL,
    estimated_audience TEXT,
    impression         INTEGER,
    s3_video_key       TEXT,
    s3_cover_key       TEXT,
    scraped_at         REAL NOT NULL,
    PRIMARY KEY (company_id, ad_id)
);

CREATE TABLE IF NOT EXISTS company_meta_ads (
    company_id                    TEXT NOT NULL,
    ad_id                         TEXT NOT NULL,
    ad_creation_time              TEXT,
    ad_delivery_start_time        TEXT,
    ad_delivery_stop_time         TEXT,
    ad_creative_body              TEXT,
    ad_creative_link_title        TEXT,
    ad_creative_link_description  TEXT,
    publisher_platforms_json      TEXT,
    page_id                       TEXT,
    page_name                     TEXT,
    fetched_at                    REAL NOT NULL,
    PRIMARY KEY (company_id, ad_id)
);

CREATE TABLE IF NOT EXISTS prompts (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    version     INTEGER NOT NULL,
    kind        TEXT NOT NULL,
    body        TEXT NOT NULL,
    notes       TEXT,
    sampling    TEXT,
    created_at  REAL NOT NULL,
    UNIQUE(name, version)
);

CREATE TABLE IF NOT EXISTS waitlist (
    id               TEXT PRIMARY KEY,
    email            TEXT NOT NULL UNIQUE COLLATE NOCASE,
    company_website  TEXT NOT NULL,
    x_handle         TEXT,
    other_contacts   TEXT,
    created_at       REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS audiences (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL,
    follows_json TEXT NOT NULL DEFAULT '[]',
    created_at   REAL NOT NULL,
    updated_at   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS situational_campaigns (
    id                    TEXT PRIMARY KEY,
    company_id            TEXT NOT NULL,
    story_id              TEXT NOT NULL,
    title                 TEXT NOT NULL,
    status                TEXT NOT NULL,
    error                 TEXT,
    brand_name            TEXT,
    brand_synthesis       TEXT,
    brand_logo_url        TEXT,
    story_title           TEXT,
    story_summary         TEXT,
    brand_audience_json   TEXT NOT NULL DEFAULT '{}',
    inhouse_audience_json TEXT NOT NULL DEFAULT '{}',
    messages_json         TEXT NOT NULL DEFAULT '[]',
    selected_seed_json    TEXT,
    user_id               TEXT,
    created_at            REAL NOT NULL,
    updated_at            REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS twitter_accounts (
    handle             TEXT PRIMARY KEY COLLATE NOCASE,
    status             TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    twitter_id         TEXT,
    name               TEXT,
    username           TEXT,
    verified           INTEGER,
    profile_image_url  TEXT,
    profile_banner_url TEXT,
    description        TEXT,
    location           TEXT,
    url                TEXT,
    expanded_url       TEXT,
    created_at         TEXT,
    followers_count    INTEGER,
    following_count    INTEGER,
    tweet_count        INTEGER,
    listed_count       INTEGER,
    raw_json           TEXT,
    looked_up_at       REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS audience_follows (
    audience_id TEXT NOT NULL,
    twitter_id  TEXT NOT NULL,
    handle      TEXT NOT NULL COLLATE NOCASE,
    reason      TEXT NOT NULL DEFAULT '',
    source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'generated')),
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL,
    PRIMARY KEY (audience_id, twitter_id)
);

-- x.com account pool; assigned rows are eligible for the news scraper.
CREATE TABLE IF NOT EXISTS audience_members (
    id             TEXT PRIMARY KEY,
    audience_id    TEXT UNIQUE,
    active         INTEGER NOT NULL DEFAULT 1,
    handle         TEXT,
    email          TEXT NOT NULL,
    city           TEXT,
    state          TEXT,
    auth_token     TEXT NOT NULL,
    ct0            TEXT NOT NULL,
    proxy_server   TEXT,
    proxy_username TEXT,
    proxy_password TEXT,
    proxy_label    TEXT,
    profile_image_s3_key TEXT,
    last_run_at    TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_ingested ON posts(ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author_source ON posts(author_handle COLLATE NOCASE, source);
CREATE INDEX IF NOT EXISTS idx_posts_company ON posts(company_id, ingested_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompts_name ON prompts(name, version DESC);
CREATE INDEX IF NOT EXISTS idx_audiences_created_at ON audiences(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_twitter_accounts_status ON twitter_accounts(status);
CREATE INDEX IF NOT EXISTS idx_audience_last_run
    ON audience_members(last_run_at)
    WHERE audience_id IS NOT NULL AND active = 1;
CREATE UNIQUE INDEX IF NOT EXISTS idx_twitter_accounts_twitter_id_active
    ON twitter_accounts(twitter_id)
    WHERE twitter_id IS NOT NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_audience_follows_audience ON audience_follows(audience_id);
CREATE INDEX IF NOT EXISTS idx_audience_follows_twitter_id ON audience_follows(twitter_id);
CREATE INDEX IF NOT EXISTS idx_audience_follows_handle ON audience_follows(handle COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS trending_posts (
    post_id           TEXT PRIMARY KEY,
    url               TEXT NOT NULL,
    category          TEXT NOT NULL,
    subcategory       TEXT,
    rank_in_category  INTEGER,
    author_handle     TEXT NOT NULL,
    author_name       TEXT,
    author_avatar     TEXT,
    author_verified   INTEGER NOT NULL DEFAULT 0,
    text              TEXT NOT NULL,
    posted_at         TEXT,
    media_urls        TEXT NOT NULL DEFAULT '[]',
    likes             INTEGER NOT NULL DEFAULT 0,
    retweets          INTEGER NOT NULL DEFAULT 0,
    replies           INTEGER NOT NULL DEFAULT 0,
    views             INTEGER NOT NULL DEFAULT 0,
    story_id          TEXT,
    source            TEXT NOT NULL DEFAULT 'global_trending_scrape'
                      CHECK (source IN ('global_trending_scrape','firehose_calc')),
    first_seen_at     TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at      TEXT NOT NULL DEFAULT (datetime('now')),
    capture_count     INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_trending_category ON trending_posts(category);
CREATE INDEX IF NOT EXISTS idx_trending_last_seen ON trending_posts(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_trending_engagement ON trending_posts(likes DESC, views DESC);

CREATE TABLE IF NOT EXISTS trending_stories (
    story_id           TEXT PRIMARY KEY,
    headline           TEXT NOT NULL,
    topic_category     TEXT NOT NULL,
    post_count         INTEGER NOT NULL DEFAULT 0,
    post_count_raw     TEXT,
    recency_label      TEXT NOT NULL,
    approx_started_at  TEXT,
    rank_in_feed       INTEGER,
    summary            TEXT,
    last_updated_at    TEXT,
    x_trend_id         TEXT,
    topic_categories   TEXT,
    source_url         TEXT,
    source             TEXT NOT NULL DEFAULT 'global_trending_scrape'
                       CHECK (source IN ('global_trending_scrape','firehose_calc')),
    first_seen_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at       TEXT NOT NULL DEFAULT (datetime('now')),
    capture_count      INTEGER NOT NULL DEFAULT 1,
    story_embedding_input TEXT,
    story_embedding_vector BLOB,
    story_embedding_model TEXT,
    story_embedding_version TEXT,
    story_embedding_updated_at REAL
);

CREATE INDEX IF NOT EXISTS idx_stories_topic_category ON trending_stories(topic_category);
CREATE INDEX IF NOT EXISTS idx_stories_last_seen ON trending_stories(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_stories_post_count ON trending_stories(post_count DESC);

CREATE TABLE IF NOT EXISTS trending_story_aliases (
    id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    story_id         TEXT NOT NULL REFERENCES trending_stories(story_id),
    headline         TEXT NOT NULL,
    x_trend_id       TEXT,
    method           TEXT NOT NULL,
    lexical_score    REAL,
    cosine_score     REAL,
    capture_id       TEXT,
    seen_at          TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (story_id, headline) ON CONFLICT IGNORE
);

CREATE INDEX IF NOT EXISTS idx_aliases_story ON trending_story_aliases(story_id);

-- attribution: which audience (persona) saw which news story. one row per
-- (audience, story), upserted on each sighting. the leading PK column serves
-- the brand->stories query; the story index serves the reverse lookup.
CREATE TABLE IF NOT EXISTS audience_story_sightings (
    audience_id        TEXT NOT NULL,
    story_id           TEXT NOT NULL,
    first_seen_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at       TEXT NOT NULL DEFAULT (datetime('now')),
    rank_in_feed       INTEGER,
    audience_member_id TEXT,
    PRIMARY KEY (audience_id, story_id)
);

CREATE INDEX IF NOT EXISTS idx_sightings_story ON audience_story_sightings(story_id);

-- per (brand, story) content-relevance score. lazy-on-read; rows accumulate
-- forever (no purge), one row per pair. score is haiku's 0-1 assessment of
-- topical + strategic + tonal fit between the brand_synthesis and the story.
CREATE TABLE IF NOT EXISTS brand_story_scores (
    brand_id     TEXT NOT NULL,
    story_id     TEXT NOT NULL,
    score        REAL NOT NULL,
    method       TEXT NOT NULL DEFAULT 'embedding_cosine',
    model        TEXT NOT NULL,
    computed_at  REAL NOT NULL,
    PRIMARY KEY (brand_id, story_id)
);

CREATE INDEX IF NOT EXISTS idx_brand_story_scores_brand ON brand_story_scores(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_story_scores_story ON brand_story_scores(story_id);

"""


class CoreDatabase(
    MigrationsMixin,
    AudienceMixin,
    SitmarMixin,
    StoriesMixin,
    CompanyMixin,
    UserMixin,
    StripeMixin,
):
    _schema = _SCHEMA

    def __init__(self, db_path: str | None = None) -> None:
        self._db_path = db_path or settings.db_path
        self._lock = asyncio.Lock()
        self._conn: aiosqlite.Connection | None = None
        self._pool: AsyncConnectionPool | None = None

    async def init(self) -> None:
        self._conn = await aiosqlite.connect(
            self._db_path,
            timeout=_SQLITE_TIMEOUT_SECONDS,
        )
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute(f"PRAGMA busy_timeout={_SQLITE_BUSY_TIMEOUT_MS}")
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.executescript(_SCHEMA)
        await self._run_migrations()
        await self._conn.commit()

        pg_dsn = settings.database_url.strip()
        if pg_dsn:
            self._pool = AsyncConnectionPool(
                conninfo=pg_dsn,
                min_size=2,
                max_size=10,
                configure=_configure_pg_connection,
            )
            await self._pool.open()
            await self._check_pg_schema()

    async def _check_pg_schema(self) -> None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = 'users'
                LIMIT 1
                """
            )
            row = await cur.fetchone()
        if row is None:
            raise RuntimeError(
                'postgres schema not applied; run: psql "$DATABASE_URL" -f api/db/schema.pg.sql'
            )

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    def _require_pool(self) -> AsyncConnectionPool:
        if self._pool is None:
            raise RuntimeError(
                "DATABASE_URL is not set; postgres-backed methods are unavailable"
            )
        return self._pool

    @property
    def lock(self) -> asyncio.Lock:
        return self._lock

    def connection(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("database not initialized")
        return self._conn

    @asynccontextmanager
    async def transaction(self):
        conn = self.connection()
        async with self._lock:
            yield conn

    async def insert_waitlist_entry(
        self,
        *,
        email: str,
        company_website: str,
        x_handle: str | None,
        other_contacts: str | None,
    ) -> bool:
        normalized_email = (email or "").strip().lower()
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                INSERT INTO waitlist (
                    id, email, company_website, x_handle, other_contacts, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (email) DO NOTHING
                """,
                (
                    str(uuid.uuid4()),
                    normalized_email,
                    company_website,
                    x_handle,
                    other_contacts,
                    time.time(),
                ),
            )
            return (cur.rowcount or 0) > 0

    async def list_waitlist_entries(self) -> list[dict[str, Any]]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT
                    id,
                    email,
                    company_website,
                    x_handle,
                    other_contacts,
                    created_at
                FROM waitlist
                ORDER BY created_at DESC
                """
            )
            return [dict(row) for row in await cur.fetchall()]

    async def count_waitlist_entries(self) -> int:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute("SELECT COUNT(*) AS count FROM waitlist")
            row = await cur.fetchone()
        return int(row["count"] if row is not None else 0)


# `Database` is kept as an alias of `CoreDatabase` because the news scraper
# (`ingestion/twitter/news/scrape_news.py`) instantiates its own connection
# against a separate db_path: `Database(db_path)`. The shared singleton `db`
# is what the API uses everywhere else.
Database = CoreDatabase
db = CoreDatabase()
