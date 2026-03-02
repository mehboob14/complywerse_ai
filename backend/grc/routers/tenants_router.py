from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..models import Tenant, TenantUser, BusinessUnit, GRCUser, get_db
from ..schemas import (
    TenantCreate, TenantUpdate, TenantResponse,
    TenantUserCreate, TenantUserResponse,
    BusinessUnitCreate, BusinessUnitResponse, UserResponse,
    MessageResponse
)
from .auth_router import require_auth

router = APIRouter(prefix="/tenants", tags=["Tenants"])


@router.get("", response_model=List[TenantResponse])
def list_tenants(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenants = db.query(Tenant).offset(skip).limit(limit).all()
    return tenants


@router.post("", response_model=TenantResponse, status_code=status.HTTP_201_CREATED)
def create_tenant(
    tenant: TenantCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    existing = db.query(Tenant).filter(Tenant.slug == tenant.slug).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tenant with this slug already exists"
        )
    
    db_tenant = Tenant(
        name=tenant.name,
        slug=tenant.slug,
        settings=tenant.settings or {}
    )
    db.add(db_tenant)
    db.commit()
    db.refresh(db_tenant)
    return db_tenant


@router.get("/{tenant_id}", response_model=TenantResponse)
def get_tenant(
    tenant_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found"
        )
    return tenant


@router.put("/{tenant_id}", response_model=TenantResponse)
def update_tenant(
    tenant_id: int,
    tenant_update: TenantUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found"
        )
    
    if tenant_update.slug:
        existing = db.query(Tenant).filter(
            Tenant.slug == tenant_update.slug,
            Tenant.id != tenant_id
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tenant with this slug already exists"
            )
    
    update_data = tenant_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(tenant, field, value)
    
    db.commit()
    db.refresh(tenant)
    return tenant


@router.delete("/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tenant(
    tenant_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found"
        )
    
    db.delete(tenant)
    db.commit()
    return None


@router.get("/{tenant_id}/users", response_model=List[TenantUserResponse])
def list_tenant_users(
    tenant_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found"
        )
    
    tenant_users = db.query(TenantUser).filter(
        TenantUser.tenant_id == tenant_id
    ).all()
    return tenant_users


@router.post("/{tenant_id}/users", response_model=TenantUserResponse, status_code=status.HTTP_201_CREATED)
def add_user_to_tenant(
    tenant_id: int,
    tenant_user: TenantUserCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found"
        )
    
    user = db.query(GRCUser).filter(GRCUser.id == tenant_user.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    existing = db.query(TenantUser).filter(
        TenantUser.tenant_id == tenant_id,
        TenantUser.user_id == tenant_user.user_id
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already a member of this tenant"
        )
    
    db_tenant_user = TenantUser(
        tenant_id=tenant_id,
        user_id=tenant_user.user_id,
        is_primary=tenant_user.is_primary
    )
    db.add(db_tenant_user)
    db.commit()
    db.refresh(db_tenant_user)
    return db_tenant_user


@router.get("/{tenant_id}/business-units", response_model=List[BusinessUnitResponse])
def list_business_units(
    tenant_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found"
        )
    
    business_units = db.query(BusinessUnit).filter(
        BusinessUnit.tenant_id == tenant_id
    ).all()

    if not business_units:
        demo_units = [
            "Finance",
            "Operations",
            "IT",
            "Human Resources",
            "Compliance",
        ]
        for unit_name in demo_units:
            db.add(BusinessUnit(tenant_id=tenant_id, name=unit_name, parent_id=None))
        db.commit()
        business_units = db.query(BusinessUnit).filter(
            BusinessUnit.tenant_id == tenant_id
        ).all()

    return business_units


@router.post("/{tenant_id}/business-units", response_model=BusinessUnitResponse, status_code=status.HTTP_201_CREATED)
def create_business_unit(
    tenant_id: int,
    business_unit: BusinessUnitCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found"
        )
    
    if business_unit.parent_id:
        parent = db.query(BusinessUnit).filter(
            BusinessUnit.id == business_unit.parent_id,
            BusinessUnit.tenant_id == tenant_id
        ).first()
        if not parent:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parent business unit not found"
            )
    
    db_business_unit = BusinessUnit(
        tenant_id=tenant_id,
        name=business_unit.name,
        parent_id=business_unit.parent_id
    )
    db.add(db_business_unit)
    db.commit()
    db.refresh(db_business_unit)
    return db_business_unit
