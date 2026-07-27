"""
Generic task-status / revoke endpoints.

Frontends that dispatched a Celery task (e.g. `parse_policy_document`,
`run_gap_analysis`, framework parse / enhance / evidence-reqs) get back a
`task_id` in the response. This router lets them poll for status or revoke
in-flight tasks.

Tenant scoping: a tenant can only inspect tasks whose payload starts with
their slug. We enforce this defensively by reading `task.args[0]` from the
Celery result backend.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, HTTPException, Request, status

from ..celery_app import celery_app
from ..models import GRCUser
from .auth_router import require_auth

router = APIRouter(prefix="/tasks", tags=["Background Jobs"])


def _payload_tenant(args: Any, kwargs: Any) -> Optional[str]:
    """Tasks always carry tenant_slug as the first positional arg (enforced by
    `TenantTask.__call__`). Pull it out for the access check."""
    if args:
        first = args[0]
        if isinstance(first, str):
            return first
    if isinstance(kwargs, dict):
        slug = kwargs.get("tenant_slug")
        if isinstance(slug, str):
            return slug
    return None


@router.get("/{task_id}")
def get_task_status(
    task_id: str,
    request: Request,
    _user: GRCUser = Depends(require_auth),
) -> Dict[str, Any]:
    """Returns the lifecycle state of a Celery task.

    State is one of: PENDING, STARTED, SUCCESS, FAILURE, RETRY, REVOKED.
    For SUCCESS, `result` is the task's return value. For FAILURE, `error` is
    the exception repr.
    """
    request_tenant = getattr(request.state, "tenant_slug", None)
    if not request_tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    res = AsyncResult(task_id, app=celery_app)

    # AsyncResult.args/kwargs are populated when result_extended=True (set in celery_app.conf).
    payload_tenant = _payload_tenant(res.args, res.kwargs) if res.state != "PENDING" else None
    if payload_tenant and payload_tenant != request_tenant:
        # Don't leak that the task exists for another tenant.
        raise HTTPException(status_code=404, detail="Task not found")

    response: Dict[str, Any] = {
        "task_id": task_id,
        "state": res.state,
        "ready": res.ready(),
    }
    if res.state == "SUCCESS":
        response["result"] = res.result
    elif res.state == "FAILURE":
        response["error"] = repr(res.result)
    elif res.state == "PROGRESS":
        response["meta"] = res.info
    elif res.info and not isinstance(res.info, BaseException):
        response["meta"] = res.info

    return response


@router.post("/{task_id}/revoke", status_code=status.HTTP_202_ACCEPTED)
def revoke_task(
    task_id: str,
    request: Request,
    _user: GRCUser = Depends(require_auth),
) -> Dict[str, Any]:
    """Revoke a task. If the task is queued, it's cancelled before running.
    If running, it receives SIGTERM (terminate=True). The task's own cleanup
    path runs if it had an `except` for KeyboardInterrupt / SoftTimeLimit.
    """
    request_tenant = getattr(request.state, "tenant_slug", None)
    if not request_tenant:
        raise HTTPException(status_code=400, detail="Tenant context required")

    res = AsyncResult(task_id, app=celery_app)
    payload_tenant = _payload_tenant(res.args, res.kwargs)
    if payload_tenant and payload_tenant != request_tenant:
        raise HTTPException(status_code=404, detail="Task not found")

    res.revoke(terminate=True, signal="SIGTERM")
    return {"task_id": task_id, "revoked": True}
