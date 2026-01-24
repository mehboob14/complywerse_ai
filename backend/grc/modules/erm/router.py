from fastapi import APIRouter
from .routers import (
    risks_router,
    kris_router,
    incidents_router,
    reviews_router,
    dependencies_router,
    reports_router,
    mitigation_actions_router,
    risk_actions_router,
    scales_router,
    appetite_router,
    internal_controls_router,
    rcsa_router
)

router = APIRouter(prefix="/erm", tags=["ERM Module"])

router.include_router(risks_router)
router.include_router(kris_router)
router.include_router(incidents_router)
router.include_router(reviews_router)
router.include_router(dependencies_router)
router.include_router(reports_router)
router.include_router(mitigation_actions_router, tags=["ERM Mitigation Actions"])
router.include_router(risk_actions_router, tags=["ERM Mitigation Actions"])
router.include_router(scales_router, tags=["ERM Scales"])
router.include_router(appetite_router, tags=["ERM Risk Appetite"])
router.include_router(internal_controls_router, tags=["ERM Internal Controls"])
router.include_router(rcsa_router, tags=["RCSA - Risk and Control Self-Assessment"])


@router.get("")
def erm_module_info():
    return {
        "module": "Enterprise Risk Management",
        "version": "1.0.0",
        "endpoints": [
            "/risks",
            "/kris",
            "/incidents",
            "/reviews",
            "/dependencies",
            "/reports",
            "/mitigation-actions",
            "/scales",
            "/appetite",
            "/internal-controls",
            "/rcsa"
        ]
    }
