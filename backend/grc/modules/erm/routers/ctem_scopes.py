"""CTEM Phase 3 API — scopes + cycles.

Mounted under /erm. Scope CRUD and cycle open/close are decision-bearing
writes: edit-permission gated + audited, and a closed cycle is immutable
(frozen counts + rule + membership hash), the same discipline as CRQM
simulation runs.
"""

import logging
from datetime import datetime

from grc.services.ctem_scopes import CADENCE_DAYS, cycle_deadline
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ....models import (
    AuditLog, CtemScope, CtemCycle, GRCUser, get_db,
)
from ....routers.auth_router import (
    require_auth, get_user_tenants, get_user_primary_tenant, require_tenant_permission,
)
from ....services import ctem_scopes as svc
from ....services import ctem_mobilise as mobilise_svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ctem/scopes", tags=["CTEM - Scopes & Cycles"])

# Reuse the risk-register edit permission — scoping is governance work owned
# by the same roles that curate the register.
_edit = Depends(require_tenant_permission("risks:risk_register:edit"))


class MembershipRule(BaseModel):
    asset_ids: Optional[List[int]] = None
    departments: Optional[List[str]] = None
    asset_types: Optional[List[str]] = None
    name_contains: Optional[str] = None
    # Exposure-based membership: match every internet-facing asset. The scope
    # resolver already honours this key; it was just unreachable from the API, so
    # an "external attack surface" scope (the seam EASM feeds) could not be
    # created. Adding the field lets a client set it.
    internet_facing: Optional[bool] = None


class ScopeBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    business_owner_id: Optional[int] = None
    cadence: Optional[str] = Field(default=None, max_length=50)
    membership_rule: MembershipRule = Field(default_factory=MembershipRule)


class MobiliseBody(BaseModel):
    vulnerability_id: int
    assignee_user_id: int
    # Who must approve the assignment. Defaults to the person clicking Assign.
    approver_user_id: Optional[int] = None


class MobiliseDecisionBody(BaseModel):
    decision: str = Field(..., pattern="^(approve|reject)$")
    comment: Optional[str] = None


def _audit(db, tenant_id, user_id, action, resource_id, detail):
    try:
        db.add(AuditLog(tenant_id=tenant_id, user_id=user_id, action=action,
                        resource_type="ctem_scope", resource_id=resource_id, changes=detail))
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("ctem audit failed (%s)", action)


def _scope_or_404(db, scope_id, user, ) -> CtemScope:
    tenants = get_user_tenants(user, db)
    s = db.query(CtemScope).filter(CtemScope.id == scope_id, CtemScope.tenant_id.in_(tenants)).first()
    if not s:
        raise HTTPException(status_code=404, detail="Scope not found")
    return s


def _valid_cadence(value):
    """Only real cadences pass — the deadline math depends on it. Empty is
    allowed (a scope may run ad hoc); a typo is a 422, never a silent no-op."""
    v = (value or "").strip().lower()
    if not v:
        return None
    if v not in CADENCE_DAYS:
        raise HTTPException(status_code=422,
                            detail=f"cadence must be one of {', '.join(sorted(CADENCE_DAYS))} (or empty)")
    return v


def _scope_dict(db: Session, s: CtemScope, live_counts: bool = False) -> Dict[str, Any]:
    open_cycle = next((c for c in s.cycles if c.status == "open"), None)
    out = {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "business_owner_id": s.business_owner_id,
        "cadence": s.cadence,
        "membership_rule": s.membership_rule or {},
        "is_active": s.is_active,
        "open_cycle_id": open_cycle.id if open_cycle else None,
        # Real cadence deadline: due date for the open cycle, and whether it has
        # been blown. None/False when idle or the scope has no cadence.
        "cycle_due_at": (lambda d: d[0].isoformat() if d[0] else None)(
            cycle_deadline(s.cadence, open_cycle.opened_at if open_cycle else None)),
        "cycle_overdue": cycle_deadline(s.cadence, open_cycle.opened_at if open_cycle else None)[1],
        "cycle_count": len(s.cycles),
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }
    if live_counts:
        asset_ids = svc.resolve_scope_assets(db, s.tenant_id, s.membership_rule)
        out["member_assets"] = len(asset_ids)
        if open_cycle:
            out["live_counts"] = svc.compute_stage_counts(
                db, s.tenant_id, asset_ids, since=open_cycle.opened_at, until=datetime.utcnow())
    return out


def _cycle_dict(c: CtemCycle) -> Dict[str, Any]:
    return {
        "id": c.id,
        "scope_id": c.scope_id,
        "status": c.status,
        "opened_at": c.opened_at.isoformat() if c.opened_at else None,
        "opened_by": c.opened_by,
        "closed_at": c.closed_at.isoformat() if c.closed_at else None,
        "closed_by": c.closed_by,
        # Frozen payload — present only once closed.
        "counts": c.counts,
        "membership_rule_frozen": c.membership_rule_frozen,
        "membership_hash": c.membership_hash,
        "hash_algorithm": c.hash_algorithm,
        "notes": c.notes,
        # Honesty: a closed cycle's counts are verifiable against rule+hash,
        # not re-explorable. Drill-down is only offered on open cycles.
        "drilldown_available": c.status == "open",
    }


# ── scopes ───────────────────────────────────────────────────────────────────

@router.get("")
def list_scopes(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    scopes = db.query(CtemScope).filter(CtemScope.tenant_id == tenant_id).order_by(
        CtemScope.created_at.desc()).all()
    return {"scopes": [_scope_dict(db, s, live_counts=True) for s in scopes]}


@router.post("", status_code=201)
def create_scope(
    body: ScopeBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit,
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if db.query(CtemScope).filter(CtemScope.tenant_id == tenant_id, CtemScope.name == body.name).first():
        raise HTTPException(status_code=409, detail="A scope with this name already exists")
    scope = CtemScope(
        tenant_id=tenant_id, name=body.name, description=body.description,
        business_owner_id=body.business_owner_id, cadence=_valid_cadence(body.cadence),
        membership_rule=body.membership_rule.dict(exclude_none=True),
        created_by=current_user.id,
    )
    db.add(scope)
    db.flush()
    # Creating a scope IS starting its first cycle — the loop begins gated and
    # fresh immediately (no separate "Open cycle" click, no stale history view).
    cycle = CtemCycle(tenant_id=tenant_id, scope_id=scope.id, status="open",
                      opened_at=datetime.utcnow(), opened_by=current_user.id,
                      stage_progress={})
    db.add(cycle)
    db.commit()
    db.refresh(scope)
    _audit(db, tenant_id, current_user.id, "ctem_scope.created", scope.id, {"name": scope.name})
    _audit(db, tenant_id, current_user.id, "ctem_cycle.opened", cycle.id, {"scope_id": scope.id, "auto": True})
    return {"scope": _scope_dict(db, scope, live_counts=True)}


@router.get("/portfolio")
def get_portfolio(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """The redesigned page's data contract — every scope's full command-center
    numbers in ONE call (portfolio band + rail + focused scope), built only from
    the proven services. Fields with no real source (per-scope FAIR, unset owner)
    come back null so the UI shows an honest empty state, never a fake number.
    Declared BEFORE /{scope_id} so 'portfolio' isn't parsed as an id."""
    tenant_id = get_user_primary_tenant(current_user, db)
    return svc.portfolio(db, tenant_id)


@router.get("/{scope_id}")
def get_scope(
    scope_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    s = _scope_or_404(db, scope_id, current_user)
    out = _scope_dict(db, s, live_counts=True)
    out["cycles"] = [_cycle_dict(c) for c in sorted(s.cycles, key=lambda c: c.opened_at, reverse=True)]
    return {"scope": out}


@router.get("/{scope_id}/command-center")
def scope_command_center(
    scope_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Per-scope rollup of the loop's downstream signals — prioritise / validate /
    mobilise / quantify. Read-only; open to any authed tenant member, like the
    scope list. Each card reuses the owning service filtered to this scope's
    findings (the money card is portfolio-wide by necessity — see the service)."""
    s = _scope_or_404(db, scope_id, current_user)
    return svc.command_center(db, s.tenant_id, s)


@router.put("/{scope_id}")
def update_scope(
    scope_id: int,
    body: ScopeBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit,
):
    s = _scope_or_404(db, scope_id, current_user)
    s.name = body.name
    s.description = body.description
    s.business_owner_id = body.business_owner_id
    s.cadence = _valid_cadence(body.cadence)
    s.membership_rule = body.membership_rule.dict(exclude_none=True)
    s.updated_at = datetime.utcnow()
    db.commit()
    _audit(db, s.tenant_id, current_user.id, "ctem_scope.updated", s.id, {"name": s.name})
    return {"scope": _scope_dict(db, s, live_counts=True)}


@router.delete("/{scope_id}", status_code=204)
def delete_scope(
    scope_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit,
):
    """Remove a scope. Open cycles cascade away with it (FK ondelete=CASCADE +
    relationship delete-orphan). A CLOSED cycle is a frozen, immutable governance
    record (see close_cycle) — refuse to delete a scope that owns one so its
    audit trail can't be silently destroyed."""
    s = _scope_or_404(db, scope_id, current_user)
    if any(c.status == "closed" for c in s.cycles):
        raise HTTPException(
            status_code=409,
            detail="This scope has closed (frozen) cycles and cannot be deleted — "
                   "its audit history is immutable.",
        )
    name, tenant_id = s.name, s.tenant_id
    db.delete(s)
    db.commit()
    _audit(db, tenant_id, current_user.id, "ctem_scope.deleted", scope_id, {"name": name})
    return None


# ── cycles ───────────────────────────────────────────────────────────────────

@router.post("/{scope_id}/cycles/open", status_code=201)
def open_cycle(
    scope_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit,
):
    s = _scope_or_404(db, scope_id, current_user)
    if any(c.status == "open" for c in s.cycles):
        raise HTTPException(status_code=409, detail="This scope already has an open cycle")
    cycle = CtemCycle(tenant_id=s.tenant_id, scope_id=s.id, status="open",
                      opened_at=datetime.utcnow(), opened_by=current_user.id)
    db.add(cycle)
    db.commit()
    db.refresh(cycle)
    _audit(db, s.tenant_id, current_user.id, "ctem_cycle.opened", cycle.id, {"scope_id": s.id})
    return {"cycle": _cycle_dict(cycle)}


@router.post("/{scope_id}/stages/{stage}")
def complete_stage(
    scope_id: int,
    stage: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit,
):
    """Gated loop: stamp a stage done on the scope's OPEN cycle. Sequential by
    design — Discover, then Prioritise, and 'dispatch' (the explicit hand-over of
    the validated set to Mobilise). Validate itself is stamped server-side when
    its AI mapping run finishes; it cannot be stamped by hand here."""
    s = _scope_or_404(db, scope_id, current_user)
    if stage == "validate":
        raise HTTPException(status_code=400,
                            detail="Validate completes automatically when the AI mapping run finishes.")
    from grc.services.ctem_scopes import advance_stage
    try:
        out = advance_stage(db, s.tenant_id, s.id, stage, user_id=current_user.id)
    except LookupError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    db.commit()
    _audit(db, s.tenant_id, current_user.id, f"ctem_cycle.stage_{stage}", out["cycle_id"], {"scope_id": s.id})
    return out


@router.post("/cycles/{cycle_id}/close")
def close_cycle(
    cycle_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit,
):
    tenants = get_user_tenants(current_user, db)
    cycle = db.query(CtemCycle).filter(
        CtemCycle.id == cycle_id, CtemCycle.tenant_id.in_(tenants)).first()
    if not cycle:
        raise HTTPException(status_code=404, detail="Cycle not found")
    if cycle.status != "open":
        raise HTTPException(status_code=409, detail="Cycle is already closed — closed cycles are immutable")
    svc.freeze_cycle(db, cycle)
    cycle.status = "closed"
    cycle.closed_at = datetime.utcnow()
    cycle.closed_by = current_user.id
    db.commit()
    db.refresh(cycle)
    _audit(db, cycle.tenant_id, current_user.id, "ctem_cycle.closed", cycle.id,
           {"scope_id": cycle.scope_id, "counts": cycle.counts,
            "membership_hash": cycle.membership_hash, "hash_algorithm": cycle.hash_algorithm})
    return {"cycle": _cycle_dict(cycle)}


# ── mobilise (in-platform workflow assignment) ───────────────────────────────

@router.post("/{scope_id}/mobilise")  # in-platform assign; ServiceNow stays optional
def mobilise_finding(
    scope_id: int,
    body: MobiliseBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit,
):
    """Assign a dangerous finding to a person inside the platform.

    Creates a workflow-engine approval + in-app/email notify. Does not mark
    the finding verified — that stays the Nessus re-scan. ServiceNow tickets
    remain a separate, optional path.
    """
    s = _scope_or_404(db, scope_id, current_user)
    try:
        result = mobilise_svc.mobilise_finding(
            db,
            tenant_id=s.tenant_id,
            scope=s,
            vuln_id=body.vulnerability_id,
            assignee_user_id=body.assignee_user_id,
            approver_user_id=body.approver_user_id,  # optional — no approval gate unless named
            actor_user_id=current_user.id,
        )
    except mobilise_svc.MobiliseError as e:
        raise HTTPException(status_code=e.status_code, detail=e.detail)
    db.commit()
    _audit(db, s.tenant_id, current_user.id, "ctem.finding_mobilised", s.id, {
        "vulnerability_id": body.vulnerability_id,
        "assignee_user_id": body.assignee_user_id,
        "approver_user_id": body.approver_user_id,
        "workflow_instance_id": result.get("workflow_instance_id"),
        "created": result.get("created"),
    })
    return result


@router.post("/{scope_id}/mobilise/approvals/{approval_id}/decision")
def decide_mobilise_approval(
    scope_id: int,
    approval_id: int,
    body: MobiliseDecisionBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _perm: bool = _edit,
):
    """Approve or reject a CTEM in-platform assignment. Same records the
    workflow-engine inbox writes; this route exists so a CTEM owner can decide
    without a separate workflow-engine permission."""
    from ....models import ApprovalRequest

    s = _scope_or_404(db, scope_id, current_user)
    approval = db.query(ApprovalRequest).filter(
        ApprovalRequest.id == approval_id,
        ApprovalRequest.tenant_id == s.tenant_id,
    ).first()
    if not approval:
        raise HTTPException(status_code=404, detail="Approval request not found")
    meta = approval.request_metadata or {}
    if meta.get("kind") != mobilise_svc.KIND or meta.get("scope_id") != s.id:
        raise HTTPException(status_code=404, detail="Approval request not found")
    if approval.status != "pending":
        raise HTTPException(status_code=400, detail="Approval request already decided")
    if approval.approver_user_id and approval.approver_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You are not assigned to this approval request")

    approval.status = "approved" if body.decision == "approve" else "rejected"
    approval.responded_at = datetime.utcnow()
    approval.decision_comment = body.comment
    if approval.approver_user_id is None:
        approval.approver_user_id = current_user.id
    if body.decision == "approve":
        approval.received_approvals = (approval.received_approvals or 0) + 1

    mobilise_svc.apply_approval_decision(db, approval, current_user)
    db.commit()
    _audit(db, s.tenant_id, current_user.id, "ctem.mobilise_decided", s.id, {
        "approval_id": approval.id,
        "decision": approval.status,
        "vulnerability_id": meta.get("vulnerability_id"),
    })
    return {
        "status": approval.status,
        "approval_request_id": approval.id,
        "workflow_instance_id": approval.workflow_instance_id,
    }
