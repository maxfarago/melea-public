from __future__ import annotations

import base64
import hmac
import json
import time
from hashlib import sha256
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from api import auth
from api.db.sqlite import db
from api.main import app
from api.routes import clerk_webhook
from commons.config import settings


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_path = str(tmp_path / "test.db")
    monkeypatch.setattr(db, "_db_path", db_path)
    monkeypatch.setattr(settings, "db_path", db_path)
    monkeypatch.setattr(settings, "site_access_password", "")
    monkeypatch.setattr(auth, "get_ops_verifier", lambda: None)
    with TestClient(app) as test_client:
        yield test_client


def _sign_payload(payload: bytes, secret: str) -> dict[str, str]:
    key = base64.b64decode(secret.removeprefix("whsec_"))
    msg_id = "msg_test"
    timestamp = str(int(time.time()))
    signed = f"{msg_id}.{timestamp}.{payload.decode()}".encode()
    sig = base64.b64encode(hmac.new(key, signed, sha256).digest()).decode()
    return {
        "svix-id": msg_id,
        "svix-timestamp": timestamp,
        "svix-signature": f"v1,{sig}",
    }


def test_clerk_webhook_rejects_bad_signature(client, monkeypatch):
    monkeypatch.setattr(
        clerk_webhook.settings,
        "clerk_webhook_secret",
        "whsec_" + base64.b64encode(b"test-secret").decode(),
    )
    resp = client.post(
        "/webhooks/clerk",
        content=b"{}",
        headers={"svix-id": "x", "svix-timestamp": "1", "svix-signature": "v1,bad"},
    )
    assert resp.status_code == 400


def test_clerk_webhook_user_created_upserts_profile(client, monkeypatch):
    secret = "whsec_" + base64.b64encode(b"test-secret").decode()
    monkeypatch.setattr(clerk_webhook.settings, "clerk_webhook_secret", secret)
    upsert = AsyncMock()
    monkeypatch.setattr(clerk_webhook.db, "upsert_user_profile", upsert)

    body = {
        "type": "user.created",
        "data": {
            "id": "user_webhook_1",
            "first_name": "Ada",
            "last_name": "Lovelace",
            "image_url": "https://img.clerk.com/ada.png",
            "email_addresses": [{"email_address": "ada@example.com"}],
        },
    }
    payload = json.dumps(body).encode()
    headers = _sign_payload(payload, secret)
    resp = client.post("/webhooks/clerk", content=payload, headers=headers)
    assert resp.status_code == 200
    upsert.assert_awaited_once_with(
        "user_webhook_1",
        email="ada@example.com",
        full_name="Ada Lovelace",
        image_url="https://img.clerk.com/ada.png",
    )
