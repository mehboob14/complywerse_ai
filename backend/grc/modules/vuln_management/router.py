from fastapi import APIRouter
from .routers import (
    reports_router,
    vulnerabilities_router,
    mitigations_router,
    asset_links_router,
    control_links_router,
    retests_router,
    ai_analysis_router,
    sla_router,
    dashboard_router,
    exceptions_router
)

router = APIRouter(prefix="/vuln-management", tags=["Vulnerability Management"])

router.include_router(reports_router)
router.include_router(vulnerabilities_router)
router.include_router(mitigations_router)
router.include_router(asset_links_router)
router.include_router(control_links_router)
router.include_router(retests_router)
router.include_router(ai_analysis_router)
router.include_router(sla_router)
router.include_router(dashboard_router)
router.include_router(exceptions_router)


@router.get("")
def vuln_management_module_info():
    return {
        "module": "Vulnerability Management",
        "version": "1.0.0",
        "endpoints": [
            "/reports",
            "/vulnerabilities",
            "/mitigations",
            "/asset-links",
            "/control-links",
            "/retests",
            "/ai",
            "/sla",
            "/dashboard",
            "/exceptions"
        ]
    }
