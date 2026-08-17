from __future__ import annotations

import sys
import uuid

import psycopg
import pytest
from psycopg.rows import dict_row

from ingestion.twitter.news import audience
from ingestion.twitter.news import scrape_news


def _insert_member(
    conn: psycopg.Connection,
    *,
    member_id: str,
    audience_id: str,
    proxy_server: str,
    last_run_at: str | None,
) -> None:
    conn.execute(
        """
        INSERT INTO audience_members (
            id, audience_id, handle, email, city, state,
            auth_token, ct0, proxy_server, proxy_username, proxy_password,
            proxy_label, last_run_at, active
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1)
        """,
        (
            member_id,
            audience_id,
            None,
            f"{member_id}@example.com",
            None,
            None,
            "auth",
            "ct0",
            proxy_server,
            "user",
            "password",
            proxy_server,
            last_run_at,
        ),
    )


def _member(member_id: str, proxy_server: str = "http://proxy-a") -> audience.AudienceMember:
    return audience.AudienceMember(
        id=member_id,
        audience_id=f"audience-{member_id}",
        active=True,
        handle=f"handle-{member_id}",
        email=f"{member_id}@example.com",
        city=None,
        state=None,
        auth_token="auth",
        ct0="ct0",
        proxy_server=proxy_server,
        proxy_username="user",
        proxy_password="password",
        proxy_label=proxy_server,
        last_run_at=None,
    )


@pytest.mark.postgres
def test_claim_migrates_active_and_deactivates_shared_proxy(postgres_dsn):
    dsn = postgres_dsn
    with psycopg.connect(dsn, row_factory=dict_row) as conn:
        suffix = uuid.uuid4().hex[:8]
        _insert_member(
            conn,
            member_id=f"member-1-{suffix}",
            audience_id=f"audience-1-{suffix}",
            proxy_server="http://proxy-a",
            last_run_at=None,
        )
        _insert_member(
            conn,
            member_id=f"member-2-{suffix}",
            audience_id=f"audience-2-{suffix}",
            proxy_server="http://proxy-a",
            last_run_at="2026-06-07 20:00:00",
        )
        _insert_member(
            conn,
            member_id=f"member-3-{suffix}",
            audience_id=f"audience-3-{suffix}",
            proxy_server="http://proxy-b",
            last_run_at="2026-06-07 20:01:00",
        )
        conn.commit()

        first = audience.claim_member_from_db(dsn)
        assert first is not None
        assert first.id == f"member-1-{suffix}"
        assert first.active is True

        second = audience.claim_member_from_db(
            dsn,
            exclude_member_ids={f"member-1-{suffix}"},
        )
        assert second is not None
        assert second.id == f"member-2-{suffix}"

        assert audience.deactivate_proxy_members("http://proxy-a", dsn) == 2

        next_member = audience.claim_member_from_db(dsn)
        assert next_member is not None
        assert next_member.id == f"member-3-{suffix}"


def test_proxy_error_retries_same_member_then_succeeds(monkeypatch, capsys):
    member = _member("member-1")
    claims: list[set[str]] = []
    sleeps: list[float] = []
    run_calls: list[str] = []
    deactivated: list[str] = []

    def claim_member(database_url=None, exclude_member_ids: set[str] | None = None):
        claims.append(set(exclude_member_ids or set()))
        return member

    def run_member(args, claimed_member: audience.AudienceMember) -> None:
        run_calls.append(claimed_member.id)
        if len(run_calls) == 1:
            raise scrape_news.ProxyNavigationError("ERR_TIMED_OUT", "first timeout")

    monkeypatch.setenv("DATABASE_URL", "postgresql://test")
    monkeypatch.setattr(sys, "argv", ["scrape_news.py"])
    monkeypatch.setattr(scrape_news, "PROXY_RETRY_DELAY_SECONDS", 5)
    monkeypatch.setattr(scrape_news.audience, "claim_member_from_db", claim_member)
    monkeypatch.setattr(scrape_news, "_run_member", run_member)
    monkeypatch.setattr(scrape_news.time, "sleep", lambda seconds: sleeps.append(seconds))
    monkeypatch.setattr(
        scrape_news.audience,
        "deactivate_proxy_members",
        lambda proxy_server, database_url=None: deactivated.append(proxy_server) or 1,
    )

    scrape_news.main()

    assert claims == [set()]
    assert run_calls == ["member-1", "member-1"]
    assert sleeps == [5]
    assert deactivated == []
    assert "PROXY_DEACTIVATED_JSON=" not in capsys.readouterr().out


def test_repeated_proxy_error_deactivates_and_claims_next_member(monkeypatch, capsys):
    first_member = _member("member-1", proxy_server="http://proxy-a")
    next_member = _member("member-2", proxy_server="http://proxy-b")
    claims: list[set[str]] = []
    sleeps: list[float] = []
    run_calls: list[str] = []
    deactivated: list[str] = []

    def claim_member(database_url=None, exclude_member_ids: set[str] | None = None):
        excluded = set(exclude_member_ids or set())
        claims.append(excluded)
        if "member-1" in excluded:
            return next_member
        return first_member

    def run_member(args, claimed_member: audience.AudienceMember) -> None:
        run_calls.append(claimed_member.id)
        if claimed_member.id == "member-1":
            raise scrape_news.ProxyNavigationError("ERR_TIMED_OUT", "timeout")

    monkeypatch.setenv("DATABASE_URL", "postgresql://test")
    monkeypatch.setattr(sys, "argv", ["scrape_news.py"])
    monkeypatch.setattr(scrape_news, "PROXY_RETRY_DELAY_SECONDS", 5)
    monkeypatch.setattr(scrape_news.audience, "claim_member_from_db", claim_member)
    monkeypatch.setattr(scrape_news, "_run_member", run_member)
    monkeypatch.setattr(scrape_news.time, "sleep", lambda seconds: sleeps.append(seconds))
    monkeypatch.setattr(
        scrape_news.audience,
        "deactivate_proxy_members",
        lambda proxy_server, database_url=None: deactivated.append(proxy_server) or 1,
    )

    scrape_news.main()

    assert claims == [set(), {"member-1"}]
    assert run_calls == ["member-1", "member-1", "member-2"]
    assert sleeps == [5]
    assert deactivated == ["http://proxy-a"]
    out = capsys.readouterr().out
    assert "PROXY_DEACTIVATED_JSON=" in out
    assert '"error_class": "ERR_TIMED_OUT"' in out
