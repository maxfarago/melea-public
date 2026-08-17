from __future__ import annotations

import json
import logging
from typing import Any

# hnsw indexes exist on the embedding columns; ranking stays cosine-in-python
# on the returned lists. in-db `<=>` was left as a later optimization.
from api.db.common import _loads_json_list
from api.db.sqlite import db
from llm.embeddings import (
    EMBEDDING_INPUT_VERSION,
    EMBEDDING_METHOD,
    coerce_vector,
    cosine,
    embed_texts_batched,
    embedding_model,
    has_embedding_config,
    normalize_vector,
)

log = logging.getLogger(__name__)


def _clean(value: object) -> str:
    return " ".join(str(value or "").split())


def _audience_entries(raw: object) -> list[dict[str, Any]]:
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return []
    else:
        parsed = raw
    if not isinstance(parsed, list):
        return []
    return [entry for entry in parsed if isinstance(entry, dict)]


def build_brand_embedding_input(company: dict[str, Any]) -> str:
    name = _clean(
        company.get("business_name")
        or company.get("website_synthesis_business_name")
        or company.get("website_url")
    )
    synthesis = _clean(company.get("brand_synthesis"))
    audiences = _audience_entries(company.get("audience_json") or company.get("audience"))
    lines = [
        f"brand name: {name}",
        f"brand synthesis: {synthesis}",
    ]
    audience_lines: list[str] = []
    for audience in audiences:
        title = _clean(audience.get("title"))
        description = _clean(audience.get("description"))
        if title or description:
            audience_lines.append(f"- {title}: {description}".strip())
    if audience_lines:
        lines.append("target audiences:")
        lines.extend(audience_lines)
    return "\n".join(line for line in lines if line.strip()).strip()


def build_story_embedding_input(story: dict[str, Any]) -> str:
    categories = story.get("topic_categories")
    if isinstance(categories, str):
        categories = _loads_json_list(categories)
    if isinstance(categories, list):
        topic = ", ".join(str(item).strip() for item in categories if str(item or "").strip())
    else:
        topic = _clean(story.get("topic_category"))
    lines = [
        f"headline: {_clean(story.get('headline'))}",
        f"topic: {topic}",
        f"summary: {_clean(story.get('summary'))}",
    ]
    return "\n".join(line for line in lines if line.strip()).strip()


def _needs_embedding(
    row: dict[str, Any],
    *,
    input_column: str,
    vector_column: str,
    model_column: str,
    version_column: str,
    input_text: str,
    model: str,
) -> bool:
    return (
        not coerce_vector(row.get(vector_column))
        or row.get(input_column) != input_text
        or row.get(model_column) != model
        or row.get(version_column) != EMBEDDING_INPUT_VERSION
    )


async def ensure_story_embeddings(
    stories: list[dict[str, Any]],
    *,
    db_instance: Any = db,
) -> dict[str, list[float]]:
    model = embedding_model()
    vectors: dict[str, list[float]] = {}
    pending: list[tuple[dict[str, Any], str]] = []
    for story in stories:
        story_id = _clean(story.get("story_id"))
        input_text = build_story_embedding_input(story)
        if not story_id or not input_text:
            continue
        if _needs_embedding(
            story,
            input_column="story_embedding_input",
            vector_column="story_embedding_vector",
            model_column="story_embedding_model",
            version_column="story_embedding_version",
            input_text=input_text,
            model=model,
        ):
            pending.append((story, input_text))
        else:
            vectors[story_id] = coerce_vector(story.get("story_embedding_vector"))

    if pending:
        embedded = await embed_texts_batched([input_text for _, input_text in pending], model=model)
        for (story, input_text), vector in zip(pending, embedded):
            story_id = _clean(story.get("story_id"))
            await db_instance.store_story_embedding(
                story_id,
                input_text=input_text,
                vector=normalize_vector(vector),
                model=model,
                version=EMBEDDING_INPUT_VERSION,
            )
            vectors[story_id] = normalize_vector(vector)
    return vectors


async def ensure_brand_embeddings(
    companies: list[dict[str, Any]],
    *,
    db_instance: Any = db,
) -> dict[str, list[float]]:
    model = embedding_model()
    vectors: dict[str, list[float]] = {}
    pending: list[tuple[dict[str, Any], str]] = []
    for company in companies:
        company_id = _clean(company.get("id"))
        input_text = build_brand_embedding_input(company)
        if not company_id or not input_text or not _clean(company.get("brand_synthesis")):
            continue
        if _needs_embedding(
            company,
            input_column="brand_embedding_input",
            vector_column="brand_embedding_vector",
            model_column="brand_embedding_model",
            version_column="brand_embedding_version",
            input_text=input_text,
            model=model,
        ):
            pending.append((company, input_text))
        else:
            vectors[company_id] = coerce_vector(company.get("brand_embedding_vector"))

    if pending:
        embedded = await embed_texts_batched([input_text for _, input_text in pending], model=model)
        for (company, input_text), vector in zip(pending, embedded):
            company_id = _clean(company.get("id"))
            await db_instance.store_company_embedding(
                company_id,
                input_text=input_text,
                vector=vector,
                model=model,
                version=EMBEDDING_INPUT_VERSION,
            )
            vectors[company_id] = normalize_vector(vector)
    return vectors


async def score_story_against_all_brands(
    story_id: str,
    *,
    db_instance: Any = db,
) -> None:
    if not has_embedding_config():
        log.info("story_relevance_skipped story_id=%s reason=openai_api_key_missing", story_id)
        return
    story = await db_instance.get_story_for_embedding(story_id)
    if story is None:
        return
    story_vectors = await ensure_story_embeddings([story], db_instance=db_instance)
    story_vector = story_vectors.get(story_id)
    if not story_vector:
        return
    companies = await db_instance.list_companies_for_embedding()
    brand_vectors = await ensure_brand_embeddings(companies, db_instance=db_instance)
    rows = [
        {
            "brand_id": brand_id,
            "story_id": story_id,
            "score": cosine(brand_vector, story_vector),
        }
        for brand_id, brand_vector in brand_vectors.items()
    ]
    await db_instance.upsert_brand_story_scores_bulk(
        rows,
        method=EMBEDDING_METHOD,
        model=embedding_model(),
    )


async def score_brand_against_all_stories(
    company_id: str,
    *,
    db_instance: Any = db,
) -> None:
    if not has_embedding_config():
        log.info("brand_relevance_skipped company_id=%s reason=openai_api_key_missing", company_id)
        return
    company = await db_instance.get_company_for_embedding(company_id)
    if company is None:
        return
    brand_vectors = await ensure_brand_embeddings([company], db_instance=db_instance)
    brand_vector = brand_vectors.get(company_id)
    if not brand_vector:
        return
    stories = await db_instance.list_stories_for_embedding()
    story_vectors = await ensure_story_embeddings(stories, db_instance=db_instance)
    rows = [
        {
            "brand_id": company_id,
            "story_id": story_id,
            "score": cosine(brand_vector, story_vector),
        }
        for story_id, story_vector in story_vectors.items()
    ]
    await db_instance.upsert_brand_story_scores_bulk(
        rows,
        method=EMBEDDING_METHOD,
        model=embedding_model(),
    )


async def backfill_all_embedding_scores(*, db_instance: Any = db) -> int:
    if not has_embedding_config():
        raise ValueError("OPENAI_API_KEY not configured")
    companies = await db_instance.list_companies_for_embedding()
    stories = await db_instance.list_stories_for_embedding()
    brand_vectors = await ensure_brand_embeddings(companies, db_instance=db_instance)
    story_vectors = await ensure_story_embeddings(stories, db_instance=db_instance)
    await db_instance.clear_brand_story_scores()
    rows: list[dict[str, Any]] = []
    for brand_id, brand_vector in brand_vectors.items():
        for story_id, story_vector in story_vectors.items():
            rows.append(
                {
                    "brand_id": brand_id,
                    "story_id": story_id,
                    "score": cosine(brand_vector, story_vector),
                }
            )
    await db_instance.upsert_brand_story_scores_bulk(
        rows,
        method=EMBEDDING_METHOD,
        model=embedding_model(),
    )
    return len(rows)
