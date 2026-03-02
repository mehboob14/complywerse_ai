import os
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, Cookie
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
import bcrypt
from jose import jwt, JWTError

from ..models import GRCUser, TenantUser, Tenant, BusinessUnit, Role, UserRole, get_db
from ..schemas import UserCreate, UserLogin, UserResponse, TokenResponse, OrganizationRegisterRequest

router = APIRouter(prefix="/auth", tags=["Authentication"])

SECRET_KEY = os.getenv("SESSION_SECRET")
if not SECRET_KEY:
    raise RuntimeError("SESSION_SECRET environment variable is required for security. Please set it.")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24
TOKEN_REFRESH_THRESHOLD_HOURS = 6


PERSONAL_EMAIL_DOMAINS = {
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com',
    'aol.com', 'icloud.com', 'protonmail.com', 'mail.com', 'ymail.com',
    'msn.com', 'me.com', 'zoho.com', 'gmx.com', 'inbox.com'
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
    return bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))


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


def get_current_user(
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    db: Session = Depends(get_db)
) -> Optional[GRCUser]:
    if not token:
        return None
    payload = decode_token(token)
    if not payload:
        return None
    username = payload.get("sub")
    if not username:
        return None
    user = db.query(GRCUser).filter(GRCUser.username == username).first()
    return user


def require_auth(
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    db: Session = Depends(get_db)
) -> GRCUser:
    user = get_current_user(token, db)
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
        display_name=request.display_name or request.username
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
def login(request: UserLogin, db: Session = Depends(get_db)):
    user = db.query(GRCUser).filter(
        (GRCUser.username == request.username) | (GRCUser.email == request.username)
    ).first()
    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password"
        )
    
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


@router.post("/logout")
def logout():
    response = JSONResponse(content={"message": "Logged out successfully"})
    response.delete_cookie(
        key="grc_auth_token",
        httponly=True,
        secure=True,
        samesite="lax"
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
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    db: Session = Depends(get_db)
):
    user = get_current_user(token, db)
    if not user:
        return {"authenticated": False, "user": None}
    
    tenants = get_user_tenants(user, db)
    primary_tenant = get_user_primary_tenant(user, db)
    
    primary_tenant_name = None
    if primary_tenant:
        tenant = db.query(Tenant).filter(Tenant.id == primary_tenant).first()
        if tenant:
            primary_tenant_name = tenant.name
    
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
            "primary_tenant_name": primary_tenant_name
        }
    }
    
    if token:
        payload = decode_token(token)
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
    
    existing_user = db.query(GRCUser).filter(GRCUser.email == request.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    base_slug = generate_slug(request.organization_name)
    slug = base_slug
    counter = 1
    while db.query(Tenant).filter(Tenant.slug == slug).first():
        slug = f"{base_slug}-{counter}"
        counter += 1
    
    tenant = Tenant(
        name=request.organization_name,
        slug=slug,
        legal_entity=request.legal_entity,
        industry=request.industry,
        regulatory_scope=request.regulatory_scope,
        company_size=request.company_size,
        geography=request.geography,
        primary_contact_name=request.display_name,
        primary_contact_email=request.email,
        primary_contact_phone=request.primary_contact_phone,
        is_active=True
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    
    default_bu = BusinessUnit(
        tenant_id=tenant.id,
        name="Organization"
    )
    db.add(default_bu)
    db.commit()
    db.refresh(default_bu)
    
    admin_role = Role(
        tenant_id=tenant.id,
        name="Tenant Admin",
        description="Full administrative access to all tenant resources",
        is_system_role=False
    )
    db.add(admin_role)
    db.commit()
    db.refresh(admin_role)
    
    username = request.email.split('@')[0]
    base_username = username
    counter = 1
    while db.query(GRCUser).filter(GRCUser.username == username).first():
        username = f"{base_username}{counter}"
        counter += 1
    
    user = GRCUser(
        username=username,
        email=request.email,
        password_hash=hash_password(request.password),
        display_name=request.display_name
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    
    tenant_user = TenantUser(
        user_id=user.id,
        tenant_id=tenant.id,
        is_primary=True
    )
    db.add(tenant_user)
    db.commit()
    
    user_role = UserRole(
        user_id=user.id,
        role_id=admin_role.id,
        tenant_id=tenant.id,
        business_unit_id=default_bu.id
    )
    db.add(user_role)
    db.commit()
    
    token = create_access_token({"sub": user.username})
    response = JSONResponse(content={
        "message": "Organization registration successful",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "display_name": user.display_name
        },
        "tenant": {
            "id": tenant.id,
            "name": tenant.name,
            "slug": tenant.slug
        }
    }, status_code=status.HTTP_201_CREATED)
    set_auth_cookie(response, token)
    return response
