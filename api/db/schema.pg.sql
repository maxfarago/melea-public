-- canonical melea schema (postgres ddl) — 001_baseline
--
-- translated from api/db/schema.sql (reconciled sqlite canonical). differences
-- from the sqlite source, all mechanical:
--   REAL                       -> double precision  (epoch floats kept as-is)
--   view-count INTEGER         -> bigint            (viral tweets exceed 2.1B)
--   embedding BLOB             -> vector(1536)       (+ hnsw cosine indexes)
--   TEXT ... COLLATE NOCASE    -> citext             (email + twitter handles)
--   DEFAULT (datetime('now'))  -> to_char(now() at utc, 'YYYY-MM-DD HH24:MI:SS')
--   DEFAULT (randomblob hex)   -> replace(gen_random_uuid()::text,'-','')
--   DEFAULT (strftime %s)      -> extract(epoch from now())::bigint
--   UNIQUE (...) ON CONFLICT   -> plain UNIQUE (conflict handling moves to inserts)
--
-- text timestamp columns (first_seen_at/last_seen_at/seen_at/created_at on the
-- trending_* + audience_* tables) stay TEXT holding sqlite's
-- 'YYYY-MM-DD HH:MM:SS' shape so existing string comparisons keep working.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid on pg<13; harmless on 13+

CREATE TABLE IF NOT EXISTS companies (
    id                    text PRIMARY KEY,
    website_url           text NOT NULL UNIQUE,
    business_name         text,
    logo_url              text,
    twitter_handle        text,
    twitter_handle_manual integer NOT NULL DEFAULT 0,
    socials_json          text,
    created_at            double precision NOT NULL,
    updated_at            double precision NOT NULL
);

CREATE TABLE IF NOT EXISTS company_stages (
    company_id text NOT NULL,
    stage      text NOT NULL,
    status     text,
    error      text,
    model      text,
    updated_at double precision,
    PRIMARY KEY (company_id, stage)
);

CREATE TABLE IF NOT EXISTS company_synthesis (
    company_id                      text PRIMARY KEY,
    homepage_summary                text,
    website_synthesis_terms_json    text,
    website_synthesis_primary_term  text,
    website_synthesis_selected_term text,
    website_synthesis_prompt        text,
    website_synthesis_model         text,
    website_synthesis_source        text,
    website_synthesis_business_name text,
    website_synthesis_updated_at    double precision,
    brand_synthesis                 text,
    brand_synthesis_model           text,
    brand_synthesis_updated_at      double precision,
    brand_embedding_input           text,
    brand_embedding_vector          vector(1536),
    brand_embedding_model           text,
    brand_embedding_version         text,
    brand_embedding_updated_at      double precision
);

CREATE TABLE IF NOT EXISTS company_linkedin (
    company_id        text PRIMARY KEY,
    url               text,
    raw_text          text,
    is_valid          integer,
    validation_reason text,
    structured_json   text,
    extraction_model  text,
    enriched_at       double precision
);

CREATE TABLE IF NOT EXISTS company_audiences (
    id                 text PRIMARY KEY,
    company_id         text NOT NULL,
    title              text,
    description        text,
    extra_json         text,
    model              text,
    generated_at       double precision,
    match_audience_id  text,
    match_title        text,
    match_description  text,
    match_score        double precision,
    match_reason       text,
    match_model        text,
    match_generated_at double precision
);

CREATE INDEX IF NOT EXISTS idx_company_audiences_company ON company_audiences(company_id);

CREATE TABLE IF NOT EXISTS prompts (
    id         text PRIMARY KEY,
    name       text NOT NULL,
    version    integer NOT NULL,
    kind       text NOT NULL,
    body       text NOT NULL,
    notes      text,
    sampling   text,
    created_at double precision NOT NULL,
    UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS waitlist (
    id              text PRIMARY KEY,
    email           citext NOT NULL UNIQUE,
    company_website text NOT NULL,
    x_handle        text,
    other_contacts  text,
    created_at      double precision NOT NULL
);

CREATE TABLE IF NOT EXISTS audiences (
    id           text PRIMARY KEY,
    title        text NOT NULL,
    description  text NOT NULL,
    created_at   double precision NOT NULL,
    updated_at   double precision NOT NULL
);

CREATE TABLE IF NOT EXISTS situational_campaigns (
    id                        text PRIMARY KEY,
    company_id                text NOT NULL,
    story_id                  text NOT NULL,
    title                     text NOT NULL,
    status                    text NOT NULL,
    error                     text,
    brand_name                text,
    brand_synthesis           text,
    brand_logo_url            text,
    story_title               text,
    story_summary             text,
    brand_audience_json       text NOT NULL DEFAULT '{}',
    inhouse_audience_json     text NOT NULL DEFAULT '{}',
    messages_json             text NOT NULL DEFAULT '[]',
    selected_seed_json        text,
    user_id                   text,
    created_at                double precision NOT NULL,
    updated_at                double precision NOT NULL,
    tweets_json               text NOT NULL DEFAULT '[]',
    post_url                  text,
    distribute_sent_json      text NOT NULL DEFAULT '[]',
    distribute_dismissed_json text NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS audience_members (
    id                   text PRIMARY KEY,
    audience_id          text UNIQUE,
    active               integer NOT NULL DEFAULT 1,
    handle               text,
    email                text NOT NULL,
    city                 text,
    state                text,
    auth_token           text NOT NULL,
    ct0                  text NOT NULL,
    proxy_server         text,
    proxy_username       text,
    proxy_password       text,
    proxy_label          text,
    profile_image_s3_key text,
    last_run_at          text,
    created_at           text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS trending_posts (
    post_id          text PRIMARY KEY,
    url              text NOT NULL,
    category         text NOT NULL,
    subcategory      text,
    rank_in_category integer,
    author_handle    text NOT NULL,
    author_name      text,
    author_avatar    text,
    author_verified  integer NOT NULL DEFAULT 0,
    text             text NOT NULL,
    posted_at        text,
    media_urls       text NOT NULL DEFAULT '[]',
    likes            integer NOT NULL DEFAULT 0,
    retweets         integer NOT NULL DEFAULT 0,
    replies          integer NOT NULL DEFAULT 0,
    views            bigint  NOT NULL DEFAULT 0,
    story_id         text,
    source           text NOT NULL DEFAULT 'global_trending_scrape'
                     CHECK (source IN ('global_trending_scrape','firehose_calc')),
    first_seen_at    text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    last_seen_at     text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    capture_count    integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS trending_stories (
    story_id                   text PRIMARY KEY,
    headline                   text NOT NULL,
    topic_category             text NOT NULL,
    post_count                 integer NOT NULL DEFAULT 0,
    post_count_raw             text,
    recency_label              text NOT NULL,
    approx_started_at          text,
    rank_in_feed               integer,
    summary                    text,
    last_updated_at            text,
    x_trend_id                 text,
    topic_categories           text,
    source_url                 text,
    source                     text NOT NULL DEFAULT 'global_trending_scrape'
                               CHECK (source IN ('global_trending_scrape','firehose_calc')),
    first_seen_at              text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    last_seen_at               text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    capture_count              integer NOT NULL DEFAULT 1,
    story_embedding_input      text,
    story_embedding_vector     vector(1536),
    story_embedding_model      text,
    story_embedding_version    text,
    story_embedding_updated_at double precision
);

CREATE TABLE IF NOT EXISTS trending_story_aliases (
    id            text PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
    story_id      text NOT NULL REFERENCES trending_stories(story_id),
    headline      text NOT NULL,
    x_trend_id    text,
    method        text NOT NULL,
    lexical_score double precision,
    cosine_score  double precision,
    capture_id    text,
    seen_at       text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    UNIQUE (story_id, headline)
);

CREATE TABLE IF NOT EXISTS audience_story_sightings (
    audience_id        text NOT NULL,
    story_id           text NOT NULL,
    first_seen_at      text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    last_seen_at       text NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
    rank_in_feed       integer,
    audience_member_id text,
    PRIMARY KEY (audience_id, story_id)
);

CREATE TABLE IF NOT EXISTS brand_story_scores (
    brand_id    text NOT NULL,
    story_id    text NOT NULL,
    score       double precision NOT NULL,
    method      text NOT NULL DEFAULT 'embedding_cosine',
    model       text NOT NULL,
    computed_at double precision NOT NULL,
    PRIMARY KEY (brand_id, story_id)
);

CREATE TABLE IF NOT EXISTS users (
    clerk_user_id          text PRIMARY KEY,
    company_id             text,
    created_at             double precision NOT NULL,
    email                  text,
    full_name              text,
    image_url              text,
    stripe_customer_id     text,
    stripe_subscription_id text,
    plan                   text,
    subscription_status    text,
    current_period_end     bigint,
    FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS processed_stripe_events (
    event_id    text PRIMARY KEY,
    type        text,
    received_at bigint DEFAULT extract(epoch FROM now())::bigint
);

CREATE INDEX IF NOT EXISTS idx_prompts_name ON prompts(name, version DESC);
CREATE INDEX IF NOT EXISTS idx_audiences_created_at ON audiences(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audience_last_run
    ON audience_members(last_run_at)
    WHERE audience_id IS NOT NULL AND active = 1;
CREATE INDEX IF NOT EXISTS idx_trending_category ON trending_posts(category);
CREATE INDEX IF NOT EXISTS idx_trending_last_seen ON trending_posts(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_trending_engagement ON trending_posts(likes DESC, views DESC);
CREATE INDEX IF NOT EXISTS idx_trending_story_id ON trending_posts(story_id);
CREATE INDEX IF NOT EXISTS idx_stories_topic_category ON trending_stories(topic_category);
CREATE INDEX IF NOT EXISTS idx_stories_last_seen ON trending_stories(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_stories_post_count ON trending_stories(post_count DESC);
CREATE INDEX IF NOT EXISTS idx_stories_x_trend_id ON trending_stories(x_trend_id);
CREATE INDEX IF NOT EXISTS idx_aliases_story ON trending_story_aliases(story_id);
CREATE INDEX IF NOT EXISTS idx_sightings_story ON audience_story_sightings(story_id);
CREATE INDEX IF NOT EXISTS idx_brand_story_scores_brand ON brand_story_scores(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_story_scores_story ON brand_story_scores(story_id);
CREATE INDEX IF NOT EXISTS idx_sitmar_user_id ON situational_campaigns(user_id);
CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id);

-- pgvector similarity indexes (vectors are L2-normalized on write, so cosine
-- ranking == inner-product ranking; cosine_ops chosen for explicitness).
CREATE INDEX IF NOT EXISTS idx_company_synthesis_brand_embedding
    ON company_synthesis USING hnsw (brand_embedding_vector vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_trending_stories_story_embedding
    ON trending_stories USING hnsw (story_embedding_vector vector_cosine_ops);
