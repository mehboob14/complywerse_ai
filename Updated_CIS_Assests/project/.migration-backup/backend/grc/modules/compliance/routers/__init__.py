from .statements import router as statements_router
from .dashboard import router as dashboard_router

__all__ = [
    "statements_router",
    "dashboard_router",
]
