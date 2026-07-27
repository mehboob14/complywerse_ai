from .overview import router as overview_router
from .controls import router as controls_router
from .artifacts import router as artifacts_router
from .exceptions_section import router as exceptions_router
from .audit_trail import router as audit_trail_router
from .reviews import router as reviews_router
from .risk_assessments import router as risk_assessments_router

__all__ = [
    "overview_router",
    "controls_router",
    "artifacts_router",
    "exceptions_router",
    "audit_trail_router",
    "reviews_router",
    "risk_assessments_router",
]
