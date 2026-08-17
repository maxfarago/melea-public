"""sitmar campaign persistence models and methods."""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Mapping

from api.db.common import _loads_json_dict, _loads_json_list


@dataclass
class SituationalCampaign:
    id: str
    company_id: str
    story_id: str
    title: str
    status: str
    error: str | None = None
    brand_name: str = ""
    brand_synthesis: str = ""
    brand_logo_url: str = ""
    story_title: str = ""
    story_summary: str = ""
    brand_audience: dict[str, Any] = field(default_factory=dict)
    inhouse_audience: dict[str, Any] = field(default_factory=dict)
    messages: list[dict[str, Any]] = field(default_factory=list)
    selected_seed: dict[str, Any] | None = None
    tweets: list[dict[str, Any]] = field(default_factory=list)
    post_url: str | None = None
    user_id: str | None = None
    distribute_sent: list[dict[str, Any]] = field(default_factory=list)
    distribute_dismissed: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "company_id": self.company_id,
            "story_id": self.story_id,
            "title": self.title,
            "status": self.status,
            "error": self.error,
            "brand_name": self.brand_name,
            "brand_synthesis": self.brand_synthesis,
            "brand_logo_url": self.brand_logo_url,
            "story_title": self.story_title,
            "story_summary": self.story_summary,
            "brand_audience": self.brand_audience or {},
            "inhouse_audience": self.inhouse_audience or {},
            "messages": self.messages or [],
            "selected_seed": self.selected_seed,
            "tweets": self.tweets or [],
            "post_url": self.post_url,
            "distribute_sent": self.distribute_sent or [],
            "distribute_dismissed": self.distribute_dismissed or [],
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def _row_to_situational_campaign(row: Mapping[str, Any]) -> SituationalCampaign:
    return SituationalCampaign(
        id=row["id"],
        company_id=row["company_id"],
        story_id=row["story_id"],
        title=row["title"] or "",
        status=row["status"] or "",
        error=row["error"],
        brand_name=row["brand_name"] or "",
        brand_synthesis=row["brand_synthesis"] or "",
        brand_logo_url=row["brand_logo_url"] or "",
        story_title=row["story_title"] or "",
        story_summary=row["story_summary"] or "",
        brand_audience=_loads_json_dict(row["brand_audience_json"]),
        inhouse_audience=_loads_json_dict(row["inhouse_audience_json"]),
        messages=_loads_json_list(row["messages_json"]),
        selected_seed=_loads_json_dict(row["selected_seed_json"]) or None,
        tweets=_loads_json_list(row["tweets_json"]) if "tweets_json" in row.keys() else [],
        post_url=row["post_url"] if "post_url" in row.keys() else None,
        user_id=row["user_id"] if "user_id" in row.keys() else None,
        distribute_sent=_loads_json_list(row["distribute_sent_json"])
        if "distribute_sent_json" in row.keys()
        else [],
        distribute_dismissed=_loads_json_list(row["distribute_dismissed_json"])
        if "distribute_dismissed_json" in row.keys()
        else [],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


class SitmarMixin:
    _SITMAR_COLS = (
        "id, company_id, story_id, title, status, error, "
        "brand_name, brand_synthesis, brand_logo_url, story_title, story_summary, "
        "brand_audience_json, inhouse_audience_json, messages_json, selected_seed_json, "
        "tweets_json, post_url, user_id, distribute_sent_json, distribute_dismissed_json, "
        "created_at, updated_at"
    )

    async def list_all_campaigns(self) -> list[SituationalCampaign]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                f"SELECT {self._SITMAR_COLS} FROM situational_campaigns ORDER BY created_at DESC"
            )
            rows = await cur.fetchall()
        return [_row_to_situational_campaign(row) for row in rows]

    _SITMAR_LIST_COLS = (
        "id, company_id, story_id, title, status, "
        "brand_name, brand_logo_url, story_title, "
        "post_url, selected_seed_json, tweets_json, "
        "created_at, updated_at"
    )

    async def list_user_campaigns(self, user_id: str) -> list[dict]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                f"SELECT {self._SITMAR_LIST_COLS} FROM situational_campaigns "
                "WHERE user_id = %s ORDER BY created_at DESC",
                (user_id,),
            )
            rows = await cur.fetchall()
        return [dict(row) for row in rows]

    async def count_user_posted_campaigns(self, user_id: str) -> int:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT COUNT(*) AS n FROM situational_campaigns "
                "WHERE user_id = %s AND status = 'posted'",
                (user_id,),
            )
            row = await cur.fetchone()
        return int(row["n"]) if row is not None else 0

    async def list_situational_campaigns(self) -> list[SituationalCampaign]:
        return await self.list_all_campaigns()

    async def get_situational_campaign(self, campaign_id: str) -> SituationalCampaign | None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                f"SELECT {self._SITMAR_COLS} FROM situational_campaigns WHERE id = %s LIMIT 1",
                (campaign_id,),
            )
            row = await cur.fetchone()
        return _row_to_situational_campaign(row) if row else None

    async def create_situational_campaign(
        self,
        *,
        company_id: str,
        story_id: str,
        title: str,
        brand_name: str = "",
        brand_synthesis: str = "",
        brand_logo_url: str = "",
        story_title: str = "",
        story_summary: str = "",
        brand_audience: dict[str, Any] | None = None,
        inhouse_audience: dict[str, Any] | None = None,
        status: str = "thinking",
        user_id: str = "",
    ) -> SituationalCampaign:
        cid = str(uuid.uuid4())
        now = time.time()
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                """
                INSERT INTO situational_campaigns (
                    id, company_id, story_id, title, status, error,
                    brand_name, brand_synthesis, brand_logo_url, story_title, story_summary,
                    brand_audience_json, inhouse_audience_json, messages_json, selected_seed_json,
                    user_id, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, NULL, %s, %s, %s, %s, %s, %s, %s, '[]', NULL, %s, %s, %s)
                """,
                (
                    cid,
                    company_id,
                    story_id,
                    title,
                    status,
                    brand_name,
                    brand_synthesis,
                    brand_logo_url,
                    story_title,
                    story_summary,
                    json.dumps(brand_audience or {}, ensure_ascii=True),
                    json.dumps(inhouse_audience or {}, ensure_ascii=True),
                    user_id,
                    now,
                    now,
                ),
            )
        campaign = await self.get_situational_campaign(cid)
        if campaign is None:
            raise RuntimeError("situational campaign create failed")
        return campaign

    async def set_sitmar_stage(
        self, campaign_id: str, *, status: str, error: str | None = None
    ) -> None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                "UPDATE situational_campaigns SET status = %s, error = %s, updated_at = %s WHERE id = %s",
                (status, error, time.time(), campaign_id),
            )

    async def set_sitmar_title(self, campaign_id: str, title: str) -> None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                "UPDATE situational_campaigns SET title = %s, updated_at = %s WHERE id = %s",
                (title, time.time(), campaign_id),
            )

    async def append_sitmar_message(self, campaign_id: str, turn: dict[str, Any]) -> None:
        """append one chat turn (assistant {message,seeds} or user {text})."""
        pool = self._require_pool()
        async with pool.connection() as conn, conn.transaction():
            cur = await conn.execute(
                "SELECT messages_json FROM situational_campaigns WHERE id = %s LIMIT 1 FOR UPDATE",
                (campaign_id,),
            )
            row = await cur.fetchone()
            if row is None:
                return
            messages = _loads_json_list(row["messages_json"])
            messages.append(turn)
            await conn.execute(
                "UPDATE situational_campaigns SET messages_json = %s, updated_at = %s WHERE id = %s",
                (json.dumps(messages, ensure_ascii=True), time.time(), campaign_id),
            )

    async def set_sitmar_selected_seed(self, campaign_id: str, seed: dict[str, Any] | None) -> None:
        pool = self._require_pool()
        payload = json.dumps(seed, ensure_ascii=True) if seed is not None else None
        async with pool.connection() as conn:
            await conn.execute(
                "UPDATE situational_campaigns SET selected_seed_json = %s, updated_at = %s WHERE id = %s",
                (payload, time.time(), campaign_id),
            )

    async def set_sitmar_tweets(self, campaign_id: str, tweets: list[dict[str, Any]]) -> None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                "UPDATE situational_campaigns SET tweets_json = %s, updated_at = %s WHERE id = %s",
                (json.dumps(tweets, ensure_ascii=True), time.time(), campaign_id),
            )

    async def set_sitmar_posted(
        self,
        campaign_id: str,
        *,
        post_url: str | None = None,
        posted_tweet_index: int,
    ) -> None:
        pool = self._require_pool()
        async with pool.connection() as conn, conn.transaction():
            cur = await conn.execute(
                "SELECT selected_seed_json FROM situational_campaigns WHERE id = %s LIMIT 1 FOR UPDATE",
                (campaign_id,),
            )
            row = await cur.fetchone()
            if row is None:
                return
            seed = _loads_json_dict(row["selected_seed_json"]) or {}
            seed["posted_tweet_index"] = posted_tweet_index
            await conn.execute(
                "UPDATE situational_campaigns SET post_url = %s, selected_seed_json = %s, "
                "status = 'posted', error = NULL, updated_at = %s WHERE id = %s",
                (post_url, json.dumps(seed, ensure_ascii=True), time.time(), campaign_id),
            )

    async def set_sitmar_post_url(self, campaign_id: str, *, post_url: str | None) -> None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            await conn.execute(
                "UPDATE situational_campaigns SET post_url = %s, updated_at = %s WHERE id = %s",
                (post_url, time.time(), campaign_id),
            )

    async def set_sitmar_final_image(
        self,
        campaign_id: str,
        *,
        image_status: str,
        image_key: str | None = None,
        image_error: str | None = None,
        image_prompt: str | None = None,
    ) -> None:
        """merge image fields into the committed selected_seed."""
        pool = self._require_pool()
        async with pool.connection() as conn, conn.transaction():
            cur = await conn.execute(
                "SELECT selected_seed_json FROM situational_campaigns WHERE id = %s LIMIT 1 FOR UPDATE",
                (campaign_id,),
            )
            row = await cur.fetchone()
            if row is None:
                return
            seed = _loads_json_dict(row["selected_seed_json"]) or {}
            seed["image_status"] = image_status
            seed["image_key"] = image_key
            seed["image_error"] = image_error
            if image_prompt is not None:
                seed["image_prompt"] = image_prompt
            await conn.execute(
                "UPDATE situational_campaigns SET selected_seed_json = %s, updated_at = %s WHERE id = %s",
                (json.dumps(seed, ensure_ascii=True), time.time(), campaign_id),
            )

    async def append_sitmar_distribute_sent(
        self,
        campaign_id: str,
        *,
        post_key: str,
        reply: str,
        post: dict[str, Any],
        sent_at: float | None = None,
    ) -> None:
        key = (post_key or "").strip()
        if not key:
            return
        pool = self._require_pool()
        async with pool.connection() as conn, conn.transaction():
            cur = await conn.execute(
                "SELECT distribute_sent_json, distribute_dismissed_json "
                "FROM situational_campaigns WHERE id = %s LIMIT 1 FOR UPDATE",
                (campaign_id,),
            )
            row = await cur.fetchone()
            if row is None:
                return
            sent = _loads_json_list(row["distribute_sent_json"])
            dismissed = _loads_json_list(row["distribute_dismissed_json"])
            entry = {
                "post_key": key,
                "sent_at": sent_at if sent_at is not None else time.time(),
                "reply": reply or "",
                "post": post or {},
            }
            sent = [e for e in sent if str(e.get("post_key") or "").strip() != key]
            sent.append(entry)
            if key not in dismissed:
                dismissed.append(key)
            now = time.time()
            await conn.execute(
                "UPDATE situational_campaigns SET distribute_sent_json = %s, "
                "distribute_dismissed_json = %s, updated_at = %s WHERE id = %s",
                (
                    json.dumps(sent, ensure_ascii=True),
                    json.dumps(dismissed, ensure_ascii=True),
                    now,
                    campaign_id,
                ),
            )

    async def append_sitmar_distribute_dismissed(self, campaign_id: str, *, post_key: str) -> None:
        key = (post_key or "").strip()
        if not key:
            return
        pool = self._require_pool()
        async with pool.connection() as conn, conn.transaction():
            cur = await conn.execute(
                "SELECT distribute_dismissed_json FROM situational_campaigns WHERE id = %s LIMIT 1 FOR UPDATE",
                (campaign_id,),
            )
            row = await cur.fetchone()
            if row is None:
                return
            dismissed = _loads_json_list(row["distribute_dismissed_json"])
            if key in dismissed:
                return
            dismissed.append(key)
            await conn.execute(
                "UPDATE situational_campaigns SET distribute_dismissed_json = %s, updated_at = %s "
                "WHERE id = %s",
                (json.dumps(dismissed, ensure_ascii=True), time.time(), campaign_id),
            )

    async def delete_situational_campaign(self, campaign_id: str) -> bool:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "DELETE FROM situational_campaigns WHERE id = %s",
                (campaign_id,),
            )
            return (cur.rowcount or 0) > 0
