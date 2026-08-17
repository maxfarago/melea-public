"""admin tool: add / list twitter audience members (x.com accounts).

runs against postgres via DATABASE_URL. the scraper reads audience_members
directly from postgres — no api indirection.

usage:
    DATABASE_URL=postgresql://... python3 scripts/manage_audience_members.py list
    DATABASE_URL=postgresql://... python3 scripts/manage_audience_members.py add \
        --email a@b.com --proxy-server "http://host:port" \
        --proxy-username user --proxy-password pass \
        --proxy-label "Residential US-NY" \
        --auth-token ... --ct0 ... [--handle foo] [--audience-id UUID] \
        [--city ...] [--state ...]
"""

from __future__ import annotations

import argparse
import os
import sys
import uuid

import psycopg
from psycopg.rows import dict_row

_COLS = (
    "id, audience_id, handle, email, city, state, "
    "active, profile_image_s3_key, proxy_server, proxy_username, proxy_label, "
    "auth_token, ct0, last_run_at"
)

_UPSERT = """
INSERT INTO audience_members
  (id, audience_id, handle, email, city, state,
   profile_image_s3_key,
   proxy_server, proxy_username, proxy_password, proxy_label,
   auth_token, ct0, active)
VALUES
  (%(id)s, %(audience_id)s, %(handle)s, %(email)s, %(city)s, %(state)s,
   %(profile_image_s3_key)s,
   %(proxy_server)s, %(proxy_username)s, %(proxy_password)s, %(proxy_label)s,
   %(auth_token)s, %(ct0)s, %(active)s)
ON CONFLICT(id) DO UPDATE SET
  audience_id    = excluded.audience_id,
  active         = excluded.active,
  handle         = excluded.handle,
  email          = excluded.email,
  city           = excluded.city,
  state          = excluded.state,
  profile_image_s3_key = COALESCE(excluded.profile_image_s3_key, audience_members.profile_image_s3_key),
  proxy_server   = excluded.proxy_server,
  proxy_username = excluded.proxy_username,
  proxy_password = excluded.proxy_password,
  proxy_label    = excluded.proxy_label,
  auth_token     = excluded.auth_token,
  ct0            = excluded.ct0
"""


def _connect() -> psycopg.Connection:
    dsn = os.environ.get("DATABASE_URL", "").strip()
    if not dsn:
        sys.exit("DATABASE_URL is required")
    return psycopg.connect(dsn, row_factory=dict_row)


def main() -> None:
    ap = argparse.ArgumentParser(description="manage twitter audience members")
    sub = ap.add_subparsers(dest="cmd", required=True)

    add = sub.add_parser("add", help="add or update an audience member")
    add.add_argument("--id", help="member UUID; generated when omitted")
    add.add_argument(
        "--audience-id",
        help="optional UUID from the audiences table; unassigned members do not scrape",
    )
    add.add_argument("--handle")
    add.add_argument("--email", required=True)
    add.add_argument(
        "--proxy-server", required=True, help="e.g. http://host:port or socks5://host:port"
    )
    add.add_argument("--proxy-username")
    add.add_argument("--proxy-password")
    add.add_argument("--proxy-label", help="human label shown in operator UI")
    add.add_argument("--auth-token")
    add.add_argument("--ct0")
    add.add_argument("--city")
    add.add_argument("--state")
    add.add_argument("--profile-image-s3-key")
    active_group = add.add_mutually_exclusive_group()
    active_group.add_argument("--active", action="store_true", help="mark member active")
    active_group.add_argument("--inactive", action="store_true", help="mark member inactive")

    sub.add_parser("list", help="list audience members ordered by last run")

    args = ap.parse_args()
    conn = _connect()

    if args.cmd == "add":
        member_id = args.id or str(uuid.uuid4())
        existing = conn.execute(
            "SELECT auth_token, ct0, active FROM audience_members WHERE id = %s",
            (member_id,),
        ).fetchone()
        if existing:
            auth_token = args.auth_token or existing["auth_token"]
            ct0 = args.ct0 or existing["ct0"]
        else:
            if not args.auth_token or not args.ct0:
                sys.exit("--auth-token and --ct0 are required when adding a new member")
            auth_token = args.auth_token
            ct0 = args.ct0
        if args.inactive:
            active = 0
        elif args.active:
            active = 1
        elif existing:
            active = int(existing["active"])
        else:
            active = 1
        conn.execute(
            _UPSERT,
            {
                "id": member_id,
                "audience_id": args.audience_id or None,
                "handle": (args.handle or "").strip().lstrip("@") or None,
                "email": args.email,
                "city": args.city,
                "state": args.state,
                "profile_image_s3_key": args.profile_image_s3_key or None,
                "proxy_server": args.proxy_server,
                "proxy_username": args.proxy_username or None,
                "proxy_password": args.proxy_password or None,
                "proxy_label": args.proxy_label or None,
                "auth_token": auth_token,
                "ct0": ct0,
                "active": active,
            },
        )
        conn.commit()
        print(f"upserted audience member {member_id}")
    elif args.cmd == "list":
        for r in conn.execute(
            f"SELECT {_COLS} FROM audience_members "
            "ORDER BY last_run_at IS NOT NULL, last_run_at ASC"
        ):
            print(
                f"{r['id']}\taudience={r['audience_id'] or 'unassigned'}"
                f"\tactive={bool(r['active'])}"
                f"\thandle={r['handle'] or '-'}\t{r['email']}"
                f"\timage={r['profile_image_s3_key'] or '-'}"
                f"\tproxy={r['proxy_label'] or r['proxy_server'] or 'none'}"
                f"\tlast_run={r['last_run_at'] or 'never'}"
            )
    conn.close()


if __name__ == "__main__":
    main()
