import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from llm.profiling import (  # noqa: E402
    _SITMAR_OPENER_MESSAGES,
    _sitmar_chat_user_message,
    _sitmar_parse_tweets,
    _sitmar_parse_vibes,
    build_image_prompt_request,
    build_sitmar_chat_system_prompt,
    build_sitmar_image_prompt,
    build_sitmar_tweet_refine_user_message,
    build_sitmar_tweet_user_message,
    sitmar_opener_message,
)


def test_sitmar_opener_message_substitutes_brand_name() -> None:
    msg = sitmar_opener_message("Lassie")
    assert "Lassie" in msg
    assert msg in [t.format(brand_name="Lassie") for t in _SITMAR_OPENER_MESSAGES]


def test_build_sitmar_chat_system_prompt_uses_new_brief() -> None:
    prefix, directives = build_sitmar_chat_system_prompt()
    assert "AI/startup Twitter" in prefix
    assert "TENSION OVER SAFETY" in prefix
    assert "title" in directives
    assert "blurb" in directives
    assert "16 words" in directives


def test_sitmar_chat_user_message_opener() -> None:
    msg = _sitmar_chat_user_message(
        brand_name="Acme",
        brand_synthesis="devtools for ml teams",
        audience_title="ML engineers",
        audience_description="senior ics at startups",
        story_title="OpenAI ships new model",
        story_summary="a faster coding model launched today",
        messages=[],
    )
    assert "Acme" in msg
    assert "OpenAI ships new model" in msg
    assert "ML engineers" in msg
    assert "Pick 3 directions" in msg


def test_sitmar_chat_user_message_refine_includes_feedback() -> None:
    msg = _sitmar_chat_user_message(
        brand_name="Acme",
        brand_synthesis="devtools",
        audience_title="devs",
        audience_description="ics",
        story_title="Story",
        story_summary="summary",
        messages=[
            {
                "role": "assistant",
                "message": "intro",
                "seeds": [{"title": "Angle A", "blurb": "people quote it"}],
            },
            {"role": "user", "text": "make them funnier"},
        ],
    )
    assert "Current directions:" in msg
    assert "Angle A" in msg
    assert "make them funnier" in msg


def test_sitmar_parse_vibes_accepts_objects_and_strings() -> None:
    assert _sitmar_parse_vibes([{"label": "Punchier"}, "Lead with data", {}]) == [
        {"label": "Punchier"},
        {"label": "Lead with data"},
    ]


def test_build_sitmar_tweet_user_message_includes_context_blocks() -> None:
    msg = build_sitmar_tweet_user_message(
        brand_name="Acme",
        brand_synthesis="devtools for ml teams",
        audience_title="ML engineers",
        audience_description="senior ics at startups",
        story_title="OpenAI ships new model",
        story_summary="a faster coding model launched today",
        seed_title="The real bottleneck is review",
        seed_blurb="everyone quotes it",
    )
    assert "<brand_context>" in msg
    assert "<audience>" in msg
    assert "<news_context>" in msg
    assert "<chosen_angle>" in msg
    assert "why it spreads: everyone quotes it" in msg
    assert "recommended, provocative, casual" in msg


def test_sitmar_parse_tweets_orders_by_route() -> None:
    tweets = _sitmar_parse_tweets(
        [
            {"route": "casual", "text": "lol true"},
            {"route": "recommended", "text": "default take"},
            {"route": "provocative", "text": "spicy take"},
        ]
    )
    assert [t["route"] for t in tweets] == ["recommended", "provocative", "casual"]
    assert tweets[0]["text"] == "default take"


def test_build_sitmar_tweet_refine_user_message_includes_current_post() -> None:
    msg = build_sitmar_tweet_refine_user_message(
        brand_name="Acme",
        brand_synthesis="devtools",
        audience_title="devs",
        audience_description="ics",
        story_title="Story",
        story_summary="summary",
        seed_title="Angle",
        seed_blurb="spreads",
        route="recommended",
        current_text="draft post",
        feedback="make it shorter",
    )
    assert '<current_post route="recommended">' in msg
    assert "draft post" in msg
    assert "make it shorter" in msg


def test_build_sitmar_image_prompt_includes_compact_context() -> None:
    prompt = build_sitmar_image_prompt(
        brand_name="Lassie",
        brand_context="ai-native revenue cycle automation for healthcare operators",
        audience_title="MSO finance leaders",
        audience_description="executives scaling multi-state healthcare operations",
        story_title="Sazan project frozen after approvals revoked",
        story_summary="a major coastal development stalled after regulators froze permits and accounts",
        logline="when the foundation is contested, the whole project freezes.",
        concept="contrast high-stakes development chaos with always-on claims automation.",
    )

    assert "brand: Lassie" in prompt
    assert "brand context: ai-native revenue cycle automation" in prompt
    assert "target audience: MSO finance leaders" in prompt
    assert "news hook: Sazan project frozen after approvals revoked" in prompt
    assert "creative concept: when the foundation is contested" in prompt
    assert "no text, no logos, no watermarks" in prompt


def test_build_sitmar_image_prompt_truncates_long_context() -> None:
    prompt = build_sitmar_image_prompt(
        brand_name="Brand",
        brand_context="x" * 500,
        audience_title="Audience",
        audience_description="y" * 500,
        story_title="Story",
        story_summary="z" * 500,
        logline="Logline",
        concept="c" * 900,
    )

    assert "xxx..." in prompt
    assert "yyy..." in prompt
    assert "zzz..." in prompt
    assert "ccc..." in prompt
    assert len(prompt) < 1600


def test_build_image_prompt_request_shape() -> None:
    system, user = build_image_prompt_request(
        brand_synthesis="ai-native revenue cycle automation for healthcare operators",
        story_title="Sazan project frozen after approvals revoked",
        story_summary="a major coastal development stalled after regulators froze permits",
        logline="{logline}",
        concept="{concept}",
    )

    # system enforces the hard image constraints
    assert "no logos, no watermarks" in system
    # user carries the brand/story context and passes placeholders through verbatim
    assert "ai-native revenue cycle automation" in user
    assert "Sazan project frozen" in user
    assert "{logline}" in user
    assert "{concept}" in user
