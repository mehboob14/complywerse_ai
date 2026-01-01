from fastapi import APIRouter
from .routers import (
    documents_router,
    versions_router,
    workflows_router,
    reviews_router,
    mappings_router,
    dashboard_router
)

router = APIRouter(prefix="/governance", tags=["Governance Module"])

router.include_router(documents_router, tags=["Governance Documents"])
router.include_router(versions_router, tags=["Document Versions"])
router.include_router(workflows_router, tags=["Approval Workflows"])
router.include_router(reviews_router, tags=["Document Reviews"])
router.include_router(mappings_router, tags=["Document Mappings"])
router.include_router(dashboard_router, tags=["Governance Dashboard"])


@router.get("")
def governance_module_info():
    return {
        "module": "Governance",
        "version": "1.0.0",
        "description": "Enterprise Governance Module for policy, standards, procedures, guidelines, charters, and framework document management",
        "document_types": [
            "policy",
            "standard", 
            "procedure",
            "guideline",
            "charter",
            "framework"
        ],
        "statuses": [
            "draft",
            "pending_review",
            "pending_approval",
            "approved",
            "published",
            "expired",
            "archived",
            "exception_applied"
        ],
        "endpoints": [
            "/documents",
            "/versions",
            "/workflows",
            "/reviews",
            "/mappings",
            "/dashboard"
        ]
    }
