from __future__ import annotations

import argparse
import asyncio

from api.db.sqlite import CoreDatabase
from api.features.story_relevance import backfill_all_embedding_scores
from commons.config import settings


async def _run() -> int:
    if not settings.database_url.strip():
        raise SystemExit("DATABASE_URL is required")
    db = CoreDatabase()
    await db.init()
    try:
        return await backfill_all_embedding_scores(db_instance=db)
    finally:
        await db.close()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="backfill dense embedding scores for every brand-story pair"
    )
    parser.parse_args()
    count = asyncio.run(_run())
    print(f"upserted {count} brand-story embedding scores")


if __name__ == "__main__":
    main()
