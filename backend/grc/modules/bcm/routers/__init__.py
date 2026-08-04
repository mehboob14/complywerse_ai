from .plans import router as plans_router
from .drills import router as drills_router
from .dashboard import router as dashboard_router

__all__ = ["plans_router", "drills_router", "dashboard_router"]
