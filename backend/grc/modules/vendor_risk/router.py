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
from .tpra.quantification import router as tpra_exposure_router
from .tpra.onboarding import router as tpra_onboarding_router
from .tpra.checkins import router as tpra_checkins_router
from .tpra.contracts import router as tpra_contracts_router
from .tpra.outside_in import router as tpra_outside_in_router
from .tpra.technology import router as tpra_technology_router
from .tpra.alerts import router as tpra_alerts_router
from .tpra.shadow_saas import router as tpra_shadow_saas_router

router = APIRouter(prefix="/vendor-risk", tags=["Vendor Risk Management"])

# Onboarding requests, procurement's view and vendor import. First, so its
# literal /vendors/import paths are matched before any /vendors/{id} route.
router.include_router(tpra_onboarding_router)
# Stakeholders' yearly check-ins on suppliers in use.
router.include_router(tpra_checkins_router)
# Every contract, with the ones needing a decision first.
router.include_router(tpra_contracts_router)
# Each supplier's websites and domains as the internet sees them, and waivers.
router.include_router(tpra_outside_in_router)
# Which suppliers run what, and which show a given vulnerability.
router.include_router(tpra_technology_router)
# Breach, adverse-media and vulnerability alerts, triaged like cases.
router.include_router(tpra_alerts_router)
# Software in use that no one has assessed: onboard, deny (and block) or dismiss.
router.include_router(tpra_shadow_saas_router)
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
# What a vendor could cost us in a year, as a range.
router.include_router(tpra_exposure_router)


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
