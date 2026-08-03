"""Shared helpers for creating CAPA (IssueAction) rows."""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from ....models import Issue, IssueAction, IssueActivity


def ensure_initial_capa(
    db: Session,
    *,
    issue: Issue,
    user_id: Optional[int],
    title: Optional[str] = None,
    action_type: str = "corrective",
) -> Optional[IssueAction]:
    """Create a default planned CAPA action when an issue is auto-generated.

    Idempotent for the caller's transaction: if the issue already has any
    actions, this is a no-op so we never duplicate on retries.
    """
    existing = (
        db.query(IssueAction.id)
        .filter(IssueAction.issue_id == issue.id)
        .first()
    )
    if existing:
        return None

    capa_title = (title or f"Investigate and remediate: {issue.title}").strip()[:255]
    if action_type not in {"corrective", "preventive", "containment", "verification"}:
        action_type = "corrective"

    action = IssueAction(
        issue_id=issue.id,
        action_type=action_type,
        title=capa_title,
        description=(
            "Auto-generated CAPA for this issue. Update status, assignee, and "
            "due date as work progresses."
        ),
        assignee_id=issue.assignee_id,
        due_date=issue.target_closure_date or issue.due_date,
        status="planned",
        created_by=user_id,
    )
    db.add(action)
    db.flush()
    db.add(IssueActivity(
        issue_id=issue.id,
        user_id=user_id,
        type="action_added",
        payload={
            "action_id": action.id,
            "action_type": action.action_type,
            "title": action.title,
            "source": "auto_generated",
        },
    ))
    return action
