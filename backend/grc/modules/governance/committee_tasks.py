"""Committee action items also live in Task Management.

Every action on a committee has a twin in Task Management (grc_critical_tasks, source_module "committees"), so the
people doing the work see it with the rest of their tasks. The action's priority sets its SLA: the days Task
Management's own SLA table gives that priority (Settings, module "tasks"), so one table serves both places. Either side
can change an action: the committee endpoints write the twin through `mirror`, and Task Management's endpoints write
the action back through `sync_from_critical_task`. Neither goes through the other's API, so an edit never echoes back.
Deleting the action (or its committee) deletes the twin, and deleting the twin deletes the action.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, Optional, Tuple

from sqlalchemy.orm import Session

from ...models import CriticalTask, OversightAction
from ...services.module_settings import get_settings, sla_state, target_days
from .regulatory_tasks import _history, _ids, _set_status

SOURCE = "Committee Action"
SOURCE_MODULE = "committees"
SOURCE_TYPE = "OversightAction"
SLA_MODULE = "tasks"        # the settings whose SLA table the priorities use

PRIORITIES = ("critical", "high", "medium", "low", "info")
# Task Management has more steps; each action status maps to the first that means it.
_TO_TASKS = {"open": "Open", "in_progress": "In Progress", "completed": "Completed", "overdue": "Open"}
_FROM_TASKS = {"Open": "open", "In Progress": "in_progress", "Under Review": "in_progress",
               "Completed": "completed", "Verified": "completed", "Reopened": "in_progress"}


def clean_priority(value: Optional[str]) -> str:
    """The priority as stored (lower case). Left out means medium; anything unknown is a ValueError."""
    text = (value or "medium").strip().lower()
    if text not in PRIORITIES:
        raise ValueError(f"Priority must be one of: {', '.join(PRIORITIES)}")
    return text


def sla_settings(db: Session, tenant_id: int) -> Dict[str, Any]:
    return get_settings(db, tenant_id, SLA_MODULE)


def default_due(settings: Dict[str, Any], priority: str, opened_at: datetime) -> Optional[datetime]:
    """When an action with no date of its own is due: when it was raised plus its priority's SLA days."""
    days = target_days(settings, priority)
    return opened_at + timedelta(days=days) if days is not None else None


def prepare(db: Session, tenant_id: int, priority: Optional[str], due_date: Optional[datetime]
            ) -> Tuple[str, Optional[datetime], datetime]:
    """What a new action gets: its priority, its due date (a date left out comes from the SLA) and when it was raised."""
    priority, now = clean_priority(priority), datetime.utcnow()
    return priority, due_date or default_due(sla_settings(db, tenant_id), priority, now), now


def due_after_reprioritising(db: Session, action: OversightAction, priority: str) -> Optional[datetime]:
    """The due date once the priority changes. A date that was only the old priority's SLA moves with it;
    one somebody chose stays."""
    settings, opened = sla_settings(db, action.tenant_id), action.created_at or datetime.utcnow()
    old = default_due(settings, action.priority or "medium", opened)
    if action.due_date is not None and (old is None or action.due_date.date() != old.date()):
        return action.due_date
    return default_due(settings, priority, opened) or action.due_date


def sla_of(action: OversightAction, settings: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Where the action stands against the SLA for its priority."""
    if settings is None:
        settings = sla_settings(Session.object_session(action), action.tenant_id)
    return sla_state(settings, status=action.status, due_date=action.due_date,
                     priority=action.priority or "medium", opened_at=action.created_at)


def mirror(db: Session, action: OversightAction, user_id: Optional[int] = None) -> CriticalTask:
    """Create or update the action's twin in Task Management from the action."""
    settings = sla_settings(db, action.tenant_id)
    priority = action.priority or "medium"
    wanted = {
        "title": (action.title or "Committee action")[:255],
        "description": action.description,
        "priority": priority.capitalize(),
        "due_date": action.due_date,
    }
    ct = db.get(CriticalTask, action.critical_task_id) if action.critical_task_id else None
    if ct is None:
        ids = [action.assigned_to] if action.assigned_to else []
        ct = CriticalTask(tenant_id=action.tenant_id, source=SOURCE, source_module=SOURCE_MODULE,
                          source_entity_type=SOURCE_TYPE, source_entity_id=action.id, category="Governance",
                          status="Open", created_by_id=user_id or action.created_by, assigned_user_ids=ids,
                          assigned_owner_id=action.assigned_to, sla_days=target_days(settings, priority), **wanted)
        _set_status(ct, _TO_TASKS.get(action.status, "Open"), action.completed_at)
        db.add(ct)
        db.flush()
        action.critical_task_id = ct.id
        _history(db, ct.id, user_id, f"Created from {SOURCE_MODULE}", "source_entity", None, f"{SOURCE_TYPE} #{action.id}")
        return ct

    changed = False
    for field, value in wanted.items():
        if getattr(ct, field) != value:
            if field != "description":
                _history(db, ct.id, user_id, "Synced from Committees", field, getattr(ct, field), value)
            if field == "priority":
                ct.sla_days = target_days(settings, priority)
            setattr(ct, field, value)
            changed = True
    # The action has one assignee; Task Management may have added more, and keeps them while the first is unchanged.
    ids = _ids(ct.assigned_user_ids) or _ids([ct.assigned_owner_id])
    if (ids[0] if ids else None) != action.assigned_to:
        new_ids = [action.assigned_to] if action.assigned_to else []
        _history(db, ct.id, user_id, "Synced from Committees", "assigned_user_ids", ids, new_ids)
        ct.assigned_user_ids, ct.assigned_owner_id = new_ids, action.assigned_to
        changed = True
    # A finer Task Management step that means the same (Under Review, Verified) is left as it is.
    target = _TO_TASKS.get(action.status, "Open")
    if action.status != "overdue" and _FROM_TASKS.get(ct.status) != action.status and ct.status != target:
        _history(db, ct.id, user_id, "Synced from Committees", "status", ct.status, target)
        _set_status(ct, target, action.completed_at)
        changed = True
    if changed:
        ct.updated_at = datetime.utcnow()
    return ct


def sync_from_critical_task(db: Session, critical_task_id: int, user_id: Optional[int] = None) -> None:
    """Task Management changed a twin: the action follows. No-op for any other task."""
    ct = db.get(CriticalTask, critical_task_id)
    if ct is None or ct.source_module != SOURCE_MODULE or ct.source_entity_type != SOURCE_TYPE:
        return
    action = db.get(OversightAction, ct.source_entity_id)
    if action is None or action.critical_task_id != ct.id:
        return
    status = _FROM_TASKS.get(ct.status)
    if status and status != action.status and not (action.status == "overdue" and status == "open"):
        action.status = status
        action.completed_at = (ct.completed_at or datetime.utcnow()) if status == "completed" else None
    ids = _ids(ct.assigned_user_ids) or _ids([ct.assigned_owner_id])
    action.assigned_to = ids[0] if ids else None
    if ct.title and ct.title != (action.title or "")[:255]:
        action.title = ct.title
    if ct.description != action.description:
        action.description = ct.description
    action.due_date = ct.due_date
    priority = (ct.priority or "").lower()
    if priority in PRIORITIES:
        action.priority = priority


def drop_twin(db: Session, action: OversightAction) -> None:
    """The action is going: so is its twin."""
    if action.critical_task_id:
        ct = db.get(CriticalTask, action.critical_task_id)
        if ct is not None:
            db.delete(ct)


def on_critical_task_deleted(db: Session, ct: CriticalTask) -> None:
    """Task Management is deleting a twin: the action goes too."""
    if ct.source_module != SOURCE_MODULE or ct.source_entity_type != SOURCE_TYPE:
        return
    action = db.get(OversightAction, ct.source_entity_id)
    if action is not None and action.critical_task_id == ct.id:
        db.delete(action)


def backfill(db: Session) -> int:
    """Give every action made before twins existed its twin. Returns how many."""
    rows = db.query(OversightAction).filter(OversightAction.critical_task_id.is_(None)).all()
    for action in rows:
        mirror(db, action, action.created_by)
    return len(rows)
