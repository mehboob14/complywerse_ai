from .evidence import router as evidence_router
from .control_links import router as control_links_router
from .ocr import router as ocr_router
from .lifecycle import router as lifecycle_router
from .ai_assessment import router as ai_assessment_router
from .cross_links import router as cross_links_router

__all__ = ["evidence_router", "control_links_router", "ocr_router", "lifecycle_router", "ai_assessment_router", "cross_links_router"]
