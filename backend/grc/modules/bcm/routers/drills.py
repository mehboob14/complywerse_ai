"""BCM Drills (scheduled tests + incident-triggered invocations), result
capture, and findings that hand off to the Issue/CAPA module."""
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ....models import (
    BcmPlan, BcmDrill, BcmDrillResult, BcmFinding, RiskIncident, Risk,
    GRCUser, get_db,
)
from ....routers.auth_router import require_auth, get_user_tenants, require_tenant_permission
from ._common import (
    DRILL_STATUSES, DRILL_TYPES, SOURCE_TYPES, SEVERITIES,
    get_or_404, audit, get_or_create_settings, severity_at_or_above,
    create_issue_for_finding, create_risk,
    serialize_drill, serialize_result, serialize_finding, is_drill_overdue,
)

router = APIRouter(tags=["BCM - Drills & Findings"])


# ── Schemas ─────────────────────────────────────────────────────────────────
class DrillCreate(BaseModel):
    plan_id: int
    title: str
    drill_type: Optional[str] = "tabletop"
    scenario: Optional[str] = None
    scheduled_date: Optional[datetime] = None
    owner_id: Optional[int] = None
    participants: Optional[list] = None
    source_type: Optional[str] = "scheduled_test"
    linked_incident_id: Optional[int] = None


class DrillUpdate(BaseModel):
    title: Optional[str] = None
    drill_type: Optional[str] = None
    scenario: Optional[str] = None
    scheduled_date: Optional[datetime] = None
    owner_id: Optional[int] = None
    participants: Optional[list] = None
    linked_incident_id: Optional[int] = None


class DrillTransition(BaseModel):
    status: str


class ResultUpsert(BaseModel):
    rto_met: Optional[bool] = None
    rpo_met: Optional[bool] = None
    actual_rto_hours: Optional[int] = None
    actual_rpo_hours: Optional[int] = None
    summary: Optional[str] = None
    evidence_ref_id: Optional[int] = None


class FindingCreate(BaseModel):
    title: str
    description: Optional[str] = None
    severity: Optional[str] = "medium"


class FindingUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None


class FindingLinkRisk(BaseModel):
    risk_id: Optional[int] = None


def _tenant(current_user, db) -> List[int]:
    ids = get_user_tenants(current_user, db)
    if not ids:
        raise HTTPException(status_code=403, detail="User is not associated with any tenant")
    return ids


def _validate_incident(db: Session, tenant_ids: List[int], incident_id: Optional[int]):
    if incident_id is None:
        return
    inc = db.query(RiskIncident).filter(
        RiskIncident.id == incident_id, RiskIncident.tenant_id.in_(tenant_ids)
    ).first()
    if not inc:
        raise HTTPException(status_code=404, detail="Linked incident not found")


# ── Drills ──────────────────────────────────────────────────────────────────
@router.get("/drills")
def list_drills(
    plan_id: Optional[int] = Query(None),
    status_filter: Optional[str] = Query(None),
    source_type: Optional[str] = Query(None),
    drill_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:drills:view")),
):
    tenant_ids = _tenant(current_user, db)
    q = db.query(BcmDrill).filter(BcmDrill.tenant_id.in_(tenant_ids))
    if plan_id:
        q = q.filter(BcmDrill.plan_id == plan_id)
    if source_type and source_type != "all":
        q = q.filter(BcmDrill.source_type == source_type)
    if drill_type and drill_type != "all":
        q = q.filter(BcmDrill.drill_type == drill_type)
    if search:
        q = q.filter(BcmDrill.title.ilike(f"%{search}%"))
    rows = q.order_by(BcmDrill.scheduled_date.desc().nullslast(), BcmDrill.created_at.desc()).all()
    serialized = [serialize_drill(db, d) for d in rows]
    # "overdue" is a derived/effective status — filter on it post-serialize.
    if status_filter and status_filter != "all":
        serialized = [s for s in serialized if s["effective_status"] == status_filter]
    total = len(serialized)
    return {"items": serialized[skip:skip + limit], "total": total, "skip": skip, "limit": limit}


@router.post("/drills", status_code=status.HTTP_201_CREATED)
def create_drill(
    payload: DrillCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:drills:create")),
):
    tenant_ids = _tenant(current_user, db)
    plan = get_or_404(BcmPlan, payload.plan_id, tenant_ids, db, "Plan")
    dtype = payload.drill_type or "tabletop"
    if dtype not in DRILL_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid drill_type. One of {sorted(DRILL_TYPES)}")
    src = payload.source_type or "scheduled_test"
    if src not in SOURCE_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid source_type. One of {sorted(SOURCE_TYPES)}")
    if src == "incident_triggered":
        if not payload.linked_incident_id:
            raise HTTPException(status_code=400, detail="linked_incident_id is required for incident-triggered records")
        _validate_incident(db, tenant_ids, payload.linked_incident_id)
    drill = BcmDrill(
        tenant_id=plan.tenant_id,
        plan_id=plan.id,
        title=payload.title,
        drill_type=dtype,
        scenario=payload.scenario,
        scheduled_date=payload.scheduled_date,
        owner_id=payload.owner_id,
        participants=payload.participants or [],
        status="scheduled",
        source_type=src,
        linked_incident_id=payload.linked_incident_id if src == "incident_triggered" else None,
        created_by=current_user.id,
    )
    db.add(drill)
    db.flush()
    audit(db, tenant_id=drill.tenant_id, user_id=current_user.id, action="create",
          resource_type="bcm_drill", resource_id=drill.id, resource_name=drill.title,
          summary=f'Created {src} "{drill.title}" on plan "{plan.title}"')
    db.commit()
    db.refresh(drill)
    return serialize_drill(db, drill, with_children=True)


@router.get("/drills/{drill_id}")
def get_drill(
    drill_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:drills:view")),
):
    tenant_ids = _tenant(current_user, db)
    drill = get_or_404(BcmDrill, drill_id, tenant_ids, db, "Drill")
    return serialize_drill(db, drill, with_children=True)


@router.put("/drills/{drill_id}")
def update_drill(
    drill_id: int,
    payload: DrillUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:drills:edit")),
):
    tenant_ids = _tenant(current_user, db)
    drill = get_or_404(BcmDrill, drill_id, tenant_ids, db, "Drill")
    data = payload.model_dump(exclude_unset=True)
    if "drill_type" in data and data["drill_type"] not in DRILL_TYPES:
        raise HTTPException(status_code=400, detail="Invalid drill_type")
    if "linked_incident_id" in data and data["linked_incident_id"] is not None:
        _validate_incident(db, tenant_ids, data["linked_incident_id"])
    for k, v in data.items():
        setattr(drill, k, v)
    drill.updated_at = datetime.utcnow()
    audit(db, tenant_id=drill.tenant_id, user_id=current_user.id, action="update",
          resource_type="bcm_drill", resource_id=drill.id, resource_name=drill.title)
    db.commit()
    db.refresh(drill)
    return serialize_drill(db, drill, with_children=True)


@router.post("/drills/{drill_id}/transition")
def transition_drill(
    drill_id: int,
    payload: DrillTransition,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:drills:edit")),
):
    tenant_ids = _tenant(current_user, db)
    drill = get_or_404(BcmDrill, drill_id, tenant_ids, db, "Drill")
    target = (payload.status or "").lower()
    if target not in DRILL_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. One of {sorted(DRILL_STATUSES)}")
    # A drill cannot be Closed without a recorded result.
    if target == "closed":
        has_result = db.query(BcmDrillResult).filter(BcmDrillResult.drill_id == drill.id).first()
        if not has_result:
            raise HTTPException(status_code=400, detail="A drill cannot be closed without a recorded result.")
    before = {"status": drill.status}
    drill.status = target
    if target == "in_progress" and not drill.actual_start:
        drill.actual_start = datetime.utcnow()
    if target in ("completed", "closed") and not drill.actual_end:
        drill.actual_end = datetime.utcnow()
    drill.updated_at = datetime.utcnow()
    audit(db, tenant_id=drill.tenant_id, user_id=current_user.id, action="status_change",
          resource_type="bcm_drill", resource_id=drill.id, resource_name=drill.title,
          summary=f'Drill "{drill.title}" -> {target}', before=before, after={"status": target})
    db.commit()
    db.refresh(drill)
    return serialize_drill(db, drill, with_children=True)


@router.delete("/drills/{drill_id}")
def delete_drill(
    drill_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:drills:delete")),
):
    tenant_ids = _tenant(current_user, db)
    drill = get_or_404(BcmDrill, drill_id, tenant_ids, db, "Drill")
    name = drill.title
    audit(db, tenant_id=drill.tenant_id, user_id=current_user.id, action="delete",
          resource_type="bcm_drill", resource_id=drill.id, resource_name=name)
    db.delete(drill)
    db.commit()
    return {"message": f'Drill "{name}" deleted'}


# ── Result (one per drill; upsert) ──────────────────────────────────────────
@router.post("/drills/{drill_id}/result")
def upsert_result(
    drill_id: int,
    payload: ResultUpsert,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:drills:edit")),
):
    tenant_ids = _tenant(current_user, db)
    drill = get_or_404(BcmDrill, drill_id, tenant_ids, db, "Drill")
    res = db.query(BcmDrillResult).filter(BcmDrillResult.drill_id == drill.id).first()
    is_new = res is None
    if is_new:
        res = BcmDrillResult(tenant_id=drill.tenant_id, drill_id=drill.id)
        db.add(res)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(res, k, v)
    res.recorded_by = current_user.id
    res.recorded_at = datetime.utcnow()
    db.flush()
    audit(db, tenant_id=drill.tenant_id, user_id=current_user.id,
          action="create" if is_new else "update",
          resource_type="bcm_drill_result", resource_id=res.id, resource_name=drill.title,
          summary=f'Recorded result for drill "{drill.title}"')
    db.commit()
    db.refresh(res)
    return serialize_result(db, res)


# ── Findings ────────────────────────────────────────────────────────────────
@router.get("/drills/{drill_id}/findings")
def list_findings(
    drill_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:findings:view")),
):
    tenant_ids = _tenant(current_user, db)
    get_or_404(BcmDrill, drill_id, tenant_ids, db, "Drill")
    rows = db.query(BcmFinding).filter(
        BcmFinding.drill_id == drill_id, BcmFinding.tenant_id.in_(tenant_ids)
    ).order_by(BcmFinding.created_at.asc()).all()
    return {"items": [serialize_finding(db, f) for f in rows], "total": len(rows)}


@router.post("/drills/{drill_id}/findings", status_code=status.HTTP_201_CREATED)
def create_finding(
    drill_id: int,
    payload: FindingCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:findings:create")),
):
    tenant_ids = _tenant(current_user, db)
    drill = get_or_404(BcmDrill, drill_id, tenant_ids, db, "Drill")
    sev = (payload.severity or "medium").lower()
    if sev not in SEVERITIES:
        raise HTTPException(status_code=400, detail=f"Invalid severity. One of {sorted(SEVERITIES)}")
    finding = BcmFinding(
        tenant_id=drill.tenant_id,
        drill_id=drill.id,
        title=payload.title,
        description=payload.description,
        severity=sev,
        created_by=current_user.id,
    )
    db.add(finding)
    db.flush()
    # Auto-create an Issue/CAPA when severity is at/above the tenant threshold.
    settings = get_or_create_settings(db, drill.tenant_id)
    issue_id = None
    if severity_at_or_above(sev, settings.finding_issue_threshold):
        issue_id = create_issue_for_finding(
            db, finding, tenant_id=drill.tenant_id, user_id=current_user.id, drill_title=drill.title
        )
    audit(db, tenant_id=finding.tenant_id, user_id=current_user.id, action="create",
          resource_type="bcm_finding", resource_id=finding.id, resource_name=finding.title,
          summary=(f'Finding "{finding.title}" ({sev})'
                   + (f" -> auto-created issue #{issue_id}" if issue_id else "")))
    db.commit()
    db.refresh(finding)
    return serialize_finding(db, finding)


@router.put("/findings/{finding_id}")
def update_finding(
    finding_id: int,
    payload: FindingUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:findings:edit")),
):
    tenant_ids = _tenant(current_user, db)
    finding = get_or_404(BcmFinding, finding_id, tenant_ids, db, "Finding")
    data = payload.model_dump(exclude_unset=True)
    if "severity" in data and data["severity"] not in SEVERITIES:
        raise HTTPException(status_code=400, detail="Invalid severity")
    for k, v in data.items():
        setattr(finding, k, v)
    finding.updated_at = datetime.utcnow()
    audit(db, tenant_id=finding.tenant_id, user_id=current_user.id, action="update",
          resource_type="bcm_finding", resource_id=finding.id, resource_name=finding.title)
    db.commit()
    db.refresh(finding)
    return serialize_finding(db, finding)


@router.post("/findings/{finding_id}/create-issue")
def create_issue_for_finding_endpoint(
    finding_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:findings:edit")),
):
    """Manually hand a (typically sub-threshold) finding to the Issue/CAPA
    module. No-op if it already has a linked issue."""
    tenant_ids = _tenant(current_user, db)
    finding = get_or_404(BcmFinding, finding_id, tenant_ids, db, "Finding")
    if finding.linked_issue_id:
        raise HTTPException(status_code=400, detail="This finding already has a linked issue.")
    drill = db.query(BcmDrill).filter(BcmDrill.id == finding.drill_id).first()
    issue_id = create_issue_for_finding(
        db, finding, tenant_id=finding.tenant_id, user_id=current_user.id,
        drill_title=drill.title if drill else "",
    )
    if not issue_id:
        raise HTTPException(status_code=502, detail="Could not create an issue (issue automation unavailable).")
    audit(db, tenant_id=finding.tenant_id, user_id=current_user.id, action="link_issue",
          resource_type="bcm_finding", resource_id=finding.id, resource_name=finding.title,
          summary=f"Created issue #{issue_id} for finding")
    db.commit()
    db.refresh(finding)
    return serialize_finding(db, finding)


@router.post("/findings/{finding_id}/link-risk")
def link_finding_risk(
    finding_id: int,
    payload: FindingLinkRisk,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:findings:edit")),
):
    tenant_ids = _tenant(current_user, db)
    finding = get_or_404(BcmFinding, finding_id, tenant_ids, db, "Finding")
    drill = db.query(BcmDrill).filter(BcmDrill.id == finding.drill_id).first()
    if payload.risk_id:
        risk = db.query(Risk).filter(Risk.id == payload.risk_id, Risk.tenant_id.in_(tenant_ids)).first()
        if not risk:
            raise HTTPException(status_code=404, detail="Risk not found")
        finding.linked_risk_id = risk.id
    else:
        risk = create_risk(
            db, tenant_id=finding.tenant_id, user_id=current_user.id,
            title=f"Continuity finding: {finding.title}",
            description=(
                f"Auto-raised from BCM finding #{finding.id} on drill "
                f'"{drill.title if drill else ""}". Severity: {finding.severity}.\n\n'
                f"{finding.description or ''}"
            ),
            severity=finding.severity or "medium",
            owner_id=None,
            source_reference=f"BCM finding #{finding.id}",
        )
        finding.linked_risk_id = risk.id
    finding.updated_at = datetime.utcnow()
    audit(db, tenant_id=finding.tenant_id, user_id=current_user.id, action="link_risk",
          resource_type="bcm_finding", resource_id=finding.id, resource_name=finding.title,
          summary=f"Linked finding to risk #{finding.linked_risk_id}")
    db.commit()
    db.refresh(finding)
    return serialize_finding(db, finding)


@router.delete("/findings/{finding_id}")
def delete_finding(
    finding_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _p: bool = Depends(require_tenant_permission("bcm:findings:delete")),
):
    tenant_ids = _tenant(current_user, db)
    finding = get_or_404(BcmFinding, finding_id, tenant_ids, db, "Finding")
    name = finding.title
    audit(db, tenant_id=finding.tenant_id, user_id=current_user.id, action="delete",
          resource_type="bcm_finding", resource_id=finding.id, resource_name=name)
    db.delete(finding)
    db.commit()
    return {"message": f'Finding "{name}" deleted'}
