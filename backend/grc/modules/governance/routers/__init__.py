from .documents import router as documents_router
from .versions import router as versions_router
from .workflows import router as workflows_router
from .workflow_templates import router as workflow_templates_router
from .reviews import router as reviews_router
from .mappings import router as mappings_router
from .dashboard import router as dashboard_router
from .policy_parser import router as policy_parser_router

__all__ = [
    "documents_router",
    "versions_router",
    "workflows_router",
    "workflow_templates_router",
    "reviews_router",
    "mappings_router",
    "dashboard_router",
    "policy_parser_router",
]
