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
    with TestClient(app) as test_client:
        yield test_client


def test_config_returns_ga_measurement_id(client: TestClient, monkeypatch):
    monkeypatch.setattr(settings, "ga_measurement_id", "G-TEST")
    resp = client.get("/api/config")
    assert resp.status_code == 200
    assert resp.json() == {"ga_measurement_id": "G-TEST"}


def test_cors_allows_apex_origin(client: TestClient):
    resp = client.get("/api/config", headers={"origin": "https://melea.ai"})
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == "https://melea.ai"
