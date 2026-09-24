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
from .tpra.attention import router as tpra_attention_router
from .tpra.graph import router as tpra_graph_router
from .tpra.reports import router as tpra_reports_router

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
# What needs somebody today, computed from current data.
router.include_router(tpra_attention_router)
# Fourth parties, concentration and what depends on each vendor.
router.include_router(tpra_graph_router)
# Committee pack, register, vendor evidence files and the examiner link.
router.include_router(tpra_reports_router)


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
