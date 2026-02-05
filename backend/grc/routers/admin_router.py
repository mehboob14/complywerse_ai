import os
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request, Cookie
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from pydantic import BaseModel, EmailStr
import bcrypt

from ..models import Tenant, get_db
from ..tenant_manager import (
    get_tenant_session, tenant_session, sanitize_schema_name
)
from ..tenant_models import (
    TenantUser, Role, Permission, RolePermission, UserRole, 
    OrganizationProfile, AuditLog
)
from ..permissions import get_permission_matrix_for_ui, get_all_permissions
from .auth_router import decode_token, require_auth, get_current_user

router = APIRouter(prefix="/admin", tags=["Administration"])


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def get_tenant_from_request(request: Request, db: Session = Depends(get_db)) -> Tenant:
    tenant = getattr(request.state, 'tenant', None)
    if tenant:
        return tenant
    
    x_tenant_slug = request.headers.get("X-Tenant-Slug")
    if x_tenant_slug:
        tenant = db.query(Tenant).filter(
            Tenant.slug == x_tenant_slug,
            Tenant.is_active == True
        ).first()
        if tenant:
            return tenant
    
    raise HTTPException(
        status_code=400,
        detail="Tenant not identified. Use subdomain or X-Tenant-Slug header."
    )


def get_tenant_db(request: Request, db: Session = Depends(get_db)):
    tenant = get_tenant_from_request(request, db)
    if not tenant.schema_name:
        raise HTTPException(status_code=400, detail="Tenant schema not configured")
    
    SessionClass = get_tenant_session(tenant.schema_name)
    tenant_db = SessionClass()
    try:
        yield tenant_db
    finally:
        tenant_db.close()


def get_current_tenant_user(
    request: Request,
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    tenant_db: Session = Depends(get_tenant_db)
) -> TenantUser:
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    
    user = tenant_db.query(TenantUser).filter(TenantUser.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found in this tenant")
    
    return user


def check_permission(user: TenantUser, tenant_db: Session, required_permission: str) -> bool:
    user_roles = tenant_db.query(UserRole).filter(UserRole.user_id == user.id).all()
    if not user_roles:
        return False
    
    role_ids = [ur.role_id for ur in user_roles]
    
    admin_role = tenant_db.query(Role).filter(
        Role.id.in_(role_ids),
        Role.name == "Administrator"
    ).first()
    if admin_role:
        return True
    
    permission = tenant_db.query(Permission).filter(Permission.name == required_permission).first()
    if not permission:
        return False
    
    has_perm = tenant_db.query(RolePermission).filter(
        RolePermission.role_id.in_(role_ids),
        RolePermission.permission_id == permission.id
    ).first()
    
    return has_perm is not None


def require_permission(permission: str):
    def permission_checker(
        user: TenantUser = Depends(get_current_tenant_user),
        tenant_db: Session = Depends(get_tenant_db)
    ):
        if not check_permission(user, tenant_db, permission):
            raise HTTPException(
                status_code=403,
                detail=f"Permission denied: {permission}"
            )
        return user
    return permission_checker


class OrganizationProfileUpdate(BaseModel):
    name: Optional[str] = None
    legal_entity: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    geography: Optional[str] = None
    regulatory_scope: Optional[str] = None
    primary_contact_name: Optional[str] = None
    primary_contact_email: Optional[str] = None
    primary_contact_phone: Optional[str] = None
    address: Optional[str] = None
    website: Optional[str] = None


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    display_name: Optional[str] = None
    role_ids: Optional[List[int]] = []


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    email: Optional[EmailStr] = None
    is_active: Optional[bool] = None
    role_ids: Optional[List[int]] = None


class RoleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    permission_names: List[str] = []


class RoleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    permission_names: Optional[List[str]] = None


@router.get("/organization")
def get_organization_profile(
    user: TenantUser = Depends(require_permission("admin:organization:view")),
    tenant_db: Session = Depends(get_tenant_db)
):
    profile = tenant_db.query(OrganizationProfile).first()
    if not profile:
        return {"id": None, "name": "Not configured"}
    
    return {
        "id": profile.id,
        "name": profile.name,
        "legal_entity": profile.legal_entity,
        "industry": profile.industry,
        "company_size": profile.company_size,
        "geography": profile.geography,
        "regulatory_scope": profile.regulatory_scope,
        "primary_contact_name": profile.primary_contact_name,
        "primary_contact_email": profile.primary_contact_email,
        "primary_contact_phone": profile.primary_contact_phone,
        "address": profile.address,
        "website": profile.website,
        "logo_url": profile.logo_url,
        "settings": profile.settings,
        "created_at": profile.created_at.isoformat() if profile.created_at else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None
    }


@router.put("/organization")
def update_organization_profile(
    data: OrganizationProfileUpdate,
    user: TenantUser = Depends(require_permission("admin:organization:edit")),
    tenant_db: Session = Depends(get_tenant_db)
):
    profile = tenant_db.query(OrganizationProfile).first()
    if not profile:
        profile = OrganizationProfile(name=data.name or "Organization")
        tenant_db.add(profile)
    
    for field, value in data.dict(exclude_unset=True).items():
        setattr(profile, field, value)
    
    profile.updated_at = datetime.utcnow()
    tenant_db.commit()
    tenant_db.refresh(profile)
    
    return {"message": "Organization profile updated", "id": profile.id}


@router.get("/users")
def list_users(
    user: TenantUser = Depends(require_permission("admin:users:view")),
    tenant_db: Session = Depends(get_tenant_db)
):
    users = tenant_db.query(TenantUser).all()
    result = []
    for u in users:
        roles = tenant_db.query(Role).join(UserRole).filter(UserRole.user_id == u.id).all()
        result.append({
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "display_name": u.display_name,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "last_login": u.last_login.isoformat() if u.last_login else None,
            "roles": [{"id": r.id, "name": r.name} for r in roles]
        })
    return result


@router.get("/users/{user_id}")
def get_user(
    user_id: int,
    user: TenantUser = Depends(require_permission("admin:users:view")),
    tenant_db: Session = Depends(get_tenant_db)
):
    target_user = tenant_db.query(TenantUser).filter(TenantUser.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    roles = tenant_db.query(Role).join(UserRole).filter(UserRole.user_id == target_user.id).all()
    
    return {
        "id": target_user.id,
        "username": target_user.username,
        "email": target_user.email,
        "display_name": target_user.display_name,
        "is_active": target_user.is_active,
        "created_at": target_user.created_at.isoformat() if target_user.created_at else None,
        "last_login": target_user.last_login.isoformat() if target_user.last_login else None,
        "roles": [{"id": r.id, "name": r.name} for r in roles]
    }


@router.post("/users", status_code=201)
def create_user(
    data: UserCreate,
    user: TenantUser = Depends(require_permission("admin:users:create")),
    tenant_db: Session = Depends(get_tenant_db)
):
    existing = tenant_db.query(TenantUser).filter(
        (TenantUser.username == data.username) | (TenantUser.email == data.email)
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username or email already exists")
    
    new_user = TenantUser(
        username=data.username,
        email=data.email,
        password_hash=hash_password(data.password),
        display_name=data.display_name or data.username,
        created_by=user.id
    )
    tenant_db.add(new_user)
    tenant_db.commit()
    tenant_db.refresh(new_user)
    
    for role_id in data.role_ids:
        role = tenant_db.query(Role).filter(Role.id == role_id).first()
        if role:
            user_role = UserRole(
                user_id=new_user.id,
                role_id=role_id,
                assigned_by=user.id
            )
            tenant_db.add(user_role)
    tenant_db.commit()
    
    return {
        "message": "User created successfully",
        "user": {
            "id": new_user.id,
            "username": new_user.username,
            "email": new_user.email,
            "display_name": new_user.display_name
        }
    }


@router.put("/users/{user_id}")
def update_user(
    user_id: int,
    data: UserUpdate,
    user: TenantUser = Depends(require_permission("admin:users:edit")),
    tenant_db: Session = Depends(get_tenant_db)
):
    target_user = tenant_db.query(TenantUser).filter(TenantUser.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if data.display_name is not None:
        target_user.display_name = data.display_name
    if data.email is not None:
        existing = tenant_db.query(TenantUser).filter(
            TenantUser.email == data.email,
            TenantUser.id != user_id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")
        target_user.email = data.email
    if data.is_active is not None:
        target_user.is_active = data.is_active
    
    if data.role_ids is not None:
        tenant_db.query(UserRole).filter(UserRole.user_id == user_id).delete()
        for role_id in data.role_ids:
            role = tenant_db.query(Role).filter(Role.id == role_id).first()
            if role:
                user_role = UserRole(
                    user_id=user_id,
                    role_id=role_id,
                    assigned_by=user.id
                )
                tenant_db.add(user_role)
    
    tenant_db.commit()
    return {"message": "User updated successfully"}


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    user: TenantUser = Depends(require_permission("admin:users:delete")),
    tenant_db: Session = Depends(get_tenant_db)
):
    if user_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    
    target_user = tenant_db.query(TenantUser).filter(TenantUser.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    tenant_db.delete(target_user)
    tenant_db.commit()
    
    return {"message": "User deleted successfully"}


@router.get("/roles")
def list_roles(
    user: TenantUser = Depends(require_permission("admin:roles:view")),
    tenant_db: Session = Depends(get_tenant_db)
):
    roles = tenant_db.query(Role).all()
    result = []
    for role in roles:
        perms = tenant_db.query(Permission).join(RolePermission).filter(
            RolePermission.role_id == role.id
        ).all()
        user_count = tenant_db.query(UserRole).filter(UserRole.role_id == role.id).count()
        result.append({
            "id": role.id,
            "name": role.name,
            "description": role.description,
            "is_system_role": role.is_system_role,
            "user_count": user_count,
            "permissions": [p.name for p in perms],
            "created_at": role.created_at.isoformat() if role.created_at else None
        })
    return result


@router.get("/roles/{role_id}")
def get_role(
    role_id: int,
    user: TenantUser = Depends(require_permission("admin:roles:view")),
    tenant_db: Session = Depends(get_tenant_db)
):
    role = tenant_db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    
    perms = tenant_db.query(Permission).join(RolePermission).filter(
        RolePermission.role_id == role.id
    ).all()
    
    return {
        "id": role.id,
        "name": role.name,
        "description": role.description,
        "is_system_role": role.is_system_role,
        "permissions": [p.name for p in perms],
        "created_at": role.created_at.isoformat() if role.created_at else None
    }


@router.post("/roles", status_code=201)
def create_role(
    data: RoleCreate,
    user: TenantUser = Depends(require_permission("admin:roles:create")),
    tenant_db: Session = Depends(get_tenant_db)
):
    existing = tenant_db.query(Role).filter(Role.name == data.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Role name already exists")
    
    role = Role(
        name=data.name,
        description=data.description,
        is_system_role=False
    )
    tenant_db.add(role)
    tenant_db.commit()
    tenant_db.refresh(role)
    
    for perm_name in data.permission_names:
        perm = tenant_db.query(Permission).filter(Permission.name == perm_name).first()
        if perm:
            rp = RolePermission(role_id=role.id, permission_id=perm.id)
            tenant_db.add(rp)
    tenant_db.commit()
    
    return {"message": "Role created successfully", "role": {"id": role.id, "name": role.name}}


@router.put("/roles/{role_id}")
def update_role(
    role_id: int,
    data: RoleUpdate,
    user: TenantUser = Depends(require_permission("admin:roles:edit")),
    tenant_db: Session = Depends(get_tenant_db)
):
    role = tenant_db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    
    if role.is_system_role and role.name == "Administrator":
        raise HTTPException(status_code=400, detail="Cannot modify system Administrator role")
    
    if data.name is not None:
        existing = tenant_db.query(Role).filter(Role.name == data.name, Role.id != role_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Role name already exists")
        role.name = data.name
    
    if data.description is not None:
        role.description = data.description
    
    if data.permission_names is not None:
        tenant_db.query(RolePermission).filter(RolePermission.role_id == role_id).delete()
        for perm_name in data.permission_names:
            perm = tenant_db.query(Permission).filter(Permission.name == perm_name).first()
            if perm:
                rp = RolePermission(role_id=role.id, permission_id=perm.id)
                tenant_db.add(rp)
    
    role.updated_at = datetime.utcnow()
    tenant_db.commit()
    
    return {"message": "Role updated successfully"}


@router.delete("/roles/{role_id}")
def delete_role(
    role_id: int,
    user: TenantUser = Depends(require_permission("admin:roles:delete")),
    tenant_db: Session = Depends(get_tenant_db)
):
    role = tenant_db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    
    if role.is_system_role:
        raise HTTPException(status_code=400, detail="Cannot delete system role")
    
    user_count = tenant_db.query(UserRole).filter(UserRole.role_id == role_id).count()
    if user_count > 0:
        raise HTTPException(status_code=400, detail=f"Role is assigned to {user_count} users. Unassign first.")
    
    tenant_db.delete(role)
    tenant_db.commit()
    
    return {"message": "Role deleted successfully"}


@router.get("/permissions")
def list_permissions(
    user: TenantUser = Depends(require_permission("admin:permissions:view")),
    tenant_db: Session = Depends(get_tenant_db)
):
    return get_all_permissions()


@router.get("/permissions/matrix")
def get_permissions_matrix(
    user: TenantUser = Depends(require_permission("admin:permissions:view")),
    tenant_db: Session = Depends(get_tenant_db)
):
    return get_permission_matrix_for_ui()


@router.get("/audit-logs")
def list_audit_logs(
    limit: int = 100,
    offset: int = 0,
    user: TenantUser = Depends(require_permission("admin:audit_logs:view")),
    tenant_db: Session = Depends(get_tenant_db)
):
    logs = tenant_db.query(AuditLog).order_by(AuditLog.timestamp.desc()).offset(offset).limit(limit).all()
    total = tenant_db.query(AuditLog).count()
    
    result = []
    for log in logs:
        log_user = tenant_db.query(TenantUser).filter(TenantUser.id == log.user_id).first()
        result.append({
            "id": log.id,
            "user_id": log.user_id,
            "user_name": log_user.display_name if log_user else "System",
            "action": log.action,
            "resource_type": log.resource_type,
            "resource_id": log.resource_id,
            "details": log.details,
            "ip_address": log.ip_address,
            "timestamp": log.timestamp.isoformat() if log.timestamp else None
        })
    
    return {"logs": result, "total": total}
