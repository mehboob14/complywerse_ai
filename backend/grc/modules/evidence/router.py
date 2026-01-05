from fastapi import APIRouter
from .routers import evidence_router, control_links_router, ocr_router, lifecycle_router, ai_assessment_router, cross_links_router

router = APIRouter(prefix="/evidence-mgmt", tags=["Evidence Module"])

router.include_router(evidence_router, tags=["Evidence CRUD"])
router.include_router(control_links_router, tags=["Evidence Control Links"])
router.include_router(ocr_router, tags=["Evidence OCR"])
router.include_router(lifecycle_router, tags=["Evidence Lifecycle"])
router.include_router(ai_assessment_router, tags=["Evidence AI Assessment"])
router.include_router(cross_links_router, tags=["Evidence Cross-Module Links"])


@router.get("")
def evidence_module_info():
    return {
        "module": "Evidence",
        "version": "1.0.0",
        "description": "Enterprise Evidence Management Module for collecting, managing, and linking evidence to controls",
        "evidence_types": [
            "screenshot",
            "document",
            "certificate",
            "audit_report",
            "log",
            "policy",
            "procedure",
            "configuration",
            "attestation",
            "training_record",
            "access_review",
            "vulnerability_scan",
            "penetration_test",
            "backup_log",
            "change_record",
            "incident_report",
            "other"
        ],
        "statuses": [
            "draft",
            "pending_review",
            "approved",
            "rejected",
            "expired",
            "archived"
        ],
        "endpoints": [
            "/items",
            "/items/upload",
            "/items/types",
            "/items/dashboard/summary",
            "/links/coverage"
        ]
    }
