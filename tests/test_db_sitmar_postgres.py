from __future__ import annotations

import asyncio
import uuid

import pytest

from api.db.sqlite import CoreDatabase
from commons.config import settings


@pytest.fixture
async def pg_db(postgres_dsn, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "database_url", postgres_dsn)
    db = CoreDatabase(str(tmp_path / "melea.db"))
    await db.init()
    yield db
    await db.close()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_create_and_get_roundtrip(pg_db):
    campaign = await pg_db.create_situational_campaign(
        company_id=f"co_{uuid.uuid4().hex}",
        story_id=f"story_{uuid.uuid4().hex}",
        title="Test campaign",
        brand_name="Ares",
        brand_synthesis="synthesis text",
        story_title="Headline",
        story_summary="Summary",
        brand_audience={"title": "Founders", "description": "startup founders"},
        inhouse_audience={"id": "aud-1", "title": "Tech"},
        status="thinking",
        user_id="user_test",
    )
    assert campaign.brand_name == "Ares"
    assert campaign.brand_audience == {"title": "Founders", "description": "startup founders"}
    assert campaign.inhouse_audience == {"id": "aud-1", "title": "Tech"}
    assert campaign.messages == []

    reread = await pg_db.get_situational_campaign(campaign.id)
    assert reread is not None
    assert reread.brand_synthesis == "synthesis text"
    assert reread.story_title == "Headline"
    assert reread.story_summary == "Summary"


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_concurrent_append_preserves_both_messages(pg_db):
    campaign = await pg_db.create_situational_campaign(
        company_id=f"co_{uuid.uuid4().hex}",
        story_id="story-1",
        title="Concurrent",
        user_id="user_concurrent",
    )
    await asyncio.gather(
        pg_db.append_sitmar_message(campaign.id, {"role": "user", "text": "first"}),
        pg_db.append_sitmar_message(campaign.id, {"role": "user", "text": "second"}),
    )
    updated = await pg_db.get_situational_campaign(campaign.id)
    assert updated is not None
    texts = [m.get("text") for m in updated.messages if m.get("role") == "user"]
    assert "first" in texts
    assert "second" in texts
    assert len(texts) == 2


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_set_sitmar_posted_and_distribute_sent(pg_db):
    campaign = await pg_db.create_situational_campaign(
        company_id=f"co_{uuid.uuid4().hex}",
        story_id="story-1",
        title="Posted",
        user_id="user_posted",
    )
    await pg_db.set_sitmar_selected_seed(
        campaign.id,
        {"title": "Seed", "blurb": "Blurb"},
    )
    await pg_db.set_sitmar_posted(
        campaign.id,
        post_url="https://x.com/acct/status/1",
        posted_tweet_index=1,
    )
    updated = await pg_db.get_situational_campaign(campaign.id)
    assert updated is not None
    assert updated.status == "posted"
    assert updated.post_url == "https://x.com/acct/status/1"
    assert updated.selected_seed is not None
    assert updated.selected_seed["posted_tweet_index"] == 1

    await pg_db.append_sitmar_distribute_sent(
        campaign.id,
        post_key="story-1:post-a",
        reply="hello",
        post={"id": "post-a", "text": "thread"},
    )
    await pg_db.append_sitmar_distribute_sent(
        campaign.id,
        post_key="story-1:post-a",
        reply="updated",
        post={"id": "post-a", "text": "thread v2"},
    )
    final = await pg_db.get_situational_campaign(campaign.id)
    assert final is not None
    assert len(final.distribute_sent) == 1
    assert final.distribute_sent[0]["reply"] == "updated"
    assert "story-1:post-a" in final.distribute_dismissed


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_count_user_posted_campaigns_quota(pg_db):
    user_id = f"user_{uuid.uuid4().hex}"
    company_id = f"co_{uuid.uuid4().hex}"
    for i in range(5):
        campaign = await pg_db.create_situational_campaign(
            company_id=company_id,
            story_id=f"story-{i}",
            title=f"Campaign {i}",
            user_id=user_id,
        )
        await pg_db.set_sitmar_selected_seed(campaign.id, {"title": "S", "blurb": "B"})
        await pg_db.set_sitmar_posted(
            campaign.id,
            post_url=f"https://x.com/acct/status/{i}",
            posted_tweet_index=0,
        )
    assert await pg_db.count_user_posted_campaigns(user_id) == 5

    draft = await pg_db.create_situational_campaign(
        company_id=company_id,
        story_id="draft",
        title="Draft",
        user_id=user_id,
        status="ready",
    )
    assert await pg_db.count_user_posted_campaigns(user_id) == 5

    await pg_db.set_sitmar_stage(draft.id, status="posted")
    assert await pg_db.count_user_posted_campaigns(user_id) == 6


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_delete_situational_campaign(pg_db):
    campaign = await pg_db.create_situational_campaign(
        company_id=f"co_{uuid.uuid4().hex}",
        story_id="story-del",
        title="Delete me",
        user_id="user_del",
    )
    assert await pg_db.delete_situational_campaign(campaign.id) is True
    assert await pg_db.delete_situational_campaign(campaign.id) is False
    assert await pg_db.get_situational_campaign(campaign.id) is None
