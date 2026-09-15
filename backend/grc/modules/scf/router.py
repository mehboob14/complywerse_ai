"""SCF scope & applicability API — mounted at /scf."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from grc.models import GRCUser, SCFAuditPeriod, SCFControlState, SCFScope, get_db
from grc.routers.auth_router import (
    get_user_primary_tenant,
    require_auth,
    require_tenant_permission,
)
from grc.modules.scf import applicability as appl
from grc.modules.scf import assurance as asr
from grc.modules.scf import custom_controls as custom
from grc.modules.scf import ownership as own
from grc.modules.scf import registry
from grc.modules.scf import scope_service
from grc.rich_audit import write_rich_audit_log

router = APIRouter(prefix="/scf", tags=["SCF"])

_require_fw_write = require_tenant_permission("compliance:frameworks:*")
_require_assign = require_tenant_permission("controls:controls:assign")
_require_cl_create = require_tenant_permission("controls:control_library:create")
_require_cl_edit = require_tenant_permission("controls:control_library:edit")


# ── schemas ──────────────────────────────────────────────────────────────────

class ScopeUpdateBody(BaseModel):
    name: Optional[str] = None
    framework_slugs: Optional[List[str]] = None
    framework_obligations: Optional[Dict[str, str]] = None
    baseline_keys: Optional[List[str]] = None
    esp_level: Optional[int] = None
    firm_size: Optional[int] = None
    has_facilities: Optional[bool] = None
    processes_personal_data: Optional[bool] = None
    target_cmm: Optional[int] = None
    scope_statement: Optional[str] = None
    business_unit_ids: Optional[List[Any]] = None
    locations: Optional[List[Any]] = None


class ApplicabilityBody(BaseModel):
    is_applicable: bool
    reason: str = ""


class ApplicabilityReviewBody(BaseModel):
    approve: bool
    comment: Optional[str] = None


class OwnershipBody(BaseModel):
    owner_user_id: Optional[int] = None
    reviewer_user_id: Optional[int] = None
    assigned_user_ids: Optional[List[int]] = None


class BulkOwnershipBody(BaseModel):
    scf_ids: Optional[List[str]] = None
    domain: Optional[str] = None
    owner_user_id: int
    assigned_user_ids: Optional[List[int]] = None


class CustomControlCreateBody(BaseModel):
    code: str
    name: str
    statement: Optional[str] = None
    domain: Optional[str] = None
    pptdf: Optional[str] = None
    conformity_cadence: Optional[str] = None
    control_sub_type: Optional[str] = None
    parsed_control_ids: Optional[List[int]] = None
    implements_scf_ids: Optional[List[str]] = None


class CustomControlUpdateBody(BaseModel):
    name: Optional[str] = None
    statement: Optional[str] = None
    domain: Optional[str] = None
    pptdf: Optional[str] = None
    conformity_cadence: Optional[str] = None
    control_sub_type: Optional[str] = None


class CustomControlMappingsBody(BaseModel):
    parsed_control_ids: Optional[List[int]] = None
    implements_scf_ids: Optional[List[str]] = None


class CustomControlChecksBody(BaseModel):
    check_ids: List[str] = []


class AuditPeriodCreateBody(BaseModel):
    name: str
    period_start: str
    period_end: str
    framework_slug: Optional[str] = None
    scope_id: Optional[int] = None


def _scope_out(scope: SCFScope) -> Dict[str, Any]:
    return {
        "id": scope.id,
        "tenant_id": scope.tenant_id,
        "name": scope.name,
        "release_id": scope.release_id,
        "parent_id": scope.parent_id,
        "framework_slugs": scope.framework_slugs or [],
        "framework_obligations": scope.framework_obligations or {},
        "baseline_keys": scope.baseline_keys or [],
        "esp_level": scope.esp_level or 0,
        "firm_size": scope.firm_size,
        "has_facilities": bool(scope.has_facilities),
        "processes_personal_data": bool(scope.processes_personal_data),
        "target_cmm": scope.target_cmm,
        "scope_statement": scope.scope_statement,
        "business_unit_ids": scope.business_unit_ids or [],
        "locations": scope.locations or [],
        "is_default": bool(scope.is_default),
        "created_at": scope.created_at.isoformat() if scope.created_at else None,
        "updated_at": scope.updated_at.isoformat() if scope.updated_at else None,
    }


def _get_scope_or_404(db: Session, tenant_id: int, scope_id: int) -> SCFScope:
    scope = (
        db.query(SCFScope)
        .filter(SCFScope.id == scope_id, SCFScope.tenant_id == tenant_id)
        .first()
    )
    if scope is None:
        raise HTTPException(404, "Scope not found")
    return scope


def _state_out(state: SCFControlState) -> Dict[str, Any]:
    return {
        "scf_id": state.scf_id,
        "scope_id": state.scope_id,
        "owner_user_id": state.owner_user_id,
        "reviewer_user_id": state.reviewer_user_id,
        "assigned_user_ids": list(state.assigned_user_ids or []),
        "next_due_at": state.next_due_at.isoformat() if state.next_due_at else None,
        "ownership_status": own.ownership_status_for(state),
        "status": state.status,
    }


# ── routes ───────────────────────────────────────────────────────────────────

@router.get("/frameworks")
def list_frameworks(current_user: GRCUser = Depends(require_auth)):
    """Crosswalk registry catalog for the scope UI."""
    return {"frameworks": registry.framework_catalog()}


@router.get("/scopes")
def list_scopes(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        scope_service.ensure_default_scope(db, tenant_id)
    except RuntimeError:
        raise HTTPException(503, detail={"status": "not_provisioned"})
    rows = (
        db.query(SCFScope)
        .filter(SCFScope.tenant_id == tenant_id)
        .order_by(SCFScope.is_default.desc(), SCFScope.name)
        .all()
    )
    return {"scopes": [_scope_out(s) for s in rows]}


@router.get("/scopes/default")
def get_default_scope(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        scope = scope_service.ensure_default_scope(db, tenant_id)
    except RuntimeError:
        raise HTTPException(503, detail={"status": "not_provisioned"})
    return _scope_out(scope)


@router.get("/scopes/{scope_id}")
def get_scope(
    scope_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    return _scope_out(_get_scope_or_404(db, tenant_id, scope_id))


@router.put("/scopes/{scope_id}")
def update_scope(
    scope_id: int,
    body: ScopeUpdateBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_fw_write),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    scope = _get_scope_or_404(db, tenant_id, scope_id)
    data = body.model_dump(exclude_unset=True)
    for key, val in data.items():
        setattr(scope, key, val)
    scope.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(scope)
    return {
        **_scope_out(scope),
        "hint": "Scope saved. Call POST /scf/scopes/{id}/recompute?commit=true to refresh applicability.",
    }


@router.post("/scopes/{scope_id}/recompute")
def recompute_scope(
    scope_id: int,
    commit: bool = Query(False),
    sync_journeys: bool = Query(True),
    backfill_links: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_fw_write),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    scope = _get_scope_or_404(db, tenant_id, scope_id)
    if not commit:
        result = appl.diff_recompute(db, scope)
        if result.get("blocked"):
            raise HTTPException(409, detail=result)
        return {"commit": False, **result}

    try:
        result = appl.commit_recompute(db, scope)
    except ValueError as exc:
        raise HTTPException(409, detail=str(exc))

    extras: Dict[str, Any] = {}
    if sync_journeys:
        extras["journeys"] = scope_service.sync_journeys_for_scope(
            db, tenant_id, current_user, scope,
        )
    if backfill_links:
        extras["links"] = scope_service.backfill_normalized_links(db, scope)
    extras["workbench"] = scope_service.sync_workbench_scope(
        db, tenant_id, scope, updated_by=getattr(current_user, "id", None),
    )
    return {"commit": True, **result, **extras}


@router.post("/scopes/{scope_id}/controls/{scf_id}/applicability")
def set_applicability_override(
    scope_id: int,
    scf_id: str,
    body: ApplicabilityBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_fw_write),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    scope = _get_scope_or_404(db, tenant_id, scope_id)
    if not body.is_applicable and not (body.reason or "").strip():
        raise HTTPException(400, "reason is required when marking a control not applicable")

    row = own.ensure_state(db, tenant_id, scope.id, scf_id)
    before = own.state_snapshot(row)
    now = datetime.utcnow()

    # Requested override — materialised on approve; hold the intended value
    # in is_applicable so reviewers see it, status stays pending_review.
    row.is_applicable = body.is_applicable
    row.applicability_source = "override"
    row.applicability_reason = (body.reason or "").strip() or None
    row.status = "pending_review"
    row.requested_by = current_user.id
    row.requested_at = now
    row.reviewed_by = None
    row.reviewed_at = None
    row.review_comment = None
    row.updated_at = now
    db.flush()
    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=current_user.id,
        action="applicability_request",
        resource_type="scf_control_state",
        resource_id=row.id,
        resource_name=scf_id,
        summary=f"Requested applicability override on {scf_id}",
        before=before,
        after=own.state_snapshot(row),
    )
    db.commit()
    db.refresh(row)
    return {
        "scf_id": scf_id,
        "scope_id": scope.id,
        "is_applicable": row.is_applicable,
        "applicability_source": row.applicability_source,
        "reason": row.applicability_reason,
        "status": row.status,
        "requested_by": row.requested_by,
    }


@router.post("/scopes/{scope_id}/controls/{scf_id}/applicability/review")
def review_applicability(
    scope_id: int,
    scf_id: str,
    body: ApplicabilityReviewBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_fw_write),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    scope = _get_scope_or_404(db, tenant_id, scope_id)
    row = (
        db.query(SCFControlState)
        .filter(
            SCFControlState.tenant_id == tenant_id,
            SCFControlState.scope_id == scope.id,
            SCFControlState.scf_id == scf_id,
        )
        .first()
    )
    if row is None:
        raise HTTPException(404, "No applicability decision to review")

    if not appl.can_self_approve(row.requested_by, current_user.id):
        raise HTTPException(
            403,
            "Segregation of duties: reviewer cannot be the same user who requested the override",
        )

    before = own.state_snapshot(row)
    now = datetime.utcnow()
    row.reviewed_by = current_user.id
    row.reviewed_at = now
    row.review_comment = body.comment
    if body.approve:
        # Materialise the requested is_applicable (already on the row).
        row.applicability_source = "override"
        row.status = "approved"
    else:
        # Reject — clear override so next recompute owns the answer again.
        row.is_applicable = None
        row.applicability_source = None
        row.applicability_reason = None
        row.obligation = None
        row.status = "rejected"
    row.updated_at = now
    db.flush()
    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=current_user.id,
        action="applicability_approve" if body.approve else "applicability_reject",
        resource_type="scf_control_state",
        resource_id=row.id,
        resource_name=scf_id,
        summary=f"{'Approved' if body.approve else 'Rejected'} applicability on {scf_id}",
        before=before,
        after=own.state_snapshot(row),
    )
    db.commit()
    db.refresh(row)
    return {
        "scf_id": scf_id,
        "scope_id": scope.id,
        "approve": body.approve,
        "is_applicable": row.is_applicable,
        "status": row.status,
        "reviewed_by": row.reviewed_by,
    }


@router.put("/scopes/{scope_id}/controls/{scf_id}/ownership")
def put_ownership(
    scope_id: int,
    scf_id: str,
    body: OwnershipBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_assign),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    scope = _get_scope_or_404(db, tenant_id, scope_id)
    if (
        body.owner_user_id is None
        and body.reviewer_user_id is None
        and body.assigned_user_ids is None
    ):
        raise HTTPException(400, "Provide owner_user_id, reviewer_user_id, and/or assigned_user_ids")

    state = own.assign_ownership(
        db,
        tenant_id=tenant_id,
        scope=scope,
        scf_id=scf_id,
        owner_user_id=body.owner_user_id,
        reviewer_user_id=body.reviewer_user_id,
        assigned_user_ids=body.assigned_user_ids,
        actor_user_id=current_user.id,
        set_due=True,
    )
    db.commit()
    db.refresh(state)
    return _state_out(state)


@router.post("/scopes/{scope_id}/ownership/bulk")
def bulk_ownership(
    scope_id: int,
    body: BulkOwnershipBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_assign),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    scope = _get_scope_or_404(db, tenant_id, scope_id)
    try:
        result = own.bulk_assign(
            db,
            tenant_id=tenant_id,
            scope=scope,
            owner_user_id=body.owner_user_id,
            actor_user_id=current_user.id,
            scf_ids=body.scf_ids,
            domain=body.domain,
            assigned_user_ids=body.assigned_user_ids,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    db.commit()
    return result


@router.get("/scopes/{scope_id}/controls/{scf_id}/history")
def control_history(
    scope_id: int,
    scf_id: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    _get_scope_or_404(db, tenant_id, scope_id)
    return {"scf_id": scf_id, "events": own.list_history(db, tenant_id, scf_id)}


@router.get("/my-work")
def my_work(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    return own.my_work_queue(db, tenant_id, current_user.id)


@router.get("/scopes/{scope_id}/applicable-ids")
def list_applicable_ids(
    scope_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    _get_scope_or_404(db, tenant_id, scope_id)
    ids = sorted(scope_service.get_applicable_scf_ids(db, tenant_id, scope_id))
    return {"scope_id": scope_id, "count": len(ids), "scf_ids": ids}


# ── Stage D: custom controls ─────────────────────────────────────────────────

def _custom_out(db: Session, nc) -> Dict[str, Any]:
    data = custom.nc_to_dict(nc)
    data["requirements"] = custom.requirements_for_custom(db, nc)
    return data


@router.post("/custom-controls")
def create_custom_control(
    body: CustomControlCreateBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_cl_create),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        scope = scope_service.ensure_default_scope(db, tenant_id)
    except RuntimeError:
        raise HTTPException(503, detail={"status": "not_provisioned"})
    try:
        nc = custom.create_custom(
            db,
            tenant_id,
            current_user.id,
            code=body.code,
            name=body.name,
            statement=body.statement,
            domain=body.domain,
            pptdf=body.pptdf,
            conformity_cadence=body.conformity_cadence,
            control_sub_type=body.control_sub_type,
            scope=scope,
            parsed_control_ids=body.parsed_control_ids,
            implements_scf_ids=body.implements_scf_ids,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    db.commit()
    db.refresh(nc)
    return _custom_out(db, nc)


@router.get("/custom-controls")
def list_custom_controls(
    include_retired: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    rows = custom.list_custom_for_tenant(db, tenant_id, include_retired=include_retired)
    return {
        "count": len(rows),
        "controls": [_custom_out(db, nc) for nc in rows],
    }


@router.get("/custom-controls/{code}")
def get_custom_control(
    code: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    nc = custom.get_custom(db, tenant_id, code)
    if nc is None:
        raise HTTPException(404, f"Unknown custom control '{code}'")
    out = _custom_out(db, nc)
    try:
        scope = scope_service.ensure_default_scope(db, tenant_id)
        inherited = custom.inherited_requirements_from_scf(
            db, scope.release_id, nc.implements_scf_ids,
        )
        out["requirements"] = custom.merge_requirements(out["requirements"], inherited)
        out["inherited_requirements"] = inherited
    except RuntimeError:
        pass
    return out


@router.put("/custom-controls/{code}")
def update_custom_control(
    code: str,
    body: CustomControlUpdateBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_cl_edit),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    data = body.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(400, "No fields to update")
    try:
        nc = custom.update_custom(
            db, tenant_id, code, current_user.id, **data,
        )
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    db.commit()
    db.refresh(nc)
    return _custom_out(db, nc)


@router.post("/custom-controls/{code}/retire")
def retire_custom_control(
    code: str,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_cl_edit),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        nc = custom.retire_custom(db, tenant_id, code, current_user.id)
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    db.commit()
    db.refresh(nc)
    return _custom_out(db, nc)


@router.put("/custom-controls/{code}/mappings")
def put_custom_control_mappings(
    code: str,
    body: CustomControlMappingsBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_cl_edit),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if body.parsed_control_ids is None and body.implements_scf_ids is None:
        raise HTTPException(400, "Provide parsed_control_ids and/or implements_scf_ids")
    try:
        nc = custom.set_mappings(
            db,
            tenant_id,
            code,
            body.parsed_control_ids,
            body.implements_scf_ids,
            actor_id=current_user.id,
        )
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    db.commit()
    db.refresh(nc)
    return _custom_out(db, nc)


@router.put("/custom-controls/{code}/checks")
def put_custom_control_checks(
    code: str,
    body: CustomControlChecksBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_cl_edit),
):
    """Stage G — bind connector/cloud check ids to a custom control."""
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        nc = custom.set_bound_checks(
            db,
            tenant_id,
            code,
            body.check_ids or [],
            actor_id=current_user.id,
        )
    except LookupError as exc:
        raise HTTPException(404, str(exc))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    db.commit()
    db.refresh(nc)
    return _custom_out(db, nc)


# ── Stage H: assurance & reporting ───────────────────────────────────────────

def _resolve_scope(
    db: Session, tenant_id: int, scope_id: Optional[int],
) -> SCFScope:
    if scope_id is not None:
        return _get_scope_or_404(db, tenant_id, scope_id)
    try:
        return scope_service.ensure_default_scope(db, tenant_id)
    except RuntimeError:
        raise HTTPException(503, detail={"status": "not_provisioned"})


def _get_period_or_404(db: Session, tenant_id: int, period_id: int) -> SCFAuditPeriod:
    row = (
        db.query(SCFAuditPeriod)
        .filter(SCFAuditPeriod.id == period_id, SCFAuditPeriod.tenant_id == tenant_id)
        .first()
    )
    if row is None:
        raise HTTPException(404, "Audit period not found")
    return row


@router.get("/frameworks/{slug}/status")
def framework_status_endpoint(
    slug: str,
    scope_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    scope = _resolve_scope(db, tenant_id, scope_id)
    return asr.framework_status(db, tenant_id, scope, slug)


@router.get("/assurance/summary")
def assurance_summary(
    scope_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    scope = _resolve_scope(db, tenant_id, scope_id)
    slugs = list(scope.framework_slugs or [])
    return {
        "scope_id": scope.id,
        "frameworks": [
            asr.framework_status(db, tenant_id, scope, slug) for slug in slugs
        ],
    }


@router.get("/audit-periods")
def list_audit_periods(
    scope_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    q = db.query(SCFAuditPeriod).filter(SCFAuditPeriod.tenant_id == tenant_id)
    if scope_id is not None:
        q = q.filter(SCFAuditPeriod.scope_id == scope_id)
    rows = q.order_by(SCFAuditPeriod.period_start.desc()).all()
    return {"periods": [asr.period_out(p) for p in rows]}


@router.post("/audit-periods")
def create_audit_period(
    body: AuditPeriodCreateBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_fw_write),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    scope = _resolve_scope(db, tenant_id, body.scope_id)
    try:
        start = asr.parse_date(body.period_start)
        end = asr.parse_date(body.period_end)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    if end < start:
        raise HTTPException(400, "period_end must be on or after period_start")
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "name is required")
    existing = (
        db.query(SCFAuditPeriod)
        .filter(
            SCFAuditPeriod.tenant_id == tenant_id,
            SCFAuditPeriod.scope_id == scope.id,
            SCFAuditPeriod.name == name,
        )
        .first()
    )
    if existing is not None:
        raise HTTPException(409, f"Audit period '{name}' already exists for this scope")
    period = SCFAuditPeriod(
        tenant_id=tenant_id,
        scope_id=scope.id,
        name=name,
        framework_slug=body.framework_slug,
        period_start=start,
        period_end=end,
        release_id=scope.release_id,
        status="open",
    )
    db.add(period)
    db.commit()
    db.refresh(period)
    return asr.period_out(period)


@router.get("/audit-periods/{period_id}")
def get_audit_period(
    period_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    period = _get_period_or_404(db, tenant_id, period_id)
    out = asr.period_out(period)
    if period.soa_snapshot is not None:
        out["soa_snapshot"] = period.soa_snapshot
    return out


@router.post("/audit-periods/{period_id}/freeze")
def freeze_audit_period_endpoint(
    period_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_fw_write),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    period = _get_period_or_404(db, tenant_id, period_id)
    if period.status == "closed":
        raise HTTPException(409, "Cannot freeze a closed audit period")
    asr.freeze_audit_period(db, period, current_user.id)
    db.commit()
    db.refresh(period)
    return asr.period_out(period)


@router.post("/audit-periods/{period_id}/close")
def close_audit_period(
    period_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_fw_write),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    period = _get_period_or_404(db, tenant_id, period_id)
    period.status = "closed"
    db.commit()
    db.refresh(period)
    return asr.period_out(period)


@router.get("/scopes/{scope_id}/soa")
def get_soa(
    scope_id: int,
    format: str = Query("json", pattern="^(json|oscal|xlsx)$"),
    period_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    scope = _get_scope_or_404(db, tenant_id, scope_id)
    if period_id is not None:
        period = _get_period_or_404(db, tenant_id, period_id)
        if period.scope_id != scope.id:
            raise HTTPException(400, "period_id does not belong to this scope")
        if period.soa_snapshot is None:
            raise HTTPException(409, "Audit period has no frozen SoA; call freeze first")
        snapshot = period.soa_snapshot
    else:
        snapshot = asr.build_soa_snapshot(db, tenant_id, scope)

    fmt = (format or "json").lower()
    if fmt == "oscal":
        return asr.soa_oscal_profile(snapshot, scope)
    if fmt == "xlsx":
        data, media, fname = asr.soa_xlsx_bytes(snapshot)
        return Response(
            content=data,
            media_type=media,
            headers={"Content-Disposition": f'attachment; filename="{fname}"'},
        )
    return snapshot


@router.get("/parity")
def parity(
    current_user: GRCUser = Depends(require_auth),
):
    """Static Stage A–H feature checklist (Decision 6 surface)."""
    return asr.parity_checklist()
