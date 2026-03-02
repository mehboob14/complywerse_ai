from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from ....models import VulnerabilitySLAConfig, GRCUser, get_db
from ....schemas import (
    VulnerabilitySLAConfigCreate, VulnerabilitySLAConfigUpdate,
    VulnerabilitySLAConfigResponse, MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/sla", tags=["Vulnerability SLA"])

DEFAULT_SLA = {
    "critical": 7,
    "high": 30,
    "medium": 90,
    "low": 180,
    "info": 365
}


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def seed_default_sla(tenant_id: int, db: Session) -> List[VulnerabilitySLAConfig]:
    existing = db.query(VulnerabilitySLAConfig).filter(
        VulnerabilitySLAConfig.tenant_id == tenant_id
    ).first()
    
    if existing:
        return db.query(VulnerabilitySLAConfig).filter(
            VulnerabilitySLAConfig.tenant_id == tenant_id
        ).all()
    
    configs = []
    for severity, days in DEFAULT_SLA.items():
        config = VulnerabilitySLAConfig(
            tenant_id=tenant_id,
            severity=severity,
            remediation_days=days,
            is_active=True
        )
        db.add(config)
        configs.append(config)
    
    db.commit()
    
    for c in configs:
        db.refresh(c)
    
    return configs


@router.get("", response_model=List[VulnerabilitySLAConfigResponse])
def get_sla_config(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
    else:
        tenant_id = get_user_primary_tenant(current_user, db)
        if not tenant_id:
            tenant_id = user_tenants[0]
    
    configs = seed_default_sla(tenant_id, db)
    
    return [
        VulnerabilitySLAConfigResponse(
            id=c.id,
            tenant_id=c.tenant_id,
            severity=c.severity,
            remediation_days=c.remediation_days,
            is_active=c.is_active,
            created_at=c.created_at,
            updated_at=c.updated_at
        )
        for c in configs
    ]


@router.post("", response_model=List[VulnerabilitySLAConfigResponse], status_code=status.HTTP_201_CREATED)
def set_sla_config(
    configs: List[VulnerabilitySLAConfigCreate],
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
    else:
        tenant_id = get_user_primary_tenant(current_user, db)
        if not tenant_id:
            tenant_id = user_tenants[0]
    
    valid_severities = ["critical", "high", "medium", "low", "info"]
    
    result = []
    for config_data in configs:
        if config_data.severity not in valid_severities:
            raise HTTPException(status_code=400, detail=f"Invalid severity: {config_data.severity}")
        
        existing = db.query(VulnerabilitySLAConfig).filter(
            VulnerabilitySLAConfig.tenant_id == tenant_id,
            VulnerabilitySLAConfig.severity == config_data.severity
        ).first()
        
        if existing:
            existing.remediation_days = config_data.remediation_days
            existing.updated_at = datetime.utcnow()
            db.commit()
            db.refresh(existing)
            result.append(existing)
        else:
            new_config = VulnerabilitySLAConfig(
                tenant_id=tenant_id,
                severity=config_data.severity,
                remediation_days=config_data.remediation_days,
                is_active=True
            )
            db.add(new_config)
            db.commit()
            db.refresh(new_config)
            result.append(new_config)
    
    return [
        VulnerabilitySLAConfigResponse(
            id=c.id,
            tenant_id=c.tenant_id,
            severity=c.severity,
            remediation_days=c.remediation_days,
            is_active=c.is_active,
            created_at=c.created_at,
            updated_at=c.updated_at
        )
        for c in result
    ]


@router.put("/{severity}", response_model=VulnerabilitySLAConfigResponse)
def update_sla_for_severity(
    severity: str,
    request: VulnerabilitySLAConfigUpdate,
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
    else:
        tenant_id = get_user_primary_tenant(current_user, db)
        if not tenant_id:
            tenant_id = user_tenants[0]
    
    valid_severities = ["critical", "high", "medium", "low", "info"]
    if severity not in valid_severities:
        raise HTTPException(status_code=400, detail=f"Invalid severity: {severity}")
    
    seed_default_sla(tenant_id, db)
    
    config = db.query(VulnerabilitySLAConfig).filter(
        VulnerabilitySLAConfig.tenant_id == tenant_id,
        VulnerabilitySLAConfig.severity == severity
    ).first()
    
    if not config:
        raise HTTPException(status_code=404, detail="SLA config not found")
    
    config.remediation_days = request.remediation_days
    config.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(config)
    
    return VulnerabilitySLAConfigResponse(
        id=config.id,
        tenant_id=config.tenant_id,
        severity=config.severity,
        remediation_days=config.remediation_days,
        is_active=config.is_active,
        created_at=config.created_at,
        updated_at=config.updated_at
    )
