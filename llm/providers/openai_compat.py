from __future__ import annotations

from typing import Any

import httpx
from openai import AsyncOpenAI

from commons.config import settings
from llm.providers import LLMResult

_clients: dict[tuple[str, str], AsyncOpenAI] = {}


def _get_client(*, base_url: str, api_key: str) -> AsyncOpenAI:
    key = (base_url.rstrip("/"), api_key)
    if key not in _clients:
        http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=10.0,
                read=float(settings.llm_timeout_seconds),
                write=30.0,
                pool=10.0,
            ),
        )
        _clients[key] = AsyncOpenAI(
            base_url=key[0],
            api_key=api_key,
            timeout=settings.llm_timeout_seconds,
            http_client=http_client,
        )
    return _clients[key]


def _sampling_to_kwargs(sampling: dict[str, Any]) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "max_tokens": int(sampling.get("max_tokens", 1024)),
    }
    if "temperature" in sampling:
        kwargs["temperature"] = float(sampling["temperature"])
    if "top_p" in sampling:
        kwargs["top_p"] = float(sampling["top_p"])
    return kwargs


def _extract_reasoning(message: Any) -> str:
    extras = getattr(message, "model_extra", None) or {}
    return (extras.get("reasoning_content") or extras.get("reasoning") or "").strip()


async def call_json(
    *,
    model: str,
    system_prompt: str,
    user_message: str,
    sampling: dict[str, Any],
    schema: dict[str, Any],
    base_url: str,
    api_key: str,
) -> LLMResult:
    client = _get_client(base_url=base_url, api_key=api_key)
    resp = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "output",
                "schema": schema,
                "strict": True,
            },
        },
        **_sampling_to_kwargs(sampling),
    )
    message = resp.choices[0].message
    return LLMResult(
        output_text=(message.content or "").strip(),
        reasoning_trace=_extract_reasoning(message),
    )


async def generate_image_b64(
    *,
    model: str,
    prompt: str,
    base_url: str,
    api_key: str,
    aspect_ratio: str = "1:1",
) -> tuple[bytes, str]:
    """Generate one image, return (raw bytes, mime type). xAI rejects `size` but
    honors `aspect_ratio` via extra_body (1:1 -> 1024x1024)."""
    import base64

    client = _get_client(base_url=base_url, api_key=api_key)
    resp = await client.images.generate(
        model=model,
        prompt=prompt,
        n=1,
        response_format="b64_json",
        extra_body={"aspect_ratio": aspect_ratio},
    )
    item = resp.data[0]
    b64 = getattr(item, "b64_json", None)
    if not b64:
        raise ValueError("image response missing b64_json")
    mime = (getattr(item, "model_extra", None) or {}).get("mime_type") or "image/jpeg"
    return base64.b64decode(b64), mime
