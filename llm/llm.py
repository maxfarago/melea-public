"""prompt builders for tweet summary workflows."""

from __future__ import annotations

from typing import Any

from llm.profiling import call_llm_json


_SUMMARY_MODEL = "claude-haiku-4-5"
_SUMMARY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "topics": {
            "type": "array",
            "items": {"type": "string"},
            "description": "2-5 key topics or themes in the tweet.",
        },
        "sentiment": {
            "type": "string",
            "description": "Overall sentiment: positive, negative, neutral, or mixed.",
        },
        "summary": {
            "type": "string",
            "description": "1-3 sentence neutral summary of what the tweet says.",
        },
    },
    "required": ["topics", "sentiment", "summary"],
    "additionalProperties": False,
}

_SUMMARY_SYSTEM = """\
You summarize social media posts for a brand workflow. Be factual and neutral.

Tweet types and how to handle them:
- tweet: a standard original post — summarize what the author is saying.
- reply: a response to another user — note who the author is replying to and what they're saying.
- quote: the author is quoting and commenting on another post — summarize both the original post and the author's commentary on it.
- repost: the author is resharing another user's post without adding text — the content belongs to the original author, not the reposter.

Respond with ONLY a JSON object — no markdown, no explanation, no extra text.
Use exactly this shape:
{"topics": ["topic1", "topic2"], "sentiment": "positive|negative|neutral|mixed", "summary": "1-3 sentence summary."}\
"""


def _build_summary_user_msg(
    tweet_text: str,
    author_handle: str,
    author_name: str | None = None,
    tweet_type: str = "tweet",
    quoted_author_handle: str | None = None,
    quoted_author_name: str | None = None,
    quoted_text: str | None = None,
    media_urls: list[str] | None = None,
) -> str:
    author_label = author_handle or "@unknown"
    if author_name:
        author_label = f"{author_name} ({author_handle or '@unknown'})"

    parts: list[str] = [f"Author: {author_label}", f"Type: {tweet_type}"]

    if tweet_type == "reply" and quoted_author_handle:
        parts.append(f"Replying to: {quoted_author_handle}")
    elif tweet_type in ("quote", "repost") and (quoted_text or quoted_author_handle):
        original_author = quoted_author_handle or "@unknown"
        if quoted_author_name:
            original_author = f"{quoted_author_name} ({quoted_author_handle})"
        parts.append(f"Original author: {original_author}")
        if quoted_text:
            parts.append(f"Original post:\n{quoted_text}")

    media_count = len([url for url in media_urls or [] if str(url or "").strip()])
    if media_count:
        parts.append(f"Attached media: {media_count} item(s).")

    parts.append(f"\nPost text:\n{tweet_text}" if tweet_text else "\nPost text: [no text]")
    text = "\n".join(parts)

    return text


async def summarize_tweet(
    tweet_text: str,
    author_handle: str,
    author_name: str | None = None,
    tweet_type: str = "tweet",
    quoted_author_handle: str | None = None,
    quoted_author_name: str | None = None,
    quoted_text: str | None = None,
    media_urls: list[str] | None = None,
) -> dict[str, Any]:
    """summarize tweet text for storage on posts table."""
    user_msg = _build_summary_user_msg(
        tweet_text=tweet_text,
        author_handle=author_handle,
        author_name=author_name,
        tweet_type=tweet_type,
        quoted_author_handle=quoted_author_handle,
        quoted_author_name=quoted_author_name,
        quoted_text=quoted_text,
        media_urls=media_urls,
    )

    parsed, _ = await call_llm_json(
        system_prompt=_SUMMARY_SYSTEM,
        user_message=user_msg,
        sampling={"thinking": False, "max_tokens": 512, "temperature": 0.2},
        schema=_SUMMARY_SCHEMA,
        model=_SUMMARY_MODEL,
    )
    topics = parsed.get("topics") or []
    if not isinstance(topics, list):
        topics = [str(topics)]
    return {
        "topics": [str(t) for t in topics],
        "sentiment": str(parsed.get("sentiment", "neutral")),
        "summary": str(parsed.get("summary", "")),
    }
