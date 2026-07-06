"""TPRA REST API — normalized 11-stage lifecycle + per-stage CRUD.

Mounted under /vendor-risk/tpra (additive; legacy /vendor-risk routes untouched).
Reads are auth-only (consistent with the existing module); mutations enforce
`vendor_risk:*` permissions (rbac.require_write), check optimistic concurrency,
and append an audit row. History-bearing records soft-delete + restore.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy import asc, desc, func
from sqlalchemy.orm import Session

from ....models import (
    get_db, GRCUser, Vendor, VendorAssessment,
    TPRAStageInstance, TPRAFinding, TPRARemediation, TPRARiskAcceptance,
    TPRAContract, TPRAControlObligation, TPRAApproval, TPRAMonitoringSignal,
    TPRAEvidenceLink, Evidence, TPRATieringConfig, TPRAAuditLog,
)
from ....routers.auth_router import require_auth, get_user_tenants
from . import service, rbac
from .stages import stages_payload, is_valid_stage
from .engine_monitoring import should_trigger_reassessment
from .schema_migrations import ensure_tpra_columns

router = APIRouter(prefix="/tpra", tags=["TPRA Lifecycle"])


# ── helpers ──────────────────────────────────────────────────────────────────

def _tids(user: GRCUser, db: Session) -> List[int]:
    tids = get_user_tenants(user, db)
    if not tids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "No tenant context")
    return tids


def _vendor(db: Session, vendor_id: int, tids: List[int]) -> Vendor:
    v = db.query(Vendor).filter(
        Vendor.id == vendor_id, Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None)
    ).first()
    if not v:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Vendor not found")
    return v


def _assessment(db: Session, assessment_id: int, tids: List[int]) -> VendorAssessment:
    a = db.query(VendorAssessment).filter(
        VendorAssessment.id == assessment_id, VendorAssessment.tenant_id.in_(tids),
        VendorAssessment.deleted_at.is_(None),
    ).first()
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Assessment not found")
    return a


def _get(db: Session, model, obj_id: int, tids: List[int], allow_deleted=False):
    q = db.query(model).filter(model.id == obj_id, model.tenant_id.in_(tids))
    if hasattr(model, "deleted_at") and not allow_deleted:
        q = q.filter(model.deleted_at.is_(None))
    obj = q.first()
    if not obj:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{model.__name__} not found")
    return obj


def _check_concurrency(obj, expected: Optional[int]):
    if expected is not None and getattr(obj, "row_version", None) not in (None, expected):
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "Record was modified by someone else — reload and retry")


def _bump(obj):
    obj.row_version = (getattr(obj, "row_version", 1) or 1) + 1


# ── serializers ──────────────────────────────────────────────────────────────

def s_stage(s: TPRAStageInstance) -> dict:
    return {
        "id": s.id, "stage_key": s.stage_key, "stage_order": s.stage_order,
        "is_gate": s.is_gate, "status": s.status,
        "started_at": s.started_at, "completed_at": s.completed_at,
        "assigned_roles": s.assigned_roles or [], "exit_criteria_result": s.exit_criteria_result or {},
        "gate_decision": s.gate_decision or {}, "skipped_reason": s.skipped_reason,
        "checklist": getattr(s, "checklist", None) or [],
        "row_version": s.row_version,
    }


def s_finding(f: TPRAFinding) -> dict:
    return {
        "id": f.id, "assessment_id": f.assessment_id, "vendor_id": f.vendor_id,
        "domain": f.domain, "severity": f.severity, "title": f.title, "description": f.description,
        "status": f.status, "is_critical_control_fail": f.is_critical_control_fail,
        "source_response_id": f.source_response_id, "row_version": f.row_version,
        "linked_risk_id": getattr(f, "linked_risk_id", None),
        "linked_issue_id": getattr(f, "linked_issue_id", None),
        "deleted_at": f.deleted_at,
        "created_at": f.created_at, "updated_at": f.updated_at,
    }


def s_remediation(r: TPRARemediation) -> dict:
    return {
        "id": r.id, "finding_id": r.finding_id, "title": r.title, "plan": r.plan,
        "treatment_type": r.treatment_type, "owner_id": r.owner_id, "due_date": r.due_date,
        "status": r.status, "completed_at": r.completed_at, "row_version": r.row_version,
    }


def s_acceptance(a: TPRARiskAcceptance) -> dict:
    return {
        "id": a.id, "finding_id": a.finding_id, "rationale": a.rationale,
        "accepted_by": a.accepted_by, "accepted_at": a.accepted_at, "expiry": a.expiry,
        "status": a.status, "row_version": a.row_version,
    }


def s_contract(c: TPRAContract) -> dict:
    return {
        "id": c.id, "vendor_id": c.vendor_id, "assessment_id": c.assessment_id,
        "contract_type": c.contract_type, "title": c.title, "terms": c.terms,
        "document_id": c.document_id, "effective_date": c.effective_date,
        "renewal_date": c.renewal_date, "expiry_date": c.expiry_date, "status": c.status,
        "row_version": c.row_version,
    }


def s_obligation(o: TPRAControlObligation) -> dict:
    return {
        "id": o.id, "contract_id": o.contract_id, "obligation": o.obligation,
        "control_ref": o.control_ref, "finding_id": o.finding_id,
        "renewal_date": o.renewal_date, "status": o.status, "row_version": o.row_version,
    }


def s_approval(a: TPRAApproval) -> dict:
    return {
        "id": a.id, "assessment_id": a.assessment_id, "decision": a.decision,
        "conditions": a.conditions or [], "recommendation": a.recommendation,
        "rationale": a.rationale, "approver_id": a.approver_id,
        "residual_rating": a.residual_rating, "created_at": a.created_at,
    }


def s_signal(s: TPRAMonitoringSignal) -> dict:
    return {
        "id": s.id, "vendor_id": s.vendor_id, "signal_type": s.signal_type,
        "severity": s.severity, "source": s.source, "title": s.title, "detail": s.detail,
        "occurred_at": s.occurred_at, "triggered_reassessment": s.triggered_reassessment,
        "triggered_assessment_id": s.triggered_assessment_id, "acknowledged": s.acknowledged,
        "row_version": s.row_version,
    }


def s_assessment(a: VendorAssessment) -> dict:
    return {
        "id": a.id, "vendor_id": a.vendor_id, "version_no": a.version_no,
        "supersedes_id": a.supersedes_id, "lifecycle_status": a.lifecycle_status,
        "current_stage": a.current_stage, "inherent_tier": a.inherent_tier,
        "inherent_score": a.inherent_score, "residual_rating": a.residual_rating,
        "residual_score": a.residual_score, "domain_scores": a.domain_scores or {},
        "status": a.status, "row_version": a.row_version,
        "template_id": a.template_id, "reviewed_by": a.reviewed_by, "due_date": a.due_date,
        "team_roster": getattr(a, "team_roster", None) or {},
        "created_at": a.created_at, "updated_at": a.updated_at,
    }


# ── payload models ───────────────────────────────────────────────────────────

class AdvanceIn(BaseModel):
    note: Optional[str] = None

class SendBackIn(BaseModel):
    target_stage: str
    reason: str

class SkipIn(BaseModel):
    stage_key: str
    reason: str

class GateDecisionIn(BaseModel):
    stage_key: str
    decision: str
    rationale: Optional[str] = None

class TieringIn(BaseModel):
    factors: Optional[dict] = None

class ReassessIn(BaseModel):
    reason: str
    assessment_type: Optional[str] = "reassessment"

# Controlled vocabularies (no free-text severity/status that a typo can slip past
# the gate/suspension logic, which string-matches on these exact values).
_SEVERITY = Literal["critical", "high", "medium", "low"]
_FINDING_STATUS = Literal["open", "in_remediation", "accepted", "closed"]

class FindingIn(BaseModel):
    domain: str = "cybersecurity"
    severity: _SEVERITY = "medium"
    title: Optional[str] = None
    description: Optional[str] = None
    status: _FINDING_STATUS = "open"

class FindingUpdate(BaseModel):
    domain: Optional[str] = None
    severity: Optional[_SEVERITY] = None
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[_FINDING_STATUS] = None
    row_version: Optional[int] = None

class RemediationIn(BaseModel):
    title: Optional[str] = None
    plan: Optional[str] = None
    treatment_type: Optional[str] = "remediate"
    owner_id: Optional[int] = None
    due_date: Optional[datetime] = None
    status: Optional[str] = "open"

class RemediationUpdate(RemediationIn):
    row_version: Optional[int] = None

class AcceptanceIn(BaseModel):
    rationale: str
    expiry: Optional[datetime] = None

class ContractIn(BaseModel):
    assessment_id: Optional[int] = None
    contract_type: str = "master"
    title: Optional[str] = None
    terms: Optional[str] = None
    document_id: Optional[int] = None
    effective_date: Optional[datetime] = None
    renewal_date: Optional[datetime] = None
    expiry_date: Optional[datetime] = None
    status: Optional[str] = "draft"

class ContractUpdate(ContractIn):
    contract_type: Optional[str] = None
    row_version: Optional[int] = None

class ObligationIn(BaseModel):
    obligation: str
    control_ref: Optional[str] = None
    finding_id: Optional[int] = None
    renewal_date: Optional[datetime] = None
    status: Optional[str] = "open"

class ObligationUpdate(BaseModel):
    obligation: Optional[str] = None
    control_ref: Optional[str] = None
    renewal_date: Optional[datetime] = None
    status: Optional[str] = None
    row_version: Optional[int] = None

class ApprovalIn(BaseModel):
    decision: str
    conditions: Optional[list] = None
    rationale: Optional[str] = None

class SignalIn(BaseModel):
    signal_type: str
    severity: str = "medium"
    source: Optional[str] = None
    title: Optional[str] = None
    detail: Optional[str] = None
    occurred_at: Optional[datetime] = None

class SignalUpdate(BaseModel):
    severity: Optional[str] = None
    title: Optional[str] = None
    detail: Optional[str] = None
    acknowledged: Optional[bool] = None

class ChecklistItemIn(BaseModel):
    text: str
    done: bool = False
    note: Optional[str] = None
    owner_id: Optional[int] = None
    due_date: Optional[str] = None

class ChecklistIn(BaseModel):
    items: List[ChecklistItemIn]

class RoleAssignmentIn(BaseModel):
    role: str          # R | A | C | I
    user_id: int

class RolesIn(BaseModel):
    assigned_roles: List[RoleAssignmentIn]

class TeamIn(BaseModel):
    # Assessment-level RACI team roster: {role_key: user_id}. Assigned once.
    roster: dict

class ConfigIn(BaseModel):
    """TPRM program config (Admin/Settings): inherent-risk factor weights, tier
    thresholds and reassessment cadence. Partial — only supplied sections change."""
    weights: Optional[dict] = None        # {factor_key: float} — normalized to sum 1.0
    thresholds: Optional[dict] = None     # {critical, high, medium} on 0..100, descending
    cadence_days: Optional[dict] = None   # {critical, high, medium, low} in days

class PlanIn(BaseModel):
    """Persist the Due-Diligence Planning selections onto the assessment so the
    dd_planning exit gate (template selected + reviewer assigned) can pass."""
    template_id: Optional[int] = None
    reviewed_by: Optional[int] = None
    due_date: Optional[datetime] = None
    row_version: Optional[int] = None


# ── Lifecycle ────────────────────────────────────────────────────────────────

@router.get("/stages")
def get_stages():
    return {"stages": stages_payload()}


@router.get("/board")
def lifecycle_board(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Vendor-centric TPRA board: one row per vendor with its active assessment's
    stage / tier / residual / open-finding counts. Powers the rebuilt Assessments
    workspace in a single call (no N+1)."""
    tids = _tids(user, db)
    vendors = (
        db.query(Vendor)
        .filter(Vendor.tenant_id.in_(tids), Vendor.deleted_at.is_(None))
        .order_by(Vendor.name.asc())
        .all()
    )
    # Active assessment per vendor (highest version wins if several are active).
    amap: dict = {}
    for a in (
        db.query(VendorAssessment)
        .filter(
            VendorAssessment.tenant_id.in_(tids),
            VendorAssessment.lifecycle_status == "active",
            VendorAssessment.deleted_at.is_(None),
        )
        .all()
    ):
        cur = amap.get(a.vendor_id)
        if not cur or (a.version_no or 0) > (cur.version_no or 0):
            amap[a.vendor_id] = a

    # Open + open-critical finding counts grouped by assessment (two grouped queries).
    open_counts = dict(
        db.query(TPRAFinding.assessment_id, func.count(TPRAFinding.id))
        .filter(
            TPRAFinding.tenant_id.in_(tids),
            TPRAFinding.deleted_at.is_(None),
            TPRAFinding.status.in_(["open", "in_remediation"]),
        )
        .group_by(TPRAFinding.assessment_id)
        .all()
    )
    crit_counts = dict(
        db.query(TPRAFinding.assessment_id, func.count(TPRAFinding.id))
        .filter(
            TPRAFinding.tenant_id.in_(tids),
            TPRAFinding.deleted_at.is_(None),
            TPRAFinding.severity == "critical",
            TPRAFinding.status.in_(["open", "in_remediation"]),
        )
        .group_by(TPRAFinding.assessment_id)
        .all()
    )

    items = []
    for v in vendors:
        a = amap.get(v.id)
        items.append({
            "vendor_id": v.id,
            "vendor_name": v.name,
            "vendor_status": v.status,
            "tier": (a.inherent_tier if a else None) or v.tier,
            "has_assessment": bool(a),
            "assessment_id": a.id if a else None,
            "version_no": a.version_no if a else None,
            "current_stage": a.current_stage if a else None,
            "inherent_score": a.inherent_score if a else None,
            "residual_rating": a.residual_rating if a else None,
            "residual_score": a.residual_score if a else None,
            "open_findings": int(open_counts.get(a.id, 0)) if a else 0,
            "open_critical": int(crit_counts.get(a.id, 0)) if a else 0,
            "next_review": v.next_reassessment_date.isoformat() if v.next_reassessment_date else None,
            "updated_at": (a.updated_at if a else v.updated_at),
        })
    return {"items": items, "total": len(items)}


@router.get("/vendors/{vendor_id}/lifecycle")
def get_lifecycle(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    ensure_tpra_columns(db)
    v = _vendor(db, vendor_id, tids)
    a = service.get_active_assessment(db, v)
    if not a:
        return {"vendor_id": v.id, "assessment": None, "stages": [], "current": None, "gate": None}
    stages = service.get_stage_instances(db, a.id)
    cur = a.current_stage
    gate = service.evaluate_current(db, v, a, cur) if cur else None
    return {
        "vendor_id": v.id, "assessment": s_assessment(a),
        "stages": [s_stage(s) for s in stages], "current": cur, "gate": gate,
    }


@router.post("/vendors/{vendor_id}/lifecycle/init")
def init_lifecycle(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    v = _vendor(db, vendor_id, tids)
    rbac.require_write(db, user, "assessments", "create")
    a = service.ensure_active_assessment(db, v, actor_id=user.id)
    db.commit()
    return {"assessment": s_assessment(a), "stages": [s_stage(s) for s in service.get_stage_instances(db, a.id)]}


@router.get("/vendors/{vendor_id}/assessments")
def list_assessment_versions(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    v = _vendor(db, vendor_id, tids)
    rows = (
        db.query(VendorAssessment)
        .filter(VendorAssessment.vendor_id == v.id, VendorAssessment.deleted_at.is_(None))
        .order_by(VendorAssessment.version_no.desc()).all()
    )
    return {"items": [s_assessment(a) for a in rows], "total": len(rows)}


@router.post("/assessments/{assessment_id}/advance")
def advance(assessment_id: int, body: AdvanceIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    a = _assessment(db, assessment_id, tids)
    v = _vendor(db, a.vendor_id, tids)
    rbac.require_write(db, user, "lifecycle", "advance")
    service.ensure_stage_instances(db, a)
    result = service.advance_stage(db, v, a, actor_id=user.id, note=body.note)
    db.commit()
    if not result["advanced"]:
        # 422: exit criteria not met — return the blockers, not a hard error page.
        return {"advanced": False, "from": result["from"], "blockers": result["blockers"]}
    return result


@router.post("/assessments/{assessment_id}/send-back")
def send_back(assessment_id: int, body: SendBackIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    a = _assessment(db, assessment_id, tids)
    v = _vendor(db, a.vendor_id, tids)
    rbac.require_write(db, user, "lifecycle", "send_back")
    try:
        result = service.send_back(db, v, a, body.target_stage, actor_id=user.id, reason=body.reason)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    db.commit()
    return result


@router.post("/assessments/{assessment_id}/skip")
def skip(assessment_id: int, body: SkipIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    a = _assessment(db, assessment_id, tids)
    v = _vendor(db, a.vendor_id, tids)
    rbac.require_write(db, user, "lifecycle", "skip")
    try:
        result = service.skip_stage(db, v, a, body.stage_key, actor_id=user.id, reason=body.reason)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    db.commit()
    return result


@router.post("/assessments/{assessment_id}/gate-decision")
def gate_decision(assessment_id: int, body: GateDecisionIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    a = _assessment(db, assessment_id, tids)
    v = _vendor(db, a.vendor_id, tids)
    rbac.require_write(db, user, "lifecycle", "advance")
    try:
        row = service.record_gate_decision(db, v, a, body.stage_key, body.decision, user.id, body.rationale)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    db.commit()
    return s_stage(row)


@router.post("/assessments/{assessment_id}/run-tiering")
def run_tiering(assessment_id: int, body: TieringIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    a = _assessment(db, assessment_id, tids)
    v = _vendor(db, a.vendor_id, tids)
    rbac.require_write(db, user, "assessments", "edit")
    result = service.run_tiering(db, v, a, actor_id=user.id, factors=body.factors)
    db.commit()
    return result


@router.post("/assessments/{assessment_id}/run-scoring")
def run_scoring(assessment_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    a = _assessment(db, assessment_id, tids)
    v = _vendor(db, a.vendor_id, tids)
    rbac.require_write(db, user, "assessments", "edit")
    result = service.run_scoring(db, v, a, actor_id=user.id)
    db.commit()
    return result


@router.post("/vendors/{vendor_id}/reassess")
def reassess(vendor_id: int, body: ReassessIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    v = _vendor(db, vendor_id, tids)
    rbac.require_write(db, user, "assessments", "create")
    new = service.create_reassessment_version(db, v, actor_id=user.id, reason=body.reason,
                                              assessment_type=body.assessment_type or "reassessment")
    db.commit()
    return s_assessment(new)


# ── Findings ─────────────────────────────────────────────────────────────────

@router.get("/assessments/{assessment_id}/findings")
def list_findings(
    assessment_id: int, status_filter: Optional[str] = Query(None, alias="status"),
    domain: Optional[str] = None, severity: Optional[str] = None,
    sort: str = "created_at", order: str = "desc",
    skip: int = 0, limit: int = Query(50, ge=1, le=200),
    include_deleted: bool = False,
    db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
):
    tids = _tids(user, db)
    _assessment(db, assessment_id, tids)
    q = db.query(TPRAFinding).filter(TPRAFinding.assessment_id == assessment_id, TPRAFinding.tenant_id.in_(tids))
    if not include_deleted:
        q = q.filter(TPRAFinding.deleted_at.is_(None))
    if status_filter:
        q = q.filter(TPRAFinding.status == status_filter)
    if domain:
        q = q.filter(TPRAFinding.domain == domain)
    if severity:
        q = q.filter(TPRAFinding.severity == severity)
    total = q.count()
    col = getattr(TPRAFinding, sort, TPRAFinding.created_at)
    q = q.order_by(desc(col) if order == "desc" else asc(col))
    items = q.offset(skip).limit(limit).all()
    return {"items": [s_finding(f) for f in items], "total": total, "skip": skip, "limit": limit}


@router.post("/assessments/{assessment_id}/findings", status_code=status.HTTP_201_CREATED)
def create_finding(assessment_id: int, body: FindingIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    a = _assessment(db, assessment_id, tids)
    rbac.require_write(db, user, "findings", "create")
    f = TPRAFinding(
        tenant_id=a.tenant_id, vendor_id=a.vendor_id, assessment_id=a.id,
        domain=body.domain, severity=body.severity, title=body.title,
        description=body.description, status=body.status or "open", created_by=user.id,
        is_critical_control_fail=(body.severity == "critical"),
    )
    db.add(f)
    db.flush()
    service.write_audit(db, a.tenant_id, entity="finding", action="create",
                        vendor_id=a.vendor_id, assessment_id=a.id, entity_id=f.id, actor_id=user.id,
                        to_value=body.title)
    # TPRM-003: mirror the finding into the shared Issue/Action module.
    service.ensure_finding_issue(db, f, user.id)
    # TPRM-002: a new critical finding on an already-onboarded vendor suspends it.
    if f.severity == "critical":
        v = db.query(Vendor).filter(Vendor.id == a.vendor_id).first()
        if v:
            service.enforce_critical_invariant(db, v, a, user.id)
    db.commit()
    return s_finding(f)


@router.get("/findings/{finding_id}")
def get_finding(finding_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    f = _get(db, TPRAFinding, finding_id, tids)
    rems = db.query(TPRARemediation).filter(TPRARemediation.finding_id == f.id, TPRARemediation.deleted_at.is_(None)).all()
    accs = db.query(TPRARiskAcceptance).filter(TPRARiskAcceptance.finding_id == f.id, TPRARiskAcceptance.deleted_at.is_(None)).all()
    return {"finding": s_finding(f), "remediations": [s_remediation(r) for r in rems],
            "acceptances": [s_acceptance(x) for x in accs]}


@router.put("/findings/{finding_id}")
def update_finding(finding_id: int, body: FindingUpdate, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    f = _get(db, TPRAFinding, finding_id, tids)
    rbac.require_write(db, user, "findings", "edit")
    _check_concurrency(f, body.row_version)
    prev_status = f.status
    # State-machine guard — 'accepted' and 'closed' are NOT free status flips:
    #  • 'accepted' must go through the acceptance workflow (POST .../acceptances)
    #    so an accountable owner signs off and a TPRARiskAcceptance record exists;
    #  • 'closed' requires evidence of fix — at least one completed remediation.
    # Without this, a critical finding could clear the approval gate and auto-
    # reactivate a suspended vendor simply by picking a status from a dropdown.
    if body.status and body.status != prev_status:
        if body.status == "accepted":
            raise HTTPException(
                status_code=400,
                detail="Use 'Accept risk' to record an accountable sign-off — a finding cannot be set to 'accepted' directly.",
            )
        if body.status == "closed":
            _completed_rem = (
                db.query(TPRARemediation.id)
                .filter(
                    TPRARemediation.finding_id == f.id,
                    TPRARemediation.deleted_at.is_(None),
                    TPRARemediation.status == "completed",
                ).first()
            )
            if not _completed_rem:
                raise HTTPException(
                    status_code=400,
                    detail="A finding can only be closed after a remediation is completed (evidence of fix) — or record a risk acceptance instead.",
                )
    for field in ("domain", "severity", "title", "description", "status"):
        val = getattr(body, field)
        if val is not None:
            setattr(f, field, val)
    _bump(f)
    service.write_audit(db, f.tenant_id, entity="finding", action="update",
                        vendor_id=f.vendor_id, assessment_id=f.assessment_id, entity_id=f.id, actor_id=user.id)
    # On close/accept, snapshot the vendor so the trend reflects risk removed.
    _closed = ("closed", "accepted")
    if f.status in _closed and prev_status not in _closed:
        db.flush()
        service.snapshot_after_finding_change(db, f)
    # TPRM-003: keep the linked Issue in sync — close it when the finding closes/
    # accepts; (re)create it when the finding is (re)opened.
    if f.status in _closed:
        service.close_finding_issue(db, f, user.id)
    elif f.status == "open":
        service.ensure_finding_issue(db, f, user.id)
    # TPRM-002: re-evaluate the critical invariant on any status change (reopen →
    # suspend the onboarded vendor; resolve → auto-reactivate).
    v = db.query(Vendor).filter(Vendor.id == f.vendor_id).first()
    a = db.query(VendorAssessment).filter(VendorAssessment.id == f.assessment_id).first()
    if v and a:
        service.enforce_critical_invariant(db, v, a, user.id)
    db.commit()
    return s_finding(f)


@router.delete("/findings/{finding_id}")
def delete_finding(finding_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    f = _get(db, TPRAFinding, finding_id, tids)
    rbac.require_write(db, user, "findings", "delete")
    f.deleted_at = datetime.utcnow()
    _bump(f)
    service.write_audit(db, f.tenant_id, entity="finding", action="delete",
                        vendor_id=f.vendor_id, assessment_id=f.assessment_id, entity_id=f.id, actor_id=user.id)
    db.commit()
    return {"deleted": True, "id": f.id}


@router.post("/findings/{finding_id}/restore")
def restore_finding(finding_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    f = _get(db, TPRAFinding, finding_id, tids, allow_deleted=True)
    rbac.require_write(db, user, "findings", "edit")
    f.deleted_at = None
    _bump(f)
    service.write_audit(db, f.tenant_id, entity="finding", action="restore",
                        vendor_id=f.vendor_id, assessment_id=f.assessment_id, entity_id=f.id, actor_id=user.id)
    db.commit()
    return s_finding(f)


@router.post("/findings/{finding_id}/promote-to-register")
def promote_finding(finding_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Move this finding into the ERM Risk Register as a vendor-sourced risk
    (source = the vendor; vendor name + id carried). Idempotent per finding."""
    tids = _tids(user, db)
    f = _get(db, TPRAFinding, finding_id, tids)
    rbac.require_write(db, user, "findings", "edit")
    risk_id = service.promote_finding_to_register(db, f, actor_id=user.id)
    if not risk_id:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Could not promote finding to the Risk Register")
    db.commit()
    return {"finding_id": f.id, "risk_id": risk_id, "linked_risk_id": f.linked_risk_id}


# ── Evidence (upload OR link existing) — assessment-level pack + per-finding ───

def s_evlink(link: TPRAEvidenceLink, ev: Optional[Evidence]) -> dict:
    return {
        "id": link.id, "evidence_id": link.evidence_id,
        "assessment_id": link.assessment_id, "finding_id": link.finding_id,
        "note": link.note,
        "name": ev.name if ev else None, "file_name": getattr(ev, "file_name", None),
        "file_type": getattr(ev, "file_type", None), "evidence_type": getattr(ev, "evidence_type", None),
        "status": getattr(ev, "status", None), "has_file": bool(getattr(ev, "file_path", None)) if ev else False,
        "created_at": link.created_at,
    }


async def _save_evidence_file(db: Session, tenant_id: int, name: Optional[str],
                              evidence_type: Optional[str], file: UploadFile, user_id: int) -> Evidence:
    """Persist an uploaded file the same way the central evidence module does
    (uploads/evidence/{tenant}/) and create an Evidence row. OCR left off."""
    import os
    import uuid
    from ...evidence.routers.evidence import EVIDENCE_UPLOAD_DIR
    tenant_dir = os.path.join(EVIDENCE_UPLOAD_DIR, str(tenant_id))
    os.makedirs(tenant_dir, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1].lower()
    path = os.path.join(tenant_dir, f"{uuid.uuid4()}{ext}")
    contents = await file.read()
    with open(path, "wb") as fh:
        fh.write(contents)
    ev = Evidence(
        tenant_id=tenant_id, name=(name or file.filename or "Vendor evidence"),
        file_path=path, file_name=file.filename, file_type=file.content_type,
        evidence_type=(evidence_type or "vendor_evidence"), uploaded_by=user_id, status="draft",
    )
    if hasattr(Evidence, "ocr_status"):
        ev.ocr_status = "not_applicable"
    db.add(ev)
    db.flush()
    return ev


class EvidenceLinkIn(BaseModel):
    evidence_id: int
    finding_id: Optional[int] = None
    response_id: Optional[int] = None
    note: Optional[str] = None


@router.get("/assessments/{assessment_id}/evidence")
def list_assessment_evidence(
    assessment_id: int, finding_id: Optional[int] = Query(None),
    db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
):
    tids = _tids(user, db)
    _assessment(db, assessment_id, tids)
    q = db.query(TPRAEvidenceLink).filter(
        TPRAEvidenceLink.assessment_id == assessment_id,
        TPRAEvidenceLink.tenant_id.in_(tids), TPRAEvidenceLink.deleted_at.is_(None),
    )
    if finding_id is not None:
        q = q.filter(TPRAEvidenceLink.finding_id == finding_id)
    links = q.order_by(desc(TPRAEvidenceLink.created_at)).all()
    ev_ids = [l.evidence_id for l in links] or [0]
    evmap = {e.id: e for e in db.query(Evidence).filter(Evidence.id.in_(ev_ids)).all()}
    return {"items": [s_evlink(l, evmap.get(l.evidence_id)) for l in links], "total": len(links)}


@router.post("/assessments/{assessment_id}/evidence/upload", status_code=status.HTTP_201_CREATED)
async def upload_assessment_evidence(
    assessment_id: int,
    name: Optional[str] = Form(None),
    evidence_type: Optional[str] = Form(None),
    note: Optional[str] = Form(None),
    finding_id: Optional[int] = Form(None),
    response_id: Optional[int] = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
):
    tids = _tids(user, db)
    a = _assessment(db, assessment_id, tids)
    rbac.require_write(db, user, "assessments", "edit")
    ev = await _save_evidence_file(db, a.tenant_id, name, evidence_type, file, user.id)
    link = TPRAEvidenceLink(
        tenant_id=a.tenant_id, vendor_id=a.vendor_id, assessment_id=a.id,
        finding_id=finding_id, response_id=response_id, evidence_id=ev.id, note=note, created_by=user.id,
    )
    db.add(link)
    db.flush()
    service.write_audit(db, a.tenant_id, entity="evidence", action="create",
                        vendor_id=a.vendor_id, assessment_id=a.id, entity_id=link.id, actor_id=user.id,
                        to_value=ev.name, extra={"evidence_id": ev.id, "finding_id": finding_id})
    db.commit()
    return s_evlink(link, ev)


@router.post("/assessments/{assessment_id}/evidence/link", status_code=status.HTTP_201_CREATED)
def link_assessment_evidence(
    assessment_id: int, body: EvidenceLinkIn,
    db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
):
    tids = _tids(user, db)
    a = _assessment(db, assessment_id, tids)
    rbac.require_write(db, user, "assessments", "edit")
    ev = db.query(Evidence).filter(Evidence.id == body.evidence_id, Evidence.tenant_id == a.tenant_id).first()
    if not ev:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Evidence not found")
    link = TPRAEvidenceLink(
        tenant_id=a.tenant_id, vendor_id=a.vendor_id, assessment_id=a.id,
        finding_id=body.finding_id, response_id=body.response_id, evidence_id=ev.id, note=body.note, created_by=user.id,
    )
    db.add(link)
    db.flush()
    service.write_audit(db, a.tenant_id, entity="evidence", action="create",
                        vendor_id=a.vendor_id, assessment_id=a.id, entity_id=link.id, actor_id=user.id,
                        to_value=ev.name, extra={"evidence_id": ev.id, "linked_existing": True})
    db.commit()
    return s_evlink(link, ev)


@router.delete("/evidence-links/{link_id}")
def unlink_evidence(link_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    link = _get(db, TPRAEvidenceLink, link_id, tids)
    rbac.require_write(db, user, "assessments", "edit")
    link.deleted_at = datetime.utcnow()
    service.write_audit(db, link.tenant_id, entity="evidence", action="delete",
                        vendor_id=link.vendor_id, assessment_id=link.assessment_id,
                        entity_id=link.id, actor_id=user.id)
    db.commit()
    return {"deleted": True, "id": link.id}


# remediations
@router.get("/findings/{finding_id}/remediations")
def list_remediations(finding_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    f = _get(db, TPRAFinding, finding_id, tids)
    rows = db.query(TPRARemediation).filter(TPRARemediation.finding_id == f.id, TPRARemediation.deleted_at.is_(None)).all()
    return {"items": [s_remediation(r) for r in rows], "total": len(rows)}


@router.post("/findings/{finding_id}/remediations", status_code=status.HTTP_201_CREATED)
def create_remediation(finding_id: int, body: RemediationIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    f = _get(db, TPRAFinding, finding_id, tids)
    rbac.require_write(db, user, "findings", "edit")
    r = TPRARemediation(
        tenant_id=f.tenant_id, finding_id=f.id, title=body.title, plan=body.plan,
        treatment_type=body.treatment_type or "remediate", owner_id=body.owner_id,
        due_date=body.due_date, status=body.status or "open",
    )
    if f.status == "open":
        f.status = "in_remediation"
    db.add(r)
    db.flush()
    service.write_audit(db, f.tenant_id, entity="remediation", action="create",
                        vendor_id=f.vendor_id, assessment_id=f.assessment_id, entity_id=r.id, actor_id=user.id)
    db.commit()
    return s_remediation(r)


@router.put("/remediations/{rem_id}")
def update_remediation(rem_id: int, body: RemediationUpdate, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    r = _get(db, TPRARemediation, rem_id, tids)
    rbac.require_write(db, user, "findings", "edit")
    _check_concurrency(r, body.row_version)
    for field in ("title", "plan", "treatment_type", "owner_id", "due_date", "status"):
        val = getattr(body, field)
        if val is not None:
            setattr(r, field, val)
    if body.status == "completed" and not r.completed_at:
        r.completed_at = datetime.utcnow()
    _bump(r)
    service.write_audit(db, r.tenant_id, entity="remediation", action="update",
                        entity_id=r.id, actor_id=user.id)
    db.commit()
    return s_remediation(r)


@router.delete("/remediations/{rem_id}")
def delete_remediation(rem_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    r = _get(db, TPRARemediation, rem_id, tids)
    rbac.require_write(db, user, "findings", "delete")
    r.deleted_at = datetime.utcnow()
    _bump(r)
    service.write_audit(db, r.tenant_id, entity="remediation", action="delete", entity_id=r.id, actor_id=user.id)
    db.commit()
    return {"deleted": True, "id": r.id}


# risk acceptances
@router.post("/findings/{finding_id}/acceptances", status_code=status.HTTP_201_CREATED)
def create_acceptance(finding_id: int, body: AcceptanceIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    f = _get(db, TPRAFinding, finding_id, tids)
    # accept_risk is high-sensitivity: require the dedicated permission (no broad
    # erm:risks:edit backdoor) so it can be held by an accountable approver role.
    rbac.require_write(db, user, "findings", "accept_risk", allow_fallback=False)
    # Segregation of duties — the person who raised a critical/high finding cannot
    # sign off its own acceptance; an independent accountable owner must.
    if f.severity in ("critical", "high") and f.created_by and f.created_by == user.id:
        raise HTTPException(
            status_code=403,
            detail="Segregation of duties: the finding's author cannot accept its own critical/high risk — a different accountable owner must sign off.",
        )
    # Critical/high acceptances must be time-boxed so they are re-reviewed on a date
    # rather than standing perpetually (an expired acceptance re-surfaces the risk).
    if f.severity in ("critical", "high") and body.expiry is None:
        raise HTTPException(
            status_code=400,
            detail="An expiry date is required to accept a critical/high risk (acceptances must be time-boxed for re-review).",
        )
    a = TPRARiskAcceptance(
        tenant_id=f.tenant_id, finding_id=f.id, rationale=body.rationale,
        accepted_by=user.id, accepted_at=datetime.utcnow(), expiry=body.expiry, status="active",
    )
    f.status = "accepted"
    db.add(a)
    db.flush()
    service.write_audit(db, f.tenant_id, entity="risk_acceptance", action="create",
                        vendor_id=f.vendor_id, assessment_id=f.assessment_id, entity_id=a.id, actor_id=user.id,
                        reason=body.rationale)
    # TPRM-003: accepting the risk resolves the finding → close the linked issue.
    service.close_finding_issue(db, f, user.id, reason="Risk formally accepted on the TPRA finding.")
    # TPRM-002: accepting the risk resolves the critical → maybe reactivate vendor.
    v = db.query(Vendor).filter(Vendor.id == f.vendor_id).first()
    asmt = db.query(VendorAssessment).filter(VendorAssessment.id == f.assessment_id).first()
    if v and asmt:
        service.enforce_critical_invariant(db, v, asmt, user.id)
    db.commit()
    return s_acceptance(a)


@router.delete("/acceptances/{acc_id}")
def revoke_acceptance(acc_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    a = _get(db, TPRARiskAcceptance, acc_id, tids)
    rbac.require_write(db, user, "findings", "accept_risk")
    a.status = "revoked"
    a.deleted_at = datetime.utcnow()
    _bump(a)
    f = db.query(TPRAFinding).filter(TPRAFinding.id == a.finding_id).first()
    if f and f.status == "accepted":
        f.status = "open"
    service.write_audit(db, a.tenant_id, entity="risk_acceptance", action="delete", entity_id=a.id, actor_id=user.id)
    # TPRM-002/003: revoking acceptance reopens the finding → reopen/recreate its
    # issue and re-suspend the onboarded vendor if the critical is unmitigated.
    if f:
        service.ensure_finding_issue(db, f, user.id)
        v = db.query(Vendor).filter(Vendor.id == f.vendor_id).first()
        asmt = db.query(VendorAssessment).filter(VendorAssessment.id == f.assessment_id).first()
        if v and asmt:
            service.enforce_critical_invariant(db, v, asmt, user.id)
    db.commit()
    return {"revoked": True, "id": a.id}


# ── Contracts & obligations ──────────────────────────────────────────────────

@router.get("/vendors/{vendor_id}/contracts")
def list_contracts(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    _vendor(db, vendor_id, tids)
    rows = db.query(TPRAContract).filter(
        TPRAContract.vendor_id == vendor_id, TPRAContract.tenant_id.in_(tids), TPRAContract.deleted_at.is_(None)
    ).order_by(TPRAContract.created_at.desc()).all()
    return {"items": [s_contract(c) for c in rows], "total": len(rows)}


@router.post("/vendors/{vendor_id}/contracts", status_code=status.HTTP_201_CREATED)
def create_contract(vendor_id: int, body: ContractIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    v = _vendor(db, vendor_id, tids)
    rbac.require_write(db, user, "contracts", "create")
    c = TPRAContract(
        tenant_id=v.tenant_id, vendor_id=v.id, assessment_id=body.assessment_id,
        contract_type=body.contract_type or "master", title=body.title, terms=body.terms,
        document_id=body.document_id, effective_date=body.effective_date,
        renewal_date=body.renewal_date, expiry_date=body.expiry_date, status=body.status or "draft",
    )
    db.add(c)
    db.flush()
    service.write_audit(db, v.tenant_id, entity="contract", action="create",
                        vendor_id=v.id, entity_id=c.id, actor_id=user.id, to_value=body.title)
    db.commit()
    return s_contract(c)


@router.put("/contracts/{contract_id}")
def update_contract(contract_id: int, body: ContractUpdate, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    c = _get(db, TPRAContract, contract_id, tids)
    rbac.require_write(db, user, "contracts", "edit")
    _check_concurrency(c, body.row_version)
    for field in ("contract_type", "title", "terms", "document_id", "effective_date", "renewal_date", "expiry_date", "status", "assessment_id"):
        val = getattr(body, field)
        if val is not None:
            setattr(c, field, val)
    _bump(c)
    service.write_audit(db, c.tenant_id, entity="contract", action="update", vendor_id=c.vendor_id, entity_id=c.id, actor_id=user.id)
    db.commit()
    return s_contract(c)


@router.delete("/contracts/{contract_id}")
def delete_contract(contract_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    c = _get(db, TPRAContract, contract_id, tids)
    rbac.require_write(db, user, "contracts", "delete")
    c.deleted_at = datetime.utcnow()
    _bump(c)
    service.write_audit(db, c.tenant_id, entity="contract", action="delete", vendor_id=c.vendor_id, entity_id=c.id, actor_id=user.id)
    db.commit()
    return {"deleted": True, "id": c.id}


@router.get("/contracts/{contract_id}/obligations")
def list_obligations(contract_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    c = _get(db, TPRAContract, contract_id, tids)
    rows = db.query(TPRAControlObligation).filter(
        TPRAControlObligation.contract_id == c.id, TPRAControlObligation.deleted_at.is_(None)
    ).all()
    return {"items": [s_obligation(o) for o in rows], "total": len(rows)}


@router.post("/contracts/{contract_id}/obligations", status_code=status.HTTP_201_CREATED)
def create_obligation(contract_id: int, body: ObligationIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    c = _get(db, TPRAContract, contract_id, tids)
    rbac.require_write(db, user, "contracts", "edit")
    o = TPRAControlObligation(
        tenant_id=c.tenant_id, contract_id=c.id, obligation=body.obligation,
        control_ref=body.control_ref, finding_id=body.finding_id,
        renewal_date=body.renewal_date, status=body.status or "open",
    )
    db.add(o)
    db.flush()
    service.write_audit(db, c.tenant_id, entity="obligation", action="create", vendor_id=c.vendor_id, entity_id=o.id, actor_id=user.id)
    db.commit()
    return s_obligation(o)


@router.put("/obligations/{obl_id}")
def update_obligation(obl_id: int, body: ObligationUpdate, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    o = _get(db, TPRAControlObligation, obl_id, tids)
    rbac.require_write(db, user, "contracts", "edit")
    _check_concurrency(o, body.row_version)
    for field in ("obligation", "control_ref", "renewal_date", "status"):
        val = getattr(body, field)
        if val is not None:
            setattr(o, field, val)
    _bump(o)
    service.write_audit(db, o.tenant_id, entity="obligation", action="update", entity_id=o.id, actor_id=user.id)
    db.commit()
    return s_obligation(o)


@router.delete("/obligations/{obl_id}")
def delete_obligation(obl_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    o = _get(db, TPRAControlObligation, obl_id, tids)
    rbac.require_write(db, user, "contracts", "delete")
    o.deleted_at = datetime.utcnow()
    _bump(o)
    service.write_audit(db, o.tenant_id, entity="obligation", action="delete", entity_id=o.id, actor_id=user.id)
    db.commit()
    return {"deleted": True, "id": o.id}


# ── Approvals (append-only) ──────────────────────────────────────────────────

@router.get("/assessments/{assessment_id}/approvals")
def list_approvals(assessment_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    _assessment(db, assessment_id, tids)
    rows = db.query(TPRAApproval).filter(
        TPRAApproval.assessment_id == assessment_id, TPRAApproval.tenant_id.in_(tids)
    ).order_by(TPRAApproval.created_at.desc()).all()
    rec = None
    a = _assessment(db, assessment_id, tids)
    if a.residual_rating is not None:
        rec = service.recommend_decision(a.residual_rating, service.count_open_critical(db, a.id))
    return {"items": [s_approval(x) for x in rows], "total": len(rows), "recommendation": rec}


@router.post("/assessments/{assessment_id}/approvals", status_code=status.HTTP_201_CREATED)
def create_approval(assessment_id: int, body: ApprovalIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    a = _assessment(db, assessment_id, tids)
    rbac.require_write(db, user, "approvals", "approve")
    rec = service.recommend_decision(a.residual_rating or "medium", service.count_open_critical(db, a.id))
    ap = TPRAApproval(
        tenant_id=a.tenant_id, vendor_id=a.vendor_id, assessment_id=a.id,
        decision=body.decision, conditions=body.conditions or [], recommendation=rec,
        rationale=body.rationale, approver_id=user.id, residual_rating=a.residual_rating,
    )
    db.add(ap)
    db.flush()
    service.write_audit(db, a.tenant_id, entity="approval", action="create",
                        vendor_id=a.vendor_id, assessment_id=a.id, entity_id=ap.id, actor_id=user.id,
                        to_value=body.decision, reason=body.rationale)
    db.commit()
    return s_approval(ap)


# ── Monitoring signals ───────────────────────────────────────────────────────

@router.get("/vendors/{vendor_id}/signals")
def list_signals(vendor_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    _vendor(db, vendor_id, tids)
    rows = db.query(TPRAMonitoringSignal).filter(
        TPRAMonitoringSignal.vendor_id == vendor_id, TPRAMonitoringSignal.tenant_id.in_(tids),
        TPRAMonitoringSignal.deleted_at.is_(None),
    ).order_by(TPRAMonitoringSignal.occurred_at.desc()).all()
    return {"items": [s_signal(s) for s in rows], "total": len(rows)}


@router.post("/vendors/{vendor_id}/signals", status_code=status.HTTP_201_CREATED)
def create_signal(vendor_id: int, body: SignalIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    v = _vendor(db, vendor_id, tids)
    rbac.require_write(db, user, "monitoring", "create")
    sig = TPRAMonitoringSignal(
        tenant_id=v.tenant_id, vendor_id=v.id, signal_type=body.signal_type,
        severity=body.severity or "medium", source=body.source, title=body.title, detail=body.detail,
        occurred_at=body.occurred_at or datetime.utcnow(),
    )
    db.add(sig)
    db.flush()
    triggered = None
    if should_trigger_reassessment(sig.signal_type, sig.severity):
        new = service.create_reassessment_version(
            db, v, actor_id=user.id, reason=f"Auto-triggered by {sig.signal_type} signal",
            triggered_signal=sig,
        )
        triggered = new.id
    service.write_audit(db, v.tenant_id, entity="signal", action="create",
                        vendor_id=v.id, entity_id=sig.id, actor_id=user.id, to_value=body.signal_type,
                        extra={"triggered_assessment_id": triggered})
    db.commit()
    return {"signal": s_signal(sig), "triggered_reassessment_id": triggered}


@router.put("/signals/{signal_id}")
def update_signal(signal_id: int, body: SignalUpdate, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    s = _get(db, TPRAMonitoringSignal, signal_id, tids)
    rbac.require_write(db, user, "monitoring", "edit")
    _check_concurrency(s, body.row_version)
    for field in ("severity", "title", "detail", "acknowledged"):
        val = getattr(body, field)
        if val is not None:
            setattr(s, field, val)
    _bump(s)
    service.write_audit(db, s.tenant_id, entity="signal", action="update", vendor_id=s.vendor_id, entity_id=s.id, actor_id=user.id)
    db.commit()
    return s_signal(s)


@router.delete("/signals/{signal_id}")
def delete_signal(signal_id: int, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    tids = _tids(user, db)
    s = _get(db, TPRAMonitoringSignal, signal_id, tids)
    rbac.require_write(db, user, "monitoring", "delete")
    s.deleted_at = datetime.utcnow()
    _bump(s)
    service.write_audit(db, s.tenant_id, entity="signal", action="delete", vendor_id=s.vendor_id, entity_id=s.id, actor_id=user.id)
    db.commit()
    return {"deleted": True, "id": s.id}


# ── Per-stage task checklist ─────────────────────────────────────────────────
# Every stage gets an interactive, trackable checklist (seeded in the UI from the
# stage's activities). Replaces the whole array on save — single-analyst editing,
# same shape as the legacy offboarding checklist.

@router.put("/assessments/{assessment_id}/stages/{stage_key}/checklist")
def save_stage_checklist(
    assessment_id: int, stage_key: str, body: ChecklistIn,
    db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
):
    tids = _tids(user, db)
    ensure_tpra_columns(db)
    a = _assessment(db, assessment_id, tids)
    rbac.require_write(db, user, "assessments", "edit")
    if not is_valid_stage(stage_key):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown stage")
    row = db.query(TPRAStageInstance).filter(
        TPRAStageInstance.assessment_id == a.id,
        TPRAStageInstance.stage_key == stage_key,
        TPRAStageInstance.tenant_id.in_(tids),
    ).first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Stage not found")
    row.checklist = [it.model_dump() for it in body.items]
    _bump(row)
    service.write_audit(
        db, a.tenant_id, entity="stage", action="update", vendor_id=a.vendor_id,
        assessment_id=a.id, entity_id=row.id, actor_id=user.id,
        extra={"stage": stage_key, "checklist_items": len(row.checklist)},
    )
    db.commit()
    return s_stage(row)


# ── Assign duties (RACI) — who is Responsible/Accountable/Consulted/Informed ──

@router.put("/assessments/{assessment_id}/stages/{stage_key}/roles")
def save_stage_roles(
    assessment_id: int, stage_key: str, body: RolesIn,
    db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
):
    tids = _tids(user, db)
    a = _assessment(db, assessment_id, tids)
    rbac.require_write(db, user, "assessments", "edit")
    if not is_valid_stage(stage_key):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown stage")
    row = db.query(TPRAStageInstance).filter(
        TPRAStageInstance.assessment_id == a.id,
        TPRAStageInstance.stage_key == stage_key,
        TPRAStageInstance.tenant_id.in_(tids),
    ).first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Stage not found")
    row.assigned_roles = [
        {"role": r.role, "user_id": r.user_id}
        for r in body.assigned_roles if r.role in ("R", "A", "C", "I")
    ]
    _bump(row)
    service.write_audit(
        db, a.tenant_id, entity="stage", action="update", vendor_id=a.vendor_id,
        assessment_id=a.id, entity_id=row.id, actor_id=user.id,
        extra={"stage": stage_key, "roles": len(row.assigned_roles)},
    )
    db.commit()
    return s_stage(row)


# ── Assessment team roster (RACI, assigned once) ─────────────────────────────
# Duties are assigned once at the assessment level and reused across every stage,
# rather than re-entered per stage. {role_key: user_id}.

@router.put("/assessments/{assessment_id}/team")
def save_team(
    assessment_id: int, body: TeamIn,
    db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
):
    tids = _tids(user, db)
    ensure_tpra_columns(db)
    a = _assessment(db, assessment_id, tids)
    rbac.require_write(db, user, "assessments", "edit")
    clean = {}
    for k, v in (body.roster or {}).items():
        try:
            uid = int(v)
        except (TypeError, ValueError):
            continue
        if uid:
            clean[str(k)] = uid
    a.team_roster = clean
    service.write_audit(
        db, a.tenant_id, entity="assessment", action="update", vendor_id=a.vendor_id,
        assessment_id=a.id, entity_id=a.id, actor_id=user.id, reason="team roster updated",
        extra={"roles": len(clean)},
    )
    db.commit()
    return {"assessment_id": a.id, "team_roster": a.team_roster}


# ── Due-Diligence Planning: persist the assessment plan ──────────────────────
# Sets the questionnaire template + reviewer (+ due date) on the assessment so the
# dd_planning exit criteria (template selected, reviewer assigned) can be met.

@router.post("/assessments/{assessment_id}/plan")
def save_plan(
    assessment_id: int, body: PlanIn,
    db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
):
    tids = _tids(user, db)
    a = _assessment(db, assessment_id, tids)
    rbac.require_write(db, user, "assessments", "edit")
    if body.template_id is not None:
        a.template_id = body.template_id
    if body.reviewed_by is not None:
        a.reviewed_by = body.reviewed_by
    if body.due_date is not None:
        a.due_date = body.due_date
    service.write_audit(
        db, a.tenant_id, entity="assessment", action="update", vendor_id=a.vendor_id,
        assessment_id=a.id, entity_id=a.id, actor_id=user.id, reason="dd_planning plan saved",
    )
    db.commit()
    return {
        "assessment_id": a.id, "template_id": a.template_id,
        "reviewed_by": a.reviewed_by, "due_date": a.due_date,
    }


# ── Per-vendor audit timeline (TPRM-010) ─────────────────────────────────────
# Surfaces the module's own mutation audit (grc_tpra_audit_log) filtered to one
# vendor, so a per-vendor change history is visible in-context (not only the
# admin-wide unified log).

@router.get("/vendors/{vendor_id}/audit")
def vendor_audit(
    vendor_id: int, limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db), user: GRCUser = Depends(require_auth),
):
    tids = _tids(user, db)
    _vendor(db, vendor_id, tids)
    rows = db.query(TPRAAuditLog).filter(
        TPRAAuditLog.vendor_id == vendor_id, TPRAAuditLog.tenant_id.in_(tids),
    ).order_by(TPRAAuditLog.created_at.desc()).limit(limit).all()

    ids = {r.actor_id for r in rows if r.actor_id}
    names: dict = {}
    if ids:
        for u in db.query(GRCUser).filter(GRCUser.id.in_(ids)).all():
            names[u.id] = (
                getattr(u, "full_name", None) or getattr(u, "name", None)
                or " ".join(filter(None, [getattr(u, "first_name", None), getattr(u, "last_name", None)])).strip()
                or getattr(u, "email", None) or f"User {u.id}"
            )
    return {
        "items": [{
            "id": r.id, "entity": r.entity, "entity_id": r.entity_id, "action": r.action,
            "actor_id": r.actor_id, "actor_name": names.get(r.actor_id),
            "from_value": r.from_value, "to_value": r.to_value, "reason": r.reason,
            "assessment_id": r.assessment_id, "created_at": r.created_at,
        } for r in rows],
        "total": len(rows),
    }


# ── Admin / Settings — program config (TPRM-006) ─────────────────────────────
# Per-tenant tiering factor weights, tier thresholds and reassessment cadence.
# The engines already read TPRATieringConfig; this exposes read + edit.

_FACTOR_KEYS = ["data_sensitivity", "business_criticality", "system_access", "regulatory_scope", "fourth_party"]
_FACTOR_LABELS = {
    "data_sensitivity": "Data sensitivity", "business_criticality": "Business criticality",
    "system_access": "System access", "regulatory_scope": "Regulatory & geographic scope",
    "fourth_party": "Fourth-party reliance",
}
_TIER_KEYS = ["critical", "high", "medium"]
_CADENCE_KEYS = ["critical", "high", "medium", "low"]


@router.get("/config")
def get_config(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """The tenant's TPRM program config (tiering weights, thresholds, cadence)."""
    from .bootstrap import ensure_tpra_tenant_defaults, get_tiering_config, DEFAULT_TIERING_CONFIG
    tids = _tids(user, db)
    tenant_id = tids[0]
    ensure_tpra_tenant_defaults(db, tenant_id)
    cfg = get_tiering_config(db, tenant_id)
    return {
        "weights": cfg["weights"], "thresholds": cfg["thresholds"], "cadence_days": cfg["cadence_days"],
        "defaults": DEFAULT_TIERING_CONFIG,
        "meta": {
            "factor_keys": _FACTOR_KEYS, "factor_labels": _FACTOR_LABELS,
            "tier_keys": _TIER_KEYS, "cadence_keys": _CADENCE_KEYS,
        },
    }


@router.put("/config")
def put_config(body: ConfigIn, db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    """Update the tenant's tiering config. Weights are normalized to sum 1.0;
    thresholds are clamped to 0..100 and forced descending; cadence ≥ 1 day."""
    from .bootstrap import DEFAULT_TIERING_CONFIG
    tids = _tids(user, db)
    tenant_id = tids[0]
    rbac.require_write(db, user, "config", "edit")

    row = db.query(TPRATieringConfig).filter(
        TPRATieringConfig.tenant_id == tenant_id, TPRATieringConfig.config_key == "default",
    ).first()
    if not row:
        row = TPRATieringConfig(
            tenant_id=tenant_id, config_key="default",
            weights=dict(DEFAULT_TIERING_CONFIG["weights"]),
            thresholds=dict(DEFAULT_TIERING_CONFIG["thresholds"]),
            cadence_days=dict(DEFAULT_TIERING_CONFIG["cadence_days"]), is_active=True,
        )
        db.add(row)
        db.flush()

    def _num(d, k, fallback):
        try:
            return float((d or {}).get(k, fallback))
        except (TypeError, ValueError):
            return float(fallback)

    if body.weights is not None:
        cur = row.weights or DEFAULT_TIERING_CONFIG["weights"]
        w = {k: max(0.0, _num(body.weights, k, cur.get(k, 0))) for k in _FACTOR_KEYS}
        s = sum(w.values()) or 1.0
        row.weights = {k: round(v / s, 4) for k, v in w.items()}   # normalize → sum 1.0

    if body.thresholds is not None:
        cur = row.thresholds or DEFAULT_TIERING_CONFIG["thresholds"]
        crit = min(100.0, max(0.0, _num(body.thresholds, "critical", cur.get("critical", 75))))
        high = min(crit, max(0.0, _num(body.thresholds, "high", cur.get("high", 50))))
        med = min(high, max(0.0, _num(body.thresholds, "medium", cur.get("medium", 25))))
        row.thresholds = {"critical": round(crit, 2), "high": round(high, 2), "medium": round(med, 2)}

    if body.cadence_days is not None:
        cur = row.cadence_days or DEFAULT_TIERING_CONFIG["cadence_days"]
        row.cadence_days = {k: max(1, int(_num(body.cadence_days, k, cur.get(k, 365)))) for k in _CADENCE_KEYS}

    row.row_version = (row.row_version or 1) + 1
    service.write_audit(db, tenant_id, entity="config", action="update", actor_id=user.id,
                        reason="TPRM program config updated")
    db.commit()
    return {"weights": row.weights, "thresholds": row.thresholds, "cadence_days": row.cadence_days}


# ── Compliance framework coverage (TPRM-007b) ────────────────────────────────
# Aggregates the question→framework/control mapping across the questionnaire
# library so compliance-coverage reporting is possible: which frameworks and
# controls the assessment questions actually exercise.

@router.get("/coverage")
def framework_coverage(db: Session = Depends(get_db), user: GRCUser = Depends(require_auth)):
    from ....models import VendorQuestionnaireTemplate
    tids = _tids(user, db)
    templates = db.query(VendorQuestionnaireTemplate).filter(
        VendorQuestionnaireTemplate.tenant_id.in_(tids)
    ).all()

    fw: dict = {}
    total_q = mapped_q = 0
    for t in templates:
        for q in (t.questions or []):
            if not isinstance(q, dict):
                continue
            total_q += 1
            framework = (q.get("framework") or "").strip()
            cref = (q.get("control_ref") or "").strip()
            dom = (q.get("domain") or "").strip()
            if not framework:
                continue
            mapped_q += 1
            e = fw.setdefault(framework, {
                "framework": framework, "questions": 0,
                "controls": set(), "domains": set(), "templates": set(), "evidence_required": 0,
            })
            e["questions"] += 1
            if cref:
                e["controls"].add(cref)
            if dom:
                e["domains"].add(dom)
            e["templates"].add(t.name)
            if q.get("evidence_required"):
                e["evidence_required"] += 1

    items = [{
        "framework": e["framework"], "questions": e["questions"],
        "controls": len(e["controls"]), "control_refs": sorted(e["controls"]),
        "domains": sorted(e["domains"]), "templates": sorted(e["templates"]),
        "evidence_required": e["evidence_required"],
    } for e in fw.values()]
    items.sort(key=lambda x: x["questions"], reverse=True)
    return {
        "items": items,
        "frameworks": len(items),
        "templates": len(templates),
        "total_questions": total_q,
        "mapped_questions": mapped_q,
        "mapping_coverage": round(100 * mapped_q / total_q, 1) if total_q else 0.0,
    }
