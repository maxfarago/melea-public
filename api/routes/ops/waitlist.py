from fastapi import APIRouter

from api.routes.waitlist import list_waitlist_entries

router = APIRouter()
router.add_api_route("/waitlist", list_waitlist_entries, methods=["GET"])
