from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from api.main import app
from commons.config import settings


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_path = str(tmp_path / "test.db")
    monkeypatch.setattr(settings, "db_path", db_path)
    monkeypatch.setattr(settings, "database_url", "")
    monkeypatch.setattr(settings, "clerk_publishable_key", "pk_test_customer")
    monkeypatch.setattr(settings, "clerk_ops_publishable_key", "pk_test_ops")
    with TestClient(app) as test_client:
        yield test_client


def test_config_returns_ops_key_for_ops_origin(client: TestClient):
    resp = client.get(
        "/api/config",
        headers={
            "host": "api.melea.ai",
            "origin": "https://ops.melea.ai",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["clerk_publishable_key"] == "pk_test_ops"


def test_config_returns_customer_key_for_apex_origin(client: TestClient):
    resp = client.get(
        "/api/config",
        headers={
            "host": "api.melea.ai",
            "origin": "https://melea.ai",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["clerk_publishable_key"] == "pk_test_customer"


def test_config_falls_back_to_host_for_same_origin_ops(client: TestClient):
    resp = client.get("/api/config", headers={"host": "ops.localhost:8000"})
    assert resp.status_code == 200
    assert resp.json()["clerk_publishable_key"] == "pk_test_ops"


def test_cors_allows_apex_origin(client: TestClient):
    resp = client.options(
        "/api/me",
        headers={
            "origin": "https://melea.ai",
            "access-control-request-method": "GET",
            "access-control-request-headers": "authorization",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "https://melea.ai"
