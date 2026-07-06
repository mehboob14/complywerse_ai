"""TPRA lifecycle service — DB-facing orchestration over the normalized models.

Stays separate from the legacy `vendor_risk.lifecycle` (8-stage blob) module.
All mutations append a TPRAAuditLog row. Functions take an open Session and the
acting user id; callers (the API layer) own the commit boundary unless noted.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

from sqlalchemy.orm import Session

from ....models import (
    Vendor, VendorAssessment,
    TPRAStageInstance, TPRAQuestion, TPRAQuestionResponse, TPRAFinding,
    TPRARemediation, TPRARiskAcceptance, TPRAContract, TPRAApproval,
    TPRAMonitoringSignal, TPRAAuditLog,
)
from .stages import (
    TPRA_STAGES, STAGE_BY_KEY, STAGE_ORDER, STAGE_KEYS, is_gate,
    stages_at_or_after, can_skip, cadence_days_for, required_reviewers_for,
)
from .engine_tiering import compute_inherent_tier, derive_factors_from_profile
from .engine_scoring import score_assessment
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

def count_open_critical(db: Session, assessment_id: int) -> int:
    """Critical findings that are neither accepted/closed, nor covered by an
    active acceptance, nor by a completed remediation → 'unmitigated'."""
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
        if f.status in ("accepted", "closed"):
            continue
        acc = (
            db.query(TPRARiskAcceptance)
            .filter(
                TPRARiskAcceptance.finding_id == f.id,
                TPRARiskAcceptance.deleted_at.is_(None),
                TPRARiskAcceptance.status == "active",
            ).first()
        )
        # An active acceptance mitigates ONLY while it has not lapsed. A past-expiry
        # acceptance must re-surface the critical for re-review (it is no longer a
        # standing mitigation), so it does not clear the approval gate.
        if acc and (acc.expiry is None or acc.expiry >= now):
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
    source_type+source_id; we also short-circuit if already linked)."""
    if getattr(finding, "linked_issue_id", None):
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


# Stages that mean the vendor has already cleared the approval gate.
_POST_APPROVAL_STAGES = {"onboarding", "monitoring", "reassessment"}


def enforce_critical_invariant(
    db: Session, vendor: Vendor, assessment: VendorAssessment, actor_id: Optional[int] = None,
) -> None:
    """TPRM-002: an open, unmitigated critical-control failure must NOT silently
    persist on a vendor that has already passed the approval gate. Suspend such a
    vendor (auditable); auto-reactivate once the critical is remediated/accepted/
    closed. Best-effort — never blocks the calling mutation. Caller owns commit."""
    try:
        past_approval = (assessment.current_stage in _POST_APPROVAL_STAGES) or bool(
            db.query(TPRAStageInstance.id).filter(
                TPRAStageInstance.assessment_id == assessment.id,
                TPRAStageInstance.stage_key == "approval",
                TPRAStageInstance.status.in_(("complete", "skipped")),
            ).first()
        )
        if not past_approval:
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
        elif open_crit == 0 and status == "suspended":
            vendor.status = "active"
            vendor.updated_at = datetime.utcnow()
            write_audit(db, vendor.tenant_id, entity="vendor", action="reactivate",
                        vendor_id=vendor.id, assessment_id=assessment.id, actor_id=actor_id,
                        from_value="suspended", to_value="active",
                        reason="Critical control failure resolved — vendor reactivated (TPRM-002).")
    except Exception:  # noqa: BLE001 — enforcement must never break the mutation
        logger.warning("critical-invariant enforcement skipped for vendor %s",
                       getattr(vendor, "id", "?"), exc_info=True)


def build_stage_context(db: Session, vendor: Vendor, assessment: VendorAssessment, stage_key: str) -> dict:
    """Gather the plain facts the pure gate engine needs for one stage."""
    tier = assessment.inherent_tier or vendor.tier or "medium"
    ctx: dict = {"tier": tier}

    if stage_key == "intake":
        ctx.update(
            has_name=bool(vendor.name),
            has_owner=bool(vendor.owner_id),
            has_data_classification=bool(vendor.data_access_level and vendor.data_access_level != "none"),
        )
    elif stage_key == "tiering":
        ctx["inherent_tier"] = assessment.inherent_tier
    elif stage_key == "dd_planning":
        ctx["templates_selected"] = 1 if assessment.template_id else (
            db.query(TPRAQuestionResponse.id).filter(TPRAQuestionResponse.assessment_id == assessment.id).first() and 1 or 0
        )
        ctx["required_reviewers"] = len(required_reviewers_for(tier))
        ctx["reviewers_assigned"] = 1 if assessment.reviewed_by else 0
    elif stage_key == "questionnaire":
        total = db.query(TPRAQuestionResponse).filter(
            TPRAQuestionResponse.assessment_id == assessment.id,
            TPRAQuestionResponse.deleted_at.is_(None),
        ).count()
        answered = db.query(TPRAQuestionResponse).filter(
            TPRAQuestionResponse.assessment_id == assessment.id,
            TPRAQuestionResponse.deleted_at.is_(None),
            TPRAQuestionResponse.answer.isnot(None),
        ).count()
        ctx.update(responses_total=total, responses_answered=answered, required_evidence_missing=0)
    elif stage_key == "scoring":
        ctx["residual_computed"] = assessment.residual_score is not None
    elif stage_key == "findings":
        ctx["open_critical_unmitigated"] = count_open_critical(db, assessment.id)
    elif stage_key == "contracting":
        ctx["contract_linked"] = bool(
            db.query(TPRAContract.id).filter(
                TPRAContract.vendor_id == vendor.id,
                TPRAContract.deleted_at.is_(None),
            ).first()
        )
    elif stage_key == "approval":
        latest = (
            db.query(TPRAApproval)
            .filter(TPRAApproval.assessment_id == assessment.id)
            .order_by(TPRAApproval.created_at.desc())
            .first()
        )
        ctx["approval_decision"] = latest.decision if latest else None
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

    order = STAGE_ORDER.get(current_key, 1)
    nxt_key = STAGE_KEYS[order] if order < len(STAGE_KEYS) else None
    if nxt_key:
        nxt = _stage_row(db, assessment.id, nxt_key)
        if nxt and nxt.status == "not_started":
            nxt.status = "in_progress"
            nxt.started_at = datetime.utcnow()
        assessment.current_stage = nxt_key
        vendor.lifecycle_stage = nxt_key  # keep legacy pointer in sync
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
    vendor.lifecycle_stage = target_stage
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
    tier = assessment.inherent_tier or vendor.tier or "medium"
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
        vendor.lifecycle_stage = nxt
    write_audit(db, assessment.tenant_id, entity="stage", action="skip",
                vendor_id=vendor.id, assessment_id=assessment.id, entity_id=row.id,
                actor_id=actor_id, to_value="skipped", reason=reason)
    return {"skipped": stage_key, "reason": reason}


# ── Engine runs (tiering / scoring) ──────────────────────────────────────────

def run_tiering(
    db: Session, vendor: Vendor, assessment: VendorAssessment, actor_id: Optional[int],
    factors: Optional[Dict[str, float]] = None,
) -> dict:
    """Compute the inherent tier and persist it on the assessment + vendor."""
    cfg = get_tiering_config(db, assessment.tenant_id)
    if factors is None:
        factors = derive_factors_from_profile({
            "data_access_level": vendor.data_access_level,
            "data_types_accessed": vendor.data_types_accessed or [],
            "geographic_locations": vendor.geographic_locations or [],
            "business_criticality": vendor.tier,
        })
    result = compute_inherent_tier(factors, cfg)
    assessment.inherent_tier = result["tier"]
    assessment.inherent_score = result["score"]
    vendor.inherent_risk_score = result["score"]
    vendor.tier = result["tier"]
    vendor.risk_rating = vendor.risk_rating or result["tier"]
    assessment.row_version = (assessment.row_version or 1) + 1
    write_audit(db, assessment.tenant_id, entity="tiering", action="update",
                vendor_id=vendor.id, assessment_id=assessment.id, actor_id=actor_id,
                to_value=result["tier"], extra={"score": result["score"]})
    return result


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
        out.append({
            "domain": (q.domain if q else None) or "cybersecurity",
            "answer": resp.answer,
            "weight": float(q.weight) if q and q.weight is not None else 1.0,
            "critical_control": bool(q.critical_control) if q else False,
            "question_key": resp.question_key or (q.question_key if q else None),
            "question_id": resp.question_id,
            "title": q.text if q else None,
        })
    return out


def run_scoring(
    db: Session, vendor: Vendor, assessment: VendorAssessment, actor_id: Optional[int],
) -> dict:
    """Score the assessment from its normalized responses; persist residual +
    domain scores and auto-create blocking findings for failed critical controls."""
    responses = collect_responses_for_scoring(db, assessment.id)
    inherent = assessment.inherent_score or vendor.inherent_risk_score or 0.0
    cfg = get_tiering_config(db, assessment.tenant_id)
    result = score_assessment(responses, inherent_score=inherent, config=cfg)

    assessment.residual_score = result["overall_residual"]
    assessment.residual_rating = result["residual_rating"]
    assessment.rating_grade = result["rating_grade"]
    assessment.domain_scores = result["domain_scores"]
    vendor.residual_risk_score = result["overall_residual"]
    vendor.risk_rating = result["residual_rating"]
    assessment.row_version = (assessment.row_version or 1) + 1

    # Auto-create a blocking critical finding for each failed critical control
    # (idempotent by source question key within the assessment).
    existing_keys = {
        k for (k,) in db.query(TPRAFinding.source_response_id).filter(
            TPRAFinding.assessment_id == assessment.id,
            TPRAFinding.is_critical_control_fail.is_(True),
        ).all()
    }
    created_findings = 0
    for cf in result["critical_failures"]:
        qid = cf.get("question_id")
        if qid in existing_keys:
            continue
        db.add(TPRAFinding(
            tenant_id=assessment.tenant_id, vendor_id=vendor.id, assessment_id=assessment.id,
            domain=cf.get("domain", "cybersecurity"), severity="critical",
            title=cf.get("title") or "Critical control failed",
            description="Auto-raised from a failed critical control during scoring.",
            source_response_id=qid, is_critical_control_fail=True, status="open",
            created_by=actor_id,
        ))
        created_findings += 1

    # Snapshot the new posture so the risk-over-time series is real history.
    db.flush()
    write_vendor_snapshot(db, vendor, assessment, source="score")
    # Roll the residual up into the enterprise Risk Register (Risk 360°).
    sync_risk_register(db, vendor, assessment)

    write_audit(db, assessment.tenant_id, entity="scoring", action="update",
                vendor_id=vendor.id, assessment_id=assessment.id, actor_id=actor_id,
                to_value=result["residual_rating"],
                extra={"residual": result["overall_residual"], "findings_created": created_findings,
                       "grade": result["rating_grade"]})
    result["findings_created"] = created_findings
    return result


def sync_risk_register(db: Session, vendor: Vendor, assessment: VendorAssessment) -> Optional[int]:
    """Upsert the vendor's residual third-party risk into the enterprise Risk
    Register (category='third_party') so TPRM rolls up to ERM and shows in Risk
    360°. Keyed by `source_reference=vendor:{id}` (one register entry per vendor,
    updated on each re-score). Best-effort — never blocks scoring."""
    try:
        from ....models import Risk
        ref = f"vendor:{vendor.id}"
        risk = db.query(Risk).filter(
            Risk.tenant_id == vendor.tenant_id, Risk.source_reference.like(f"{ref}%"),
        ).first()
        if not risk and getattr(assessment, "linked_risk_id", None):
            risk = db.query(Risk).filter(Risk.id == assessment.linked_risk_id).first()
        desc = (
            f"Residual third-party risk from the TPRA lifecycle of vendor '{vendor.name}'. "
            f"Tier: {assessment.inherent_tier or vendor.tier or 'n/a'}, "
            f"residual rating: {assessment.residual_rating or 'n/a'}, "
            f"grade: {getattr(assessment, 'rating_grade', None) or 'n/a'}."
        )
        # Invariant (TPRM-004): never publish residual > inherent to the register.
        inh = assessment.inherent_score
        res = assessment.residual_score
        if inh is not None and res is not None:
            res = min(res, inh)
        if risk:
            risk.title = f"Third-party risk: {vendor.name}"
            risk.description = desc
            risk.inherent_score = inh
            risk.residual_score = res
            risk.risk_sub_category = vendor.tier
            risk.updated_at = datetime.utcnow()
        else:
            risk = Risk(
                tenant_id=vendor.tenant_id, business_unit_id=vendor.business_unit_id,
                title=f"Third-party risk: {vendor.name}", description=desc,
                category="third_party", risk_category="third_party",
                register_type="Third-Party Risk", risk_sub_category=vendor.tier,
                owner_id=vendor.owner_id, inherent_score=inh,
                residual_score=res, status="open",
                source_type="assessment",
                source_reference=f"{ref}/vendor_assessment:{assessment.id}",
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


def snapshot_after_finding_change(db: Session, finding: TPRAFinding) -> None:
    """Capture the vendor's posture after a finding transitions to closed/accepted,
    so closure events show up on the risk-over-time trend. Best-effort."""
    vendor = db.query(Vendor).filter(Vendor.id == finding.vendor_id).first()
    if not vendor:
        return
    assessment = db.query(VendorAssessment).filter(
        VendorAssessment.id == finding.assessment_id
    ).first()
    write_vendor_snapshot(db, vendor, assessment, source="finding_close")


# ── Versioned reassessment ───────────────────────────────────────────────────

def create_reassessment_version(
    db: Session, vendor: Vendor, actor_id: Optional[int], reason: str,
    assessment_type: str = "reassessment",
    triggered_signal: Optional[TPRAMonitoringSignal] = None,
) -> VendorAssessment:
    """Open a new assessment version without losing prior history: the current
    active assessment is marked superseded; a fresh version (with new stage
    instances) becomes active and re-enters the lifecycle at due-diligence."""
    prior = (
        db.query(VendorAssessment)
        .filter(
            VendorAssessment.vendor_id == vendor.id,
            VendorAssessment.lifecycle_status == "active",
            VendorAssessment.deleted_at.is_(None),
        )
        .order_by(VendorAssessment.version_no.desc())
        .first()
    )
    prior_version = prior.version_no if prior and prior.version_no else 0
    if prior:
        prior.lifecycle_status = "superseded"
        prior.row_version = (prior.row_version or 1) + 1

    new = VendorAssessment(
        tenant_id=vendor.tenant_id, vendor_id=vendor.id,
        assessment_type=assessment_type, status="in_progress",
        version_no=prior_version + 1,
        supersedes_id=prior.id if prior else None,
        lifecycle_status="active",
        current_stage="dd_planning",  # re-enter at planning (tier already known)
        inherent_tier=prior.inherent_tier if prior else None,
        inherent_score=prior.inherent_score if prior else None,
    )
    db.add(new)
    db.flush()
    vendor.active_assessment_id = new.id
    vendor.lifecycle_stage = "dd_planning"
    # Reset the review clock — opening a reassessment schedules the NEXT one from the
    # tier cadence (single source of truth = stages.cadence_days_for, honouring the
    # tenant's admin-configured cadence), so a just-reassessed vendor no longer shows
    # overdue against a stale target date.
    _cfg = get_tiering_config(db, vendor.tenant_id)
    _cad_override = _cfg.get("cadence_days") if isinstance(_cfg.get("cadence_days"), dict) else None
    _cadence = cadence_days_for(new.inherent_tier or vendor.tier, _cad_override)
    vendor.reassessment_cadence_days = _cadence
    vendor.next_reassessment_date = datetime.utcnow() + timedelta(days=_cadence)

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
                extra={"version_no": new.version_no})
    return new


def get_active_assessment(db: Session, vendor: Vendor) -> Optional[VendorAssessment]:
    if vendor.active_assessment_id:
        a = db.query(VendorAssessment).filter(
            VendorAssessment.id == vendor.active_assessment_id,
            VendorAssessment.deleted_at.is_(None),
        ).first()
        if a:
            return a
    return (
        db.query(VendorAssessment)
        .filter(
            VendorAssessment.vendor_id == vendor.id,
            VendorAssessment.lifecycle_status == "active",
            VendorAssessment.deleted_at.is_(None),
        )
        .order_by(VendorAssessment.version_no.desc())
        .first()
    )


def ensure_active_assessment(db: Session, vendor: Vendor, actor_id: Optional[int] = None) -> VendorAssessment:
    """Get the vendor's active assessment, creating the first version + stages if none."""
    existing = get_active_assessment(db, vendor)
    if existing:
        ensure_stage_instances(db, existing)
        return existing
    a = VendorAssessment(
        tenant_id=vendor.tenant_id, vendor_id=vendor.id, assessment_type="initial",
        status="in_progress", version_no=1, lifecycle_status="active", current_stage="intake",
    )
    db.add(a)
    db.flush()
    vendor.active_assessment_id = a.id
    vendor.lifecycle_stage = "intake"
    ensure_stage_instances(db, a)
    write_audit(db, vendor.tenant_id, entity="assessment", action="create",
                vendor_id=vendor.id, assessment_id=a.id, entity_id=a.id, actor_id=actor_id,
                to_value=a.id, reason="initial assessment", extra={"version_no": 1})
    return a
