from fastapi import APIRouter

from api.routes.companies import (
    delete_company,
    get_companies_audience_trends,
    list_ops_companies,
    put_company_socials,
    rediscover_company_socials,
    refresh_audience,
    refresh_audience_match,
    refresh_audience_trends,
    refresh_brand_scoring,
    refresh_brand_synthesis,
    refresh_linkedin_company,
    refresh_website_synthesis,
)

router = APIRouter()
router.add_api_route("/companies", list_ops_companies, methods=["GET"])
router.add_api_route("/companies/audience-trends", get_companies_audience_trends, methods=["GET"])
router.add_api_route("/company/{company_id}", delete_company, methods=["DELETE"], status_code=204)
router.add_api_route("/company/{company_id}/socials", put_company_socials, methods=["PUT"])
router.add_api_route(
    "/company/{company_id}/socials/rediscover",
    rediscover_company_socials,
    methods=["POST"],
)
router.add_api_route(
    "/company/{company_id}/website-synthesis/refresh",
    refresh_website_synthesis,
    methods=["POST"],
)
router.add_api_route("/company/{company_id}/audience/refresh", refresh_audience, methods=["POST"])
router.add_api_route(
    "/company/{company_id}/audience-match/refresh",
    refresh_audience_match,
    methods=["POST"],
)
router.add_api_route(
    "/company/{company_id}/brand-scoring/refresh",
    refresh_brand_scoring,
    methods=["POST"],
)
router.add_api_route(
    "/company/{company_id}/brand-synthesis/refresh",
    refresh_brand_synthesis,
    methods=["POST"],
)
router.add_api_route(
    "/company/{company_id}/audience-trends/refresh",
    refresh_audience_trends,
    methods=["POST"],
)
router.add_api_route(
    "/company/{company_id}/linkedin/refresh",
    refresh_linkedin_company,
    methods=["POST"],
)
