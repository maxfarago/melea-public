from fastapi import APIRouter

from api.routes.status import status

router = APIRouter()
router.add_api_route("/status", status, methods=["GET"])
