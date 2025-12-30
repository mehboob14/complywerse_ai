from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from typing import List
from pydantic import BaseModel
from models import get_db, Control, RequiredEvidence

router = APIRouter(prefix="/api", tags=["PCI DSS Controls"])


class RequiredEvidenceResponse(BaseModel):
    id: int
    control_id: int
    evidence_name: str
    evidence_type: str

    class Config:
        from_attributes = True


class ControlResponse(BaseModel):
    id: int
    name: str
    description: str | None
    pci_requirement: str

    class Config:
        from_attributes = True


class ControlWithEvidenceResponse(BaseModel):
    id: int
    name: str
    description: str | None
    pci_requirement: str
    required_evidence: List[RequiredEvidenceResponse]

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


@router.get("/controls/{control_id}", response_model=ControlWithEvidenceResponse)
def get_control(control_id: int, db: Session = Depends(get_db)):
    control = db.query(Control).options(joinedload(Control.required_evidence)).filter(Control.id == control_id).first()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found")
    return control


@router.get("/required-evidence/{control_id}", response_model=List[RequiredEvidenceResponse])
def get_required_evidence(control_id: int, db: Session = Depends(get_db)):
    control = db.query(Control).filter(Control.id == control_id).first()
    if not control:
        raise HTTPException(status_code=404, detail="Control not found")
    evidence = db.query(RequiredEvidence).filter(RequiredEvidence.control_id == control_id).all()
    return evidence
