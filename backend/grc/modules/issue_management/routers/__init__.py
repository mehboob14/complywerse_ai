from .issues import router as issues_router
from .actions import router_issue as actions_per_issue_router, router_actions as actions_router
from .links import router as links_router
from .comments import router as comments_router
from .dashboard import router as dashboard_router
from .matrices import router as matrices_router
from .auto_create import router as auto_create_router
from .by_source import router as by_source_router
from .automation_flags import router as automation_flags_router

__all__ = [
    "issues_router",
    "actions_per_issue_router",
    "actions_router",
    "links_router",
    "comments_router",
    "dashboard_router",
    "matrices_router",
    "auto_create_router",
    "by_source_router",
    "automation_flags_router",
]
