"""The framework library API.

Lists, reads and deletes the frameworks a tenant has, serves their controls and evidence requirements (with the
review workflow), and runs the AI evidence-recommendation actions on them.

Uploading a framework document (upload, text extraction, AI parsing, parsed-control review, alignment to the
control library, publishing, and the framework assessments that lived beside them) was removed. The module name
and the /framework-upload prefix stay because the library pages, governance, mappings, the workflow catalogue
and the audit history all address it by that name.
"""
from fastapi import APIRouter
from .routers import upload_router, parser_router

framework_upload_router = APIRouter(prefix="/framework-upload", tags=["Frameworks"])

framework_upload_router.include_router(upload_router)
framework_upload_router.include_router(parser_router)


@framework_upload_router.get("")
def get_framework_upload_info():
    return {
        "module": "Frameworks",
        "version": "2.0",
        "description": "Framework library: list, read and delete frameworks; controls and evidence requirements",
        "endpoints": {
            "upload": "/upload - List, read and delete frameworks",
            "parser": "/parser - Controls, evidence requirements and AI evidence recommendations",
        }
    }
