from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from typing import List, Optional
from pydantic import BaseModel
from models import (get_db, Phase, PhaseTask, PhaseDeliverable, 
                   Requirement, SubRequirement, EvidenceItem, Finding, Risk)

router = APIRouter(prefix="/api", tags=["PCI DSS Lifecycle"])


class TaskResponse(BaseModel):
    id: int
    name: str
    is_complete: bool
    class Config:
        from_attributes = True


class DeliverableResponse(BaseModel):
    id: int
    name: str
    class Config:
        from_attributes = True


class PhaseResponse(BaseModel):
    id: int
    phase_number: int
    name: str
    description: Optional[str]
    status: str
    is_current: bool
    tasks: List[TaskResponse]
    deliverables: List[DeliverableResponse]
    class Config:
        from_attributes = True


class SubRequirementResponse(BaseModel):
    id: int
    sub_req_number: str
    name: str
    status: str
    evidence_needed: int
    class Config:
        from_attributes = True


class RequirementResponse(BaseModel):
    id: int
    req_number: int
    name: str
    description: Optional[str]
    class Config:
        from_attributes = True


class RequirementWithSubsResponse(BaseModel):
    id: int
    req_number: int
    name: str
    description: Optional[str]
    sub_requirements: List[SubRequirementResponse]
    compliant_count: int
    total_count: int
    compliance_percentage: float
    class Config:
        from_attributes = True


class EvidenceItemResponse(BaseModel):
    id: int
    name: str
    evidence_type: str
    is_uploaded: bool
    file_name: Optional[str]
    upload_status: Optional[str]
    class Config:
        from_attributes = True


class FindingResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    severity: str
    status: str
    class Config:
        from_attributes = True


class RiskResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    owner: Optional[str]
    status: str
    class Config:
        from_attributes = True


class DashboardStats(BaseModel):
    total_requirements: int
    compliant_requirements: int
    partial_requirements: int
    not_started_requirements: int
    overall_compliance: float
    current_phase: Optional[PhaseResponse]


@router.get("/phases", response_model=List[PhaseResponse])
def get_all_phases(db: Session = Depends(get_db)):
    phases = db.query(Phase).options(
        joinedload(Phase.tasks),
        joinedload(Phase.deliverables)
    ).order_by(Phase.phase_number).all()
    return phases


@router.get("/phases/current", response_model=Optional[PhaseResponse])
def get_current_phase(db: Session = Depends(get_db)):
    phase = db.query(Phase).options(
        joinedload(Phase.tasks),
        joinedload(Phase.deliverables)
    ).filter(Phase.is_current == True).first()
    return phase


@router.get("/phases/{phase_id}", response_model=PhaseResponse)
def get_phase(phase_id: int, db: Session = Depends(get_db)):
    phase = db.query(Phase).options(
        joinedload(Phase.tasks),
        joinedload(Phase.deliverables)
    ).filter(Phase.id == phase_id).first()
    if not phase:
        raise HTTPException(status_code=404, detail="Phase not found")
    return phase


@router.get("/requirements", response_model=List[RequirementWithSubsResponse])
def get_all_requirements(db: Session = Depends(get_db)):
    requirements = db.query(Requirement).options(
        joinedload(Requirement.sub_requirements)
    ).order_by(Requirement.req_number).all()
    
    result = []
    for req in requirements:
        total = len(req.sub_requirements)
        compliant = len([s for s in req.sub_requirements if s.status == "compliant"])
        percentage = (compliant / total * 100) if total > 0 else 0
        
        result.append(RequirementWithSubsResponse(
            id=req.id,
            req_number=req.req_number,
            name=req.name,
            description=req.description,
            sub_requirements=[SubRequirementResponse(
                id=s.id,
                sub_req_number=s.sub_req_number,
                name=s.name,
                status=s.status,
                evidence_needed=s.evidence_needed
            ) for s in req.sub_requirements],
            compliant_count=compliant,
            total_count=total,
            compliance_percentage=round(percentage, 0)
        ))
    
    return result


@router.get("/requirements/{req_id}", response_model=RequirementWithSubsResponse)
def get_requirement(req_id: int, db: Session = Depends(get_db)):
    req = db.query(Requirement).options(
        joinedload(Requirement.sub_requirements)
    ).filter(Requirement.id == req_id).first()
    
    if not req:
        raise HTTPException(status_code=404, detail="Requirement not found")
    
    total = len(req.sub_requirements)
    compliant = len([s for s in req.sub_requirements if s.status == "compliant"])
    percentage = (compliant / total * 100) if total > 0 else 0
    
    return RequirementWithSubsResponse(
        id=req.id,
        req_number=req.req_number,
        name=req.name,
        description=req.description,
        sub_requirements=[SubRequirementResponse(
            id=s.id,
            sub_req_number=s.sub_req_number,
            name=s.name,
            status=s.status,
            evidence_needed=s.evidence_needed
        ) for s in req.sub_requirements],
        compliant_count=compliant,
        total_count=total,
        compliance_percentage=round(percentage, 0)
    )


@router.get("/dashboard/stats", response_model=DashboardStats)
def get_dashboard_stats(db: Session = Depends(get_db)):
    sub_reqs = db.query(SubRequirement).all()
    
    total = len(sub_reqs)
    compliant = len([s for s in sub_reqs if s.status == "compliant"])
    partial = len([s for s in sub_reqs if s.status == "partial"])
    not_started = len([s for s in sub_reqs if s.status == "not_started"])
    
    overall = (compliant / total * 100) if total > 0 else 0
    
    current_phase = db.query(Phase).options(
        joinedload(Phase.tasks),
        joinedload(Phase.deliverables)
    ).filter(Phase.is_current == True).first()
    
    return DashboardStats(
        total_requirements=total,
        compliant_requirements=compliant,
        partial_requirements=partial,
        not_started_requirements=not_started,
        overall_compliance=round(overall, 1),
        current_phase=current_phase
    )


@router.get("/findings", response_model=List[FindingResponse])
def get_all_findings(db: Session = Depends(get_db)):
    findings = db.query(Finding).order_by(Finding.created_at.desc()).all()
    return findings


@router.get("/risks", response_model=List[RiskResponse])
def get_all_risks(db: Session = Depends(get_db)):
    risks = db.query(Risk).order_by(Risk.created_at.desc()).all()
    return risks


@router.patch("/sub-requirements/{sub_req_id}/status")
def update_sub_requirement_status(sub_req_id: int, status: str, db: Session = Depends(get_db)):
    sub_req = db.query(SubRequirement).filter(SubRequirement.id == sub_req_id).first()
    if not sub_req:
        raise HTTPException(status_code=404, detail="Sub-requirement not found")
    
    if status not in ["compliant", "partial", "not_started"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    
    sub_req.status = status
    if status == "compliant":
        sub_req.evidence_needed = 0
    
    db.commit()
    return {"message": "Status updated", "status": status}


@router.patch("/phases/{phase_id}/set-current")
def set_current_phase(phase_id: int, db: Session = Depends(get_db)):
    db.query(Phase).update({"is_current": False})
    
    phase = db.query(Phase).filter(Phase.id == phase_id).first()
    if not phase:
        raise HTTPException(status_code=404, detail="Phase not found")
    
    phase.is_current = True
    db.commit()
    return {"message": "Current phase updated", "phase": phase.name}
