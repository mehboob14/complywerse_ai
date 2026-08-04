"""BCM Plans + Business Impact Analysis (BIA), typed dependencies, and
recovery strategies. All tenant-scoped, permission-gated, and audited."""
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import (
    BcmPlan, BcmBiaRecord, BcmBiaDependency, BcmRecoveryStrategy,
    GRCUser, get_db,
)
from ....routers.auth_router import require_auth, get_user_tenants, require_tenant_permission
from ._common import (
    PLAN_STATUSES, CRITICALITIES, DEPENDENCY_TYPES, EXTERNAL_BCP_STATUSES,
    STRATEGY_TYPES, STRATEGY_STATUSES, TESTING_FREQUENCIES,
    get_or_404, audit, create_risk,
    serialize_plan, serialize_bia, serialize_dependency, serialize_strategy,
)

router = APIRouter(tags=["BCM - Plans & BIA"])


# ── Schemas ─────────────────────────────────────────────────────────────────
class PlanCreate(BaseModel):
    title: str
    description: Optional[str] = None
    business_unit: Optional[str] = None
    document_ref_id: Optional[int] = None
    owner_id: Optional[int] = None
    rto_hours: Optional[int] = None
    rpo_hours: Optional[int] = None
    testing_frequency: Optional[str] = "annual"
    next_review_due: Optional[datetime] = None


class PlanUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    business_unit: Optional[str] = None
    document_ref_id: Optional[int] = None
    owner_id: Optional[int] = None
    rto_hours: Optional[int] = None
    rpo_hours: Optional[int] = None
    testing_frequency: Optional[str] = None
    next_review_due: Optional[datetime] = None


class PlanTransition(BaseModel):
    status: str


class BiaCreate(BaseModel):
    process_name: str
    description: Optional[str] = None
    criticality_rating: Optional[str] = "medium"
    rto_hours: Optional[int] = None
    rpo_hours: Optional[int] = None
    mtpd_hours: Optional[int] = None
    linked_asset_ids: Optional[List[int]] = None


class BiaUpdate(BaseModel):
    process_name: Optional[str] = None
    description: Optional[str] = None
    criticality_rating: Optional[str] = None
    rto_hours: Optional[int] = None
    rpo_hours: Optional[int] = None
    mtpd_hours: Optional[int] = None
    linked_asset_ids: Optional[List[int]] = None


class DependencyCreate(BaseModel):
    dependency_type: str
    name: str
    criticality: Optional[str] = "medium"
    external_bcp_status: Optional[str] = None
    notes: Optional[str] = None


class StrategyCreate(BaseModel):
    strategy_type: str
    description: Optional[str] = None
    activation_procedure_ref: Optional[int] = None


class StrategyUpdate(BaseModel):
    strategy_type: Optional[str] = None
    description: Optional[str] = None
    activation_procedure_ref: Optional[int] = None
    status: Optional[str] = None          # proposed | approved | rejected
    review_comments: Optional[str] = None


class LinkRiskRequest(BaseModel):
    risk_id: Optional[int] = None         # link an existing risk; else create one


def _tenant(current_user, db) -> List[int]:
    ids = get_user_tenants(current_user, db)
    if not ids:
        raise HTTPException(status_code=403, detail="User is not associated with any tenant")
    return ids


def _rto_lt_mtpd(rto: Optional[int], mtpd: Optional[int]):
    if rto is not None and mtpd is not None and rto >= mtpd:
        raise HTTPException(status_code=400, detail="RTO must be shorter than MTPD (rto_hours < mtpd_hours)")


# ── Plans ───────────────────────────────────────────────────────────────────
@router.get("/plans")
def list_plans(
    status_filter: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:plans:view")),
):
    tenant_ids = _tenant(current_user, db)
    q = db.query(BcmPlan).filter(BcmPlan.tenant_id.in_(tenant_ids))
    if status_filter and status_filter != "all":
        q = q.filter(BcmPlan.status == status_filter)
    if search:
        like = f"%{search}%"
        q = q.filter(BcmPlan.title.ilike(like))
    total = q.count()
    items = q.order_by(BcmPlan.updated_at.desc()).offset(skip).limit(limit).all()
    return {"items": [serialize_plan(db, p) for p in items], "total": total, "skip": skip, "limit": limit}


@router.post("/plans", status_code=status.HTTP_201_CREATED)
def create_plan(
    payload: PlanCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:plans:create")),
):
    tenant_ids = _tenant(current_user, db)
    freq = payload.testing_frequency or "annual"
    if freq not in TESTING_FREQUENCIES:
        raise HTTPException(status_code=400, detail=f"Invalid testing_frequency. One of {sorted(TESTING_FREQUENCIES)}")
    plan = BcmPlan(
        tenant_id=tenant_ids[0],
        title=payload.title,
        description=payload.description,
        business_unit=payload.business_unit,
        document_ref_id=payload.document_ref_id,
        owner_id=payload.owner_id,
        rto_hours=payload.rto_hours,
        rpo_hours=payload.rpo_hours,
        testing_frequency=freq,
        next_review_due=payload.next_review_due,
        status="draft",
        created_by=current_user.id,
    )
    db.add(plan)
    db.flush()
    audit(db, tenant_id=plan.tenant_id, user_id=current_user.id, action="create",
          resource_type="bcm_plan", resource_id=plan.id, resource_name=plan.title,
          summary=f'Created BCM plan "{plan.title}"')
    db.commit()
    db.refresh(plan)
    return serialize_plan(db, plan, with_children=True)


@router.get("/plans/{plan_id}")
def get_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:plans:view")),
):
    tenant_ids = _tenant(current_user, db)
    plan = get_or_404(BcmPlan, plan_id, tenant_ids, db, "Plan")
    return serialize_plan(db, plan, with_children=True)


@router.put("/plans/{plan_id}")
def update_plan(
    plan_id: int,
    payload: PlanUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:plans:edit")),
):
    tenant_ids = _tenant(current_user, db)
    plan = get_or_404(BcmPlan, plan_id, tenant_ids, db, "Plan")
    data = payload.model_dump(exclude_unset=True)
    if "testing_frequency" in data and data["testing_frequency"] not in TESTING_FREQUENCIES:
        raise HTTPException(status_code=400, detail="Invalid testing_frequency")
    for k, v in data.items():
        setattr(plan, k, v)
    plan.updated_at = datetime.utcnow()
    audit(db, tenant_id=plan.tenant_id, user_id=current_user.id, action="update",
          resource_type="bcm_plan", resource_id=plan.id, resource_name=plan.title)
    db.commit()
    db.refresh(plan)
    return serialize_plan(db, plan, with_children=True)


@router.post("/plans/{plan_id}/transition")
def transition_plan(
    plan_id: int,
    payload: PlanTransition,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:plans:edit")),
):
    tenant_ids = _tenant(current_user, db)
    plan = get_or_404(BcmPlan, plan_id, tenant_ids, db, "Plan")
    target = (payload.status or "").lower()
    if target not in PLAN_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. One of {sorted(PLAN_STATUSES)}")
    if target == "approved":
        # RTO & RPO must be set before a plan can be Approved.
        if plan.rto_hours is None or plan.rpo_hours is None:
            raise HTTPException(status_code=400, detail="RTO and RPO must be set before the plan can be Approved.")
        plan.approved_by = current_user.id
        plan.approved_date = datetime.utcnow()
    before = {"status": plan.status}
    plan.status = target
    plan.updated_at = datetime.utcnow()
    audit(db, tenant_id=plan.tenant_id, user_id=current_user.id, action="status_change",
          resource_type="bcm_plan", resource_id=plan.id, resource_name=plan.title,
          summary=f'Plan "{plan.title}" -> {target}', before=before, after={"status": target})
    db.commit()
    db.refresh(plan)
    return serialize_plan(db, plan, with_children=True)


@router.delete("/plans/{plan_id}")
def delete_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:plans:delete")),
):
    tenant_ids = _tenant(current_user, db)
    plan = get_or_404(BcmPlan, plan_id, tenant_ids, db, "Plan")
    name = plan.title
    audit(db, tenant_id=plan.tenant_id, user_id=current_user.id, action="delete",
          resource_type="bcm_plan", resource_id=plan.id, resource_name=name)
    db.delete(plan)
    db.commit()
    return {"message": f'Plan "{name}" deleted'}


# ── BIA records ─────────────────────────────────────────────────────────────
@router.get("/plans/{plan_id}/bia")
def list_bia(
    plan_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:bia:view")),
):
    tenant_ids = _tenant(current_user, db)
    get_or_404(BcmPlan, plan_id, tenant_ids, db, "Plan")
    rows = db.query(BcmBiaRecord).filter(
        BcmBiaRecord.plan_id == plan_id, BcmBiaRecord.tenant_id.in_(tenant_ids)
    ).order_by(BcmBiaRecord.created_at.asc()).all()
    return {"items": [serialize_bia(db, b, with_children=True) for b in rows], "total": len(rows)}


@router.post("/plans/{plan_id}/bia", status_code=status.HTTP_201_CREATED)
def create_bia(
    plan_id: int,
    payload: BiaCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:bia:create")),
):
    tenant_ids = _tenant(current_user, db)
    plan = get_or_404(BcmPlan, plan_id, tenant_ids, db, "Plan")
    if payload.criticality_rating and payload.criticality_rating not in CRITICALITIES:
        raise HTTPException(status_code=400, detail="Invalid criticality_rating")
    _rto_lt_mtpd(payload.rto_hours, payload.mtpd_hours)
    bia = BcmBiaRecord(
        tenant_id=plan.tenant_id,
        plan_id=plan.id,
        process_name=payload.process_name,
        description=payload.description,
        criticality_rating=payload.criticality_rating or "medium",
        rto_hours=payload.rto_hours,
        rpo_hours=payload.rpo_hours,
        mtpd_hours=payload.mtpd_hours,
        linked_asset_ids=payload.linked_asset_ids or [],
        created_by=current_user.id,
    )
    db.add(bia)
    db.flush()
    audit(db, tenant_id=bia.tenant_id, user_id=current_user.id, action="create",
          resource_type="bcm_bia", resource_id=bia.id, resource_name=bia.process_name,
          summary=f'Added BIA process "{bia.process_name}" to plan "{plan.title}"')
    db.commit()
    db.refresh(bia)
    return serialize_bia(db, bia, with_children=True)


@router.get("/bia/{bia_id}")
def get_bia(
    bia_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:bia:view")),
):
    tenant_ids = _tenant(current_user, db)
    bia = get_or_404(BcmBiaRecord, bia_id, tenant_ids, db, "BIA record")
    return serialize_bia(db, bia, with_children=True)


@router.put("/bia/{bia_id}")
def update_bia(
    bia_id: int,
    payload: BiaUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:bia:edit")),
):
    tenant_ids = _tenant(current_user, db)
    bia = get_or_404(BcmBiaRecord, bia_id, tenant_ids, db, "BIA record")
    data = payload.model_dump(exclude_unset=True)
    if "criticality_rating" in data and data["criticality_rating"] not in CRITICALITIES:
        raise HTTPException(status_code=400, detail="Invalid criticality_rating")
    new_rto = data.get("rto_hours", bia.rto_hours)
    new_mtpd = data.get("mtpd_hours", bia.mtpd_hours)
    _rto_lt_mtpd(new_rto, new_mtpd)
    for k, v in data.items():
        setattr(bia, k, v)
    bia.updated_at = datetime.utcnow()
    audit(db, tenant_id=bia.tenant_id, user_id=current_user.id, action="update",
          resource_type="bcm_bia", resource_id=bia.id, resource_name=bia.process_name)
    db.commit()
    db.refresh(bia)
    return serialize_bia(db, bia, with_children=True)


@router.delete("/bia/{bia_id}")
def delete_bia(
    bia_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:bia:delete")),
):
    tenant_ids = _tenant(current_user, db)
    bia = get_or_404(BcmBiaRecord, bia_id, tenant_ids, db, "BIA record")
    name = bia.process_name
    audit(db, tenant_id=bia.tenant_id, user_id=current_user.id, action="delete",
          resource_type="bcm_bia", resource_id=bia.id, resource_name=name)
    db.delete(bia)
    db.commit()
    return {"message": f'BIA process "{name}" deleted'}


@router.post("/bia/{bia_id}/link-risk")
def link_bia_risk(
    bia_id: int,
    payload: LinkRiskRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:bia:edit")),
):
    tenant_ids = _tenant(current_user, db)
    bia = get_or_404(BcmBiaRecord, bia_id, tenant_ids, db, "BIA record")
    plan = db.query(BcmPlan).filter(BcmPlan.id == bia.plan_id).first()
    if payload.risk_id:
        from ....models import Risk
        risk = db.query(Risk).filter(Risk.id == payload.risk_id, Risk.tenant_id.in_(tenant_ids)).first()
        if not risk:
            raise HTTPException(status_code=404, detail="Risk not found")
        bia.linked_risk_id = risk.id
    else:
        risk = create_risk(
            db, tenant_id=bia.tenant_id, user_id=current_user.id,
            title=f"Continuity exposure: {bia.process_name}",
            description=(
                f"Auto-raised from BCM BIA #{bia.id} ({bia.process_name}) on plan "
                f'"{plan.title if plan else ""}". Criticality: {bia.criticality_rating}. '
                f"RTO {bia.rto_hours}h / RPO {bia.rpo_hours}h / MTPD {bia.mtpd_hours}h."
            ),
            severity=bia.criticality_rating or "medium",
            owner_id=None,
            source_reference=f"BCM BIA #{bia.id}",
        )
        bia.linked_risk_id = risk.id
    bia.updated_at = datetime.utcnow()
    audit(db, tenant_id=bia.tenant_id, user_id=current_user.id, action="link_risk",
          resource_type="bcm_bia", resource_id=bia.id, resource_name=bia.process_name,
          summary=f"Linked BIA to risk #{bia.linked_risk_id}")
    db.commit()
    db.refresh(bia)
    return serialize_bia(db, bia, with_children=True)


# ── Dependencies ────────────────────────────────────────────────────────────
@router.post("/bia/{bia_id}/dependencies", status_code=status.HTTP_201_CREATED)
def add_dependency(
    bia_id: int,
    payload: DependencyCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:bia:edit")),
):
    tenant_ids = _tenant(current_user, db)
    bia = get_or_404(BcmBiaRecord, bia_id, tenant_ids, db, "BIA record")
    if payload.dependency_type not in DEPENDENCY_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid dependency_type. One of {sorted(DEPENDENCY_TYPES)}")
    if payload.external_bcp_status and payload.external_bcp_status not in EXTERNAL_BCP_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid external_bcp_status")
    # A vendor dependency must declare whether the vendor has its own BCP.
    if payload.dependency_type == "vendor" and not payload.external_bcp_status:
        raise HTTPException(status_code=400, detail="external_bcp_status is required for vendor dependencies")
    dep = BcmBiaDependency(
        tenant_id=bia.tenant_id,
        bia_id=bia.id,
        dependency_type=payload.dependency_type,
        name=payload.name,
        criticality=payload.criticality or "medium",
        external_bcp_status=payload.external_bcp_status,
        notes=payload.notes,
    )
    db.add(dep)
    db.flush()
    audit(db, tenant_id=dep.tenant_id, user_id=current_user.id, action="create",
          resource_type="bcm_dependency", resource_id=dep.id, resource_name=dep.name)
    db.commit()
    db.refresh(dep)
    return serialize_dependency(dep)


@router.put("/dependencies/{dep_id}")
def update_dependency(
    dep_id: int,
    payload: DependencyCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:bia:edit")),
):
    tenant_ids = _tenant(current_user, db)
    dep = get_or_404(BcmBiaDependency, dep_id, tenant_ids, db, "Dependency")
    if payload.dependency_type not in DEPENDENCY_TYPES:
        raise HTTPException(status_code=400, detail="Invalid dependency_type")
    if payload.dependency_type == "vendor" and not payload.external_bcp_status:
        raise HTTPException(status_code=400, detail="external_bcp_status is required for vendor dependencies")
    dep.dependency_type = payload.dependency_type
    dep.name = payload.name
    dep.criticality = payload.criticality or "medium"
    dep.external_bcp_status = payload.external_bcp_status
    dep.notes = payload.notes
    audit(db, tenant_id=dep.tenant_id, user_id=current_user.id, action="update",
          resource_type="bcm_dependency", resource_id=dep.id, resource_name=dep.name)
    db.commit()
    db.refresh(dep)
    return serialize_dependency(dep)


@router.delete("/dependencies/{dep_id}")
def delete_dependency(
    dep_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:bia:delete")),
):
    tenant_ids = _tenant(current_user, db)
    dep = get_or_404(BcmBiaDependency, dep_id, tenant_ids, db, "Dependency")
    audit(db, tenant_id=dep.tenant_id, user_id=current_user.id, action="delete",
          resource_type="bcm_dependency", resource_id=dep.id, resource_name=dep.name)
    db.delete(dep)
    db.commit()
    return {"message": "Dependency deleted"}


# ── Recovery strategies ─────────────────────────────────────────────────────
@router.post("/bia/{bia_id}/recovery-strategies", status_code=status.HTTP_201_CREATED)
def add_strategy(
    bia_id: int,
    payload: StrategyCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:bia:edit")),
):
    tenant_ids = _tenant(current_user, db)
    bia = get_or_404(BcmBiaRecord, bia_id, tenant_ids, db, "BIA record")
    if payload.strategy_type not in STRATEGY_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid strategy_type. One of {sorted(STRATEGY_TYPES)}")
    strat = BcmRecoveryStrategy(
        tenant_id=bia.tenant_id,
        bia_id=bia.id,
        strategy_type=payload.strategy_type,
        description=payload.description,
        activation_procedure_ref=payload.activation_procedure_ref,
        status="proposed",
        created_by=current_user.id,
    )
    db.add(strat)
    # A BIA record is "complete" once it has at least one recovery strategy.
    bia.is_complete = True
    db.flush()
    audit(db, tenant_id=strat.tenant_id, user_id=current_user.id, action="create",
          resource_type="bcm_recovery_strategy", resource_id=strat.id, resource_name=strat.strategy_type)
    db.commit()
    db.refresh(strat)
    return serialize_strategy(db, strat)


@router.put("/recovery-strategies/{strategy_id}")
def update_strategy(
    strategy_id: int,
    payload: StrategyUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:bia:edit")),
):
    tenant_ids = _tenant(current_user, db)
    strat = get_or_404(BcmRecoveryStrategy, strategy_id, tenant_ids, db, "Recovery strategy")
    data = payload.model_dump(exclude_unset=True)
    if "strategy_type" in data and data["strategy_type"] not in STRATEGY_TYPES:
        raise HTTPException(status_code=400, detail="Invalid strategy_type")
    if "status" in data:
        if data["status"] not in STRATEGY_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        if data["status"] == "approved":
            strat.approved_by = current_user.id
            strat.approved_date = datetime.utcnow()
    for k, v in data.items():
        setattr(strat, k, v)
    strat.updated_at = datetime.utcnow()
    audit(db, tenant_id=strat.tenant_id, user_id=current_user.id, action="update",
          resource_type="bcm_recovery_strategy", resource_id=strat.id, resource_name=strat.strategy_type)
    db.commit()
    db.refresh(strat)
    return serialize_strategy(db, strat)


@router.delete("/recovery-strategies/{strategy_id}")
def delete_strategy(
    strategy_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:bia:delete")),
):
    tenant_ids = _tenant(current_user, db)
    strat = get_or_404(BcmRecoveryStrategy, strategy_id, tenant_ids, db, "Recovery strategy")
    bia_id = strat.bia_id
    audit(db, tenant_id=strat.tenant_id, user_id=current_user.id, action="delete",
          resource_type="bcm_recovery_strategy", resource_id=strat.id, resource_name=strat.strategy_type)
    db.delete(strat)
    db.flush()
    # Recompute completeness (a BIA with no strategies is no longer complete).
    remaining = db.query(BcmRecoveryStrategy).filter(BcmRecoveryStrategy.bia_id == bia_id).count()
    bia = db.query(BcmBiaRecord).filter(BcmBiaRecord.id == bia_id).first()
    if bia:
        bia.is_complete = remaining > 0
    db.commit()
    return {"message": "Recovery strategy deleted"}
