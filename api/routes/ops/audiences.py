from fastapi import APIRouter

from api.routes.audiences import (
    assign_audience_member_route,
    create_audience,
    delete_audience,
    get_audience,
    get_audience_news,
    list_audiences,
    list_unassigned_audience_members,
    update_audience,
)

router = APIRouter()
router.add_api_route("/audiences", list_audiences, methods=["GET"])
router.add_api_route(
    "/audience-members/unassigned", list_unassigned_audience_members, methods=["GET"]
)
router.add_api_route("/audience/{audience_id}", get_audience, methods=["GET"])
router.add_api_route("/audience/{audience_id}/news", get_audience_news, methods=["GET"])
router.add_api_route("/audiences", create_audience, methods=["POST"])
router.add_api_route(
    "/audience/{audience_id}/member", assign_audience_member_route, methods=["POST"]
)
router.add_api_route("/audience/{audience_id}", update_audience, methods=["PUT"])
router.add_api_route(
    "/audience/{audience_id}",
    delete_audience,
    methods=["DELETE"],
    status_code=204,
)
