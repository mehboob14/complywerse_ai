from fastapi import APIRouter, Depends
from ...routers.auth_router import require_tenant_permission
from .routers import (
    risks_router,
    kris_router,
    incidents_router,
    incident_import_router,
    incident_links_router,
    reviews_router,
    dependencies_router,
    reports_router,
    mitigation_actions_router,
    risk_actions_router,
    scales_router,
    appetite_router,
    internal_controls_router,
    rcsa_router,
    rcsa_custom_router,
    risk_assessments_router,
    framework_risk_assessments_router,
    advanced_analytics_router,
    sections_dashboard_router,
    onboarding_router,
    kris_workflow_router,
    quantification_router,
    ctem_scopes_router,
)

router = APIRouter(
    prefix="/erm",
    tags=["ERM Module"],
    dependencies=[Depends(require_tenant_permission("erm:risks:view"))],
)

router.include_router(risks_router)
router.include_router(kris_router)
# Import + static link routes must register before parametric /incidents/{id}.
router.include_router(incident_import_router)
router.include_router(incident_links_router)
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
router.include_router(rcsa_custom_router, tags=["RCSA - Custom Templates"])
router.include_router(risk_assessments_router, tags=["ERM - Risk Assessments"])
router.include_router(framework_risk_assessments_router, tags=["ERM - Framework Risk Assessments"])
router.include_router(advanced_analytics_router, tags=["ERM - Advanced Analytics"])
router.include_router(sections_dashboard_router, tags=["ERM Sections Dashboard"])
router.include_router(onboarding_router, tags=["ERM Onboarding"])
router.include_router(kris_workflow_router, tags=["ERM - KRI Workflow"])
router.include_router(quantification_router, tags=["ERM - Risk Quantification"])
router.include_router(ctem_scopes_router, tags=["CTEM - Scopes & Cycles"])


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
            "/rcsa",
            "/risk-assessments",
            "/framework-risk-assessments"
        ]
    }
