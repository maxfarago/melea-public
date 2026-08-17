from __future__ import annotations

import asyncio
import math
from array import array

from openai import AsyncOpenAI

from commons.config import settings

EMBEDDING_METHOD = "embedding_cosine"
EMBEDDING_INPUT_VERSION = "brand-story-v1"

_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


def embedding_model() -> str:
    return settings.embedding_model.strip() or "text-embedding-3-small"


def has_embedding_config() -> bool:
    return bool(settings.openai_api_key.strip())


async def embed_texts(texts: list[str], *, model: str | None = None) -> list[list[float]]:
    cleaned = [str(text or "").strip() for text in texts]
    if not cleaned:
        return []
    if not has_embedding_config():
        raise ValueError("OPENAI_API_KEY not configured")
    resp = await _get_client().embeddings.create(
        model=model or embedding_model(),
        input=cleaned,
    )
    by_index = sorted(resp.data, key=lambda item: item.index)
    return [list(item.embedding) for item in by_index]


async def embed_texts_batched(texts: list[str], *, model: str | None = None) -> list[list[float]]:
    batch_size = max(1, int(settings.embedding_batch_size or 64))
    concurrency = max(1, int(settings.embedding_concurrency or 4))
    sem = asyncio.Semaphore(concurrency)
    out: list[list[float] | None] = [None] * len(texts)

    async def _batch(start: int, batch: list[str]) -> None:
        async with sem:
            vectors = await embed_texts(batch, model=model)
        for offset, vector in enumerate(vectors):
            out[start + offset] = vector

    await asyncio.gather(
        *(
            _batch(start, texts[start : start + batch_size])
            for start in range(0, len(texts), batch_size)
        )
    )
    return [vector or [] for vector in out]


def normalize_vector(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(float(v) * float(v) for v in vector))
    if norm <= 0:
        return []
    return [float(v) / norm for v in vector]


def pack_vector(vector: list[float]) -> bytes:
    arr = array("f", normalize_vector(vector))
    return arr.tobytes()


def unpack_vector(raw: bytes | None) -> list[float]:
    if not raw:
        return []
    arr = array("f")
    arr.frombytes(raw)
    return [float(v) for v in arr]


def coerce_vector(raw: bytes | list[float] | memoryview | None) -> list[float]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [float(v) for v in raw]
    if hasattr(raw, "tolist"):
        return [float(v) for v in raw.tolist()]
    if isinstance(raw, memoryview):
        raw = bytes(raw)
    if isinstance(raw, bytes):
        return unpack_vector(raw)
    return []


def cosine(left: list[float], right: list[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    return max(0.0, min(1.0, sum(float(a) * float(b) for a, b in zip(left, right))))
