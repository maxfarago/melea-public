import os
import time
from pathlib import Path

import psycopg
import pytest

from api.db.users import User

_SCHEMA_PATH = Path(__file__).resolve().parents[1] / "api" / "db" / "schema.pg.sql"


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "postgres: requires DATABASE_URL and applied postgres schema",
    )


def _admin_dsn(dsn: str) -> str:
    return dsn.rsplit("/", 1)[0] + "/postgres"


def _test_dsn(base_dsn: str) -> str:
    explicit = os.environ.get("TEST_DATABASE_URL", "").strip()
    if explicit:
        return explicit
    prefix, _, _ = base_dsn.rpartition("/")
    return f"{prefix}/melea_test"


def _ensure_test_database(base_dsn: str, test_dsn: str) -> None:
    test_db_name = test_dsn.rsplit("/", 1)[-1]
    with psycopg.connect(_admin_dsn(base_dsn), autocommit=True) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s",
            (test_db_name,),
        ).fetchone()
        if not exists:
            conn.execute(f'CREATE DATABASE "{test_db_name}"')
    schema = _SCHEMA_PATH.read_text()
    with psycopg.connect(test_dsn, autocommit=True) as conn:
        conn.execute(schema)


def _truncate_public_tables(test_dsn: str) -> None:
    with psycopg.connect(test_dsn, autocommit=True) as conn:
        conn.execute(
            """
            DO $$ DECLARE r RECORD;
            BEGIN
                FOR r IN (
                    SELECT tablename
                    FROM pg_tables
                    WHERE schemaname = 'public'
                ) LOOP
                    EXECUTE 'TRUNCATE TABLE '
                        || quote_ident(r.tablename)
                        || ' RESTART IDENTITY CASCADE';
                END LOOP;
            END $$;
            """
        )


@pytest.fixture(scope="session")
def _postgres_test_db_ready():
    base_dsn = os.environ.get("DATABASE_URL", "").strip()
    if not base_dsn:
        pytest.skip("DATABASE_URL not set")
    test_dsn = _test_dsn(base_dsn)
    _ensure_test_database(base_dsn, test_dsn)
    return test_dsn


@pytest.fixture
def postgres_dsn(_postgres_test_db_ready):
    _truncate_public_tables(_postgres_test_db_ready)
    return _postgres_test_db_ready


def install_in_memory_user_shim(monkeypatch, target) -> None:
    store: dict[str, User] = {}

    async def upsert_user_profile(
        clerk_user_id: str,
        *,
        email: str,
        full_name: str,
        image_url: str,
    ) -> None:
        existing = store.get(clerk_user_id)
        now = time.time()
        store[clerk_user_id] = User(
            clerk_user_id=clerk_user_id,
            company_id=existing.company_id if existing else None,
            created_at=existing.created_at if existing else now,
            email=email.strip(),
            full_name=full_name.strip(),
            image_url=image_url.strip(),
        )

    async def upsert_user(
        clerk_user_id: str,
        company_id: str | None,
        *,
        email: str = "",
        full_name: str = "",
        image_url: str = "",
    ) -> User:
        existing = store.get(clerk_user_id)
        now = existing.created_at if existing else time.time()
        current_company = company_id if company_id else (existing.company_id if existing else None)
        if email.strip() or full_name.strip() or image_url.strip():
            merged_email = email.strip() or (existing.email if existing else "")
            merged_name = full_name.strip() or (existing.full_name if existing else "")
            merged_image = image_url.strip() or (existing.image_url if existing else "")
        else:
            merged_email = existing.email if existing else ""
            merged_name = existing.full_name if existing else ""
            merged_image = existing.image_url if existing else ""
        user = User(
            clerk_user_id=clerk_user_id,
            company_id=current_company,
            created_at=now,
            email=merged_email,
            full_name=merged_name,
            image_url=merged_image,
        )
        store[clerk_user_id] = user
        return user

    async def get_user_by_clerk_id(clerk_user_id: str) -> User | None:
        return store.get(clerk_user_id)

    async def get_company_id_for_user(clerk_user_id: str) -> str | None:
        user = store.get(clerk_user_id)
        return user.company_id if user and user.company_id else None

    async def update_user_profile(
        clerk_user_id: str,
        *,
        email: str,
        full_name: str,
        image_url: str,
    ) -> None:
        await upsert_user_profile(
            clerk_user_id,
            email=email,
            full_name=full_name,
            image_url=image_url,
        )

    async def clear_user_company_association(clerk_user_id: str) -> bool:
        user = store.get(clerk_user_id)
        if user is None or not user.company_id:
            return False
        store[clerk_user_id] = User(
            clerk_user_id=user.clerk_user_id,
            company_id=None,
            created_at=user.created_at,
            email=user.email,
            full_name=user.full_name,
            image_url=user.image_url,
        )
        return True

    async def get_user_plan(_clerk_user_id: str) -> tuple[str | None, str | None]:
        return None, None

    async def is_user_subscribed(_clerk_user_id: str) -> bool:
        return False

    monkeypatch.setattr(target, "upsert_user_profile", upsert_user_profile)
    monkeypatch.setattr(target, "upsert_user", upsert_user)
    monkeypatch.setattr(target, "get_user_by_clerk_id", get_user_by_clerk_id)
    monkeypatch.setattr(target, "get_company_id_for_user", get_company_id_for_user)
    monkeypatch.setattr(target, "update_user_profile", update_user_profile)
    monkeypatch.setattr(target, "clear_user_company_association", clear_user_company_association)
    monkeypatch.setattr(target, "get_user_plan", get_user_plan)
    monkeypatch.setattr(target, "is_user_subscribed", is_user_subscribed)


@pytest.fixture
async def pg_db(postgres_dsn, tmp_path, monkeypatch):
    from api.db.sqlite import CoreDatabase
    from commons.config import settings

    monkeypatch.setattr(settings, "database_url", postgres_dsn)
    db = CoreDatabase(str(tmp_path / "melea.db"))
    await db.init()
    yield db
    await db.close()


@pytest.fixture(autouse=True)
def _in_memory_user_shim_when_no_pg(monkeypatch, request):
    if os.environ.get("DATABASE_URL", "").strip():
        return
    if request.node.get_closest_marker("postgres"):
        return
    from api.db.sqlite import db

    install_in_memory_user_shim(monkeypatch, db)
