
import os
import re
from datetime import datetime, timedelta
from typing import Optional, List

import bcrypt
from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from ..db import open_tenant_session
from ..models import (
    GRCUser,
    Permission,
    Role,
    RolePermission,
    Tenant,
    UserRole,
    get_db,
    get_master_db,
)
from ..schemas import OrganizationRegisterRequest, UserLogin
from ..tenant_manager import full_tenant_provisioning

router = APIRouter(prefix="/auth", tags=["Authentication"])

SECRET_KEY = os.getenv("SESSION_SECRET")
if not SECRET_KEY:
    raise RuntimeError("SESSION_SECRET environment variable is required for security. Please set it.")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24
TOKEN_REFRESH_THRESHOLD_HOURS = 6


PERSONAL_EMAIL_DOMAINS = {
    "gmaiil.com", "test.om",
}


def is_corporate_email(email: str) -> bool:
    try:
        domain = email.lower().split("@")[1]
        return domain not in PERSONAL_EMAIL_DOMAINS
    except (IndexError, AttributeError):
        return False


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, Exception):
        return False


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS))
    to_encode.update({"exp": expire, "iat": datetime.utcnow()})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


def should_refresh_token(payload: dict) -> bool:
    iat = payload.get("iat")
    if not iat:
        return True
    issued_at = datetime.utcfromtimestamp(iat)
    hours_since_issue = (datetime.utcnow() - issued_at).total_seconds() / 3600
    return hours_since_issue > TOKEN_REFRESH_THRESHOLD_HOURS


def _resolve_cookie_domain(http_request: Optional[Request]) -> Optional[str]:
    """Pick a parent domain so the cookie is shared across tenant subdomains.

    Order of preference:
      1. `AUTH_COOKIE_DOMAIN` env (production override, e.g. `.compliverse.ai`).
      2. Auto-detect `.localhost` so dev subdomains (acme.localhost) share the cookie.
      3. Otherwise return None (host-only cookie, the default).
    """
    explicit = os.environ.get("AUTH_COOKIE_DOMAIN")
    if explicit:
        return explicit
    if http_request is None:
        return None
    host = (http_request.headers.get("host") or "").split(":")[0].lower()
    if host == "localhost" or host.endswith(".localhost"):
        return "localhost"
    return None


def set_auth_cookie(response: JSONResponse, token: str, http_request: Optional[Request] = None) -> None:
    is_production = os.environ.get("REPL_DEPLOYMENT", "") == "1"
    domain = _resolve_cookie_domain(http_request)
    response.set_cookie(
        key="grc_auth_token",
        value=token,
        httponly=True,
        secure=is_production,
        samesite="lax",
        max_age=ACCESS_TOKEN_EXPIRE_HOURS * 3600,
        path="/",
        domain=domain,
    )


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value:
        return None
    return value.strip() or None


def _resolve_token(request: Request, token_cookie: Optional[str], authorization_header: Optional[str]) -> Optional[str]:
    return (
        token_cookie
        or _extract_bearer_token(authorization_header)
        or _extract_bearer_token(request.headers.get("authorization"))
    )


# ---------------------------------------------------------------------------
# Tenant-scoped helpers consumed by other routers.
# In per-DB-per-tenant, a tenant DB only ever contains its own tenant. Returning
# the self-tenant id keeps existing `.filter(Model.tenant_id.in_(user_tenants))`
# filters tautological-but-correct, so router code does not need rewrites.
# ---------------------------------------------------------------------------

def get_user_tenants(user: GRCUser, db: Session) -> List[int]:
    row = db.query(Tenant).first()
    return [row.id] if row else []


def get_user_primary_tenant(user: GRCUser, db: Session) -> Optional[int]:
    row = db.query(Tenant).first()
    return row.id if row else None


# ---------------------------------------------------------------------------
# Authentication dependencies
# ---------------------------------------------------------------------------

def get_current_user(
    request: Request,
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> Optional[GRCUser]:
    resolved = _resolve_token(request, token, authorization)
    if not resolved:
        return None
    payload = decode_token(resolved)
    if not payload:
        return None
    username = payload.get("sub")
    if not username:
        return None
    return db.query(GRCUser).filter(GRCUser.username == username).first()


def require_auth(
    request: Request,
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> GRCUser:
    user = get_current_user(request=request, token=token, authorization=authorization, db=db)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is deactivated")

    from ..services.ai_usage import bind_request_context
    bind_request_context(request, user)

    # ---- Inactive-session enforcement ----------------------------------------
    # Read the policy lazily so any failure (table missing, transient error)
    # falls back to "no idle check" — auth must never break because of policy
    # plumbing. The frontend also kicks the user out at idle; this is the
    # belt-and-braces server-side enforcement that catches forgotten-open
    # tabs even if the browser tab never made the logout call.
    try:
        from ..services.password_policy import (
            get_active_password_policy,
            is_session_idle,
            touch_last_activity,
        )
        policy = get_active_password_policy(db)
        if is_session_idle(user, policy):
            # Force a fresh login. Reset activity so the user can immediately
            # log in again without hitting the locked-account path.
            user.last_activity_at = None
            try:
                db.commit()
            except Exception:
                db.rollback()
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Session expired due to inactivity. Please log in again.",
            )
        # Bump activity. To keep this cheap on read-heavy endpoints we only
        # write to the DB once per ~60s per user — the in-memory ORM state
        # is updated every call, but the COMMIT is rate-limited.
        from datetime import datetime as _dt, timedelta as _td
        last = getattr(user, "last_activity_at", None)
        if last is None or (_dt.utcnow() - last) > _td(seconds=60):
            touch_last_activity(user, db, commit=True)
    except HTTPException:
        raise
    except Exception:
        # Never let policy plumbing break a real request.
        pass

    return user


def require_tenant_permission(permission_name: str):
    """Dependency factory: confirms current user has the named permission within the tenant DB.

    Administrator role is granted everything. Primary contact email also gets
    administrator-grade access (matches prior behaviour).
    """
    def permission_checker(
        request: Request,
        token: Optional[str] = Cookie(None, alias="grc_auth_token"),
        authorization: Optional[str] = Header(None, alias="Authorization"),
        db: Session = Depends(get_db),
    ) -> bool:
        resolved = _resolve_token(request, token, authorization)
        if not resolved:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

        payload = decode_token(resolved)
        if not payload:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid token payload")

        user = db.query(GRCUser).filter(GRCUser.username == username).first()
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found in tenant")

        from ..services.ai_usage import bind_request_context
        bind_request_context(request, user)

        # Primary contact bypass
        tenant_row = db.query(Tenant).first()
        if (
            tenant_row
            and tenant_row.primary_contact_email
            and user.email
            and tenant_row.primary_contact_email.lower() == user.email.lower()
        ):
            return True

        role_ids = [ur.role_id for ur in db.query(UserRole).filter(UserRole.user_id == user.id).all()]
        if not role_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

        admin_role = db.query(Role).filter(Role.id.in_(role_ids), Role.name == "Administrator").first()
        if admin_role:
            return True

        permission = db.query(Permission).filter(Permission.name == permission_name).first()
        if not permission:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

        has_perm = db.query(RolePermission).filter(
            RolePermission.role_id.in_(role_ids),
            RolePermission.permission_id == permission.id,
        ).first()
        if not has_perm:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied")

        return True

    return permission_checker


def _generate_slug(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_-]+", "-", slug)
    return slug[:40].strip("-") or "tenant"


_PUBLIC_EMAIL_DOMAINS = {
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com",
    "aol.com", "live.com", "protonmail.com", "proton.me", "mail.com",
}


def _slug_from_email(email: str) -> Optional[str]:
    """Pick a tenant slug from the email domain, e.g. 'mehboob@layeron.com' -> 'layeron'.

    Returns None for public mail providers (gmail/yahoo/etc.) so we fall back to
    org-name slugification — using `gmail` as a tenant slug is obviously wrong.
    """
    try:
        domain = email.split("@", 1)[1].lower().strip()
    except (IndexError, AttributeError):
        return None
    if not domain or domain in _PUBLIC_EMAIL_DOMAINS:
        return None
    base = domain.split(".", 1)[0]
    base = re.sub(r"[^a-z0-9-]", "", base)
    return base[:40] or None


@router.post("/login")
def login(
    request: UserLogin,
    http_request: Request,
    x_tenant_slug: Optional[str] = Header(None, alias="X-Tenant-Slug"),
    master: Session = Depends(get_master_db),
):
    """Tenant-scoped login.

    Either X-Tenant-Slug header or a tenant subdomain MUST be provided. Auto-
    discovery by email domain is supported as a convenience: if exactly one
    tenant matches the user's email domain, that tenant is used.
    """
    is_email_login = bool(request.username and "@" in request.username)

    # ---- TEMP DIAG (login 401 on docker) — remove once root-caused ----
    import sys as _diag_sys
    def _dlog(msg):
        print(f"[LOGIN-DIAG] {msg}", flush=True, file=_diag_sys.stderr)
    _dlog(f"username={request.username!r} is_email_login={is_email_login} x_tenant_slug={x_tenant_slug!r}")
    _dlog(f"middleware-resolved tenant_slug on request.state = {getattr(http_request.state, 'tenant_slug', None)!r}")
    # -------------------------------------------------------------------

    # Resolution priority for LOGIN (different from the global middleware,
    # which prioritises cookies for authenticated traffic):
    #
    #   1. X-Tenant-Slug header  (explicit caller intent)
    #   2. Email-domain match    (the email itself is the most authoritative
    #                             signal a user can provide at the login form)
    #   3. Middleware-resolved   (cookie / subdomain / query / DEFAULT_TENANT_SLUG)
    #
    # Why email-domain wins over middleware: on bare-IP / single-tenant
    # deployments, DEFAULT_TENANT_SLUG fills request.state.tenant_slug for
    # any anonymous request. Before this re-ordering, that fallback was
    # routing every cookie-less login to the wrong DB — the user's account
    # lives in their own tenant DB (grc_layeron, grc_company, …), not in
    # grc_default. Stale JWT cookies from a prior session caused the same
    # symptom across tenant switches.
    slug = x_tenant_slug

    if not slug and is_email_login:
        email_domain = request.username.split("@")[-1].lower().strip()

        # Primary email→tenant resolution: tenants whose primary_contact_email
        # matches the same domain. Registration always populates this field
        # (see tenant_manager.full_tenant_provisioning), so newly-created
        # tenants resolve here without needing the secondary fallback.
        domain_matches = master.query(Tenant).filter(
            Tenant.is_active.is_(True),
            Tenant.primary_contact_email.ilike(f"%@{email_domain}"),
        ).all()
        _dlog(f"primary domain matches for @{email_domain}: count={len(domain_matches)} slugs={[t.slug for t in domain_matches]}")
        if len(domain_matches) == 1:
            slug = domain_matches[0].slug
            _dlog(f"slug set by PRIMARY domain match -> {slug!r}")
        elif len(domain_matches) > 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Multiple organizations found for this domain. Please login with your tenant slug.",
            )

        # Secondary fallback — slug derived from the email's domain prefix
        # (e.g. mehboob@layeron.com -> "layeron"). Registration uses the
        # same derivation, so any tenant that came in through the normal
        # signup flow can still resolve here even when primary_contact_email
        # is stale, empty, or has been edited away. Public-mail providers
        # (_slug_from_email returns None) short-circuit so "gmail" isn't
        # ever accepted as a tenant slug.
        if not slug:
            derived = _slug_from_email(request.username)
            _dlog(f"secondary fallback: _slug_from_email={derived!r}")
            if derived:
                tenant_by_slug = master.query(Tenant).filter(
                    Tenant.is_active.is_(True),
                    ((Tenant.slug == derived) | (Tenant.subdomain == derived)),
                ).first()
                _dlog(f"secondary lookup tenant_by_slug={tenant_by_slug.slug if tenant_by_slug else None!r}")
                if tenant_by_slug:
                    slug = tenant_by_slug.slug
                    _dlog(f"slug set by SECONDARY -> {slug!r}")

    if not slug:
        slug = getattr(http_request.state, "tenant_slug", None)
        _dlog(f"slug set from middleware state -> {slug!r}")

    _dlog(f"FINAL slug = {slug!r}")

    if not slug:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tenant context required. Provide X-Tenant-Slug or access via tenant subdomain.",
        )

    tenant = master.query(Tenant).filter(
        ((Tenant.slug == slug) | (Tenant.subdomain == slug)),
        Tenant.is_active.is_(True),
    ).first()
    _dlog(f"tenant resolved: id={getattr(tenant,'id',None)} slug={getattr(tenant,'slug',None)} active={getattr(tenant,'is_active',None)}")
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")

    tdb = open_tenant_session(tenant.slug)
    try:
        _dlog(f"opened tenant session for slug={tenant.slug!r}")
        if is_email_login:
            user = tdb.query(GRCUser).filter(GRCUser.email == request.username).first()
        else:
            user = tdb.query(GRCUser).filter(
                (GRCUser.username == request.username) | (GRCUser.email == request.username)
            ).first()

        _dlog(
            f"user lookup result: found={user is not None} "
            f"id={getattr(user,'id',None)} username={getattr(user,'username',None)!r} "
            f"email={getattr(user,'email',None)!r} active={getattr(user,'is_active',None)} "
            f"hash_len={len(user.password_hash) if user and user.password_hash else 0}"
        )

        if user and user.password_hash:
            try:
                _vp = verify_password(request.password, user.password_hash)
            except Exception as _e:
                _vp = f"ERROR: {_e!r}"
            _dlog(f"verify_password = {_vp!r} (password_len={len(request.password) if request.password else 0})")

        # ---- Lockout gate ---------------------------------------------------
        # Load the tenant's password policy once; same object drives both the
        # lockout decision below and the failed-attempt bookkeeping. Wrapped
        # in try/except so any failure here falls back to safe defaults — auth
        # must never break because the policy table is in a weird state.
        from ..services.password_policy import (
            get_active_password_policy,
            is_account_locked,
            register_failed_login,
            register_successful_login,
        )
        policy = get_active_password_policy(tdb)
        if user and is_account_locked(user):
            _dlog("RAISING 423 — account is locked")
            raise HTTPException(
                status_code=status.HTTP_423_LOCKED,
                detail=(
                    "Account is temporarily locked due to repeated failed login attempts. "
                    f"Try again after {user.locked_until.isoformat()} UTC."
                ),
            )

        if not user or not verify_password(request.password, user.password_hash):
            _dlog("RAISING 401 — user missing OR verify_password False")
            # Only meaningful when the user actually exists — we don't want
            # to lock out a guessed-at email. The counter is per-user.
            if user is not None:
                register_failed_login(user, policy, tdb)
                try:
                    tdb.commit()
                except Exception:
                    tdb.rollback()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

        if not user.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is deactivated")

        # Reset counters + bump last_activity on success.
        register_successful_login(user, tdb)
        user.last_login = datetime.utcnow()
        tdb.commit()

        token = create_access_token({
            "sub": user.username,
            "tenant_slug": tenant.slug,
            "tenant_id": tenant.id,
        })

        body = {
            "message": "Login successful",
            # access_token is also returned in the body so the frontend can
            # use Bearer auth from localStorage. This sidesteps the browser
            # rejecting `Domain=localhost` cookies (RFC 6265 single-label
            # rule), which silently breaks cross-subdomain auth in dev.
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "display_name": user.display_name,
            },
            "tenant": {
                "id": tenant.id,
                "name": tenant.name,
                "slug": tenant.slug,
                "subdomain": tenant.subdomain,
            },
        }
        response = JSONResponse(content=body)
        set_auth_cookie(response, token, http_request)
        return response
    finally:
        tdb.close()


@router.post("/logout")
def logout():
    is_production = os.environ.get("REPL_DEPLOYMENT", "") == "1"
    response = JSONResponse(content={"message": "Logged out successfully"})
    response.delete_cookie(
        key="grc_auth_token",
        httponly=True,
        secure=is_production,
        samesite="lax",
        path="/",
    )
    return response


@router.post("/refresh")
def refresh_token(
    http_request: Request,
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    db: Session = Depends(get_db),
):
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="No token provided")

    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    user = db.query(GRCUser).filter(GRCUser.username == username).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or deactivated")

    new_token = create_access_token({
        "sub": user.username,
        "tenant_slug": payload.get("tenant_slug"),
        "tenant_id": payload.get("tenant_id"),
    })
    response = JSONResponse(content={
        "message": "Token refreshed successfully",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "display_name": user.display_name,
        },
    })
    set_auth_cookie(response, new_token, http_request)
    return response


@router.get("/me")
def get_me(
    request: Request,
    token: Optional[str] = Cookie(None, alias="grc_auth_token"),
    authorization: Optional[str] = Header(None, alias="Authorization"),
    db: Session = Depends(get_db),
):
    resolved = _resolve_token(request, token, authorization)
    if not resolved:
        return {"authenticated": False, "user": None}

    payload = decode_token(resolved)
    if not payload:
        return {"authenticated": False, "user": None}

    username = payload.get("sub")
    if not username:
        return {"authenticated": False, "user": None}

    user = db.query(GRCUser).filter(GRCUser.username == username).first()
    if not user:
        return {"authenticated": False, "user": None}

    tenant = db.query(Tenant).first()
    role_ids = [ur.role_id for ur in db.query(UserRole).filter(UserRole.user_id == user.id).all()]
    roles = db.query(Role).filter(Role.id.in_(role_ids)).all() if role_ids else []
    role_names = [r.name for r in roles]

    is_primary_contact = bool(
        tenant
        and tenant.primary_contact_email
        and user.email
        and tenant.primary_contact_email.lower() == user.email.lower()
    )
    is_admin = is_primary_contact or any(name == "Administrator" for name in role_names)

    if is_admin:
        permissions = ["*:*:*"]
        allowed_modules = [
            "dashboard", "risks", "erm", "controls", "compliance", "evidence",
            "governance", "vulnerabilities", "assets", "frameworks", "reports",
            "admin", "integrations", "workflow_engine", "is_projects",
            "critical_tasks", "bcm",
        ]
    else:
        perms = []
        if role_ids:
            perms = db.query(Permission).join(
                RolePermission, RolePermission.permission_id == Permission.id
            ).filter(RolePermission.role_id.in_(role_ids)).all()
        permissions = sorted({p.name for p in perms})
        # Permission rows store name as "module:submodule:action" — there's no
        # dedicated `module` column on the model, so derive it from the name.
        allowed_modules = sorted({
            p.name.split(":", 1)[0] for p in perms if p.name and ":" in p.name
        })

    response_data = {
        "authenticated": True,
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "display_name": user.display_name,
            "is_active": user.is_active,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "last_login": user.last_login.isoformat() if user.last_login else None,
            "tenant_ids": [tenant.id] if tenant else [],
            "primary_tenant_id": tenant.id if tenant else None,
            "primary_tenant_name": tenant.name if tenant else None,
            "roles": [{"id": r.id, "name": r.name} for r in roles],
            "is_admin": is_admin,
            "permissions": permissions,
            "allowed_modules": allowed_modules,
        },
        "tenant": {
            "id": tenant.id if tenant else None,
            "name": tenant.name if tenant else None,
            "slug": tenant.slug if tenant else None,
            "subdomain": tenant.subdomain if tenant else None,
        },
    }

    if should_refresh_token(payload):
        new_token = create_access_token({
            "sub": user.username,
            "tenant_slug": payload.get("tenant_slug"),
            "tenant_id": payload.get("tenant_id"),
        })
        response = JSONResponse(content=response_data)
        set_auth_cookie(response, new_token, request)
        return response

    return response_data


@router.post("/register-organization", status_code=status.HTTP_201_CREATED)
def register_organization(
    request: OrganizationRegisterRequest,
    http_request: Request,
    master: Session = Depends(get_master_db),
):
    """Provision a new tenant (master row + dedicated DB + seed data + first admin user)."""
    if not is_corporate_email(request.email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Personal email addresses are not allowed. Please use your corporate email address.",
        )

    email_domain = request.email.split("@")[-1].lower().strip()
    existing_domain = master.query(Tenant).filter(
        Tenant.primary_contact_email.ilike(f"%@{email_domain}")
    ).first()
    if existing_domain:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An organization with this email domain already exists",
        )

    # Prefer the email domain (e.g. layeron.com -> "layeron"). Falls back to
    # org-name slugification for public-email registrations.
    base_slug = _slug_from_email(request.email) or _generate_slug(request.organization_name)
    slug = base_slug
    counter = 1
    while master.query(Tenant).filter(Tenant.slug == slug).first():
        slug = f"{base_slug}-{counter}"[:40]
        counter += 1

    # Subdomain mirrors the slug so layeron.localhost just works.
    base_subdomain = re.sub(r"[^a-z0-9]", "", slug)[:20] or "tenant"
    subdomain = base_subdomain
    counter = 1
    while master.query(Tenant).filter(Tenant.subdomain == subdomain).first():
        suffix = str(counter)
        subdomain = (base_subdomain[: 20 - len(suffix)] + suffix)
        counter += 1

    # Complexity check against the platform default policy. The about-to-be-
    # created tenant DB doesn't have a PasswordPolicy row yet, so we use the
    # in-memory DEFAULT_POLICY constant — same rules every brand-new tenant
    # gets seeded with, so the first password is held to the same bar as
    # any later admin-created user.
    from ..services.password_policy import DEFAULT_POLICY, validate_password
    pw_ok, pw_err = validate_password(request.password, DEFAULT_POLICY)
    if not pw_ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=pw_err)

    username = request.email.split("@")[0]
    password_hash = hash_password(request.password)

    try:
        result = full_tenant_provisioning(
            slug=slug,
            subdomain=subdomain,
            org_name=request.organization_name,
            admin_username=username,
            admin_email=request.email,
            admin_password_hash=password_hash,
            admin_display_name=request.display_name,
            org_details={
                "legal_entity": request.legal_entity,
                "industry": request.industry,
                "company_size": request.company_size,
                "geography": request.geography,
                "regulatory_scope": request.regulatory_scope,
                "contact_phone": request.primary_contact_phone,
                "settings": {"email_domain": email_domain},
            },
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to provision tenant database: {str(e)}",
        )

    token = create_access_token({
        "sub": username,
        "tenant_slug": slug,
        "tenant_id": result["tenant_id"],
    })

    response = JSONResponse(
        content={
            "message": "Organization registration successful",
            "access_token": token,
            "token_type": "bearer",
            "admin_credentials": {
                "username": username,
                "email": request.email,
                "password": request.password,
            },
            "tenant": {
                "id": result["tenant_id"],
                "name": request.organization_name,
                "slug": slug,
                "subdomain": subdomain,
            },
            "login_url": f"https://{subdomain}.yourdomain.com/login",
        },
        status_code=status.HTTP_201_CREATED,
    )
    set_auth_cookie(response, token, http_request)
    return response
