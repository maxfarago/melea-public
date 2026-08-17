"""company persistence models and methods."""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Mapping

from api.db.common import _loads_json_dict, _loads_json_list


@dataclass
class CompanyStage:
    status: str | None = None
    error: str | None = None
    model: str | None = None
    updated_at: float | None = None


@dataclass
class CompanySynthesis:
    homepage_summary: str | None = None
    website_synthesis_terms: list[str] = field(default_factory=list)
    website_synthesis_primary_term: str | None = None
    website_synthesis_selected_term: str | None = None
    website_synthesis_prompt: str | None = None
    website_synthesis_model: str | None = None
    website_synthesis_source: str | None = None
    website_synthesis_business_name: str | None = None
    website_synthesis_updated_at: float | None = None
    brand_synthesis: str | None = None
    brand_synthesis_model: str | None = None
    brand_synthesis_updated_at: float | None = None
    brand_embedding_input: str | None = None
    brand_embedding_vector: Any | None = None
    brand_embedding_model: str | None = None
    brand_embedding_version: str | None = None
    brand_embedding_updated_at: float | None = None


@dataclass
class CompanyLinkedin:
    url: str | None = None
    raw_text: str | None = None
    is_valid: bool | None = None
    validation_reason: str | None = None
    structured: dict[str, Any] | None = None
    extraction_model: str | None = None
    enriched_at: float | None = None


@dataclass
class CompanyAudience:
    id: str
    title: str | None = None
    description: str | None = None
    extra: dict[str, Any] | None = None
    model: str | None = None
    generated_at: float | None = None
    match_audience_id: str | None = None
    match_title: str | None = None
    match_description: str | None = None
    match_score: float | None = None
    match_reason: str | None = None
    match_model: str | None = None
    match_generated_at: float | None = None


@dataclass
class Company:
    id: str
    website_url: str
    business_name: str | None = None
    logo_url: str | None = None
    twitter_handle: str | None = None
    twitter_handle_manual: bool = False
    socials: list[dict[str, Any]] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    stages: dict[str, CompanyStage] = field(default_factory=dict)
    synthesis: CompanySynthesis | None = None
    linkedin: CompanyLinkedin | None = None
    audiences: list[CompanyAudience] = field(default_factory=list)

    def _stage(self, name: str) -> CompanyStage:
        return self.stages.get(name) or CompanyStage()

    def to_dict(self) -> dict[str, Any]:
        syn = self.synthesis or CompanySynthesis()
        li = self.linkedin or CompanyLinkedin()

        audience_list: list[dict[str, Any]] = []
        for a in self.audiences:
            entry: dict[str, Any] = {"title": a.title, "description": a.description}
            if a.extra:
                entry.update(a.extra)
            if a.match_audience_id:
                entry["match"] = {
                    "audience_id": a.match_audience_id,
                    "title": a.match_title,
                    "description": a.match_description,
                    "score": a.match_score,
                    "reason": a.match_reason,
                }
            audience_list.append(entry)

        first_aud = self.audiences[0] if self.audiences else None
        first_matched = next((a for a in self.audiences if a.match_audience_id), None)

        return {
            "id": self.id,
            "website_url": self.website_url,
            "business_name": self.business_name,
            "twitter_handle": self.twitter_handle,
            "twitter_handle_manual": self.twitter_handle_manual,
            "website_synthesis_terms": syn.website_synthesis_terms or [],
            "website_synthesis_primary_term": syn.website_synthesis_primary_term,
            "website_synthesis_selected_term": syn.website_synthesis_selected_term,
            "website_synthesis_status": self._stage("website_synthesis").status,
            "website_synthesis_error": self._stage("website_synthesis").error,
            "website_synthesis_prompt": syn.website_synthesis_prompt,
            "website_synthesis_model": syn.website_synthesis_model,
            "website_synthesis_source": syn.website_synthesis_source,
            "website_synthesis_business_name": syn.website_synthesis_business_name,
            "website_synthesis_business_logo_url": self.logo_url,
            "homepage_summary": syn.homepage_summary,
            "website_synthesis_updated_at": syn.website_synthesis_updated_at,
            "linkedin_company_url": li.url,
            "linkedin_company_text": li.raw_text,
            "linkedin_company_valid": li.is_valid,
            "linkedin_company_validation_reason": li.validation_reason,
            "linkedin_company_structured": li.structured,
            "linkedin_company_extraction_model": li.extraction_model,
            "linkedin_company_enriched_at": li.enriched_at,
            "linkedin_company_status": self._stage("linkedin").status,
            "linkedin_company_error": self._stage("linkedin").error,
            "linkedin_company_updated_at": self._stage("linkedin").updated_at,
            "audience_status": self._stage("audience").status,
            "audience_error": self._stage("audience").error,
            "audience": audience_list,
            "audience_model": first_aud.model if first_aud else None,
            "audience_generated_at": first_aud.generated_at if first_aud else None,
            "audience_match_status": self._stage("audience_match").status,
            "audience_match_error": self._stage("audience_match").error,
            "audience_match_model": first_matched.match_model if first_matched else None,
            "audience_match_generated_at": first_matched.match_generated_at
            if first_matched
            else None,
            "audience_trends_status": self._stage("audience_trends").status,
            "audience_trends_error": self._stage("audience_trends").error,
            "audience_trends_updated_at": self._stage("audience_trends").updated_at,
            "brand_synthesis": syn.brand_synthesis,
            "brand_synthesis_model": syn.brand_synthesis_model,
            "brand_synthesis_status": self._stage("brand_synthesis").status,
            "brand_synthesis_error": self._stage("brand_synthesis").error,
            "brand_synthesis_updated_at": syn.brand_synthesis_updated_at,
            "brand_scoring_status": self._stage("brand_scoring").status,
            "brand_scoring_error": self._stage("brand_scoring").error,
            "has_profile": bool(
                syn.homepage_summary
                or self._stage("website_synthesis").status == "done"
            ),
            "socials": self.socials,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def _parse_socials(raw: Any) -> list[dict[str, Any]]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [s for s in parsed if isinstance(s, dict)]
    except (json.JSONDecodeError, TypeError):
        pass
    return []


def _row_to_synthesis(row: Mapping[str, Any]) -> CompanySynthesis:
    return CompanySynthesis(
        homepage_summary=row["homepage_summary"],
        website_synthesis_terms=_loads_json_list(row["website_synthesis_terms_json"]),
        website_synthesis_primary_term=row["website_synthesis_primary_term"],
        website_synthesis_selected_term=row["website_synthesis_selected_term"],
        website_synthesis_prompt=row["website_synthesis_prompt"],
        website_synthesis_model=row["website_synthesis_model"],
        website_synthesis_source=row["website_synthesis_source"],
        website_synthesis_business_name=row["website_synthesis_business_name"],
        website_synthesis_updated_at=row["website_synthesis_updated_at"],
        brand_synthesis=row["brand_synthesis"],
        brand_synthesis_model=row["brand_synthesis_model"],
        brand_synthesis_updated_at=row["brand_synthesis_updated_at"],
        brand_embedding_input=row["brand_embedding_input"],
        brand_embedding_vector=row["brand_embedding_vector"],
        brand_embedding_model=row["brand_embedding_model"],
        brand_embedding_version=row["brand_embedding_version"],
        brand_embedding_updated_at=row["brand_embedding_updated_at"],
    )


def _row_to_linkedin(row: Mapping[str, Any]) -> CompanyLinkedin:
    is_valid = row["is_valid"]
    return CompanyLinkedin(
        url=row["url"],
        raw_text=row["raw_text"],
        is_valid=bool(int(is_valid)) if is_valid is not None else None,
        validation_reason=row["validation_reason"],
        structured=_loads_json_dict(row["structured_json"]),
        extraction_model=row["extraction_model"],
        enriched_at=row["enriched_at"],
    )


def _row_to_audience(row: Mapping[str, Any]) -> CompanyAudience:
    return CompanyAudience(
        id=row["id"],
        title=row["title"],
        description=row["description"],
        extra=_loads_json_dict(row["extra_json"]),
        model=row["model"],
        generated_at=row["generated_at"],
        match_audience_id=row["match_audience_id"],
        match_title=row["match_title"],
        match_description=row["match_description"],
        match_score=row["match_score"],
        match_reason=row["match_reason"],
        match_model=row["match_model"],
        match_generated_at=row["match_generated_at"],
    )


def _build_company(
    row: Mapping[str, Any],
    stages: dict[str, CompanyStage],
    synthesis: CompanySynthesis | None,
    linkedin: CompanyLinkedin | None,
    audiences: list[CompanyAudience],
) -> Company:
    return Company(
        id=row["id"],
        website_url=row["website_url"],
        business_name=row["business_name"],
        logo_url=row["logo_url"],
        twitter_handle=row["twitter_handle"],
        twitter_handle_manual=bool(int(row["twitter_handle_manual"] or 0)),
        socials=_parse_socials(row["socials_json"]),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        stages=stages,
        synthesis=synthesis,
        linkedin=linkedin,
        audiences=audiences,
    )


class CompanyMixin:
    async def _load_satellites(
        self,
        conn: Any,
        company_id: str,
    ) -> tuple[
        dict[str, CompanyStage],
        CompanySynthesis | None,
        CompanyLinkedin | None,
        list[CompanyAudience],
    ]:
        cur = await conn.execute(
            "SELECT * FROM company_stages WHERE company_id = %s",
            (company_id,),
        )
        stages = {
            r["stage"]: CompanyStage(
                status=r["status"],
                error=r["error"],
                model=r["model"],
                updated_at=r["updated_at"],
            )
            for r in await cur.fetchall()
        }

        cur = await conn.execute(
            "SELECT * FROM company_synthesis WHERE company_id = %s",
            (company_id,),
        )
        syn_row = await cur.fetchone()
        synthesis = _row_to_synthesis(syn_row) if syn_row else None

        cur = await conn.execute(
            "SELECT * FROM company_linkedin WHERE company_id = %s",
            (company_id,),
        )
        li_row = await cur.fetchone()
        linkedin = _row_to_linkedin(li_row) if li_row else None

        cur = await conn.execute(
            """
            SELECT * FROM company_audiences
            WHERE company_id = %s
            ORDER BY generated_at NULLS LAST, id
            """,
            (company_id,),
        )
        audiences = [_row_to_audience(r) for r in await cur.fetchall()]
        return stages, synthesis, linkedin, audiences

    async def list_companies(self) -> list[Company]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute("SELECT * FROM companies ORDER BY updated_at DESC")
            company_rows = await cur.fetchall()
            if not company_rows:
                return []

            cur = await conn.execute("SELECT * FROM company_stages")
            stages_map: dict[str, dict[str, CompanyStage]] = {}
            for r in await cur.fetchall():
                stages_map.setdefault(r["company_id"], {})[r["stage"]] = CompanyStage(
                    status=r["status"],
                    error=r["error"],
                    model=r["model"],
                    updated_at=r["updated_at"],
                )

            cur = await conn.execute("SELECT * FROM company_synthesis")
            syn_map = {r["company_id"]: _row_to_synthesis(r) for r in await cur.fetchall()}

            cur = await conn.execute("SELECT * FROM company_linkedin")
            li_map = {r["company_id"]: _row_to_linkedin(r) for r in await cur.fetchall()}

            cur = await conn.execute(
                "SELECT * FROM company_audiences ORDER BY generated_at NULLS LAST, id"
            )
            aud_map: dict[str, list[CompanyAudience]] = {}
            for r in await cur.fetchall():
                aud_map.setdefault(r["company_id"], []).append(_row_to_audience(r))

            return [
                _build_company(
                    row,
                    stages_map.get(row["id"], {}),
                    syn_map.get(row["id"]),
                    li_map.get(row["id"]),
                    aud_map.get(row["id"], []),
                )
                for row in company_rows
            ]

    async def list_companies_summary(self) -> list[dict[str, Any]]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT id, website_url, business_name, logo_url, created_at, updated_at
                FROM companies
                ORDER BY updated_at DESC
                """
            )
            company_rows = await cur.fetchall()
            if not company_rows:
                return []

            cur = await conn.execute("SELECT company_id, stage, status FROM company_stages")
            stage_map: dict[str, dict[str, str | None]] = {}
            for row in await cur.fetchall():
                cid = str(row["company_id"])
                stage_map.setdefault(cid, {})[str(row["stage"])] = row["status"]

            summaries: list[dict[str, Any]] = []
            for row in company_rows:
                cid = str(row["id"])
                summaries.append(
                    {
                        "id": cid,
                        "website_url": row["website_url"],
                        "business_name": row["business_name"],
                        "logo_url": row["logo_url"],
                        "created_at": row["created_at"],
                        "updated_at": row["updated_at"],
                        "stage_summary": stage_map.get(cid, {}),
                    }
                )
            return summaries

    async def get_company(self, company_id: str) -> Company | None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT * FROM companies WHERE id = %s",
                (company_id,),
            )
            row = await cur.fetchone()
            if not row:
                return None
            stages, syn, li, auds = await self._load_satellites(conn, company_id)
            return _build_company(row, stages, syn, li, auds)

    async def get_company_by_url(self, website_url: str) -> Company | None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT * FROM companies WHERE website_url = %s",
                (website_url,),
            )
            row = await cur.fetchone()
            if not row:
                return None
            cid = row["id"]
            stages, syn, li, auds = await self._load_satellites(conn, cid)
            return _build_company(row, stages, syn, li, auds)

    async def get_company_stages(self, company_id: str) -> dict[str, CompanyStage]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT * FROM company_stages WHERE company_id = %s",
                (company_id,),
            )
            return {
                r["stage"]: CompanyStage(
                    status=r["status"],
                    error=r["error"],
                    model=r["model"],
                    updated_at=r["updated_at"],
                )
                for r in await cur.fetchall()
            }

    async def get_company_synthesis(self, company_id: str) -> CompanySynthesis | None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT * FROM company_synthesis WHERE company_id = %s",
                (company_id,),
            )
            row = await cur.fetchone()
            return _row_to_synthesis(row) if row else None

    async def get_company_linkedin(self, company_id: str) -> CompanyLinkedin | None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT * FROM company_linkedin WHERE company_id = %s",
                (company_id,),
            )
            row = await cur.fetchone()
            return _row_to_linkedin(row) if row else None

    async def get_company_audiences(self, company_id: str) -> list[CompanyAudience]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT * FROM company_audiences
                WHERE company_id = %s
                ORDER BY generated_at NULLS LAST, id
                """,
                (company_id,),
            )
            return [_row_to_audience(r) for r in await cur.fetchall()]

    async def list_companies_for_embedding(self) -> list[dict[str, Any]]:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT c.id, c.website_url, c.business_name,
                       s.website_synthesis_business_name,
                       s.brand_synthesis,
                       s.brand_embedding_input, s.brand_embedding_vector,
                       s.brand_embedding_model, s.brand_embedding_version,
                       s.brand_embedding_updated_at
                FROM companies c
                LEFT JOIN company_synthesis s ON s.company_id = c.id
                ORDER BY c.updated_at DESC
                """
            )
            rows = [dict(r) for r in await cur.fetchall()]

            cur = await conn.execute(
                """
                SELECT company_id, title, description, extra_json,
                       match_audience_id, match_title, match_description,
                       match_score, match_reason
                FROM company_audiences
                ORDER BY generated_at NULLS LAST, id
                """
            )
            aud_by_company: dict[str, list[dict[str, Any]]] = {}
            for r in await cur.fetchall():
                entry: dict[str, Any] = {"title": r["title"], "description": r["description"]}
                extra = _loads_json_dict(r["extra_json"])
                if extra:
                    entry.update(extra)
                if r["match_audience_id"]:
                    entry["match"] = {
                        "audience_id": r["match_audience_id"],
                        "title": r["match_title"],
                        "description": r["match_description"],
                        "score": r["match_score"],
                        "reason": r["match_reason"],
                    }
                aud_by_company.setdefault(r["company_id"], []).append(entry)

            for row in rows:
                row["audience_json"] = json.dumps(
                    aud_by_company.get(row["id"], []), ensure_ascii=True
                )
            return rows

    async def get_company_for_embedding(self, company_id: str) -> dict[str, Any] | None:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT c.id, c.website_url, c.business_name,
                       s.website_synthesis_business_name,
                       s.brand_synthesis,
                       s.brand_embedding_input, s.brand_embedding_vector,
                       s.brand_embedding_model, s.brand_embedding_version,
                       s.brand_embedding_updated_at
                FROM companies c
                LEFT JOIN company_synthesis s ON s.company_id = c.id
                WHERE c.id = %s
                """,
                (company_id,),
            )
            row = await cur.fetchone()
            if not row:
                return None
            result = dict(row)

            cur = await conn.execute(
                """
                SELECT title, description, extra_json,
                       match_audience_id, match_title, match_description,
                       match_score, match_reason
                FROM company_audiences
                WHERE company_id = %s
                ORDER BY generated_at NULLS LAST, id
                """,
                (company_id,),
            )
            aud_list: list[dict[str, Any]] = []
            for r in await cur.fetchall():
                entry: dict[str, Any] = {"title": r["title"], "description": r["description"]}
                extra = _loads_json_dict(r["extra_json"])
                if extra:
                    entry.update(extra)
                if r["match_audience_id"]:
                    entry["match"] = {
                        "audience_id": r["match_audience_id"],
                        "title": r["match_title"],
                        "description": r["match_description"],
                        "score": r["match_score"],
                        "reason": r["match_reason"],
                    }
                aud_list.append(entry)

            result["audience_json"] = json.dumps(aud_list, ensure_ascii=True)
            return result

    async def store_company_embedding(
        self,
        company_id: str,
        *,
        input_text: str,
        vector: list[float],
        model: str,
        version: str,
    ) -> None:
        pool = self._require_pool()
        now = time.time()
        async with pool.connection() as conn, conn.transaction():
            await conn.execute(
                """
                INSERT INTO company_synthesis (
                    company_id,
                    brand_embedding_input, brand_embedding_vector,
                    brand_embedding_model, brand_embedding_version,
                    brand_embedding_updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (company_id) DO UPDATE SET
                    brand_embedding_input = excluded.brand_embedding_input,
                    brand_embedding_vector = excluded.brand_embedding_vector,
                    brand_embedding_model = excluded.brand_embedding_model,
                    brand_embedding_version = excluded.brand_embedding_version,
                    brand_embedding_updated_at = excluded.brand_embedding_updated_at
                """,
                (company_id, input_text, vector, model, version, now),
            )
            await conn.execute(
                "UPDATE companies SET updated_at = %s WHERE id = %s",
                (now, company_id),
            )

    async def create_company(
        self,
        website_url: str,
        twitter_handle: str | None = None,
    ) -> Company:
        pool = self._require_pool()
        async with pool.connection() as conn:
            cur = await conn.execute(
                "SELECT * FROM companies WHERE website_url = %s",
                (website_url,),
            )
            row = await cur.fetchone()
            if row:
                stages, syn, li, auds = await self._load_satellites(conn, row["id"])
                return _build_company(row, stages, syn, li, auds)

            cid = str(uuid.uuid4())
            now = time.time()
            async with conn.transaction():
                await conn.execute(
                    """
                    INSERT INTO companies (
                        id, website_url, twitter_handle, twitter_handle_manual,
                        created_at, updated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s)
                    """,
                    (cid, website_url, twitter_handle, 0, now, now),
                )
            return Company(
                id=cid,
                website_url=website_url,
                twitter_handle=twitter_handle,
                created_at=now,
                updated_at=now,
            )

    async def set_stage(
        self,
        company_id: str,
        stage: str,
        *,
        status: str,
        error: str | None = None,
        model: str | None = None,
    ) -> None:
        pool = self._require_pool()
        now = time.time()
        async with pool.connection() as conn, conn.transaction():
            await conn.execute(
                """
                INSERT INTO company_stages (company_id, stage, status, error, model, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (company_id, stage) DO UPDATE SET
                    status = excluded.status,
                    error = excluded.error,
                    model = COALESCE(excluded.model, company_stages.model),
                    updated_at = excluded.updated_at
                """,
                (company_id, stage, status, error, model, now),
            )
            await conn.execute(
                "UPDATE companies SET updated_at = %s WHERE id = %s",
                (now, company_id),
            )

    async def set_company_website_synthesis_stage(
        self,
        company_id: str,
        *,
        status: str,
        error: str | None = None,
    ) -> None:
        await self.set_stage(company_id, "website_synthesis", status=status, error=error)

    async def set_audience_trends_stage(
        self,
        company_id: str,
        *,
        status: str,
        error: str | None = None,
    ) -> None:
        await self.set_stage(company_id, "audience_trends", status=status, error=error)

    async def set_linkedin_company_stage(
        self,
        company_id: str,
        *,
        status: str,
        error: str | None = None,
    ) -> None:
        await self.set_stage(company_id, "linkedin", status=status, error=error)

    async def set_audience_stage(
        self,
        company_id: str,
        *,
        status: str,
        error: str | None = None,
    ) -> None:
        await self.set_stage(company_id, "audience", status=status, error=error)

    async def set_audience_match_stage(
        self,
        company_id: str,
        *,
        status: str,
        error: str | None = None,
    ) -> None:
        await self.set_stage(company_id, "audience_match", status=status, error=error)

    async def set_brand_synthesis_stage(
        self,
        company_id: str,
        *,
        status: str,
        error: str | None = None,
    ) -> None:
        await self.set_stage(company_id, "brand_synthesis", status=status, error=error)

    async def set_brand_scoring_stage(
        self,
        company_id: str,
        *,
        status: str,
        error: str | None = None,
    ) -> None:
        await self.set_stage(company_id, "brand_scoring", status=status, error=error)

    async def update_company_website_synthesis_context(
        self,
        company_id: str,
        *,
        terms: list[str],
        primary_term: str | None,
        selected_term: str | None,
        prompt: str | None = None,
        model: str | None = None,
        source: str | None = None,
        business_name: str | None = None,
        business_logo_url: str | None = None,
        brand_summary: str | None = None,
    ) -> None:
        pool = self._require_pool()
        now = time.time()
        async with pool.connection() as conn, conn.transaction():
            await conn.execute(
                """
                INSERT INTO company_synthesis (
                    company_id,
                    website_synthesis_terms_json,
                    website_synthesis_primary_term,
                    website_synthesis_selected_term,
                    website_synthesis_prompt,
                    website_synthesis_model,
                    website_synthesis_source,
                    website_synthesis_business_name,
                    homepage_summary,
                    website_synthesis_updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (company_id) DO UPDATE SET
                    website_synthesis_terms_json = excluded.website_synthesis_terms_json,
                    website_synthesis_primary_term = excluded.website_synthesis_primary_term,
                    website_synthesis_selected_term = excluded.website_synthesis_selected_term,
                    website_synthesis_prompt = COALESCE(
                        excluded.website_synthesis_prompt, company_synthesis.website_synthesis_prompt
                    ),
                    website_synthesis_model = COALESCE(
                        excluded.website_synthesis_model, company_synthesis.website_synthesis_model
                    ),
                    website_synthesis_source = COALESCE(
                        excluded.website_synthesis_source, company_synthesis.website_synthesis_source
                    ),
                    website_synthesis_business_name = COALESCE(
                        excluded.website_synthesis_business_name,
                        company_synthesis.website_synthesis_business_name
                    ),
                    homepage_summary = COALESCE(
                        excluded.homepage_summary, company_synthesis.homepage_summary
                    ),
                    website_synthesis_updated_at = excluded.website_synthesis_updated_at
                """,
                (
                    company_id,
                    json.dumps(terms, ensure_ascii=True),
                    primary_term,
                    selected_term,
                    prompt,
                    model,
                    source,
                    business_name,
                    brand_summary,
                    now,
                ),
            )
            if business_name or business_logo_url:
                sets = ["updated_at = %s"]
                params: list[Any] = [now]
                if business_name:
                    sets.append("business_name = COALESCE(%s, business_name)")
                    params.append(business_name)
                if business_logo_url:
                    sets.append("logo_url = COALESCE(%s, logo_url)")
                    params.append(business_logo_url)
                params.append(company_id)
                await conn.execute(
                    f"UPDATE companies SET {', '.join(sets)} WHERE id = %s",
                    tuple(params),
                )
            else:
                await conn.execute(
                    "UPDATE companies SET updated_at = %s WHERE id = %s",
                    (now, company_id),
                )

    async def update_linkedin_company_payload(
        self,
        company_id: str,
        *,
        url: str,
        text: str,
    ) -> None:
        pool = self._require_pool()
        now = time.time()
        async with pool.connection() as conn, conn.transaction():
            await conn.execute(
                """
                INSERT INTO company_linkedin (company_id, url, raw_text)
                VALUES (%s, %s, %s)
                ON CONFLICT (company_id) DO UPDATE SET
                    url = excluded.url, raw_text = excluded.raw_text
                """,
                (company_id, url, text),
            )
            await conn.execute(
                """
                INSERT INTO company_stages (company_id, stage, status, error, updated_at)
                VALUES (%s, 'linkedin', 'done', NULL, %s)
                ON CONFLICT (company_id, stage) DO UPDATE SET
                    status = 'done', error = NULL, updated_at = excluded.updated_at
                """,
                (company_id, now),
            )
            await conn.execute(
                "UPDATE companies SET updated_at = %s WHERE id = %s",
                (now, company_id),
            )

    async def set_linkedin_company_enrichment(
        self,
        company_id: str,
        *,
        is_valid: bool,
        validation_reason: str | None = None,
        structured: dict[str, Any] | None = None,
        extraction_model: str | None = None,
    ) -> None:
        pool = self._require_pool()
        now = time.time()
        async with pool.connection() as conn, conn.transaction():
            await conn.execute(
                """
                INSERT INTO company_linkedin (
                    company_id, is_valid, validation_reason,
                    structured_json, extraction_model, enriched_at
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (company_id) DO UPDATE SET
                    is_valid = excluded.is_valid,
                    validation_reason = excluded.validation_reason,
                    structured_json = excluded.structured_json,
                    extraction_model = excluded.extraction_model,
                    enriched_at = excluded.enriched_at
                """,
                (
                    company_id,
                    1 if is_valid else 0,
                    validation_reason,
                    json.dumps(structured, ensure_ascii=True) if structured else None,
                    extraction_model,
                    now,
                ),
            )
            await conn.execute(
                """
                INSERT INTO company_stages (company_id, stage, model, updated_at)
                VALUES (%s, 'linkedin', %s, %s)
                ON CONFLICT (company_id, stage) DO UPDATE SET
                    model = COALESCE(excluded.model, company_stages.model),
                    updated_at = excluded.updated_at
                """,
                (company_id, extraction_model, now),
            )
            await conn.execute(
                "UPDATE companies SET updated_at = %s WHERE id = %s",
                (now, company_id),
            )

    async def set_audience_result(
        self,
        company_id: str,
        *,
        audiences: list[dict[str, Any]],
        model: str,
    ) -> None:
        pool = self._require_pool()
        now = time.time()
        async with pool.connection() as conn, conn.transaction():
            cur = await conn.execute(
                "SELECT id FROM companies WHERE id = %s FOR UPDATE",
                (company_id,),
            )
            if await cur.fetchone() is None:
                return
            await conn.execute(
                "DELETE FROM company_audiences WHERE company_id = %s",
                (company_id,),
            )
            for entry in audiences or []:
                aid = str(uuid.uuid4())
                title = entry.get("title")
                description = entry.get("description")
                extra = {
                    k: v for k, v in entry.items() if k not in ("title", "description", "match")
                }
                await conn.execute(
                    """
                    INSERT INTO company_audiences (
                        id, company_id, title, description, extra_json,
                        model, generated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        aid,
                        company_id,
                        title,
                        description,
                        json.dumps(extra, ensure_ascii=True) if extra else None,
                        model,
                        now,
                    ),
                )
            await conn.execute(
                """
                INSERT INTO company_stages (company_id, stage, status, error, model, updated_at)
                VALUES (%s, 'audience', 'done', NULL, %s, %s)
                ON CONFLICT (company_id, stage) DO UPDATE SET
                    status = 'done', error = NULL,
                    model = excluded.model, updated_at = excluded.updated_at
                """,
                (company_id, model, now),
            )
            await conn.execute(
                """
                INSERT INTO company_stages (company_id, stage, status, error, model, updated_at)
                VALUES (%s, 'audience_match', NULL, NULL, NULL, %s)
                ON CONFLICT (company_id, stage) DO UPDATE SET
                    status = NULL, error = NULL, model = NULL,
                    updated_at = excluded.updated_at
                """,
                (company_id, now),
            )
            await conn.execute(
                "UPDATE companies SET updated_at = %s WHERE id = %s",
                (now, company_id),
            )

    async def set_audience_match_result(
        self,
        company_id: str,
        *,
        audiences: list[dict[str, Any]],
        model: str,
    ) -> None:
        pool = self._require_pool()
        now = time.time()
        async with pool.connection() as conn, conn.transaction():
            cur = await conn.execute(
                "SELECT id FROM companies WHERE id = %s FOR UPDATE",
                (company_id,),
            )
            if await cur.fetchone() is None:
                return
            orig_cur = await conn.execute(
                """
                SELECT model, generated_at FROM company_audiences
                WHERE company_id = %s
                LIMIT 1
                """,
                (company_id,),
            )
            orig = await orig_cur.fetchone()
            orig_model = orig["model"] if orig else None
            orig_generated_at = orig["generated_at"] if orig else None

            await conn.execute(
                "DELETE FROM company_audiences WHERE company_id = %s",
                (company_id,),
            )
            for entry in audiences or []:
                aid = str(uuid.uuid4())
                title = entry.get("title")
                description = entry.get("description")
                match = entry.get("match") if isinstance(entry.get("match"), dict) else None
                extra = {
                    k: v for k, v in entry.items() if k not in ("title", "description", "match")
                }

                m_aid = m_title = m_desc = m_reason = None
                m_score: float | None = None
                if match:
                    m_aid = match.get("audience_id")
                    m_title = match.get("title")
                    m_desc = match.get("description")
                    m_score = match.get("score")
                    m_reason = match.get("reason")

                await conn.execute(
                    """
                    INSERT INTO company_audiences (
                        id, company_id, title, description, extra_json,
                        model, generated_at,
                        match_audience_id, match_title, match_description,
                        match_score, match_reason, match_model, match_generated_at
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        aid,
                        company_id,
                        title,
                        description,
                        json.dumps(extra, ensure_ascii=True) if extra else None,
                        orig_model,
                        orig_generated_at,
                        m_aid,
                        m_title,
                        m_desc,
                        m_score,
                        m_reason,
                        model if m_aid else None,
                        now if m_aid else None,
                    ),
                )
            await conn.execute(
                """
                INSERT INTO company_stages (company_id, stage, status, error, model, updated_at)
                VALUES (%s, 'audience_match', 'done', NULL, %s, %s)
                ON CONFLICT (company_id, stage) DO UPDATE SET
                    status = 'done', error = NULL,
                    model = excluded.model, updated_at = excluded.updated_at
                """,
                (company_id, model, now),
            )
            await conn.execute(
                "UPDATE companies SET updated_at = %s WHERE id = %s",
                (now, company_id),
            )

    async def set_brand_synthesis_result(
        self,
        company_id: str,
        *,
        synthesis: str,
        model: str,
    ) -> None:
        pool = self._require_pool()
        now = time.time()
        async with pool.connection() as conn, conn.transaction():
            await conn.execute(
                """
                INSERT INTO company_synthesis (
                    company_id, brand_synthesis, brand_synthesis_model, brand_synthesis_updated_at
                )
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (company_id) DO UPDATE SET
                    brand_synthesis = excluded.brand_synthesis,
                    brand_synthesis_model = excluded.brand_synthesis_model,
                    brand_synthesis_updated_at = excluded.brand_synthesis_updated_at
                """,
                (company_id, synthesis, model, now),
            )
            await conn.execute(
                """
                INSERT INTO company_stages (company_id, stage, status, error, model, updated_at)
                VALUES (%s, 'brand_synthesis', 'done', NULL, %s, %s)
                ON CONFLICT (company_id, stage) DO UPDATE SET
                    status = 'done', error = NULL,
                    model = excluded.model, updated_at = excluded.updated_at
                """,
                (company_id, model, now),
            )
            await conn.execute(
                "UPDATE companies SET updated_at = %s WHERE id = %s",
                (now, company_id),
            )

    async def set_company_socials(
        self,
        company_id: str,
        socials: list[dict[str, Any]],
        *,
        twitter_handle_manual: bool = False,
    ) -> None:
        twitter_handle: str | None = None
        for entry in socials:
            if not isinstance(entry, dict):
                continue
            platform = (entry.get("platform") or "").strip().lower()
            if platform in ("twitter", "twitter.com", "x.com"):
                handle = (entry.get("handle") or "").strip()
                if handle:
                    twitter_handle = handle.lstrip("@")
                    break

        pool = self._require_pool()
        now = time.time()
        async with pool.connection() as conn:
            await conn.execute(
                """
                UPDATE companies
                SET socials_json = %s,
                    twitter_handle = %s,
                    twitter_handle_manual = %s,
                    updated_at = %s
                WHERE id = %s
                """,
                (
                    json.dumps(socials),
                    twitter_handle,
                    1 if (twitter_handle and twitter_handle_manual) else 0,
                    now,
                    company_id,
                ),
            )

    async def find_twitter_handle_conflict(
        self,
        handle: str,
        exclude_company_id: str,
    ) -> dict[str, Any] | None:
        pool = self._require_pool()
        normalized = handle.strip().lstrip("@").lower()
        async with pool.connection() as conn:
            cur = await conn.execute(
                """
                SELECT id, website_url FROM companies
                WHERE LOWER(LTRIM(twitter_handle, '@')) = %s
                  AND id != %s
                LIMIT 1
                """,
                (normalized, exclude_company_id),
            )
            row = await cur.fetchone()
        return dict(row) if row else None

    async def clear_company_socials(self, company_id: str) -> None:
        pool = self._require_pool()
        now = time.time()
        async with pool.connection() as conn:
            await conn.execute(
                """
                UPDATE companies SET socials_json = NULL, twitter_handle = NULL,
                    twitter_handle_manual = 0, updated_at = %s
                WHERE id = %s
                """,
                (now, company_id),
            )

    async def reset_company_homepage_crawl(self, company_id: str) -> None:
        pool = self._require_pool()
        now = time.time()
        pending_stages = [
            "website_synthesis",
            "linkedin",
            "audience",
            "audience_trends",
            "brand_synthesis",
            "brand_scoring",
        ]
        async with pool.connection() as conn, conn.transaction():
            cur = await conn.execute(
                "SELECT id FROM companies WHERE id = %s FOR UPDATE",
                (company_id,),
            )
            if await cur.fetchone() is None:
                return
            await conn.execute(
                "DELETE FROM brand_story_scores WHERE brand_id = %s",
                (company_id,),
            )
            await conn.execute(
                "DELETE FROM company_stages WHERE company_id = %s",
                (company_id,),
            )
            await conn.execute(
                "DELETE FROM company_synthesis WHERE company_id = %s",
                (company_id,),
            )
            await conn.execute(
                "DELETE FROM company_linkedin WHERE company_id = %s",
                (company_id,),
            )
            await conn.execute(
                "DELETE FROM company_audiences WHERE company_id = %s",
                (company_id,),
            )
            await conn.execute(
                """
                UPDATE companies SET
                    business_name = NULL,
                    logo_url = NULL,
                    updated_at = %s
                WHERE id = %s
                """,
                (now, company_id),
            )
            for stage in pending_stages:
                await conn.execute(
                    """
                    INSERT INTO company_stages (company_id, stage, status, updated_at)
                    VALUES (%s, %s, 'pending', %s)
                    """,
                    (company_id, stage, now),
                )

    async def delete_company(self, company_id: str) -> bool:
        pool = self._require_pool()
        async with pool.connection() as conn, conn.transaction():
            cur = await conn.execute(
                "SELECT id FROM companies WHERE id = %s FOR UPDATE",
                (company_id,),
            )
            if await cur.fetchone() is None:
                return False
            await conn.execute(
                "DELETE FROM brand_story_scores WHERE brand_id = %s",
                (company_id,),
            )
            await conn.execute(
                "DELETE FROM company_stages WHERE company_id = %s",
                (company_id,),
            )
            await conn.execute(
                "DELETE FROM company_synthesis WHERE company_id = %s",
                (company_id,),
            )
            await conn.execute(
                "DELETE FROM company_linkedin WHERE company_id = %s",
                (company_id,),
            )
            await conn.execute(
                "DELETE FROM company_audiences WHERE company_id = %s",
                (company_id,),
            )
            cur = await conn.execute(
                "DELETE FROM companies WHERE id = %s",
                (company_id,),
            )
            return (cur.rowcount or 0) > 0
