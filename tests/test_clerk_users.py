from __future__ import annotations

from api.clerk_users import clerk_profile_from_user_body


def test_clerk_profile_from_user_body():
    body = {
        "first_name": "Ada",
        "last_name": "Lovelace",
        "image_url": "https://img.clerk.com/ada.png",
        "primary_email_address_id": "idn_primary",
        "email_addresses": [
            {"id": "idn_other", "email_address": "other@example.com"},
            {"id": "idn_primary", "email_address": "ada@example.com"},
        ],
    }
    profile = clerk_profile_from_user_body(body)
    assert profile == {
        "email": "ada@example.com",
        "full_name": "Ada Lovelace",
        "image_url": "https://img.clerk.com/ada.png",
    }


def test_clerk_profile_from_user_body_uses_profile_image_url_fallback():
    body = {
        "profile_image_url": "https://www.gravatar.com/avatar?d=mp",
        "email_addresses": [{"id": "idn_1", "email_address": "ada@example.com"}],
    }
    profile = clerk_profile_from_user_body(body)
    assert profile["image_url"] == "https://www.gravatar.com/avatar?d=mp"
