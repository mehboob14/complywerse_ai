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
from grc.modules.scf import record_links
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


class CustomControlBase(BaseModel):
    """Everything a tenant authors about a control of its own.

    Same field set as the ERM internal-control register, so a control written
    here carries the register's classification, accountability and dates.
    """

    name: Optional[str] = None
    statement: Optional[str] = None
    domain: Optional[str] = None
    pptdf: Optional[str] = None
    conformity_cadence: Optional[str] = None
    control_sub_type: Optional[str] = None
    # authored guidance — never AI-drafted, never copied from the SCF catalogue
    objective: Optional[str] = None
    implementation_guidance: Optional[str] = None
    testing_guidance: Optional[str] = None
    recommended_evidence: Optional[List[Any]] = None
    # register fields
    category: Optional[str] = None
    sub_category: Optional[str] = None
    control_type: Optional[str] = None
    operating_frequency: Optional[str] = None
    department_id: Optional[int] = None
    backup_owner_id: Optional[int] = None
    regulatory_source: Optional[str] = None
    effective_date: Optional[str] = None
    review_date: Optional[str] = None
    # accountability + work fields (ownership state / control work item)
    owner_user_id: Optional[int] = None
    reviewer_user_id: Optional[int] = None
    assigned_user_ids: Optional[List[int]] = None
    priority: Optional[str] = None
    is_key_control: Optional[bool] = None
    # mappings + cross-module links ({"risk": [1,2], "asset": [7], …})
    parsed_control_ids: Optional[List[int]] = None
    implements_scf_ids: Optional[List[str]] = None
    links: Optional[Dict[str, List[int]]] = None


class CustomControlCreateBody(CustomControlBase):
    #: Omit to have the next CTL-0001 style code allocated.
    code: Optional[str] = None
    name: str
    lifecycle_status: str = "draft"


class CustomControlUpdateBody(CustomControlBase):
    #: Links sent on an edit replace that type's links; types left out are kept.
    pass


class CustomControlLifecycleBody(BaseModel):
    action: str
    comment: Optional[str] = None


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
    before = {key: getattr(scope, key) for key in data}
    for key, val in data.items():
        setattr(scope, key, val)
    scope.updated_at = datetime.utcnow()
    changed = {k: v for k, v in data.items() if before.get(k) != v}
    if changed:
        write_rich_audit_log(
            db=db, tenant_id=tenant_id, user_id=current_user.id, action="scope_update",
            resource_type="scf_scope", resource_id=scope.id, resource_name=scope.name or "Default scope",
            resource_url="/automation/soc2-controls?configure=scope",
            summary="Updated the controls scope: " + ", ".join(k.replace("_", " ") for k in changed),
            before={k: before.get(k) for k in changed}, after=changed,
        )
    db.commit()
    db.refresh(scope)
    return {
        **_scope_out(scope),
        "hint": "Scope saved. Call POST /scf/scopes/{id}/recompute?commit=true to refresh applicability.",
    }


@router.post("/scopes/{scope_id}/preview")
def preview_scope(
    scope_id: int,
    body: ScopeUpdateBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_fw_write),
):
    """What applying these answers would change, without saving them.

    Previewing through recompute needed the answers saved first, and a dialog
    closed after a preview left a saved scope that no control list reflected.
    """
    tenant_id = get_user_primary_tenant(current_user, db)
    scope = _get_scope_or_404(db, tenant_id, scope_id)
    try:
        for key, val in body.model_dump(exclude_unset=True).items():
            setattr(scope, key, val)
        result = appl.diff_recompute(db, scope)
    finally:
        db.rollback()  # the answers are only borrowed for the diff
    if result.get("blocked"):
        raise HTTPException(409, detail=result)
    return {"commit": False, **result}


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
    added = result.get("added_count", len(result.get("added") or []))
    removed = result.get("removed_count", len(result.get("removed") or []))
    write_rich_audit_log(
        db=db, tenant_id=tenant_id, user_id=current_user.id, action="scope_apply",
        resource_type="scf_scope", resource_id=scope.id, resource_name=scope.name or "Default scope",
        resource_url="/automation/soc2-controls?configure=scope",
        summary=f"Applied the controls scope ({', '.join(scope.framework_slugs or []) or 'no frameworks'}): "
                f"{result.get('applicable_count', '—')} controls apply, {added} added, {removed} removed",
        after={"framework_slugs": list(scope.framework_slugs or []), "applicable_count": result.get("applicable_count"),
               "added": added, "removed": removed},
    )
    db.commit()
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

#: Body fields that belong to the register profile, not the control row.
_PROFILE_KEYS = set(custom.PROFILE_FIELDS)
#: Body fields handled by ownership / the control work item, not the control row.
_WORK_KEYS = {"owner_user_id", "reviewer_user_id", "assigned_user_ids",
              "priority", "is_key_control"}


def _custom_out(db: Session, nc, with_links: bool = True) -> Dict[str, Any]:
    data = custom.nc_to_dict(nc, db)
    data["requirements"] = custom.requirements_for_custom(db, nc)
    # Resolving links costs one query per record type, so the list view asks for
    # counts instead of the rows.
    if with_links:
        data["links"] = record_links.list_links(db, nc.tenant_id, nc.id)
    else:
        data["link_counts"] = record_links.link_counts(db, nc.id)
    return data


def _apply_work_fields(
    db: Session,
    tenant_id: int,
    scope,
    nc,
    data: Dict[str, Any],
    current_user: GRCUser,
) -> None:
    """Owner / reviewer / assignees onto the control state; priority and key-control
    onto the work item the Assurance tab uses, so both views agree."""
    if {"owner_user_id", "reviewer_user_id", "assigned_user_ids"} & set(data):
        own.assign_ownership(
            db, tenant_id=tenant_id, scope=scope, scf_id=nc.scf_id or nc.code,
            owner_user_id=data.get("owner_user_id"),
            reviewer_user_id=data.get("reviewer_user_id"),
            assigned_user_ids=data.get("assigned_user_ids"),
            actor_user_id=getattr(current_user, "id", None),
        )
    if {"priority", "is_key_control"} & set(data):
        from grc.modules.control_library.routers.workbench import (
            _get_or_create_work_item, ensure_tables,
        )

        ensure_tables(db)
        wi = _get_or_create_work_item(db, tenant_id, "normalized", nc.id,
                                      created_by=getattr(current_user, "id", None))
        if wi is not None:
            if data.get("priority"):
                wi.priority = data["priority"]
            if data.get("is_key_control") is not None:
                wi.is_key_control = bool(data["is_key_control"])
            db.flush()


def _apply_links(
    db: Session,
    tenant_id: int,
    nc,
    links: Optional[Dict[str, List[int]]],
    current_user: GRCUser,
    replace: bool,
) -> Dict[str, Any]:
    if not links:
        return {"created": 0, "skipped": []}
    from grc.modules.vendor_risk.tpra.rbac import user_has_any_permission

    # Per type, not per batch: holding erm:risks:edit must not also buy the right
    # to write evidence links.
    for key in links:
        perms = record_links.write_permissions(key)   # ValueError on an unknown type
        if not user_has_any_permission(db, current_user, (*perms, "controls:control_library:edit")):
            raise HTTPException(403, f"Permission denied for linking {key.replace('_', ' ')} records")
    if replace:
        record_links.unlink_all_missing(db, tenant_id, nc, links, getattr(current_user, "id", None))
    return record_links.set_links(db, tenant_id, nc, links, getattr(current_user, "id", None))


@router.post("/custom-controls")
def create_custom_control(
    body: CustomControlCreateBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_cl_create),
):
    """Author a control, its register profile, its mappings and its links in one call."""
    tenant_id = get_user_primary_tenant(current_user, db)
    try:
        scope = scope_service.ensure_default_scope(db, tenant_id)
    except RuntimeError:
        raise HTTPException(503, detail={"status": "not_provisioned"})
    data = body.model_dump(exclude_unset=True)
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
            objective=body.objective,
            implementation_guidance=body.implementation_guidance,
            testing_guidance=body.testing_guidance,
            recommended_evidence=body.recommended_evidence,
            profile={k: v for k, v in data.items() if k in _PROFILE_KEYS},
            lifecycle_status=body.lifecycle_status,
        )
        _apply_work_fields(db, tenant_id, scope, nc, data, current_user)
        linked = _apply_links(db, tenant_id, nc, body.links, current_user, replace=False)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))
    except HTTPException:
        db.rollback()
        raise
    db.commit()
    db.refresh(nc)
    return {**_custom_out(db, nc), "links_created": linked["created"],
            "links_skipped": linked["skipped"]}


@router.get("/custom-controls/options")
def custom_control_options(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Vocabularies and departments for the custom-control form."""
    from grc.models import BusinessUnit

    tenant_id = get_user_primary_tenant(current_user, db)
    departments = (db.query(BusinessUnit)
                   .filter(BusinessUnit.tenant_id == tenant_id)
                   .order_by(BusinessUnit.name).all())
    return {
        "categories": [{"value": k, "sub_categories": v}
                       for k, v in custom.CONTROL_CATEGORIES.items()],
        "control_types": sorted(custom.VALID_CONTROL_TYPE),
        "control_sub_types": sorted(custom.VALID_SUB_TYPE),
        "operating_frequencies": [
            "continuous", "daily", "weekly", "monthly", "quarterly", "annually", "ad_hoc",
        ],
        "conformity_cadences": sorted(custom.VALID_CADENCE),
        "pptdf": sorted(custom.VALID_PPTDF),
        "priorities": ["low", "medium", "high", "critical"],
        "lifecycle_statuses": sorted(custom.VALID_LIFECYCLE),
        "lifecycle_actions": {
            action: {"from": list(rule[0]), "to": rule[1]}
            for action, rule in custom.LIFECYCLE_ACTIONS.items()
        },
        "departments": [{"id": d.id, "name": d.name} for d in departments],
        "link_types": record_links.list_types(),
        # What an unnamed control would be called, so a form can show it.
        "next_code": custom.next_custom_code(db, tenant_id),
    }


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
        "controls": [_custom_out(db, nc, with_links=False) for nc in rows],
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
        # Apply the same reviewer decisions the control views apply, so a
        # suppressed or retargeted mapping does not reappear here.
        from grc.modules.automation.router import _mapping_reviews

        suppressed, retargets = _mapping_reviews(db, tenant_id)
        inherited = custom.inherited_requirements_from_scf(
            db, scope.release_id, nc.implements_scf_ids, suppressed, retargets,
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
    mapping_keys = {"parsed_control_ids", "implements_scf_ids"}
    control_fields = {k: v for k, v in data.items()
                      if k not in _PROFILE_KEYS and k not in _WORK_KEYS
                      and k not in mapping_keys and k not in ("links", "recommended_evidence")}
    try:
        nc = custom.update_custom(
            db, tenant_id, code, current_user.id,
            recommended_evidence=data.get("recommended_evidence", None)
            if "recommended_evidence" in data else None,
            profile=({k: v for k, v in data.items() if k in _PROFILE_KEYS}
                     if _PROFILE_KEYS & set(data) else None),
            **control_fields,
        )
        if mapping_keys & set(data):
            custom.set_mappings(
                db, tenant_id, code, data.get("parsed_control_ids"),
                data.get("implements_scf_ids"), actor_id=current_user.id,
            )
        if _WORK_KEYS & set(data):
            scope = scope_service.ensure_default_scope(db, tenant_id)
            _apply_work_fields(db, tenant_id, scope, nc, data, current_user)
        _apply_links(db, tenant_id, nc, data.get("links"), current_user, replace=True)
    except LookupError as exc:
        db.rollback()
        raise HTTPException(404, str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))
    except HTTPException:
        db.rollback()
        raise
    db.commit()
    db.refresh(nc)
    return _custom_out(db, nc)


@router.post("/custom-controls/{code}/lifecycle")
def set_custom_control_lifecycle(
    code: str,
    body: CustomControlLifecycleBody,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(_require_cl_edit),
):
    """Submit for approval, approve, reject, activate or deactivate."""
    tenant_id = get_user_primary_tenant(current_user, db)
    if body.action in ("approve", "reject"):
        from grc.modules.vendor_risk.tpra.rbac import user_has_any_permission

        if not user_has_any_permission(
            db, current_user, ("controls:controls:approve", "controls:control_library:edit"),
        ):
            raise HTTPException(403, "Permission denied")
    try:
        custom.set_lifecycle(db, tenant_id, code, current_user.id, body.action, body.comment)
    except LookupError as exc:
        db.rollback()
        raise HTTPException(404, str(exc))
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))
    db.commit()
    nc = custom.get_custom(db, tenant_id, code)
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
    db.flush()
    write_rich_audit_log(
        db=db, tenant_id=tenant_id, user_id=current_user.id, action="audit_period_create",
        resource_type="scf_audit_period", resource_id=period.id, resource_name=name,
        resource_url="/automation/assurance",
        summary=f"Opened audit period {name} ({start:%Y-%m-%d} to {end:%Y-%m-%d})",
    )
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
    write_rich_audit_log(
        db=db, tenant_id=tenant_id, user_id=current_user.id, action="audit_period_freeze",
        resource_type="scf_audit_period", resource_id=period.id, resource_name=period.name,
        resource_url="/automation/assurance", summary=f"Froze the statement of applicability for {period.name}",
    )
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
    write_rich_audit_log(
        db=db, tenant_id=tenant_id, user_id=current_user.id, action="audit_period_close",
        resource_type="scf_audit_period", resource_id=period.id, resource_name=period.name,
        resource_url="/automation/assurance", summary=f"Closed audit period {period.name}",
    )
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
