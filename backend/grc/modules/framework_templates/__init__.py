"""Framework template tabs (ISO 27001): tabular registers + structured documents.

Backs the Gap Analysis, Internal Audit, Risk Treatment, ISMS Scope Statement and
Internal Audit Procedure tabs on the framework detail page. Per-tenant, scoped to
a certification journey (framework instance).
"""
from fastapi import APIRouter

from .routers.registers import router as registers_router
from .routers.documents import router as documents_router
from .routers.ai import router as ai_router
from .routers.meta import router as meta_router

framework_templates_router = APIRouter(prefix="/framework-templates", tags=["Framework Templates"])
framework_templates_router.include_router(meta_router)
framework_templates_router.include_router(registers_router)
framework_templates_router.include_router(documents_router)
framework_templates_router.include_router(ai_router)

__all__ = ["framework_templates_router"]
