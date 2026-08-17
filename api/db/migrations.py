"""sqlite schema migrations."""

from __future__ import annotations

import json
import time
import uuid
from typing import Any

from api.db.common import _loads_json_list, _normalize_follow_items, _normalize_story_text


class MigrationsMixin:
    async def _run_migrations(self) -> None:
        await self._migrate_drop_jobs()
        await self._migrate_posts_add_rich_fields()
        await self._migrate_drop_profile_run_tables()
        await self._migrate_prompts_normalize_kinds()
        await self._migrate_companies_add_meta_page_id()
        await self._migrate_companies_rename_meta_search_to_website_synthesis()
        await self._migrate_companies_add_website_synthesis_columns()
        await self._migrate_companies_add_business_name()
        await self._migrate_companies_add_meta_ads_status()
        await self._migrate_companies_add_tiktok_biz_id()
        await self._migrate_companies_add_tiktok_ads_status()
        await self._migrate_companies_add_twitter_discovery_fields()
        await self._migrate_companies_add_linkedin_company_fields()
        await self._migrate_companies_add_linkedin_company_enrichment()
        await self._migrate_companies_add_audience_fields()
        await self._migrate_companies_add_homepage_crawl_status()
        await self._migrate_company_meta_ads_table()
        await self._migrate_drop_reactions_and_narratives()
        await self._migrate_audience_follows_table()
        await self._migrate_audience_members_table()
        await self._migrate_audience_members_add_proxy_fields()
        await self._migrate_audience_members_add_profile_image()
        await self._migrate_trending_posts_add_story_id()
        await self._migrate_trending_posts_add_author_avatar()
        await self._migrate_trending_stories_add_detail_fields()
        await self._migrate_trending_stories_dedupe_exact_headlines()
        await self._migrate_posts_add_engagement_fields()
        await self._migrate_companies_add_audience_trends_status()
        await self._migrate_drop_trending_capture_tables()
        await self._migrate_sitmar_chat_refactor()
        await self._migrate_companies_add_brand_synthesis()
        await self._migrate_embedding_story_scoring()
        await self._migrate_companies_add_brand_scoring()
        await self._migrate_sitmar_add_tweets()
        await self._migrate_sitmar_add_post_url()
        await self._migrate_sitmar_add_user_id()
        await self._migrate_sitmar_add_distribute_json()
        await self._migrate_trending_story_aliases()
        await self._migrate_trending_stories_x_trend_id()
        await self._migrate_decompose_companies()
        await self._migrate_users_table()
        await self._migrate_users_add_profile_fields()
        await self._migrate_users_add_stripe_fields()
        await self._migrate_users_company_id_nullable()
        await self._migrate_drop_firecrawl()

    async def _migrate_users_company_id_nullable(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(users)")
        cols = {row["name"]: row for row in await cur.fetchall()}
        if not cols:
            return
        company_col = cols.get("company_id")
        if company_col is None or not company_col["notnull"]:
            return
        await self._conn.executescript(
            """
            PRAGMA foreign_keys = OFF;
            CREATE TABLE users_new (
                clerk_user_id TEXT PRIMARY KEY,
                company_id TEXT,
                created_at REAL NOT NULL,
                email TEXT,
                full_name TEXT,
                image_url TEXT,
                stripe_customer_id TEXT,
                stripe_subscription_id TEXT,
                plan TEXT,
                subscription_status TEXT,
                current_period_end INTEGER,
                FOREIGN KEY (company_id) REFERENCES companies(id)
            );
            INSERT INTO users_new SELECT * FROM users;
            DROP TABLE users;
            ALTER TABLE users_new RENAME TO users;
            PRAGMA foreign_keys = ON;
            """
        )
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id)"
        )
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id)"
        )

    async def _migrate_users_table(self) -> None:
        await self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                clerk_user_id TEXT PRIMARY KEY,
                company_id    TEXT NOT NULL,
                created_at    REAL NOT NULL,
                FOREIGN KEY (company_id) REFERENCES companies(id)
            )
            """
        )
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id)"
        )

    async def _migrate_users_add_profile_fields(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(users)")
        existing = {row["name"] for row in await cur.fetchall()}
        if not existing:
            return
        for column in ("email", "full_name", "image_url"):
            if column not in existing:
                await self._conn.execute(f"ALTER TABLE users ADD COLUMN {column} TEXT")

    async def _migrate_users_add_stripe_fields(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(users)")
        existing = {row["name"] for row in await cur.fetchall()}
        if not existing:
            return
        for column, col_type in [
            ("stripe_customer_id", "TEXT"),
            ("stripe_subscription_id", "TEXT"),
            ("plan", "TEXT"),
            ("subscription_status", "TEXT"),
            ("current_period_end", "INTEGER"),
        ]:
            if column not in existing:
                await self._conn.execute(f"ALTER TABLE users ADD COLUMN {column} {col_type}")
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id)"
        )
        await self._conn.execute(
            """
            CREATE TABLE IF NOT EXISTS processed_stripe_events (
                event_id    TEXT PRIMARY KEY,
                type        TEXT,
                received_at INTEGER DEFAULT (strftime('%s','now'))
            )
            """
        )

    async def _migrate_drop_jobs(self) -> None:
        cur = await self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'"
        )
        if await cur.fetchone():
            await self._conn.execute("DROP TABLE jobs")

    async def _migrate_embedding_story_scoring(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        company_cols = {row["name"] for row in await cur.fetchall()}
        for col, col_type in [
            ("brand_embedding_input", "TEXT"),
            ("brand_embedding_vector", "BLOB"),
            ("brand_embedding_model", "TEXT"),
            ("brand_embedding_version", "TEXT"),
            ("brand_embedding_updated_at", "REAL"),
        ]:
            if company_cols and col not in company_cols:
                await self._conn.execute(f"ALTER TABLE companies ADD COLUMN {col} {col_type}")

        cur = await self._conn.execute("PRAGMA table_info(trending_stories)")
        story_cols = {row["name"] for row in await cur.fetchall()}
        for col, col_type in [
            ("story_embedding_input", "TEXT"),
            ("story_embedding_vector", "BLOB"),
            ("story_embedding_model", "TEXT"),
            ("story_embedding_version", "TEXT"),
            ("story_embedding_updated_at", "REAL"),
        ]:
            if story_cols and col not in story_cols:
                await self._conn.execute(
                    f"ALTER TABLE trending_stories ADD COLUMN {col} {col_type}"
                )

        cur = await self._conn.execute("PRAGMA table_info(brand_story_scores)")
        score_cols = {row["name"] for row in await cur.fetchall()}
        if score_cols and "method" not in score_cols:
            await self._conn.execute(
                "ALTER TABLE brand_story_scores ADD COLUMN method TEXT NOT NULL DEFAULT 'embedding_cosine'"
            )
            await self._conn.execute("DELETE FROM brand_story_scores")
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_brand_story_scores_story ON brand_story_scores(story_id)"
        )

    async def _migrate_posts_add_rich_fields(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(posts)")
        existing = {row["name"] for row in await cur.fetchall()}
        for col, col_type in [
            ("author_followers", "INTEGER"),
            ("author_uid", "TEXT"),
            ("author_avatar", "TEXT"),
            ("quoted_tweet_id", "TEXT"),
            ("quoted_author_handle", "TEXT"),
            ("quoted_author_name", "TEXT"),
            ("quoted_author_avatar", "TEXT"),
            ("quoted_text", "TEXT"),
            ("quoted_media_urls", "TEXT"),
            ("media_urls", "TEXT"),
        ]:
            if col not in existing:
                await self._conn.execute(f"ALTER TABLE posts ADD COLUMN {col} {col_type}")

    async def _migrate_drop_profile_run_tables(self) -> None:
        await self._conn.execute("DROP TABLE IF EXISTS profile_run_steps")
        await self._conn.execute("DROP TABLE IF EXISTS profile_runs")

    async def _migrate_prompts_normalize_kinds(self) -> None:
        await self._conn.execute(
            """
            UPDATE prompts
            SET kind = 'jina_search_query'
            WHERE kind NOT IN ('llm_system', 'jina_search_query')
            """
        )

    async def _migrate_posts_add_engagement_fields(self) -> None:
        """Per #49: persist the full GraphQL/firehose tweet payload we used to
        throw away. All columns nullable so older posts (and firehose events
        that don't carry engagement) just store NULL. Idempotent — guarded by
        PRAGMA introspection so reruns are no-ops."""
        cur = await self._conn.execute("PRAGMA table_info(posts)")
        existing = {row["name"] for row in await cur.fetchall()}
        for col, col_type in [
            # engagement
            ("like_count", "INTEGER"),
            ("retweet_count", "INTEGER"),
            ("reply_count", "INTEGER"),
            ("quote_count", "INTEGER"),
            ("bookmark_count", "INTEGER"),
            ("view_count", "INTEGER"),
            # timing + threading context
            ("posted_at", "REAL"),
            ("lang", "TEXT"),
            ("conversation_id", "TEXT"),
            ("in_reply_to_status_id", "TEXT"),
            ("in_reply_to_screen_name", "TEXT"),
            # entities — stored as JSON text since SQLite has no native arrays
            ("hashtags_json", "TEXT"),
            ("mentions_json", "TEXT"),
            ("urls_json", "TEXT"),
            ("cashtags_json", "TEXT"),
            # author extras
            ("author_verified", "INTEGER"),
            ("author_blue_verified", "INTEGER"),
            ("author_following_count", "INTEGER"),
            ("author_tweet_count", "INTEGER"),
            ("author_listed_count", "INTEGER"),
            ("author_bio", "TEXT"),
            ("author_location", "TEXT"),
            ("author_url", "TEXT"),
            ("author_created_at", "TEXT"),
        ]:
            if col not in existing:
                await self._conn.execute(f"ALTER TABLE posts ADD COLUMN {col} {col_type}")

    async def _migrate_companies_add_meta_page_id(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        existing = {row["name"] for row in await cur.fetchall()}
        if "meta_page_id" not in existing:
            await self._conn.execute("ALTER TABLE companies ADD COLUMN meta_page_id TEXT")

    async def _migrate_companies_rename_meta_search_to_website_synthesis(self) -> None:
        """rename meta_search_* columns to website_synthesis_*. the stage produces
        a full website synthesis (business name + summary + search terms), not
        just meta ad library terms; the old name was a fossil. if both names
        exist (e.g. an intermediate state from a partial migration), drop the
        old one — the rename winner is whichever exists in the current schema."""
        renames = [
            ("meta_search_terms_json", "website_synthesis_terms_json"),
            ("meta_search_primary_term", "website_synthesis_primary_term"),
            ("meta_search_selected_term", "website_synthesis_selected_term"),
            ("meta_search_status", "website_synthesis_status"),
            ("meta_search_error", "website_synthesis_error"),
            ("meta_search_prompt", "website_synthesis_prompt"),
            ("meta_search_model", "website_synthesis_model"),
            ("meta_search_source", "website_synthesis_source"),
            ("meta_search_business_name", "website_synthesis_business_name"),
            ("meta_search_business_logo_url", "website_synthesis_business_logo_url"),
            ("meta_search_updated_at", "website_synthesis_updated_at"),
        ]
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        existing = {row["name"] for row in await cur.fetchall()}
        for old, new in renames:
            if old in existing and new not in existing:
                await self._conn.execute(f"ALTER TABLE companies RENAME COLUMN {old} TO {new}")
            elif old in existing and new in existing:
                await self._conn.execute(f"ALTER TABLE companies DROP COLUMN {old}")

    async def _migrate_companies_add_website_synthesis_columns(self) -> None:
        """add website_synthesis_* columns + homepage_summary on databases that
        were created before the website synthesis stage existed and never had
        the legacy meta_search_* columns either."""
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        existing = {row["name"] for row in await cur.fetchall()}
        for col, col_type in [
            ("website_synthesis_terms_json", "TEXT"),
            ("website_synthesis_primary_term", "TEXT"),
            ("website_synthesis_selected_term", "TEXT"),
            ("website_synthesis_status", "TEXT"),
            ("website_synthesis_error", "TEXT"),
            ("website_synthesis_prompt", "TEXT"),
            ("website_synthesis_model", "TEXT"),
            ("website_synthesis_source", "TEXT"),
            ("website_synthesis_business_name", "TEXT"),
            ("website_synthesis_business_logo_url", "TEXT"),
            ("homepage_summary", "TEXT"),
            ("website_synthesis_updated_at", "REAL"),
        ]:
            if col not in existing:
                await self._conn.execute(f"ALTER TABLE companies ADD COLUMN {col} {col_type}")

    async def _migrate_companies_add_business_name(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        existing = {row["name"] for row in await cur.fetchall()}
        if "business_name" not in existing:
            await self._conn.execute("ALTER TABLE companies ADD COLUMN business_name TEXT")
        await self._conn.execute(
            """
            UPDATE companies
            SET business_name = website_synthesis_business_name
            WHERE (business_name IS NULL OR TRIM(business_name) = '')
              AND website_synthesis_business_name IS NOT NULL
              AND TRIM(website_synthesis_business_name) != ''
            """
        )

    async def _migrate_companies_add_meta_ads_status(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        existing = {row["name"] for row in await cur.fetchall()}
        for col, col_type in [
            ("meta_ads_status", "TEXT"),
            ("meta_ads_error", "TEXT"),
            ("meta_ads_updated_at", "REAL"),
        ]:
            if col not in existing:
                await self._conn.execute(f"ALTER TABLE companies ADD COLUMN {col} {col_type}")

    async def _migrate_companies_add_audience_trends_status(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        existing = {row["name"] for row in await cur.fetchall()}
        for col, col_type in [
            ("audience_trends_status", "TEXT"),
            ("audience_trends_error", "TEXT"),
            ("audience_trends_updated_at", "REAL"),
        ]:
            if col not in existing:
                await self._conn.execute(f"ALTER TABLE companies ADD COLUMN {col} {col_type}")

    async def _migrate_companies_add_tiktok_biz_id(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        existing = {row["name"] for row in await cur.fetchall()}
        if "tiktok_biz_id" not in existing:
            await self._conn.execute("ALTER TABLE companies ADD COLUMN tiktok_biz_id TEXT")

    async def _migrate_companies_add_tiktok_ads_status(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        existing = {row["name"] for row in await cur.fetchall()}
        for col, col_type in [
            ("tiktok_adv_name", "TEXT"),
            ("tiktok_ads_status", "TEXT"),
            ("tiktok_ads_error", "TEXT"),
            ("tiktok_ads_updated_at", "REAL"),
            ("tiktok_ads_scraped_at", "REAL"),
        ]:
            if col not in existing:
                await self._conn.execute(f"ALTER TABLE companies ADD COLUMN {col} {col_type}")

    async def _migrate_companies_add_twitter_discovery_fields(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        existing = {row["name"] for row in await cur.fetchall()}
        for col, col_type in [
            ("twitter_handle_manual", "INTEGER NOT NULL DEFAULT 0"),
            ("twitter_discovery_status", "TEXT"),
            ("twitter_discovery_error", "TEXT"),
        ]:
            if col not in existing:
                await self._conn.execute(f"ALTER TABLE companies ADD COLUMN {col} {col_type}")

    async def _migrate_companies_add_linkedin_company_fields(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        existing = {row["name"] for row in await cur.fetchall()}
        for col, col_type in [
            ("linkedin_company_url", "TEXT"),
            ("linkedin_company_text", "TEXT"),
            ("linkedin_company_status", "TEXT"),
            ("linkedin_company_error", "TEXT"),
            ("linkedin_company_updated_at", "REAL"),
        ]:
            if col not in existing:
                await self._conn.execute(f"ALTER TABLE companies ADD COLUMN {col} {col_type}")

    async def _migrate_companies_add_linkedin_company_enrichment(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        existing = {row["name"] for row in await cur.fetchall()}
        for col, col_type in [
            ("linkedin_company_valid", "INTEGER"),
            ("linkedin_company_validation_reason", "TEXT"),
            ("linkedin_company_structured_json", "TEXT"),
            ("linkedin_company_extraction_model", "TEXT"),
            ("linkedin_company_enriched_at", "REAL"),
        ]:
            if col not in existing:
                await self._conn.execute(f"ALTER TABLE companies ADD COLUMN {col} {col_type}")

    async def _migrate_companies_add_audience_fields(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        existing = {row["name"] for row in await cur.fetchall()}
        for col, col_type in [
            ("audience_status", "TEXT"),
            ("audience_error", "TEXT"),
            ("audience_json", "TEXT"),
            ("audience_model", "TEXT"),
            ("audience_generated_at", "REAL"),
            ("audience_match_status", "TEXT"),
            ("audience_match_error", "TEXT"),
            ("audience_match_model", "TEXT"),
            ("audience_match_generated_at", "REAL"),
        ]:
            if col not in existing:
                await self._conn.execute(f"ALTER TABLE companies ADD COLUMN {col} {col_type}")

    async def _migrate_companies_add_homepage_crawl_status(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        existing = {row["name"] for row in await cur.fetchall()}
        for col, col_type in [
            ("homepage_crawl_jina_status", "TEXT"),
            ("homepage_crawl_firecrawl_status", "TEXT"),
            ("homepage_crawl_error", "TEXT"),
            ("homepage_crawl_firecrawl_pages_json", "TEXT"),
        ]:
            if col not in existing:
                await self._conn.execute(f"ALTER TABLE companies ADD COLUMN {col} {col_type}")

    async def _migrate_company_meta_ads_table(self) -> None:
        await self._conn.execute(
            """
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
            )
            """
        )

    async def _migrate_drop_firecrawl(self) -> None:
        # firecrawl removed: drop its crawl column and stage rows
        cur = await self._conn.execute("PRAGMA table_info(company_crawl)")
        cols = {row["name"] for row in await cur.fetchall()}
        if "firecrawl_pages_json" in cols:
            await self._conn.execute(
                "ALTER TABLE company_crawl DROP COLUMN firecrawl_pages_json"
            )
        await self._conn.execute(
            "DELETE FROM company_stages WHERE stage = 'homepage_crawl_firecrawl'"
        )

    async def _migrate_drop_reactions_and_narratives(self) -> None:
        await self._conn.execute("DROP VIEW IF EXISTS narrative_paths")
        await self._conn.execute("DROP TABLE IF EXISTS reactions")
        await self._conn.execute("DROP TABLE IF EXISTS events")
        await self._conn.execute("DROP TABLE IF EXISTS threads")
        await self._conn.execute("DROP TABLE IF EXISTS arcs")

    async def _migrate_audience_follows_table(self) -> None:
        cur = await self._conn.execute(
            """
            SELECT id, follows_json
            FROM audiences
            WHERE follows_json IS NOT NULL AND follows_json != '[]'
            """
        )
        rows = await cur.fetchall()
        for row in rows:
            follows = _normalize_follow_items(_loads_json_list(row["follows_json"]))
            if not follows:
                continue
            for follow in follows:
                handle = str(follow.get("handle") or "").strip().lstrip("@")
                if not handle:
                    continue
                account_cur = await self._conn.execute(
                    """
                    SELECT handle, twitter_id
                    FROM twitter_accounts
                    WHERE handle = ? COLLATE NOCASE
                      AND status = 'active'
                      AND twitter_id IS NOT NULL
                    LIMIT 1
                    """,
                    (handle,),
                )
                account = await account_cur.fetchone()
                if account is None:
                    continue
                now = time.time()
                await self._conn.execute(
                    """
                    INSERT OR IGNORE INTO audience_follows (
                        audience_id, twitter_id, handle, reason, source,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, 'generated', ?, ?)
                    """,
                    (
                        row["id"],
                        account["twitter_id"],
                        account["handle"],
                        str(follow.get("reason") or "").strip(),
                        now,
                        now,
                    ),
                )

    async def _migrate_audience_members_table(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(audience_members)")
        existing = {row["name"] for row in await cur.fetchall()}
        if existing and "active" not in existing:
            await self._conn.execute(
                "ALTER TABLE audience_members ADD COLUMN active INTEGER NOT NULL DEFAULT 1"
            )
        await self._conn.execute("DROP INDEX IF EXISTS idx_audience_last_run")
        await self._conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_audience_last_run
            ON audience_members(last_run_at) WHERE audience_id IS NOT NULL AND active = 1
            """
        )

    async def _migrate_audience_members_add_proxy_fields(self) -> None:
        pass

    async def _migrate_audience_members_add_profile_image(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(audience_members)")
        existing = {row["name"] for row in await cur.fetchall()}
        if existing and "profile_image_s3_key" not in existing:
            await self._conn.execute(
                "ALTER TABLE audience_members ADD COLUMN profile_image_s3_key TEXT"
            )

    async def _migrate_drop_trending_capture_tables(self) -> None:
        # capture bookkeeping is gone: the only reader was dead code and the
        # global-trending scraper that used them is parked. story attribution
        # now lives in audience_story_sightings.
        await self._conn.execute("DROP TABLE IF EXISTS trending_capture_stories")
        await self._conn.execute("DROP TABLE IF EXISTS trending_capture_posts")
        await self._conn.execute("DROP TABLE IF EXISTS trending_captures")

    async def _migrate_sitmar_chat_refactor(self) -> None:
        # sitmar moved from a 3-concept batch to a chat loop. the old columns
        # (model/concept_prompt/custom_system_prompt/concepts_json) are gone and
        # campaign data is throwaway, so drop any pre-chat table and let the
        # base schema recreate the new shape. detect by the new messages_json column.
        cur = await self._conn.execute("PRAGMA table_info(situational_campaigns)")
        cols = {row["name"] for row in await cur.fetchall()}
        if cols and "messages_json" not in cols:
            await self._conn.execute("DROP TABLE IF EXISTS situational_campaigns")
            await self._conn.executescript(self._schema)

    async def _migrate_companies_add_brand_synthesis(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        existing = {row["name"] for row in await cur.fetchall()}
        for col, col_type in [
            ("brand_synthesis", "TEXT"),
            ("brand_synthesis_model", "TEXT"),
            ("brand_synthesis_status", "TEXT"),
            ("brand_synthesis_error", "TEXT"),
            ("brand_synthesis_updated_at", "REAL"),
        ]:
            if col not in existing:
                await self._conn.execute(f"ALTER TABLE companies ADD COLUMN {col} {col_type}")
        # brand_story_scores ships in _SCHEMA via CREATE TABLE IF NOT EXISTS;
        # nothing else to do for existing dbs.

    async def _migrate_companies_add_brand_scoring(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        existing = {row["name"] for row in await cur.fetchall()}
        for col, col_type in [
            ("brand_scoring_status", "TEXT"),
            ("brand_scoring_error", "TEXT"),
        ]:
            if col not in existing:
                await self._conn.execute(f"ALTER TABLE companies ADD COLUMN {col} {col_type}")

    async def _migrate_sitmar_add_tweets(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(situational_campaigns)")
        existing = {row["name"] for row in await cur.fetchall()}
        if existing and "tweets_json" not in existing:
            await self._conn.execute(
                "ALTER TABLE situational_campaigns ADD COLUMN tweets_json TEXT NOT NULL DEFAULT '[]'"
            )

    async def _migrate_sitmar_add_post_url(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(situational_campaigns)")
        existing = {row["name"] for row in await cur.fetchall()}
        if existing and "post_url" not in existing:
            await self._conn.execute("ALTER TABLE situational_campaigns ADD COLUMN post_url TEXT")

    async def _migrate_sitmar_add_user_id(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(situational_campaigns)")
        existing = {row["name"] for row in await cur.fetchall()}
        if not existing:
            return
        if "user_id" not in existing:
            await self._conn.execute("ALTER TABLE situational_campaigns ADD COLUMN user_id TEXT")
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sitmar_user_id ON situational_campaigns(user_id)"
        )

    async def _migrate_sitmar_add_distribute_json(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(situational_campaigns)")
        existing = {row["name"] for row in await cur.fetchall()}
        if not existing:
            return
        for col in ("distribute_sent_json", "distribute_dismissed_json"):
            if col not in existing:
                await self._conn.execute(
                    f"ALTER TABLE situational_campaigns ADD COLUMN {col} TEXT NOT NULL DEFAULT '[]'"
                )

    async def _migrate_trending_posts_add_story_id(self) -> None:
        cur = await self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='trending_posts'"
        )
        if await cur.fetchone() is None:
            return
        cur = await self._conn.execute("PRAGMA table_info(trending_posts)")
        existing = {row["name"] for row in await cur.fetchall()}
        if "story_id" not in existing:
            await self._conn.execute("ALTER TABLE trending_posts ADD COLUMN story_id TEXT")
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_trending_story_id ON trending_posts(story_id)"
        )

    async def _migrate_trending_posts_add_author_avatar(self) -> None:
        cur = await self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='trending_posts'"
        )
        if await cur.fetchone() is None:
            return
        cur = await self._conn.execute("PRAGMA table_info(trending_posts)")
        existing = {row["name"] for row in await cur.fetchall()}
        if "author_avatar" not in existing:
            await self._conn.execute("ALTER TABLE trending_posts ADD COLUMN author_avatar TEXT")

    async def _migrate_trending_stories_add_detail_fields(self) -> None:
        cur = await self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='trending_stories'"
        )
        if await cur.fetchone() is None:
            return
        cur = await self._conn.execute("PRAGMA table_info(trending_stories)")
        existing = {row["name"] for row in await cur.fetchall()}
        if "summary" not in existing:
            await self._conn.execute("ALTER TABLE trending_stories ADD COLUMN summary TEXT")
        if "last_updated_at" not in existing:
            await self._conn.execute("ALTER TABLE trending_stories ADD COLUMN last_updated_at TEXT")
        if "x_trend_id" not in existing and "news_id" not in existing:
            await self._conn.execute("ALTER TABLE trending_stories ADD COLUMN x_trend_id TEXT")
        if "source_url" not in existing:
            await self._conn.execute("ALTER TABLE trending_stories ADD COLUMN source_url TEXT")

    async def _migrate_trending_story_aliases(self) -> None:
        await self._conn.execute(
            """
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
            )
            """
        )
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_aliases_story ON trending_story_aliases(story_id)"
        )

    async def _migrate_trending_stories_x_trend_id(self) -> None:
        cur = await self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='trending_stories'"
        )
        if await cur.fetchone() is None:
            return
        cur = await self._conn.execute("PRAGMA table_info(trending_stories)")
        existing = {row["name"] for row in await cur.fetchall()}
        if "news_id" in existing and "x_trend_id" not in existing:
            await self._conn.execute(
                "ALTER TABLE trending_stories RENAME COLUMN news_id TO x_trend_id"
            )
            existing.discard("news_id")
            existing.add("x_trend_id")
        elif "x_trend_id" not in existing:
            await self._conn.execute("ALTER TABLE trending_stories ADD COLUMN x_trend_id TEXT")
        if "topic_categories" not in existing:
            await self._conn.execute(
                "ALTER TABLE trending_stories ADD COLUMN topic_categories TEXT"
            )
        await self._conn.execute("DROP INDEX IF EXISTS idx_stories_news_id")
        await self._conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_stories_x_trend_id ON trending_stories(x_trend_id)"
        )
        cur = await self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='trending_story_aliases'"
        )
        if await cur.fetchone() is None:
            return
        cur = await self._conn.execute("PRAGMA table_info(trending_story_aliases)")
        alias_cols = {row["name"] for row in await cur.fetchall()}
        if "news_id" in alias_cols and "x_trend_id" not in alias_cols:
            await self._conn.execute(
                "ALTER TABLE trending_story_aliases RENAME COLUMN news_id TO x_trend_id"
            )
        elif "x_trend_id" not in alias_cols:
            await self._conn.execute(
                "ALTER TABLE trending_story_aliases ADD COLUMN x_trend_id TEXT"
            )

    async def _migrate_trending_stories_dedupe_exact_headlines(self) -> None:
        cur = await self._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='trending_stories'"
        )
        if await cur.fetchone() is None:
            return
        cur = await self._conn.execute(
            """
            SELECT
                story_id, headline, topic_category, post_count, post_count_raw,
                recency_label, approx_started_at, rank_in_feed, summary,
                last_updated_at, first_seen_at, last_seen_at, capture_count
            FROM trending_stories
            """
        )
        groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for row in await cur.fetchall():
            item = dict(row)
            key = (
                _normalize_story_text(item["topic_category"]),
                _normalize_story_text(item["headline"]),
            )
            if key[0] and key[1]:
                groups.setdefault(key, []).append(item)

        for rows in groups.values():
            if len(rows) < 2:
                continue
            rows.sort(key=lambda r: str(r.get("last_seen_at") or ""))
            canonical = rows[-1]
            duplicate_ids = [str(r["story_id"]) for r in rows[:-1]]
            canonical_id = str(canonical["story_id"])
            capture_count = sum(int(r.get("capture_count") or 0) for r in rows)
            first_seen_at = min(
                str(r.get("first_seen_at") or "") for r in rows if r.get("first_seen_at")
            )
            last_seen_at = max(
                str(r.get("last_seen_at") or "") for r in rows if r.get("last_seen_at")
            )
            post_count_row = max(rows, key=lambda r: int(r.get("post_count") or 0))

            for duplicate_id in duplicate_ids:
                await self._conn.execute(
                    "UPDATE trending_posts SET story_id = ? WHERE story_id = ?",
                    (canonical_id, duplicate_id),
                )
                cur = await self._conn.execute(
                    """
                    SELECT
                        audience_id, first_seen_at, last_seen_at,
                        rank_in_feed, audience_member_id
                    FROM audience_story_sightings
                    WHERE story_id = ?
                    """,
                    (duplicate_id,),
                )
                for sighting in await cur.fetchall():
                    await self._conn.execute(
                        """
                        INSERT INTO audience_story_sightings (
                            audience_id, story_id, first_seen_at, last_seen_at,
                            rank_in_feed, audience_member_id
                        ) VALUES (?, ?, ?, ?, ?, ?)
                        ON CONFLICT(audience_id, story_id) DO UPDATE SET
                            first_seen_at = MIN(audience_story_sightings.first_seen_at, excluded.first_seen_at),
                            last_seen_at = MAX(audience_story_sightings.last_seen_at, excluded.last_seen_at),
                            rank_in_feed = CASE
                                WHEN excluded.last_seen_at >= audience_story_sightings.last_seen_at
                                THEN excluded.rank_in_feed
                                ELSE audience_story_sightings.rank_in_feed
                            END,
                            audience_member_id = CASE
                                WHEN excluded.last_seen_at >= audience_story_sightings.last_seen_at
                                THEN excluded.audience_member_id
                                ELSE audience_story_sightings.audience_member_id
                            END
                        """,
                        (
                            sighting["audience_id"],
                            canonical_id,
                            sighting["first_seen_at"],
                            sighting["last_seen_at"],
                            sighting["rank_in_feed"],
                            sighting["audience_member_id"],
                        ),
                    )
                await self._conn.execute(
                    "DELETE FROM audience_story_sightings WHERE story_id = ?",
                    (duplicate_id,),
                )
                await self._conn.execute(
                    "DELETE FROM trending_stories WHERE story_id = ?",
                    (duplicate_id,),
                )

            await self._conn.execute(
                """
                UPDATE trending_stories
                SET
                    post_count = ?,
                    post_count_raw = ?,
                    first_seen_at = ?,
                    last_seen_at = ?,
                    capture_count = ?
                WHERE story_id = ?
                """,
                (
                    int(post_count_row.get("post_count") or 0),
                    post_count_row.get("post_count_raw"),
                    first_seen_at,
                    last_seen_at,
                    capture_count,
                    canonical_id,
                ),
            )

    _STAGE_COLUMN_MAP: dict[str, dict[str, str | None]] = {
        "website_synthesis": {
            "status": "website_synthesis_status",
            "error": "website_synthesis_error",
            "model": "website_synthesis_model",
            "updated_at": "website_synthesis_updated_at",
        },
        "homepage_crawl_jina": {
            "status": "homepage_crawl_jina_status",
            "error": "homepage_crawl_error",
            "model": None,
            "updated_at": None,
        },
        "linkedin": {
            "status": "linkedin_company_status",
            "error": "linkedin_company_error",
            "model": "linkedin_company_extraction_model",
            "updated_at": "linkedin_company_updated_at",
        },
        "twitter_discovery": {
            "status": "twitter_discovery_status",
            "error": "twitter_discovery_error",
            "model": None,
            "updated_at": None,
        },
        "audience": {
            "status": "audience_status",
            "error": "audience_error",
            "model": "audience_model",
            "updated_at": "audience_generated_at",
        },
        "audience_match": {
            "status": "audience_match_status",
            "error": "audience_match_error",
            "model": "audience_match_model",
            "updated_at": "audience_match_generated_at",
        },
        "brand_synthesis": {
            "status": "brand_synthesis_status",
            "error": "brand_synthesis_error",
            "model": "brand_synthesis_model",
            "updated_at": "brand_synthesis_updated_at",
        },
        "brand_scoring": {
            "status": "brand_scoring_status",
            "error": "brand_scoring_error",
            "model": None,
            "updated_at": None,
        },
        "audience_trends": {
            "status": "audience_trends_status",
            "error": "audience_trends_error",
            "model": None,
            "updated_at": "audience_trends_updated_at",
        },
    }

    _COLUMNS_TO_DROP = [
        "twitter_discovery_status",
        "twitter_discovery_error",
        "meta_page_id",
        "website_synthesis_terms_json",
        "website_synthesis_primary_term",
        "website_synthesis_selected_term",
        "website_synthesis_status",
        "website_synthesis_error",
        "website_synthesis_prompt",
        "website_synthesis_model",
        "website_synthesis_source",
        "website_synthesis_business_name",
        "website_synthesis_business_logo_url",
        "homepage_summary",
        "website_synthesis_updated_at",
        "meta_ads_status",
        "meta_ads_error",
        "meta_ads_updated_at",
        "tiktok_biz_id",
        "tiktok_adv_name",
        "tiktok_ads_status",
        "tiktok_ads_error",
        "tiktok_ads_updated_at",
        "tiktok_ads_scraped_at",
        "linkedin_company_url",
        "linkedin_company_text",
        "linkedin_company_valid",
        "linkedin_company_validation_reason",
        "linkedin_company_structured_json",
        "linkedin_company_extraction_model",
        "linkedin_company_enriched_at",
        "linkedin_company_status",
        "linkedin_company_error",
        "linkedin_company_updated_at",
        "audience_status",
        "audience_error",
        "audience_json",
        "audience_model",
        "audience_generated_at",
        "audience_match_status",
        "audience_match_error",
        "audience_match_model",
        "audience_match_generated_at",
        "audience_trends_status",
        "audience_trends_error",
        "audience_trends_updated_at",
        "brand_synthesis",
        "brand_synthesis_model",
        "brand_synthesis_status",
        "brand_synthesis_error",
        "brand_synthesis_updated_at",
        "brand_scoring_status",
        "brand_scoring_error",
        "brand_embedding_input",
        "brand_embedding_vector",
        "brand_embedding_model",
        "brand_embedding_version",
        "brand_embedding_updated_at",
        "homepage_crawl_jina_status",
        "homepage_crawl_firecrawl_status",
        "homepage_crawl_error",
        "homepage_crawl_firecrawl_pages_json",
    ]

    async def _migrate_decompose_companies(self) -> None:
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        company_cols = {row["name"] for row in await cur.fetchall()}
        if "website_synthesis_status" not in company_cols:
            return

        cur = await self._conn.execute("SELECT * FROM companies")
        rows = await cur.fetchall()

        for row in rows:
            cid = row["id"]

            # company_stages
            for stage_name, col_map in self._STAGE_COLUMN_MAP.items():
                s_col = col_map["status"]
                e_col = col_map["error"]
                m_col = col_map["model"]
                u_col = col_map["updated_at"]
                await self._conn.execute(
                    """INSERT OR IGNORE INTO company_stages
                       (company_id, stage, status, error, model, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?)""",
                    (
                        cid,
                        stage_name,
                        row[s_col] if s_col else None,
                        row[e_col] if e_col else None,
                        row[m_col] if m_col else None,
                        row[u_col] if u_col else None,
                    ),
                )

            # company_synthesis
            await self._conn.execute(
                """INSERT OR IGNORE INTO company_synthesis (
                       company_id, homepage_summary,
                       website_synthesis_terms_json, website_synthesis_primary_term,
                       website_synthesis_selected_term, website_synthesis_prompt,
                       website_synthesis_model, website_synthesis_source,
                       website_synthesis_business_name, website_synthesis_updated_at,
                       brand_synthesis, brand_synthesis_model, brand_synthesis_updated_at,
                       brand_embedding_input, brand_embedding_vector,
                       brand_embedding_model, brand_embedding_version,
                       brand_embedding_updated_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    cid,
                    row["homepage_summary"],
                    row["website_synthesis_terms_json"],
                    row["website_synthesis_primary_term"],
                    row["website_synthesis_selected_term"],
                    row["website_synthesis_prompt"],
                    row["website_synthesis_model"],
                    row["website_synthesis_source"],
                    row["website_synthesis_business_name"],
                    row["website_synthesis_updated_at"],
                    row["brand_synthesis"],
                    row["brand_synthesis_model"],
                    row["brand_synthesis_updated_at"],
                    row["brand_embedding_input"],
                    row["brand_embedding_vector"],
                    row["brand_embedding_model"],
                    row["brand_embedding_version"],
                    row["brand_embedding_updated_at"],
                ),
            )

            # company_linkedin
            await self._conn.execute(
                """INSERT OR IGNORE INTO company_linkedin (
                       company_id, url, raw_text, is_valid, validation_reason,
                       structured_json, extraction_model, enriched_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    cid,
                    row["linkedin_company_url"],
                    row["linkedin_company_text"],
                    row["linkedin_company_valid"],
                    row["linkedin_company_validation_reason"],
                    row["linkedin_company_structured_json"],
                    row["linkedin_company_extraction_model"],
                    row["linkedin_company_enriched_at"],
                ),
            )

            # company_crawl (firecrawl removed; legacy pages intentionally not migrated)
            await self._conn.execute(
                """INSERT OR IGNORE INTO company_crawl (
                       company_id, meta_page_id,
                       tiktok_biz_id, tiktok_adv_name, tiktok_ads_scraped_at
                   ) VALUES (?, ?, ?, ?, ?)""",
                (
                    cid,
                    row["meta_page_id"],
                    row["tiktok_biz_id"],
                    row["tiktok_adv_name"],
                    row["tiktok_ads_scraped_at"],
                ),
            )

            # company_audiences
            audience_raw = row["audience_json"]
            audiences: list[dict[str, Any]] = []
            if audience_raw:
                try:
                    parsed = json.loads(audience_raw)
                    if isinstance(parsed, list):
                        audiences = [a for a in parsed if isinstance(a, dict)]
                except (json.JSONDecodeError, TypeError):
                    pass

            audience_model_val = row["audience_model"]
            audience_generated_at_val = row["audience_generated_at"]
            audience_match_model_val = row["audience_match_model"]
            audience_match_generated_at_val = row["audience_match_generated_at"]

            for entry in audiences:
                aid = str(uuid.uuid4())
                title = entry.get("title")
                description = entry.get("description")
                match = entry.get("match")
                extra = {
                    k: v for k, v in entry.items() if k not in ("title", "description", "match")
                }
                m_aid = m_title = m_desc = m_reason = m_model = None
                m_score: float | None = None
                m_gen_at: float | None = None
                if isinstance(match, dict):
                    m_aid = match.get("audience_id")
                    m_title = match.get("title")
                    m_desc = match.get("description")
                    m_score = match.get("score")
                    m_reason = match.get("reason")
                    m_model = audience_match_model_val
                    m_gen_at = audience_match_generated_at_val

                await self._conn.execute(
                    """INSERT INTO company_audiences (
                           id, company_id, title, description, extra_json,
                           model, generated_at,
                           match_audience_id, match_title, match_description,
                           match_score, match_reason, match_model, match_generated_at
                       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        aid,
                        cid,
                        title,
                        description,
                        json.dumps(extra, ensure_ascii=True) if extra else None,
                        audience_model_val,
                        audience_generated_at_val,
                        m_aid,
                        m_title,
                        m_desc,
                        m_score,
                        m_reason,
                        m_model,
                        m_gen_at,
                    ),
                )

        # promote logo_url
        if "logo_url" not in company_cols:
            await self._conn.execute("ALTER TABLE companies ADD COLUMN logo_url TEXT")
        await self._conn.execute(
            """UPDATE companies
               SET logo_url = website_synthesis_business_logo_url
               WHERE logo_url IS NULL
                 AND website_synthesis_business_logo_url IS NOT NULL"""
        )

        # drop old columns
        cur = await self._conn.execute("PRAGMA table_info(companies)")
        remaining = {row["name"] for row in await cur.fetchall()}
        for col in self._COLUMNS_TO_DROP:
            if col in remaining:
                await self._conn.execute(f"ALTER TABLE companies DROP COLUMN {col}")
