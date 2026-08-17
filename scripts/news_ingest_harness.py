"""local harness: run the news scraper as one of our own burner accounts.

deactivates every other audience member, upserts + activates a single burner
account, runs the scraper locally with --no-proxy, then verifies the stories it
ingested were attributed to our member and prints the x news ids it captured.

requires DATABASE_URL pointing at a postgres database with schema applied.

usage:
    DATABASE_URL=postgresql://... python3 scripts/news_ingest_harness.py \
        --email burner@example.com --auth-token <token> --ct0 <ct0> \
        [--handle myburner] [--audience-id UUID] [--max-stories 30]
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
import uuid
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

_REPO_ROOT = Path(__file__).resolve().parent.parent
_SCRAPER = _REPO_ROOT / "ingestion" / "twitter" / "news" / "scrape_news.py"


def _connect() -> psycopg.Connection:
    dsn = os.environ.get("DATABASE_URL", "").strip()
    if not dsn:
        sys.exit("DATABASE_URL is required")
    return psycopg.connect(dsn, row_factory=dict_row)


def _ensure_audience(conn: psycopg.Connection, audience_id: str) -> None:
    exists = conn.execute("SELECT 1 FROM audiences WHERE id = %s", (audience_id,)).fetchone()
    if exists:
        return
    now = time.time()
    conn.execute(
        "INSERT INTO audiences (id, title, description, created_at, updated_at) "
        "VALUES (%s, %s, %s, %s, %s)",
        (audience_id, "harness burner", "local news-ingestion harness", now, now),
    )


def _upsert_burner(
    conn: psycopg.Connection,
    *,
    member_id: str,
    audience_id: str,
    handle: str | None,
    email: str,
    auth_token: str,
    ct0: str,
) -> None:
    conn.execute(
        """
        INSERT INTO audience_members
            (id, audience_id, active, handle, email, auth_token, ct0, last_run_at)
        VALUES (%s, %s, 1, %s, %s, %s, %s, NULL)
        ON CONFLICT(id) DO UPDATE SET
            audience_id = excluded.audience_id,
            active      = 1,
            handle      = excluded.handle,
            email       = excluded.email,
            auth_token  = excluded.auth_token,
            ct0         = excluded.ct0,
            proxy_server = NULL,
            last_run_at = NULL
        """,
        (member_id, audience_id, handle, email, auth_token, ct0),
    )


def _verify(conn: psycopg.Connection, member_id: str) -> None:
    ours = conn.execute(
        "SELECT COUNT(*) AS n FROM audience_story_sightings WHERE audience_member_id = %s",
        (member_id,),
    ).fetchone()["n"]
    others = conn.execute(
        """
        SELECT COUNT(*) AS n FROM audience_story_sightings
        WHERE audience_member_id IS NOT NULL AND audience_member_id != %s
        """,
        (member_id,),
    ).fetchone()["n"]
    x_trend_ids = conn.execute(
        """
        SELECT s.headline, s.x_trend_id
        FROM audience_story_sightings sg
        JOIN trending_stories s ON s.story_id = sg.story_id
        WHERE sg.audience_member_id = %s AND s.x_trend_id IS NOT NULL
        ORDER BY sg.last_seen_at DESC
        """,
        (member_id,),
    ).fetchall()

    print("\n=== harness verification ===", file=sys.stderr)
    print(f"sightings attributed to our member ({member_id}): {ours}", file=sys.stderr)
    print(f"sightings attributed to other members: {others}", file=sys.stderr)
    if others:
        print("WARNING: another member scraped — inactivation may not have held", file=sys.stderr)
    print(f"stories with a captured x_trend_id: {len(x_trend_ids)}", file=sys.stderr)
    for row in x_trend_ids[:15]:
        print(f"  x_trend_id={row['x_trend_id']}  {row['headline']}", file=sys.stderr)
    if ours == 0:
        print(
            "no stories attributed to us — check the burner auth_token/ct0 are "
            "valid and that playwright/chromium is installed",
            file=sys.stderr,
        )


def main() -> None:
    ap = argparse.ArgumentParser(description="local news-ingestion harness (burner account)")
    ap.add_argument("--email", required=True)
    ap.add_argument("--auth-token", required=True)
    ap.add_argument("--ct0", required=True)
    ap.add_argument("--handle")
    ap.add_argument("--member-id", help="reuse a member UUID across runs; generated when omitted")
    ap.add_argument(
        "--audience-id", help="audience UUID to attribute sightings to; generated when omitted"
    )
    ap.add_argument("--max-stories", type=int, default=30)
    ap.add_argument(
        "--skip-scrape",
        action="store_true",
        help="set up the burner + inactivate others, but don't run the scraper",
    )
    args = ap.parse_args()

    member_id = args.member_id or str(uuid.uuid4())
    audience_id = args.audience_id or str(uuid.uuid4())

    with _connect() as conn:
        deactivated = conn.execute(
            "UPDATE audience_members SET active = 0 WHERE active = 1 AND id != %s",
            (member_id,),
        ).rowcount
        _ensure_audience(conn, audience_id)
        _upsert_burner(
            conn,
            member_id=member_id,
            audience_id=audience_id,
            handle=(args.handle or "").lstrip("@") or None,
            email=args.email,
            auth_token=args.auth_token,
            ct0=args.ct0,
        )
        conn.commit()

    print(
        f"deactivated {deactivated} other member(s); active burner "
        f"member={member_id} audience={audience_id}",
        file=sys.stderr,
    )

    if args.skip_scrape:
        print("--skip-scrape set; not running the scraper", file=sys.stderr)
        return

    env = os.environ.copy()
    if not env.get("DATABASE_URL", "").strip():
        sys.exit("DATABASE_URL is required")

    cmd = [
        sys.executable,
        str(_SCRAPER),
        "--no-proxy",
        "--max-stories",
        str(args.max_stories),
    ]
    print(f"running: {' '.join(cmd)}", file=sys.stderr)
    result = subprocess.run(cmd, cwd=str(_SCRAPER.parent), env=env)

    with _connect() as conn:
        _verify(conn, member_id)

    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
