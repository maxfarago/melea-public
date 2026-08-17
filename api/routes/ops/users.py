from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse

from api.db.sqlite import db
from api.routes.identity import reset_user_brand

router = APIRouter()


async def list_ops_users() -> JSONResponse:
    rows = await db.list_users_with_company()
    return JSONResponse(content={"users": rows})


async def reset_ops_user_brand(clerk_user_id: str) -> JSONResponse:
    clerk_user_id = str(clerk_user_id or "").strip()
    if not clerk_user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="clerk_user_id is required.",
        )
    if await db.get_user_by_clerk_id(clerk_user_id) is None:
        raise HTTPException(status_code=404, detail="User not found.")
    payload = await reset_user_brand(clerk_user_id)
    return JSONResponse(content=payload)


router.add_api_route("/users", list_ops_users, methods=["GET"])
router.add_api_route(
    "/users/{clerk_user_id}/reset-brand",
    reset_ops_user_brand,
    methods=["POST"],
)
