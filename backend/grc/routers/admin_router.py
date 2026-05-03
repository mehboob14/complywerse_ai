import os
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request, Cookie
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text, or_
from pydantic import BaseModel, EmailStr
import bcrypt

from ..models import (
    AuditLog as GlobalAuditLog,
    GRCUser,
    GRCUser as TenantUser,
    Permission,
    Role,
    RolePermission,
    Tenant,
    UserRole,
    get_db,
)
from ..db import open_tenant_session

# Per-database-per-tenant: each tenant DB carries the full schema. The legacy
# `OrganizationProfile` model lived in a now-deleted per-schema base; the
# tenant's own self-row in `grc_tenants` plays that role.
OrganizationProfile = Tenant

from ..permissions import get_permission_matrix_for_ui, get_all_permissions
from .auth_router import decode_token, require_auth, get_current_user


def _generate_audit_description(
    action: str,
    resource_type: str,
    resource_id: Optional[int],
    path: str,
    request_payload: Optional[dict],
) -> str:
    """Return a plain-English summary of an audit log action."""
    payload = request_payload or {}
    path_lower = (path or "").lower()
    segments = [s for s in (path or "").replace("/grc", "", 1).strip("/").split("/") if s]
    last_seg = segments[-1] if segments else ""

    def _name() -> Optional[str]:
        for k in ("title", "name", "vendor_name", "framework_name", "display_name",
                  "subject", "label", "filename", "file_name"):
            v = payload.get(k)
            if v and isinstance(v, str) and len(v.strip()) < 120:
                return v.strip()
        return None

    RT: dict[str, str] = {
        "risks": "risk", "evidence": "evidence", "vulnerabilities": "vulnerability",
        "frameworks": "framework", "controls": "control", "governance": "document",
        "compliance": "compliance item", "vendor_risk": "vendor",
        "audits": "audit", "assessments": "assessment", "statements": "statement",
        "documents": "document", "assets": "asset", "users": "user",
        "integrations": "integration", "workflow": "workflow",
        "system": "system", "chatbot": "chat",
    }
    rt = RT.get(resource_type, resource_type.replace("_", " ") if resource_type else "record")
    id_part = f" #{resource_id}" if resource_id else ""
    nm = _name()
    nm_part = f' "{nm}"' if nm else ""

    # Gap analysis
    if "gap-analysis" in path_lower or "gap_analysis" in path_lower:
        doc = payload.get("document_name") or payload.get("document") or payload.get("policy_name")
        fw = payload.get("framework_name") or payload.get("framework")
        fw_id = payload.get("framework_id")
        parts = []
        if doc:
            parts.append(f'"{doc}"')
        if fw:
            parts.append(f'framework "{fw}"')
        elif fw_id:
            parts.append(f"framework #{fw_id}")
        if parts:
            return "Ran gap analysis: " + " against ".join(parts)
        return "Ran gap analysis"

    # Assessment start
    if last_seg in ("start", "begin", "initiate") or (
        "start" in last_seg and "assessment" in path_lower
    ):
        return f"Started assessment{id_part}"

    # Status update via dedicated /status endpoint
    if last_seg == "status":
        new_status = payload.get("status") or payload.get("new_status") or payload.get("value")
        if isinstance(new_status, str):
            return f'Updated {rt}{id_part} status to "{new_status}"'
        return f"Updated {rt}{id_part} status"

    # File/multipart upload
    if payload.get("multipart"):
        module_label = {"evidence": "evidence", "frameworks": "framework",
                        "governance": "document", "documents": "document"}.get(resource_type, rt)
        filename = payload.get("filename") or payload.get("file_name") or nm or "file"
        return f'Uploaded {module_label} "{filename}"'

    # Auth events
    if "login" in path_lower and action == "create":
        return "User logged in"
    if "logout" in path_lower:
        return "User logged out"

    # Cross-link / relationship
    if "cross-link" in path_lower or "crosslink" in path_lower:
        return f"Linked {rt}{id_part} to another record"

    # Generic action-based
    if action == "create":
        if resource_type == "evidence":
            return f"Uploaded evidence{nm_part}"
        if resource_type == "frameworks":
            return f"Uploaded framework{nm_part}"
        if nm:
            return f'Created {rt} "{nm}"'
        return f"Created new {rt}{id_part}"

    if action == "update":
        status_val = payload.get("status")
        if isinstance(status_val, str):
            return f'Updated {rt}{id_part} status to "{status_val}"'
        if nm:
            return f'Updated {rt} "{nm}"'
        return f"Updated {rt}{id_part}"

    if action == "delete":
        if nm:
            return f'Deleted {rt} "{nm}"'
        return f"Deleted {rt}{id_part}"

    if action == "read":
        return f"Viewed {rt} #{resource_id}" if resource_id else f"Viewed {rt} list"

    if action.endswith("_failed"):
        base = action.replace("_failed", "")
        return f"Failed to {base} {rt}{nm_part or id_part}"

    action_display = action.replace("_", " ").title()
    return f"{action_display} {rt}{nm_part or id_part}"

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
    """Return the request's Tenant as an ORM row.

    `request.state.tenant` is a detached dict (set by middleware to avoid
    lazy-loading after the master session closes), so we always re-query the
    current DB to hand callers a real ORM object whose attributes can be read.
    """
    state_tenant = getattr(request.state, "tenant", None)
    state_slug = None
    if isinstance(state_tenant, dict):
        state_slug = state_tenant.get("slug")
    elif state_tenant is not None:
        state_slug = getattr(state_tenant, "slug", None)

    if state_slug:
        tenant = db.query(Tenant).filter(
            Tenant.slug == state_slug,
            Tenant.is_active == True,
        ).first()
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
            tenant_slug = payload.get("tenant_slug") or payload.get("subdomain")
            tenant_id = payload.get("tenant_id")
            if tenant_slug:
                tenant = db.query(Tenant).filter(
                    Tenant.slug == tenant_slug,
                    Tenant.is_active == True,
                ).first()
                if tenant:
                    return tenant
            if tenant_id:
                tenant = db.query(Tenant).filter(
                    Tenant.id == tenant_id,
                    Tenant.is_active == True,
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
    db: Session = Depends(get_db),
):
    """Yield a session bound to the tenant identified by the request.

    Per-database-per-tenant: the tenant slug routes us to a dedicated DB.
    """
    tenant = get_tenant_from_request(request, token, db)
    tenant_db = open_tenant_session(tenant.slug)
    tenant_db.info['tenant_schema'] = tenant.slug
    try:
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
    
    user = tenant_db.query(TenantUser).filter(TenantUser.username == username).first()

    if not user:
        raise HTTPException(status_code=401, detail="User not found in this tenant")

    return user


def check_permission(user: TenantUser, tenant_db: Session, required_permission: str) -> bool:
    # Primary-contact bypass: the email registered as the tenant's primary
    # contact gets administrator-grade access without needing a UserRole row.
    # Mirrors auth_router.require_tenant_permission so admin endpoints work
    # for the founding admin before any RBAC is configured.
    tenant_row = tenant_db.query(Tenant).first()
    if (
        tenant_row
        and tenant_row.primary_contact_email
        and getattr(user, "email", None)
        and tenant_row.primary_contact_email.lower() == user.email.lower()
    ):
        return True

    user_roles = tenant_db.query(UserRole).filter(UserRole.user_id == user.id).all()
    if not user_roles:
        return False
    role_ids = [ur.role_id for ur in user_roles]

    admin_role = tenant_db.query(Role).filter(
        Role.id.in_(role_ids),
        Role.name == "Administrator",
    ).first()
    if admin_role:
        return True

    permission = tenant_db.query(Permission).filter(Permission.name == required_permission).first()
    if not permission:
        return False

    has_perm = tenant_db.query(RolePermission).filter(
        RolePermission.role_id.in_(role_ids),
        RolePermission.permission_id == permission.id,
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
    
    # OrganizationProfile is now an alias for the tenant's self-row in `grc_tenants`,
    # which doesn't carry the legacy address/website/logo_url/updated_at columns.
    # Use getattr with defaults so existing UI fields render as empty rather than 500.
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
        "address": getattr(profile, "address", None),
        "website": getattr(profile, "website", None),
        "logo_url": getattr(profile, "logo_url", None),
        "settings": getattr(profile, "settings", None),
        "created_at": profile.created_at.isoformat() if getattr(profile, "created_at", None) else None,
        "updated_at": profile.updated_at.isoformat() if getattr(profile, "updated_at", None) else None,
    }


@router.put("/organization")
def update_organization_profile(
    data: OrganizationProfileUpdate,
    user: TenantUser = Depends(require_permission("admin:organization:edit")),
    tenant_db: Session = Depends(get_tenant_db)
):
    profile = tenant_db.query(OrganizationProfile).first()
    if not profile:
        # Should never happen — provisioning inserts a self-row — but degrade gracefully.
        raise HTTPException(status_code=404, detail="Tenant profile not found")

    # Only assign fields that actually exist on the Tenant model (skip legacy
    # OrganizationProfile-only fields like address/website/logo_url).
    profile_columns = {c.name for c in profile.__table__.columns}
    for field, value in data.dict(exclude_unset=True).items():
        if field in profile_columns:
            setattr(profile, field, value)

    if "updated_at" in profile_columns:
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
    local_tenant_id = tenant.id

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
    )
    tenant_db.add(new_user)
    tenant_db.commit()
    tenant_db.refresh(new_user)

    for role_id in data.role_ids:
        role = tenant_db.query(Role).filter(Role.id == role_id).first()
        if role:
            user_role = UserRole(
                tenant_id=local_tenant_id,
                user_id=new_user.id,
                role_id=role_id,
                assigned_by=user.id,
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
    tenant_db: Session = Depends(get_tenant_db),
    request: Request = None,
    db: Session = Depends(get_db)
):
    tenant = get_tenant_from_request(request, None, db)
    tenant_domain = get_tenant_email_domain(tenant)
    local_tenant_id = tenant.id

    target_user = tenant_db.query(TenantUser).filter(TenantUser.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

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
        existing = tenant_db.query(TenantUser).filter(
            TenantUser.email == data.email,
            TenantUser.id != user_id,
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
                    tenant_id=local_tenant_id,
                    user_id=user_id,
                    role_id=role_id,
                    assigned_by=user.id,
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
    user: TenantUser = Depends(require_permission("admin:users:view")),
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
    local_tenant_id = (tenant_db.query(Tenant).first() or Tenant()).id

    existing = tenant_db.query(Role).filter(Role.name == data.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Role name already exists")

    role = Role(
        tenant_id=local_tenant_id,
        name=data.name,
        description=data.description,
        is_system_role=False,
    )
    tenant_db.add(role)
    tenant_db.commit()
    tenant_db.refresh(role)

    for perm_name in data.permission_names:
        perm = tenant_db.query(Permission).filter(Permission.name == perm_name).first()
        if perm:
            rp = RolePermission(
                role_id=role.id,
                permission_id=perm.id,
            )
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

    local_tenant_id = (tenant_db.query(Tenant).first() or Tenant()).id

    if data.name is not None:
        existing = tenant_db.query(Role).filter(
            Role.name == data.name, Role.id != role_id
        ).first()
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
                rp = RolePermission(
                    role_id=role.id,
                    permission_id=perm.id,
                )
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
    request: Request,
    limit: int = 100,
    offset: int = 0,
    action: Optional[str] = None,
    module: Optional[str] = None,
    user_id: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    user: TenantUser = Depends(require_permission("admin:audit_logs:view")),
    tenant_db: Session = Depends(get_tenant_db),
    db: Session = Depends(get_db)
):
    tenant = get_tenant_from_request(request, db=db)

    query = db.query(GlobalAuditLog).filter(GlobalAuditLog.tenant_id == tenant.id)

    if action:
        query = query.filter(GlobalAuditLog.action.ilike(f"%{action}%"))
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

    total = query.count()
    logs = query.order_by(GlobalAuditLog.timestamp.desc()).offset(offset).limit(limit).all()

    result = []
    for log in logs:
        log_user = None
        if log.user_id:
            log_user = db.query(GRCUser).filter(GRCUser.id == log.user_id).first()

        changes = log.changes if isinstance(log.changes, dict) else {}

        # Resolve display name: DB lookup → stored actor_display → stored actor → fallback
        if log_user:
            user_name = log_user.display_name or log_user.username
        else:
            user_name = (
                changes.get("actor_display")
                or changes.get("actor")
                or "Unknown User"
            )

        description = _generate_audit_description(
            action=log.action,
            resource_type=log.resource_type,
            resource_id=log.resource_id,
            path=changes.get("path", ""),
            request_payload=changes.get("request"),
        )

        result.append({
            "id": log.id,
            "user_id": log.user_id,
            "user_name": user_name,
            "action": log.action,
            "resource_type": log.resource_type,
            "resource_id": log.resource_id,
            "description": description,
            "details": changes,
            "method": changes.get("method"),
            "path": changes.get("path"),
            "status_code": changes.get("status_code"),
            "duration_ms": changes.get("duration_ms"),
            "ip_address": log.ip_address,
            "timestamp": log.timestamp.isoformat() if log.timestamp else None
        })

    return {"logs": result, "total": total}


@router.get("/audit-logs/filters")
def get_audit_log_filters(
    request: Request,
    user: TenantUser = Depends(require_permission("admin:audit_logs:view")),
    tenant_db: Session = Depends(get_tenant_db),
    db: Session = Depends(get_db)
):
    tenant = get_tenant_from_request(request, db=db)

    base_query = db.query(GlobalAuditLog).filter(GlobalAuditLog.tenant_id == tenant.id)

    actions = [
        row[0] for row in base_query.with_entities(GlobalAuditLog.action).distinct().order_by(GlobalAuditLog.action).all()
        if row[0]
    ]
    modules = [
        row[0] for row in base_query.with_entities(GlobalAuditLog.resource_type).distinct().order_by(GlobalAuditLog.resource_type).all()
        if row[0]
    ]

    return {
        "actions": actions,
        "modules": modules,
        "date_presets": ["all", "today", "last_7_days", "last_30_days"],
    }
