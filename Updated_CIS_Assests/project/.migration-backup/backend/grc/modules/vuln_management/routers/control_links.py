from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from ....models import (
    VulnerabilityControlLink, Vulnerability, FrameworkControl,
    NormalizedControl, InternalControl, GRCUser, get_db
)
from ....schemas import (
    VulnerabilityControlLinkCreate, VulnerabilityControlLinkResponse, MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(tags=["Vulnerability Control Links"])


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


@router.get("/vulnerabilities/{vuln_id}/controls", response_model=List[VulnerabilityControlLinkResponse])
def list_control_links(
    vuln_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    links = db.query(VulnerabilityControlLink).options(
        joinedload(VulnerabilityControlLink.framework_control),
        joinedload(VulnerabilityControlLink.normalized_control),
        joinedload(VulnerabilityControlLink.internal_control)
    ).filter(VulnerabilityControlLink.vulnerability_id == vuln_id).all()
    
    return [
        VulnerabilityControlLinkResponse(
            id=link.id,
            vulnerability_id=link.vulnerability_id,
            framework_control_id=link.framework_control_id,
            normalized_control_id=link.normalized_control_id,
            internal_control_id=link.internal_control_id,
            compliance_impact=link.compliance_impact,
            notes=link.notes,
            created_at=link.created_at,
            created_by=link.created_by,
            framework_control_code=link.framework_control.code if link.framework_control else None,
            framework_control_name=link.framework_control.name if link.framework_control else None,
            normalized_control_code=link.normalized_control.code if link.normalized_control else None,
            normalized_control_name=link.normalized_control.name if link.normalized_control else None,
            internal_control_name=link.internal_control.name if link.internal_control else None
        )
        for link in links
    ]


@router.post("/vulnerabilities/{vuln_id}/controls", response_model=VulnerabilityControlLinkResponse, status_code=status.HTTP_201_CREATED)
def create_control_link(
    vuln_id: int,
    request: VulnerabilityControlLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    if not any([request.framework_control_id, request.normalized_control_id, request.internal_control_id]):
        raise HTTPException(status_code=400, detail="At least one control ID must be provided")
    
    framework_control = None
    normalized_control = None
    internal_control = None
    
    if request.framework_control_id:
        framework_control = db.query(FrameworkControl).filter(
            FrameworkControl.id == request.framework_control_id
        ).first()
        if not framework_control:
            raise HTTPException(status_code=404, detail="Framework control not found")
    
    if request.normalized_control_id:
        normalized_control = db.query(NormalizedControl).filter(
            NormalizedControl.id == request.normalized_control_id
        ).first()
        if not normalized_control:
            raise HTTPException(status_code=404, detail="Normalized control not found")
    
    if request.internal_control_id:
        internal_control = db.query(InternalControl).filter(
            InternalControl.id == request.internal_control_id,
            InternalControl.tenant_id.in_(user_tenants)
        ).first()
        if not internal_control:
            raise HTTPException(status_code=404, detail="Internal control not found")
    
    link = VulnerabilityControlLink(
        vulnerability_id=vuln_id,
        framework_control_id=request.framework_control_id,
        normalized_control_id=request.normalized_control_id,
        internal_control_id=request.internal_control_id,
        compliance_impact=request.compliance_impact,
        notes=request.notes,
        created_by=current_user.id
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    
    return VulnerabilityControlLinkResponse(
        id=link.id,
        vulnerability_id=link.vulnerability_id,
        framework_control_id=link.framework_control_id,
        normalized_control_id=link.normalized_control_id,
        internal_control_id=link.internal_control_id,
        compliance_impact=link.compliance_impact,
        notes=link.notes,
        created_at=link.created_at,
        created_by=link.created_by,
        framework_control_code=framework_control.code if framework_control else None,
        framework_control_name=framework_control.name if framework_control else None,
        normalized_control_code=normalized_control.code if normalized_control else None,
        normalized_control_name=normalized_control.name if normalized_control else None,
        internal_control_name=internal_control.name if internal_control else None
    )


@router.delete("/vulnerabilities/{vuln_id}/controls/{link_id}", response_model=MessageResponse)
def delete_control_link(
    vuln_id: int,
    link_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    link = db.query(VulnerabilityControlLink).filter(
        VulnerabilityControlLink.id == link_id,
        VulnerabilityControlLink.vulnerability_id == vuln_id
    ).first()
    
    if not link:
        raise HTTPException(status_code=404, detail="Control link not found")
    
    db.delete(link)
    db.commit()
    
    return MessageResponse(message="Control link removed successfully")
