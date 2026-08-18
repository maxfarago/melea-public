from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from api.auth import PUBLIC_USER
from api.db.sqlite import db
from api.main import app
from commons.config import settings

pytestmark = pytest.mark.postgres


@pytest.fixture
def client(tmp_path, monkeypatch, postgres_dsn):
    db_path = str(tmp_path / "test.db")
    monkeypatch.setattr(db, "_db_path", db_path)
    monkeypatch.setattr(settings, "db_path", db_path)
    monkeypatch.setattr(settings, "database_url", postgres_dsn)
    with TestClient(app) as test_client:
        yield test_client


def test_post_companies_works_without_auth(client):
    resp = client.post("/api/companies", json={"website_url": "https://example.com"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] is True
    assert body["company"]["website_url"].rstrip("/") == "https://example.com"


def test_post_companies_existing_does_not_reset_crawl(client, monkeypatch):
    first = client.post("/api/companies", json={"website_url": "https://existing.com"})
    company_id = first.json()["company"]["id"]

    async def mark_processed():
        await db.set_stage(company_id, "website_synthesis", status="done")

    asyncio.run(mark_processed())

    reset_calls: list[str] = []
    original = db.reset_company_homepage_crawl

    async def track_reset(company_id_arg: str) -> None:
        reset_calls.append(company_id_arg)
        await original(company_id_arg)

    monkeypatch.setattr(db, "reset_company_homepage_crawl", track_reset)

    second = client.post("/api/companies", json={"website_url": "https://existing.com"})
    assert second.status_code == 200
    body = second.json()
    assert body["created"] is False
    assert body["company"]["id"] == company_id
    assert body["status"] == "existing"
    assert reset_calls == []


def test_post_companies_www_and_apex_resolve_to_same_company(client):
    first = client.post("/api/companies", json={"website_url": "https://usefastlane.ai"})
    assert first.status_code == 200
    first_body = first.json()
    assert first_body["created"] is True

    second = client.post("/api/companies", json={"website_url": "https://www.usefastlane.ai/"})
    assert second.status_code == 200
    second_body = second.json()
    assert second_body["created"] is False
    assert second_body["company"]["id"] == first_body["company"]["id"]
    assert second_body["company"]["website_url"].rstrip("/") == "https://usefastlane.ai"


def test_get_companies_summary_for_ops(client):
    client.post("/api/companies", json={"website_url": "https://admin-list.com"})
    resp = client.get("/api/ops/companies")
    assert resp.status_code == 200
    companies = resp.json()["companies"]
    assert len(companies) >= 1
    row = companies[0]
    assert "stage_summary" in row
    assert "website_url" in row
    assert row["logo_url"] == "https://www.google.com/s2/favicons?domain=admin-list.com&sz=128"


def test_me_claim_attaches_public_user(client):
    created = client.post("/api/companies", json={"website_url": "https://claim.com"})
    company_id = created.json()["company"]["id"]

    resp = client.post("/api/me/claim", json={"company_id": company_id})
    assert resp.status_code == 200
    body = resp.json()
    assert body["company_id"] == company_id
    assert body["claimed"] is True

    me = client.get("/api/me")
    assert me.status_code == 200
    profile = me.json()
    assert profile["user_id"] == PUBLIC_USER
    assert profile["company_id"] == company_id

    again = client.post("/api/me/claim", json={"company_id": "other"})
    assert again.status_code == 200
    assert again.json()["company_id"] == company_id
    assert again.json()["claimed"] is False


def test_me_reset_brand_clears_public_user(client, monkeypatch):
    clear_db_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(
        "api.routes.identity.db.clear_user_company_association",
        clear_db_mock,
    )
    monkeypatch.setattr(
        "api.routes.identity.db.get_user_by_clerk_id",
        AsyncMock(
            return_value=type(
                "UserRow",
                (),
                {"company_id": "co_1", "email": None, "full_name": None, "image_url": None},
            )()
        ),
    )

    ok = client.post("/api/ops/me/reset-brand")
    assert ok.status_code == 200
    assert ok.json() == {"ok": True, "changed": True}
    clear_db_mock.assert_awaited_once_with(PUBLIC_USER)


def test_ops_user_reset_brand_clears_user_company(client):
    created = client.post("/api/companies", json={"website_url": "https://brand.com"})
    company_id = created.json()["company"]["id"]

    async def _setup_user():
        await db.upsert_user("user_target", company_id, email="target@example.com")

    asyncio.run(_setup_user())

    resp = client.post("/api/ops/users/user_target/reset-brand")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True, "changed": True}

    async def _check_user():
        row = await db.get_user_by_clerk_id("user_target")
        assert row is not None
        assert row.company_id is None
        assert row.email == "target@example.com"

    asyncio.run(_check_user())


def test_ops_user_reset_brand_not_found(client):
    resp = client.post("/api/ops/users/user_missing/reset-brand")
    assert resp.status_code == 404


def test_anon_can_read_company_by_id(client):
    created = client.post("/api/companies", json={"website_url": "https://anon-read.com"})
    company_id = created.json()["company"]["id"]

    resp = client.get(f"/api/company/{company_id}")
    assert resp.status_code == 200
    assert resp.json()["company"]["id"] == company_id


def test_get_company_stories_json_response(client):
    suffix = uuid.uuid4().hex[:8]
    created = client.post(
        "/api/companies",
        json={"website_url": f"https://stories-json-{suffix}.example"},
    )
    assert created.status_code == 200
    company_id = created.json()["company"]["id"]
    recent = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    story_id = f"story-json-{suffix}"

    async def seed() -> None:
        inhouse = await db.create_audience(title="Runners", description="desc")
        await db.set_audience_match_result(
            company_id,
            audiences=[
                {
                    "title": "Marathon fans",
                    "description": "fans",
                    "match": {
                        "audience_id": inhouse.id,
                        "title": "Runners",
                        "score": 0.9,
                    },
                }
            ],
            model="test",
        )
        await db.ingest_trending_story(
            {
                "story_id": story_id,
                "headline": "Route json headline",
                "topic_category": "Sports",
                "recency_label": "now",
                "post_count": 10,
                "rank_in_feed": 1,
            }
        )
        await db.ingest_trending_post(
            {
                "post_id": f"post-{suffix}",
                "url": "https://x.com/example/status/route",
                "category": "news",
                "author_handle": "news",
                "text": "hello",
                "views": 500_000,
                "story_id": story_id,
            }
        )
        await db.record_audience_story_sighting(
            audience_id=inhouse.id,
            story_id=story_id,
            rank_in_feed=1,
            seen_at=recent,
        )
        await db.upsert_brand_story_score(
            company_id,
            story_id,
            score=0.75,
            method="embedding_cosine",
            model="test",
        )

    asyncio.run(seed())

    resp = client.get(
        f"/api/company/{company_id}/stories",
        params={"limit": 1, "posts_per_story": 3},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["gated"] is False
    assert len(body["stories"]) == 1
    story = body["stories"][0]
    assert story["story_id"] == story_id
    assert story["posts"]
    assert story["top_post_views"] == 500_000
