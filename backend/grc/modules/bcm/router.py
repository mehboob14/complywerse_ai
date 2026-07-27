from fastapi import APIRouter

from .routers import plans_router, drills_router, dashboard_router

router = APIRouter(prefix="/bcm", tags=["Business Continuity Management"])

router.include_router(plans_router)
router.include_router(drills_router)
router.include_router(dashboard_router)
