"""CTEM Phase 3 API — scopes + cycles.

Mounted under /erm. Scope CRUD and cycle open/close are decision-bearing
writes: edit-permission gated + audited, and a closed cycle is immutable
(frozen counts + rule + membership hash), the same discipline as CRQM
simulation runs.
"""

import logging
from datetime import datetime
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


class ScopeBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    business_owner_id: Optional[int] = None
    cadence: Optional[str] = Field(default=None, max_length=50)
    membership_rule: MembershipRule = Field(default_factory=MembershipRule)


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


def _scope_dict(db: Session, s: CtemScope, live_counts: bool = False) -> Dict[str, Any]:
    open_cycle = next((c for c in s.cycles if c.status == "open"), None)
    out = {
        "id": s.id,
        "name": s.name,
        "description": s.description,
        "business_owner_id": s.business_owner_id,
        "cadence": s.cadence,                 # advisory only; nothing fires on it
        "cadence_is_advisory": True,
        "membership_rule": s.membership_rule or {},
        "is_active": s.is_active,
        "open_cycle_id": open_cycle.id if open_cycle else None,
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
        business_owner_id=body.business_owner_id, cadence=body.cadence,
        membership_rule=body.membership_rule.dict(exclude_none=True),
        created_by=current_user.id,
    )
    db.add(scope)
    db.commit()
    db.refresh(scope)
    _audit(db, tenant_id, current_user.id, "ctem_scope.created", scope.id, {"name": scope.name})
    return {"scope": _scope_dict(db, scope, live_counts=True)}


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
    s.cadence = body.cadence
    s.membership_rule = body.membership_rule.dict(exclude_none=True)
    s.updated_at = datetime.utcnow()
    db.commit()
    _audit(db, s.tenant_id, current_user.id, "ctem_scope.updated", s.id, {"name": s.name})
    return {"scope": _scope_dict(db, s, live_counts=True)}


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
