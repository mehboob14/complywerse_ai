from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel

from ....models import (
    AuditEngagement, AuditTeamMember, AuditTimeEntry, AuditableEntity,
    AuditFinding, AuditWorkpaper, AuditPlanItem, AuditSamplingRecord, GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/engagements", tags=["Audit - Engagements"])

VALID_STATUSES = ["planning", "fieldwork", "reporting", "follow_up", "closed"]
VALID_TRANSITIONS = {
    "planning": ["fieldwork"],
    "fieldwork": ["reporting"],
    "reporting": ["follow_up", "closed"],
    "follow_up": ["closed"],
}


class EngagementCreate(BaseModel):
    title: str
    description: Optional[str] = None
    engagement_type: Optional[str] = "assurance"
    plan_item_id: Optional[int] = None
    auditable_entity_id: Optional[int] = None
    scope: Optional[str] = None
    objectives: Optional[str] = None
    methodology: Optional[str] = None
    framework_id: Optional[int] = None
    planned_start: Optional[datetime] = None
    planned_end: Optional[datetime] = None
    budget_hours: Optional[float] = 0
    lead_auditor_id: Optional[int] = None


class EngagementUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    scope: Optional[str] = None
    objectives: Optional[str] = None
    methodology: Optional[str] = None
    framework_id: Optional[int] = None
    planned_start: Optional[datetime] = None
    planned_end: Optional[datetime] = None
    budget_hours: Optional[float] = None
    lead_auditor_id: Optional[int] = None
    opinion: Optional[str] = None
    opinion_narrative: Optional[str] = None
    risk_rating: Optional[str] = None


class TeamMemberAdd(BaseModel):
    user_id: int
    role: Optional[str] = "auditor"
    skills: Optional[list] = []
    availability_percent: Optional[float] = 100
    conflict_of_interest: Optional[bool] = False
    coi_declaration: Optional[str] = None


class TimeEntryCreate(BaseModel):
    date: datetime
    hours: float
    description: Optional[str] = None
    activity_type: Optional[str] = "fieldwork"
    workpaper_id: Optional[int] = None


class EngagementFromPlanItem(BaseModel):
    plan_item_id: int
    planned_start: Optional[datetime] = None
    planned_end: Optional[datetime] = None
    lead_auditor_id: Optional[int] = None


class StatusTransition(BaseModel):
    new_status: str
    notes: Optional[str] = None


def serialize_engagement(e: AuditEngagement) -> dict:
    team = []
    if e.team_members:
        for tm in e.team_members:
            team.append({
                "id": tm.id,
                "user_id": tm.user_id,
                "user_name": (tm.user.display_name or tm.user.username) if tm.user else None,
                "role": tm.role,
                "skills": tm.skills,
                "availability_percent": tm.availability_percent,
                "conflict_of_interest": tm.conflict_of_interest,
            })
    
    return {
        "id": e.id,
        "tenant_id": e.tenant_id,
        "plan_item_id": e.plan_item_id,
        "auditable_entity_id": e.auditable_entity_id,
        "entity_name": e.auditable_entity.name if e.auditable_entity else None,
        "engagement_number": e.engagement_number,
        "title": e.title,
        "description": e.description,
        "engagement_type": e.engagement_type,
        "status": e.status,
        "scope": e.scope,
        "objectives": e.objectives,
        "methodology": e.methodology,
        "framework_id": e.framework_id,
        "framework_name": e.framework.name if e.framework else None,
        "planned_start": e.planned_start.isoformat() if e.planned_start else None,
        "planned_end": e.planned_end.isoformat() if e.planned_end else None,
        "actual_start": e.actual_start.isoformat() if e.actual_start else None,
        "actual_end": e.actual_end.isoformat() if e.actual_end else None,
        "budget_hours": e.budget_hours,
        "actual_hours": e.actual_hours,
        "lead_auditor_id": e.lead_auditor_id,
        "lead_auditor_name": (e.lead_auditor.display_name or e.lead_auditor.username) if e.lead_auditor else None,
        "opinion": e.opinion,
        "opinion_narrative": e.opinion_narrative,
        "risk_rating": e.risk_rating,
        "team_members": team,
        "workpaper_count": len(e.workpapers) if e.workpapers else 0,
        "finding_count": len(e.findings) if e.findings else 0,
        "created_at": e.created_at.isoformat() if e.created_at else None,
        "updated_at": e.updated_at.isoformat() if e.updated_at else None,
    }


@router.get("")
def list_engagements(
    status_filter: Optional[str] = Query(None, alias="status"),
    engagement_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"engagements": [], "total": 0}
    
    query = db.query(AuditEngagement).options(
        joinedload(AuditEngagement.team_members),
        joinedload(AuditEngagement.auditable_entity),
    ).filter(AuditEngagement.tenant_id.in_(user_tenants))
    
    if status_filter:
        query = query.filter(AuditEngagement.status == status_filter)
    if engagement_type:
        query = query.filter(AuditEngagement.engagement_type == engagement_type)
    
    engagements = query.order_by(AuditEngagement.created_at.desc()).all()
    return {"engagements": [serialize_engagement(e) for e in engagements], "total": len(engagements)}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_engagement(
    data: EngagementCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant access")
    
    count = db.query(func.count(AuditEngagement.id)).filter(
        AuditEngagement.tenant_id == tenant_id
    ).scalar() or 0
    eng_number = f"AE-{datetime.utcnow().year}-{count + 1:04d}"
    
    engagement = AuditEngagement(
        tenant_id=tenant_id,
        plan_item_id=data.plan_item_id,
        auditable_entity_id=data.auditable_entity_id,
        engagement_number=eng_number,
        title=data.title,
        description=data.description,
        engagement_type=data.engagement_type,
        scope=data.scope,
        objectives=data.objectives,
        methodology=data.methodology,
        framework_id=data.framework_id,
        planned_start=data.planned_start,
        planned_end=data.planned_end,
        budget_hours=data.budget_hours or 0,
        lead_auditor_id=data.lead_auditor_id,
        created_by_id=current_user.id,
    )
    db.add(engagement)
    db.commit()
    db.refresh(engagement)
    return serialize_engagement(engagement)


@router.post("/from-plan-item", status_code=status.HTTP_201_CREATED)
def create_engagement_from_plan_item(
    data: EngagementFromPlanItem,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant access")
    
    plan_item = db.query(AuditPlanItem).filter(AuditPlanItem.id == data.plan_item_id).first()
    if not plan_item:
        raise HTTPException(status_code=404, detail="Plan item not found")
    
    existing = db.query(AuditEngagement).filter(
        AuditEngagement.plan_item_id == data.plan_item_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"An engagement already exists for this plan item: {existing.title}")
    
    count = db.query(func.count(AuditEngagement.id)).filter(
        AuditEngagement.tenant_id == tenant_id
    ).scalar() or 0
    eng_number = f"AE-{datetime.utcnow().year}-{count + 1:04d}"
    
    entity = None
    if plan_item.auditable_entity_id:
        entity = db.query(AuditableEntity).filter(AuditableEntity.id == plan_item.auditable_entity_id).first()
    
    engagement = AuditEngagement(
        tenant_id=tenant_id,
        plan_item_id=plan_item.id,
        auditable_entity_id=plan_item.auditable_entity_id,
        engagement_number=eng_number,
        title=plan_item.name,
        description=f"Engagement created from audit plan item: {plan_item.name}",
        engagement_type="assurance",
        status="planning",
        scope=f"{plan_item.name} - covering {entity.name}" if entity and entity.name != plan_item.name else f"Audit scope for {plan_item.name}",
        budget_hours=(plan_item.budget_days or 15) * 8,
        lead_auditor_id=data.lead_auditor_id,
        planned_start=data.planned_start,
        planned_end=data.planned_end,
        created_by_id=current_user.id,
    )
    db.add(engagement)
    
    plan_item.status = "in_progress"
    
    db.commit()
    db.refresh(engagement)
    return serialize_engagement(engagement)


@router.post("/from-plan", status_code=status.HTTP_201_CREATED)
def create_engagements_from_plan(
    plan_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    from ....models import AuditPlan
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=403, detail="No tenant access")
    
    plan = db.query(AuditPlan).options(
        joinedload(AuditPlan.items)
    ).filter(AuditPlan.id == plan_id, AuditPlan.tenant_id == tenant_id).first()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")
    
    created = []
    skipped = []
    for item in plan.items:
        existing = db.query(AuditEngagement).filter(
            AuditEngagement.plan_item_id == item.id
        ).first()
        if existing:
            skipped.append({"item_id": item.id, "name": item.name, "reason": "Engagement already exists"})
            continue
        
        count = db.query(func.count(AuditEngagement.id)).filter(
            AuditEngagement.tenant_id == tenant_id
        ).scalar() or 0
        eng_number = f"AE-{datetime.utcnow().year}-{count + 1:04d}"
        
        entity = None
        if item.auditable_entity_id:
            entity = db.query(AuditableEntity).filter(AuditableEntity.id == item.auditable_entity_id).first()
        
        engagement = AuditEngagement(
            tenant_id=tenant_id,
            plan_item_id=item.id,
            auditable_entity_id=item.auditable_entity_id,
            engagement_number=eng_number,
            title=item.name,
            description=f"Engagement created from audit plan: {plan.name}",
            engagement_type="assurance",
            status="planning",
            scope=f"{item.name} - covering {entity.name}" if entity and entity.name != item.name else f"Audit scope for {item.name}",
            budget_hours=(item.budget_days or 15) * 8,
            created_by_id=current_user.id,
        )
        db.add(engagement)
        item.status = "in_progress"
        created.append({"item_id": item.id, "name": item.name})
    
    db.commit()
    return {"created": len(created), "skipped": len(skipped), "details": {"created": created, "skipped": skipped}}


@router.get("/resource-calendar")
def get_resource_calendar(
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"resources": []}
    
    target_year = year or datetime.utcnow().year
    
    team_members = db.query(AuditTeamMember).join(AuditEngagement).filter(
        AuditEngagement.tenant_id.in_(user_tenants),
    ).all()
    
    resource_map = {}
    for tm in team_members:
        uid = tm.user_id
        if uid not in resource_map:
            user_name = (tm.user.display_name or tm.user.username) if tm.user else f"User {uid}"
            resource_map[uid] = {
                "user_id": uid,
                "user_name": user_name,
                "role": tm.role,
                "skills": tm.skills or [],
                "assignments": [],
                "total_allocated_percent": 0,
            }
        
        eng = tm.engagement
        resource_map[uid]["assignments"].append({
            "engagement_id": eng.id,
            "engagement_title": eng.title,
            "status": eng.status,
            "start": eng.planned_start.isoformat() if eng.planned_start else None,
            "end": eng.planned_end.isoformat() if eng.planned_end else None,
            "availability_percent": tm.availability_percent,
        })
        resource_map[uid]["total_allocated_percent"] += tm.availability_percent
    
    resources = list(resource_map.values())
    for r in resources:
        r["capacity_utilization"] = min(r["total_allocated_percent"], 100)
    
    return {"resources": resources, "year": target_year}


@router.get("/{engagement_id}")
def get_engagement(
    engagement_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    eng = db.query(AuditEngagement).options(
        joinedload(AuditEngagement.team_members),
        joinedload(AuditEngagement.workpapers),
        joinedload(AuditEngagement.findings),
        joinedload(AuditEngagement.time_entries),
        joinedload(AuditEngagement.auditable_entity),
    ).filter(
        AuditEngagement.id == engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")
    
    result = serialize_engagement(eng)
    result["time_entries"] = [{
        "id": te.id,
        "user_id": te.user_id,
        "date": te.date.isoformat() if te.date else None,
        "hours": te.hours,
        "description": te.description,
        "activity_type": te.activity_type,
    } for te in eng.time_entries]
    
    return result


@router.put("/{engagement_id}")
def update_engagement(
    engagement_id: int,
    data: EngagementUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    eng = db.query(AuditEngagement).filter(
        AuditEngagement.id == engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")
    
    for field, value in data.dict(exclude_unset=True).items():
        setattr(eng, field, value)
    
    eng.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(eng)
    return serialize_engagement(eng)


@router.post("/{engagement_id}/transition")
def transition_engagement(
    engagement_id: int,
    data: StatusTransition,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    eng = db.query(AuditEngagement).filter(
        AuditEngagement.id == engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")
    
    allowed = VALID_TRANSITIONS.get(eng.status, [])
    if data.new_status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot transition from '{eng.status}' to '{data.new_status}'. Allowed: {allowed}"
        )
    
    eng.status = data.new_status
    if data.new_status == "fieldwork" and not eng.actual_start:
        eng.actual_start = datetime.utcnow()
    elif data.new_status == "closed":
        eng.actual_end = datetime.utcnow()
        if eng.auditable_entity:
            eng.auditable_entity.last_audited_date = datetime.utcnow()
            from datetime import timedelta
            eng.auditable_entity.next_audit_due = datetime.utcnow() + timedelta(
                days=eng.auditable_entity.audit_cycle_months * 30
            )
    
    eng.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(eng)
    return serialize_engagement(eng)


@router.post("/{engagement_id}/team", status_code=status.HTTP_201_CREATED)
def add_team_member(
    engagement_id: int,
    data: TeamMemberAdd,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    eng = db.query(AuditEngagement).filter(
        AuditEngagement.id == engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")
    
    existing = db.query(AuditTeamMember).filter(
        AuditTeamMember.engagement_id == engagement_id,
        AuditTeamMember.user_id == data.user_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="User already on team")
    
    if data.conflict_of_interest:
        if not data.coi_declaration:
            raise HTTPException(status_code=400, detail="Conflict of interest declaration required")
    
    member = AuditTeamMember(
        engagement_id=engagement_id,
        user_id=data.user_id,
        role=data.role,
        skills=data.skills or [],
        availability_percent=data.availability_percent,
        conflict_of_interest=data.conflict_of_interest,
        coi_declaration=data.coi_declaration,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return {
        "id": member.id,
        "user_id": member.user_id,
        "role": member.role,
        "message": "Team member added"
    }


@router.delete("/{engagement_id}/team/{member_id}")
def remove_team_member(
    engagement_id: int,
    member_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    eng = db.query(AuditEngagement).filter(
        AuditEngagement.id == engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")
    
    member = db.query(AuditTeamMember).filter(
        AuditTeamMember.id == member_id,
        AuditTeamMember.engagement_id == engagement_id
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")
    
    db.delete(member)
    db.commit()
    return {"message": "Team member removed"}


@router.post("/{engagement_id}/time-entries", status_code=status.HTTP_201_CREATED)
def add_time_entry(
    engagement_id: int,
    data: TimeEntryCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    eng = db.query(AuditEngagement).filter(
        AuditEngagement.id == engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")
    
    entry = AuditTimeEntry(
        engagement_id=engagement_id,
        user_id=current_user.id,
        workpaper_id=data.workpaper_id,
        date=data.date,
        hours=data.hours,
        description=data.description,
        activity_type=data.activity_type,
    )
    db.add(entry)
    
    eng.actual_hours = (eng.actual_hours or 0) + data.hours
    
    db.commit()
    db.refresh(entry)
    return {"id": entry.id, "hours": entry.hours, "message": "Time entry added"}


@router.delete("/{engagement_id}/time-entries/{entry_id}")
def delete_time_entry(
    engagement_id: int,
    entry_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    eng = db.query(AuditEngagement).filter(
        AuditEngagement.id == engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")

    entry = db.query(AuditTimeEntry).filter(
        AuditTimeEntry.id == entry_id,
        AuditTimeEntry.engagement_id == engagement_id
    ).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Time entry not found")

    is_owner = entry.user_id == current_user.id
    is_lead = eng.lead_auditor_id == current_user.id
    is_admin = getattr(current_user, 'role', '') in ('admin', 'super_admin')
    if not (is_owner or is_lead or is_admin):
        raise HTTPException(status_code=403, detail="Only the entry owner, lead auditor, or admin can delete time entries")

    eng.actual_hours = max(0, (eng.actual_hours or 0) - entry.hours)
    db.delete(entry)
    db.commit()
    return {"message": "Time entry deleted"}


@router.get("/{engagement_id}/sampling-records")
def list_sampling_records(
    engagement_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    eng = db.query(AuditEngagement).filter(
        AuditEngagement.id == engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")

    records = db.query(AuditSamplingRecord).filter(
        AuditSamplingRecord.engagement_id == engagement_id
    ).order_by(AuditSamplingRecord.created_at.desc()).all()

    return {
        "sampling_records": [
            {
                "id": r.id,
                "sampling_type": r.sampling_type,
                "population_size": r.population_size,
                "sample_size": r.sample_size,
                "confidence_level": r.confidence_level,
                "expected_error_rate": r.expected_error_rate,
                "tolerable_error_rate": r.tolerable_error_rate,
                "methodology": r.methodology,
                "interpretation": r.interpretation,
                "sampling_interval": r.sampling_interval,
                "parameters": r.parameters or {},
                "workpaper_id": r.workpaper_id,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in records
        ]
    }


class SamplingRecordCreate(BaseModel):
    sampling_type: str
    population_size: int
    sample_size: int
    confidence_level: float
    expected_error_rate: Optional[float] = None
    tolerable_error_rate: Optional[float] = None
    methodology: Optional[str] = None
    interpretation: Optional[str] = None
    sampling_interval: Optional[float] = None
    parameters: Optional[dict] = {}
    workpaper_id: Optional[int] = None


@router.post("/{engagement_id}/sampling-records", status_code=status.HTTP_201_CREATED)
def save_sampling_record(
    engagement_id: int,
    data: SamplingRecordCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    eng = db.query(AuditEngagement).filter(
        AuditEngagement.id == engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")

    record = AuditSamplingRecord(
        tenant_id=eng.tenant_id,
        engagement_id=engagement_id,
        workpaper_id=data.workpaper_id,
        sampling_type=data.sampling_type,
        population_size=data.population_size,
        sample_size=data.sample_size,
        confidence_level=data.confidence_level,
        expected_error_rate=data.expected_error_rate,
        tolerable_error_rate=data.tolerable_error_rate,
        methodology=data.methodology,
        interpretation=data.interpretation,
        sampling_interval=data.sampling_interval,
        parameters=data.parameters or {},
        created_by_id=current_user.id,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"id": record.id, "message": "Sampling record saved"}


@router.delete("/{engagement_id}/sampling-records/{record_id}")
def delete_sampling_record(
    engagement_id: int,
    record_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    eng = db.query(AuditEngagement).filter(
        AuditEngagement.id == engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")

    record = db.query(AuditSamplingRecord).filter(
        AuditSamplingRecord.id == record_id,
        AuditSamplingRecord.engagement_id == engagement_id
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Sampling record not found")

    db.delete(record)
    db.commit()
    return {"message": "Sampling record deleted"}


@router.get("/{engagement_id}/prior-audits")
def get_prior_audits(
    engagement_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    eng = db.query(AuditEngagement).filter(
        AuditEngagement.id == engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")

    if not eng.auditable_entity_id:
        return {"prior_engagements": [], "entity_name": None}

    entity = db.query(AuditableEntity).filter(
        AuditableEntity.id == eng.auditable_entity_id
    ).first()

    prior_engs = db.query(AuditEngagement).filter(
        AuditEngagement.auditable_entity_id == eng.auditable_entity_id,
        AuditEngagement.id != engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).order_by(AuditEngagement.created_at.desc()).limit(10).all()

    current_findings = db.query(AuditFinding).filter(
        AuditFinding.engagement_id == engagement_id
    ).all()
    current_titles = {f.title.lower().strip() for f in current_findings}

    result = []
    all_prior_findings = []
    for pe in prior_engs:
        findings = db.query(AuditFinding).filter(
            AuditFinding.engagement_id == pe.id
        ).all()
        all_prior_findings.extend(findings)

        severity_dist = {}
        for f in findings:
            sev = f.severity or "unrated"
            severity_dist[sev] = severity_dist.get(sev, 0) + 1

        result.append({
            "id": pe.id,
            "title": pe.title,
            "engagement_number": pe.engagement_number,
            "status": pe.status,
            "opinion": pe.opinion,
            "planned_start": pe.planned_start.isoformat() if pe.planned_start else None,
            "planned_end": pe.planned_end.isoformat() if pe.planned_end else None,
            "actual_start": pe.actual_start.isoformat() if pe.actual_start else None,
            "actual_end": pe.actual_end.isoformat() if pe.actual_end else None,
            "findings_count": len(findings),
            "open_findings": sum(1 for f in findings if f.status in ("open", "in_progress", "pending")),
            "severity_distribution": severity_dist,
            "findings": [
                {
                    "id": f.id,
                    "title": f.title,
                    "severity": f.severity,
                    "status": f.status,
                    "root_cause_category": f.root_cause_category,
                    "is_recurring": f.title.lower().strip() in current_titles,
                }
                for f in findings[:10]
            ],
        })

    recurring_titles = {}
    for f in all_prior_findings:
        key = f.title.lower().strip()
        if key in current_titles:
            if key not in recurring_titles:
                recurring_titles[key] = {"title": f.title, "severity": f.severity, "count": 0}
            recurring_titles[key]["count"] += 1

    overall_severity_dist = {}
    for f in all_prior_findings:
        sev = f.severity or "unrated"
        overall_severity_dist[sev] = overall_severity_dist.get(sev, 0) + 1

    return {
        "prior_engagements": result,
        "entity_name": entity.name if entity else None,
        "recurring_issues": list(recurring_titles.values()),
        "overall_severity_distribution": overall_severity_dist,
    }


@router.delete("/{engagement_id}")
def delete_engagement(
    engagement_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    eng = db.query(AuditEngagement).filter(
        AuditEngagement.id == engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")
    
    db.delete(eng)
    db.commit()
    return {"message": "Engagement deleted"}
