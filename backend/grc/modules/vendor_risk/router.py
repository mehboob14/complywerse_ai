from fastapi import APIRouter
from .routers import (
    vendors_router,
    assessments_router,
    questionnaires_router,
    monitoring_router,
    ai_analysis_router,
    lifecycle_router,
)
from .tpra.api import router as tpra_router
from .tpra.dashboard import router as tpra_dashboard_router

router = APIRouter(prefix="/vendor-risk", tags=["Vendor Risk Management"])

router.include_router(vendors_router)
router.include_router(assessments_router)
router.include_router(questionnaires_router)
router.include_router(monitoring_router)
router.include_router(ai_analysis_router)
router.include_router(lifecycle_router)
# TPRA productionization — normalized 11-stage lifecycle + per-stage CRUD.
# Additive: mounts under /vendor-risk/tpra; legacy routes above are unchanged.
router.include_router(tpra_router)
# Program dashboard + risk-trend (read-only aggregation over TPRA tables + snapshots).
router.include_router(tpra_dashboard_router)


@router.get("")
def vendor_risk_module_info():
    return {
        "module": "Vendor / Third-Party Risk Management",
        "version": "1.0.0",
        "endpoints": [
            "/vendors",
            "/vendors/dashboard",
            "/assessments",
            "/questionnaire-templates",
            "/questionnaires",
            "/vendors/{id}/sla",
            "/vendors/{id}/incidents",
            "/ai",
        ],
    }
