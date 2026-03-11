from fastapi import APIRouter

from .routers.ai import router as ai_router
from .routers.analytics import router as analytics_router
from .routers.catalog import router as catalog_router
from .routers.definitions import router as definitions_router
from .routers.executions import router as executions_router
from .routers.events import router as events_router
from .routers.integrations import router as integrations_router
from .routers.templates import router as templates_router

router = APIRouter(prefix="/workflow-engine", tags=["Workflow Automation Engine"])

router.include_router(definitions_router)
router.include_router(executions_router)
router.include_router(events_router)
router.include_router(catalog_router)
router.include_router(templates_router)
router.include_router(integrations_router)
router.include_router(analytics_router)
router.include_router(ai_router)


@router.get("")
def workflow_engine_info():
    return {
        "module": "Workflow Automation Engine",
        "version": "1.0.0-phase1",
        "description": "Standalone config-driven workflow runtime for GRC events",
        "endpoints": [
            "/definitions",
            "/definitions/{id}/versions",
            "/executions/trigger",
            "/executions/instances",
            "/events/publish",
            "/catalog/node-types",
            "/catalog/actors/users",
            "/catalog/actors/roles",
            "/templates",
            "/templates/bootstrap/document-approval",
            "/executions/approvals/inbox",
            "/integrations/schedules",
            "/integrations/webhooks",
            "/analytics/overview",
            "/ai/suggestions",
        ],
    }
