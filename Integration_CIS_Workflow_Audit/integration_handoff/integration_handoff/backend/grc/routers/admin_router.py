import os
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request, Cookie
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text, or_, func, cast, String as SAString
from sqlalchemy.dialects.postgresql import JSONB
from pydantic import BaseModel, EmailStr
import bcrypt

from ..models import Tenant, GRCUser, AuditLog as GlobalAuditLog, get_db
from ..rich_audit import write_rich_audit_log
from ..tenant_manager import (
    get_tenant_session, tenant_session, sanitize_schema_name, IS_SQLITE
)
from ..tenant_models import (
    TenantUser, Role, Permission, RolePermission, UserRole,
    OrganizationProfile
)
from ..permissions import get_permission_matrix_for_ui, get_all_permissions
from .auth_router import decode_token, require_auth, get_current_user

router = APIRouter(prefix="/admin", tags=["Administration"])


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def get_tenant_email_domain(tenant: Tenant) -> Optional[str]:
    if tenant.primary_contact_email and "@" in tenant.primary_contact_email:
        return tenant.primary_contact_email.split("@")[-1].lower().strip()
    if isinstance(tenant.settings, dict):
        domain = tenant.settings.get("email_domain")
        if isinstance(domain, str) and domain:
            return domain.lower().strip()
    return None


def get_tenant_from_request(
    request: Request,
    token: Optional[str] = None,
    db: Session = Depends(get_db)
) -> Tenant:
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
    
    resolved_token = token if isinstance(token, str) else None
    if not resolved_token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            resolved_token = auth_header[7:].strip() or None
    if not resolved_token:
        resolved_token = request.cookies.get("grc_auth_token")

    if resolved_token:
        payload = decode_token(resolved_token)
        if payload:
            tenant_id = payload.get("tenant_id")
            subdomain = payload.get("subdomain")
            if tenant_id:
                tenant = db.query(Tenant).filter(
                    Tenant.id == tenant_id,
                    Tenant.is_active == True
                ).first()
                if tenant:
                    return tenant
            elif subdomain:
                tenant = db.query(Tenant).filter(
                    Tenant.subdomain == subdomain,
                    Tenant.is_active == True
                ).first()
                if tenant:
                    return tenant
    
    raise HTTPException(
        status_code=400,
        detail="Tenant not identified. Use subdomain or X-Tenant-Slug header."
    )


def get_tenant_db(
    request: Request, 
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    db: Session = Depends(get_db)
):
    tenant = get_tenant_from_request(request, token, db)
    if not tenant.schema_name:
        raise HTTPException(status_code=400, detail="Tenant schema not configured")
    
    SessionClass = get_tenant_session(tenant.schema_name)
    tenant_db = SessionClass()
    # Store schema_name in the session for filtering
    tenant_db.info['tenant_schema'] = tenant.schema_name
    try:
        # Ensure search_path is set for this session to isolate schema (PostgreSQL only)
        if not IS_SQLITE:
            tenant_db.execute(text(f'SET search_path TO "{tenant.schema_name}", public'))
        yield tenant_db
    finally:
        tenant_db.close()


def get_current_tenant_user(
    request: Request,
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    tenant_db: Session = Depends(get_tenant_db)
) -> TenantUser:
    resolved_token = token
    if not resolved_token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            resolved_token = auth_header[7:].strip() or None

    if not resolved_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    
    payload = decode_token(resolved_token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    
    # Get tenant schema for filtering (SQLite support)
    tenant_schema = tenant_db.info.get('tenant_schema')
    
    # Filter by tenant_id for SQLite
    if IS_SQLITE:
        user = tenant_db.query(TenantUser).filter(
            TenantUser.username == username,
            TenantUser.tenant_id == tenant_schema
        ).first()
        if not user:
            legacy_user = tenant_db.query(TenantUser).filter(
                TenantUser.username == username,
                or_(TenantUser.tenant_id.is_(None), TenantUser.tenant_id == "")
            ).first()
            if legacy_user:
                legacy_user.tenant_id = tenant_schema
                tenant_db.query(UserRole).filter(
                    UserRole.user_id == legacy_user.id,
                    or_(UserRole.tenant_id.is_(None), UserRole.tenant_id == "")
                ).update({UserRole.tenant_id: tenant_schema}, synchronize_session=False)

                role_ids = [
                    ur.role_id for ur in tenant_db.query(UserRole).filter(
                        UserRole.user_id == legacy_user.id
                    ).all()
                ]
                if role_ids:
                    tenant_db.query(Role).filter(
                        Role.id.in_(role_ids),
                        or_(Role.tenant_id.is_(None), Role.tenant_id == "")
                    ).update({Role.tenant_id: tenant_schema}, synchronize_session=False)

                    tenant_db.query(RolePermission).filter(
                        RolePermission.role_id.in_(role_ids),
                        or_(RolePermission.tenant_id.is_(None), RolePermission.tenant_id == "")
                    ).update({RolePermission.tenant_id: tenant_schema}, synchronize_session=False)

                    perm_ids = [
                        rp.permission_id for rp in tenant_db.query(RolePermission).filter(
                            RolePermission.role_id.in_(role_ids)
                        ).all()
                    ]
                    if perm_ids:
                        tenant_db.query(Permission).filter(
                            Permission.id.in_(perm_ids),
                            or_(Permission.tenant_id.is_(None), Permission.tenant_id == "")
                        ).update({Permission.tenant_id: tenant_schema}, synchronize_session=False)

                tenant_db.commit()
                user = tenant_db.query(TenantUser).filter(
                    TenantUser.username == username,
                    TenantUser.tenant_id == tenant_schema
                ).first()
    else:
        user = tenant_db.query(TenantUser).filter(TenantUser.username == username).first()
    
    if not user:
        raise HTTPException(status_code=401, detail="User not found in this tenant")
    
    return user


def check_permission(user: TenantUser, tenant_db: Session, required_permission: str) -> bool:
    tenant_schema = tenant_db.info.get('tenant_schema')
    
    # Filter user roles by tenant_id for SQLite
    if IS_SQLITE:
        user_roles = tenant_db.query(UserRole).filter(
            UserRole.user_id == user.id,
            UserRole.tenant_id == tenant_schema
        ).all()
    else:
        user_roles = tenant_db.query(UserRole).filter(UserRole.user_id == user.id).all()
    
    if not user_roles:
        return False
    
    role_ids = [ur.role_id for ur in user_roles]
    
    # Filter admin role by tenant_id for SQLite
    if IS_SQLITE:
        admin_role = tenant_db.query(Role).filter(
            Role.id.in_(role_ids),
            Role.name == "Administrator",
            Role.tenant_id == tenant_schema
        ).first()
    else:
        admin_role = tenant_db.query(Role).filter(
            Role.id.in_(role_ids),
            Role.name == "Administrator"
        ).first()
    
    if admin_role:
        return True
    
    # Filter permission by tenant_id for SQLite
    if IS_SQLITE:
        permission = tenant_db.query(Permission).filter(
            Permission.name == required_permission,
            Permission.tenant_id == tenant_schema
        ).first()
    else:
        permission = tenant_db.query(Permission).filter(Permission.name == required_permission).first()
    
    if not permission:
        return False
    
    # Filter role permission by tenant_id for SQLite
    if IS_SQLITE:
        has_perm = tenant_db.query(RolePermission).filter(
            RolePermission.role_id.in_(role_ids),
            RolePermission.permission_id == permission.id,
            RolePermission.tenant_id == tenant_schema
        ).first()
    else:
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
    # Get tenant schema for filtering (SQLite support)
    tenant_schema = tenant_db.info.get('tenant_schema')
    
    # Filter by tenant_id for SQLite, schema isolation for PostgreSQL
    if IS_SQLITE:
        users = tenant_db.query(TenantUser).filter(TenantUser.tenant_id == tenant_schema).all()
    else:
        users = tenant_db.query(TenantUser).all()
    
    result = []
    for u in users:
        # Filter roles by tenant_id for SQLite
        if IS_SQLITE:
            roles = tenant_db.query(Role).join(UserRole).filter(
                UserRole.user_id == u.id,
                Role.tenant_id == tenant_schema
            ).all()
        else:
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
    tenant_schema = tenant_db.info.get('tenant_schema')
    if IS_SQLITE:
        target_user = tenant_db.query(TenantUser).filter(
            TenantUser.id == user_id,
            TenantUser.tenant_id == tenant_schema
        ).first()
    else:
        target_user = tenant_db.query(TenantUser).filter(TenantUser.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if IS_SQLITE:
        roles = tenant_db.query(Role).join(UserRole).filter(
            UserRole.user_id == target_user.id,
            Role.tenant_id == tenant_schema
        ).all()
    else:
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
    tenant_db: Session = Depends(get_tenant_db),
    request: Request = None,
    db: Session = Depends(get_db)
):
    tenant = get_tenant_from_request(request, None, db)
    tenant_domain = get_tenant_email_domain(tenant)
    if tenant_domain and "@" in data.email:
        email_domain = data.email.split("@")[-1].lower().strip()
        if email_domain != tenant_domain:
            raise HTTPException(
                status_code=400,
                detail="User email domain must match the company domain"
            )
    # Get tenant schema for filtering (SQLite support)
    tenant_schema = tenant_db.info.get('tenant_schema')
    
    # Check existing users in this tenant only
    if IS_SQLITE:
        existing = tenant_db.query(TenantUser).filter(
            TenantUser.tenant_id == tenant_schema,
            (TenantUser.username == data.username) | (TenantUser.email == data.email)
        ).first()
    else:
        existing = tenant_db.query(TenantUser).filter(
            (TenantUser.username == data.username) | (TenantUser.email == data.email)
        ).first()
    
    if existing:
        raise HTTPException(status_code=400, detail="Username or email already exists")
    
    # Both SQLite and Postgres schemas declare tenant_id as NOT NULL on the
    # tenant `users` table; in Postgres it stores the schema name (e.g.
    # 'tenant_layerongroupllc') and the search_path puts the INSERT into the
    # right schema. Always populate it.
    new_user = TenantUser(
        tenant_id=tenant_schema,
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
        if IS_SQLITE:
            role = tenant_db.query(Role).filter(
                Role.id == role_id,
                Role.tenant_id == tenant_schema
            ).first()
        else:
            role = tenant_db.query(Role).filter(Role.id == role_id).first()
        if role:
            user_role = UserRole(
                tenant_id=tenant_schema if IS_SQLITE else None,
                user_id=new_user.id,
                role_id=role_id,
                assigned_by=user.id
            )
            tenant_db.add(user_role)
    tenant_db.commit()

    _grc_actor = db.query(GRCUser).filter(GRCUser.username == user.username).first()
    _grc_actor_id = _grc_actor.id if _grc_actor else None
    write_rich_audit_log(
        db=db,
        tenant_id=tenant.id,
        user_id=_grc_actor_id,
        action="create",
        resource_type="admin",
        resource_id=new_user.id,
        resource_name=new_user.display_name or new_user.username,
        summary=f"Created user '{new_user.email}' (display: {new_user.display_name or new_user.username})",
        snapshot={"id": new_user.id, "username": new_user.username, "email": new_user.email,
                  "display_name": new_user.display_name, "is_active": new_user.is_active,
                  "role_ids": data.role_ids},
        resource_url=f"/admin/users/{new_user.id}",
    )
    db.commit()

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
    tenant_db: Session = Depends(get_tenant_db),
    request: Request = None,
    db: Session = Depends(get_db)
):
    tenant = get_tenant_from_request(request, None, db)
    tenant_domain = get_tenant_email_domain(tenant)
    tenant_schema = tenant_db.info.get('tenant_schema')
    if IS_SQLITE:
        target_user = tenant_db.query(TenantUser).filter(
            TenantUser.id == user_id,
            TenantUser.tenant_id == tenant_schema
        ).first()
    else:
        target_user = tenant_db.query(TenantUser).filter(TenantUser.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    _full_before_user = {"id": target_user.id, "username": target_user.username,
                         "email": target_user.email, "display_name": target_user.display_name,
                         "is_active": target_user.is_active}

    if data.display_name is not None:
        target_user.display_name = data.display_name
    if data.email is not None:
        if tenant_domain and "@" in data.email:
            email_domain = data.email.split("@")[-1].lower().strip()
            if email_domain != tenant_domain:
                raise HTTPException(
                    status_code=400,
                    detail="User email domain must match the company domain"
                )
        if IS_SQLITE:
            existing = tenant_db.query(TenantUser).filter(
                TenantUser.email == data.email,
                TenantUser.id != user_id,
                TenantUser.tenant_id == tenant_schema
            ).first()
        else:
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
        if IS_SQLITE:
            tenant_db.query(UserRole).filter(
                UserRole.user_id == user_id,
                UserRole.tenant_id == tenant_schema
            ).delete()
        else:
            tenant_db.query(UserRole).filter(UserRole.user_id == user_id).delete()
        for role_id in data.role_ids:
            if IS_SQLITE:
                role = tenant_db.query(Role).filter(
                    Role.id == role_id,
                    Role.tenant_id == tenant_schema
                ).first()
            else:
                role = tenant_db.query(Role).filter(Role.id == role_id).first()
            if role:
                user_role = UserRole(
                    tenant_id=tenant_schema if IS_SQLITE else None,
                    user_id=user_id,
                    role_id=role_id,
                    assigned_by=user.id
                )
                tenant_db.add(user_role)
    
    tenant_db.commit()

    _full_after_user = {"id": target_user.id, "username": target_user.username,
                        "email": target_user.email, "display_name": target_user.display_name,
                        "is_active": target_user.is_active}
    _changed_user_fields = [k for k in _full_after_user if _full_before_user.get(k) != _full_after_user.get(k)]
    _grc_actor = db.query(GRCUser).filter(GRCUser.username == user.username).first()
    _grc_actor_id = _grc_actor.id if _grc_actor else None
    write_rich_audit_log(
        db=db,
        tenant_id=tenant.id,
        user_id=_grc_actor_id,
        action="update",
        resource_type="admin",
        resource_id=user_id,
        resource_name=target_user.display_name or target_user.username,
        summary=f"Updated user '{target_user.email}': changed {', '.join(_changed_user_fields) or 'profile/roles'}",
        before=_full_before_user,
        after=_full_after_user,
        resource_url=f"/admin/users/{user_id}",
    )
    db.commit()
    return {"message": "User updated successfully"}


@router.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    user: TenantUser = Depends(require_permission("admin:users:delete")),
    tenant_db: Session = Depends(get_tenant_db),
    request: Request = None,
    db: Session = Depends(get_db)
):
    if user_id == user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    
    tenant = get_tenant_from_request(request, None, db)
    tenant_schema = tenant_db.info.get('tenant_schema')
    if IS_SQLITE:
        target_user = tenant_db.query(TenantUser).filter(
            TenantUser.id == user_id,
            TenantUser.tenant_id == tenant_schema
        ).first()
    else:
        target_user = tenant_db.query(TenantUser).filter(TenantUser.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    _saved_snapshot = {"id": target_user.id, "username": target_user.username,
                       "email": target_user.email, "display_name": target_user.display_name}
    _saved_name = target_user.display_name or target_user.username

    tenant_db.delete(target_user)
    tenant_db.commit()

    _grc_actor = db.query(GRCUser).filter(GRCUser.username == user.username).first()
    _grc_actor_id = _grc_actor.id if _grc_actor else None
    write_rich_audit_log(
        db=db,
        tenant_id=tenant.id,
        user_id=_grc_actor_id,
        action="delete",
        resource_type="admin",
        resource_id=user_id,
        resource_name=_saved_name,
        summary=f"Deleted user '{_saved_snapshot['email']}'",
        snapshot=_saved_snapshot,
        resource_url=f"/admin/users/{user_id}",
    )
    db.commit()

    return {"message": "User deleted successfully"}


@router.get("/roles")
def list_roles(
    user: TenantUser = Depends(require_permission("admin:users:view")),
    tenant_db: Session = Depends(get_tenant_db)
):
    # Get tenant schema for filtering (SQLite support)
    tenant_schema = tenant_db.info.get('tenant_schema')
    
    # Filter by tenant_id for SQLite
    if IS_SQLITE:
        roles = tenant_db.query(Role).filter(Role.tenant_id == tenant_schema).all()
    else:
        roles = tenant_db.query(Role).all()
    
    result = []
    for role in roles:
        # Filter permissions and user count by tenant_id for SQLite
        if IS_SQLITE:
            perms = tenant_db.query(Permission).join(RolePermission).filter(
                RolePermission.role_id == role.id,
                RolePermission.tenant_id == tenant_schema,
                Permission.tenant_id == tenant_schema
            ).all()
            user_count = tenant_db.query(UserRole).filter(
                UserRole.role_id == role.id,
                UserRole.tenant_id == tenant_schema
            ).count()
        else:
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
    tenant_schema = tenant_db.info.get('tenant_schema')
    if IS_SQLITE:
        role = tenant_db.query(Role).filter(
            Role.id == role_id,
            Role.tenant_id == tenant_schema
        ).first()
    else:
        role = tenant_db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    
    if IS_SQLITE:
        perms = tenant_db.query(Permission).join(RolePermission).filter(
            RolePermission.role_id == role.id,
            Permission.tenant_id == tenant_schema
        ).all()
    else:
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
    tenant_db: Session = Depends(get_tenant_db),
    request: Request = None,
    db: Session = Depends(get_db)
):
    tenant = get_tenant_from_request(request, None, db)
    tenant_schema = tenant_db.info.get('tenant_schema')
    if IS_SQLITE:
        existing = tenant_db.query(Role).filter(
            Role.name == data.name,
            Role.tenant_id == tenant_schema
        ).first()
    else:
        existing = tenant_db.query(Role).filter(Role.name == data.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Role name already exists")
    
    role = Role(
        tenant_id=tenant_schema if IS_SQLITE else None,
        name=data.name,
        description=data.description,
        is_system_role=False
    )
    tenant_db.add(role)
    tenant_db.commit()
    tenant_db.refresh(role)
    
    for perm_name in data.permission_names:
        if IS_SQLITE:
            perm = tenant_db.query(Permission).filter(
                Permission.name == perm_name,
                Permission.tenant_id == tenant_schema
            ).first()
        else:
            perm = tenant_db.query(Permission).filter(Permission.name == perm_name).first()
        if perm:
            rp = RolePermission(
                tenant_id=tenant_schema if IS_SQLITE else None,
                role_id=role.id,
                permission_id=perm.id
            )
            tenant_db.add(rp)
    tenant_db.commit()

    _grc_actor = db.query(GRCUser).filter(GRCUser.username == user.username).first()
    _grc_actor_id = _grc_actor.id if _grc_actor else None
    write_rich_audit_log(
        db=db,
        tenant_id=tenant.id,
        user_id=_grc_actor_id,
        action="create",
        resource_type="admin",
        resource_id=role.id,
        resource_name=role.name,
        summary=f"Created role '{role.name}' with {len(data.permission_names)} permission(s)",
        snapshot={"id": role.id, "name": role.name, "description": role.description,
                  "permissions": list(data.permission_names)},
        resource_url=f"/admin/roles/{role.id}",
    )
    db.commit()

    return {"message": "Role created successfully", "role": {"id": role.id, "name": role.name}}


@router.put("/roles/{role_id}")
def update_role(
    role_id: int,
    data: RoleUpdate,
    user: TenantUser = Depends(require_permission("admin:roles:edit")),
    tenant_db: Session = Depends(get_tenant_db),
    request: Request = None,
    db: Session = Depends(get_db)
):
    tenant_schema = tenant_db.info.get('tenant_schema')
    if IS_SQLITE:
        role = tenant_db.query(Role).filter(
            Role.id == role_id,
            Role.tenant_id == tenant_schema
        ).first()
    else:
        role = tenant_db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    
    if role.is_system_role and role.name == "Administrator":
        raise HTTPException(status_code=400, detail="Cannot modify system Administrator role")

    _full_before_role = {"id": role.id, "name": role.name, "description": role.description}

    if data.name is not None:
        if IS_SQLITE:
            existing = tenant_db.query(Role).filter(
                Role.name == data.name,
                Role.id != role_id,
                Role.tenant_id == tenant_schema
            ).first()
        else:
            existing = tenant_db.query(Role).filter(Role.name == data.name, Role.id != role_id).first()
        if existing:
            raise HTTPException(status_code=400, detail="Role name already exists")
        role.name = data.name
    
    if data.description is not None:
        role.description = data.description
    
    if data.permission_names is not None:
        if IS_SQLITE:
            tenant_db.query(RolePermission).filter(
                RolePermission.role_id == role_id,
                RolePermission.tenant_id == tenant_schema
            ).delete()
        else:
            tenant_db.query(RolePermission).filter(RolePermission.role_id == role_id).delete()
        for perm_name in data.permission_names:
            if IS_SQLITE:
                perm = tenant_db.query(Permission).filter(
                    Permission.name == perm_name,
                    Permission.tenant_id == tenant_schema
                ).first()
            else:
                perm = tenant_db.query(Permission).filter(Permission.name == perm_name).first()
            if perm:
                rp = RolePermission(
                    tenant_id=tenant_schema if IS_SQLITE else None,
                    role_id=role.id,
                    permission_id=perm.id
                )
                tenant_db.add(rp)
    
    role.updated_at = datetime.utcnow()
    tenant_db.commit()

    _full_after_role = {"id": role.id, "name": role.name, "description": role.description,
                        "permissions": list(data.permission_names or [])}
    _changed_role_fields = [k for k in ["name", "description"] if _full_before_role.get(k) != _full_after_role.get(k)]
    if data.permission_names is not None:
        _changed_role_fields.append("permissions")
    tenant = get_tenant_from_request(request, None, db)
    _grc_actor = db.query(GRCUser).filter(GRCUser.username == user.username).first()
    _grc_actor_id = _grc_actor.id if _grc_actor else None
    write_rich_audit_log(
        db=db,
        tenant_id=tenant.id,
        user_id=_grc_actor_id,
        action="update",
        resource_type="admin",
        resource_id=role_id,
        resource_name=role.name,
        summary=f"Updated role '{role.name}': changed {', '.join(_changed_role_fields) or 'settings'}",
        before=_full_before_role,
        after=_full_after_role,
        resource_url=f"/admin/roles/{role_id}",
    )
    db.commit()

    return {"message": "Role updated successfully"}


@router.delete("/roles/{role_id}")
def delete_role(
    role_id: int,
    user: TenantUser = Depends(require_permission("admin:roles:delete")),
    tenant_db: Session = Depends(get_tenant_db),
    request: Request = None,
    db: Session = Depends(get_db)
):
    tenant_schema = tenant_db.info.get('tenant_schema')
    if IS_SQLITE:
        role = tenant_db.query(Role).filter(
            Role.id == role_id,
            Role.tenant_id == tenant_schema
        ).first()
    else:
        role = tenant_db.query(Role).filter(Role.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    
    if role.is_system_role:
        raise HTTPException(status_code=400, detail="Cannot delete system role")
    
    if IS_SQLITE:
        user_count = tenant_db.query(UserRole).filter(
            UserRole.role_id == role_id,
            UserRole.tenant_id == tenant_schema
        ).count()
    else:
        user_count = tenant_db.query(UserRole).filter(UserRole.role_id == role_id).count()
    if user_count > 0:
        raise HTTPException(status_code=400, detail=f"Role is assigned to {user_count} users. Unassign first.")
    
    _saved_name = role.name
    _saved_id = role.id
    _saved_snapshot = {"id": role.id, "name": role.name, "description": role.description}

    tenant_db.delete(role)
    tenant_db.commit()

    tenant = get_tenant_from_request(request, None, db)
    _grc_actor = db.query(GRCUser).filter(GRCUser.username == user.username).first()
    _grc_actor_id = _grc_actor.id if _grc_actor else None
    write_rich_audit_log(
        db=db,
        tenant_id=tenant.id,
        user_id=_grc_actor_id,
        action="delete",
        resource_type="admin",
        resource_id=_saved_id,
        resource_name=_saved_name,
        summary=f"Deleted role '{_saved_name}'",
        snapshot=_saved_snapshot,
        resource_url=f"/admin/roles/{_saved_id}",
    )
    db.commit()

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
    request: Request,
    limit: int = 100,
    offset: int = 0,
    action: Optional[str] = None,
    exclude_action: Optional[str] = None,
    module: Optional[str] = None,
    user_id: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    actor_type: Optional[str] = None,
    search: Optional[str] = None,
    user: TenantUser = Depends(require_permission("admin:audit_logs:view")),
    tenant_db: Session = Depends(get_tenant_db),
    db: Session = Depends(get_db)
):
    tenant = get_tenant_from_request(request, db=db)

    query = db.query(GlobalAuditLog).filter(GlobalAuditLog.tenant_id == tenant.id)

    if action:
        query = query.filter(GlobalAuditLog.action.ilike(f"%{action}%"))
    if exclude_action:
        for ea in exclude_action.split(","):
            ea = ea.strip()
            if ea:
                query = query.filter(~GlobalAuditLog.action.ilike(f"%{ea}%"))
    if module:
        query = query.filter(GlobalAuditLog.resource_type.ilike(f"%{module}%"))
    if user_id:
        query = query.filter(GlobalAuditLog.user_id == user_id)

    if start_date:
        try:
            start_dt = datetime.strptime(start_date, "%Y-%m-%d")
            query = query.filter(GlobalAuditLog.timestamp >= start_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format. Use YYYY-MM-DD")

    if end_date:
        try:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)
            query = query.filter(GlobalAuditLog.timestamp < end_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format. Use YYYY-MM-DD")

    if actor_type:
        if IS_SQLITE:
            actor_val = func.json_extract(GlobalAuditLog.changes, '$.actor_type')
            if actor_type == "workflow_engine":
                query = query.filter(actor_val == "workflow_engine")
            elif actor_type == "user":
                query = query.filter(or_(actor_val == "user", actor_val.is_(None)))
        else:
            # Postgres path: avoid CAST(changes AS jsonb) because the json
            # column may legally contain "" which JSONB rejects, blowing
            # up the entire list query. Instead pattern-match the serialized
            # text — actor_type values are simple strings and the field is
            # always written at the top level of `changes`.
            changes_text = cast(GlobalAuditLog.changes, SAString)
            if actor_type == "workflow_engine":
                query = query.filter(changes_text.ilike('%"actor_type": "workflow_engine"%'))
            elif actor_type == "user":
                query = query.filter(
                    or_(
                        changes_text.ilike('%"actor_type": "user"%'),
                        ~changes_text.ilike('%"actor_type":%'),
                    )
                )

    if search:
        search_term = f"%{search}%"
        changes_text = cast(GlobalAuditLog.changes, SAString)
        query = query.filter(
            or_(
                changes_text.ilike(search_term),
                GlobalAuditLog.resource_type.ilike(search_term),
                GlobalAuditLog.action.ilike(search_term),
            )
        )

    total = query.count()
    logs = query.order_by(GlobalAuditLog.timestamp.desc()).offset(offset).limit(limit).all()

    result = []
    for log in logs:
        log_user = None
        if log.user_id:
            log_user = db.query(GRCUser).filter(GRCUser.id == log.user_id).first()

        import json as _json
        if isinstance(log.changes, dict):
            changes = log.changes
        elif isinstance(log.changes, str):
            try:
                changes = _json.loads(log.changes)
            except Exception:
                changes = {}
        else:
            changes = {}
        _actor_type = changes.get("actor_type", "user")
        _display_name = log_user.display_name if log_user else ("Workflow Engine" if _actor_type == "workflow_engine" else "System")
        result.append({
            "id": log.id,
            "user_id": log.user_id,
            "user_name": _display_name,
            "action": log.action,
            "resource_type": log.resource_type,
            "resource_id": log.resource_id,
            "details": changes,
            "method": changes.get("method"),
            "path": changes.get("path"),
            "status_code": changes.get("status_code"),
            "duration_ms": changes.get("duration_ms"),
            "ip_address": log.ip_address,
            "timestamp": log.timestamp.isoformat() if log.timestamp else None,
            "actor_type": _actor_type,
            "summary": changes.get("summary"),
            "ai_summary": changes.get("ai_summary"),
            "resource_name": changes.get("resource_name"),
            "resource_url": changes.get("resource_url"),
            "before": changes.get("before"),
            "after": changes.get("after"),
            "snapshot": changes.get("snapshot"),
            "field_diff": changes.get("field_diff"),
        })

    return {"logs": result, "total": total}


@router.post("/audit-logs/{log_id}/ai-summary")
def generate_audit_log_ai_summary(
    log_id: int,
    request: Request,
    force: bool = False,
    user: TenantUser = Depends(require_permission("admin:audit_logs:view")),
    db: Session = Depends(get_db),
):
    """Generate (or return cached) one-sentence natural-language summary for
    an audit log row. Result is cached in `changes.ai_summary`.
    """
    from ..audit_ai_summary import generate_ai_summary
    import json as _json

    tenant = get_tenant_from_request(request, db=db)

    log = db.query(GlobalAuditLog).filter(
        GlobalAuditLog.id == log_id,
        GlobalAuditLog.tenant_id == tenant.id,
    ).first()
    if not log:
        raise HTTPException(status_code=404, detail="Audit log not found")

    if isinstance(log.changes, dict):
        changes = dict(log.changes)
    elif isinstance(log.changes, str):
        try:
            changes = _json.loads(log.changes)
        except Exception:
            changes = {}
    else:
        changes = {}

    cached = changes.get("ai_summary")
    if cached and not force:
        return {"ai_summary": cached, "cached": True}

    log_user = None
    if log.user_id:
        log_user = db.query(GRCUser).filter(GRCUser.id == log.user_id).first()
    _actor_type = changes.get("actor_type", "user")
    row_for_ai = {
        "user_name": log_user.display_name if log_user else (
            "Workflow Engine" if _actor_type == "workflow_engine" else "System"
        ),
        "actor_type": _actor_type,
        "action": log.action,
        "resource_type": log.resource_type,
        "resource_id": log.resource_id,
        "resource_name": changes.get("resource_name"),
        "method": changes.get("method"),
        "path": changes.get("path"),
        "status_code": changes.get("status_code"),
        "summary": changes.get("summary"),
        "request": changes.get("request"),
        "snapshot": changes.get("snapshot"),
        "field_diff": changes.get("field_diff"),
        "response_error": changes.get("response_error"),
    }

    summary = generate_ai_summary(row_for_ai)
    if not summary:
        # Fall back to the template summary so the UI still has something.
        return {"ai_summary": changes.get("summary"), "cached": False, "fallback": True}

    changes["ai_summary"] = summary
    log.changes = changes
    # Force the JSON column to mark dirty in SQLAlchemy
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(log, "changes")
    db.commit()

    return {"ai_summary": summary, "cached": False}


@router.get("/audit-logs/filters")
def get_audit_log_filters(
    request: Request,
    user: TenantUser = Depends(require_permission("admin:audit_logs:view")),
    tenant_db: Session = Depends(get_tenant_db),
    db: Session = Depends(get_db)
):
    tenant = get_tenant_from_request(request, db=db)

    base_query = db.query(GlobalAuditLog).filter(GlobalAuditLog.tenant_id == tenant.id)

    historic_actions = {
        row[0] for row in base_query.with_entities(GlobalAuditLog.action).distinct().all()
        if row[0]
    }
    # Always expose the canonical CRUD verbs (and their _failed siblings) so the
    # filter is usable from day one, even before a tenant has produced one of
    # each event type. Backend middleware emits all of these (audit_logger.py
    # `_action_from_method`).
    canonical_actions = {
        "create", "create_failed",
        "read",
        "update", "update_failed",
        "delete", "delete_failed",
    }
    actions = sorted(historic_actions | canonical_actions)

    modules = [
        row[0] for row in base_query.with_entities(GlobalAuditLog.resource_type).distinct().order_by(GlobalAuditLog.resource_type).all()
        if row[0]
    ]

    return {
        "actions": actions,
        "modules": modules,
        "date_presets": ["all", "today", "last_7_days", "last_30_days"],
        "actor_types": ["user", "workflow_engine"],
    }
