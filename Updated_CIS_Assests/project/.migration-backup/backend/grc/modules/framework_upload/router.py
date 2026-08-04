from fastapi import APIRouter
from .routers import upload_router, parser_router, alignment_router, assessment_router, evidence_router, publish_router

framework_upload_router = APIRouter(prefix="/framework-upload", tags=["Framework Upload"])

framework_upload_router.include_router(upload_router)
framework_upload_router.include_router(parser_router)
framework_upload_router.include_router(alignment_router)
framework_upload_router.include_router(assessment_router)
framework_upload_router.include_router(evidence_router)
framework_upload_router.include_router(publish_router)

@framework_upload_router.get("")
def get_framework_upload_info():
    return {
        "module": "Framework Upload",
        "version": "1.0",
        "description": "Upload, parse, and assess regulatory/standards documents",
        "endpoints": {
            "upload": "/upload - File upload and text extraction",
            "parser": "/parser - AI-powered document parsing",
            "alignment": "/alignment - Control alignment and matching",
            "assessment": "/assessment - Compliance assessments and gap analysis",
            "evidence": "/evidence - Evidence uploads for assessments"
        }
    }
