from __future__ import annotations

import pytest

from api.features import cdn_assets


def test_cdn_url_joins_base_and_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "api.features.cdn_assets.settings.cdn_base_url",
        "https://cdn.melea.ai",
    )
    assert (
        cdn_assets.cdn_url("members/abc/avatar.jpg")
        == "https://cdn.melea.ai/members/abc/avatar.jpg"
    )


def test_cdn_url_strips_leading_slash(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "api.features.cdn_assets.settings.cdn_base_url",
        "https://cdn.melea.ai/",
    )
    assert cdn_assets.cdn_url("/tiktok-ads/co/ad/video.mp4") == (
        "https://cdn.melea.ai/tiktok-ads/co/ad/video.mp4"
    )


def test_cdn_url_empty_when_missing_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("api.features.cdn_assets.settings.cdn_base_url", "")
    assert cdn_assets.cdn_url("members/x/avatar.jpg") is None
    assert cdn_assets.cdn_url("") is None


def test_member_avatar_key() -> None:
    assert cdn_assets.member_avatar_key("uuid-1") == "members/uuid-1/avatar.jpg"
    assert cdn_assets.member_avatar_key("uuid-1", ext="png") == "members/uuid-1/avatar.png"
    assert (
        cdn_assets.member_avatar_key("uuid-1", variant="new-id", ext="webp")
        == "members/uuid-1/new-id.webp"
    )


def test_member_avatar_key_requires_member_id() -> None:
    with pytest.raises(ValueError):
        cdn_assets.member_avatar_key("")
