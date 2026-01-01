from .documents import router as documents_router
from .versions import router as versions_router
from .workflows import router as workflows_router
from .reviews import router as reviews_router
from .mappings import router as mappings_router
from .dashboard import router as dashboard_router

__all__ = [
    "documents_router",
    "versions_router",
    "workflows_router",
    "reviews_router",
    "mappings_router",
    "dashboard_router",
]
