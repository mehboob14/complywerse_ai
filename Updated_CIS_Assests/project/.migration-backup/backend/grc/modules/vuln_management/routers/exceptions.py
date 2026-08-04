from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload

from ....models import Vulnerability, GRCUser, get_db
from ....schemas import (
    VulnerabilityExceptionCreate, VulnerabilityExceptionUpdate,
    VulnerabilityExceptionResponse, MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(tags=["Vulnerability Exceptions"])


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


@router.post("/vulnerabilities/{vuln_id}/exception", response_model=VulnerabilityExceptionResponse)
def create_exception(
    vuln_id: int,
    request: VulnerabilityExceptionCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    if vuln.is_exception:
        raise HTTPException(status_code=400, detail="Vulnerability already has an exception")
    
    vuln.is_exception = True
    vuln.exception_reason = request.exception_reason
    vuln.exception_approved_by = current_user.id
    vuln.exception_expiry = request.exception_expiry
    vuln.status = "accepted"
    vuln.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(vuln)
    
    days_until_expiry = None
    if vuln.exception_expiry:
        days_until_expiry = (vuln.exception_expiry - datetime.utcnow()).days
    
    return VulnerabilityExceptionResponse(
        id=vuln.id,
        vuln_id=vuln.vuln_id,
        title=vuln.title,
        severity=vuln.severity,
        is_exception=vuln.is_exception,
        exception_reason=vuln.exception_reason,
        exception_approved_by=vuln.exception_approved_by,
        exception_expiry=vuln.exception_expiry,
        exception_approver_name=current_user.display_name,
        days_until_expiry=days_until_expiry
    )


@router.put("/vulnerabilities/{vuln_id}/exception", response_model=VulnerabilityExceptionResponse)
def update_exception(
    vuln_id: int,
    request: VulnerabilityExceptionUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    vuln = get_vuln_or_404(vuln_id, user_tenants, db)
    
    if request.is_exception is False:
        vuln.is_exception = False
        vuln.exception_reason = None
        vuln.exception_approved_by = None
        vuln.exception_expiry = None
        vuln.status = "open"
    else:
        if request.exception_reason is not None:
            vuln.exception_reason = request.exception_reason
        if request.exception_expiry is not None:
            vuln.exception_expiry = request.exception_expiry
        if not vuln.is_exception:
            vuln.is_exception = True
            vuln.exception_approved_by = current_user.id
            vuln.status = "accepted"
    
    vuln.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(vuln)
    
    approver = db.query(GRCUser).filter(GRCUser.id == vuln.exception_approved_by).first() if vuln.exception_approved_by else None
    
    days_until_expiry = None
    if vuln.exception_expiry:
        days_until_expiry = (vuln.exception_expiry - datetime.utcnow()).days
    
    return VulnerabilityExceptionResponse(
        id=vuln.id,
        vuln_id=vuln.vuln_id,
        title=vuln.title,
        severity=vuln.severity,
        is_exception=vuln.is_exception,
        exception_reason=vuln.exception_reason,
        exception_approved_by=vuln.exception_approved_by,
        exception_expiry=vuln.exception_expiry,
        exception_approver_name=approver.display_name if approver else None,
        days_until_expiry=days_until_expiry
    )


@router.get("/exceptions", response_model=List[VulnerabilityExceptionResponse])
def list_exceptions(
    tenant_id: Optional[int] = None,
    expiring_within_days: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(Vulnerability).options(
        joinedload(Vulnerability.exception_approver)
    ).filter(
        Vulnerability.tenant_id.in_(user_tenants),
        Vulnerability.is_exception == True
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(Vulnerability.tenant_id == tenant_id)
    
    if expiring_within_days:
        expiry_threshold = datetime.utcnow() + timedelta(days=expiring_within_days)
        query = query.filter(
            Vulnerability.exception_expiry != None,
            Vulnerability.exception_expiry <= expiry_threshold
        )
    
    vulns = query.order_by(Vulnerability.exception_expiry.asc()).offset(skip).limit(limit).all()
    
    now = datetime.utcnow()
    
    return [
        VulnerabilityExceptionResponse(
            id=v.id,
            vuln_id=v.vuln_id,
            title=v.title,
            severity=v.severity,
            is_exception=v.is_exception,
            exception_reason=v.exception_reason,
            exception_approved_by=v.exception_approved_by,
            exception_expiry=v.exception_expiry,
            exception_approver_name=v.exception_approver.display_name if v.exception_approver else None,
            days_until_expiry=(v.exception_expiry - now).days if v.exception_expiry else None
        )
        for v in vulns
    ]
