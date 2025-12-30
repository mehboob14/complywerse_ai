from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from pydantic import BaseModel
from models import get_db, Control, RequiredEvidence, UploadedEvidence

router = APIRouter(prefix="/api", tags=["PCI DSS Controls"])


class RequiredEvidenceResponse(BaseModel):
    id: int
    control_id: int
    evidence_name: str
    evidence_type: str

    class Config:
        from_attributes = True


class UploadedEvidenceResponse(BaseModel):
    id: int
    control_id: int
    required_evidence_id: Optional[int]
    file_name: str
    evidence_type: str
    status: str

    class Config:
        from_attributes = True


class ControlResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    pci_requirement: str

    class Config:
        from_attributes = True


class ControlWithEvidenceResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    pci_requirement: str
    required_evidence: List[RequiredEvidenceResponse]

    class Config:
        from_attributes = True


class ControlStatusResponse(BaseModel):
    id: int
    name: str
    description: Optional[str]
    pci_requirement: str
    status: str
    required_count: int
    uploaded_count: int
    required_evidence: List[RequiredEvidenceResponse]

    class Config:
        from_attributes = True


class GapEvidenceItem(BaseModel):
    id: int
    evidence_name: str
    evidence_type: str
    is_uploaded: bool
    uploaded_file: Optional[str]
    upload_status: Optional[str]

    class Config:
        from_attributes = True


class ControlGapResponse(BaseModel):
    id: int
    name: str
    pci_requirement: str
    status: str
    required_count: int
    uploaded_count: int
    missing_count: int
    evidence_items: List[GapEvidenceItem]

    class Config:
        from_attributes = True


@router.get("/controls", response_model=List[ControlResponse])
def get_all_controls(db: Session = Depends(get_db)):
    controls = db.query(Control).all()
    return controls


@router.get("/controls/with-evidence", response_model=List[ControlWithEvidenceResponse])
def get_controls_with_evidence(db: Session = Depends(get_db)):
    controls = db.query(Control).options(joinedload(Control.required_evidence)).all()
    return controls


@router.get("/controls/status", response_model=List[ControlStatusResponse])
def get_controls_status(db: Session = Depends(get_db)):
    controls = db.query(Control).options(
        joinedload(Control.required_evidence),
        joinedload(Control.uploaded_evidence)
    ).all()
    
    result = []
    for control in controls:
        required_count = len(control.required_evidence)
        required_ids = {re.id for re in control.required_evidence}
        uploaded_ids = {ue.required_evidence_id for ue in control.uploaded_evidence if ue.required_evidence_id}
        uploaded_count = len(required_ids & uploaded_ids)
        
        if uploaded_count == 0:
            status = "Not Started"
        elif uploaded_count < required_count:
            status = "Partial"
        else:
            status = "Complete"
        
        result.append(ControlStatusResponse(
            id=control.id,
            name=control.name,
            description=control.description,
            pci_requirement=control.pci_requirement,
            status=status,
            required_count=required_count,
            uploaded_count=uploaded_count,
            required_evidence=[RequiredEvidenceResponse(
                id=re.id,
                control_id=re.control_id,
                evidence_name=re.evidence_name,
                evidence_type=re.evidence_type
            ) for re in control.required_evidence]
        ))
    
    return result


@router.get("/controls/{control_id}", response_model=ControlWithEvidenceResponse)
def get_control(control_id: int, db: Session = Depends(get_db)):
    control = db.query(Control).options(joinedload(Control.required_evidence)).filter(Control.id == control_id).first()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found")
    return control


@router.get("/controls/{control_id}/gap", response_model=ControlGapResponse)
def get_control_gap(control_id: int, db: Session = Depends(get_db)):
    control = db.query(Control).options(
        joinedload(Control.required_evidence),
        joinedload(Control.uploaded_evidence)
    ).filter(Control.id == control_id).first()
    
    if not control:
        raise HTTPException(status_code=404, detail="Control not found")
    
    uploaded_map = {}
    for ue in control.uploaded_evidence:
        if ue.required_evidence_id:
            uploaded_map[ue.required_evidence_id] = ue
    
    evidence_items = []
    for req in control.required_evidence:
        uploaded = uploaded_map.get(req.id)
        evidence_items.append(GapEvidenceItem(
            id=req.id,
            evidence_name=req.evidence_name,
            evidence_type=req.evidence_type,
            is_uploaded=uploaded is not None,
            uploaded_file=uploaded.file_name if uploaded else None,
            upload_status=uploaded.status if uploaded else None
        ))
    
    required_count = len(control.required_evidence)
    uploaded_count = len([e for e in evidence_items if e.is_uploaded])
    missing_count = required_count - uploaded_count
    
    if uploaded_count == 0:
        status = "Not Started"
    elif uploaded_count < required_count:
        status = "Partial"
    else:
        status = "Complete"
    
    return ControlGapResponse(
        id=control.id,
        name=control.name,
        pci_requirement=control.pci_requirement,
        status=status,
        required_count=required_count,
        uploaded_count=uploaded_count,
        missing_count=missing_count,
        evidence_items=evidence_items
    )


@router.get("/evidence", response_model=List[UploadedEvidenceResponse])
def get_all_evidence(db: Session = Depends(get_db)):
    evidence = db.query(UploadedEvidence).all()
    return evidence


@router.get("/required-evidence/{control_id}", response_model=List[RequiredEvidenceResponse])
def get_required_evidence(control_id: int, db: Session = Depends(get_db)):
    control = db.query(Control).filter(Control.id == control_id).first()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found")
    evidence = db.query(RequiredEvidence).filter(RequiredEvidence.control_id == control_id).all()
    return evidence
