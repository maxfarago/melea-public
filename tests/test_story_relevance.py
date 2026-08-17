from __future__ import annotations

import json
import uuid

import pytest

from api.db.sqlite import CoreDatabase  # noqa: E402
from api.features import story_relevance  # noqa: E402
from commons.config import settings
from llm.embeddings import coerce_vector, cosine, pack_vector, unpack_vector  # noqa: E402


def test_story_relevance_document_builders():
    brand_doc = story_relevance.build_brand_embedding_input(
        {
            "business_name": "Ares",
            "brand_synthesis": "Unified terminal for prediction market traders.",
            "audience_json": json.dumps(
                [
                    {
                        "title": "Active Prediction Market Traders",
                        "description": "Experienced polymarket and kalshi traders.",
                    }
                ]
            ),
        }
    )
    story_doc = story_relevance.build_story_embedding_input(
        {
            "headline": "Kalshi volume surges",
            "topic_category": "Prediction Markets",
            "summary": "Traders move into event contracts after volatility rises.",
        }
    )

    assert "brand name: Ares" in brand_doc
    assert "brand synthesis: Unified terminal" in brand_doc
    assert "Active Prediction Market Traders" in brand_doc
    assert "headline: Kalshi volume surges" in story_doc
    assert "topic: Prediction Markets" in story_doc


def test_build_story_embedding_input_joins_topic_categories():
    story_doc = story_relevance.build_story_embedding_input(
        {
            "headline": "Kalshi volume surges",
            "topic_category": "Prediction Markets",
            "topic_categories": ["news", "Prediction Markets"],
            "summary": "Traders move into event contracts after volatility rises.",
        }
    )
    assert "topic: news, Prediction Markets" in story_doc


def test_vector_pack_and_cosine():
    left = unpack_vector(pack_vector([3.0, 4.0]))
    right = unpack_vector(pack_vector([6.0, 8.0]))
    orthogonal = unpack_vector(pack_vector([-4.0, 3.0]))

    assert cosine(left, right) == pytest.approx(1.0)
    assert cosine(left, orthogonal) == pytest.approx(0.0)


def test_coerce_vector_accepts_bytes_and_lists():
    packed = pack_vector([3.0, 4.0])
    assert coerce_vector(packed) == pytest.approx([0.6, 0.8])
    assert coerce_vector([0.6, 0.8]) == pytest.approx([0.6, 0.8])
    assert coerce_vector(None) == []


@pytest.mark.skip(reason="sqlite migration only")
@pytest.mark.asyncio
async def test_embedding_migration_clears_legacy_brand_story_scores(tmp_path):
    pass


@pytest.fixture
async def pg_db(postgres_dsn, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "database_url", postgres_dsn)
    db = CoreDatabase(str(tmp_path / "melea.db"))
    await db.init()
    yield db
    await db.close()


@pytest.mark.postgres
@pytest.mark.asyncio
async def test_embedding_backfill_scores_all_pairs(pg_db, monkeypatch):
    company = await pg_db.create_company(f"https://ares-{uuid.uuid4().hex[:8]}.example")
    company_id = company.id
    await pg_db.set_brand_synthesis_result(
        company_id,
        synthesis="Prediction market trading terminal.",
        model="test",
    )
    await pg_db.set_audience_result(
        company_id,
        audiences=[
            {
                "title": "Active Prediction Market Traders",
                "description": "Experienced polymarket and kalshi traders.",
            }
        ],
        model="test",
    )
    await pg_db.ingest_trending_story(
        {
            "story_id": "story-1",
            "headline": "Prediction market volume rises",
            "topic_category": "Prediction Markets",
            "recency_label": "now",
            "post_count": 10,
            "summary": "Kalshi and polymarket traders react to increased volatility.",
        }
    )

    async def fake_embed_texts(
        texts: list[str], *, model: str | None = None
    ) -> list[list[float]]:
        def _vec(x: float, y: float) -> list[float]:
            return [x, y] + [0.0] * 1534

        return [_vec(1.0, 0.0) if "Prediction" in text else _vec(0.0, 1.0) for text in texts]

    monkeypatch.setattr(story_relevance, "has_embedding_config", lambda: True)
    monkeypatch.setattr(story_relevance, "embed_texts_batched", fake_embed_texts)

    count = await story_relevance.backfill_all_embedding_scores(db_instance=pg_db)
    scores = await pg_db.get_brand_story_scores(company_id, ["story-1"])

    assert count == 1
    assert scores["story-1"]["method"] == "embedding_cosine"
    assert scores["story-1"]["score"] == pytest.approx(1.0)
