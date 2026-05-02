from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, case, and_, or_
from typing import Optional, List
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
from pydantic import BaseModel
import os
import json
import logging

from ..models import (
    get_db, CriticalTask, CriticalTaskSubTask,
    CriticalTaskComment, CriticalTaskHistory, GRCUser, TenantUser,
    CriticalTaskTemplate, CriticalTaskApproval, NotificationPreference
)
from .auth_router import require_auth, get_user_tenants, get_user_primary_tenant, require_tenant_permission

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/critical-tasks",
    tags=["Critical Tasks"],
    dependencies=[Depends(require_tenant_permission("critical_tasks:tasks:view"))],
)

SORTABLE_COLUMNS = {"created_at", "updated_at", "title", "priority", "status", "due_date", "source", "category"}


def _validate_tenant_user(db: Session, user_id: Optional[int], user_tenants: List[int]):
    if user_id is None:
        return
    # Per-tenant DB: every active grc_users row belongs to this tenant. The
    # earlier check joined through grc_tenant_users, but that table is only
    # populated for the bootstrap admin — users created later via
    # /admin/users have no row there, so the check would fail incorrectly.
    user = db.query(GRCUser).filter(
        GRCUser.id == user_id,
        GRCUser.is_active.is_(True),
    ).first()
    if not user:
        raise HTTPException(status_code=400, detail=f"User {user_id} does not belong to your tenant")


def _normalize_assignee_list(db: Session, raw_ids) -> List[int]:
    """Validate, dedupe and order-preserve a list of user ids."""
    if raw_ids is None:
        return []
    seen: set = set()
    cleaned: List[int] = []
    for uid in raw_ids:
        if uid is None:
            continue
        if uid in seen:
            continue
        seen.add(uid)
        cleaned.append(int(uid))
    if not cleaned:
        return []
    users = db.query(GRCUser).filter(
        GRCUser.id.in_(cleaned), GRCUser.is_active.is_(True),
    ).all()
    valid = {u.id for u in users}
    missing = [uid for uid in cleaned if uid not in valid]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Users {missing} do not belong to your tenant",
        )
    return cleaned


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    source: str = "Manual"
    source_module: Optional[str] = None
    source_entity_id: Optional[int] = None
    source_entity_type: Optional[str] = None
    priority: str = "Medium"
    severity: Optional[str] = None
    category: str = "Other"
    assigned_owner_id: Optional[int] = None
    # New: multi-assignee. If provided, this is the canonical list and the
    # legacy `assigned_owner_id` is auto-synced to its first entry.
    assigned_user_ids: Optional[List[int]] = None
    reviewer_id: Optional[int] = None
    due_date: Optional[datetime] = None
    sla_days: Optional[int] = None
    linked_risk_id: Optional[int] = None
    linked_control_id: Optional[int] = None
    linked_vulnerability_id: Optional[int] = None
    linked_framework_id: Optional[int] = None
    linked_requirement_id: Optional[int] = None
    evidence_notes: Optional[str] = None
    recurrence_pattern: Optional[str] = None
    recurrence_interval: Optional[int] = 1
    approval_required: Optional[bool] = False


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    source: Optional[str] = None
    source_module: Optional[str] = None
    source_entity_id: Optional[int] = None
    source_entity_type: Optional[str] = None
    priority: Optional[str] = None
    severity: Optional[str] = None
    category: Optional[str] = None
    assigned_owner_id: Optional[int] = None
    assigned_user_ids: Optional[List[int]] = None
    reviewer_id: Optional[int] = None
    due_date: Optional[datetime] = None
    sla_days: Optional[int] = None
    linked_risk_id: Optional[int] = None
    linked_control_id: Optional[int] = None
    linked_vulnerability_id: Optional[int] = None
    linked_framework_id: Optional[int] = None
    linked_requirement_id: Optional[int] = None
    evidence_notes: Optional[str] = None
    recurrence_pattern: Optional[str] = None
    recurrence_interval: Optional[int] = None
    approval_required: Optional[bool] = None


class StatusTransition(BaseModel):
    new_status: str
    comment: Optional[str] = None


class BulkAction(BaseModel):
    task_ids: List[int]
    action: str
    value: Optional[str] = None
    assigned_owner_id: Optional[int] = None


class SubTaskCreate(BaseModel):
    title: str
    assigned_owner_id: Optional[int] = None
    due_date: Optional[datetime] = None


class SubTaskUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    assigned_owner_id: Optional[int] = None
    due_date: Optional[datetime] = None


class CrossModuleTaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    source_module: str
    source_entity_id: int
    source_entity_type: str
    priority: Optional[str] = "Medium"
    severity: Optional[str] = None
    category: Optional[str] = "Remediation"
    assigned_owner_id: Optional[int] = None
    reviewer_id: Optional[int] = None
    due_date: Optional[datetime] = None
    sla_days: Optional[int] = None
    linked_risk_id: Optional[int] = None
    linked_control_id: Optional[int] = None
    linked_vulnerability_id: Optional[int] = None
    evidence_notes: Optional[str] = None


SOURCE_MODULE_MAP = {
    "Audit Findings": "Audit",
    "Risk Register": "Risk",
    "Compliance Assessment": "Compliance",
    "Vulnerability Scan": "Vulnerability",
}


class CommentCreate(BaseModel):
    content: str


def _serialize_user(user):
    if not user:
        return None
    return {"id": user.id, "username": user.username, "display_name": user.display_name, "email": user.email}


def _calc_sla_status(task):
    if task.status in ("Completed", "Verified"):
        return "Completed"
    if not task.due_date:
        return "No SLA"
    now = datetime.utcnow()
    days_remaining = (task.due_date - now).days
    if days_remaining < 0:
        return "Breached"
    elif days_remaining <= 3:
        return "At Risk"
    return "On Track"


def _auto_escalate_task(task, db):
    """Auto-escalate a task based on SLA breach severity.
    Level 0: Normal / On Track
    Level 1: At Risk (within 3 days of due date)
    Level 2: Breached (past due date)
    Level 3: Severely breached (past due by 7+ days)
    """
    if task.status in ("Completed", "Verified"):
        return
    if not task.due_date:
        return
    now = datetime.utcnow()
    days_overdue = (now - task.due_date).days
    new_level = 0
    if days_overdue > 7:
        new_level = 3
    elif days_overdue > 0:
        new_level = 2
    elif days_overdue >= -3:
        new_level = 1

    if new_level > task.escalation_level:
        old_level = task.escalation_level
        task.escalation_level = new_level
        task.updated_at = now
        history = CriticalTaskHistory(
            task_id=task.id,
            user_id=None,
            action="Auto-Escalated",
            field_changed="escalation_level",
            old_value=str(old_level),
            new_value=str(new_level),
        )
        db.add(history)


def _serialize_task(task, include_relations=False):
    raw_assigned_ids = getattr(task, "assigned_user_ids", None) or []
    if not isinstance(raw_assigned_ids, list):
        raw_assigned_ids = []
    # Back-compat lift: if a row pre-dates multi-assignment but has a legacy
    # single owner, surface it as a one-element list.
    if not raw_assigned_ids and getattr(task, "assigned_owner_id", None):
        raw_assigned_ids = [task.assigned_owner_id]

    assignees_payload = []
    if raw_assigned_ids:
        sess = Session.object_session(task)
        if sess is not None:
            users = sess.query(GRCUser).filter(GRCUser.id.in_(raw_assigned_ids)).all()
            user_by_id = {u.id: u for u in users}
            for uid in raw_assigned_ids:
                u = user_by_id.get(uid)
                if not u:
                    continue
                assignees_payload.append({
                    "id": u.id,
                    "username": u.username,
                    "display_name": u.display_name or u.username,
                    "email": u.email,
                })

    result = {
        "id": task.id,
        "tenant_id": task.tenant_id,
        "title": task.title,
        "description": task.description,
        "source": task.source,
        "source_module": task.source_module,
        "source_entity_id": task.source_entity_id,
        "source_entity_type": task.source_entity_type,
        "priority": task.priority,
        "severity": task.severity,
        "status": task.status,
        "category": task.category,
        "assigned_owner_id": task.assigned_owner_id,
        "assigned_user_ids": [a["id"] for a in assignees_payload],
        "assignees": assignees_payload,
        "reviewer_id": task.reviewer_id,
        "created_by_id": task.created_by_id,
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "sla_days": task.sla_days,
        "sla_status": _calc_sla_status(task),
        "escalation_level": task.escalation_level,
        "linked_risk_id": task.linked_risk_id,
        "linked_control_id": task.linked_control_id,
        "linked_vulnerability_id": task.linked_vulnerability_id,
        "linked_framework_id": getattr(task, "linked_framework_id", None),
        "linked_requirement_id": getattr(task, "linked_requirement_id", None),
        "evidence_notes": task.evidence_notes,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "verified_at": task.verified_at.isoformat() if task.verified_at else None,
        "recurrence_pattern": getattr(task, 'recurrence_pattern', None),
        "recurrence_interval": getattr(task, 'recurrence_interval', 1),
        "parent_task_id": getattr(task, 'parent_task_id', None),
        "next_recurrence_date": task.next_recurrence_date.isoformat() if getattr(task, 'next_recurrence_date', None) else None,
        "approval_required": getattr(task, 'approval_required', False),
        "approval_status": getattr(task, 'approval_status', None),
        "approved_by_id": getattr(task, 'approved_by_id', None),
        "approved_at": getattr(task, 'approved_at', None).isoformat() if getattr(task, 'approved_at', None) else None,
        "approval_comment": getattr(task, 'approval_comment', None),
        "approved_by": _serialize_user(getattr(task, 'approved_by', None)) if hasattr(task, 'approved_by') else None,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
        "assigned_owner": _serialize_user(task.assigned_owner),
        "reviewer": _serialize_user(task.reviewer),
        "created_by": _serialize_user(task.created_by),
    }
    if include_relations:
        result["sub_tasks"] = [
            {
                "id": st.id,
                "title": st.title,
                "status": st.status,
                "assigned_owner_id": st.assigned_owner_id,
                "assigned_owner": _serialize_user(st.assigned_owner),
                "due_date": st.due_date.isoformat() if st.due_date else None,
                "completed_at": st.completed_at.isoformat() if st.completed_at else None,
                "created_at": st.created_at.isoformat() if st.created_at else None,
            }
            for st in (task.sub_tasks or [])
        ]
        result["comments"] = [
            {
                "id": c.id,
                "content": c.content,
                "user": _serialize_user(c.user),
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in sorted((task.comments or []), key=lambda x: x.created_at or datetime.min)
        ]
        result["history"] = [
            {
                "id": h.id,
                "action": h.action,
                "field_changed": h.field_changed,
                "old_value": h.old_value,
                "new_value": h.new_value,
                "user": _serialize_user(h.user),
                "created_at": h.created_at.isoformat() if h.created_at else None,
            }
            for h in sorted((task.history or []), key=lambda x: x.created_at or datetime.min, reverse=True)
        ]
    return result


def _add_history(db, task_id, user_id, action, field_changed=None, old_value=None, new_value=None):
    entry = CriticalTaskHistory(
        task_id=task_id,
        user_id=user_id,
        action=action,
        field_changed=field_changed,
        old_value=str(old_value) if old_value is not None else None,
        new_value=str(new_value) if new_value is not None else None,
    )
    db.add(entry)


VALID_TRANSITIONS = {
    "Open": ["In Progress"],
    "In Progress": ["Under Review", "Open"],
    "Under Review": ["Completed", "In Progress", "Reopened"],
    "Completed": ["Verified", "Reopened"],
    "Verified": ["Reopened"],
    "Reopened": ["In Progress"],
}


def _get_openai_client():
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI service not configured")
    from openai import OpenAI
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return OpenAI(**kwargs)


def _get_openai_model():
    return os.environ.get("AI_INTEGRATIONS_OPENAI_MODEL") or os.environ.get("OPENAI_MODEL") or "gpt-4o"


def _calc_next_recurrence(base_date, pattern, interval=1):
    if pattern == "daily":
        return base_date + timedelta(days=interval)
    elif pattern == "weekly":
        return base_date + timedelta(weeks=interval)
    elif pattern == "monthly":
        return base_date + relativedelta(months=interval)
    elif pattern == "quarterly":
        return base_date + relativedelta(months=3 * interval)
    return None


def _handle_recurrence(task, db):
    pattern = getattr(task, 'recurrence_pattern', None)
    if not pattern:
        return
    interval = getattr(task, 'recurrence_interval', 1) or 1
    base_date = task.due_date or datetime.utcnow()
    next_due = _calc_next_recurrence(base_date, pattern, interval)
    if not next_due:
        return
    new_task = CriticalTask(
        tenant_id=task.tenant_id,
        title=task.title,
        description=task.description,
        source=task.source,
        source_module=task.source_module,
        priority=task.priority,
        severity=task.severity,
        status="Open",
        category=task.category,
        assigned_owner_id=task.assigned_owner_id,
        reviewer_id=task.reviewer_id,
        created_by_id=task.created_by_id,
        due_date=next_due,
        sla_days=task.sla_days,
        recurrence_pattern=pattern,
        recurrence_interval=interval,
        parent_task_id=task.id,
        approval_required=getattr(task, 'approval_required', False),
    )
    db.add(new_task)
    db.flush()
    for st in (task.sub_tasks or []):
        new_sub = CriticalTaskSubTask(
            task_id=new_task.id,
            title=st.title,
            status="Open",
        )
        db.add(new_sub)
    _add_history(db, new_task.id, None, "Auto-Created", "recurrence", None, f"Recurring from task #{task.id}")


def _send_notification_email(to_email, subject, html_body):
    try:
        api_key = os.environ.get("RESEND_API_KEY")
        if not api_key:
            logger.warning("Resend API key not configured, skipping email")
            return
        import resend
        resend.api_key = api_key
        resend.Emails.send({
            "from": "ComplyVerse <notifications@complyverse.app>",
            "to": [to_email],
            "subject": subject,
            "html": html_body,
        })
    except Exception as e:
        logger.error(f"Failed to send notification email: {e}")


def _notify_task_event(db, task, event_type, background_tasks: Optional[BackgroundTasks] = None, extra_context=""):
    if not task.assigned_owner_id:
        return
    owner = db.query(GRCUser).filter(GRCUser.id == task.assigned_owner_id).first()
    if not owner or not owner.email:
        return
    pref = db.query(NotificationPreference).filter(
        NotificationPreference.user_id == owner.id,
        NotificationPreference.tenant_id == task.tenant_id,
    ).first()
    if pref:
        if event_type == "assignment" and not pref.notify_on_assignment:
            return
        elif event_type == "sla_warning" and not pref.notify_on_sla_warning:
            return
        elif event_type == "sla_breach" and not pref.notify_on_sla_breach:
            return
        elif event_type == "escalation" and not pref.notify_on_escalation:
            return
    subjects = {
        "assignment": f"Task Assigned: {task.title}",
        "sla_warning": f"SLA Warning: {task.title}",
        "sla_breach": f"SLA Breached: {task.title}",
        "escalation": f"Task Escalated: {task.title}",
    }
    bodies = {
        "assignment": f"<h2>New Task Assignment</h2><p>You have been assigned: <strong>{task.title}</strong></p><p>Priority: {task.priority} | Due: {task.due_date.strftime('%Y-%m-%d') if task.due_date else 'Not set'}</p>{extra_context}",
        "sla_warning": f"<h2>SLA Warning</h2><p>Task <strong>{task.title}</strong> is approaching its SLA deadline.</p><p>Due: {task.due_date.strftime('%Y-%m-%d') if task.due_date else 'N/A'}</p>",
        "sla_breach": f"<h2>SLA Breached</h2><p>Task <strong>{task.title}</strong> has breached its SLA.</p><p>Due: {task.due_date.strftime('%Y-%m-%d') if task.due_date else 'N/A'}</p>",
        "escalation": f"<h2>Task Escalated</h2><p>Task <strong>{task.title}</strong> has been escalated to level {task.escalation_level}.</p>{extra_context}",
    }
    subject = subjects.get(event_type, "Task Update")
    body = bodies.get(event_type, "")
    if background_tasks:
        background_tasks.add_task(_send_notification_email, owner.email, subject, body)
    else:
        _send_notification_email(owner.email, subject, body)


@router.get("")
def list_tasks(
    source: Optional[str] = None,
    priority: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    category: Optional[str] = None,
    assigned_owner_id: Optional[int] = None,
    search: Optional[str] = None,
    due_before: Optional[datetime] = None,
    due_after: Optional[datetime] = None,
    sort_by: Optional[str] = "created_at",
    sort_order: Optional[str] = "desc",
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    query = db.query(CriticalTask).options(
        joinedload(CriticalTask.assigned_owner),
        joinedload(CriticalTask.reviewer),
        joinedload(CriticalTask.created_by),
    ).filter(CriticalTask.tenant_id.in_(user_tenants))

    if source:
        query = query.filter(CriticalTask.source == source)
    if priority:
        query = query.filter(CriticalTask.priority == priority)
    if status_filter:
        query = query.filter(CriticalTask.status == status_filter)
    if category:
        query = query.filter(CriticalTask.category == category)
    if assigned_owner_id:
        query = query.filter(CriticalTask.assigned_owner_id == assigned_owner_id)
    if search:
        query = query.filter(CriticalTask.title.ilike(f"%{search}%"))
    if due_before:
        query = query.filter(CriticalTask.due_date <= due_before)
    if due_after:
        query = query.filter(CriticalTask.due_date >= due_after)

    total = query.count()

    if sort_by not in SORTABLE_COLUMNS:
        sort_by = "created_at"
    sort_col = getattr(CriticalTask, sort_by, CriticalTask.created_at)
    if sort_order == "asc":
        query = query.order_by(sort_col.asc())
    else:
        query = query.order_by(sort_col.desc())

    tasks = query.offset(skip).limit(limit).all()
    changed = False
    for t in tasks:
        old_lvl = t.escalation_level
        _auto_escalate_task(t, db)
        if t.escalation_level != old_lvl:
            changed = True
    if changed:
        db.commit()
    return {"items": [_serialize_task(t) for t in tasks], "total": total}


@router.get("/my-tasks")
def my_tasks(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    query = db.query(CriticalTask).options(
        joinedload(CriticalTask.assigned_owner),
        joinedload(CriticalTask.reviewer),
        joinedload(CriticalTask.created_by),
    ).filter(
        CriticalTask.tenant_id.in_(user_tenants),
        or_(
            CriticalTask.assigned_owner_id == current_user.id,
            CriticalTask.reviewer_id == current_user.id,
        ),
    )
    tasks = query.order_by(CriticalTask.due_date.asc().nullslast(), CriticalTask.priority.desc()).all()
    return [_serialize_task(t) for t in tasks]


@router.get("/tenant-users")
def get_tenant_users(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Active users in the caller's tenant DB.

    Per-tenant DB: every active row in `grc_users` belongs to this tenant.
    The previous implementation joined through `grc_tenant_users`, but that
    table is only populated for the bootstrap admin — users created later
    via `POST /admin/users` don't get a row, so the join silently filtered
    them out and the dropdown looked empty. Falls back to the caller so the
    list is never empty.
    """
    users = (
        db.query(GRCUser)
        .filter(GRCUser.is_active == True)
        .order_by(GRCUser.display_name.asc().nullslast(), GRCUser.username.asc())
        .all()
    )
    result = [
        {
            "id": u.id,
            "username": u.username,
            "display_name": u.display_name or u.username,
            "email": u.email,
        }
        for u in users
    ]
    if not any(r["id"] == current_user.id for r in result):
        result.insert(0, {
            "id": current_user.id,
            "username": current_user.username,
            "display_name": current_user.display_name or current_user.username,
            "email": current_user.email,
        })
    return result


@router.get("/reports/summary")
def reports_summary(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    base = db.query(CriticalTask).filter(CriticalTask.tenant_id.in_(user_tenants))

    total = base.count()
    by_status = dict(
        db.query(CriticalTask.status, func.count(CriticalTask.id))
        .filter(CriticalTask.tenant_id.in_(user_tenants))
        .group_by(CriticalTask.status).all()
    )
    by_priority = dict(
        db.query(CriticalTask.priority, func.count(CriticalTask.id))
        .filter(CriticalTask.tenant_id.in_(user_tenants))
        .group_by(CriticalTask.priority).all()
    )
    by_source = dict(
        db.query(CriticalTask.source, func.count(CriticalTask.id))
        .filter(CriticalTask.tenant_id.in_(user_tenants))
        .group_by(CriticalTask.source).all()
    )
    by_category = dict(
        db.query(CriticalTask.category, func.count(CriticalTask.id))
        .filter(CriticalTask.tenant_id.in_(user_tenants))
        .group_by(CriticalTask.category).all()
    )

    now = datetime.utcnow()
    overdue = base.filter(
        CriticalTask.due_date < now,
        CriticalTask.status.notin_(["Completed", "Verified"])
    ).count()

    overdue_aging = {"0-7 days": 0, "8-14 days": 0, "15-30 days": 0, "30+ days": 0}
    overdue_tasks = base.filter(
        CriticalTask.due_date < now,
        CriticalTask.status.notin_(["Completed", "Verified"])
    ).all()
    for t in overdue_tasks:
        days = (now - t.due_date).days
        if days <= 7:
            overdue_aging["0-7 days"] += 1
        elif days <= 14:
            overdue_aging["8-14 days"] += 1
        elif days <= 30:
            overdue_aging["15-30 days"] += 1
        else:
            overdue_aging["30+ days"] += 1

    completed_count = base.filter(CriticalTask.status.in_(["Completed", "Verified"])).count()
    completion_rate = round((completed_count / total * 100), 1) if total > 0 else 0

    sla_met = 0
    sla_total = 0
    all_tasks_for_sla = base.filter(CriticalTask.due_date.isnot(None)).all()
    for t in all_tasks_for_sla:
        sla_total += 1
        if t.status in ("Completed", "Verified"):
            if t.completed_at and t.completed_at <= t.due_date:
                sla_met += 1
        elif t.due_date >= now:
            sla_met += 1
    sla_compliance = round((sla_met / sla_total * 100), 1) if sla_total > 0 else 0

    owner_workload = {}
    owner_tasks = (
        db.query(GRCUser.display_name, GRCUser.username, func.count(CriticalTask.id))
        .join(CriticalTask, CriticalTask.assigned_owner_id == GRCUser.id)
        .filter(
            CriticalTask.tenant_id.in_(user_tenants),
            CriticalTask.status.notin_(["Completed", "Verified"]),
        )
        .group_by(GRCUser.display_name, GRCUser.username)
        .all()
    )
    for display_name, username, count in owner_tasks:
        owner_workload[display_name or username] = count

    completion_by_source = {}
    source_stats = (
        db.query(
            CriticalTask.source,
            func.count(CriticalTask.id),
            func.count(case((CriticalTask.status.in_(["Completed", "Verified"]), 1))),
        )
        .filter(CriticalTask.tenant_id.in_(user_tenants))
        .group_by(CriticalTask.source)
        .all()
    )
    for src, total_src, completed_src in source_stats:
        completion_by_source[src] = {
            "total": total_src,
            "completed": completed_src,
            "rate": round((completed_src / total_src * 100), 1) if total_src > 0 else 0,
        }

    trend_data = []
    for i in range(11, -1, -1):
        month_start = (now.replace(day=1) - timedelta(days=30 * i)).replace(day=1)
        if i > 0:
            month_end = (now.replace(day=1) - timedelta(days=30 * (i - 1))).replace(day=1)
        else:
            month_end = now
        created = base.filter(
            CriticalTask.created_at >= month_start,
            CriticalTask.created_at < month_end,
        ).count()
        completed_m = base.filter(
            CriticalTask.completed_at >= month_start,
            CriticalTask.completed_at < month_end,
        ).count()
        trend_data.append({
            "month": month_start.strftime("%b %Y"),
            "created": created,
            "completed": completed_m,
        })

    return {
        "total": total,
        "by_status": by_status,
        "by_priority": by_priority,
        "by_source": by_source,
        "by_category": by_category,
        "overdue": overdue,
        "overdue_aging": overdue_aging,
        "completion_rate": completion_rate,
        "sla_compliance": sla_compliance,
        "owner_workload": owner_workload,
        "completion_by_source": completion_by_source,
        "trend_data": trend_data,
    }


@router.post("/bulk-action")
def bulk_action(
    payload: BulkAction,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    tasks = db.query(CriticalTask).filter(
        CriticalTask.id.in_(payload.task_ids),
        CriticalTask.tenant_id.in_(user_tenants),
    ).all()

    if payload.action == "assign" and payload.assigned_owner_id is not None:
        _validate_tenant_user(db, payload.assigned_owner_id, user_tenants)

    updated = 0
    for task in tasks:
        if payload.action == "change_priority" and payload.value:
            old = task.priority
            task.priority = payload.value
            _add_history(db, task.id, current_user.id, "Bulk Update", "priority", old, payload.value)
            updated += 1
        elif payload.action == "change_status" and payload.value:
            allowed = VALID_TRANSITIONS.get(task.status, [])
            if payload.value in allowed:
                if getattr(task, 'approval_required', False):
                    if (task.status == "Under Review" and payload.value == "Completed") or \
                       (task.status == "Completed" and payload.value == "Verified"):
                        if getattr(task, 'approval_status', None) != "Approved":
                            continue
                old = task.status
                task.status = payload.value
                if payload.value == "Completed":
                    task.completed_at = datetime.utcnow()
                    if getattr(task, 'approval_required', False):
                        task.approval_status = None
                    _handle_recurrence(task, db)
                elif payload.value == "Verified":
                    task.verified_at = datetime.utcnow()
                elif payload.value == "Reopened":
                    task.completed_at = None
                    task.verified_at = None
                    if getattr(task, 'approval_required', False):
                        task.approval_status = None
                _add_history(db, task.id, current_user.id, "Bulk Status Change", "status", old, payload.value)
                updated += 1
        elif payload.action == "assign" and payload.assigned_owner_id is not None:
            old = task.assigned_owner_id
            task.assigned_owner_id = payload.assigned_owner_id
            _add_history(db, task.id, current_user.id, "Bulk Assign", "assigned_owner_id", old, payload.assigned_owner_id)
            if task.assigned_owner_id != old:
                _notify_task_event(db, task, "assignment", background_tasks=background_tasks)
            updated += 1
        task.updated_at = datetime.utcnow()

    db.commit()
    return {"updated": updated}


@router.post("/from-module", status_code=status.HTTP_201_CREATED)
def create_task_from_module(
    payload: CrossModuleTaskCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Create a critical task from another GRC module (audit, risk, compliance, vulnerability).
    This endpoint provides automatic source attribution and cross-module linking."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="No tenant access")

    if payload.assigned_owner_id:
        _validate_tenant_user(db, payload.assigned_owner_id, user_tenants)
    if payload.reviewer_id:
        _validate_tenant_user(db, payload.reviewer_id, user_tenants)

    source = SOURCE_MODULE_MAP.get(payload.source_module, "Manual")

    due = payload.due_date
    if not due and payload.sla_days:
        due = datetime.utcnow() + timedelta(days=payload.sla_days)

    task = CriticalTask(
        tenant_id=user_tenants[0],
        title=payload.title,
        description=payload.description,
        source=source,
        source_module=payload.source_module,
        source_entity_id=payload.source_entity_id,
        source_entity_type=payload.source_entity_type,
        priority=payload.priority or "Medium",
        severity=payload.severity,
        status="Open",
        category=payload.category or "Remediation",
        assigned_owner_id=payload.assigned_owner_id,
        reviewer_id=payload.reviewer_id,
        created_by_id=current_user.id,
        due_date=due,
        sla_days=payload.sla_days,
        linked_risk_id=payload.linked_risk_id,
        linked_control_id=payload.linked_control_id,
        linked_vulnerability_id=payload.linked_vulnerability_id,
        evidence_notes=payload.evidence_notes,
    )
    db.add(task)
    db.flush()
    _add_history(
        db, task.id, current_user.id,
        f"Created from {payload.source_module}",
        "source_entity",
        None,
        f"{payload.source_entity_type} #{payload.source_entity_id}",
    )
    db.commit()
    db.refresh(task)
    return _serialize_task(task)


@router.post("/escalate/run")
def run_auto_escalation(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Manually trigger auto-escalation evaluation across all active tasks in user's tenants."""
    user_tenants = get_user_tenants(current_user, db)
    active_tasks = db.query(CriticalTask).filter(
        CriticalTask.tenant_id.in_(user_tenants),
        CriticalTask.status.notin_(["Completed", "Verified"]),
        CriticalTask.due_date.isnot(None),
    ).all()

    escalated = 0
    sla_warned = 0
    sla_breached = 0
    now = datetime.utcnow()
    for task in active_tasks:
        old_level = task.escalation_level
        _auto_escalate_task(task, db)
        if task.escalation_level != old_level:
            escalated += 1
            _notify_task_event(db, task, "escalation", background_tasks=background_tasks)
        if task.due_date:
            days_remaining = (task.due_date - now).days
            if days_remaining < 0:
                sla_breached += 1
                _notify_task_event(db, task, "sla_breach", background_tasks=background_tasks)
            elif task.sla_days and days_remaining <= max(1, task.sla_days * 0.25):
                sla_warned += 1
                _notify_task_event(db, task, "sla_warning", background_tasks=background_tasks)

    db.commit()
    return {"evaluated": len(active_tasks), "escalated": escalated, "sla_warned": sla_warned, "sla_breached": sla_breached}


@router.get("/notification-preferences")
def get_notification_preferences(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    pref = db.query(NotificationPreference).filter(
        NotificationPreference.user_id == current_user.id,
        NotificationPreference.tenant_id == tenant_id,
    ).first()
    if not pref:
        return {
            "notify_on_assignment": True,
            "notify_on_sla_warning": True,
            "notify_on_sla_breach": True,
            "notify_on_escalation": True,
            "notify_on_approval_request": True,
        }
    return {
        "notify_on_assignment": pref.notify_on_assignment,
        "notify_on_sla_warning": pref.notify_on_sla_warning,
        "notify_on_sla_breach": pref.notify_on_sla_breach,
        "notify_on_escalation": pref.notify_on_escalation,
        "notify_on_approval_request": pref.notify_on_approval_request,
    }


@router.put("/notification-preferences")
def update_notification_preferences(
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    pref = db.query(NotificationPreference).filter(
        NotificationPreference.user_id == current_user.id,
        NotificationPreference.tenant_id == tenant_id,
    ).first()
    if not pref:
        pref = NotificationPreference(user_id=current_user.id, tenant_id=tenant_id)
        db.add(pref)
    for field in ["notify_on_assignment", "notify_on_sla_warning", "notify_on_sla_breach", "notify_on_escalation", "notify_on_approval_request"]:
        if field in data:
            setattr(pref, field, bool(data[field]))
    pref.updated_at = datetime.utcnow()
    db.commit()
    return {"message": "Preferences updated"}


@router.get("/{task_id}")
def get_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    task = db.query(CriticalTask).options(
        joinedload(CriticalTask.assigned_owner),
        joinedload(CriticalTask.reviewer),
        joinedload(CriticalTask.created_by),
        joinedload(CriticalTask.sub_tasks).joinedload(CriticalTaskSubTask.assigned_owner),
        joinedload(CriticalTask.comments).joinedload(CriticalTaskComment.user),
        joinedload(CriticalTask.history).joinedload(CriticalTaskHistory.user),
    ).filter(CriticalTask.id == task_id, CriticalTask.tenant_id.in_(user_tenants)).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return _serialize_task(task, include_relations=True)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_task(
    payload: TaskCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    user_tenants = get_user_tenants(current_user, db)
    _validate_tenant_user(db, payload.assigned_owner_id, user_tenants)
    _validate_tenant_user(db, payload.reviewer_id, user_tenants)

    # Resolve the multi-assignee list. If the caller provided one, it is the
    # canonical source and the legacy single owner is synced to its first
    # entry. If only the legacy owner is set, lift it into a one-element list.
    payload_dict = payload.model_dump()
    assigned_ids: List[int] = []
    if payload.assigned_user_ids is not None:
        assigned_ids = _normalize_assignee_list(db, payload.assigned_user_ids)
    elif payload.assigned_owner_id is not None:
        assigned_ids = [payload.assigned_owner_id]
    payload_dict["assigned_user_ids"] = assigned_ids
    payload_dict["assigned_owner_id"] = assigned_ids[0] if assigned_ids else payload.assigned_owner_id

    task = CriticalTask(
        tenant_id=tenant_id,
        created_by_id=current_user.id,
        **payload_dict,
    )
    if task.sla_days and not task.due_date:
        task.due_date = datetime.utcnow() + timedelta(days=task.sla_days)
    db.add(task)
    db.commit()
    db.refresh(task)
    _add_history(db, task.id, current_user.id, "Created", new_value=task.title)
    db.commit()
    if task.assigned_owner_id:
        _notify_task_event(db, task, "assignment", background_tasks=background_tasks)
    return _serialize_task(task)


@router.put("/{task_id}")
def update_task(
    task_id: int,
    payload: TaskUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    task = db.query(CriticalTask).filter(
        CriticalTask.id == task_id, CriticalTask.tenant_id.in_(user_tenants)
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "assigned_owner_id" in update_data:
        _validate_tenant_user(db, update_data["assigned_owner_id"], user_tenants)
    if "reviewer_id" in update_data:
        _validate_tenant_user(db, update_data["reviewer_id"], user_tenants)
    if "assigned_user_ids" in update_data:
        # Replace the multi-assignee list and keep `assigned_owner_id` in sync
        # with the first entry (single-source-of-truth for back-compat).
        normalized_ids = _normalize_assignee_list(db, update_data["assigned_user_ids"])
        update_data["assigned_user_ids"] = normalized_ids
        update_data["assigned_owner_id"] = normalized_ids[0] if normalized_ids else None

    if "status" in update_data and update_data["status"] != task.status:
        new_status = update_data["status"]
        allowed = VALID_TRANSITIONS.get(task.status, [])
        if new_status not in allowed:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot transition from '{task.status}' to '{new_status}'. Allowed: {allowed}",
            )
        approval_gated = (
            (task.status == "Under Review" and new_status == "Completed") or
            (task.status == "Completed" and new_status == "Verified")
        )
        if approval_gated and getattr(task, 'approval_required', False):
            if getattr(task, 'approval_status', None) != "Approved":
                raise HTTPException(
                    status_code=400,
                    detail=f"Approval is required before transitioning from '{task.status}' to '{new_status}'.",
                )

    old_owner_id = task.assigned_owner_id
    old_status = task.status
    for field, value in update_data.items():
        old = getattr(task, field, None)
        if old != value:
            _add_history(db, task.id, current_user.id, "Updated", field, old, value)
            setattr(task, field, value)

    if "status" in update_data:
        if task.status == "Completed" and old_status != "Completed":
            task.completed_at = datetime.utcnow()
            if getattr(task, 'approval_required', False):
                task.approval_status = None
            _handle_recurrence(task, db)
        elif task.status == "Verified" and old_status != "Verified":
            task.verified_at = datetime.utcnow()
        elif task.status == "Reopened":
            task.completed_at = None
            task.verified_at = None
            if getattr(task, 'approval_required', False):
                task.approval_status = None

    task.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(task)
    if "assigned_owner_id" in update_data and task.assigned_owner_id and task.assigned_owner_id != old_owner_id:
        _notify_task_event(db, task, "assignment", background_tasks=background_tasks)
    return _serialize_task(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    task = db.query(CriticalTask).filter(
        CriticalTask.id == task_id, CriticalTask.tenant_id.in_(user_tenants)
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    db.delete(task)
    db.commit()
    return None


@router.post("/{task_id}/transition")
def transition_status(
    task_id: int,
    payload: StatusTransition,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    task = db.query(CriticalTask).filter(
        CriticalTask.id == task_id, CriticalTask.tenant_id.in_(user_tenants)
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    allowed = VALID_TRANSITIONS.get(task.status, [])
    if payload.new_status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot transition from '{task.status}' to '{payload.new_status}'. Allowed: {allowed}",
        )

    approval_gated = (
        (task.status == "Under Review" and payload.new_status == "Completed") or
        (task.status == "Completed" and payload.new_status == "Verified")
    )
    if approval_gated and getattr(task, 'approval_required', False):
        if getattr(task, 'approval_status', None) != "Approved":
            raise HTTPException(
                status_code=400,
                detail=f"Approval is required before transitioning from '{task.status}' to '{payload.new_status}'. Please request approval first.",
            )

    old_status = task.status
    task.status = payload.new_status
    task.updated_at = datetime.utcnow()

    if payload.new_status == "Completed":
        task.completed_at = datetime.utcnow()
        if getattr(task, 'approval_required', False):
            task.approval_status = None
        _handle_recurrence(task, db)
    elif payload.new_status == "Verified":
        task.verified_at = datetime.utcnow()
    elif payload.new_status == "Reopened":
        task.completed_at = None
        task.verified_at = None
        if getattr(task, 'approval_required', False):
            task.approval_status = None

    _add_history(db, task.id, current_user.id, "Status Changed", "status", old_status, payload.new_status)

    if payload.comment:
        comment = CriticalTaskComment(
            task_id=task.id, user_id=current_user.id, content=payload.comment
        )
        db.add(comment)

    db.commit()
    db.refresh(task)
    return _serialize_task(task)


@router.post("/{task_id}/sub-tasks", status_code=status.HTTP_201_CREATED)
def create_sub_task(
    task_id: int,
    payload: SubTaskCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    task = db.query(CriticalTask).filter(
        CriticalTask.id == task_id, CriticalTask.tenant_id.in_(user_tenants)
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    user_tenants = get_user_tenants(current_user, db)
    _validate_tenant_user(db, payload.assigned_owner_id, user_tenants)
    sub = CriticalTaskSubTask(task_id=task_id, **payload.model_dump())
    db.add(sub)
    _add_history(db, task_id, current_user.id, "Sub-task Added", new_value=payload.title)
    db.commit()
    db.refresh(sub)
    return {
        "id": sub.id, "title": sub.title, "status": sub.status,
        "assigned_owner_id": sub.assigned_owner_id, "due_date": sub.due_date.isoformat() if sub.due_date else None,
        "created_at": sub.created_at.isoformat() if sub.created_at else None,
    }


@router.put("/{task_id}/sub-tasks/{sub_task_id}")
def update_sub_task(
    task_id: int,
    sub_task_id: int,
    payload: SubTaskUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    task = db.query(CriticalTask).filter(
        CriticalTask.id == task_id, CriticalTask.tenant_id.in_(user_tenants)
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    sub = db.query(CriticalTaskSubTask).filter(
        CriticalTaskSubTask.id == sub_task_id, CriticalTaskSubTask.task_id == task_id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Sub-task not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "assigned_owner_id" in update_data:
        user_tenants2 = get_user_tenants(current_user, db)
        _validate_tenant_user(db, update_data["assigned_owner_id"], user_tenants2)
    for field, value in update_data.items():
        old = getattr(sub, field, None)
        if old != value:
            setattr(sub, field, value)
            if field == "status":
                if value == "Completed":
                    sub.completed_at = datetime.utcnow()
                else:
                    sub.completed_at = None
    sub.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(sub)
    return {
        "id": sub.id, "title": sub.title, "status": sub.status,
        "assigned_owner_id": sub.assigned_owner_id, "due_date": sub.due_date.isoformat() if sub.due_date else None,
    }


@router.delete("/{task_id}/sub-tasks/{sub_task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sub_task(
    task_id: int,
    sub_task_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    task = db.query(CriticalTask).filter(
        CriticalTask.id == task_id, CriticalTask.tenant_id.in_(user_tenants)
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    sub = db.query(CriticalTaskSubTask).filter(
        CriticalTaskSubTask.id == sub_task_id, CriticalTaskSubTask.task_id == task_id
    ).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Sub-task not found")
    db.delete(sub)
    db.commit()
    return None


@router.post("/{task_id}/comments", status_code=status.HTTP_201_CREATED)
def add_comment(
    task_id: int,
    payload: CommentCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    task = db.query(CriticalTask).filter(
        CriticalTask.id == task_id, CriticalTask.tenant_id.in_(user_tenants)
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    comment = CriticalTaskComment(
        task_id=task_id, user_id=current_user.id, content=payload.content
    )
    db.add(comment)
    _add_history(db, task_id, current_user.id, "Comment Added")
    db.commit()
    db.refresh(comment)
    return {
        "id": comment.id, "content": comment.content,
        "user": _serialize_user(current_user),
        "created_at": comment.created_at.isoformat() if comment.created_at else None,
    }


@router.get("/{task_id}/history")
def get_history(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    task = db.query(CriticalTask).filter(
        CriticalTask.id == task_id, CriticalTask.tenant_id.in_(user_tenants)
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    entries = db.query(CriticalTaskHistory).options(
        joinedload(CriticalTaskHistory.user)
    ).filter(CriticalTaskHistory.task_id == task_id).order_by(CriticalTaskHistory.created_at.desc()).all()
    return [
        {
            "id": h.id, "action": h.action, "field_changed": h.field_changed,
            "old_value": h.old_value, "new_value": h.new_value,
            "user": _serialize_user(h.user),
            "created_at": h.created_at.isoformat() if h.created_at else None,
        }
        for h in entries
    ]


SYSTEM_TEMPLATES = [
    {
        "name": "Audit Finding Remediation",
        "description": "Standard template for remediating audit findings with structured sub-tasks",
        "category": "Remediation",
        "priority": "High",
        "sla_days": 30,
        "sub_tasks_template": [
            {"title": "Root Cause Analysis"},
            {"title": "Corrective Action Plan"},
            {"title": "Implementation"},
            {"title": "Evidence Collection"},
            {"title": "Validation"},
        ],
    },
    {
        "name": "Vulnerability Remediation",
        "description": "Template for vulnerability patching and verification",
        "category": "Remediation",
        "priority": "Critical",
        "sla_days": 14,
        "sub_tasks_template": [
            {"title": "Assessment"},
            {"title": "Patching/Fix"},
            {"title": "Testing"},
            {"title": "Verification"},
        ],
    },
    {
        "name": "Policy Review",
        "description": "Template for periodic policy review and approval process",
        "category": "Compliance",
        "priority": "Medium",
        "sla_days": 60,
        "sub_tasks_template": [
            {"title": "Draft Review"},
            {"title": "Stakeholder Consultation"},
            {"title": "Legal Review"},
            {"title": "Approval"},
            {"title": "Publication"},
        ],
    },
    {
        "name": "Compliance Gap Closure",
        "description": "Template for closing compliance gaps with structured evidence gathering",
        "category": "Compliance",
        "priority": "High",
        "sla_days": 45,
        "sub_tasks_template": [
            {"title": "Gap Analysis"},
            {"title": "Control Implementation"},
            {"title": "Evidence Gathering"},
            {"title": "Assessment"},
        ],
    },
]


@router.get("/templates/list")
def list_templates(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    custom = db.query(CriticalTaskTemplate).filter(
        (CriticalTaskTemplate.tenant_id == tenant_id) | (CriticalTaskTemplate.is_system == True)
    ).order_by(CriticalTaskTemplate.name).all()
    results = []
    seen_names = set()
    for t in custom:
        seen_names.add(t.name)
        results.append({
            "id": t.id, "name": t.name, "description": t.description,
            "category": t.category, "priority": t.priority, "sla_days": t.sla_days,
            "sub_tasks_template": t.sub_tasks_template or [],
            "is_system": t.is_system,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        })
    for st in SYSTEM_TEMPLATES:
        if st["name"] not in seen_names:
            results.append({
                "id": None, "name": st["name"], "description": st["description"],
                "category": st["category"], "priority": st["priority"], "sla_days": st["sla_days"],
                "sub_tasks_template": st["sub_tasks_template"],
                "is_system": True, "created_at": None,
            })
    return results


@router.post("/templates", status_code=status.HTTP_201_CREATED)
def create_template(
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not data.get("name"):
        raise HTTPException(status_code=422, detail="Template name is required")
    template = CriticalTaskTemplate(
        tenant_id=tenant_id,
        name=data["name"],
        description=data.get("description", ""),
        category=data.get("category", "Other"),
        priority=data.get("priority", "Medium"),
        sla_days=data.get("sla_days"),
        sub_tasks_template=data.get("sub_tasks_template", []),
        is_system=False,
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    return {
        "id": template.id, "name": template.name, "description": template.description,
        "category": template.category, "priority": template.priority, "sla_days": template.sla_days,
        "sub_tasks_template": template.sub_tasks_template or [],
        "is_system": False,
    }


@router.put("/templates/{template_id}")
def update_template(
    template_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    template = db.query(CriticalTaskTemplate).filter(
        CriticalTaskTemplate.id == template_id,
        CriticalTaskTemplate.tenant_id == tenant_id,
        CriticalTaskTemplate.is_system == False,
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found or cannot be modified")
    for field in ["name", "description", "category", "priority", "sla_days", "sub_tasks_template"]:
        if field in data:
            setattr(template, field, data[field])
    db.commit()
    db.refresh(template)
    return {
        "id": template.id, "name": template.name, "description": template.description,
        "category": template.category, "priority": template.priority, "sla_days": template.sla_days,
        "sub_tasks_template": template.sub_tasks_template or [],
        "is_system": False,
    }


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    template = db.query(CriticalTaskTemplate).filter(
        CriticalTaskTemplate.id == template_id,
        CriticalTaskTemplate.tenant_id == tenant_id,
        CriticalTaskTemplate.is_system == False,
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Template not found or cannot be deleted")
    db.delete(template)
    db.commit()


@router.post("/create-from-template", status_code=status.HTTP_201_CREATED)
def create_from_template(
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    template_name = data.get("template_name")
    template_id = data.get("template_id")
    template_data = None
    if template_id:
        t = db.query(CriticalTaskTemplate).filter(
            CriticalTaskTemplate.id == template_id,
            (CriticalTaskTemplate.tenant_id == tenant_id) | (CriticalTaskTemplate.is_system == True)
        ).first()
        if t:
            template_data = {
                "category": t.category, "priority": t.priority, "sla_days": t.sla_days,
                "sub_tasks_template": t.sub_tasks_template or [],
                "description": t.description,
            }
    if not template_data and template_name:
        for st in SYSTEM_TEMPLATES:
            if st["name"] == template_name:
                template_data = st
                break
    if not template_data:
        raise HTTPException(status_code=404, detail="Template not found")

    title = data.get("title") or template_name or "Task from Template"
    due_date = None
    if template_data.get("sla_days"):
        due_date = datetime.utcnow() + timedelta(days=template_data["sla_days"])

    user_tenants = get_user_tenants(current_user, db)
    _validate_tenant_user(db, data.get("assigned_owner_id"), user_tenants)
    _validate_tenant_user(db, data.get("reviewer_id"), user_tenants)

    task = CriticalTask(
        tenant_id=tenant_id,
        title=title,
        description=data.get("description") or template_data.get("description", ""),
        source="Manual",
        priority=data.get("priority") or template_data.get("priority", "Medium"),
        category=template_data.get("category", "Other"),
        status="Open",
        assigned_owner_id=data.get("assigned_owner_id"),
        reviewer_id=data.get("reviewer_id"),
        created_by_id=current_user.id,
        due_date=due_date,
        sla_days=template_data.get("sla_days"),
        approval_required=data.get("approval_required", False),
    )
    db.add(task)
    db.flush()

    for sub in template_data.get("sub_tasks_template", []):
        st = CriticalTaskSubTask(
            task_id=task.id,
            title=sub.get("title", sub) if isinstance(sub, dict) else str(sub),
            status="Open",
        )
        db.add(st)

    _add_history(db, task.id, current_user.id, "Created from Template", new_value=template_name or "custom")
    db.commit()
    db.refresh(task)
    return _serialize_task(task, include_relations=True)


@router.post("/{task_id}/request-approval")
def request_approval(
    task_id: int,
    data: dict,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    task = db.query(CriticalTask).filter(
        CriticalTask.id == task_id, CriticalTask.tenant_id.in_(user_tenants)
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    transition_to = data.get("transition_to", "Completed")
    approval = CriticalTaskApproval(
        task_id=task_id,
        requested_by_id=current_user.id,
        approver_id=task.reviewer_id,
        status="Pending",
        transition_from=task.status,
        transition_to=transition_to,
        comment=data.get("comment", ""),
    )
    db.add(approval)
    task.approval_status = "Pending"
    task.updated_at = datetime.utcnow()
    _add_history(db, task_id, current_user.id, "Approval Requested", "approval_status", None, "Pending")
    db.commit()
    db.refresh(approval)

    if task.reviewer_id:
        reviewer = db.query(GRCUser).filter(GRCUser.id == task.reviewer_id).first()
        if reviewer and reviewer.email:
            pref = db.query(NotificationPreference).filter(
                NotificationPreference.user_id == reviewer.id,
                NotificationPreference.tenant_id == task.tenant_id,
            ).first()
            should_notify = not pref or pref.notify_on_approval_request
            if should_notify:
                subject = f"Approval Request: {task.title}"
                body = f"<h2>Approval Request</h2><p>Task <strong>{task.title}</strong> requires your approval to transition from {task.status} to {transition_to}.</p><p>Comment: {data.get('comment', 'None')}</p>"
                background_tasks.add_task(_send_notification_email, reviewer.email, subject, body)

    return {
        "id": approval.id, "status": approval.status,
        "transition_from": approval.transition_from,
        "transition_to": approval.transition_to,
        "comment": approval.comment,
    }


@router.post("/{task_id}/approve")
def approve_task(
    task_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    task = db.query(CriticalTask).filter(
        CriticalTask.id == task_id, CriticalTask.tenant_id.in_(user_tenants)
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.assigned_owner_id == current_user.id:
        raise HTTPException(status_code=403, detail="Task owner cannot approve their own task")
    if task.reviewer_id:
        if task.reviewer_id != current_user.id and not getattr(current_user, 'is_admin', False):
            raise HTTPException(status_code=403, detail="Only the designated reviewer or an admin can approve this task")
    else:
        if not getattr(current_user, 'is_admin', False):
            raise HTTPException(status_code=403, detail="No reviewer assigned. Only an admin can approve this task.")

    pending = db.query(CriticalTaskApproval).filter(
        CriticalTaskApproval.task_id == task_id,
        CriticalTaskApproval.status == "Pending",
    ).order_by(CriticalTaskApproval.created_at.desc()).first()
    if not pending:
        raise HTTPException(status_code=400, detail="No pending approval request")

    pending.status = "Approved"
    pending.approver_id = current_user.id
    pending.response_comment = data.get("comment", "")
    pending.responded_at = datetime.utcnow()

    task.approval_status = "Approved"
    task.approved_by_id = current_user.id
    task.approved_at = datetime.utcnow()
    task.approval_comment = data.get("comment", "")
    task.updated_at = datetime.utcnow()
    _add_history(db, task_id, current_user.id, "Approved", "approval_status", "Pending", "Approved")
    db.commit()
    return {"message": "Task approved", "approval_status": "Approved"}


@router.post("/{task_id}/reject")
def reject_task(
    task_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    task = db.query(CriticalTask).filter(
        CriticalTask.id == task_id, CriticalTask.tenant_id.in_(user_tenants)
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.assigned_owner_id == current_user.id:
        raise HTTPException(status_code=403, detail="Task owner cannot reject their own task")
    if task.reviewer_id:
        if task.reviewer_id != current_user.id and not getattr(current_user, 'is_admin', False):
            raise HTTPException(status_code=403, detail="Only the designated reviewer or an admin can reject this task")
    else:
        if not getattr(current_user, 'is_admin', False):
            raise HTTPException(status_code=403, detail="No reviewer assigned. Only an admin can reject this task.")

    pending = db.query(CriticalTaskApproval).filter(
        CriticalTaskApproval.task_id == task_id,
        CriticalTaskApproval.status == "Pending",
    ).order_by(CriticalTaskApproval.created_at.desc()).first()
    if not pending:
        raise HTTPException(status_code=400, detail="No pending approval request")

    pending.status = "Rejected"
    pending.approver_id = current_user.id
    pending.response_comment = data.get("comment", "")
    pending.responded_at = datetime.utcnow()

    task.approval_status = "Rejected"
    task.approval_comment = data.get("comment", "")
    task.updated_at = datetime.utcnow()
    _add_history(db, task_id, current_user.id, "Rejected", "approval_status", "Pending", "Rejected")
    db.commit()
    return {"message": "Task approval rejected", "approval_status": "Rejected"}


@router.post("/ai/prioritize-tasks")
def ai_prioritize_tasks(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    tasks = db.query(CriticalTask).filter(
        CriticalTask.tenant_id.in_(user_tenants),
        CriticalTask.status.notin_(["Completed", "Verified"]),
    ).order_by(CriticalTask.created_at.desc()).limit(50).all()

    if not tasks:
        return {"suggestions": [], "message": "No open tasks to prioritize"}

    task_summaries = []
    for t in tasks:
        task_summaries.append({
            "id": t.id, "title": t.title, "current_priority": t.priority,
            "status": t.status, "category": t.category, "source": t.source,
            "due_date": t.due_date.isoformat() if t.due_date else None,
            "sla_status": _calc_sla_status(t),
            "escalation_level": t.escalation_level,
        })

    client = _get_openai_client()
    try:
        response = client.chat.completions.create(
            model=_get_openai_model(),
            messages=[
                {"role": "system", "content": "You are a GRC task prioritization expert. Analyze the tasks and suggest priority reordering based on risk impact, SLA proximity, dependencies, and business context. Return JSON."},
                {"role": "user", "content": f"Analyze these tasks and suggest priority changes:\n{json.dumps(task_summaries)}\n\nReturn JSON: {{\"suggestions\": [{{\"task_id\": int, \"current_priority\": str, \"suggested_priority\": str, \"justification\": str}}]}}"},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        return json.loads(response.choices[0].message.content)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


@router.post("/{task_id}/ai/analyze-root-cause")
def ai_analyze_root_cause(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    task = db.query(CriticalTask).options(
        joinedload(CriticalTask.sub_tasks),
        joinedload(CriticalTask.comments).joinedload(CriticalTaskComment.user),
    ).filter(CriticalTask.id == task_id, CriticalTask.tenant_id.in_(user_tenants)).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    context = {
        "title": task.title,
        "description": task.description,
        "source": task.source,
        "source_module": task.source_module,
        "category": task.category,
        "priority": task.priority,
        "severity": task.severity,
        "status": task.status,
        "evidence_notes": task.evidence_notes,
        "comments": [c.content for c in (task.comments or [])],
    }

    client = _get_openai_client()
    try:
        response = client.chat.completions.create(
            model=_get_openai_model(),
            messages=[
                {"role": "system", "content": "You are a GRC root cause analysis expert. Analyze the task/finding context and identify root causes and recommended remediation actions. Return JSON."},
                {"role": "user", "content": f"Analyze this task for root causes:\n{json.dumps(context)}\n\nReturn JSON: {{\"analysis\": {{\"root_causes\": [{{\"cause\": str, \"category\": str, \"confidence\": str}}], \"remediation_actions\": [{{\"action\": str, \"priority\": str, \"effort\": str, \"description\": str}}], \"summary\": str}}}}"},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        return json.loads(response.choices[0].message.content)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")


@router.post("/ai/generate-description")
def ai_generate_description(
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    title = data.get("title", "")
    source = data.get("source", "Manual")
    category = data.get("category", "Other")
    context = data.get("context", "")

    if not title:
        raise HTTPException(status_code=422, detail="Title is required")

    client = _get_openai_client()
    try:
        response = client.chat.completions.create(
            model=_get_openai_model(),
            messages=[
                {"role": "system", "content": "You are a GRC task management expert. Generate a detailed task description with acceptance criteria from the given title and context. Return JSON."},
                {"role": "user", "content": f"Generate a task description for:\nTitle: {title}\nSource: {source}\nCategory: {category}\nContext: {context}\n\nReturn JSON: {{\"description\": {{\"summary\": str, \"detailed_description\": str, \"acceptance_criteria\": [str], \"suggested_sub_tasks\": [str]}}}}"},
            ],
            response_format={"type": "json_object"},
            temperature=0.4,
        )
        return json.loads(response.choices[0].message.content)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")


@router.post("/ai/predict-escalations")
def ai_predict_escalations(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    tasks = db.query(CriticalTask).options(
        joinedload(CriticalTask.assigned_owner),
    ).filter(
        CriticalTask.tenant_id.in_(user_tenants),
        CriticalTask.status.notin_(["Completed", "Verified"]),
        CriticalTask.due_date.isnot(None),
    ).order_by(CriticalTask.due_date.asc()).limit(50).all()

    if not tasks:
        return {"predictions": [], "message": "No tasks with SLA to analyze"}

    task_data = []
    now = datetime.utcnow()
    for t in tasks:
        days_remaining = (t.due_date - now).days if t.due_date else None
        task_data.append({
            "id": t.id, "title": t.title, "priority": t.priority,
            "status": t.status, "category": t.category,
            "due_date": t.due_date.isoformat() if t.due_date else None,
            "days_remaining": days_remaining,
            "escalation_level": t.escalation_level,
            "sla_days": t.sla_days,
            "owner": t.assigned_owner.display_name if t.assigned_owner else "Unassigned",
        })

    client = _get_openai_client()
    try:
        response = client.chat.completions.create(
            model=_get_openai_model(),
            messages=[
                {"role": "system", "content": "You are a GRC escalation prediction expert. Analyze tasks and predict which are likely to breach SLA, with risk scores and recommended actions. Return JSON."},
                {"role": "user", "content": f"Predict which tasks may breach SLA:\n{json.dumps(task_data)}\n\nReturn JSON: {{\"predictions\": [{{\"task_id\": int, \"title\": str, \"risk_score\": float, \"predicted_breach_date\": str, \"confidence\": str, \"risk_factors\": [str], \"recommended_actions\": [str]}}]}}"},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        return json.loads(response.choices[0].message.content)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI prediction failed: {str(e)}")


@router.post("/ai/balance-workload")
def ai_balance_workload(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    user_tenants = get_user_tenants(current_user, db)
    tasks = db.query(CriticalTask).options(
        joinedload(CriticalTask.assigned_owner),
    ).filter(
        CriticalTask.tenant_id.in_(user_tenants),
        CriticalTask.status.notin_(["Completed", "Verified"]),
    ).all()

    if not tasks:
        return {"suggestions": [], "message": "No active tasks to balance"}

    workload = {}
    task_data = []
    for t in tasks:
        owner_name = t.assigned_owner.display_name if t.assigned_owner else "Unassigned"
        owner_id = t.assigned_owner_id
        if owner_name not in workload:
            workload[owner_name] = {"user_id": owner_id, "count": 0, "critical": 0, "high": 0}
        workload[owner_name]["count"] += 1
        if t.priority == "Critical":
            workload[owner_name]["critical"] += 1
        elif t.priority == "High":
            workload[owner_name]["high"] += 1
        task_data.append({
            "id": t.id, "title": t.title, "priority": t.priority,
            "category": t.category, "owner": owner_name, "owner_id": owner_id,
            "due_date": t.due_date.isoformat() if t.due_date else None,
        })

    owner_name_to_id = {name: info["user_id"] for name, info in workload.items() if info.get("user_id")}

    client = _get_openai_client()
    try:
        response = client.chat.completions.create(
            model=_get_openai_model(),
            messages=[
                {"role": "system", "content": "You are a GRC workload management expert. Analyze team workload and suggest task reassignments to balance work. Return JSON."},
                {"role": "user", "content": f"Current workload:\n{json.dumps(workload)}\n\nTasks:\n{json.dumps(task_data)}\n\nReturn JSON: {{\"current_workload\": {{\"owner_name\": {{\"task_count\": int, \"load_level\": str}}}}, \"suggestions\": [{{\"task_id\": int, \"task_title\": str, \"current_owner\": str, \"suggested_owner\": str, \"reason\": str}}], \"summary\": str}}"},
            ],
            response_format={"type": "json_object"},
            temperature=0.3,
        )
        result = json.loads(response.choices[0].message.content)
        for suggestion in result.get("suggestions", []):
            suggested_name = suggestion.get("suggested_owner", "")
            suggestion["suggested_owner_id"] = owner_name_to_id.get(suggested_name)
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI analysis failed: {str(e)}")

