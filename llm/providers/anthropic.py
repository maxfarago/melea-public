from __future__ import annotations

import json
from typing import Any

import anthropic

from commons.config import settings
from llm.providers import LLMResult

_client: anthropic.AsyncAnthropic | None = None
_NO_TEMPERATURE_MODEL_PREFIXES = (
    "claude-opus-4-8",
    "claude-sonnet-4-6",
)


def _get_client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


def _supports_temperature(model: str) -> bool:
    return not any(model.startswith(prefix) for prefix in _NO_TEMPERATURE_MODEL_PREFIXES)


def _sampling_to_kwargs(model: str, sampling: dict[str, Any]) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "max_tokens": int(sampling.get("max_tokens", 1024)),
    }
    if _supports_temperature(model) and "temperature" in sampling:
        kwargs["temperature"] = float(sampling["temperature"])
    elif "top_p" in sampling:
        kwargs["top_p"] = float(sampling["top_p"])
    elif _supports_temperature(model):
        kwargs["temperature"] = 0.3
    if sampling.get("thinking"):
        kwargs["thinking"] = {
            "type": "enabled",
            "budget_tokens": int(sampling.get("max_thinking_tokens", 2048)),
        }
    return kwargs


def _extract_result_blocks(content_blocks: list[Any]) -> LLMResult:
    output_parts: list[str] = []
    reasoning_parts: list[str] = []
    for block in content_blocks:
        block_type = getattr(block, "type", None)
        if block_type == "text":
            text = getattr(block, "text", "")
            if text:
                output_parts.append(text)
            continue
        if block_type == "thinking":
            trace = getattr(block, "thinking", "")
            if trace:
                reasoning_parts.append(trace)
    return LLMResult(
        output_text="".join(output_parts).strip(),
        reasoning_trace="".join(reasoning_parts).strip(),
    )


def _extract_tool_input(content_blocks: list[Any], tool_name: str) -> dict[str, Any]:
    for block in content_blocks:
        if getattr(block, "type", None) != "tool_use":
            continue
        if getattr(block, "name", None) != tool_name:
            continue
        tool_input = getattr(block, "input", None)
        if isinstance(tool_input, dict):
            return tool_input
        raise ValueError("anthropic tool_use input must be a json object")
    raise ValueError("anthropic response missing tool_use output block")


async def call_json(
    *,
    model: str,
    system_prompt: str,
    user_message: str,
    sampling: dict[str, Any],
    schema: dict[str, Any],
) -> LLMResult:
    resp = await _get_client().messages.create(
        model=model,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
        tools=[
            {
                "name": "output",
                "description": "emit structured json output",
                "input_schema": schema,
            }
        ],
        tool_choice={"type": "tool", "name": "output"},
        **_sampling_to_kwargs(model, sampling),
    )
    parsed = _extract_tool_input(list(resp.content), "output")
    result = _extract_result_blocks(list(resp.content))
    result.output_text = json.dumps(parsed)
    return result
