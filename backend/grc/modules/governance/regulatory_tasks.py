"""Regulatory implementation tasks also live in Task Management.

Every task on a regulatory change has a twin in Task Management
(grc_critical_tasks, source_module "regulatory_changes"), so the people doing the
work see it with the rest of their tasks, assigned to every one of them. Either
side can change it: the regulatory endpoints write the twin through `mirror`, and
Task Management's endpoints write the regulatory task back through
`sync_from_critical_task`. Neither goes through the other's API, so an edit never
echoes back. Deleting either deletes both.
"""
from __future__ import annotations

from datetime import datetime
from typing import Iterable, List, Optional

from sqlalchemy.orm import Session

from ...models import CriticalTask, CriticalTaskHistory, GRCUser, RegulatoryImplementationTask

SOURCE = "Regulatory Change"
SOURCE_MODULE = "regulatory_changes"
SOURCE_TYPE = "RegulatoryImplementationTask"

# Task Management has more steps; each regulatory status maps to the first that means it.
_TO_TASKS = {"pending": "Open", "in_progress": "In Progress", "blocked": "In Progress", "completed": "Completed"}
_FROM_TASKS = {"Open": "pending", "In Progress": "in_progress", "Under Review": "in_progress",
               "Completed": "completed", "Verified": "completed", "Reopened": "in_progress"}
_PRIORITIES = ("critical", "high", "medium", "low")


def _ids(values: Optional[Iterable]) -> List[int]:
    return list(dict.fromkeys(int(v) for v in (values or []) if v))


def assignees_of(task: RegulatoryImplementationTask) -> List[int]:
    """Everyone on a regulatory task; a task from before several were allowed has its one."""
    return _ids(task.assignee_ids) or _ids([task.assigned_to])


def set_assignees(task: RegulatoryImplementationTask, ids: Optional[Iterable]) -> None:
    ids = _ids(ids)
    task.assignee_ids = ids
    task.assigned_to = ids[0] if ids else None


def check_users(db: Session, ids: Iterable[int]) -> List[int]:
    """The ids, if each is an active user here; otherwise ValueError naming the rest."""
    ids = _ids(ids)
    found = {u.id for u in db.query(GRCUser.id).filter(GRCUser.id.in_(ids), GRCUser.is_active.is_(True))} if ids else set()
    missing = [i for i in ids if i not in found]
    if missing:
        raise ValueError(f"Unknown or inactive users: {missing}")
    return ids


def _history(db: Session, ct_id: int, user_id: Optional[int], action: str, field: Optional[str] = None,
             old=None, new=None) -> None:
    db.add(CriticalTaskHistory(task_id=ct_id, user_id=user_id, action=action, field_changed=field,
                               old_value=None if old is None else str(old), new_value=None if new is None else str(new)))


def _set_status(ct: CriticalTask, status: str, completed_at: Optional[datetime]) -> None:
    ct.status = status
    if status in ("Completed", "Verified"):
        ct.completed_at = ct.completed_at or completed_at or datetime.utcnow()
    else:
        ct.completed_at, ct.verified_at = None, None


def mirror(db: Session, task: RegulatoryImplementationTask, user_id: Optional[int] = None) -> CriticalTask:
    """Create or update the task's twin in Task Management from the regulatory task."""
    ids = assignees_of(task)
    wanted = {
        "title": (task.title or "Regulatory task")[:255],
        "description": task.description,
        "priority": (task.priority if task.priority in _PRIORITIES else "medium").capitalize(),
        "due_date": task.due_date,
        "assigned_user_ids": ids,
        "assigned_owner_id": ids[0] if ids else None,
    }
    ct = db.get(CriticalTask, task.critical_task_id) if task.critical_task_id else None
    if ct is None:
        ct = CriticalTask(tenant_id=task.tenant_id, source=SOURCE, source_module=SOURCE_MODULE,
                          source_entity_type=SOURCE_TYPE, source_entity_id=task.id, category="Compliance",
                          status="Open", created_by_id=user_id or task.created_by,
                          linked_regulatory_change_id=task.regulatory_change_id, **wanted)
        _set_status(ct, _TO_TASKS.get(task.status, "Open"), task.completed_at)
        db.add(ct)
        db.flush()
        task.critical_task_id = ct.id
        _history(db, ct.id, user_id, f"Created from {SOURCE_MODULE}", "source_entity", None, f"{SOURCE_TYPE} #{task.id}")
        return ct

    changed = False
    for field, value in wanted.items():
        if getattr(ct, field) != value:
            if field != "description":
                _history(db, ct.id, user_id, "Synced from Regulatory Changes", field, getattr(ct, field), value)
            setattr(ct, field, value)
            changed = True
    # A finer Task Management step that means the same (Under Review, Verified) is left as it is.
    target = _TO_TASKS.get(task.status, "Open")
    if _FROM_TASKS.get(ct.status) != task.status and ct.status != target:
        _history(db, ct.id, user_id, "Synced from Regulatory Changes", "status", ct.status, target)
        _set_status(ct, target, task.completed_at)
        changed = True
    if changed:
        ct.updated_at = datetime.utcnow()
    return ct


def sync_from_critical_task(db: Session, critical_task_id: int, user_id: Optional[int] = None) -> None:
    """Task Management changed a twin: the regulatory task follows. No-op for any other task."""
    ct = db.get(CriticalTask, critical_task_id)
    if ct is None or ct.source_module != SOURCE_MODULE or ct.source_entity_type != SOURCE_TYPE:
        return
    task = db.get(RegulatoryImplementationTask, ct.source_entity_id)
    if task is None or task.critical_task_id != ct.id:
        return
    status = _FROM_TASKS.get(ct.status)
    if status and status != task.status and not (task.status == "blocked" and status == "in_progress"):
        task.status = status
        task.completed_at = (ct.completed_at or datetime.utcnow()) if status == "completed" else None
    ids = _ids(ct.assigned_user_ids) or _ids([ct.assigned_owner_id])
    if ids != assignees_of(task):
        set_assignees(task, ids)
    if ct.title and ct.title != (task.title or "")[:255]:
        task.title = ct.title
    if ct.description != task.description:
        task.description = ct.description
    task.due_date = ct.due_date
    priority = (ct.priority or "").lower()
    if priority in _PRIORITIES:
        task.priority = priority


def drop_twin(db: Session, task: RegulatoryImplementationTask) -> None:
    """The regulatory task is going: so is its twin."""
    if task.critical_task_id:
        ct = db.get(CriticalTask, task.critical_task_id)
        if ct is not None:
            db.delete(ct)


def on_critical_task_deleted(db: Session, ct: CriticalTask) -> None:
    """Task Management is deleting a twin: the regulatory task goes too."""
    if ct.source_module != SOURCE_MODULE or ct.source_entity_type != SOURCE_TYPE:
        return
    task = db.get(RegulatoryImplementationTask, ct.source_entity_id)
    if task is not None and task.critical_task_id == ct.id:
        db.delete(task)


def backfill(db: Session) -> int:
    """Give every regulatory task made before twins existed its twin. Returns how many."""
    rows = db.query(RegulatoryImplementationTask).filter(RegulatoryImplementationTask.critical_task_id.is_(None)).all()
    for task in rows:
        mirror(db, task, task.created_by)
    return len(rows)
