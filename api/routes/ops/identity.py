from fastapi import APIRouter

from api.routes.identity import reset_brand_for_ops

router = APIRouter()
router.add_api_route("/me/reset-brand", reset_brand_for_ops, methods=["POST"])
