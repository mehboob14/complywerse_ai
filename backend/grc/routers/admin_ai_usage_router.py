"""
Admin AI usage monitoring — LangSmith-backed token / cost visibility
scoped to the current tenant.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from ..services import langsmith_usage as usage
from .admin_router import require_permission
from ..models import GRCUser as TenantUser

router = APIRouter(prefix="/admin/ai-usage", tags=["Administration — AI Usage"])


def _tenant_slug(request: Request) -> str:
    slug = getattr(request.state, "tenant_slug", None)
    if slug:
        return str(slug)
    raise HTTPException(status_code=400, detail="Tenant not resolved for this request.")


@router.get("/status")
def ai_usage_status(
    request: Request,
    _user: TenantUser = Depends(require_permission("admin:organization:view")),
):
    return usage.status_payload(_tenant_slug(request))


@router.get("/overview")
def ai_usage_overview(
    request: Request,
    start: Optional[str] = Query(None, description="ISO start datetime (UTC)"),
    end: Optional[str] = Query(None, description="ISO end datetime (UTC)"),
    _user: TenantUser = Depends(require_permission("admin:organization:view")),
):
    """Board-friendly summary of AI usage for this tenant."""
    return usage.build_overview(tenant_slug=_tenant_slug(request), start=start, end=end)


@router.get("/runs")
def ai_usage_runs(
    request: Request,
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    feature: Optional[str] = Query(None, description="Filter by friendly feature label"),
    _user: TenantUser = Depends(require_permission("admin:organization:view")),
):
    """Detailed run list including truncated inputs / outputs."""
    return usage.list_run_details(
        tenant_slug=_tenant_slug(request),
        start=start,
        end=end,
        limit=limit,
        offset=offset,
        feature=feature,
    )


@router.get("/runs/{run_id}")
def ai_usage_run_detail(
    run_id: str,
    request: Request,
    _user: TenantUser = Depends(require_permission("admin:organization:view")),
):
    """Full end-to-end detail for a single LangSmith run (tenant-scoped)."""
    detail = usage.get_run_detail(tenant_slug=_tenant_slug(request), run_id=run_id)
    if not detail:
        raise HTTPException(status_code=404, detail="Run not found for this tenant.")
    return detail
