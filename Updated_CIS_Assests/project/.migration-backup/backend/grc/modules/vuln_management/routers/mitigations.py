from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload

from ....models import (
    VulnerabilityMitigation, Vulnerability, GRCUser, get_db
)
from ....schemas import (
    VulnerabilityMitigationCreate, VulnerabilityMitigationUpdate,
    VulnerabilityMitigationResponse, MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(tags=["Vulnerability Mitigations"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def get_vuln_or_404(vuln_id: int, user_tenants: List[int], db: Session) -> Vulnerability:
    vuln = db.query(Vulnerability).filter(
        Vulnerability.id == vuln_id,
        Vulnerability.tenant_id.in_(user_tenants)
    ).first()
    if not vuln:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Vulnerability not found"
        )
    return vuln


def get_mitigation_or_404(mitigation_id: int, user_tenants: List[int], db: Session) -> VulnerabilityMitigation:
    mitigation = db.query(VulnerabilityMitigation).filter(
        VulnerabilityMitigation.id == mitigation_id,
        VulnerabilityMitigation.tenant_id.in_(user_tenants)
    ).first()
    if not mitigation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mitigation not found"
        )
    return mitigation


@router.get("/vulnerabilities/{vuln_id}/mitigations", response_model=List[VulnerabilityMitigationResponse])
def list_mitigations(
    vuln_id: int,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    query = db.query(VulnerabilityMitigation).options(
        joinedload(VulnerabilityMitigation.owner),
        joinedload(VulnerabilityMitigation.creator)
    ).filter(VulnerabilityMitigation.vulnerability_id == vuln_id)
    
    if status_filter:
        query = query.filter(VulnerabilityMitigation.status == status_filter)
    
    mitigations = query.order_by(VulnerabilityMitigation.created_at.desc()).all()
    
    return [
        VulnerabilityMitigationResponse(
            id=m.id,
            vulnerability_id=m.vulnerability_id,
            tenant_id=m.tenant_id,
            action_title=m.action_title,
            action_description=m.action_description,
            action_type=m.action_type,
            owner_id=m.owner_id,
            priority=m.priority,
            status=m.status,
            target_date=m.target_date,
            completed_at=m.completed_at,
            effort_estimate=m.effort_estimate,
            actual_effort=m.actual_effort,
            notes=m.notes,
            erm_mitigation_id=m.erm_mitigation_id,
            created_at=m.created_at,
            updated_at=m.updated_at,
            created_by=m.created_by,
            owner_name=m.owner.display_name if m.owner else None,
            creator_name=m.creator.display_name if m.creator else None
        )
        for m in mitigations
    ]


@router.post("/vulnerabilities/{vuln_id}/mitigations", response_model=VulnerabilityMitigationResponse, status_code=status.HTTP_201_CREATED)
def create_mitigation(
    vuln_id: int,
    request: VulnerabilityMitigationCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    mitigation = VulnerabilityMitigation(
        vulnerability_id=vuln_id,
        tenant_id=vuln.tenant_id,
        action_title=request.action_title,
        action_description=request.action_description,
        action_type=request.action_type,
        owner_id=request.owner_id,
        priority=request.priority,
        status="pending",
        target_date=request.target_date,
        effort_estimate=request.effort_estimate,
        notes=request.notes,
        created_by=current_user.id
    )
    db.add(mitigation)
    db.commit()
    db.refresh(mitigation)
    
    owner = db.query(GRCUser).filter(GRCUser.id == request.owner_id).first() if request.owner_id else None
    
    return VulnerabilityMitigationResponse(
        id=mitigation.id,
        vulnerability_id=mitigation.vulnerability_id,
        tenant_id=mitigation.tenant_id,
        action_title=mitigation.action_title,
        action_description=mitigation.action_description,
        action_type=mitigation.action_type,
        owner_id=mitigation.owner_id,
        priority=mitigation.priority,
        status=mitigation.status,
        target_date=mitigation.target_date,
        completed_at=mitigation.completed_at,
        effort_estimate=mitigation.effort_estimate,
        actual_effort=mitigation.actual_effort,
        notes=mitigation.notes,
        erm_mitigation_id=mitigation.erm_mitigation_id,
        created_at=mitigation.created_at,
        updated_at=mitigation.updated_at,
        created_by=mitigation.created_by,
        owner_name=owner.display_name if owner else None,
        creator_name=current_user.display_name
    )


@router.put("/mitigations/{mitigation_id}", response_model=VulnerabilityMitigationResponse)
def update_mitigation(
    mitigation_id: int,
    request: VulnerabilityMitigationUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    mitigation = get_mitigation_or_404(mitigation_id, user_tenants, db)
    
    update_data = request.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(mitigation, field, value)
    
    if request.status == "completed" and not mitigation.completed_at:
        mitigation.completed_at = datetime.utcnow()
    
    mitigation.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(mitigation)
    
    return VulnerabilityMitigationResponse(
        id=mitigation.id,
        vulnerability_id=mitigation.vulnerability_id,
        tenant_id=mitigation.tenant_id,
        action_title=mitigation.action_title,
        action_description=mitigation.action_description,
        action_type=mitigation.action_type,
        owner_id=mitigation.owner_id,
        priority=mitigation.priority,
        status=mitigation.status,
        target_date=mitigation.target_date,
        completed_at=mitigation.completed_at,
        effort_estimate=mitigation.effort_estimate,
        actual_effort=mitigation.actual_effort,
        notes=mitigation.notes,
        erm_mitigation_id=mitigation.erm_mitigation_id,
        created_at=mitigation.created_at,
        updated_at=mitigation.updated_at,
        created_by=mitigation.created_by,
        owner_name=mitigation.owner.display_name if mitigation.owner else None,
        creator_name=mitigation.creator.display_name if mitigation.creator else None
    )


@router.delete("/mitigations/{mitigation_id}", response_model=MessageResponse)
def delete_mitigation(
    mitigation_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    mitigation = get_mitigation_or_404(mitigation_id, user_tenants, db)
    
    db.delete(mitigation)
    db.commit()
    
    return MessageResponse(message="Mitigation deleted successfully")
