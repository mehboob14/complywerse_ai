"""Programmatic issue auto-creation — callable from other modules.

Other modules (ERM/KRI, governance reviews, mitigation actions, etc.)
import these helpers and call them at event points to spawn an Issue
without going through the HTTP layer. All helpers are guarded by the
per-tenant IssueAutomationFlags table — if the flag is OFF, the call is
a no-op and existing behaviour is preserved exactly.

Each helper is also de-duplicated: if an *open* issue already exists for
the same (source_type, source_id), no second one is created.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from sqlalchemy.orm import Session

from ....models import Issue, IssueActivity
from .severity_resolver import resolve_severity
from .code_generator import next_issue_code
from ..routers.automation_flags import is_enabled


OPEN_STATES = {"new", "triage", "in_progress", "resolution", "closure_review"}


def _open_issue_for(
    tenant_id: int, source_type: str, source_id: int, db: Session,
) -> Optional[Issue]:
    """De-dup guard — find an existing open issue for this source pair."""
    return db.query(Issue).filter(
        Issue.tenant_id == tenant_id,
        Issue.source_type == source_type,
        Issue.source_id == source_id,
        Issue.workflow_state.in_(OPEN_STATES),
    ).first()


def from_event(
    *,
    db: Session,
    tenant_id: int,
    source_type: str,
    source_id: int,
    title: str,
    description: Optional[str] = None,
    impact: str = "medium",
    urgency: str = "medium",
    issue_type: str = "incident",
    category: str = "operations",
    assignee_id: Optional[int] = None,
    reporter_id: Optional[int] = None,
    feature_flag: Optional[str] = None,
) -> Optional[Issue]:
    """Spawn an Issue from an event in another module.

    Returns the created Issue, or None if either:
      - the tenant has the required automation flag turned off, or
      - an open issue for the same source already exists (de-dup).

    Callers are responsible for db.commit() — we add the rows but defer
    commit so the caller's surrounding transaction stays atomic.
    """
    if feature_flag and not is_enabled(tenant_id, feature_flag, db):
        return None

    existing = _open_issue_for(tenant_id, source_type, source_id, db)
    if existing is not None:
        return None

    computed_severity, _ack, resolve_hours = resolve_severity(
        impact=impact, urgency=urgency, tenant_id=tenant_id, db=db,
    )
    detected_at = datetime.utcnow()
    target_close = detected_at + timedelta(hours=resolve_hours)

    issue = Issue(
        tenant_id=tenant_id,
        title=title,
        description=description,
        severity=computed_severity,
        impact=impact,
        urgency=urgency,
        issue_type=issue_type,
        category=category,
        detected_at=detected_at,
        target_closure_date=target_close,
        reporter_id=reporter_id,
        assignee_id=assignee_id,
        source_type=source_type,
        source_id=source_id,
        workflow_state="new",
        status="open",
    )
    db.add(issue)
    db.flush()
    issue.code = next_issue_code(tenant_id, db)

    db.add(IssueActivity(
        issue_id=issue.id,
        user_id=reporter_id,
        type="auto_created",
        payload={
            "source_type": source_type,
            "source_id": source_id,
            "feature_flag": feature_flag,
            "computed_severity": computed_severity,
        },
    ))
    from .capa_defaults import ensure_initial_capa
    ensure_initial_capa(db, issue=issue, user_id=reporter_id)
    return issue
