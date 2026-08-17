from __future__ import annotations

import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient

from api import auth
from api.db.sqlite import db
from api.main import app
from commons.config import settings


@pytest.fixture
def client(tmp_path, monkeypatch, postgres_dsn):
    db_path = str(tmp_path / "test.db")
    monkeypatch.setattr(db, "_db_path", db_path)
    monkeypatch.setattr(settings, "db_path", db_path)
    monkeypatch.setattr(settings, "database_url", postgres_dsn)
    monkeypatch.setattr(settings, "site_access_password", "")
    with TestClient(app) as test_client:
        yield test_client


def _seed_posted_campaign(user_id: str) -> str:
    company_id = str(uuid.uuid4())

    async def setup() -> str:
        campaign = await db.create_situational_campaign(
            company_id=company_id,
            story_id="story-1",
            title="Test campaign",
            user_id=user_id,
        )
        await db.set_sitmar_stage(campaign.id, status="posted")
        return campaign.id

    return asyncio.run(setup())


@pytest.mark.postgres
def test_distribute_sent_and_skip_persist(client, monkeypatch):
    monkeypatch.setattr(auth, "verify_token", lambda token: {"sub": "user_1"})
    campaign_id = _seed_posted_campaign("user_1")
    headers = {"Authorization": "Bearer token"}

    skip = client.post(
        f"/api/sitmar/{campaign_id}/distribute-skip",
        json={"post_key": "story-1:post-a"},
        headers=headers,
    )
    assert skip.status_code == 200

    sent = client.post(
        f"/api/sitmar/{campaign_id}/distribute-sent",
        json={
            "post_key": "story-1:post-b",
            "reply": "nice thread",
            "post": {
                "id": "post-b",
                "text": "hello world",
                "author_handle": "acct",
            },
        },
        headers=headers,
    )
    assert sent.status_code == 200

    detail = client.get(f"/api/sitmar/{campaign_id}", headers=headers)
    assert detail.status_code == 200
    campaign = detail.json()["campaign"]
    assert "story-1:post-a" in campaign["distribute_dismissed"]
    assert "story-1:post-b" in campaign["distribute_dismissed"]
    assert len(campaign["distribute_sent"]) == 1
    assert campaign["distribute_sent"][0]["post_key"] == "story-1:post-b"
    assert campaign["distribute_sent"][0]["reply"] == "nice thread"
    assert campaign["distribute_sent"][0]["post"]["text"] == "hello world"


@pytest.mark.postgres
def test_distribute_requires_posted_status(client, monkeypatch):
    monkeypatch.setattr(auth, "verify_token", lambda token: {"sub": "user_2"})

    async def setup() -> str:
        company_id = str(uuid.uuid4())
        campaign = await db.create_situational_campaign(
            company_id=company_id,
            story_id="story-2",
            title="Draft campaign",
            user_id="user_2",
        )
        return campaign.id

    campaign_id = asyncio.run(setup())
    headers = {"Authorization": "Bearer token"}
    resp = client.post(
        f"/api/sitmar/{campaign_id}/distribute-skip",
        json={"post_key": "story-2:post-a"},
        headers=headers,
    )
    assert resp.status_code == 400
