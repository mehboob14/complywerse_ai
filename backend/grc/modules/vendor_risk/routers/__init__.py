from .vendors import router as vendors_router
from .assessments import router as assessments_router
from .questionnaires import router as questionnaires_router
from .monitoring import router as monitoring_router
from .ai_analysis import router as ai_analysis_router

__all__ = [
    "vendors_router",
    "assessments_router",
    "questionnaires_router",
    "monitoring_router",
    "ai_analysis_router",
]
