from .risks import router as risks_router
from .kris import router as kris_router
from .incidents import router as incidents_router
from .reviews import router as reviews_router
from .dependencies import router as dependencies_router
from .reports import router as reports_router

__all__ = [
    "risks_router",
    "kris_router",
    "incidents_router",
    "reviews_router",
    "dependencies_router",
    "reports_router"
]
