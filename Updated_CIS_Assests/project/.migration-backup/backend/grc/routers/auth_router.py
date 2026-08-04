import os
import secrets
import urllib.parse
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Cookie, Header, Request
from fastapi.responses import JSONResponse, HTMLResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
import bcrypt
import requests as http_requests
from jose import jwt, JWTError

from ..models import GRCUser, TenantUser, Tenant, BusinessUnit, Role, UserRole, get_db
from ..schemas import UserCreate, UserLogin, UserResponse, TokenResponse, OrganizationRegisterRequest
from ..tenant_manager import (
    full_tenant_provisioning, sanitize_schema_name, get_tenant_session, IS_SQLITE
)
from ..tenant_models import TenantUser as TenantSchemaUser, Role as TenantRole, UserRole as TenantUserRole, Permission as TenantPermission, RolePermission as TenantRolePermission

router = APIRouter(prefix="/auth", tags=["Authentication"])

SECRET_KEY = os.getenv("SESSION_SECRET")
if not SECRET_KEY:
    raise RuntimeError("SESSION_SECRET environment variable is required for security. Please set it.")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24
TOKEN_REFRESH_THRESHOLD_HOURS = 6


PERSONAL_EMAIL_DOMAINS = {
    'gmaiil.com', "test.om"
   
}


def is_corporate_email(email: str) -> bool:
    try:
        domain = email.lower().split('@')[1]
        return domain not in PERSONAL_EMAIL_DOMAINS
    except (IndexError, AttributeError):
        return False


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))
    except (ValueError, Exception):
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    to_encode.update({"exp": expire, "iat": datetime.utcnow()})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def require_platform_admin(
    request: Request,
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> GRCUser:
    """Dependency that allows the call only if the authenticated user is
    listed in COMPLIVERSE_PLATFORM_ADMINS (comma-separated usernames in
    the backend .env).

    Per Hassan: benchmark ingestion is a Compliverse-team-only operation.
    Tenants never upload benchmarks. This is the hard gate for any
    endpoint that mutates the shared global benchmark library —
    /ingest, /ingest/{id}/reparse, /benchmarks/promote, etc.

    Fail-safe deny: if the env var is empty / unset, NO ONE can pass.
    The dev/operator must explicitly add their username before they can
    upload. Prevents a fresh deploy from accidentally being permissive.
    """
    user = get_current_user(request=request, token=token, authorization=authorization, db=db)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    allow_list = [
        u.strip() for u in
        os.environ.get("COMPLIVERSE_PLATFORM_ADMINS", "").split(",")
        if u.strip()
    ]
    if not allow_list or user.username not in allow_list:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This endpoint is restricted to Compliverse platform "
                "administrators. Tenants do not upload benchmarks; "
                "Compliverse ingests them centrally."
            ),
        )
    return user


def should_refresh_token(payload: dict) -> bool:
    iat = payload.get("iat")
    if not iat:
        return True
    issued_at = datetime.utcfromtimestamp(iat)
    hours_since_issue = (datetime.utcnow() - issued_at).total_seconds() / 3600
    return hours_since_issue > TOKEN_REFRESH_THRESHOLD_HOURS


def set_auth_cookie(response: JSONResponse, token: str) -> None:
    is_production = os.environ.get("REPL_DEPLOYMENT", "") == "1"
    response.set_cookie(
        key="grc_auth_token",
        value=token,
        httponly=True,
        secure=is_production,
        samesite="lax",
        max_age=ACCESS_TOKEN_EXPIRE_HOURS * 3600,
        path="/"
    )


def get_user_tenants(user: GRCUser, db: Session) -> List[int]:
    tenant_users = db.query(TenantUser).filter(TenantUser.user_id == user.id).all()
    return [tu.tenant_id for tu in tenant_users]


def get_user_primary_tenant(user: GRCUser, db: Session) -> Optional[int]:
    primary = db.query(TenantUser).filter(
        TenantUser.user_id == user.id,
        TenantUser.is_primary == True
    ).first()
    if primary:
        return primary.tenant_id
    first_tenant = db.query(TenantUser).filter(TenantUser.user_id == user.id).first()
    return first_tenant.tenant_id if first_tenant else None


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value:
        return None
    return value.strip() or None


def get_current_user(
    request: Request,
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    db: Session = Depends(get_db)
) -> Optional[GRCUser]:
    resolved_token = token or _extract_bearer_token(authorization) or _extract_bearer_token(request.headers.get("authorization"))
    if not resolved_token:
        return None
    payload = decode_token(resolved_token)
    if not payload:
        return None
    username = payload.get("sub")
    if not username:
        return None
    
    user = db.query(GRCUser).filter(GRCUser.username == username).first()
    
    if not user:
        schema_name = payload.get("schema_name")
        tenant_id = payload.get("tenant_id")
        if schema_name and tenant_id:
            try:
                SessionClass = get_tenant_session(schema_name)
                tenant_db = SessionClass()
                if not IS_SQLITE:
                    tenant_db.execute(text(f'SET search_path TO "{schema_name}", public'))
                tenant_user = tenant_db.query(TenantSchemaUser).filter(
                    TenantSchemaUser.username == username
                ).first()
                if tenant_user:
                    t_email = tenant_user.email
                    t_display = tenant_user.display_name
                    t_active = tenant_user.is_active
                    tenant_db.close()
                    
                    user = GRCUser(
                        username=username,
                        email=t_email,
                        password_hash="tenant_managed",
                        display_name=t_display,
                        is_active=t_active
                    )
                    db.add(user)
                    db.commit()
                    db.refresh(user)
                    
                    existing_link = db.query(TenantUser).filter(
                        TenantUser.user_id == user.id,
                        TenantUser.tenant_id == tenant_id
                    ).first()
                    if not existing_link:
                        link = TenantUser(
                            user_id=user.id,
                            tenant_id=tenant_id,
                            is_primary=True
                        )
                        db.add(link)
                        db.commit()
                    
                    return user
                tenant_db.close()
            except Exception:
                pass
    
    return user


def require_auth(
    request: Request,
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    db: Session = Depends(get_db)
) -> GRCUser:
    user = get_current_user(request=request, token=token, authorization=authorization, db=db)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is deactivated"
        )
    return user


def require_tenant_permission(permission_name: str):
    def permission_checker(
        request: Request,
        token: Optional[str] = Cookie(None, alias="grc_auth_token"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
    ):
        resolved_token = token or _extract_bearer_token(authorization) or _extract_bearer_token(request.headers.get("authorization"))
        if not resolved_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated"
            )

        payload = decode_token(resolved_token)
        if not payload:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )

        schema_name = payload.get("schema_name")
        username = payload.get("sub")
        if not schema_name or not username:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Tenant context not found"
            )

        SessionClass = get_tenant_session(schema_name)
        tenant_db = SessionClass()
        try:
            if not IS_SQLITE:
                tenant_db.execute(text(f'SET search_path TO "{schema_name}", public'))

            if IS_SQLITE:
                user = tenant_db.query(TenantSchemaUser).filter(
                    TenantSchemaUser.username == username,
                    TenantSchemaUser.tenant_id == schema_name
                ).first()
            else:
                user = tenant_db.query(TenantSchemaUser).filter(
                    TenantSchemaUser.username == username
                ).first()

            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User not found in tenant"
                )

            if IS_SQLITE:
                role_ids = [
                    ur.role_id for ur in tenant_db.query(TenantUserRole).filter(
                        TenantUserRole.user_id == user.id,
                        TenantUserRole.tenant_id == schema_name
                    ).all()
                ]
            else:
                role_ids = [
                    ur.role_id for ur in tenant_db.query(TenantUserRole).filter(
                        TenantUserRole.user_id == user.id
                    ).all()
                ]

            if not role_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Permission denied"
                )

            if IS_SQLITE:
                admin_role = tenant_db.query(TenantRole).filter(
                    TenantRole.id.in_(role_ids),
                    TenantRole.name == "Administrator",
                    TenantRole.tenant_id == schema_name
                ).first()
            else:
                admin_role = tenant_db.query(TenantRole).filter(
                    TenantRole.id.in_(role_ids),
                    TenantRole.name == "Administrator"
                ).first()
            if admin_role:
                return True

            if IS_SQLITE:
                permission = tenant_db.query(TenantPermission).filter(
                    TenantPermission.name == permission_name,
                    TenantPermission.tenant_id == schema_name
                ).first()
            else:
                permission = tenant_db.query(TenantPermission).filter(
                    TenantPermission.name == permission_name
                ).first()

            if not permission:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Permission denied"
                )

            if IS_SQLITE:
                has_perm = tenant_db.query(TenantRolePermission).filter(
                    TenantRolePermission.role_id.in_(role_ids),
                    TenantRolePermission.permission_id == permission.id,
                    TenantRolePermission.tenant_id == schema_name
                ).first()
            else:
                has_perm = tenant_db.query(TenantRolePermission).filter(
                    TenantRolePermission.role_id.in_(role_ids),
                    TenantRolePermission.permission_id == permission.id
                ).first()

            if not has_perm:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Permission denied"
                )

            return True
        finally:
            tenant_db.close()

    return permission_checker


def require_tenant_admin(
    request: Request,
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """FastAPI dep — 403 unless the caller holds the Administrator role in
    the tenant they're authenticated against.

    Use on policy-shaping endpoints: tune risk weights, approve / reject
    pending plugin rules, import custom plugin JSON, revoke an agent's
    API token. Operational endpoints (Scan All, Setup Wizard, Bulk
    Discovery) use ``require_tenant_permission`` instead so Scanning
    Admin still passes.
    """
    resolved_token = token or _extract_bearer_token(authorization) or _extract_bearer_token(request.headers.get("authorization"))
    if not resolved_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = decode_token(resolved_token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    schema_name = payload.get("schema_name")
    username = payload.get("sub")
    if not schema_name or not username:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Tenant context not found")

    SessionClass = get_tenant_session(schema_name)
    tenant_db = SessionClass()
    try:
        if not IS_SQLITE:
            tenant_db.execute(text(f'SET search_path TO "{schema_name}", public'))

        if IS_SQLITE:
            user = tenant_db.query(TenantSchemaUser).filter(
                TenantSchemaUser.username == username,
                TenantSchemaUser.tenant_id == schema_name,
            ).first()
        else:
            user = tenant_db.query(TenantSchemaUser).filter(TenantSchemaUser.username == username).first()
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found in tenant")

        if IS_SQLITE:
            role_ids = [ur.role_id for ur in tenant_db.query(TenantUserRole).filter(
                TenantUserRole.user_id == user.id,
                TenantUserRole.tenant_id == schema_name,
            ).all()]
        else:
            role_ids = [ur.role_id for ur in tenant_db.query(TenantUserRole).filter(
                TenantUserRole.user_id == user.id,
            ).all()]
        if not role_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the Tenant Administrator can perform this action.",
            )

        if IS_SQLITE:
            admin_role = tenant_db.query(TenantRole).filter(
                TenantRole.id.in_(role_ids),
                TenantRole.name == "Administrator",
                TenantRole.tenant_id == schema_name,
            ).first()
        else:
            admin_role = tenant_db.query(TenantRole).filter(
                TenantRole.id.in_(role_ids),
                TenantRole.name == "Administrator",
            ).first()
        if not admin_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only the Tenant Administrator can perform this action.",
            )
        return True
    finally:
        tenant_db.close()


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(request: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(GRCUser).filter(
        (GRCUser.username == request.username) | (GRCUser.email == request.email)
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username or email already exists"
        )
    
    user = GRCUser(
        username=request.username,
        email=request.email,
        password_hash=hash_password(request.password),
        display_name=request.display_name or request.username,
        department=request.department,
        group=request.group,
        division=request.division,
        designation=request.designation
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    # Auto-assign user to default tenant
    default_tenant = db.query(Tenant).filter(Tenant.id == 1).first()
    if not default_tenant:
        default_tenant = db.query(Tenant).filter(Tenant.name.ilike("%Default%")).first()
    
    if not default_tenant:
        # Create default tenant if none exists
        default_tenant = Tenant(
            name="Default Organization",
            slug="default-organization"
        )
        db.add(default_tenant)
        db.commit()
        db.refresh(default_tenant)

        from ..seed_workflow_engine_defaults import seed_workflow_engine_defaults
        seed_workflow_engine_defaults(default_tenant.id)
    
    # Create TenantUser record linking user to tenant
    tenant_user = TenantUser(
        user_id=user.id,
        tenant_id=default_tenant.id,
        is_primary=True
    )
    db.add(tenant_user)
    db.commit()
    
    token = create_access_token({"sub": user.username})
    response = JSONResponse(content={
        "message": "Registration successful",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "display_name": user.display_name
        }
    }, status_code=status.HTTP_201_CREATED)
    set_auth_cookie(response, token)
    return response


@router.post("/login")
def login(
    request: UserLogin, 
    x_tenant_slug: Optional[str] = Header(None, alias="X-Tenant-Slug"),
    db: Session = Depends(get_db)
):
    subdomain = x_tenant_slug
    is_email_login = bool(request.username and "@" in request.username)
    
    # If no tenant slug provided, try resolving tenant by email domain
    if not subdomain and is_email_login:
        email_domain = request.username.split("@")[-1].lower().strip()
        domain_matches = db.query(Tenant).filter(
            Tenant.is_active == True,
            Tenant.schema_name.isnot(None),
            Tenant.primary_contact_email.ilike(f"%@{email_domain}")
        ).all()
        if len(domain_matches) == 1:
            subdomain = domain_matches[0].subdomain
        elif len(domain_matches) > 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Multiple organizations found for this domain. Please login with your tenant slug."
            )
    elif not subdomain and not is_email_login:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please login with your email address or provide a tenant slug."
        )
    
    # If subdomain provided, authenticate against that tenant's schema only
    if subdomain:
        tenant = db.query(Tenant).filter(
            (Tenant.subdomain == subdomain) | (Tenant.slug == subdomain),
            Tenant.is_active == True
        ).first()
        
        if not tenant:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Organization not found"
            )
        
        if not tenant.schema_name:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Organization database not configured"
            )
        
        try:
            SessionClass = get_tenant_session(tenant.schema_name)
            tenant_db = SessionClass()
            if not IS_SQLITE:
                tenant_db.execute(text(f'SET search_path TO "{tenant.schema_name}", public'))
            
            if is_email_login:
                tenant_user = tenant_db.query(TenantSchemaUser).filter(
                    TenantSchemaUser.email == request.username
                ).first()
            else:
                tenant_user = tenant_db.query(TenantSchemaUser).filter(
                    (TenantSchemaUser.username == request.username) | 
                    (TenantSchemaUser.email == request.username)
                ).first()
            
            if not tenant_user or not verify_password(request.password, tenant_user.password_hash):
                tenant_db.close()
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid username or password"
                )
            
            if not tenant_user.is_active:
                tenant_db.close()
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User account is deactivated"
                )
            
            user_id = tenant_user.id
            user_username = tenant_user.username
            user_email = tenant_user.email
            user_display_name = tenant_user.display_name
            
            tenant_user.last_login = datetime.utcnow()
            tenant_db.commit()
            tenant_db.close()
            
            token = create_access_token({
                "sub": user_username,
                "tenant_id": tenant.id,
                "subdomain": tenant.subdomain,
                "schema_name": tenant.schema_name,
                "user_type": "tenant"
            })
            
            response = JSONResponse(content={
                "message": "Login successful",
                "user": {
                    "id": user_id,
                    "username": user_username,
                    "email": user_email,
                    "display_name": user_display_name
                },
                "tenant": {
                    "id": tenant.id,
                    "name": tenant.name,
                    "slug": tenant.subdomain
                }
            })
            set_auth_cookie(response, token)
            return response
            
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Login error: {str(e)}"
            )
    
    # No subdomain - try public schema first (platform admins), then auto-discover tenant
    user = db.query(GRCUser).filter(
        (GRCUser.username == request.username) | (GRCUser.email == request.username)
    ).first()
    
    if user and user.password_hash != "tenant_managed" and verify_password(request.password, user.password_hash):
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is deactivated"
            )
        
        user.last_login = datetime.utcnow()
        db.commit()
        
        token = create_access_token({"sub": user.username})
        response = JSONResponse(content={
            "message": "Login successful",
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "display_name": user.display_name
            }
        })
        set_auth_cookie(response, token)
        return response
    
    # Auto-discover tenant: search all active tenant schemas for this user
    tenants = db.query(Tenant).filter(Tenant.is_active == True, Tenant.schema_name.isnot(None)).all()
    matches = []
    
    for tenant in tenants:
        try:
            SessionClass = get_tenant_session(tenant.schema_name)
            tenant_db = SessionClass()
            if not IS_SQLITE:
                tenant_db.execute(text(f'SET search_path TO "{tenant.schema_name}", public'))
            
            if is_email_login:
                tenant_user = tenant_db.query(TenantSchemaUser).filter(
                    TenantSchemaUser.email == request.username
                ).first()
            else:
                tenant_user = tenant_db.query(TenantSchemaUser).filter(
                    (TenantSchemaUser.username == request.username) | 
                    (TenantSchemaUser.email == request.username)
                ).first()
            
            if tenant_user and verify_password(request.password, tenant_user.password_hash):
                matches.append((tenant, tenant_user))
            
            tenant_db.close()
        except HTTPException:
            raise
        except Exception:
            continue
    
    if len(matches) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Multiple organizations found for this user. Please select a company and login using its tenant slug."
        )
    
    if len(matches) == 1:
        tenant, tenant_user = matches[0]
        if not tenant_user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is deactivated"
            )
        
        user_id = tenant_user.id
        user_username = tenant_user.username
        user_email = tenant_user.email
        user_display_name = tenant_user.display_name
        
        tenant_user.last_login = datetime.utcnow()
        # Re-open tenant session to persist last_login if needed
        SessionClass = get_tenant_session(tenant.schema_name)
        tenant_db = SessionClass()
        try:
            if not IS_SQLITE:
                tenant_db.execute(text(f'SET search_path TO "{tenant.schema_name}", public'))
            tenant_db.merge(tenant_user)
            tenant_db.commit()
        finally:
            tenant_db.close()
        
        token = create_access_token({
            "sub": user_username,
            "tenant_id": tenant.id,
            "subdomain": tenant.subdomain,
            "schema_name": tenant.schema_name,
            "user_type": "tenant"
        })
        
        response = JSONResponse(content={
            "message": "Login successful",
            "user": {
                "id": user_id,
                "username": user_username,
                "email": user_email,
                "display_name": user_display_name
            },
            "tenant": {
                "id": tenant.id,
                "name": tenant.name,
                "slug": tenant.subdomain
            }
        })
        set_auth_cookie(response, token)
        return response
    
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid username or password"
    )


@router.post("/logout")
def logout():
    is_production = os.environ.get("REPL_DEPLOYMENT", "") == "1"
    response = JSONResponse(content={"message": "Logged out successfully"})
    response.delete_cookie(
        key="grc_auth_token",
        httponly=True,
        secure=is_production,
        samesite="lax",
        path="/"
    )
    return response


@router.post("/refresh")
def refresh_token(
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    db: Session = Depends(get_db)
):
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No token provided"
        )
    
    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )
    
    username = payload.get("sub")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload"
        )
    
    user = db.query(GRCUser).filter(GRCUser.username == username).first()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or deactivated"
        )
    
    new_token = create_access_token({"sub": user.username})
    response = JSONResponse(content={
        "message": "Token refreshed successfully",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "display_name": user.display_name
        }
    })
    set_auth_cookie(response, new_token)
    return response


@router.get("/me")
def get_me(
    request: Request,
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    db: Session = Depends(get_db)
):
    if not token:
        return {"authenticated": False, "user": None}
    
    payload = decode_token(token)
    if not payload:
        return {"authenticated": False, "user": None}
    
    schema_name = payload.get("schema_name")
    tenant_id = payload.get("tenant_id")
    subdomain = payload.get("subdomain")
    username = payload.get("sub")
    
    if schema_name and tenant_id:
        try:
            SessionClass = get_tenant_session(schema_name)
            tenant_db = SessionClass()
            if not IS_SQLITE:
                tenant_db.execute(text(f'SET search_path TO "{schema_name}", public'))
            
            tenant_user = tenant_db.query(TenantSchemaUser).filter(
                TenantSchemaUser.username == username
            ).first()
            
            if tenant_user:
                tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
                
                from ..tenant_models import Role, UserRole, Permission, RolePermission
                if IS_SQLITE:
                    roles = tenant_db.query(Role).join(UserRole).filter(
                        UserRole.user_id == tenant_user.id,
                        UserRole.tenant_id == schema_name,
                        Role.tenant_id == schema_name
                    ).all()

                    if not roles:
                        legacy_role_ids = [
                            ur.role_id for ur in tenant_db.query(UserRole).filter(
                                UserRole.user_id == tenant_user.id
                            ).all()
                        ]
                        if legacy_role_ids:
                            tenant_db.query(Role).filter(
                                Role.id.in_(legacy_role_ids),
                                (Role.tenant_id.is_(None) | (Role.tenant_id == ""))
                            ).update({Role.tenant_id: schema_name}, synchronize_session=False)

                            tenant_db.query(UserRole).filter(
                                UserRole.user_id == tenant_user.id,
                                (UserRole.tenant_id.is_(None) | (UserRole.tenant_id == ""))
                            ).update({UserRole.tenant_id: schema_name}, synchronize_session=False)

                            tenant_db.commit()

                            roles = tenant_db.query(Role).join(UserRole).filter(
                                UserRole.user_id == tenant_user.id,
                                UserRole.tenant_id == schema_name,
                                Role.tenant_id == schema_name
                            ).all()
                else:
                    roles = tenant_db.query(Role).join(UserRole).filter(
                        UserRole.user_id == tenant_user.id
                    ).all()
                
                role_ids = [r.id for r in roles]
                role_names = [r.name for r in roles]
                
                permissions = []
                allowed_modules = []
                is_primary_contact = bool(
                    tenant
                    and tenant.primary_contact_email
                    and tenant_user.email
                    and tenant.primary_contact_email.lower() == tenant_user.email.lower()
                )
                is_admin = any(name == "Administrator" for name in role_names) or is_primary_contact
                
                # For new admin users who might not have permissions set up yet,
                # grant all permissions if they have admin role
                if is_admin:
                    allowed_modules = ["dashboard", "risks", "erm", "controls", "compliance", "evidence", "governance", "vulnerabilities", "assets", "frameworks", "reports", "admin", "integrations", "workflow_engine", "is_projects", "critical_tasks", "auditor_portal"]
                    permissions = ["*:*:*"]
                elif role_ids:
                    if IS_SQLITE:
                        perms = tenant_db.query(Permission).join(RolePermission).filter(
                            RolePermission.role_id.in_(role_ids),
                            RolePermission.tenant_id == schema_name,
                            Permission.tenant_id == schema_name
                        ).all()

                        if not perms:
                            tenant_db.query(RolePermission).filter(
                                RolePermission.role_id.in_(role_ids),
                                (RolePermission.tenant_id.is_(None) | (RolePermission.tenant_id == ""))
                            ).update({RolePermission.tenant_id: schema_name}, synchronize_session=False)

                            perm_ids = [
                                rp.permission_id for rp in tenant_db.query(RolePermission).filter(
                                    RolePermission.role_id.in_(role_ids)
                                ).all()
                            ]
                            if perm_ids:
                                tenant_db.query(Permission).filter(
                                    Permission.id.in_(perm_ids),
                                    (Permission.tenant_id.is_(None) | (Permission.tenant_id == ""))
                                ).update({Permission.tenant_id: schema_name}, synchronize_session=False)

                            tenant_db.commit()

                            perms = tenant_db.query(Permission).join(RolePermission).filter(
                                RolePermission.role_id.in_(role_ids),
                                RolePermission.tenant_id == schema_name,
                                Permission.tenant_id == schema_name
                            ).all()
                    else:
                        perms = tenant_db.query(Permission).join(RolePermission).filter(
                            RolePermission.role_id.in_(role_ids)
                        ).all()
                    permissions = list(set(p.name for p in perms))
                    allowed_modules = list(set(p.module for p in perms))
                
                user_id = tenant_user.id
                user_username = tenant_user.username
                user_email = tenant_user.email
                user_display_name = tenant_user.display_name
                user_is_active = tenant_user.is_active
                user_created_at = tenant_user.created_at.isoformat() if hasattr(tenant_user, 'created_at') and tenant_user.created_at else None
                
                tenant_db.close()
                
                return {
                    "authenticated": True,
                    "user": {
                        "id": user_id,
                        "username": user_username,
                        "email": user_email,
                        "display_name": user_display_name,
                        "is_active": user_is_active,
                        "created_at": user_created_at,
                        "last_login": None,
                        "tenant_ids": [tenant_id],
                        "primary_tenant_id": tenant_id,
                        "primary_tenant_name": tenant.name if tenant else None,
                        "roles": [{"id": r_id, "name": r_name} for r_id, r_name in zip(role_ids, role_names)],
                        "is_admin": is_admin,
                        "permissions": permissions,
                        "allowed_modules": allowed_modules
                    },
                    "tenant": {
                        "id": tenant_id,
                        "name": tenant.name if tenant else None,
                        "slug": tenant.slug if tenant else None,
                        "subdomain": tenant.subdomain if tenant else subdomain
                    }
                }
            tenant_db.close()
        except Exception:
            pass
    
    user = get_current_user(request=request, token=token, authorization=authorization, db=db)
    if not user:
        return {"authenticated": False, "user": None}
    
    tenants = get_user_tenants(user, db)
    primary_tenant = get_user_primary_tenant(user, db)
    
    primary_tenant_name = None
    if primary_tenant:
        tenant = db.query(Tenant).filter(Tenant.id == primary_tenant).first()
        if tenant:
            primary_tenant_name = tenant.name
    
    # Fallback path — reached when the tenant-schema lookup above either
    # finds no roles for this user OR raises (legacy/imported tenants).
    # The previous code blanket-set ``is_admin: True`` here, which made the
    # frontend show admin-only buttons (Scan All, Install Agent, Bulk
    # Discovery) to any tenant user who had no roles. Backend RBAC was still
    # enforced, but the UX leaked the existence of restricted actions.
    #
    # Safe default: treat fallback users as least-privileged. They can still
    # log in and view the platform; any permission-gated action will 403 at
    # the backend, AND the UI will correctly grey out the button.
    response_data = {
        "authenticated": True,
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "display_name": user.display_name,
            "is_active": user.is_active,
            "created_at": user.created_at.isoformat(),
            "last_login": user.last_login.isoformat() if user.last_login else None,
            "tenant_ids": tenants,
            "primary_tenant_id": primary_tenant,
            "primary_tenant_name": primary_tenant_name,
            "is_admin": False,
            "permissions": [],
            "allowed_modules": []
        }
    }
    
    if payload and should_refresh_token(payload):
        new_token = create_access_token({"sub": user.username})
        response = JSONResponse(content=response_data)
        set_auth_cookie(response, new_token)
        return response
    
    return response_data


def generate_slug(name: str) -> str:
    import re
    slug = name.lower().strip()
    slug = re.sub(r'[^\w\s-]', '', slug)
    slug = re.sub(r'[\s_-]+', '-', slug)
    return slug[:100]


@router.post("/register-organization", status_code=status.HTTP_201_CREATED)
def register_organization(request: OrganizationRegisterRequest, db: Session = Depends(get_db)):
    if not is_corporate_email(request.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Personal email addresses are not allowed. Please use your corporate email address."
        )
    
    email_domain = request.email.split("@")[-1].lower().strip()
    existing_domain = db.query(Tenant).filter(
        Tenant.primary_contact_email.ilike(f"%@{email_domain}")
    ).first()
    if existing_domain:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An organization with this email domain already exists"
        )
    
    existing_tenant = db.query(Tenant).filter(Tenant.primary_contact_email == request.email).first()
    if existing_tenant:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An organization with this email already exists"
        )
    
    base_slug = generate_slug(request.organization_name)
    slug = base_slug
    counter = 1
    while db.query(Tenant).filter(Tenant.slug == slug).first():
        slug = f"{base_slug}-{counter}"
        counter += 1
    
    subdomain = slug.replace("-", "")[:20]
    base_subdomain = subdomain
    counter = 1
    while db.query(Tenant).filter(Tenant.subdomain == subdomain).first():
        subdomain = f"{base_subdomain}{counter}"
        counter += 1
    
    username = request.email.split('@')[0]
    password_hash = hash_password(request.password)
    
    try:
        result = full_tenant_provisioning(
            subdomain=subdomain,
            org_name=request.organization_name,
            admin_username=username,
            admin_email=request.email,
            admin_password_hash=password_hash,
            admin_display_name=request.display_name,
            org_details={
                'legal_entity': request.legal_entity,
                'industry': request.industry,
                'company_size': request.company_size,
                'geography': request.geography,
                'regulatory_scope': request.regulatory_scope,
                'contact_phone': request.primary_contact_phone
            }
        )
        schema_name = result["schema_name"]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to provision tenant database: {str(e)}"
        )
    
    tenant = Tenant(
        name=request.organization_name,
        slug=slug,
        subdomain=subdomain,
        schema_name=schema_name,
        legal_entity=request.legal_entity,
        industry=request.industry,
        regulatory_scope=request.regulatory_scope,
        company_size=request.company_size,
        geography=request.geography,
        primary_contact_name=request.display_name,
        primary_contact_email=request.email,
        primary_contact_phone=request.primary_contact_phone,
        settings={"email_domain": email_domain},
        is_active=True
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)

    from ..seed_workflow_engine_defaults import seed_workflow_engine_defaults
    seed_workflow_engine_defaults(tenant.id)
    
    token = create_access_token({
        "sub": username,
        "tenant_id": tenant.id,
        "subdomain": subdomain,
        "schema_name": schema_name
    })
    
    response = JSONResponse(content={
        "message": "Organization registration successful",
        "admin_credentials": {
            "username": username,
            "email": request.email,
            "password": request.password
        },
        "tenant": {
            "id": tenant.id,
            "name": tenant.name,
            "slug": tenant.slug,
            "subdomain": subdomain
        },
        "login_url": f"https://{subdomain}.yourdomain.com/login"
    }, status_code=status.HTTP_201_CREATED)
    set_auth_cookie(response, token)
    return response


@router.post("/tenant-login")
def tenant_login(request: UserLogin, subdomain: str = None, db: Session = Depends(get_db)):
    if not subdomain:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Subdomain is required for tenant login"
        )
    
    tenant = db.query(Tenant).filter(
        Tenant.subdomain == subdomain,
        Tenant.is_active == True
    ).first()
    
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Organization not found"
        )
    
    if not tenant.schema_name:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Tenant database not configured"
        )
    
    try:
        SessionClass = get_tenant_session(tenant.schema_name)
        tenant_db = SessionClass()
        if not IS_SQLITE:
            tenant_db.execute(text(f'SET search_path TO "{tenant.schema_name}", public'))
        
        user = tenant_db.query(TenantSchemaUser).filter(
            (TenantSchemaUser.username == request.username) | 
            (TenantSchemaUser.email == request.username)
        ).first()
        
        if not user:
            tenant_db.close()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password"
            )
        
        if not verify_password(request.password, user.password_hash):
            tenant_db.close()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password"
            )
        
        if not user.is_active:
            tenant_db.close()
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is deactivated"
            )
        
        from datetime import datetime
        user.last_login = datetime.utcnow()
        tenant_db.commit()

        # Capture all needed attributes BEFORE closing the session to avoid DetachedInstanceError
        user_id = user.id
        user_username = user.username
        user_email = user.email
        user_display_name = user.display_name

        tenant_db.close()
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Login error: {str(e)}"
        )
    
    token = create_access_token({
        "sub": user_username,
        "tenant_id": tenant.id,
        "subdomain": tenant.subdomain,
        "schema_name": tenant.schema_name
    })
    
    response = JSONResponse(content={
        "message": "Login successful",
        "user": {
            "id": user_id,
            "username": user_username,
            "email": user_email,
            "display_name": user_display_name
        },
        "tenant": {
            "id": tenant.id,
            "name": tenant.name,
            "subdomain": tenant.subdomain
        }
    })
    set_auth_cookie(response, token)
    return response


@router.get("/tenant-me")
def get_tenant_me(
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    db: Session = Depends(get_db)
):
    if not token:
        return {"authenticated": False, "user": None}
    
    payload = decode_token(token)
    if not payload:
        return {"authenticated": False, "user": None}
    
    username = payload.get("sub")
    schema_name = payload.get("schema_name")
    tenant_id = payload.get("tenant_id")
    subdomain = payload.get("subdomain")
    
    if not username or not schema_name:
        return {"authenticated": False, "user": None}
    
    try:
        SessionClass = get_tenant_session(schema_name)
        tenant_db = SessionClass()
        if not IS_SQLITE:
            tenant_db.execute(text(f'SET search_path TO "{schema_name}", public'))
        
        user = tenant_db.query(TenantSchemaUser).filter(
            TenantSchemaUser.username == username
        ).first()
        
        if not user:
            tenant_db.close()
            return {"authenticated": False, "user": None}
        
        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
        
        from ..tenant_models import Role, UserRole
        roles = tenant_db.query(Role).join(UserRole).filter(
            UserRole.user_id == user.id
        ).all()
        
        tenant_db.close()
        
        return {
            "authenticated": True,
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "display_name": user.display_name,
                "is_active": user.is_active,
                "roles": [{"id": r.id, "name": r.name} for r in roles]
            },
            "tenant": {
                "id": tenant.id if tenant else None,
                "name": tenant.name if tenant else None,
                "subdomain": subdomain
            }
        }
    except Exception as e:
        return {"authenticated": False, "user": None, "error": str(e)}


# ─── Microsoft OAuth 2.0 ──────────────────────────────────────────────────────

_MS_AUTH_ERROR_HTML = """<!DOCTYPE html>
<html>
<head><title>Sign-in error</title></head>
<body style="font-family:sans-serif;text-align:center;padding-top:80px">
  <h2 style="color:#dc2626">Microsoft sign-in failed</h2>
  <p style="color:#64748b">{message}</p>
  <a href="/login" style="color:#2563eb">Back to login</a>
</body>
</html>"""

_MS_AUTH_SUCCESS_HTML = """<!DOCTYPE html>
<html>
<head><title>Signing in...</title></head>
<body style="font-family:sans-serif;text-align:center;padding-top:80px">
  <p style="color:#64748b">Signing you in…</p>
  <script>window.location.replace('/dashboard');</script>
</body>
</html>"""


@router.get("/microsoft")
def microsoft_login_initiate():
    """Returns the Microsoft OAuth authorization URL as JSON.

    Generates a cryptographically random state token (CSRF protection) and
    embeds it in both the auth URL and a short-lived, HttpOnly cookie so the
    callback handler can validate them.
    """
    client_id = os.getenv("MICROSOFT_CLIENT_ID")
    ms_tenant_id = os.getenv("MICROSOFT_TENANT_ID", "common")
    redirect_uri = os.getenv("MICROSOFT_REDIRECT_URI")

    if not client_id or not redirect_uri:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Microsoft SSO is not configured. "
                "Set MICROSOFT_CLIENT_ID, MICROSOFT_TENANT_ID, and MICROSOFT_REDIRECT_URI "
                "in your Replit Secrets."
            ),
        )

    # Generate an unpredictable state value for CSRF protection.
    oauth_state = secrets.token_urlsafe(32)

    auth_url = (
        f"https://login.microsoftonline.com/{ms_tenant_id}/oauth2/v2.0/authorize"
        f"?client_id={urllib.parse.quote(client_id)}"
        f"&response_type=code"
        f"&redirect_uri={urllib.parse.quote(redirect_uri)}"
        f"&response_mode=query"
        f"&scope=openid+profile+email+User.Read"
        f"&state={urllib.parse.quote(oauth_state)}"
    )

    response = JSONResponse(content={"auth_url": auth_url})
    is_production = os.environ.get("REPL_DEPLOYMENT", "") == "1"
    response.set_cookie(
        key="ms_oauth_state",
        value=oauth_state,
        httponly=True,
        secure=is_production,
        samesite="lax",
        max_age=600,  # 10 minute window for the user to complete login
        path="/",
    )
    return response


@router.get("/microsoft/callback")
def microsoft_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    ms_oauth_state: Optional[str] = Cookie(None, alias="ms_oauth_state"),
    db: Session = Depends(get_db),
):
    """Receives the Microsoft OAuth callback, validates state, exchanges the
    code for a token, and authenticates an **existing** GRC user.

    New accounts are NOT automatically provisioned — only users who have
    already been invited/created inside a tenant can log in via Microsoft SSO.
    """
    if error:
        return HTMLResponse(
            _MS_AUTH_ERROR_HTML.format(message=f"Authorization denied: {error}"),
            status_code=200,
        )

    # ── CSRF / state validation ───────────────────────────────────────────
    if not state or not ms_oauth_state or not secrets.compare_digest(state, ms_oauth_state):
        return HTMLResponse(
            _MS_AUTH_ERROR_HTML.format(
                message="Invalid or expired sign-in state. Please try again."
            ),
            status_code=200,
        )

    if not code:
        return HTMLResponse(
            _MS_AUTH_ERROR_HTML.format(message="No authorization code received from Microsoft."),
            status_code=200,
        )

    client_id = os.getenv("MICROSOFT_CLIENT_ID")
    client_secret = os.getenv("MICROSOFT_CLIENT_SECRET")
    ms_tenant_id = os.getenv("MICROSOFT_TENANT_ID", "common")
    redirect_uri = os.getenv("MICROSOFT_REDIRECT_URI")

    if not all([client_id, client_secret, redirect_uri]):
        return HTMLResponse(
            _MS_AUTH_ERROR_HTML.format(message="Microsoft SSO is not fully configured on the server."),
            status_code=200,
        )

    # Exchange authorization code for access token
    try:
        token_resp = http_requests.post(
            f"https://login.microsoftonline.com/{ms_tenant_id}/oauth2/v2.0/token",
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=15,
        )
        token_resp.raise_for_status()
        token_data = token_resp.json()
    except Exception:
        return HTMLResponse(
            _MS_AUTH_ERROR_HTML.format(
                message="Microsoft sign-in failed. Please try again or contact your administrator."
            ),
            status_code=200,
        )

    access_token = token_data.get("access_token")
    if not access_token:
        return HTMLResponse(
            _MS_AUTH_ERROR_HTML.format(
                message="Microsoft sign-in failed. Please try again or contact your administrator."
            ),
            status_code=200,
        )

    # Fetch user profile from Microsoft Graph
    try:
        graph_resp = http_requests.get(
            "https://graph.microsoft.com/v1.0/me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        graph_resp.raise_for_status()
        profile = graph_resp.json()
    except Exception:
        return HTMLResponse(
            _MS_AUTH_ERROR_HTML.format(
                message="Could not retrieve your profile from Microsoft. Please try again."
            ),
            status_code=200,
        )

    email: str = (profile.get("mail") or profile.get("userPrincipalName") or "").lower().strip()
    if not email:
        return HTMLResponse(
            _MS_AUTH_ERROR_HTML.format(message="Could not retrieve email address from Microsoft profile."),
            status_code=200,
        )

    # ── Look for an EXISTING user across all active tenant schemas ──────────
    # No automatic account creation — the user must already be provisioned
    # by an administrator inside a tenant.
    matched_tenant: Optional[Tenant] = None
    matched_tenant_user = None

    tenants = db.query(Tenant).filter(Tenant.is_active == True, Tenant.schema_name.isnot(None)).all()
    for tenant in tenants:
        try:
            SessionClass = get_tenant_session(tenant.schema_name)
            tenant_db = SessionClass()
            if not IS_SQLITE:
                tenant_db.execute(text(f'SET search_path TO "{tenant.schema_name}", public'))

            tenant_user = tenant_db.query(TenantSchemaUser).filter(
                TenantSchemaUser.email == email,
                TenantSchemaUser.is_active == True,
            ).first()
            if tenant_user:
                matched_tenant = tenant
                matched_tenant_user = tenant_user
                tenant_db.close()
                break
            tenant_db.close()
        except Exception:
            continue

    if matched_tenant and matched_tenant_user:
        # Update last_login timestamp
        try:
            SessionClass = get_tenant_session(matched_tenant.schema_name)
            tenant_db = SessionClass()
            if not IS_SQLITE:
                tenant_db.execute(text(f'SET search_path TO "{matched_tenant.schema_name}", public'))
            matched_tenant_user.last_login = datetime.utcnow()
            tenant_db.merge(matched_tenant_user)
            tenant_db.commit()
            tenant_db.close()
        except Exception:
            pass

        token = create_access_token({
            "sub": matched_tenant_user.username,
            "tenant_id": matched_tenant.id,
            "subdomain": matched_tenant.subdomain,
            "schema_name": matched_tenant.schema_name,
            "user_type": "tenant",
            "sso": "microsoft",
        })

        response = HTMLResponse(_MS_AUTH_SUCCESS_HTML, status_code=200)
        set_auth_cookie(response, token)
        # Clear the one-time state cookie
        response.delete_cookie(key="ms_oauth_state", path="/")
        return response

    # ── Also check the global (platform-level) user table ───────────────────
    global_user = db.query(GRCUser).filter(
        GRCUser.email == email,
        GRCUser.is_active == True,
    ).first()
    if global_user:
        token = create_access_token({"sub": global_user.username, "sso": "microsoft"})
        response = HTMLResponse(_MS_AUTH_SUCCESS_HTML, status_code=200)
        set_auth_cookie(response, token)
        response.delete_cookie(key="ms_oauth_state", path="/")
        return response

    # ── No pre-existing account — refuse access ──────────────────────────────
    return HTMLResponse(
        _MS_AUTH_ERROR_HTML.format(
            message=(
                "No GRC account is associated with this Microsoft identity "
                f"({email}). Please contact your administrator to be added "
                "to the workspace."
            )
        ),
        status_code=200,
    )
