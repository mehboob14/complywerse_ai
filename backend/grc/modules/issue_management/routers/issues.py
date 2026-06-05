"""Issues CRUD + list + transitions.

Endpoints:
  GET    /issues                  list with filters
  POST   /issues                  create (auto-numbers `code`, computes severity)
  GET    /issues/{id}             detail with linkages + recent activity
  PATCH  /issues/{id}             edit (logs to activity)
  POST   /issues/{id}/transition  workflow state change
  POST   /issues/{id}/close       formal closure with required notes
  POST   /issues/{id}/reopen      reopen with reason
  DELETE /issues/{id}             soft-delete (sets workflow_state=cancelled)
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_

from ....models import (
    Issue, IssueActivity, IssueAction, IssueComment,
    IssueVulnerabilityLink, IssueRiskLink, IssueAssetLink,
    IssueControlLink, IssueEvidenceLink, IssueVendorLink,
    GRCUser, get_db,
)
from ....routers.auth_router import (
    require_auth, get_user_tenants, get_user_primary_tenant,
    require_tenant_permission,
)
from ..services.severity_resolver import resolve_severity
from ..services.code_generator import next_issue_code

router = APIRouter(prefix="/issues", tags=["Issue Management - Issues"])

# ── RBAC gates ──────────────────────────────────────────────────────────
# Admin role + primary-contact bypass remains intact, so existing operators
# don't lose access. Non-admin users on custom roles need the named
# permission granted via the admin Roles UI (which lazy-creates the
# Permission row through `_get_or_create_permission`).
_require_view = require_tenant_permission("issue_management:issues:view")
_require_create = require_tenant_permission("issue_management:issues:create")
_require_edit = require_tenant_permission("issue_management:issues:edit")
_require_delete = require_tenant_permission("issue_management:issues:delete")


WORKFLOW_TERMINAL = {"closed", "cancelled"}


def _serialize_user(u: Optional[GRCUser]) -> Optional[Dict[str, Any]]:
    if not u:
        return None
    return {
        "id": u.id,
        "username": getattr(u, "username", None),
        "display_name": getattr(u, "display_name", None) or getattr(u, "full_name", None),
        "email": getattr(u, "email", None),
    }


def _serialize_issue_summary(issue: Issue) -> Dict[str, Any]:
    return {
        "id": issue.id,
        "code": issue.code,
        "tenant_id": issue.tenant_id,
        "title": issue.title,
        "description": issue.description,
        "severity": issue.severity,
        "severity_override": issue.severity_override,
        "severity_override_reason": issue.severity_override_reason,
        "issue_type": issue.issue_type,
        "category": issue.category,
        "urgency": issue.urgency,
        "impact": issue.impact,
        "status": issue.status,
        "workflow_state": issue.workflow_state or "new",
        "owner": _serialize_user(issue.owner),
        "reporter": _serialize_user(issue.reporter),
        "assignee": _serialize_user(issue.assignee),
        "source_type": issue.source_type,
        "source_id": issue.source_id,
        "detected_at": issue.detected_at.isoformat() if issue.detected_at else None,
        "due_date": issue.due_date.isoformat() if issue.due_date else None,
        "target_closure_date": issue.target_closure_date.isoformat() if issue.target_closure_date else None,
        "resolved_at": issue.resolved_at.isoformat() if issue.resolved_at else None,
        "closed_at": issue.closed_at.isoformat() if issue.closed_at else None,
        "approved_at": issue.approved_at.isoformat() if issue.approved_at else None,
        "approved_by": _serialize_user(issue.approver),
        "sla_breached": bool(issue.sla_breached),
        "created_at": issue.created_at.isoformat() if issue.created_at else None,
    }


def _log_activity(db: Session, issue_id: int, user_id: Optional[int], type_: str, payload: dict) -> None:
    db.add(IssueActivity(
        issue_id=issue_id,
        user_id=user_id,
        type=type_,
        payload=payload,
    ))


def _recompute_sla_breached(issue: Issue) -> None:
    """Cheap on-write SLA breach check — true when target_closure_date is in
    the past and the issue isn't terminal yet."""
    if issue.target_closure_date and issue.workflow_state not in WORKFLOW_TERMINAL:
        issue.sla_breached = issue.target_closure_date < datetime.utcnow()
    else:
        issue.sla_breached = False


def _get_issue_or_404(issue_id: int, current_user: GRCUser, db: Session) -> Issue:
    user_tenants = get_user_tenants(current_user, db)
    issue = db.query(Issue).options(
        joinedload(Issue.owner),
        joinedload(Issue.reporter),
        joinedload(Issue.assignee),
        joinedload(Issue.approver),
    ).filter(
        Issue.id == issue_id,
        Issue.tenant_id.in_(user_tenants),
    ).first()
    if not issue:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Issue not found")
    return issue


# ────────────────────────────────────────────────────────────────────────
# LIST
# ────────────────────────────────────────────────────────────────────────
@router.get("", dependencies=[Depends(_require_view)])
def list_issues(
    search: Optional[str] = None,
    severity: Optional[str] = Query(None),
    workflow_state: Optional[str] = Query(None),
    issue_type: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    assignee_id: Optional[int] = Query(None),
    source_type: Optional[str] = Query(None),
    sla_breached: Optional[bool] = Query(None),
    sort_by: str = Query("created_at"),
    sort_order: str = Query("desc"),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0}

    q = db.query(Issue).options(
        joinedload(Issue.owner),
        joinedload(Issue.reporter),
        joinedload(Issue.assignee),
    ).filter(Issue.tenant_id.in_(user_tenants))

    if search:
        s = f"%{search.strip().lower()}%"
        q = q.filter(or_(
            Issue.title.ilike(s),
            Issue.description.ilike(s),
            Issue.code.ilike(s),
        ))
    if severity:
        q = q.filter(Issue.severity == severity)
    if workflow_state:
        q = q.filter(Issue.workflow_state == workflow_state)
    if issue_type:
        q = q.filter(Issue.issue_type == issue_type)
    if category:
        q = q.filter(Issue.category == category)
    if assignee_id:
        q = q.filter(Issue.assignee_id == assignee_id)
    if source_type:
        q = q.filter(Issue.source_type == source_type)
    if sla_breached is not None:
        q = q.filter(Issue.sla_breached == sla_breached)

    total = q.count()

    sort_column = {
        "created_at": Issue.created_at,
        "severity": Issue.severity,
        "due_date": Issue.due_date,
        "target_closure_date": Issue.target_closure_date,
        "code": Issue.code,
    }.get(sort_by, Issue.created_at)
    q = q.order_by(sort_column.desc() if sort_order == "desc" else sort_column.asc())

    issues = q.offset(skip).limit(limit).all()
    return {
        "items": [_serialize_issue_summary(i) for i in issues],
        "total": total,
    }


# ────────────────────────────────────────────────────────────────────────
# CREATE
# ────────────────────────────────────────────────────────────────────────
@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_create)])
def create_issue(
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = body.get("tenant_id") or get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="No tenant context")

    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    impact = body.get("impact")
    urgency = body.get("urgency")
    severity_override = body.get("severity_override")
    severity_override_reason = body.get("severity_override_reason")

    # Compute severity + SLA. Override (if supplied) wins for the displayed
    # severity, but we keep the computed value in the activity payload.
    computed_severity, ack_hours, resolve_hours = resolve_severity(
        impact=impact, urgency=urgency, tenant_id=tenant_id, db=db,
    )
    final_severity = severity_override or computed_severity
    if severity_override and not severity_override_reason:
        raise HTTPException(status_code=400, detail="severity_override_reason required when overriding severity")

    detected_at_raw = body.get("detected_at")
    detected_at = datetime.fromisoformat(detected_at_raw) if detected_at_raw else datetime.utcnow()
    target_closure_date = detected_at + timedelta(hours=resolve_hours)
    due_date_raw = body.get("due_date")
    due_date = datetime.fromisoformat(due_date_raw) if due_date_raw else None

    issue = Issue(
        tenant_id=tenant_id,
        title=title,
        description=body.get("description"),
        severity=final_severity,
        severity_override=severity_override,
        severity_override_reason=severity_override_reason,
        impact=impact,
        urgency=urgency,
        issue_type=body.get("issue_type"),
        category=body.get("category"),
        root_cause=body.get("root_cause"),
        root_cause_analysis=body.get("root_cause_analysis"),
        detected_at=detected_at,
        target_closure_date=target_closure_date,
        due_date=due_date,
        owner_id=body.get("owner_id"),
        reporter_id=body.get("reporter_id") or current_user.id,
        assignee_id=body.get("assignee_id"),
        source_type=body.get("source_type") or "manual",
        source_id=body.get("source_id"),
        workflow_state="new",
        status="open",
    )
    db.add(issue)
    db.flush()
    issue.code = next_issue_code(tenant_id, db)
    _recompute_sla_breached(issue)
    _log_activity(db, issue.id, current_user.id, "created", {
        "computed_severity": computed_severity,
        "ack_hours": ack_hours,
        "resolve_hours": resolve_hours,
        "override": severity_override,
    })
    db.commit()
    db.refresh(issue)
    return _serialize_issue_summary(issue)


# ────────────────────────────────────────────────────────────────────────
# DETAIL
# ────────────────────────────────────────────────────────────────────────
@router.get("/{issue_id}", dependencies=[Depends(_require_view)])
def get_issue(
    issue_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    issue = _get_issue_or_404(issue_id, current_user, db)
    payload = _serialize_issue_summary(issue)
    payload["description"] = issue.description
    payload["root_cause"] = issue.root_cause
    payload["root_cause_analysis"] = issue.root_cause_analysis
    payload["closure_notes"] = issue.closure_notes

    # Link counts (cheap aggregates used by the detail header)
    payload["link_counts"] = {
        "vulnerabilities": db.query(IssueVulnerabilityLink).filter(IssueVulnerabilityLink.issue_id == issue.id).count(),
        "risks": db.query(IssueRiskLink).filter(IssueRiskLink.issue_id == issue.id).count(),
        "assets": db.query(IssueAssetLink).filter(IssueAssetLink.issue_id == issue.id).count(),
        "controls": db.query(IssueControlLink).filter(IssueControlLink.issue_id == issue.id).count(),
        "evidence": db.query(IssueEvidenceLink).filter(IssueEvidenceLink.issue_id == issue.id).count(),
        "vendors": db.query(IssueVendorLink).filter(IssueVendorLink.issue_id == issue.id).count(),
        "actions": db.query(IssueAction).filter(IssueAction.issue_id == issue.id).count(),
        "comments": db.query(IssueComment).filter(IssueComment.issue_id == issue.id).count(),
    }
    return payload


# ────────────────────────────────────────────────────────────────────────
# PATCH
# ────────────────────────────────────────────────────────────────────────
@router.patch("/{issue_id}", dependencies=[Depends(_require_edit)])
def update_issue(
    issue_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    issue = _get_issue_or_404(issue_id, current_user, db)
    changes: Dict[str, Any] = {}
    severity_dirty = False

    for field in (
        "title", "description", "issue_type", "category",
        "root_cause", "root_cause_analysis",
        "owner_id", "reporter_id", "assignee_id",
        "due_date", "detected_at",
    ):
        if field in body:
            new_val = body[field]
            if field in ("due_date", "detected_at") and new_val:
                new_val = datetime.fromisoformat(new_val)
            if getattr(issue, field) != new_val:
                changes[field] = {"old": getattr(issue, field), "new": new_val}
                setattr(issue, field, new_val)

    # Impact / urgency / severity_override changes recompute severity + SLA.
    if "impact" in body or "urgency" in body or "severity_override" in body:
        severity_dirty = True
        if "impact" in body:
            issue.impact = body["impact"]
        if "urgency" in body:
            issue.urgency = body["urgency"]
        if "severity_override" in body:
            issue.severity_override = body["severity_override"]
            issue.severity_override_reason = body.get("severity_override_reason")
            if issue.severity_override and not issue.severity_override_reason:
                raise HTTPException(status_code=400, detail="severity_override_reason required")
        new_severity, ack, resolve_hours = resolve_severity(
            impact=issue.impact, urgency=issue.urgency,
            tenant_id=issue.tenant_id, db=db,
        )
        issue.severity = issue.severity_override or new_severity
        if issue.detected_at:
            issue.target_closure_date = issue.detected_at + timedelta(hours=resolve_hours)
        changes["severity"] = {"computed": new_severity, "final": issue.severity}

    if changes:
        _recompute_sla_breached(issue)
        _log_activity(db, issue.id, current_user.id,
                      "severity_change" if severity_dirty else "updated",
                      {"changes": {k: str(v) for k, v in changes.items()}})
        db.commit()
        db.refresh(issue)
    return _serialize_issue_summary(issue)


# ────────────────────────────────────────────────────────────────────────
# TRANSITION
# ────────────────────────────────────────────────────────────────────────
ALLOWED_TRANSITIONS = {
    "new":             {"triage", "in_progress", "cancelled"},
    "triage":          {"in_progress", "cancelled"},
    "in_progress":     {"resolution", "closure_review", "cancelled"},
    "resolution":      {"closure_review", "in_progress", "cancelled"},
    "closure_review":  {"closed", "in_progress"},
    "closed":          {"in_progress"},  # i.e. reopen
    "cancelled":       {"new"},
}


@router.post("/{issue_id}/transition", dependencies=[Depends(_require_edit)])
def transition_issue(
    issue_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    target = (body.get("to_state") or "").strip()
    if not target:
        raise HTTPException(status_code=400, detail="to_state is required")
    issue = _get_issue_or_404(issue_id, current_user, db)
    current_state = issue.workflow_state or "new"
    if target not in ALLOWED_TRANSITIONS.get(current_state, set()):
        raise HTTPException(status_code=400, detail=f"Invalid transition {current_state} → {target}")

    issue.workflow_state = target
    if target == "resolution":
        issue.resolved_at = datetime.utcnow()
    elif target == "cancelled":
        issue.status = "closed"
    elif target == "in_progress" and current_state == "closed":
        issue.status = "open"
        issue.closed_at = None
        issue.approved_at = None
        issue.approved_by_id = None

    _recompute_sla_breached(issue)
    _log_activity(db, issue.id, current_user.id, "status_change", {
        "from": current_state, "to": target, "notes": body.get("notes"),
    })
    db.commit()
    db.refresh(issue)
    return _serialize_issue_summary(issue)


# ────────────────────────────────────────────────────────────────────────
# CLOSE
# ────────────────────────────────────────────────────────────────────────
@router.post("/{issue_id}/close", dependencies=[Depends(_require_edit)])
def close_issue(
    issue_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    closure_notes = (body.get("closure_notes") or "").strip()
    if not closure_notes:
        raise HTTPException(status_code=400, detail="closure_notes are required to close an issue")
    issue = _get_issue_or_404(issue_id, current_user, db)
    if issue.workflow_state == "closed":
        return _serialize_issue_summary(issue)
    if issue.workflow_state not in {"closure_review", "in_progress", "resolution"}:
        raise HTTPException(status_code=400, detail=f"Cannot close from {issue.workflow_state}")
    issue.workflow_state = "closed"
    issue.status = "closed"
    issue.closed_at = datetime.utcnow()
    issue.approved_by_id = current_user.id
    issue.approved_at = datetime.utcnow()
    issue.closure_notes = closure_notes
    issue.sla_breached = False  # terminal
    _log_activity(db, issue.id, current_user.id, "approved", {"closure_notes": closure_notes})
    db.commit()
    db.refresh(issue)
    return _serialize_issue_summary(issue)


# ────────────────────────────────────────────────────────────────────────
# REOPEN
# ────────────────────────────────────────────────────────────────────────
@router.post("/{issue_id}/reopen", dependencies=[Depends(_require_edit)])
def reopen_issue(
    issue_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="reason is required to reopen")
    issue = _get_issue_or_404(issue_id, current_user, db)
    if issue.workflow_state != "closed":
        raise HTTPException(status_code=400, detail="Only closed issues can be reopened")
    issue.workflow_state = "in_progress"
    issue.status = "open"
    issue.closed_at = None
    issue.approved_at = None
    issue.approved_by_id = None
    _recompute_sla_breached(issue)
    _log_activity(db, issue.id, current_user.id, "reopened", {"reason": reason})
    db.commit()
    db.refresh(issue)
    return _serialize_issue_summary(issue)


# ────────────────────────────────────────────────────────────────────────
# SOFT DELETE
# ────────────────────────────────────────────────────────────────────────
@router.delete("/{issue_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(_require_delete)])
def delete_issue(
    issue_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    issue = _get_issue_or_404(issue_id, current_user, db)
    issue.workflow_state = "cancelled"
    issue.status = "closed"
    _log_activity(db, issue.id, current_user.id, "cancelled", {})
    db.commit()
    return
