"""Auditor portal — composite router.

Mounts every section under a single `/auditor-portal` prefix. Each
section is its own sub-router so adding more sections later (e.g.
findings, sampling plans) is just appending an include_router call.
"""
from fastapi import APIRouter

from .routers import (
    overview_router,
    controls_router,
    artifacts_router,
    exceptions_router,
    audit_trail_router,
    reviews_router,
    risk_assessments_router,
    statutory_audit_router,
)


router = APIRouter(prefix="/auditor-portal", tags=["Auditor Portal"])

router.include_router(overview_router)
router.include_router(controls_router)
router.include_router(artifacts_router)
router.include_router(exceptions_router)
router.include_router(audit_trail_router)
router.include_router(reviews_router)
router.include_router(risk_assessments_router)
router.include_router(statutory_audit_router)


@router.get("")
def module_info():
    return {
        "module": "Auditor Portal",
        "version": "1.1.0",
        "endpoints": [
            "/{framework_id}/overview",
            "/{framework_id}/controls",
            "/{framework_id}/documents",
            "/{framework_id}/risks",
            "/{framework_id}/assets",
            "/{framework_id}/vulnerabilities",
            "/{framework_id}/vendors",
            "/{framework_id}/exceptions",
            "/{framework_id}/audit-trail",
            "/{framework_id}/risk-assessments",
            "/reviews",
            "/statutory-audit/observations",
            "/statutory-audit/observations/upload-parse",
            "/statutory-audit/observations/confirm",
        ],
    }
