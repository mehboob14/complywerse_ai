from .auth_router import router as auth_router
from .tenants_router import router as tenants_router
from .frameworks_router import router as frameworks_router
from .controls_router import router as controls_router
from .evidence_router import router as evidence_router
from .risks_router import router as risks_router
from .governance_router import router as governance_router
from .documents_router import router as documents_router
from .assets_router import router as assets_router
from .dashboard_router import router as dashboard_router
from .enriched_dashboard_router import router as enriched_dashboard_router
from .certification_router import router as certification_router
from .advanced_erm_router import router as advanced_erm_router
from .compliance_assessments_router import router as compliance_assessments_router
from .critical_tasks_router import router as critical_tasks_router
from .is_projects_router import router as is_projects_router
from .tasks_router import router as tasks_router
from .sso_router import router as sso_router, entra_router as entra_router
from .artifacts_router import router as artifacts_router
from .dcc_router import router as dcc_router
from .audit_plan_router import router as audit_plan_router
from .nca_risk_router import router as nca_risk_router
from .nca_vuln_router import router as nca_vuln_router
from .nca_container_router import router as nca_container_router
from .nca_templates_router import router as nca_templates_router
from .nca_kpi_router import router as nca_kpi_router
# Phase 9 — cross-domain power search + exception-aging analytics.
from .search_router import router as search_router
# Teams — admin CRUD for org teams used by the asset ownership-chain dropdown.
from .teams_router import router as teams_router

__all__ = [
    "auth_router",
    "tenants_router",
    "frameworks_router",
    "controls_router",
    "evidence_router",
    "risks_router",
    "governance_router",
    "documents_router",
    "assets_router",
    "dashboard_router",
    "enriched_dashboard_router",
    "certification_router",
    "advanced_erm_router",
    "compliance_assessments_router",
    "critical_tasks_router",
    "is_projects_router",
    "tasks_router",
    "sso_router",
    "entra_router",
    "artifacts_router",
    "search_router",
    "teams_router",
]
