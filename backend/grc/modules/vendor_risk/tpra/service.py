"""TPRA lifecycle service — DB-facing orchestration over the normalized models.

Stays separate from the legacy `vendor_risk.lifecycle` (8-stage blob) module.
All mutations append a TPRAAuditLog row. Functions take an open Session and the
acting user id; callers (the API layer) own the commit boundary unless noted.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ....models import (
    Vendor, VendorAssessment, VendorQuestionnaireResponse,
    TPRAStageInstance, TPRAQuestion, TPRAQuestionResponse, TPRAFinding,
    TPRARemediation, TPRARiskAcceptance, TPRAContract, TPRAApproval,
    TPRAMonitoringSignal, TPRAAuditLog, TPRAEvidenceLink, TPRAEngagement, CriticalTask, GRCUser,
)
from .stages import (
    TPRA_STAGES, STAGE_BY_KEY, STAGE_ORDER, STAGE_KEYS, is_gate,
    stages_at_or_after, can_skip, cadence_days_for, required_reviewers_for,
    TIER_SKIPPABLE_STAGES, TIER_REQUIRED_REVIEWERS, TIER_RANK,
)
from .engine_tiering import compute_inherent_tier, derive_factors_from_profile
from .engine_scoring import (
    score_assessment, build_responses_from_answers, normalize_answer, answer_score, finding_severity, is_answered,
)
from . import intake as intake_answers, rbac, tier_policy, versions
from .portal import ANSWERED
from .engine_gates import evaluate_stage_exit, recommend_decision
from .engine_snapshots import write_vendor_snapshot
from .bootstrap import get_tiering_config


# ── Audit ────────────────────────────────────────────────────────────────────

def write_audit(
    db: Session, tenant_id: int, *, entity: str, action: str,
    vendor_id: Optional[int] = None, assessment_id: Optional[int] = None,
    entity_id: Optional[int] = None, actor_id: Optional[int] = None,
    from_value=None, to_value=None, reason: Optional[str] = None, extra: Optional[dict] = None,
) -> TPRAAuditLog:
    row = TPRAAuditLog(
        tenant_id=tenant_id, vendor_id=vendor_id, assessment_id=assessment_id,
        entity=entity, entity_id=entity_id, action=action, actor_id=actor_id,
        from_value=None if from_value is None else str(from_value),
        to_value=None if to_value is None else str(to_value),
        reason=reason, extra=extra or {},
    )
    db.add(row)
    return row


# ── Engagements: one use of a supplier, each with its own lifecycle ──────────
# An assessment's engagement_id names the engagement it assesses; NULL is the
# General scope, the supplier as it always was. A supplier with no engagement
# rows is exactly that, so everything below falls back to the supplier itself.

def engagement_of(db: Session, assessment: Optional[VendorAssessment]) -> Optional[TPRAEngagement]:
    """The engagement an assessment belongs to, or None for General."""
    eid = getattr(assessment, "engagement_id", None) if assessment is not None else None
    return db.get(TPRAEngagement, eid) if eid else None


def general_row(db: Session, vendor: Vendor) -> Optional[TPRAEngagement]:
    """The supplier's General row: made when its first engagement is added."""
    return db.query(TPRAEngagement).filter(
        TPRAEngagement.vendor_id == vendor.id, TPRAEngagement.is_general.is_(True)).first()


def open_engagements(db: Session, vendor: Vendor) -> List[TPRAEngagement]:
    """The supplier's engagements still in use, General left out."""
    return (db.query(TPRAEngagement)
            .filter(TPRAEngagement.vendor_id == vendor.id, TPRAEngagement.is_general.is_(False),
                    TPRAEngagement.status != "ended")
            .order_by(TPRAEngagement.id).all())


def scope_row(db: Session, vendor: Vendor, engagement: Optional[TPRAEngagement] = None):
    """Where a scope keeps its own tier and scores: an engagement's row; General's
    on the General row once the supplier has engagements, else the supplier itself."""
    if engagement is not None and not engagement.is_general:
        return engagement
    return general_row(db, vendor) or vendor


def _worst(values) -> Optional[str]:
    known = [v.lower() for v in values if (v or "").lower() in TIER_RANK]
    return max(known, key=TIER_RANK.get) if known else None


def worst_grade(rows) -> Optional[str]:
    """A–F, F the worst."""
    return max((r.rating_grade for r in rows if r.rating_grade), default=None)


def recache(db: Session, vendor: Vendor) -> None:
    """The supplier shows its worst open engagement, General included: tier, inherent
    and residual scores, rating. It is the worst of where each stands now, not the
    worst ever, so a better reassessment can improve the supplier."""
    rows = db.query(TPRAEngagement).filter(
        TPRAEngagement.vendor_id == vendor.id, TPRAEngagement.status != "ended").all()
    if not rows:
        return
    vendor.tier = _worst(r.tier for r in rows) or vendor.tier
    vendor.risk_rating = _worst(r.risk_rating for r in rows)
    vendor.inherent_risk_score = max((r.inherent_risk_score for r in rows if r.inherent_risk_score is not None),
                                     default=None)
    vendor.residual_risk_score = max((r.residual_risk_score for r in rows if r.residual_risk_score is not None),
                                     default=None)


def set_scores(db: Session, vendor: Vendor, row, **values) -> None:
    """Write a scope's tier or scores on its row (scope_row). Written on an
    engagement's row, the supplier is recached to its worst; the supplier itself
    keeps no grade."""
    for key, value in values.items():
        if row is not vendor or hasattr(Vendor, key):
            setattr(row, key, value)
    if row is not vendor:
        recache(db, vendor)


# ── Stage instantiation ──────────────────────────────────────────────────────

def ensure_stage_instances(db: Session, assessment: VendorAssessment) -> List[TPRAStageInstance]:
    """Idempotently create the 11 stage rows for an assessment. The first stage
    starts in_progress; the rest not_started."""
    existing = {
        s.stage_key: s for s in db.query(TPRAStageInstance)
        .filter(TPRAStageInstance.assessment_id == assessment.id).all()
    }
    created = []
    for s in TPRA_STAGES:
        if s["key"] in existing:
            continue
        first = s["order"] == 1
        row = TPRAStageInstance(
            tenant_id=assessment.tenant_id,
            vendor_id=assessment.vendor_id,
            assessment_id=assessment.id,
            stage_key=s["key"],
            stage_order=s["order"],
            is_gate=bool(s.get("gate")),
            status="in_progress" if first else "not_started",
            started_at=datetime.utcnow() if first else None,
            assigned_roles=[],
            exit_criteria_result={},
            gate_decision={},
        )
        db.add(row)
        created.append(row)
    if created:
        db.flush()
    return created


def get_stage_instances(db: Session, assessment_id: int) -> List[TPRAStageInstance]:
    return (
        db.query(TPRAStageInstance)
        .filter(TPRAStageInstance.assessment_id == assessment_id)
        .order_by(TPRAStageInstance.stage_order)
        .all()
    )


# ── Gate context + evaluation ────────────────────────────────────────────────

def acceptance_holds(db: Session, finding: TPRAFinding, now: Optional[datetime] = None) -> bool:
    """Whether a signed acceptance covers this finding now. It covers through its
    expiry day, as the reminders and the attention queue count it (a document's
    expiry date is its last good day too); one past that covers nothing, whether
    or not the daily sweep has marked it expired (or reopened the finding) yet; a
    finding marked accepted before acceptances were recorded keeps the standing
    it had."""
    today = (now or datetime.utcnow()).date()
    rows = db.query(TPRARiskAcceptance).filter(TPRARiskAcceptance.finding_id == finding.id).all()
    if any(a.deleted_at is None and a.status == "active" and (a.expiry is None or a.expiry.date() >= today)
           for a in rows):
        return True
    return finding.status == "accepted" and not rows


def reopen_finding(db: Session, finding: TPRAFinding, actor_id: Optional[int], reason: str) -> None:
    """A finding its acceptance no longer covers (revoked, or expired) is open
    again and counts in every gate and count: on the audit trail (no actor = the
    system), given an issue if it has none, and an onboarded vendor is suspended
    if a critical is left unmitigated (TPRM-002). Caller owns commit."""
    if finding.status == "accepted":
        finding.status = "open"
        finding.row_version = (finding.row_version or 1) + 1
        write_audit(db, finding.tenant_id, entity="finding", action="reopen", vendor_id=finding.vendor_id,
                    assessment_id=finding.assessment_id, entity_id=finding.id, actor_id=actor_id,
                    from_value="accepted", to_value="open", reason=reason)
    ensure_finding_issue(db, finding, actor_id)
    vendor = db.query(Vendor).filter(Vendor.id == finding.vendor_id).first()
    assessment = db.query(VendorAssessment).filter(VendorAssessment.id == finding.assessment_id).first()
    if vendor and assessment:
        enforce_critical_invariant(db, vendor, assessment, actor_id)


def count_open_critical(db: Session, assessment_id: int) -> int:
    """Critical findings that are neither closed, nor covered by an acceptance
    in force, nor by a completed remediation → 'unmitigated'."""
    crit = (
        db.query(TPRAFinding)
        .filter(
            TPRAFinding.assessment_id == assessment_id,
            TPRAFinding.deleted_at.is_(None),
            TPRAFinding.severity == "critical",
        )
        .all()
    )
    now = datetime.utcnow()
    open_count = 0
    for f in crit:
        # A past-expiry acceptance re-surfaces the critical for re-review: it is no
        # longer a standing mitigation, so it does not clear the approval gate.
        if f.status == "closed" or acceptance_holds(db, f, now):
            continue
        has_done_remediation = (
            db.query(TPRARemediation.id)
            .filter(
                TPRARemediation.finding_id == f.id,
                TPRARemediation.deleted_at.is_(None),
                TPRARemediation.status == "completed",
            ).first()
        )
        if has_done_remediation:
            continue
        open_count += 1
    return open_count


# ── TPRM-003: mirror findings into the shared Issue/Action module ────────────
# A TPRA finding becomes a first-class Issue (unified owner / SLA / workflow) so
# remediation isn't tracked in two disconnected places. Best-effort — a linkage
# failure never blocks the finding mutation. Caller owns commit.

def _severity_to_impact_urgency(sev: str) -> tuple:
    s = (sev or "medium").lower()
    if s == "critical":
        return "high", "high"
    if s == "high":
        return "high", "medium"
    if s == "low":
        return "low", "low"
    return "medium", "medium"


def ensure_finding_issue(db: Session, finding, actor_id: Optional[int] = None) -> Optional[int]:
    """Create (once) a linked Issue for a finding via the shared issue-management
    auto-create service, and back-link it. Idempotent (from_event dedupes by
    source_type+source_id; we also short-circuit if already linked). A finding
    open again reopens the issue its closing closed."""
    if getattr(finding, "linked_issue_id", None):
        if finding.status not in ("closed", "accepted"):
            _reopen_finding_issue(db, finding, actor_id)
        return finding.linked_issue_id
    try:
        from ...issue_management.services.auto_create import from_event
        impact, urgency = _severity_to_impact_urgency(finding.severity)
        issue = from_event(
            db=db, tenant_id=finding.tenant_id,
            source_type="tpra_finding", source_id=finding.id,
            title=f"Vendor finding: {finding.title or 'Untitled'}",
            description=finding.description,
            impact=impact, urgency=urgency,
            issue_type="vendor_breach", category="security", reporter_id=actor_id,
        )
        if issue is not None:
            finding.linked_issue_id = issue.id
            return issue.id
    except Exception:  # noqa: BLE001 — linkage is best-effort
        logger.warning("finding → issue sync skipped for finding %s", getattr(finding, "id", "?"), exc_info=True)
    return None


def close_finding_issue(db: Session, finding, actor_id: Optional[int] = None,
                        reason: str = "Resolved via the TPRA finding.") -> None:
    """Close the finding's linked Issue when the finding is closed/accepted."""
    iid = getattr(finding, "linked_issue_id", None)
    if not iid:
        return
    try:
        from ....models import Issue
        issue = db.query(Issue).filter(Issue.id == iid, Issue.tenant_id == finding.tenant_id).first()
        if not issue or issue.workflow_state in ("closed", "cancelled"):
            return
        issue.workflow_state = "closed"
        issue.status = "closed"
        issue.closed_at = datetime.utcnow()
        issue.closure_notes = reason
        if actor_id:
            issue.approved_by_id = actor_id
            issue.approved_at = datetime.utcnow()
        try:
            from ....models import IssueActivity
            db.add(IssueActivity(issue_id=issue.id, user_id=actor_id, type="approved",
                                 payload={"source": "tpra", "finding_id": finding.id}))
        except Exception:  # noqa: BLE001 — activity log is optional
            pass
    except Exception:  # noqa: BLE001 — best-effort
        logger.warning("finding issue close skipped for finding %s", getattr(finding, "id", "?"), exc_info=True)


def _reopen_finding_issue(db: Session, finding, actor_id: Optional[int] = None) -> None:
    """Reopen the finding's linked Issue if it is closed, as the issue's own reopen
    does (cancelled ones stay: someone deleted those). Best-effort."""
    try:
        from ....models import Issue, IssueActivity
        issue = db.query(Issue).filter(Issue.id == finding.linked_issue_id, Issue.tenant_id == finding.tenant_id).first()
        if issue is None or issue.workflow_state != "closed":
            return
        issue.workflow_state, issue.status = "in_progress", "open"
        issue.closed_at = issue.approved_at = issue.approved_by_id = None
        db.add(IssueActivity(issue_id=issue.id, user_id=actor_id, type="reopened",
                             payload={"source": "tpra", "finding_id": finding.id}))
    except Exception:  # noqa: BLE001 — best-effort
        logger.warning("finding issue reopen skipped for finding %s", getattr(finding, "id", "?"), exc_info=True)


# Stages that mean the vendor has already cleared the approval gate.
_POST_APPROVAL_STAGES = {"onboarding", "monitoring", "reassessment"}


def _past_approval(db: Session, assessment: VendorAssessment) -> bool:
    return (assessment.current_stage in _POST_APPROVAL_STAGES) or bool(
        db.query(TPRAStageInstance.id).filter(
            TPRAStageInstance.assessment_id == assessment.id,
            TPRAStageInstance.stage_key == "approval",
            TPRAStageInstance.status.in_(("complete", "skipped")),
        ).first()
    )


def _critical_elsewhere(db: Session, vendor: Vendor, assessment: VendorAssessment) -> bool:
    """Whether another scope's active assessment (another engagement's, or General's)
    still has an unmitigated critical past its approval."""
    others = db.query(VendorAssessment).filter(
        VendorAssessment.vendor_id == vendor.id, VendorAssessment.id != assessment.id,
        VendorAssessment.lifecycle_status == "active", VendorAssessment.deleted_at.is_(None),
        func.coalesce(VendorAssessment.engagement_id, 0) != (assessment.engagement_id or 0)).all()
    return any(_past_approval(db, a) and count_open_critical(db, a.id) > 0 for a in others)


def enforce_critical_invariant(
    db: Session, vendor: Vendor, assessment: VendorAssessment, actor_id: Optional[int] = None,
) -> None:
    """TPRM-002: an open, unmitigated critical-control failure must NOT silently
    persist on a vendor that has already passed the approval gate. Suspend such a
    vendor (auditable); auto-reactivate once the critical is remediated/accepted/
    closed — on every engagement: a supplier stays suspended while any of its
    active assessments has one. Best-effort — never blocks the calling mutation.
    Caller owns commit."""
    try:
        if not _past_approval(db, assessment):
            return
        open_crit = count_open_critical(db, assessment.id)
        status = (vendor.status or "").lower()
        if open_crit > 0 and status not in ("suspended", "terminated", "offboarded"):
            prev = vendor.status
            vendor.status = "suspended"
            vendor.updated_at = datetime.utcnow()
            write_audit(db, vendor.tenant_id, entity="vendor", action="suspend",
                        vendor_id=vendor.id, assessment_id=assessment.id, actor_id=actor_id,
                        from_value=prev, to_value="suspended",
                        reason="Open critical control failure on an onboarded vendor (TPRM-002).")
        elif open_crit == 0 and status == "suspended" and not _critical_elsewhere(db, vendor, assessment):
            vendor.status = "active"
            vendor.updated_at = datetime.utcnow()
            write_audit(db, vendor.tenant_id, entity="vendor", action="reactivate",
                        vendor_id=vendor.id, assessment_id=assessment.id, actor_id=actor_id,
                        from_value="suspended", to_value="active",
                        reason="Critical control failure resolved — vendor reactivated (TPRM-002).")
    except Exception:  # noqa: BLE001 — enforcement must never break the mutation
        logger.warning("critical-invariant enforcement skipped for vendor %s",
                       getattr(vendor, "id", "?"), exc_info=True)


# The team-roster seats that review an assessment: the disciplines a tier asks
# for. The business owner, the TPRM lead and analyst running it, procurement, IT
# and the approver are not its reviewers.
REVIEWER_SEATS = {seat for seats in TIER_REQUIRED_REVIEWERS.values() for seat in seats}


def reviewers_assigned(db: Session, assessment: VendorAssessment) -> int:
    """How many different people are named to review this assessment: the plan's
    reviewer, whoever holds a reviewing seat in Assign duties (the roster), and
    whoever is assigned a part of its questionnaires (tpra/reviews.py)."""
    from ....models import TPRAReviewAssignment

    roster = assessment.team_roster or {}
    people = {assessment.reviewed_by, *(roster.get(seat) for seat in REVIEWER_SEATS)}
    people.update(uid for (uid,) in db.query(TPRAReviewAssignment.reviewer_id).filter(
        TPRAReviewAssignment.assessment_id == assessment.id))
    return len({p for p in people if p})


# ── The settings an assessment is held to ────────────────────────────────────
# The tiering config and tier policy as they stood when the assessment's tier was
# set (computed, set by hand, or carried into a reassessment), so a change to the
# settings never moves the goalposts of an assessment under way: its gates,
# approval rules and scoring read them. A re-tier takes the settings as they stand.
POLICY_KEYS = ("weights", "thresholds", "cadence_days", "tier_policy")


def policy_snapshot(cfg: dict) -> dict:
    snap = {k: dict(cfg.get(k) or {}) for k in POLICY_KEYS}     # copies: a later edit stays out
    snap["tier_policy"] = tier_policy.merged(cfg.get("tier_policy"))
    snap["at"] = datetime.utcnow().isoformat()
    return snap


def config_for(db: Session, assessment: VendorAssessment) -> dict:
    """The tenant's config, with the assessment's own snapshot over it when it has one."""
    cfg = get_tiering_config(db, assessment.tenant_id)
    snap = getattr(assessment, "policy_snapshot", None) or {}
    return {**cfg, **{k: snap[k] for k in POLICY_KEYS if snap.get(k)}}


def build_stage_context(db: Session, vendor: Vendor, assessment: VendorAssessment, stage_key: str) -> dict:
    """Gather the plain facts the pure gate engine needs for one stage. An
    engagement's assessment is held to the engagement's own facts and tier."""
    engagement = engagement_of(db, assessment)
    scope = engagement or vendor
    tier = assessment.inherent_tier or scope.tier or "medium"
    ctx: dict = {"tier": tier}

    if stage_key == "intake":
        ctx.update(
            has_name=bool(scope.name),
            has_owner=bool(scope.owner_id),
            has_data_classification=bool(scope.data_access_level and scope.data_access_level != "none"),
        )
    elif stage_key == "tiering":
        ctx["inherent_tier"] = assessment.inherent_tier
    elif stage_key == "dd_planning":
        ctx["templates_selected"] = 1 if assessment.template_id else (
            db.query(TPRAQuestionResponse.id).filter(TPRAQuestionResponse.assessment_id == assessment.id).first() and 1 or 0
        )
        ctx["reviewer_roles"] = required_reviewers_for(tier)
        ctx["required_reviewers"] = len(ctx["reviewer_roles"])
        ctx["reviewers_assigned"] = reviewers_assigned(db, assessment)
        wanted = tier_policy.requirements(db, vendor, assessment, config_for(db, assessment))
        ctx["tier_templates_unsent"] = [q["name"] for q in wanted["questionnaires"] if q["status"] == "unsent"]
    elif stage_key == "questionnaire":
        # Completeness from what the supplier answered, question by question
        # (_questionnaire_gaps), and evidence linked to the question that owes it.
        total, owed, missing = _questionnaire_gaps(db, assessment)
        wanted = tier_policy.requirements(db, vendor, assessment, config_for(db, assessment))
        ctx.update(
            responses_total=total, responses_answered=total - owed,
            required_evidence_missing=missing,
            tier_questionnaires_unanswered=[q["name"] for q in wanted["questionnaires"] if q["status"] != "answered"],
            tier_evidence_missing=[e["label"] for e in wanted["evidence"] if not e["satisfied"]],
        )
    elif stage_key == "scoring":
        ctx["residual_computed"] = assessment.residual_score is not None
    elif stage_key == "findings":
        ctx["open_critical_unmitigated"] = count_open_critical(db, assessment.id)
    elif stage_key == "contracting":
        # A contract for the whole supplier covers every engagement; one made for
        # an engagement covers only that one.
        covers = TPRAContract.engagement_id.is_(None)
        if engagement is not None:
            covers = or_(covers, TPRAContract.engagement_id == engagement.id)
        ctx["contract_linked"] = bool(
            db.query(TPRAContract.id).filter(
                TPRAContract.vendor_id == vendor.id,
                TPRAContract.deleted_at.is_(None),
                covers,
            ).first()
        )
    elif stage_key == "approval":
        decided = approval_in_force(db, assessment)
        ctx["approval_decision"] = decided.decision if decided else None
        ctx["open_critical_unmitigated"] = count_open_critical(db, assessment.id)
    elif stage_key == "onboarding":
        ctx["access_provisioned"] = True  # tracked via the onboarding checklist UI
    return ctx


def evaluate_current(db: Session, vendor: Vendor, assessment: VendorAssessment, stage_key: str) -> dict:
    ctx = build_stage_context(db, vendor, assessment, stage_key)
    return evaluate_stage_exit(stage_key, ctx)


# ── Transitions ──────────────────────────────────────────────────────────────

def _stage_row(db: Session, assessment_id: int, stage_key: str) -> Optional[TPRAStageInstance]:
    return (
        db.query(TPRAStageInstance)
        .filter(TPRAStageInstance.assessment_id == assessment_id, TPRAStageInstance.stage_key == stage_key)
        .first()
    )


def _set_stage(db: Session, vendor: Vendor, assessment: VendorAssessment, stage_key: str) -> None:
    """Keep the scope's stage pointer: the engagement's own, or the supplier's legacy one."""
    (engagement_of(db, assessment) or vendor).lifecycle_stage = stage_key


def advance_stage(
    db: Session, vendor: Vendor, assessment: VendorAssessment, actor_id: Optional[int],
    note: Optional[str] = None,
) -> dict:
    """Advance from the current in-progress stage to the next, enforcing exit
    criteria (hard stop at gates). Returns {advanced, from, to, blockers}."""
    current_key = assessment.current_stage or "intake"
    result = evaluate_current(db, vendor, assessment, current_key)
    if not result["passed"]:
        return {"advanced": False, "from": current_key, "to": current_key, "blockers": result["blockers"]}

    cur = _stage_row(db, assessment.id, current_key)
    if cur:
        cur.status = "complete"
        cur.completed_at = datetime.utcnow()
        cur.exit_criteria_result = {"passed": True, "blockers": []}
        cur.row_version = (cur.row_version or 1) + 1

    # Advance to the next ACTIONABLE stage, stepping over any that were skipped
    # (e.g. right-sized away by tier) or already complete, so the current pointer
    # never lands on a terminal (skipped/complete) stage.
    order = STAGE_ORDER.get(current_key, 1)
    nxt_key = None
    nxt = None
    while order < len(STAGE_KEYS):
        candidate = STAGE_KEYS[order]
        row = _stage_row(db, assessment.id, candidate)
        if row and row.status in ("skipped", "complete"):
            order += 1
            continue
        nxt_key, nxt = candidate, row
        break
    if nxt_key:
        if nxt and nxt.status == "not_started":
            nxt.status = "in_progress"
            nxt.started_at = datetime.utcnow()
        assessment.current_stage = nxt_key
        _set_stage(db, vendor, assessment, nxt_key)  # keep legacy pointer in sync
    else:
        assessment.current_stage = current_key  # terminal

    assessment.row_version = (assessment.row_version or 1) + 1
    write_audit(db, assessment.tenant_id, entity="stage", action="transition",
                vendor_id=vendor.id, assessment_id=assessment.id, entity_id=cur.id if cur else None,
                actor_id=actor_id, from_value=current_key, to_value=nxt_key or current_key, reason=note)
    return {"advanced": True, "from": current_key, "to": nxt_key or current_key, "blockers": []}


def record_gate_decision(
    db: Session, vendor: Vendor, assessment: VendorAssessment, stage_key: str,
    decision: str, actor_id: Optional[int], rationale: Optional[str] = None,
) -> TPRAStageInstance:
    """Record an explicit gate decision on a gate stage (tiering / approval)."""
    if not is_gate(stage_key):
        raise ValueError(f"{stage_key} is not a gate stage")
    row = _stage_row(db, assessment.id, stage_key)
    if not row:
        raise ValueError("stage instance not found")
    row.gate_decision = {
        "decision": decision, "by": actor_id,
        "at": datetime.utcnow().isoformat(), "rationale": rationale,
    }
    row.row_version = (row.row_version or 1) + 1
    write_audit(db, assessment.tenant_id, entity="gate", action="gate",
                vendor_id=vendor.id, assessment_id=assessment.id, entity_id=row.id,
                actor_id=actor_id, to_value=decision, reason=rationale)
    return row


def send_back(
    db: Session, vendor: Vendor, assessment: VendorAssessment, target_stage: str,
    actor_id: Optional[int], reason: str,
) -> dict:
    """Return the lifecycle to an earlier stage; invalidate downstream stage state."""
    if target_stage not in STAGE_KEYS:
        raise ValueError("invalid target stage")
    target_order = STAGE_ORDER[target_stage]
    cur_order = STAGE_ORDER.get(assessment.current_stage or "intake", 1)
    if target_order >= cur_order:
        raise ValueError("send-back target must be an earlier stage")

    invalidated = stages_at_or_after(target_stage)
    for s in get_stage_instances(db, assessment.id):
        if s.stage_key == target_stage:
            s.status = "in_progress"
            s.started_at = datetime.utcnow()
            s.completed_at = None
            s.exit_criteria_result = {}
        elif s.stage_key in invalidated:
            s.status = "not_started"
            s.completed_at = None
            s.exit_criteria_result = {}
            s.gate_decision = {}
        s.row_version = (s.row_version or 1) + 1

    assessment.current_stage = target_stage
    _set_stage(db, vendor, assessment, target_stage)
    assessment.row_version = (assessment.row_version or 1) + 1
    write_audit(db, assessment.tenant_id, entity="stage", action="send_back",
                vendor_id=vendor.id, assessment_id=assessment.id,
                actor_id=actor_id, from_value=STAGE_KEYS[cur_order - 1], to_value=target_stage, reason=reason)
    return {"sent_back_to": target_stage, "invalidated": invalidated}


def skip_stage(
    db: Session, vendor: Vendor, assessment: VendorAssessment, stage_key: str,
    actor_id: Optional[int], reason: str,
) -> dict:
    """Skip a non-gate stage where tier rules permit; record who & why."""
    tier = assessment.inherent_tier or (engagement_of(db, assessment) or vendor).tier or "medium"
    if not can_skip(tier, stage_key):
        raise ValueError(f"stage '{stage_key}' is not skippable for tier '{tier}'")
    row = _stage_row(db, assessment.id, stage_key)
    if not row:
        raise ValueError("stage instance not found")
    row.status = "skipped"
    row.skipped_reason = reason
    row.skipped_by = actor_id
    row.completed_at = datetime.utcnow()
    row.row_version = (row.row_version or 1) + 1
    # Move current pointer forward if we skipped the active stage.
    if assessment.current_stage == stage_key:
        order = STAGE_ORDER.get(stage_key, 1)
        nxt = STAGE_KEYS[order] if order < len(STAGE_KEYS) else stage_key
        nxt_row = _stage_row(db, assessment.id, nxt)
        if nxt_row and nxt_row.status == "not_started":
            nxt_row.status = "in_progress"
            nxt_row.started_at = datetime.utcnow()
        assessment.current_stage = nxt
        _set_stage(db, vendor, assessment, nxt)
    write_audit(db, assessment.tenant_id, entity="stage", action="skip",
                vendor_id=vendor.id, assessment_id=assessment.id, entity_id=row.id,
                actor_id=actor_id, to_value="skipped", reason=reason)
    return {"skipped": stage_key, "reason": reason}


# ── Engine runs (tiering / scoring) ──────────────────────────────────────────

def run_tiering(
    db: Session, vendor: Vendor, assessment: VendorAssessment, actor_id: Optional[int],
    factors: Optional[Dict[str, float]] = None,
) -> dict:
    """Compute the inherent tier and persist it on the assessment + vendor (or, for
    an engagement's assessment, on the engagement, from the engagement's facts)."""
    cfg = get_tiering_config(db, assessment.tenant_id)
    engagement = engagement_of(db, assessment)
    facts = tier_policy.facts(vendor, engagement)
    row = scope_row(db, vendor, engagement)
    reasons = None
    if factors is None and intake_answers.has_answers(getattr(facts, "intake", None)):
        # The requester's answers are the facts; the factors follow from them.
        factors, reasons = intake_answers.factors(facts.intake, cfg.get("customisation"))
    elif factors is None:
        factors = derive_factors_from_profile({
            "data_access_level": facts.data_access_level,
            "data_types_accessed": facts.data_types_accessed or [],
            "geographic_locations": facts.geographic_locations or [],
            # An engagement says how critical it is. General still reads its own
            # last tier here, as it always has (a loop: the tier feeds itself).
            "business_criticality": engagement.criticality if engagement is not None else row.tier,
        })
    result = compute_inherent_tier(factors, cfg)
    if reasons:
        result["reasons"] = reasons
    # Recorded to notice when the facts move past it (tier_policy.retier_reasons),
    # and the settings the assessment is held to from here.
    assessment.tiering_basis = tier_policy.basis(facts, cfg.get("customisation"))
    assessment.policy_snapshot = policy_snapshot(cfg)
    assessment.tier_override = None
    assessment.inherent_tier = result["tier"]
    assessment.inherent_score = result["score"]
    set_scores(db, vendor, row, inherent_risk_score=result["score"], tier=result["tier"],
               risk_rating=row.risk_rating or result["tier"])
    assessment.row_version = (assessment.row_version or 1) + 1
    # Right-size the path by tier: auto-skip the stages this tier is allowed to skip
    # (a Low vendor bypasses deep diligence) so the path visibly collapses instead of
    # relying on an analyst to remember to skip each one. advance_stage steps over
    # these skipped stages.
    for _sk in TIER_SKIPPABLE_STAGES.get((result["tier"] or "medium").lower(), []):
        _st = _stage_row(db, assessment.id, _sk)
        if _st and _st.status == "not_started":
            _st.status = "skipped"
            _st.row_version = (_st.row_version or 1) + 1
            write_audit(db, assessment.tenant_id, entity="stage", action="skip",
                        vendor_id=vendor.id, assessment_id=assessment.id, entity_id=_st.id,
                        actor_id=actor_id, to_value=_sk,
                        reason="Auto-skipped — right-sized by inherent tier")
    write_audit(db, assessment.tenant_id, entity="tiering", action="update",
                vendor_id=vendor.id, assessment_id=assessment.id, actor_id=actor_id,
                to_value=result["tier"], extra={"score": result["score"]})
    return result


def _latest_submitted_questionnaire(db: Session, assessment_id: int):
    return (
        db.query(VendorQuestionnaireResponse)
        .filter(
            VendorQuestionnaireResponse.assessment_id == assessment_id,
            VendorQuestionnaireResponse.status.in_(ANSWERED),
        )
        .order_by(VendorQuestionnaireResponse.id.desc())
        .first()
    )


def _collect_from_questionnaire(db: Session, assessment: VendorAssessment) -> List[dict]:
    """Build scoring responses from the vendor-submitted questionnaire blob joined to
    the questions of the version it was sent on. This is what the external portal
    actually writes; string answers are coerced by the engine."""
    qr = _latest_submitted_questionnaire(db, assessment.id) if assessment else None
    version = versions.pin(db, qr)
    if version is None:
        return []
    return build_responses_from_answers(version.questions or [], qr.responses or {}, version.id)


_ANSWER_LABEL = {"yes": "Yes", "partial": "Partial", "no": "No", "n-a": "N-A"}


def materialise_responses(db: Session, assessment: VendorAssessment, qr) -> int:
    """Write a submitted questionnaire as one normalized row per question.

    The vendor portal stores a single JSON blob, so grc_tpra_question_responses
    stayed empty and per-question review had nothing to hang off. Scoring already
    prefers these rows over the blob, so they must score identically: one row per
    template question, answered or not, because the blob path scores unanswered
    questions too.

    The template's questions are written to grc_tpra_questions first. Scoring takes
    domain, weight and the critical-control flag from that join, so an answer with
    no question row would score as a plain cybersecurity question and a failed
    critical control would pass unnoticed. Custom templates were never backfilled
    there; this does it on first submission.

    Question rows belong to the template version the questionnaire was sent on and
    are written once, so a later edit to the template cannot reach back into an
    answer already given.

    Idempotent: re-running with the same answers changes nothing, and a changed
    answer bumps its row version. Returns how many answers it holds.
    """
    version = versions.pin(db, qr) if assessment is not None else None
    defs = list(version.questions or []) if version else []
    if not defs:
        return 0

    questions = {
        q.question_key: q for q in db.query(TPRAQuestion).filter(
            TPRAQuestion.template_version_id == version.id,
        )
    }
    answers = {
        r.question_key: r for r in db.query(TPRAQuestionResponse).filter(
            TPRAQuestionResponse.assessment_id == assessment.id,
            TPRAQuestionResponse.deleted_at.is_(None),
        )
    }
    written = 0
    scored_rows = build_responses_from_answers(defs, qr.responses or {}, version.id)
    for order, (definition, scored) in enumerate(zip(defs, scored_rows)):
        key = str(scored["question_key"])
        question = questions.get(key)
        if question is None:
            question = TPRAQuestion(
                tenant_id=assessment.tenant_id, template_id=version.template_id,
                template_version_id=version.id, question_key=key,
                text=str(definition.get("text") or key), domain=scored["domain"],
                weight=scored["weight"], critical_control=scored["critical_control"],
                evidence_required=bool(definition.get("evidence_required") or definition.get("evidence")),
                qtype=definition.get("type") or "yes_no", options=definition.get("options") or [],
                order=order,
            )
            db.add(question)
            db.flush()
            questions[key] = question

        label = _ANSWER_LABEL.get(normalize_answer(scored["answer"]) or "")
        raw = None if scored["answer"] is None else str(scored["answer"])
        row = answers.get(key)
        if row is None:
            row = TPRAQuestionResponse(tenant_id=assessment.tenant_id, assessment_id=assessment.id,
                                       question_key=key, row_version=1)
            db.add(row)
            answers[key] = row
        elif (row.question_id, row.answer, row.raw_value) != (question.id, label, raw):
            row.row_version = (row.row_version or 1) + 1
        row.question_id = question.id
        row.answer = label
        row.raw_value = raw
        row.legacy_response_id = qr.id
        written += 1
    return written


def _questionnaire_gaps(db: Session, assessment: VendorAssessment) -> Tuple[int, int, int]:
    """Over each questionnaire of the assessment the supplier answered, and only the
    questions its answers made apply: how many there are, how many still owe an
    answer (one marked optional never does; a file question is answered by its
    file), and how many answers owe evidence that nothing linked to that same
    question gives (tpra/portal.py's rules, as at submit)."""
    from . import portal

    total = owed = missing = 0
    for qr in (db.query(VendorQuestionnaireResponse)
               .filter(VendorQuestionnaireResponse.assessment_id == assessment.id,
                       VendorQuestionnaireResponse.status.in_(ANSWERED))
               .order_by(VendorQuestionnaireResponse.id)):
        answers, linked = qr.responses or {}, portal.evidence_keys(db, qr)
        for q in portal.visible_questions(versions.questions_for(db, qr), answers):
            key = str(q.get("id"))
            total += 1
            if not portal.answered(q, answers.get(key), linked):
                if q.get("required") is not False:         # not marked optional: as it always counted
                    owed += 1
            elif portal.owes_evidence(q, answers.get(key)) and key not in linked:
                missing += 1
    return total, owed, missing


def collect_responses_for_scoring(db: Session, assessment_id: int) -> List[dict]:
    """Join normalized responses to their questions to feed the scoring engine."""
    rows = (
        db.query(TPRAQuestionResponse, TPRAQuestion)
        .outerjoin(TPRAQuestion, TPRAQuestion.id == TPRAQuestionResponse.question_id)
        .filter(
            TPRAQuestionResponse.assessment_id == assessment_id,
            TPRAQuestionResponse.deleted_at.is_(None),
        )
        .all()
    )
    out = []
    for resp, q in rows:
        question = {
            "options": (q.options if q else None) or [],
            "weight": float(q.weight) if q and q.weight is not None else 1.0,
            "critical_control": bool(q.critical_control) if q else False,
        }
        raw = resp.raw_value if resp.raw_value is not None else resp.answer
        label, score = answer_score(question, raw)
        out.append({
            "domain": (q.domain if q else None) or "cybersecurity",
            # The Yes/Partial/No/N-A label, else what was given: text, a choice, a rating.
            "answer": resp.answer if resp.answer is not None else resp.raw_value,
            "label": label,
            "score": score,
            "finding": finding_severity(question, raw),
            "weight": question["weight"],
            "critical_control": question["critical_control"],
            "question_key": resp.question_key or (q.question_key if q else None),
            "question_id": resp.question_id,
            "response_id": resp.id,
            "title": q.text if q else None,
            "template_version_id": q.template_version_id if q else None,
        })
    if out:
        return out
    # No normalized responses — the vendor portal writes the legacy questionnaire
    # blob, which the normalized TPRAQuestionResponse table never receives. Score the
    # REAL submitted answers instead of scoring nothing (which yields residual==inherent).
    assessment = db.query(VendorAssessment).filter(VendorAssessment.id == assessment_id).first()
    return _collect_from_questionnaire(db, assessment) if assessment else []


def record_tier_override(db: Session, vendor: Vendor, assessment: VendorAssessment, tier: str,
                         justification: str, actor_id: Optional[int]) -> None:
    """A tier set by hand instead of computed: kept with who set it, why, and what
    the engine had computed, and written to the vendor's audit trail."""
    row = scope_row(db, vendor, engagement_of(db, assessment))
    previous = assessment.inherent_tier or row.tier
    computed = (assessment.tier_override or {}).get("computed") or assessment.inherent_tier
    assessment.tier_override = {
        "from": previous, "to": tier, "computed": computed, "justification": justification,
        "by": actor_id, "at": datetime.utcnow().isoformat(),
    }
    assessment.inherent_tier = tier
    assessment.policy_snapshot = policy_snapshot(get_tiering_config(db, assessment.tenant_id))
    assessment.row_version = (assessment.row_version or 1) + 1
    set_scores(db, vendor, row, tier=tier)
    write_audit(db, assessment.tenant_id, entity="tiering", action="override", vendor_id=vendor.id,
                assessment_id=assessment.id, actor_id=actor_id, from_value=previous, to_value=tier,
                reason=justification, extra={"computed": computed})


def raise_answer_findings(db: Session, vendor: Vendor, assessment: VendorAssessment,
                          responses: List[dict], actor_id: Optional[int]) -> int:
    """One finding per weak answer, as the question's version says: severity by
    the answer given, a failed critical control always blocking. Each carries the
    template version, question and answer, so it can be defended later; and each
    question raises one, however often the assessment is rescored."""
    existing = {k for (k,) in db.query(TPRAFinding.question_key).filter(
        TPRAFinding.assessment_id == assessment.id, TPRAFinding.question_key.isnot(None))}
    # Critical-control findings raised before findings carried their question. Their
    # source_response_id held the question's id in whichever id space scored them
    # then (the template's, or a question row since replaced by its version's), so
    # no id here compares with it; they are matched by the question's text, which
    # they were titled with and every path still carries.
    legacy = {t for (t,) in db.query(TPRAFinding.title).filter(
        TPRAFinding.assessment_id == assessment.id, TPRAFinding.question_key.is_(None),
        TPRAFinding.is_critical_control_fail.is_(True))}
    created = 0
    for r in responses:
        severity, key = r.get("finding"), r.get("question_key")
        if not severity or key is None or str(key) in existing:
            continue
        failed_critical = bool(r.get("critical_control")) and r.get("score") is not None and r["score"] <= 0
        if failed_critical and r.get("title") and r["title"][:255] in legacy:
            continue
        answered = r.get("label") or r.get("answer")
        db.add(TPRAFinding(
            tenant_id=assessment.tenant_id, vendor_id=vendor.id, assessment_id=assessment.id,
            domain=r.get("domain") or "cybersecurity", severity=severity,
            title=(r.get("title") or "Weak questionnaire answer")[:255],
            description=f'Raised from the questionnaire: the vendor answered "{answered}".',
            source_response_id=r.get("response_id"), is_critical_control_fail=failed_critical,
            template_version_id=r.get("template_version_id"), question_key=str(key)[:100],
            answer_value=None if answered is None else str(answered)[:255],
            status="open", created_by=actor_id,
        ))
        existing.add(str(key))
        created += 1
    return created


def run_scoring(
    db: Session, vendor: Vendor, assessment: VendorAssessment, actor_id: Optional[int],
) -> dict:
    """Score the assessment from its normalized responses; persist residual +
    domain scores and auto-create blocking findings for failed critical controls."""
    responses = collect_responses_for_scoring(db, assessment.id)
    row = scope_row(db, vendor, engagement_of(db, assessment))
    inherent = assessment.inherent_score or row.inherent_risk_score or 0.0
    cfg = config_for(db, assessment)
    result = score_assessment(responses, inherent_score=inherent, config=cfg)

    assessment.residual_score = result["overall_residual"]
    assessment.residual_rating = result["residual_rating"]
    assessment.rating_grade = result["rating_grade"]
    assessment.domain_scores = result["domain_scores"]
    set_scores(db, vendor, row, residual_risk_score=result["overall_residual"],
               risk_rating=result["residual_rating"], rating_grade=result["rating_grade"])
    assessment.row_version = (assessment.row_version or 1) + 1

    created_findings = raise_answer_findings(db, vendor, assessment, responses, actor_id)

    # Snapshot the new posture so the risk-over-time series is real history.
    db.flush()
    snapshot(db, vendor, assessment, "score")
    # Roll the residual up into the enterprise Risk Register (Risk 360°).
    sync_risk_register(db, vendor, assessment)

    write_audit(db, assessment.tenant_id, entity="scoring", action="update",
                vendor_id=vendor.id, assessment_id=assessment.id, actor_id=actor_id,
                to_value=result["residual_rating"],
                extra={"residual": result["overall_residual"], "findings_created": created_findings,
                       "grade": result["rating_grade"]})
    result["findings_created"] = created_findings
    return result


def residual_from_inherent(db: Session, assessment: VendorAssessment, actor_id: Optional[int]) -> bool:
    """A tier that skips scoring (Low) has no questionnaire answers to score, so
    nothing has reduced its inherent risk: its residual is the inherent score.
    Set on the assessment and the vendor and said so on the audit trail; no grade
    or domain score is made up. Returns whether it applied."""
    vendor = db.query(Vendor).filter(Vendor.id == assessment.vendor_id).first()
    scoring = _stage_row(db, assessment.id, "scoring")
    engagement = engagement_of(db, assessment)
    tier = assessment.inherent_tier or ((engagement or vendor).tier if vendor else None)
    if (vendor is None or assessment.inherent_score is None or scoring is None or scoring.status != "skipped"
            or not can_skip(tier, "scoring")):
        return False
    assessment.residual_score = assessment.inherent_score
    assessment.residual_rating = tier
    assessment.row_version = (assessment.row_version or 1) + 1
    set_scores(db, vendor, scope_row(db, vendor, engagement), residual_risk_score=assessment.residual_score,
               risk_rating=tier)
    write_audit(db, assessment.tenant_id, entity="scoring", action="update", vendor_id=vendor.id,
                assessment_id=assessment.id, actor_id=actor_id, to_value=tier,
                reason="Scoring is skipped for this tier, so the residual is the inherent score; "
                       "no questionnaire was scored.",
                extra={"residual": assessment.residual_score, "rating_basis": "inherent_score"})
    return True


# ── Who may approve ──────────────────────────────────────────────────────────
# Segregation of duties: who may not approve an assessment themselves, each with
# the label the approvers list shows and the sentence a refusal gives.
SOD = {
    "assessor": ("Assessor", "the assessor cannot approve their own assessment"),
    "reviewer": ("Reviewer", "a reviewer cannot approve an assessment they review"),
    "business_owner": ("Business owner", "the business owner cannot approve their own supplier"),
    "moved_to_approval": ("Moved it to approval", "whoever moved the assessment to approval cannot also approve it"),
}
APPROVE_RIGHT = "vendor_risk:approvals:approve"


def moved_to_approval_by(db: Session, assessment: VendorAssessment) -> Optional[int]:
    """Who last moved the assessment into its Approval stage: advanced it there or sent it back to it."""
    row = (db.query(TPRAAuditLog.actor_id).filter(
        TPRAAuditLog.assessment_id == assessment.id, TPRAAuditLog.entity == "stage",
        TPRAAuditLog.action.in_(("transition", "send_back")), TPRAAuditLog.to_value == "approval")
        .order_by(TPRAAuditLog.id.desc()).first())
    return row[0] if row else None


def conflicts(db: Session, assessment: VendorAssessment) -> Dict[int, str]:
    """Everyone who may not approve this assessment themselves, each with why (a
    SOD key): its assessor; its reviewers (the plan's, and the reviewing seats in
    Assign duties); its business owner (the supplier's, or the engagement's, and
    the Business Owner seat); and whoever last moved it into approval. One reason
    each, the first that applies."""
    roster = assessment.team_roster or {}
    scope = engagement_of(db, assessment) or db.get(Vendor, assessment.vendor_id)
    named = (
        ("assessor", [assessment.assessed_by]),
        ("reviewer", [assessment.reviewed_by, *(roster.get(seat) for seat in sorted(REVIEWER_SEATS))]),
        ("business_owner", [getattr(scope, "owner_id", None), roster.get("business_owner")]),
        ("moved_to_approval", [moved_to_approval_by(db, assessment)]),
    )
    out: Dict[int, str] = {}
    for reason, ids in named:
        for uid in ids:
            if uid:
                out.setdefault(int(uid), reason)
    return out


def _tier_rules(db: Session, assessment: VendorAssessment) -> Tuple[Optional[str], Dict[str, dict]]:
    """The assessment's tier and the tier policy it is held to."""
    vendor = db.get(Vendor, assessment.vendor_id)
    tier = assessment.inherent_tier or ((engagement_of(db, assessment) or vendor).tier if vendor else None)
    return tier, tier_policy.merged(config_for(db, assessment).get("tier_policy"))


def approval_problem(db: Session, user, assessment: VendorAssessment) -> Optional[Tuple[int, str]]:
    """Why this person may not approve this assessment, as (HTTP status, reason),
    or None. One set of rules for every route that approves: segregation of duties
    (conflicts), the tier may require an approver role, and no critical finding
    may stand unmitigated."""
    reason = conflicts(db, assessment).get(user.id) if user.id is not None else None
    if reason:
        return 403, f"Segregation of duties: {SOD[reason][1]} — an independent approver is required."
    tier, policy = _tier_rules(db, assessment)
    problem = tier_policy.approver_problem(db, user, tier, policy, is_admin=rbac._is_admin_or_primary(db, user))
    if problem:
        return 403, problem
    open_crit = count_open_critical(db, assessment.id)
    if open_crit > 0:
        return 400, (f"Cannot approve while {open_crit} unmitigated critical finding(s) remain — "
                     "remediate or formally accept them first.")
    return None


def approvers(db: Session, assessment: VendorAssessment) -> List[dict]:
    """Everyone who holds the approve right, and whether each may approve this
    assessment; when not, why: one of the SOD reasons, or the tier's approver role."""
    from ....routers.auth_router import platform_account
    held = conflicts(db, assessment)
    tier, policy = _tier_rules(db, assessment)
    role = policy[tier_policy._tier(tier)].get("approver_role")
    out = []
    # ponytail: a permission lookup per active user; a SQL query of the holders if a tenant has thousands.
    for u in (db.query(GRCUser).filter(GRCUser.is_active.is_(True), platform_account())
              .order_by(GRCUser.display_name.asc().nullslast(), GRCUser.username.asc(), GRCUser.id)):
        if not rbac.user_has_any_permission(db, u, [APPROVE_RIGHT]):
            continue
        reason = SOD[held[u.id]][0] if u.id in held else None
        if reason is None and tier_policy.approver_problem(db, u, tier, policy,
                                                           is_admin=rbac._is_admin_or_primary(db, u)):
            reason = f"No {role} role"
        out.append({"user_id": u.id, "name": u.display_name or u.username or u.email,
                    "eligible": reason is None, "reason": reason})
    return out


def approval_in_force(db: Session, assessment: VendorAssessment) -> Optional[TPRAApproval]:
    """The decision the Approval gate goes by: the latest recorded on the
    assessment, if it was made since the stage was last entered. One made before
    (a send-back since, or recorded ahead of the stage) stays on the record but
    no longer counts."""
    latest = (db.query(TPRAApproval).filter(TPRAApproval.assessment_id == assessment.id)
              .order_by(TPRAApproval.created_at.desc(), TPRAApproval.id.desc()).first())
    entered = getattr(_stage_row(db, assessment.id, "approval"), "started_at", None)
    if latest is None or (entered is not None and latest.created_at < entered):
        return None
    return latest


# ── Approval conditions also live in Task Management ─────────────────────────
# Each condition of a decision has a twin task (grc_critical_tasks, source_module
# "vendor_risk", source_entity_type "TPRAApprovalCondition", source_entity_id the
# approval), as committee actions do (governance/committee_tasks.py), so its owner
# sees it with the rest of their work. The condition keeps its twin's id
# (task_id). The approval endpoints write the twin through mirror_conditions, and
# Task Management's endpoints write status, owner and due date back through
# sync_condition_from_task; neither goes through the other's API, so an edit never
# echoes back. The decision and the condition's wording stay the approver's.
# Deleting the twin leaves the condition on the approval as it was; one without a
# twin gets a new one the next time its decision's conditions are edited, unless
# it is closed.
CONDITION_SOURCE, CONDITION_MODULE, CONDITION_TYPE = "Vendor Approval", "vendor_risk", "TPRAApprovalCondition"
_TASK_DONE = ("Completed", "Verified")


def condition_due(cond: dict) -> Optional[datetime]:
    """A condition's due date (stored as ISO text) as a naive datetime; None when unset or unreadable."""
    if not cond.get("due_date"):
        return None
    try:
        return datetime.fromisoformat(str(cond["due_date"]).replace("Z", "")).replace(tzinfo=None)
    except (TypeError, ValueError):
        return None


def _mirror_condition(db: Session, approval: TPRAApproval, cond: dict, user_id: Optional[int]) -> None:
    from ...governance.regulatory_tasks import _history, _ids, _set_status
    owner = next(iter(_ids([cond.get("owner_id")])), None)
    closed = cond.get("status") == "closed"
    wanted = {"title": (cond.get("text") or "Approval condition")[:255], "due_date": condition_due(cond)}
    ct = db.get(CriticalTask, cond["task_id"]) if cond.get("task_id") else None
    if ct is None:
        if closed:
            return
        vendor = db.get(Vendor, approval.vendor_id)
        ct = CriticalTask(tenant_id=approval.tenant_id, source=CONDITION_SOURCE, source_module=CONDITION_MODULE,
                          source_entity_type=CONDITION_TYPE, source_entity_id=approval.id, category="Remediation",
                          status="Open", priority="Medium", created_by_id=user_id or approval.approver_id,
                          description=(f"A condition of the decision on {vendor.name if vendor else 'a supplier'} "
                                       f"({approval.decision.replace('_', ' ')}), tracked at its Approval stage."),
                          assigned_user_ids=[owner] if owner else [], assigned_owner_id=owner, **wanted)
        db.add(ct)
        db.flush()
        _history(db, ct.id, user_id, f"Created from {CONDITION_MODULE}", "source_entity", None,
                 f"{CONDITION_TYPE} #{approval.id}/{cond.get('id')}")
        db.flush()
        cond["task_id"] = ct.id
        return
    changed = False
    for field, value in wanted.items():
        if getattr(ct, field) != value:
            _history(db, ct.id, user_id, "Synced from Vendor Risk", field, getattr(ct, field), value)
            setattr(ct, field, value)
            changed = True
    # The condition has one owner; Task Management may have added more, kept while the first is unchanged.
    ids = _ids(ct.assigned_user_ids) or _ids([ct.assigned_owner_id])
    if (ids[0] if ids else None) != owner:
        new_ids = [owner] if owner else []
        _history(db, ct.id, user_id, "Synced from Vendor Risk", "assigned_user_ids", ids, new_ids)
        ct.assigned_user_ids, ct.assigned_owner_id = new_ids, owner
        changed = True
    if (ct.status in _TASK_DONE) != closed:
        target = "Completed" if closed else "Open"
        _history(db, ct.id, user_id, "Synced from Vendor Risk", "status", ct.status, target)
        _set_status(ct, target, None)
        changed = True
    if changed:
        ct.updated_at = datetime.utcnow()
    db.flush()


def mirror_conditions(db: Session, approval: TPRAApproval, user_id: Optional[int] = None) -> None:
    """Create or update the twin of each of a decision's conditions. Best-effort,
    each in its own savepoint: Task Management failing never blocks the decision,
    and the condition is still tracked on the approval."""
    conditions = [dict(c) if isinstance(c, dict) else c for c in approval.conditions or []]
    for c in conditions:
        if not isinstance(c, dict):
            continue
        try:
            with db.begin_nested():
                _mirror_condition(db, approval, c, user_id)     # names a new twin only once it is written
        except Exception:  # noqa: BLE001 — the twin is a mirror; the condition stands on its own
            logger.warning("approval %s condition %s → Task Management skipped", approval.id, c.get("id"),
                           exc_info=True)
    approval.conditions = conditions        # a new list of copied dicts flags the JSON column dirty


def sync_condition_from_task(db: Session, critical_task_id: int, user_id: Optional[int] = None) -> None:
    """Task Management changed a twin: its condition follows (status, owner, due date). No-op for any other task."""
    from ...governance.regulatory_tasks import _ids
    ct = db.get(CriticalTask, critical_task_id)
    if ct is None or ct.source_module != CONDITION_MODULE or ct.source_entity_type != CONDITION_TYPE:
        return
    approval = db.get(TPRAApproval, ct.source_entity_id)
    if approval is None:
        return
    ids = _ids(ct.assigned_user_ids) or _ids([ct.assigned_owner_id])
    status, owner = ("closed" if ct.status in _TASK_DONE else "open"), (ids[0] if ids else None)
    conditions, moved, which = [], [], None
    for c in approval.conditions or []:
        if isinstance(c, dict) and c.get("task_id") == ct.id:
            c, which = dict(c), c.get("id")
            if c.get("status") != status:
                c["status"] = status
                c["resolved_at"] = (ct.completed_at or datetime.utcnow()).isoformat() if status == "closed" else None
                moved.append("status")
            if c.get("owner_id") != owner:
                c["owner_id"] = owner
                moved.append("owner")
            if condition_due(c) != ct.due_date:
                c["due_date"] = ct.due_date.isoformat() if ct.due_date else None
                moved.append("due date")
        conditions.append(c)
    if moved:
        approval.conditions = conditions
        write_audit(db, approval.tenant_id, entity="approval", action="update", vendor_id=approval.vendor_id,
                    assessment_id=approval.assessment_id, entity_id=approval.id, actor_id=user_id,
                    reason="Changed in Task Management", extra={"condition": which, "changed": moved})


def on_condition_task_deleted(db: Session, ct: CriticalTask, user_id: Optional[int] = None) -> None:
    """Task Management is deleting a twin: its condition stays on the approval as it was, without a twin."""
    if ct.source_module != CONDITION_MODULE or ct.source_entity_type != CONDITION_TYPE:
        return
    approval = db.get(TPRAApproval, ct.source_entity_id)
    if approval is None:
        return
    conditions = [{**c, "task_id": None} if isinstance(c, dict) and c.get("task_id") == ct.id else c
                  for c in approval.conditions or []]
    if conditions != list(approval.conditions or []):
        approval.conditions = conditions
        write_audit(db, approval.tenant_id, entity="approval", action="update", vendor_id=approval.vendor_id,
                    assessment_id=approval.assessment_id, entity_id=approval.id, actor_id=user_id,
                    reason="Its Task Management task was deleted; the condition stays",
                    extra={"task_id": ct.id})


def sync_risk_register(db: Session, vendor: Vendor, assessment: VendorAssessment) -> Optional[int]:
    """Upsert the vendor's residual third-party risk into the enterprise Risk
    Register (category='third_party') so TPRM rolls up to ERM and shows in Risk
    360°. Keyed by `source_reference=vendor:{id}/vendor_assessment:{id}` (one
    register entry per vendor, whichever version wrote it, updated on each
    re-score). Matched on that exact prefix: `vendor:1` alone would also match
    vendor 12, and vendor 1's promoted findings (`vendor:1/tpra_finding:{id}`).
    An engagement has its own entry, `vendor:{id}/engagement:{id}` matched
    exactly, and General keeps the one above; nothing rolls them up again, so
    nothing is counted twice. Best-effort — never blocks scoring."""
    try:
        from ....models import Risk
        ref = f"vendor:{vendor.id}"
        engagement = engagement_of(db, assessment)
        found = db.query(Risk).filter(Risk.tenant_id == vendor.tenant_id)
        if engagement is None:
            found = found.filter(Risk.source_reference.startswith(f"{ref}/vendor_assessment:", autoescape=True))
            key, name, owner = f"{ref}/vendor_assessment:{assessment.id}", vendor.name, vendor
        else:
            key = f"{ref}/engagement:{engagement.id}"
            found = found.filter(Risk.source_reference == key)
            name, owner = f"{vendor.name} — {engagement.name}", engagement
        risk = found.order_by(Risk.id).first()
        tier = scope_row(db, vendor, engagement).tier
        desc = (
            f"Residual third-party risk from the TPRA lifecycle of vendor '{name}'. "
            f"Tier: {assessment.inherent_tier or tier or 'n/a'}, "
            f"residual rating: {assessment.residual_rating or 'n/a'}, "
            f"grade: {getattr(assessment, 'rating_grade', None) or 'n/a'}."
        )
        # Invariant (TPRM-004): never publish residual > inherent to the register.
        inh = assessment.inherent_score
        res = assessment.residual_score
        if inh is not None and res is not None:
            res = min(res, inh)
        if risk:
            risk.title = f"Third-party risk: {name}"
            risk.description = desc
            risk.inherent_score = inh
            risk.residual_score = res
            risk.risk_sub_category = tier
            risk.updated_at = datetime.utcnow()
        else:
            risk = Risk(
                tenant_id=vendor.tenant_id, business_unit_id=owner.business_unit_id or vendor.business_unit_id,
                title=f"Third-party risk: {name}", description=desc,
                category="third_party", risk_category="third_party",
                register_type="Third-Party Risk", risk_sub_category=tier,
                owner_id=owner.owner_id or vendor.owner_id, inherent_score=inh,
                residual_score=res, status="open",
                source_type="assessment",
                source_reference=key,
            )
            db.add(risk)
            db.flush()
        assessment.linked_risk_id = risk.id
        return risk.id
    except Exception:  # noqa: BLE001 — linkage is best-effort
        logger.warning("TPRA → Risk Register sync skipped for vendor %s", getattr(vendor, "id", "?"), exc_info=True)
        return None


# Severity → a residual score for a promoted single finding (no full re-score).
_SEVERITY_SCORE = {"critical": 85.0, "high": 65.0, "medium": 45.0, "low": 25.0}


def promote_finding_to_register(db: Session, finding: TPRAFinding, actor_id: Optional[int] = None) -> Optional[int]:
    """Move a specific TPRA finding into the enterprise Risk Register as a
    VENDOR-sourced risk — `source_type='vendor'`, the vendor name in the title,
    and `source_reference='vendor:{id}/tpra_finding:{id}'` so it traces both ways.
    Idempotent per finding via `finding.linked_risk_id` (re-promote updates).
    Returns the Risk id (or None on failure — best-effort, never blocks the UI).
    """
    try:
        from ....models import Risk
        vendor = db.query(Vendor).filter(Vendor.id == finding.vendor_id).first()
        vname = vendor.name if vendor else f"Vendor {finding.vendor_id}"
        ref = f"vendor:{finding.vendor_id}/tpra_finding:{finding.id}"
        risk = None
        if getattr(finding, "linked_risk_id", None):
            risk = db.query(Risk).filter(Risk.id == finding.linked_risk_id).first()
        if not risk:
            risk = db.query(Risk).filter(
                Risk.tenant_id == finding.tenant_id, Risk.source_reference == ref
            ).first()
        score = _SEVERITY_SCORE.get((finding.severity or "medium").lower(), 45.0)
        title = f"{vname}: {finding.title or 'Third-party finding'}"
        desc = (
            f"Promoted from the TPRA lifecycle of vendor '{vname}' (vendor #{finding.vendor_id}). "
            f"Domain: {finding.domain or 'n/a'}; severity: {finding.severity or 'n/a'}. "
            f"{finding.description or ''}"
        ).strip()
        if risk:
            risk.title = title
            risk.description = desc
            risk.residual_score = score
            if vendor:
                risk.risk_sub_category = vendor.tier
            risk.updated_at = datetime.utcnow()
        else:
            risk = Risk(
                tenant_id=finding.tenant_id,
                business_unit_id=(vendor.business_unit_id if vendor else None),
                title=title, description=desc,
                category="third_party", risk_category="third_party",
                register_type="Third-Party Risk",
                risk_sub_category=(vendor.tier if vendor else None),
                owner_id=(vendor.owner_id if vendor else None),
                inherent_score=score, residual_score=score, status="open",
                source_type="vendor",
                source_reference=ref,
            )
            db.add(risk)
            db.flush()
        finding.linked_risk_id = risk.id
        write_audit(db, finding.tenant_id, entity="finding", action="promote",
                    vendor_id=finding.vendor_id, assessment_id=finding.assessment_id,
                    entity_id=finding.id, actor_id=actor_id,
                    to_value=f"risk:{risk.id}", extra={"source_type": "vendor", "vendor_name": vname})
        return risk.id
    except Exception:  # noqa: BLE001
        logger.warning("TPRA finding → Risk Register promote failed for finding %s",
                       getattr(finding, "id", "?"), exc_info=True)
        return None


def snapshot(db: Session, vendor: Vendor, assessment: Optional[VendorAssessment], source: str):
    """The supplier's posture over time. Once it has engagements its posture is its
    worst, so the snapshot reads the supplier's own columns and names the assessment
    (and engagement) that moved them."""
    general = general_row(db, vendor)
    if general is None:
        return write_vendor_snapshot(db, vendor, assessment, source=source)
    snap = write_vendor_snapshot(db, vendor, None, source=source)
    if assessment is not None:
        snap.assessment_id, snap.engagement_id = assessment.id, assessment.engagement_id
    snap.rating_grade = worst_grade([general, *open_engagements(db, vendor)])
    return snap


def snapshot_after_finding_change(db: Session, finding: TPRAFinding) -> None:
    """Capture the vendor's posture after a finding transitions to closed/accepted,
    so closure events show up on the risk-over-time trend. Best-effort."""
    vendor = db.query(Vendor).filter(Vendor.id == finding.vendor_id).first()
    if not vendor:
        return
    assessment = db.query(VendorAssessment).filter(
        VendorAssessment.id == finding.assessment_id
    ).first()
    snapshot(db, vendor, assessment, "finding_close")


# ── Versioned reassessment ───────────────────────────────────────────────────

# SQL: the assessment runs through the lifecycle. One the old Assessments page
# makes (POST /assessments) has no stage: it is a stand-alone assessment, approved
# on that page, and never stands in for the lifecycle's own.
IN_LIFECYCLE = VendorAssessment.current_stage.isnot(None)


def _in_scope(query, engagement: Optional[TPRAEngagement]):
    """Assessments of one scope: an engagement's, or General's (engagement_id NULL),
    so General never picks up an engagement's assessment, nor one engagement another's."""
    if engagement is None:
        return query.filter(VendorAssessment.engagement_id.is_(None))
    return query.filter(VendorAssessment.engagement_id == engagement.id)


def _scope(engagement: Optional[TPRAEngagement]) -> Optional[TPRAEngagement]:
    """None for General, whether named by nothing or by its own row."""
    return None if engagement is None or engagement.is_general else engagement


def create_reassessment_version(
    db: Session, vendor: Vendor, actor_id: Optional[int], reason: str,
    assessment_type: str = "reassessment",
    triggered_signal: Optional[TPRAMonitoringSignal] = None,
    engagement: Optional[TPRAEngagement] = None,
) -> VendorAssessment:
    """Open a new assessment version without losing prior history: the current
    active assessment is marked superseded; a fresh version (with new stage
    instances) becomes active and re-enters the lifecycle at due-diligence.
    `engagement` reassesses that engagement only; None is General."""
    engagement = _scope(engagement)
    prior = (
        _in_scope(db.query(VendorAssessment).filter(
            VendorAssessment.vendor_id == vendor.id,
            VendorAssessment.lifecycle_status == "active",
            VendorAssessment.deleted_at.is_(None),
            IN_LIFECYCLE,
        ), engagement)
        .order_by(VendorAssessment.version_no.desc())
        .first()
    )
    prior_version = prior.version_no if prior and prior.version_no else 0
    if prior:
        prior.lifecycle_status = "superseded"
        prior.row_version = (prior.row_version or 1) + 1

    _cfg = get_tiering_config(db, vendor.tenant_id)
    new = VendorAssessment(
        tenant_id=vendor.tenant_id, vendor_id=vendor.id,
        assessment_type=assessment_type, status="in_progress",
        version_no=prior_version + 1,
        supersedes_id=prior.id if prior else None,
        lifecycle_status="active",
        current_stage="dd_planning",  # re-enter at planning (tier already known)
        inherent_tier=prior.inherent_tier if prior else None,
        inherent_score=prior.inherent_score if prior else None,
        engagement_id=engagement.id if engagement is not None else None,
        # Carried forward with the tier: the facts it rests on (so a change to them
        # is still noticed), who does what, and the questionnaire. The new cycle is
        # held to the settings as they stand today.
        tiering_basis=prior.tiering_basis if prior else None,
        team_roster=dict(prior.team_roster or {}) if prior else {},
        template_id=prior.template_id if prior else None,
        policy_snapshot=policy_snapshot(_cfg),
    )
    db.add(new)
    db.flush()
    holder = engagement or vendor   # whose pointers move: the engagement's, or the supplier's for General
    holder.active_assessment_id = new.id
    holder.lifecycle_stage = "dd_planning"
    # Reset the review clock — opening a reassessment schedules the NEXT one from the
    # tier cadence (single source of truth = stages.cadence_days_for, honouring the
    # tenant's admin-configured cadence), so a just-reassessed vendor no longer shows
    # overdue against a stale target date.
    _cad_override = _cfg.get("cadence_days") if isinstance(_cfg.get("cadence_days"), dict) else None
    _cadence = cadence_days_for(new.inherent_tier or scope_row(db, vendor, engagement).tier, _cad_override)
    holder.reassessment_cadence_days = _cadence
    holder.next_reassessment_date = datetime.utcnow() + timedelta(days=_cadence)

    # New stage instances; mark tiering complete (carried over), planning active.
    ensure_stage_instances(db, new)
    for s in get_stage_instances(db, new.id):
        if s.stage_order <= 2:  # intake + tiering carried forward
            s.status = "complete"
            s.completed_at = datetime.utcnow()
        elif s.stage_key == "dd_planning":
            s.status = "in_progress"
            s.started_at = datetime.utcnow()

    if triggered_signal is not None:
        triggered_signal.triggered_reassessment = True
        triggered_signal.triggered_assessment_id = new.id

    write_audit(db, vendor.tenant_id, entity="assessment", action="create",
                vendor_id=vendor.id, assessment_id=new.id, entity_id=new.id, actor_id=actor_id,
                from_value=prior.id if prior else None, to_value=new.id, reason=reason,
                extra={"version_no": new.version_no, **({"engagement_id": engagement.id} if engagement else {})})
    return new


def get_active_assessment(db: Session, vendor: Vendor,
                          engagement: Optional[TPRAEngagement] = None) -> Optional[VendorAssessment]:
    """The active assessment of one scope: the engagement's, or General's (None)."""
    engagement = _scope(engagement)
    pointer = (engagement or vendor).active_assessment_id
    if pointer:
        a = db.query(VendorAssessment).filter(
            VendorAssessment.id == pointer,
            VendorAssessment.deleted_at.is_(None),
        ).first()
        if a and a.engagement_id == (engagement.id if engagement is not None else None):
            return a
    return (
        _in_scope(db.query(VendorAssessment).filter(
            VendorAssessment.vendor_id == vendor.id,
            VendorAssessment.lifecycle_status == "active",
            VendorAssessment.deleted_at.is_(None),
            IN_LIFECYCLE,
        ), engagement)
        .order_by(VendorAssessment.version_no.desc())
        .first()
    )


def ensure_active_assessment(db: Session, vendor: Vendor, actor_id: Optional[int] = None,
                             engagement: Optional[TPRAEngagement] = None) -> VendorAssessment:
    """Get the scope's active assessment (an engagement's, or General's), creating
    the first version + stages if none."""
    engagement = _scope(engagement)
    existing = get_active_assessment(db, vendor, engagement)
    if existing:
        ensure_stage_instances(db, existing)
        return existing
    a = VendorAssessment(
        tenant_id=vendor.tenant_id, vendor_id=vendor.id, assessment_type="initial",
        status="in_progress", version_no=1, lifecycle_status="active", current_stage="intake",
        engagement_id=engagement.id if engagement is not None else None,
    )
    db.add(a)
    db.flush()
    holder = engagement or vendor
    holder.active_assessment_id = a.id
    holder.lifecycle_stage = "intake"
    ensure_stage_instances(db, a)
    write_audit(db, vendor.tenant_id, entity="assessment", action="create",
                vendor_id=vendor.id, assessment_id=a.id, entity_id=a.id, actor_id=actor_id,
                to_value=a.id, reason="initial assessment",
                extra={"version_no": 1, **({"engagement_id": engagement.id} if engagement else {})})
    return a
