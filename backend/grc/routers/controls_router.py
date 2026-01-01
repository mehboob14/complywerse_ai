from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload

from ..models import (
    NormalizedControl, ControlMapping, GRCRequiredEvidence,
    FrameworkControl, Framework, GRCUser, get_db
)
from ..schemas import (
    NormalizedControlCreate, NormalizedControlUpdate, NormalizedControlResponse,
    ControlMappingCreate, ControlMappingResponse,
    RequiredEvidenceCreate, RequiredEvidenceResponse,
    MessageResponse
)
from .auth_router import require_auth

router = APIRouter(prefix="/controls", tags=["Normalized Controls"])


@router.get("", response_model=List[NormalizedControlResponse])
def list_controls(
    code: Optional[str] = None,
    name: Optional[str] = None,
    owner: Optional[str] = None,
    maturity_level: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    query = db.query(NormalizedControl)
    
    if code:
        query = query.filter(NormalizedControl.code.ilike(f"%{code}%"))
    if name:
        query = query.filter(NormalizedControl.name.ilike(f"%{name}%"))
    if owner:
        query = query.filter(NormalizedControl.control_owner.ilike(f"%{owner}%"))
    if maturity_level is not None:
        query = query.filter(NormalizedControl.maturity_level == maturity_level)
    
    controls = query.offset(skip).limit(limit).all()
    return controls


@router.post("", response_model=NormalizedControlResponse, status_code=status.HTTP_201_CREATED)
def create_control(
    control: NormalizedControlCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    existing = db.query(NormalizedControl).filter(NormalizedControl.code == control.code).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Control with this code already exists"
        )
    
    db_control = NormalizedControl(
        code=control.code,
        name=control.name,
        statement=control.statement,
        objective=control.objective,
        control_owner=control.control_owner,
        implementation_guidance=control.implementation_guidance,
        testing_guidance=control.testing_guidance,
        maturity_level=control.maturity_level
    )
    db.add(db_control)
    db.commit()
    db.refresh(db_control)
    return db_control


@router.get("/matrix")
def get_control_matrix(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    frameworks = db.query(Framework).filter(Framework.is_active == True).all()
    controls = db.query(NormalizedControl).options(
        joinedload(NormalizedControl.control_mappings)
        .joinedload(ControlMapping.framework_control)
    ).all()
    
    matrix = []
    for control in controls:
        row = {
            "id": control.id,
            "code": control.code,
            "name": control.name,
            "mappings": {}
        }
        for mapping in control.control_mappings:
            if mapping.framework_control and mapping.framework_control.objective:
                domain = mapping.framework_control.objective.domain
                if domain:
                    framework_code = domain.framework.short_code
                    row["mappings"][framework_code] = {
                        "control_id": mapping.framework_control_id,
                        "control_code": mapping.framework_control.code,
                        "mapping_type": mapping.mapping_type
                    }
        matrix.append(row)
    
    return {
        "frameworks": [{"id": f.id, "short_code": f.short_code, "name": f.name} for f in frameworks],
        "controls": matrix
    }


@router.get("/{control_id}", response_model=dict)
def get_control(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(NormalizedControl).options(
        joinedload(NormalizedControl.control_mappings)
        .joinedload(ControlMapping.framework_control),
        joinedload(NormalizedControl.required_evidence)
    ).filter(NormalizedControl.id == control_id).first()
    
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    return {
        "id": control.id,
        "code": control.code,
        "name": control.name,
        "statement": control.statement,
        "objective": control.objective,
        "control_owner": control.control_owner,
        "implementation_guidance": control.implementation_guidance,
        "testing_guidance": control.testing_guidance,
        "maturity_level": control.maturity_level,
        "created_at": control.created_at.isoformat(),
        "mappings": [
            {
                "id": m.id,
                "framework_control_id": m.framework_control_id,
                "framework_control_code": m.framework_control.code if m.framework_control else None,
                "framework_control_name": m.framework_control.name if m.framework_control else None,
                "mapping_type": m.mapping_type
            }
            for m in control.control_mappings
        ],
        "required_evidence": [
            {
                "id": e.id,
                "name": e.name,
                "description": e.description,
                "evidence_type": e.evidence_type,
                "validation_criteria": e.validation_criteria
            }
            for e in control.required_evidence
        ]
    }


@router.put("/{control_id}", response_model=NormalizedControlResponse)
def update_control(
    control_id: int,
    control_update: NormalizedControlUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    update_data = control_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(control, field, value)
    
    db.commit()
    db.refresh(control)
    return control


@router.delete("/{control_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_control(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    db.delete(control)
    db.commit()
    return None


@router.get("/{control_id}/mappings", response_model=List[ControlMappingResponse])
def get_control_mappings(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    mappings = db.query(ControlMapping).filter(
        ControlMapping.normalized_control_id == control_id
    ).all()
    return mappings


@router.post("/{control_id}/mappings", response_model=ControlMappingResponse, status_code=status.HTTP_201_CREATED)
def create_control_mapping(
    control_id: int,
    mapping: ControlMappingCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Normalized control not found"
        )
    
    framework_control = db.query(FrameworkControl).filter(
        FrameworkControl.id == mapping.framework_control_id
    ).first()
    if not framework_control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework control not found"
        )
    
    existing = db.query(ControlMapping).filter(
        ControlMapping.normalized_control_id == control_id,
        ControlMapping.framework_control_id == mapping.framework_control_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mapping already exists"
        )
    
    db_mapping = ControlMapping(
        normalized_control_id=control_id,
        framework_control_id=mapping.framework_control_id,
        mapping_type=mapping.mapping_type
    )
    db.add(db_mapping)
    db.commit()
    db.refresh(db_mapping)
    return db_mapping


@router.delete("/{control_id}/mappings/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_control_mapping(
    control_id: int,
    mapping_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    mapping = db.query(ControlMapping).filter(
        ControlMapping.id == mapping_id,
        ControlMapping.normalized_control_id == control_id
    ).first()
    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mapping not found"
        )
    
    db.delete(mapping)
    db.commit()
    return None


@router.get("/{control_id}/evidences", response_model=List[RequiredEvidenceResponse])
def get_control_evidences(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    evidences = db.query(GRCRequiredEvidence).filter(
        GRCRequiredEvidence.normalized_control_id == control_id
    ).all()
    return evidences


@router.post("/{control_id}/evidences", response_model=RequiredEvidenceResponse, status_code=status.HTTP_201_CREATED)
def add_required_evidence(
    control_id: int,
    evidence: RequiredEvidenceCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    db_evidence = GRCRequiredEvidence(
        normalized_control_id=control_id,
        name=evidence.name,
        description=evidence.description,
        evidence_type=evidence.evidence_type,
        validation_criteria=evidence.validation_criteria
    )
    db.add(db_evidence)
    db.commit()
    db.refresh(db_evidence)
    return db_evidence
