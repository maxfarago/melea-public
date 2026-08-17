"""Configuration loaded from environment variables (or .env file in dev)."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Auth — customer Clerk app (app.melea.ai etc.)
    clerk_publishable_key: str = ""
    clerk_secret_key: str = ""
    clerk_authorized_parties: str = ""
    clerk_webhook_secret: str = ""

    # Auth — separate ops Clerk app (ops.melea.ai). Empty publishable key
    # disables ops auth entirely — /api/ops/* endpoints will 503.
    clerk_ops_publishable_key: str = ""
    clerk_ops_secret_key: str = ""
    clerk_ops_authorized_parties: str = ""

    site_access_password: str = ""
    site_gate_cookie_secret: str = ""
    melea_company_website_url: str = "melea.ai"
    ga_measurement_id: str = ""

    # LLM providers
    anthropic_api_key: str = ""
    anthropic_admin_key: str = ""
    openai_api_key: str = ""
    xai_api_key: str = ""
    xai_admin_key: str = ""
    xai_team_id: str = ""
    embedding_model: str = "text-embedding-3-small"
    embedding_batch_size: int = 64
    embedding_concurrency: int = 4

    # AWS SQS (instance profile or env credentials); empty disables consumer
    sqs_queue_url: str = ""
    aws_region: str = "eu-central-1"

    cdn_base_url: str = ""

    # sitmar (situational marketing) campaign image storage; empty bucket = images skipped
    sitmar_images_s3_bucket: str = ""
    sitmar_image_timeout_seconds: int = 60
    audience_images_s3_bucket: str = ""

    # Jina AI (r.jina.ai reader is keyless; api key unlocks s.jina.ai search)
    jina_api_key: str = ""
    scrapingbee_api_key: str = ""
    twitter_bearer_token: str = ""

    # Stripe
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_starter: str = ""
    stripe_price_starter_monthly: str = ""
    stripe_price_starter_annual: str = ""
    stripe_price_pro: str = ""
    stripe_price_pro_monthly: str = ""
    stripe_price_pro_annual: str = ""
    stripe_link_starter_monthly: str = ""
    stripe_link_starter_annual: str = ""
    stripe_link_pro_monthly: str = ""
    stripe_link_pro_annual: str = ""

    # Persistence
    db_path: str = "./melea.db"
    database_url: str = ""

    # Timeouts and limits
    llm_timeout_seconds: int = 180
    max_image_bytes: int = 5 * 1024 * 1024  # 5 MB
    news_scan_max_results: int = 25
    news_scan_max_articles: int = 10


# Single instance imported elsewhere
settings = Settings()  # type: ignore[call-arg]
