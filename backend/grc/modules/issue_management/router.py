"""Root router for the Issue Management module.

Mounts six sub-routers under /issue-management:

  /issues                       CRUD + transitions + close/reopen
  /issues/{id}/actions          per-issue CAPA actions
  /actions                      cross-issue CAPA board + action update/verify
  /issues/{id}/links/*          M2M linkages (vuln/risk/asset/control/evidence/vendor)
  /issues/{id}/{comments,activity}  comments + audit log
  /issues/from-source           "Create Issue from <upstream>" entry point
  /dashboard/aggregate          closure tracker / one-shot dashboard payload
  /matrices/{severity,classification}  per-tenant taxonomy config
"""
from fastapi import APIRouter

from .routers import (
    issues_router,
    actions_per_issue_router,
    actions_router,
    links_router,
    comments_router,
    dashboard_router,
    matrices_router,
    auto_create_router,
    by_source_router,
    automation_flags_router,
    import_export_router,
)

router = APIRouter(prefix="/issue-management", tags=["Issue Management"])

# Order matters where path prefixes overlap. The auto_create router exposes
# `POST /issues/from-source` so it must register BEFORE the general issues
# router (which has `POST /issues`) to avoid the parametric `/issues/{id}`
# in any router catching `from-source` as an id.
router.include_router(auto_create_router)
router.include_router(import_export_router)
router.include_router(issues_router)
router.include_router(actions_per_issue_router)
router.include_router(actions_router)
router.include_router(links_router)
router.include_router(comments_router)
router.include_router(dashboard_router)
router.include_router(matrices_router)
# v2 — reverse-lookup + automation flags
router.include_router(by_source_router)
router.include_router(automation_flags_router)


@router.get("")
def issue_management_module_info():
    return {
        "module": "Issue Management",
        "version": "1.0.0",
        "description": (
            "Enterprise Issue Log, CAPA actions, Contract Compliance, "
            "Closure Tracker, plus per-tenant Severity + Classification matrices."
        ),
        "endpoints": [
            "/issues",
            "/issues/{id}/links/{vulns,risks,assets,controls,evidence,vendors}",
            "/issues/{id}/actions",
            "/issues/{id}/comments",
            "/issues/{id}/activity",
            "/issues/from-source",
            "/actions",
            "/actions/{id}/verify",
            "/dashboard/aggregate",
            "/matrices/severity",
            "/matrices/classification",
        ],
    }
