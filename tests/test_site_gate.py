from __future__ import annotations

import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient

from api.db.sqlite import db
from api.main import app
from api.site_gate import COOKIE_NAME, expected_cookie_value
from commons.config import settings


@pytest.fixture
def client(tmp_path, monkeypatch):
    db_path = str(tmp_path / "test.db")
    monkeypatch.setattr(db, "_db_path", db_path)
    monkeypatch.setattr(settings, "db_path", db_path)
    db._lock = asyncio.Lock()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def pg_client(tmp_path, monkeypatch, postgres_dsn):
    db_path = str(tmp_path / "test.db")
    monkeypatch.setattr(db, "_db_path", db_path)
    monkeypatch.setattr(settings, "db_path", db_path)
    monkeypatch.setattr(settings, "database_url", postgres_dsn)
    db._lock = asyncio.Lock()
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def reset_gate_settings():
    old_password = settings.site_access_password
    old_secret = settings.site_gate_cookie_secret
    yield
    settings.site_access_password = old_password
    settings.site_gate_cookie_secret = old_secret


STATIC_FIXTURE = "/static/images/bg.png"


def test_gate_disabled_allows_static(client):
    settings.site_access_password = ""
    resp = client.get(STATIC_FIXTURE)
    assert resp.status_code == 200


def test_gate_disabled_public_reads_without_clerk(client):
    settings.site_access_password = ""
    resp = client.get("/api/ops/companies")
    assert resp.status_code == 401


@pytest.mark.postgres
def test_gate_disabled_anon_can_create_company(pg_client):
    settings.site_access_password = ""
    resp = pg_client.post(
        "/api/companies",
        json={"website_url": f"https://gate-unique-create-{uuid.uuid4().hex[:8]}.example"},
    )
    assert resp.status_code == 200
    assert resp.json()["company"]["id"]


def test_gate_enabled_blocks_static_without_cookie(client):
    settings.site_access_password = "secret"
    settings.site_gate_cookie_secret = "gate-secret"
    resp = client.get(STATIC_FIXTURE, follow_redirects=False)
    assert resp.status_code == 302
    assert resp.headers["location"].startswith("/gate?next=")


def test_gate_enabled_blocks_api_without_cookie(client):
    settings.site_access_password = "secret"
    settings.site_gate_cookie_secret = "gate-secret"
    resp = client.get("/api/me")
    assert resp.status_code == 401
    assert resp.json()["detail"] == "Site access required."


def test_gate_enabled_allows_health_without_cookie(client):
    settings.site_access_password = "secret"
    settings.site_gate_cookie_secret = "gate-secret"
    resp = client.get("/api/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_gate_unlock_rejects_wrong_password(client):
    settings.site_access_password = "secret"
    settings.site_gate_cookie_secret = "gate-secret"
    resp = client.post(
        "/api/site-gate/unlock",
        json={"password": "wrong", "next": "/app"},
    )
    assert resp.status_code == 401
    assert COOKIE_NAME not in resp.cookies


def test_gate_unlock_sets_cookie_and_allows_static(client):
    settings.site_access_password = "secret"
    settings.site_gate_cookie_secret = "gate-secret"
    unlock = client.post(
        "/api/site-gate/unlock",
        json={"password": "secret", "next": "/app"},
    )
    assert unlock.status_code == 200
    assert unlock.json()["next"] == "/app"
    cookie = unlock.cookies.get(COOKIE_NAME)
    assert cookie == expected_cookie_value()

    client.cookies.set(COOKIE_NAME, cookie)
    static = client.get(STATIC_FIXTURE)
    assert static.status_code == 200


def test_gate_allowlist_waitlist_without_cookie(client):
    settings.site_access_password = "secret"
    settings.site_gate_cookie_secret = "gate-secret"
    resp = client.post(
        "/waitlist",
        json={
            "company_website": "https://example.com",
            "email": "not-an-email",
        },
    )
    assert resp.status_code == 422


def test_gate_status_reports_enabled_and_unlocked(client):
    settings.site_access_password = "secret"
    settings.site_gate_cookie_secret = "gate-secret"
    resp = client.get("/api/site-gate/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["enabled"] is True
    assert body["unlocked"] is False

    unlock = client.post(
        "/api/site-gate/unlock",
        json={"password": "secret", "next": "/app"},
    )
    client.cookies.set(COOKIE_NAME, unlock.cookies[COOKIE_NAME])
    status = client.get("/api/site-gate/status")
    assert status.json()["unlocked"] is True
