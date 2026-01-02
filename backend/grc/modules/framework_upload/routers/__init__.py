from .upload import upload_router
from .parser import parser_router
from .alignment import alignment_router
from .assessment import assessment_router
from .evidence import router as evidence_router

__all__ = [
    "upload_router",
    "parser_router",
    "alignment_router",
    "assessment_router",
    "evidence_router"
]
