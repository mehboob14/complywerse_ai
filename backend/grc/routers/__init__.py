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
from .certification_router import router as certification_router

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
    "certification_router",
]
