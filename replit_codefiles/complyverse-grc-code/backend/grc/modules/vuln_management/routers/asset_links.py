from typing import List
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload

from ....models import (
    VulnerabilityAssetLink, Vulnerability, ITAsset, GRCUser, get_db
)
from ....schemas import (
    VulnerabilityAssetLinkCreate, VulnerabilityAssetLinkResponse, MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(tags=["Vulnerability Asset Links"])


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


@router.get("/vulnerabilities/{vuln_id}/assets", response_model=List[VulnerabilityAssetLinkResponse])
def list_asset_links(
    vuln_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    links = db.query(VulnerabilityAssetLink).options(
        joinedload(VulnerabilityAssetLink.asset)
    ).filter(VulnerabilityAssetLink.vulnerability_id == vuln_id).all()
    
    return [
        VulnerabilityAssetLinkResponse(
            id=link.id,
            vulnerability_id=link.vulnerability_id,
            asset_id=link.asset_id,
            impact_on_asset=link.impact_on_asset,
            notes=link.notes,
            created_at=link.created_at,
            created_by=link.created_by,
            asset_name=link.asset.name if link.asset else None,
            asset_type=link.asset.asset_type if link.asset else None
        )
        for link in links
    ]


@router.post("/vulnerabilities/{vuln_id}/assets", response_model=VulnerabilityAssetLinkResponse, status_code=status.HTTP_201_CREATED)
def create_asset_link(
    vuln_id: int,
    request: VulnerabilityAssetLinkCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == request.asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    
    existing = db.query(VulnerabilityAssetLink).filter(
        VulnerabilityAssetLink.vulnerability_id == vuln_id,
        VulnerabilityAssetLink.asset_id == request.asset_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Asset already linked to this vulnerability")
    
    link = VulnerabilityAssetLink(
        vulnerability_id=vuln_id,
        asset_id=request.asset_id,
        impact_on_asset=request.impact_on_asset,
        notes=request.notes,
        created_by=current_user.id
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    
    return VulnerabilityAssetLinkResponse(
        id=link.id,
        vulnerability_id=link.vulnerability_id,
        asset_id=link.asset_id,
        impact_on_asset=link.impact_on_asset,
        notes=link.notes,
        created_at=link.created_at,
        created_by=link.created_by,
        asset_name=asset.name,
        asset_type=asset.asset_type
    )


@router.delete("/vulnerabilities/{vuln_id}/assets/{asset_id}", response_model=MessageResponse)
def delete_asset_link(
    vuln_id: int,
    asset_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    link = db.query(VulnerabilityAssetLink).filter(
        VulnerabilityAssetLink.vulnerability_id == vuln_id,
        VulnerabilityAssetLink.asset_id == asset_id
    ).first()
    
    if not link:
        raise HTTPException(status_code=404, detail="Asset link not found")
    
    db.delete(link)
    db.commit()
    
    return MessageResponse(message="Asset link removed successfully")
