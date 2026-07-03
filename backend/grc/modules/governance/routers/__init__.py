from .documents import router as documents_router
from .versions import router as versions_router
from .workflows import router as workflows_router
from .workflow_templates import router as workflow_templates_router
from .reviews import router as reviews_router
from .mappings import router as mappings_router
from .dashboard import router as dashboard_router
from .policy_parser import router as policy_parser_router
from .document_workflow import router as document_workflow_router
from .attestations import router as attestations_router
from .attestation_campaigns import router as attestation_campaigns_router
from .regulatory_changes import router as regulatory_changes_router
from .committees import router as committees_router
from .regulatory_feeds import router as regulatory_feeds_router
from .gap_analysis import router as gap_analysis_router
from .applicability import router as applicability_router
from .reports import router as reports_router
from .document_signoff import router as document_signoff_router

__all__ = [
    "documents_router",
    "versions_router",
    "workflows_router",
    "workflow_templates_router",
    "reviews_router",
    "mappings_router",
    "dashboard_router",
    "policy_parser_router",
    "document_workflow_router",
    "attestations_router",
    "attestation_campaigns_router",
    "regulatory_changes_router",
    "committees_router",
    "regulatory_feeds_router",
    "gap_analysis_router",
    "applicability_router",
    "reports_router",
    "document_signoff_router",
]
