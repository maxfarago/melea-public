from __future__ import annotations

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from api import auth


def _request(token: str | None = "token") -> Request:
    headers = []
    if token is not None:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    return Request({"type": "http", "headers": headers})


@pytest.mark.asyncio
async def test_require_auth_returns_user_id(monkeypatch):
    monkeypatch.setattr(auth, "verify_token", lambda token: {"sub": "user_1"})

    assert await auth.require_auth(_request()) == "user_1"


@pytest.mark.asyncio
async def test_require_auth_rejects_missing_bearer():
    with pytest.raises(HTTPException) as exc:
        await auth.require_auth(_request(token=None))

    assert exc.value.status_code == 401


