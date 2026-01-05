from .evidence import router as evidence_router
from .control_links import router as control_links_router
from .ocr import router as ocr_router

__all__ = ["evidence_router", "control_links_router", "ocr_router"]
