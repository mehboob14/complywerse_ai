"""CAPA actions on Issues.

Two endpoint roots:
  /issues/{id}/actions      list + create scoped to an issue
  /actions/{id}             update / mark complete / verify (cross-issue)
"""
from datetime import datetime
from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from datetime import datetime as _dt

from ....models import Issue, IssueAction, IssueActivity, CriticalTask, GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_tenants, require_tenant_permission

router_issue = APIRouter(prefix="/issues", tags=["Issue Management - CAPA Actions"])
router_actions = APIRouter(prefix="/actions", tags=["Issue Management - CAPA Actions"])

_require_view = require_tenant_permission("issue_management:issues:view")
_require_edit = require_tenant_permission("issue_management:issues:edit")


def _serialize_action(a: IssueAction) -> Dict[str, Any]:
    return {
        "id": a.id,
        "issue_id": a.issue_id,
        "action_type": a.action_type,
        "title": a.title,
        "description": a.description,
        "assignee_id": a.assignee_id,
        "assignee_name": getattr(a.assignee, "display_name", None) or getattr(a.assignee, "username", None) if a.assignee else None,
        "due_date": a.due_date.isoformat() if a.due_date else None,
        "status": a.status,
        "completed_at": a.completed_at.isoformat() if a.completed_at else None,
        "verified_by_id": a.verified_by_id,
        "verified_at": a.verified_at.isoformat() if a.verified_at else None,
        "effectiveness_review_at": a.effectiveness_review_at.isoformat() if a.effectiveness_review_at else None,
        "evidence_id": a.evidence_id,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


def _get_issue(issue_id: int, current_user: GRCUser, db: Session) -> Issue:
    user_tenants = get_user_tenants(current_user, db)
    issue = db.query(Issue).filter(
        Issue.id == issue_id,
        Issue.tenant_id.in_(user_tenants),
    ).first()
    if not issue:
        raise HTTPException(status_code=404, detail="Issue not found")
    return issue


def _get_action_with_issue(action_id: int, current_user: GRCUser, db: Session) -> IssueAction:
    user_tenants = get_user_tenants(current_user, db)
    action = db.query(IssueAction).options(
        joinedload(IssueAction.assignee),
    ).join(Issue, Issue.id == IssueAction.issue_id).filter(
        IssueAction.id == action_id,
        Issue.tenant_id.in_(user_tenants),
    ).first()
    if not action:
        raise HTTPException(status_code=404, detail="Action not found")
    return action


# ── List + create per issue ─────────────────────────────────────────────
@router_issue.get("/{issue_id}/actions", dependencies=[Depends(_require_view)])
def list_actions(
    issue_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    _get_issue(issue_id, current_user, db)
    actions = db.query(IssueAction).options(
        joinedload(IssueAction.assignee),
    ).filter(IssueAction.issue_id == issue_id).order_by(IssueAction.created_at.asc()).all()
    return [_serialize_action(a) for a in actions]


@router_issue.post("/{issue_id}/actions", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_edit)])
def create_action(
    issue_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    issue = _get_issue(issue_id, current_user, db)
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="title is required")

    action_type = body.get("action_type") or "corrective"
    if action_type not in {"corrective", "preventive", "containment", "verification"}:
        raise HTTPException(status_code=400, detail="Invalid action_type")

    due_date_raw = body.get("due_date")
    action = IssueAction(
        issue_id=issue.id,
        action_type=action_type,
        title=title,
        description=body.get("description"),
        assignee_id=body.get("assignee_id"),
        due_date=datetime.fromisoformat(due_date_raw) if due_date_raw else None,
        status=body.get("status") or "planned",
        evidence_id=body.get("evidence_id"),
        created_by=current_user.id,
    )
    db.add(action)
    db.flush()
    db.add(IssueActivity(
        issue_id=issue.id, user_id=current_user.id, type="action_added",
        payload={"action_id": action.id, "action_type": action.action_type, "title": title},
    ))
    db.commit()
    db.refresh(action)
    return _serialize_action(action)


# ── Cross-issue action operations ───────────────────────────────────────
@router_actions.patch("/{action_id}", dependencies=[Depends(_require_edit)])
def update_action(
    action_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    action = _get_action_with_issue(action_id, current_user, db)
    for field in ("title", "description", "action_type", "assignee_id", "status", "evidence_id"):
        if field in body:
            setattr(action, field, body[field])
    if "due_date" in body:
        action.due_date = datetime.fromisoformat(body["due_date"]) if body["due_date"] else None
    if body.get("status") == "completed" and not action.completed_at:
        action.completed_at = datetime.utcnow()
        db.add(IssueActivity(
            issue_id=action.issue_id, user_id=current_user.id, type="action_completed",
            payload={"action_id": action.id, "title": action.title},
        ))
    db.commit()
    db.refresh(action)
    return _serialize_action(action)


@router_actions.post("/{action_id}/verify", dependencies=[Depends(_require_edit)])
def verify_action(
    action_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    action = _get_action_with_issue(action_id, current_user, db)
    if action.status not in {"completed", "verified"}:
        raise HTTPException(status_code=400, detail="Action must be completed before verification")
    action.status = "verified"
    action.verified_by_id = current_user.id
    action.verified_at = datetime.utcnow()
    if body.get("effectiveness_review_at"):
        action.effectiveness_review_at = datetime.fromisoformat(body["effectiveness_review_at"])
    db.add(IssueActivity(
        issue_id=action.issue_id, user_id=current_user.id, type="action_verified",
        payload={"action_id": action.id, "title": action.title, "notes": body.get("notes")},
    ))
    db.commit()
    db.refresh(action)
    return _serialize_action(action)


@router_actions.delete("/{action_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(_require_edit)])
def delete_action(
    action_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    action = _get_action_with_issue(action_id, current_user, db)
    issue_id = action.issue_id
    title = action.title
    db.delete(action)
    db.add(IssueActivity(
        issue_id=issue_id, user_id=current_user.id, type="action_deleted",
        payload={"title": title},
    ))
    db.commit()
    return


# ── v2: Promote a CAPA action to a Critical Task ────────────────────────
@router_actions.post("/{action_id}/promote-to-task", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_require_edit)])
def promote_action_to_task(
    action_id: int,
    body: Dict[str, Any],
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Create a CriticalTask mirrored from this CAPA action and wire the
    bidirectional FKs so the two stay in sync. Returns {task_id, code}.
    Idempotent — calling twice returns the existing linked task."""
    action = _get_action_with_issue(action_id, current_user, db)
    if action.linked_critical_task_id:
        existing = db.query(CriticalTask).filter(CriticalTask.id == action.linked_critical_task_id).first()
        if existing:
            return {"task_id": existing.id, "code": getattr(existing, "code", None), "already_linked": True}

    # Resolve the parent issue for tenant + code context (we know it exists
    # because _get_action_with_issue already validated tenant scope).
    issue = db.query(Issue).filter(Issue.id == action.issue_id).first()
    if issue is None:
        raise HTTPException(status_code=404, detail="Parent issue not found")

    # Map IssueAction.action_type to CriticalTask metadata. We keep this
    # local + minimal — the Critical Tasks module has its own full model;
    # we just supply the essentials and let it own its lifecycle.
    priority = (body.get("priority") or "Medium")
    sla_days = body.get("sla_days")
    task_title = body.get("title") or f"[CAPA] {action.title}"
    task_description = body.get("description") or (
        f"Promoted from CAPA action on Issue {issue.code or f'#{issue.id}'}.\n\n"
        f"Action type: {action.action_type}.\n\n"
        f"{action.description or ''}"
    )

    task = CriticalTask(
        tenant_id=issue.tenant_id,
        title=task_title,
        description=task_description,
        source="Issue Management",
        source_module="issue_management",
        source_entity_id=action.id,
        source_entity_type="IssueAction",
        priority=priority,
        status="Open",
        due_date=action.due_date,
        sla_days=sla_days,
        assigned_owner_id=action.assignee_id,
        assigned_user_ids=[action.assignee_id] if action.assignee_id else [],
        created_by_id=current_user.id,
        # Forward links — populated only when promoted via this endpoint.
        linked_issue_id=issue.id,
        linked_issue_action_id=action.id,
    )
    db.add(task)
    db.flush()

    # Reverse link on the action
    action.linked_critical_task_id = task.id

    db.add(IssueActivity(
        issue_id=issue.id, user_id=current_user.id, type="action_promoted_to_task",
        payload={
            "action_id": action.id,
            "task_id": task.id,
            "task_title": task_title,
        },
    ))
    db.commit()
    db.refresh(task)
    return {"task_id": task.id, "code": getattr(task, "code", None), "already_linked": False}


# ── Cross-issue listing (Kanban board) ──────────────────────────────────
@router_actions.get("", dependencies=[Depends(_require_view)])
def list_all_actions(
    status_filter: Optional[str] = None,
    action_type: Optional[str] = None,
    assignee_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Returns all actions across issues the user can see, grouped by status
    on the client for the CAPA board view."""
    user_tenants = get_user_tenants(current_user, db)
    q = db.query(IssueAction).options(joinedload(IssueAction.assignee)).join(
        Issue, Issue.id == IssueAction.issue_id,
    ).filter(Issue.tenant_id.in_(user_tenants))
    if status_filter:
        q = q.filter(IssueAction.status == status_filter)
    if action_type:
        q = q.filter(IssueAction.action_type == action_type)
    if assignee_id:
        q = q.filter(IssueAction.assignee_id == assignee_id)
    actions = q.order_by(IssueAction.due_date.asc().nullslast(), IssueAction.created_at.desc()).all()
    return [_serialize_action(a) for a in actions]
