from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Request, Cookie
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import text

from ....models import (
    VulnerabilityAssetLink, Vulnerability, ITAsset, GRCUser, Tenant, get_db
)
from ....schemas import (
    VulnerabilityAssetLinkCreate, VulnerabilityAssetLinkResponse, MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, decode_token
from ....tenant_manager import get_tenant_session, IS_SQLITE
from ....tenant_models import TenantUser as TenantSchemaUser


def _resolve_tenant_user_to_public(owner_id: int, token: str, db: Session):
    """Resolve a tenant-schema user ID to a public GRCUser by email match"""
    try:
        if not token:
            return None
        payload = decode_token(token)
        schema_name = payload.get("schema")
        if not schema_name:
            return None
        
        TenantSession = get_tenant_session(schema_name)
        tenant_session = TenantSession()
        try:
            if not IS_SQLITE:
                tenant_session.execute(text(f'SET search_path TO "{schema_name}", public'))
            tenant_user = tenant_session.query(TenantSchemaUser).filter(
                TenantSchemaUser.id == owner_id
            ).first()
            if not tenant_user:
                return None
            
            # Match by email to public GRCUser
            public_user = db.query(GRCUser).filter(
                GRCUser.email == tenant_user.email
            ).first()
            return public_user
        finally:
            tenant_session.close()
    except Exception as e:
        print(f"[asset-link] Tenant user resolution failed: {e}")
        return None

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
    request_body: VulnerabilityAssetLinkCreate,
    http_request: Request,
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    asset = db.query(ITAsset).filter(
        ITAsset.id == request_body.asset_id,
        ITAsset.tenant_id.in_(user_tenants)
    ).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    
    existing = db.query(VulnerabilityAssetLink).filter(
        VulnerabilityAssetLink.vulnerability_id == vuln_id,
        VulnerabilityAssetLink.asset_id == request_body.asset_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Asset already linked to this vulnerability")
    
    link = VulnerabilityAssetLink(
        vulnerability_id=vuln_id,
        asset_id=request_body.asset_id,
        impact_on_asset=request_body.impact_on_asset,
        notes=request_body.notes,
        created_by=current_user.id
    )
    db.add(link)
    db.flush()  # Flush the link first
    
    # Auto-assign vulnerability owner from asset owner
    print(f"[asset-link] Asset owner_id: {asset.owner_id}, owner_name: {asset.owner_name}, Vuln assigned_to: {vuln.assigned_to}")
    if asset.owner_id and not vuln.assigned_to:
        print(f"[asset-link] Attempting auto-assign for vuln {vuln.id}")
        # Try to resolve tenant user to public user
        auth_token = token
        if not auth_token:
            auth_header = http_request.headers.get("authorization", "")
            if auth_header.startswith("Bearer "):
                auth_token = auth_header[7:]
        
        if auth_token and asset.owner_id:
            print(f"[asset-link] Trying tenant user resolution for owner_id {asset.owner_id}")
            public_user = _resolve_tenant_user_to_public(asset.owner_id, auth_token, db)
            if public_user:
                print(f"[asset-link] Resolved to public user {public_user.id}")
                vuln.assigned_to = public_user.id
            else:
                print(f"[asset-link] Tenant resolution failed, trying direct GRCUser lookup")
                # Direct assignment if owner_id is already a public user
                direct_user = db.query(GRCUser).filter(GRCUser.id == asset.owner_id).first()
                if direct_user:
                    print(f"[asset-link] Direct user found: {direct_user.id}")
                    vuln.assigned_to = direct_user.id
                else:
                    print(f"[asset-link] No direct user found for owner_id {asset.owner_id}")
        else:
            print(f"[asset-link] No token or no owner_id, trying direct assignment")
            # Fallback: try direct assignment
            direct_user = db.query(GRCUser).filter(GRCUser.id == asset.owner_id).first()
            if direct_user:
                print(f"[asset-link] Fallback: Direct user found: {direct_user.id}")
                vuln.assigned_to = direct_user.id
            else:
                print(f"[asset-link] Fallback: No direct user found")
        
        if vuln.assigned_to:
            print(f"[asset-link] SUCCESS: Vuln {vuln.id} assigned to user {vuln.assigned_to}")
        else:
            print(f"[asset-link] FAILED: Could not auto-assign vuln {vuln.id}")
    elif asset.owner_id:
        print(f"[asset-link] Vuln already has assigned_to: {vuln.assigned_to}")
    else:
        print(f"[asset-link] Asset has no owner_id, skipping auto-assign")
    
    db.commit()
    db.refresh(link)  # Refresh the link after commit
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
