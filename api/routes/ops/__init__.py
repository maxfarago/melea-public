from fastapi import APIRouter, Depends

from api.auth import require_ops_auth
from api.routes.ops.audiences import router as audiences_router
from api.routes.ops.companies import router as companies_router
from api.routes.ops.identity import router as identity_router
from api.routes.ops.status import router as status_router
from api.routes.ops.users import router as users_router
from api.routes.ops.waitlist import router as waitlist_router

router = APIRouter(prefix="/api/ops", dependencies=[Depends(require_ops_auth)])
router.include_router(companies_router)
router.include_router(audiences_router)
router.include_router(status_router)
router.include_router(users_router)
router.include_router(waitlist_router)
router.include_router(identity_router)
