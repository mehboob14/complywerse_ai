"""Critical Task → IssueAction status sync.

When a Critical Task is updated (status / transition), if it carries a
`linked_issue_action_id` we mirror the new status onto the IssueAction
so the CAPA tab in the Issue UI stays in sync with the work happening in
/tasks. One-way only — IssueAction edits do NOT push back to the task
(avoids loops; once promoted, the task is the canonical work record).

Hook is called at the *end* of update_critical_task() and the status
transition handler in critical_tasks_router. Safe to call with any
task_id — no-ops for tasks without a linked action.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from ....models import CriticalTask, IssueAction, IssueActivity


# Critical Task status → IssueAction status. Values not in this map leave
# the action unchanged (e.g. "Open" → leave whatever the action already is).
_STATUS_MAP = {
    "Open":         None,            # neutral — don't push
    "In Progress":  "in_progress",
    "Under Review": "in_progress",
    "Completed":    "completed",
    "Verified":     "verified",
    "Reopened":     "in_progress",
}


def sync_action_from_task(task_id: int, db: Session, user_id: Optional[int] = None) -> None:
    """No-op if the task has no linked action. Otherwise mirror status."""
    task = db.query(CriticalTask).filter(CriticalTask.id == task_id).first()
    if task is None or not task.linked_issue_action_id:
        return

    action = db.query(IssueAction).filter(IssueAction.id == task.linked_issue_action_id).first()
    if action is None:
        return

    target_status = _STATUS_MAP.get(task.status)
    if target_status is None or action.status == target_status:
        return

    old_status = action.status
    action.status = target_status
    if target_status == "completed" and not action.completed_at:
        action.completed_at = datetime.utcnow()
    if target_status == "verified" and not action.verified_at:
        action.verified_at = datetime.utcnow()
        if user_id and not action.verified_by_id:
            action.verified_by_id = user_id

    db.add(IssueActivity(
        issue_id=action.issue_id,
        user_id=user_id,
        type="action_status_synced_from_task",
        payload={
            "action_id": action.id,
            "task_id": task.id,
            "task_status": task.status,
            "from_status": old_status,
            "to_status": target_status,
        },
    ))
    # Caller is responsible for db.commit() since this runs inside the
    # critical-task transaction.
