from fastapi import APIRouter
from .routers import statements_router, dashboard_router

router = APIRouter(prefix="/compliance/policies", tags=["Compliance Module"])

router.include_router(statements_router, tags=["Policy Statements"])
router.include_router(dashboard_router, tags=["Compliance Dashboard"])


@router.get("")
def compliance_module_info():
    return {
        "module": "Compliance",
        "version": "1.0.0",
        "description": "Policy Statement Compliance Tracking Module",
        "compliance_statuses": [
            "compliant",
            "partially_compliant",
            "non_compliant",
            "not_assessed",
            "not_applicable"
        ],
        "statement_categories": [
            "security",
            "privacy",
            "operational",
            "financial",
            "regulatory",
            "governance"
        ],
        "priorities": [
            "critical",
            "high",
            "medium",
            "low"
        ],
        "endpoints": [
            "/statements",
            "/dashboard"
        ]
    }
