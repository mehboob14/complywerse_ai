"""Risk actions on the CAPA engine (Risk Management decision 2: one action tracker).

Each risk has one treatment issue (issue_type "risk_treatment", source_type "risk", source_id = the risk's id, linked
to the risk), made the first time an action is added. The risk's actions are that issue's IssueActions, so they get
the engine's SLA, completion, verification by a second person and closure rule.

Rows of the old RiskMitigationAction table are copied over once by migrate_legacy_actions, which the action lists call
on first use (and engine start-up may call). The old rows stay, read-only, for audit.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Dict, Iterable, Optional

from sqlalchemy import func
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ....models import (Issue, IssueAction, IssueActionEvidence, IssueActivity, IssueRiskLink, Risk,
                        RiskMitigationAction, risk_priority_for_score)
from .code_generator import next_issue_code
from .severity_resolver import resolve_severity

logger = logging.getLogger(__name__)

RISK_TREATMENT = "risk_treatment"
OPEN_ACTION_STATUSES = ("planned", "in_progress", "blocked")
DONE_ACTION_STATUSES = ("completed", "verified", "cancelled")
# The old mitigation-action words on the CAPA list. Overdue is computed from the due date, never stored.
LEGACY_STATUS = {"pending": "planned", "open": "planned", "not_started": "planned", "overdue": "planned",
                 "planned": "planned", "in_progress": "in_progress", "blocked": "blocked",
                 "completed": "completed", "cancelled": "cancelled"}
# The risk's band picks the treatment issue's impact and urgency, so the engine's matrix sets its severity and SLA.
_IMPACT_URGENCY = {"critical": ("high", "high"), "high": ("high", "medium"), "medium": ("medium", "medium"),
                   "low": ("low", "medium")}


def risk_actions_query(db: Session, tenant_ids: Iterable[int]):
    """IssueActions on risk treatment issues in these tenants (the risk is Issue.source_id)."""
    return db.query(IssueAction).join(Issue, Issue.id == IssueAction.issue_id).filter(
        Issue.issue_type == RISK_TREATMENT, Issue.tenant_id.in_(list(tenant_ids)))


def _new_treatment_issue(db: Session, risk: Risk, user_id: Optional[int]) -> Issue:
    impact, urgency = _IMPACT_URGENCY[risk_priority_for_score(risk.residual_score or risk.inherent_score) or "medium"]
    severity, _ack, resolve_hours = resolve_severity(impact=impact, urgency=urgency, tenant_id=risk.tenant_id, db=db)
    now = datetime.utcnow()
    issue = Issue(
        tenant_id=risk.tenant_id, title=f"Treat: {risk.title}"[:255],
        description="The actions that treat this risk, kept in Risk Management > Actions & Acceptances.",
        severity=severity, impact=impact, urgency=urgency, issue_type=RISK_TREATMENT, category="operations",
        detected_at=now, target_closure_date=now + timedelta(hours=resolve_hours),
        owner_id=risk.owner_id, reporter_id=user_id, source_type="risk", source_id=risk.id,
        workflow_state="in_progress", status="open",
    )
    db.add(issue)
    db.flush()
    issue.code = next_issue_code(risk.tenant_id, db)
    db.add(IssueRiskLink(issue_id=issue.id, risk_id=risk.id, link_type="stems_from", created_by=user_id))
    db.add(IssueActivity(issue_id=issue.id, user_id=user_id, type="created", payload={
        "source_type": "risk", "source_id": risk.id, "computed_severity": severity, "resolve_hours": resolve_hours}))
    return issue


def treatment_issue(db: Session, risk: Risk, user_id: Optional[int] = None) -> Issue:
    """The risk's one treatment issue: made on first use; reopened when a closed one gets a new action."""
    issue = db.query(Issue).filter(
        Issue.tenant_id == risk.tenant_id, Issue.issue_type == RISK_TREATMENT,
        Issue.source_type == "risk", Issue.source_id == risk.id,
    ).order_by(Issue.id).first()
    if issue is None:
        return _new_treatment_issue(db, risk, user_id)
    if issue.workflow_state in ("closed", "cancelled"):
        db.add(IssueActivity(issue_id=issue.id, user_id=user_id, type="reopened",
                             payload={"from": issue.workflow_state, "reason": "A new action was added to the risk"}))
        issue.workflow_state, issue.status, issue.closed_at = "in_progress", "open", None
        issue.approved_at = issue.approved_by_id = None
    return issue


def add_risk_action(db: Session, risk: Risk, user_id: Optional[int], *, title: str, status: str = "planned",
                    due_date: Optional[datetime] = None, **fields) -> IssueAction:
    """A new action on the risk. No due date given: the treatment issue's SLA date. The caller commits."""
    issue = treatment_issue(db, risk, user_id)
    action = IssueAction(issue_id=issue.id, title=title, status=status, created_by=user_id,
                         due_date=due_date or issue.target_closure_date, **fields)
    db.add(action)
    db.flush()
    db.add(IssueActivity(issue_id=issue.id, user_id=user_id, type="action_added",
                         payload={"action_id": action.id, "action_type": action.action_type, "title": title}))
    return action


def move_risk_action(db: Session, action: IssueAction, risk: Risk, user_id: Optional[int] = None) -> None:
    """Put the action on another risk's treatment issue."""
    action.issue = treatment_issue(db, risk, user_id)


def legacy_shaped_actions(db: Session, tenant_ids: Iterable[int]) -> list:
    """Risk actions shaped like the old RiskMitigationAction rows (risk_id, status, title, due_date, completed_at, created_at,
    expected/actual reduction, priority) for the dashboards that still aggregate them. A verified action counts as completed."""
    from types import SimpleNamespace
    tenant_ids = list(tenant_ids)
    migrate_legacy_actions(db, tenant_ids)
    rows = (db.query(IssueAction, Issue.source_id).join(Issue, Issue.id == IssueAction.issue_id)
            .filter(Issue.issue_type == RISK_TREATMENT, Issue.tenant_id.in_(tenant_ids)).all())
    return [SimpleNamespace(
        id=a.id, risk_id=risk_id, title=a.title, due_date=a.due_date, completed_at=a.completed_at, created_at=a.created_at,
        action_type=a.action_type, description=a.description, owner_id=a.assignee_id, issue_id=a.issue_id,
        status="completed" if a.status == "verified" else a.status, priority=getattr(a, "priority", None),
        expected_residual_reduction=getattr(a, "expected_residual_reduction", None),
        actual_residual_reduction=getattr(a, "actual_residual_reduction", None)) for a, risk_id in rows]


def risk_action_counts(db: Session, risks) -> Dict[int, int]:
    """{risk id: number of actions} for the register list."""
    if not risks:
        return {}
    migrate_legacy_actions(db, {r.tenant_id for r in risks})
    return dict(db.query(Issue.source_id, func.count(IssueAction.id))
                .join(IssueAction, IssueAction.issue_id == Issue.id)
                .filter(Issue.issue_type == RISK_TREATMENT, Issue.source_id.in_([r.id for r in risks]))
                .group_by(Issue.source_id).all())


def _copy_legacy(db: Session, row: RiskMitigationAction, now: datetime) -> IssueAction:
    issue = treatment_issue(db, row.risk)
    old_status = _legacy_word(row.status)
    status = LEGACY_STATUS.get(old_status, "planned")
    due = row.due_date
    if old_status == "overdue" and due is None:      # keep it overdue: it was late by the time it was marked
        due = row.updated_at or row.created_at or now
    links = {link.evidence_id: link for link in row.evidence_links}
    evidence_ids = list(dict.fromkeys(e for e in (row.evidence_id, *links) if e))
    action = IssueAction(
        issue_id=issue.id, action_type=row.action_type or "mitigate", title=row.title, description=row.description,
        assignee_id=row.owner_id, due_date=due, status=status,
        completed_at=(row.completed_at or row.updated_at or now) if status == "completed" else None,
        priority=row.priority, expected_residual_reduction=row.expected_residual_reduction,
        actual_residual_reduction=row.actual_residual_reduction, notes=row.notes,
        evidence_id=evidence_ids[0] if evidence_ids else None,
        created_at=row.created_at or now, legacy_mitigation_action_id=row.id,
    )
    db.add(action)
    db.flush()
    for evidence_id in evidence_ids:
        link = links.get(evidence_id)
        db.add(IssueActionEvidence(issue_action_id=action.id, evidence_id=evidence_id, tenant_id=issue.tenant_id,
                                   linked_by=link.linked_by if link else None,
                                   linked_at=(link.linked_at if link else None) or now,
                                   notes=link.notes if link else None))
    db.add(IssueActivity(issue_id=issue.id, type="action_added", payload={
        "action_id": action.id, "title": action.title, "source": "migrated", "legacy_mitigation_action_id": row.id}))
    # Mark the old row without touching its updated_at: it stays as it was for audit.
    db.query(RiskMitigationAction).filter(RiskMitigationAction.id == row.id).update(
        {RiskMitigationAction.migrated_to_issue_action_id: action.id,
         RiskMitigationAction.updated_at: RiskMitigationAction.updated_at}, synchronize_session=False)
    return action


def _legacy_word(status: Optional[str]) -> str:
    return (status or "").strip().lower().replace(" ", "_")


def _fix_copied_statuses(db: Session, tenant_ids: list) -> int:
    """Risk actions still holding an old word ("pending", "open"…) that no count reads: put them on the CAPA word
    (planned for anything not started). Idempotent; the caller commits."""
    capa = (*OPEN_ACTION_STATUSES, *DONE_ACTION_STATUSES)
    rows = risk_actions_query(db, tenant_ids).filter(
        (IssueAction.status.is_(None)) | (IssueAction.status.notin_(capa))).all()
    for action in rows:
        action.status = LEGACY_STATUS.get(_legacy_word(action.status), "planned")
    return len(rows)


def migrate_legacy_actions(db: Session, tenant_ids: Iterable[int]) -> int:
    """Copy the tenants' RiskMitigationAction rows not copied yet; returns how many. Idempotent: a copied row is
    marked, and rows another request is copying are skipped, so no row is copied twice. Commits when it copies.
    Actions copied before with an old status word are corrected on the way."""
    tenant_ids = [t for t in (tenant_ids or []) if t is not None]
    if not tenant_ids:
        return 0
    try:
        if _fix_copied_statuses(db, tenant_ids):
            db.commit()
        rows = (db.query(RiskMitigationAction).join(Risk, Risk.id == RiskMitigationAction.risk_id)
                .filter(Risk.tenant_id.in_(tenant_ids), RiskMitigationAction.migrated_to_issue_action_id.is_(None))
                .order_by(RiskMitigationAction.id)
                .with_for_update(skip_locked=True, of=RiskMitigationAction).all())
        if not rows:
            return 0
        now = datetime.utcnow()
        for row in rows:
            _copy_legacy(db, row, now)
        db.commit()
        return len(rows)
    except SQLAlchemyError:
        db.rollback()
        logger.exception("Copying mitigation actions to the CAPA engine failed for tenants %s", tenant_ids)
        return 0
