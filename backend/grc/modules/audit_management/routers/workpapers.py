from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel

from ....models import (
    AuditWorkpaper, AuditProcedure, AuditEngagement,
    GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/workpapers", tags=["Audit - Workpapers"])


class WorkpaperCreate(BaseModel):
    engagement_id: int
    title: str
    description: Optional[str] = None
    workpaper_type: Optional[str] = "test"
    reference_number: Optional[str] = None


class WorkpaperUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    workpaper_type: Optional[str] = None
    conclusion: Optional[str] = None
    review_notes: Optional[str] = None


class ProcedureCreate(BaseModel):
    title: str
    description: Optional[str] = None
    test_type: Optional[str] = "control_test"
    sampling_methodology: Optional[str] = None
    sample_size: Optional[int] = None
    population_size: Optional[int] = None
    control_id: Optional[int] = None
    framework_control_id: Optional[int] = None


class ProcedureUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    result: Optional[str] = None
    result_details: Optional[str] = None
    exceptions_noted: Optional[int] = None
    sampling_methodology: Optional[str] = None
    sample_size: Optional[int] = None
    population_size: Optional[int] = None
    evidence_ids: Optional[list] = None


class SignoffRequest(BaseModel):
    action: str
    notes: Optional[str] = None


def serialize_workpaper(wp: AuditWorkpaper) -> dict:
    procedures = []
    if wp.procedures:
        for p in wp.procedures:
            procedures.append({
                "id": p.id,
                "procedure_number": p.procedure_number,
                "title": p.title,
                "description": p.description,
                "test_type": p.test_type,
                "sampling_methodology": p.sampling_methodology,
                "sample_size": p.sample_size,
                "population_size": p.population_size,
                "result": p.result,
                "result_details": p.result_details,
                "exceptions_noted": p.exceptions_noted,
                "control_id": p.control_id,
                "framework_control_id": p.framework_control_id,
                "evidence_ids": p.evidence_ids,
                "ai_generated": p.ai_generated,
                "performed_by_id": p.performed_by_id,
                "performed_at": p.performed_at.isoformat() if p.performed_at else None,
            })
    
    return {
        "id": wp.id,
        "engagement_id": wp.engagement_id,
        "reference_number": wp.reference_number,
        "title": wp.title,
        "description": wp.description,
        "workpaper_type": wp.workpaper_type,
        "status": wp.status,
        "preparer_id": wp.preparer_id,
        "preparer_name": (wp.preparer.display_name or wp.preparer.username) if wp.preparer else None,
        "reviewer_id": wp.reviewer_id,
        "reviewer_name": (wp.reviewer.display_name or wp.reviewer.username) if wp.reviewer else None,
        "lead_signoff_id": wp.lead_signoff_id,
        "prepared_at": wp.prepared_at.isoformat() if wp.prepared_at else None,
        "reviewed_at": wp.reviewed_at.isoformat() if wp.reviewed_at else None,
        "lead_signoff_at": wp.lead_signoff_at.isoformat() if wp.lead_signoff_at else None,
        "review_notes": wp.review_notes,
        "conclusion": wp.conclusion,
        "procedures": procedures,
        "procedure_count": len(procedures),
        "created_at": wp.created_at.isoformat() if wp.created_at else None,
    }


@router.get("")
def list_workpapers(
    engagement_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"workpapers": [], "total": 0}
    
    query = db.query(AuditWorkpaper).join(AuditEngagement).options(
        joinedload(AuditWorkpaper.procedures)
    ).filter(AuditEngagement.tenant_id.in_(user_tenants))
    
    if engagement_id:
        query = query.filter(AuditWorkpaper.engagement_id == engagement_id)
    if status:
        query = query.filter(AuditWorkpaper.status == status)
    
    workpapers = query.order_by(AuditWorkpaper.created_at.desc()).all()
    return {"workpapers": [serialize_workpaper(wp) for wp in workpapers], "total": len(workpapers)}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_workpaper(
    data: WorkpaperCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    eng = db.query(AuditEngagement).filter(
        AuditEngagement.id == data.engagement_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not eng:
        raise HTTPException(status_code=404, detail="Engagement not found")
    
    count = db.query(AuditWorkpaper).filter(
        AuditWorkpaper.engagement_id == data.engagement_id
    ).count()
    ref_num = data.reference_number or f"WP-{count + 1:03d}"
    
    wp = AuditWorkpaper(
        engagement_id=data.engagement_id,
        reference_number=ref_num,
        title=data.title,
        description=data.description,
        workpaper_type=data.workpaper_type,
        preparer_id=current_user.id,
    )
    db.add(wp)
    db.commit()
    db.refresh(wp)
    return serialize_workpaper(wp)


@router.get("/{workpaper_id}")
def get_workpaper(
    workpaper_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    wp = db.query(AuditWorkpaper).options(
        joinedload(AuditWorkpaper.procedures)
    ).join(AuditEngagement).filter(
        AuditWorkpaper.id == workpaper_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not wp:
        raise HTTPException(status_code=404, detail="Workpaper not found")
    return serialize_workpaper(wp)


@router.put("/{workpaper_id}")
def update_workpaper(
    workpaper_id: int,
    data: WorkpaperUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    wp = db.query(AuditWorkpaper).join(AuditEngagement).filter(
        AuditWorkpaper.id == workpaper_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not wp:
        raise HTTPException(status_code=404, detail="Workpaper not found")
    
    for field, value in data.dict(exclude_unset=True).items():
        setattr(wp, field, value)
    
    wp.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(wp)
    return serialize_workpaper(wp)


@router.post("/{workpaper_id}/signoff")
def signoff_workpaper(
    workpaper_id: int,
    data: SignoffRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    wp = db.query(AuditWorkpaper).join(AuditEngagement).filter(
        AuditWorkpaper.id == workpaper_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not wp:
        raise HTTPException(status_code=404, detail="Workpaper not found")
    
    if data.action == "prepare":
        wp.status = "prepared"
        wp.preparer_id = current_user.id
        wp.prepared_at = datetime.utcnow()
    elif data.action == "review":
        if wp.status != "prepared":
            raise HTTPException(status_code=400, detail="Workpaper must be prepared before review")
        wp.status = "reviewed"
        wp.reviewer_id = current_user.id
        wp.reviewed_at = datetime.utcnow()
        wp.review_notes = data.notes
    elif data.action == "lead_signoff":
        if wp.status != "reviewed":
            raise HTTPException(status_code=400, detail="Workpaper must be reviewed before lead sign-off")
        wp.status = "signed_off"
        wp.lead_signoff_id = current_user.id
        wp.lead_signoff_at = datetime.utcnow()
    elif data.action == "reject":
        wp.status = "draft"
        wp.review_notes = data.notes
    
    wp.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(wp)
    return serialize_workpaper(wp)


@router.post("/{workpaper_id}/procedures", status_code=status.HTTP_201_CREATED)
def add_procedure(
    workpaper_id: int,
    data: ProcedureCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    wp = db.query(AuditWorkpaper).join(AuditEngagement).filter(
        AuditWorkpaper.id == workpaper_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not wp:
        raise HTTPException(status_code=404, detail="Workpaper not found")
    
    count = db.query(AuditProcedure).filter(
        AuditProcedure.workpaper_id == workpaper_id
    ).count()
    
    proc = AuditProcedure(
        workpaper_id=workpaper_id,
        procedure_number=f"P-{count + 1:03d}",
        title=data.title,
        description=data.description,
        test_type=data.test_type,
        sampling_methodology=data.sampling_methodology,
        sample_size=data.sample_size,
        population_size=data.population_size,
        control_id=data.control_id,
        framework_control_id=data.framework_control_id,
    )
    db.add(proc)
    db.commit()
    db.refresh(proc)
    return {"id": proc.id, "procedure_number": proc.procedure_number, "title": proc.title}


@router.put("/{workpaper_id}/procedures/{procedure_id}")
def update_procedure(
    workpaper_id: int,
    procedure_id: int,
    data: ProcedureUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    wp = db.query(AuditWorkpaper).join(AuditEngagement).filter(
        AuditWorkpaper.id == workpaper_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not wp:
        raise HTTPException(status_code=404, detail="Workpaper not found")
    
    proc = db.query(AuditProcedure).filter(
        AuditProcedure.id == procedure_id,
        AuditProcedure.workpaper_id == workpaper_id
    ).first()
    if not proc:
        raise HTTPException(status_code=404, detail="Procedure not found")
    
    for field, value in data.dict(exclude_unset=True).items():
        setattr(proc, field, value)
    
    if data.result:
        proc.performed_by_id = current_user.id
        proc.performed_at = datetime.utcnow()
    
    db.commit()
    db.refresh(proc)
    return {"id": proc.id, "result": proc.result, "message": "Procedure updated"}


@router.delete("/{workpaper_id}")
def delete_workpaper(
    workpaper_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    wp = db.query(AuditWorkpaper).join(AuditEngagement).filter(
        AuditWorkpaper.id == workpaper_id,
        AuditEngagement.tenant_id.in_(user_tenants)
    ).first()
    if not wp:
        raise HTTPException(status_code=404, detail="Workpaper not found")
    
    db.delete(wp)
    db.commit()
    return {"message": "Workpaper deleted"}
