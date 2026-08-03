"""Microsoft Entra ID SSO + provisioning (SaaS multi-tenant pattern).

A single Compliverse-owned Azure app registration (env: ENTRA_CLIENT_ID /
ENTRA_CLIENT_SECRET) is consented to by each customer org. Per-GRC-tenant
state stored in `IdentityProviderConfig` is just the customer's Microsoft
directory ID (`entra_directory_id`, the `tid` claim) plus a few flags.

Two OAuth-flow entry points share one callback, distinguished by the `state`
prefix that the start-of-flow endpoint encodes:

  * `/auth/entra/connect/start` — admin clicks "Connect" in the admin UI;
    state=`connect:<grc_tenant_slug>:<nonce>`. Callback writes `tid` onto
    the GRC tenant's IdentityProviderConfig.

  * `/auth/entra/login` — end user clicks "Sign in with Microsoft" on the
    login page; state=`login:<grc_tenant_slug>:<nonce>`. Callback verifies
    `tid` matches the stored mapping for that GRC tenant, upserts the user,
    applies group→role mappings, mints a session JWT.

Authority for the OAuth flows: `/organizations/` (rejects personal Microsoft
accounts). Authority for Graph + app-only token: the customer's
`entra_directory_id`, since each consent grants permissions in that one
directory only.

Local password login is untouched: this router only adds endpoints; existing
`/auth/login` keeps working.
"""

from __future__ import annotations

import logging
import os
import secrets
import time
import urllib.parse
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import bcrypt
import httpx
from fastapi import (
    APIRouter, Cookie, Depends, Header, HTTPException, Query, Request,
)
from fastapi.responses import RedirectResponse
from jose import JWTError, jwk, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_master_db, get_tenant_db
from ..models import (
    GRCUser,
    IdentityGroupRoleMapping,
    IdentityProviderConfig,
    Role,
    Tenant,
    UserRole,
    get_db,
)
from .auth_router import (
    SECRET_KEY as APP_SIGNING_SECRET,
    ALGORITHM,
    create_access_token,
    set_auth_cookie,
    _resolve_cookie_domain,
)

logger = logging.getLogger(__name__)

# Two routers — admin endpoints stay under /sso, public OAuth endpoints under
# /auth/entra so the redirect URI configured in the Compliverse Azure app
# (https://compliverse.ai/api/auth/entra/callback) lines up.
router = APIRouter(prefix="/sso", tags=["SSO / Identity Providers"])
entra_router = APIRouter(prefix="/auth/entra", tags=["SSO / Identity Providers"])

PROVIDER_ENTRA = "entra_id"
SOURCE_SSO = "sso"
SCOPE = "openid profile email User.Read"
APP_SCOPE = "https://graph.microsoft.com/.default"

# Where the front-end lives, for post-callback redirects. If unset we derive
# from the request host.
_FRONTEND_BASE = (os.getenv("FRONTEND_BASE_URL") or "").rstrip("/")

_STATE_TTL_SECONDS = 5 * 60
_STATE_COOKIE_NAME = "grc_entra_state"


def _env_first(*names: str) -> str:
    """Return the first non-empty env var among `names`. Case-sensitive
    (Python's os.getenv) so we explicitly try common upper/lower variants."""
    for n in names:
        val = os.getenv(n)
        if val and val.strip():
            return val.strip()
    return ""


def _entra_app_credentials() -> Tuple[str, str]:
    """Look up the Compliverse-owned Azure app credentials. Multiple names
    are accepted so existing deployments don't have to rename their env vars."""
    cid = _env_first(
        "ENTRA_CLIENT_ID",
        "compliverse_client_id", "COMPLIVERSE_CLIENT_ID",
        "APPLICATION_CLIENT_ID",
        "AZURE_CLIENT_ID",
    )
    csec = _env_first(
        "ENTRA_CLIENT_SECRET",
        "compliverse_client_secret", "COMPLIVERSE_CLIENT_SECRET",
        "APPLICATION_CLIENT_SECRET",
        "AZURE_CLIENT_SECRET",
    )
    if not cid or not csec:
        raise HTTPException(
            status_code=503,
            detail=(
                "Microsoft Entra integration is not configured on this server "
                "(set ENTRA_CLIENT_ID and ENTRA_CLIENT_SECRET — or the legacy "
                "compliverse_client_id / compliverse_client_secret — in the backend env)."
            ),
        )
    return cid, csec


def _make_unloginable_hash() -> str:
    return bcrypt.hashpw(secrets.token_urlsafe(32).encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class IdpConfigUpdate(BaseModel):
    is_enabled: Optional[bool] = None
    auto_provision_on_signin: Optional[bool] = None
    allowed_email_domains: Optional[List[str]] = None


class GroupMappingCreate(BaseModel):
    entra_group_id: str
    entra_group_name: Optional[str] = None
    role_id: int


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------

def _resolve_token(cookie_token: Optional[str], authz: Optional[str]) -> Optional[str]:
    if cookie_token:
        return cookie_token
    if authz:
        scheme, _, value = authz.partition(" ")
        if scheme.lower() == "bearer" and value:
            return value.strip()
    return None


def _decode_session_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        return jwt.decode(token, APP_SIGNING_SECRET, algorithms=[ALGORITHM])
    except JWTError:
        return None


def _require_admin(
    tenant_db: Session,
    cookie_token: Optional[str],
    authz: Optional[str],
) -> GRCUser:
    """Mirror admin_router.check_permission: primary-contact bypass +
    Administrator role bypass, otherwise admin:integrations_sso:manage."""
    from ..models import Permission, RolePermission  # local import (cycle)

    token = _resolve_token(cookie_token, authz)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = _decode_session_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = tenant_db.query(GRCUser).filter(GRCUser.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found in this tenant")

    tenant_row = tenant_db.query(Tenant).first()
    if (
        tenant_row
        and tenant_row.primary_contact_email
        and user.email
        and tenant_row.primary_contact_email.lower() == user.email.lower()
    ):
        return user

    role_ids = [ur.role_id for ur in tenant_db.query(UserRole).filter(UserRole.user_id == user.id).all()]
    if not role_ids:
        raise HTTPException(status_code=403, detail="Permission denied")

    if tenant_db.query(Role).filter(Role.id.in_(role_ids), Role.name == "Administrator").first():
        return user

    perm = tenant_db.query(Permission).filter(Permission.name == "admin:integrations_sso:manage").first()
    if not perm:
        raise HTTPException(status_code=403, detail="Permission denied")
    if not tenant_db.query(RolePermission).filter(
        RolePermission.role_id.in_(role_ids),
        RolePermission.permission_id == perm.id,
    ).first():
        raise HTTPException(status_code=403, detail="Permission denied")
    return user


# ---------------------------------------------------------------------------
# Microsoft URL helpers
# ---------------------------------------------------------------------------

# Use /organizations/ for sign-in / consent so personal Microsoft accounts are
# rejected (B2B SSO context). Single-tenant authorities (/{tid}/) are used for
# Graph / app-only flows once we know which directory consented.

def _authorize_url() -> str:
    return "https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize"


def _token_url_org() -> str:
    return "https://login.microsoftonline.com/organizations/oauth2/v2.0/token"


def _token_url_tid(tid: str) -> str:
    return f"https://login.microsoftonline.com/{tid}/oauth2/v2.0/token"


def _jwks_url(tid: str) -> str:
    return f"https://login.microsoftonline.com/{tid}/discovery/v2.0/keys"


def _expected_issuer(tid: str) -> str:
    return f"https://login.microsoftonline.com/{tid}/v2.0"


# ---------------------------------------------------------------------------
# JWKS cache, keyed by directory tid
# ---------------------------------------------------------------------------

_jwks_cache: Dict[str, Dict[str, Any]] = {}
_JWKS_TTL = 24 * 3600


def _get_jwks(tid: str) -> Dict[str, Any]:
    cached = _jwks_cache.get(tid)
    now = time.time()
    if cached and (now - cached["fetched_at"]) < _JWKS_TTL:
        return cached["keys"]
    with httpx.Client(timeout=10.0) as c:
        r = c.get(_jwks_url(tid))
        r.raise_for_status()
        keys = r.json()
    _jwks_cache[tid] = {"fetched_at": now, "keys": keys}
    return keys


# ---------------------------------------------------------------------------
# State JWT (signed with our SESSION_SECRET)
# ---------------------------------------------------------------------------

def _build_state(kind: str, grc_tenant_slug: str, nonce: str) -> str:
    return jwt.encode(
        {
            "kind": kind,                # "connect" | "login"
            "tenant_slug": grc_tenant_slug,
            "nonce": nonce,
            "exp": datetime.utcnow() + timedelta(seconds=_STATE_TTL_SECONDS),
            "iat": datetime.utcnow(),
        },
        APP_SIGNING_SECRET,
        algorithm=ALGORITHM,
    )


def _decode_state(state: str) -> Optional[Dict[str, Any]]:
    try:
        return jwt.decode(state, APP_SIGNING_SECRET, algorithms=[ALGORITHM])
    except JWTError:
        return None


# ---------------------------------------------------------------------------
# ID token validation
# ---------------------------------------------------------------------------

def _validate_id_token(id_token: str, *, expected_nonce: str, expected_tid: Optional[str] = None) -> Dict[str, Any]:
    """Verify Entra ID token. If `expected_tid` is None, accept whatever `tid`
    Microsoft returned (used by the connect flow — we discover the tid from
    the token and persist it). If `expected_tid` is set, the token's `tid`
    MUST match (login flow guard against tenant impersonation)."""
    client_id, _ = _entra_app_credentials()
    try:
        unverified = jwt.get_unverified_claims(id_token)
        header = jwt.get_unverified_header(id_token)
    except JWTError as exc:
        raise HTTPException(status_code=400, detail="Invalid ID token") from exc

    tid = unverified.get("tid")
    if not tid:
        raise HTTPException(status_code=400, detail="ID token missing 'tid' claim")
    if expected_tid and tid != expected_tid:
        raise HTTPException(status_code=400, detail="ID token tid mismatch (different Microsoft directory)")

    kid = header.get("kid")
    if not kid:
        raise HTTPException(status_code=400, detail="ID token missing 'kid' header")
    jwks = _get_jwks(tid)
    matching = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if not matching:
        # Force a one-shot refresh
        _jwks_cache.pop(tid, None)
        jwks = _get_jwks(tid)
        matching = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
    if not matching:
        raise HTTPException(status_code=400, detail="ID token signed with unknown key")

    public_key = jwk.construct(matching)
    try:
        claims = jwt.decode(
            id_token,
            public_key,
            algorithms=[matching.get("alg", "RS256")],
            audience=client_id,
            issuer=_expected_issuer(tid),
            options={"verify_at_hash": False},
        )
    except JWTError as exc:
        raise HTTPException(status_code=400, detail=f"ID token validation failed: {exc}") from exc

    if claims.get("nonce") != expected_nonce:
        raise HTTPException(status_code=400, detail="ID token nonce mismatch")
    return claims


# ---------------------------------------------------------------------------
# Token + Graph helpers
# ---------------------------------------------------------------------------

def _strip_subdomain(host_with_port: str) -> str:
    """Return the apex of a host. Examples:
       gosht.localhost:3000  -> localhost:3000
       ubl.compliverse.ai    -> compliverse.ai
       compliverse.ai        -> compliverse.ai
       localhost:3000        -> localhost:3000
    Used so the redirect URI we send Microsoft matches one shared apex
    URL configured in the Azure app (Microsoft does not allow wildcards)."""
    if not host_with_port:
        return host_with_port
    host, _, port = host_with_port.partition(":")
    parts = host.split(".")
    # Skip IPv4 addresses entirely.
    if all(p.isdigit() for p in parts) and len(parts) == 4:
        return host_with_port
    if len(parts) >= 2 and parts[-1] == "localhost":
        host = "localhost"
    elif len(parts) >= 3:
        host = ".".join(parts[1:])
    return f"{host}:{port}" if port else host


def _scheme_for_host(host_with_port: str) -> str:
    """Force `http` for local-dev hosts (localhost, *.localhost, 127.0.0.1).
    Otherwise default to `https`. Prevents Microsoft Referer headers (always
    https) from infecting our localhost redirects with an https scheme that
    the dev server can't actually serve, which leads to ERR_SSL_PROTOCOL_ERROR."""
    if not host_with_port:
        return "https"
    h = host_with_port.split(":", 1)[0].lower()
    if h == "localhost" or h.endswith(".localhost") or h == "127.0.0.1":
        return "http"
    return "https"


def _redirect_uri(request: Request) -> str:
    """Compute the redirect URI Microsoft will call back to. Must match
    EXACTLY one of the redirect URIs registered on the Compliverse Azure app.

    Returns an *apex* URL (subdomain stripped) so a single redirect URI in
    Azure works for every Compliverse tenant. The state JWT carries the
    tenant slug; the callback uses that to resolve which tenant DB to use.

    Resolution order:
      1. ENTRA_REDIRECT_URI env (operator override; used verbatim)
      2. FRONTEND_BASE_URL env + /api/auth/entra/callback
      3. Apex of Origin / Referer / X-Forwarded-Host / Host
    """
    explicit = (os.getenv("ENTRA_REDIRECT_URI") or "").strip()
    if explicit:
        return explicit
    if _FRONTEND_BASE:
        return f"{_FRONTEND_BASE}/api/auth/entra/callback"

    def _from(origin: str) -> Optional[str]:
        try:
            parsed = urllib.parse.urlsplit(origin)
            if parsed.scheme and parsed.netloc:
                apex = _strip_subdomain(parsed.netloc)
                # Re-pick scheme based on the resolved host. The Referer from
                # Microsoft is always https://login.microsoftonline.com — we
                # mustn't propagate that scheme to a localhost redirect.
                scheme = _scheme_for_host(apex)
                return f"{scheme}://{apex}/api/auth/entra/callback"
        except Exception:
            return None
        return None

    origin = (request.headers.get("origin") or "").strip().rstrip("/")
    if origin and "://" in origin:
        derived = _from(origin)
        if derived:
            return derived

    referer = (request.headers.get("referer") or "").strip()
    if referer and "://" in referer:
        derived = _from(referer)
        if derived:
            return derived

    fwd_host = (request.headers.get("x-forwarded-host") or "").strip()
    if fwd_host:
        apex = _strip_subdomain(fwd_host)
        return f"{_scheme_for_host(apex)}://{apex}/api/auth/entra/callback"

    host = request.headers.get("host") or ""
    apex = _strip_subdomain(host)
    return f"{_scheme_for_host(apex)}://{apex}/api/auth/entra/callback"


def _tenant_origin(request: Request, tenant_slug: str) -> str:
    """Build the front-end origin for a given tenant_slug, used for post-callback
    redirects. Mirrors `_redirect_uri` but re-prepends the subdomain. Always
    picks the scheme based on the resolved host so localhost stays http."""
    explicit = (os.getenv("FRONTEND_BASE_URL") or "").strip().rstrip("/")
    if explicit:
        try:
            parsed = urllib.parse.urlsplit(explicit)
            apex = parsed.netloc
            host_with_sub = f"{tenant_slug}.{apex}"
            return f"{_scheme_for_host(host_with_sub)}://{host_with_sub}"
        except Exception:
            pass
    redirect = _redirect_uri(request)
    try:
        parsed = urllib.parse.urlsplit(redirect)
        host_with_sub = f"{tenant_slug}.{parsed.netloc}"
        return f"{_scheme_for_host(host_with_sub)}://{host_with_sub}"
    except Exception:
        host = request.headers.get("host") or ""
        apex = _strip_subdomain(host)
        host_with_sub = f"{tenant_slug}.{apex}"
        return f"{_scheme_for_host(host_with_sub)}://{host_with_sub}"


def _exchange_code_for_tokens(*, code: str, redirect_uri: str) -> Dict[str, Any]:
    cid, csec = _entra_app_credentials()
    data = {
        "grant_type": "authorization_code",
        "client_id": cid,
        "client_secret": csec,
        "code": code,
        "redirect_uri": redirect_uri,
        "scope": SCOPE,
    }
    with httpx.Client(timeout=15.0) as c:
        r = c.post(_token_url_org(), data=data)
    if r.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Token exchange failed: {r.text[:300]}")
    return r.json()


def _acquire_app_token(tid: str) -> str:
    cid, csec = _entra_app_credentials()
    data = {
        "grant_type": "client_credentials",
        "client_id": cid,
        "client_secret": csec,
        "scope": APP_SCOPE,
    }
    with httpx.Client(timeout=15.0) as c:
        r = c.post(_token_url_tid(tid), data=data)
    if r.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"App token request failed: {r.text[:300]}")
    return r.json()["access_token"]


def _graph_get_paged(url: str, access_token: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    headers = {"Authorization": f"Bearer {access_token}"}
    with httpx.Client(timeout=30.0) as c:
        next_url: Optional[str] = url
        while next_url:
            r = c.get(next_url, headers=headers)
            if r.status_code >= 400:
                raise HTTPException(status_code=400, detail=f"Graph call failed: {r.text[:300]}")
            payload = r.json()
            out.extend(payload.get("value", []))
            next_url = payload.get("@odata.nextLink")
    return out


# ---------------------------------------------------------------------------
# Group → Role application
# ---------------------------------------------------------------------------

def _apply_sso_role_mappings(
    *, tenant_db: Session, user: GRCUser, app_token: str, entra_user_id: str, tenant_id: int,
) -> int:
    membership_url = (
        f"https://graph.microsoft.com/v1.0/users/{entra_user_id}/transitiveMemberOf?$select=id"
    )
    try:
        members = _graph_get_paged(membership_url, app_token)
    except HTTPException:
        return tenant_db.query(UserRole).filter(
            UserRole.user_id == user.id, UserRole.source == SOURCE_SSO,
        ).count()

    group_ids = [m.get("id") for m in members if m.get("id")]
    if not group_ids:
        tenant_db.query(UserRole).filter(
            UserRole.user_id == user.id, UserRole.source == SOURCE_SSO,
        ).delete()
        return 0

    mappings = (
        tenant_db.query(IdentityGroupRoleMapping)
        .filter(IdentityGroupRoleMapping.entra_group_id.in_(group_ids))
        .all()
    )
    target_role_ids = {m.role_id for m in mappings}

    tenant_db.query(UserRole).filter(
        UserRole.user_id == user.id, UserRole.source == SOURCE_SSO,
    ).delete()
    for role_id in target_role_ids:
        tenant_db.add(UserRole(
            user_id=user.id,
            role_id=role_id,
            tenant_id=tenant_id,
            source=SOURCE_SSO,
        ))
    tenant_db.flush()
    return len(target_role_ids)


# ---------------------------------------------------------------------------
# User upsert (login flow)
# ---------------------------------------------------------------------------

def _domain_allowed(email: str, allowed: List[str]) -> bool:
    if not allowed:
        return True
    if not email or "@" not in email:
        return False
    domain = email.split("@", 1)[1].lower().strip()
    return domain in {d.lower().strip() for d in allowed if d}


def _upsert_user_from_claims(
    *, tenant_db: Session, claims: Dict[str, Any], config: IdentityProviderConfig,
) -> Optional[GRCUser]:
    oid = claims.get("oid") or claims.get("sub")
    email = (claims.get("email") or claims.get("preferred_username") or "").lower().strip()
    display_name = claims.get("name") or email or oid

    if not oid:
        return None

    user = tenant_db.query(GRCUser).filter(
        GRCUser.external_provider == PROVIDER_ENTRA,
        GRCUser.external_id == oid,
    ).first()
    if user:
        if email and user.email != email:
            user.email = email
        if display_name and not user.display_name:
            user.display_name = display_name
        user.last_login = datetime.utcnow()
        tenant_db.flush()
        return user

    if email:
        user = tenant_db.query(GRCUser).filter(GRCUser.email == email).first()
        if user:
            user.external_provider = PROVIDER_ENTRA
            user.external_id = oid
            user.last_login = datetime.utcnow()
            tenant_db.flush()
            return user

    if not config.auto_provision_on_signin:
        return None
    if not _domain_allowed(email, list(config.allowed_email_domains or [])):
        return None
    if not email:
        return None

    new_user = GRCUser(
        username=email,
        email=email,
        password_hash=_make_unloginable_hash(),
        display_name=display_name or email,
        is_active=True,
        external_provider=PROVIDER_ENTRA,
        external_id=oid,
        last_login=datetime.utcnow(),
    )
    tenant_db.add(new_user)
    tenant_db.flush()
    return new_user


# ---------------------------------------------------------------------------
# Config CRUD (admin)
# ---------------------------------------------------------------------------

def _get_config(tenant_db: Session) -> Optional[IdentityProviderConfig]:
    return tenant_db.query(IdentityProviderConfig).filter(
        IdentityProviderConfig.provider == PROVIDER_ENTRA,
    ).first()


def _serialize_config(c: IdentityProviderConfig) -> Dict[str, Any]:
    return {
        "id": c.id,
        "provider": c.provider,
        "is_enabled": c.is_enabled,
        "entra_directory_id": c.entra_directory_id,
        "connected_at": c.connected_at.isoformat() if c.connected_at else None,
        "auto_provision_on_signin": c.auto_provision_on_signin,
        "allowed_email_domains": c.allowed_email_domains or [],
        "last_tested_at": c.last_tested_at.isoformat() if c.last_tested_at else None,
        "last_test_status": c.last_test_status,
        "last_test_message": c.last_test_message,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


@router.get("/config")
def get_config(
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    cfg = _get_config(tenant_db)
    if not cfg:
        return {"configured": False, "connected": False}
    return {
        "configured": True,
        "connected": bool(cfg.entra_directory_id),
        **_serialize_config(cfg),
    }


@router.put("/config")
def update_config(
    body: IdpConfigUpdate,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    cfg = _get_config(tenant_db)
    if not cfg:
        raise HTTPException(status_code=400, detail="Connect a Microsoft Entra directory first")
    if body.is_enabled is not None:
        cfg.is_enabled = body.is_enabled
    if body.auto_provision_on_signin is not None:
        cfg.auto_provision_on_signin = body.auto_provision_on_signin
    if body.allowed_email_domains is not None:
        cfg.allowed_email_domains = body.allowed_email_domains
    tenant_db.commit()
    tenant_db.refresh(cfg)
    return _serialize_config(cfg)


@router.delete("/config")
def delete_config(
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    cfg = _get_config(tenant_db)
    if cfg:
        # Cascade-deletes IdentityGroupRoleMapping rows (FK ondelete=CASCADE)
        tenant_db.delete(cfg)
        tenant_db.commit()
    return {"deleted": True}


@router.post("/config/test")
def test_config(
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    cfg = _get_config(tenant_db)
    if not cfg or not cfg.entra_directory_id:
        raise HTTPException(status_code=404, detail="No Microsoft Entra connection to test")
    try:
        _acquire_app_token(cfg.entra_directory_id)
        cfg.last_tested_at = datetime.utcnow()
        cfg.last_test_status = "ok"
        cfg.last_test_message = "App-only token acquired against the customer directory."
    except HTTPException as exc:
        cfg.last_tested_at = datetime.utcnow()
        cfg.last_test_status = "failed"
        cfg.last_test_message = exc.detail if isinstance(exc.detail, str) else "Failed"
        tenant_db.commit()
        raise
    tenant_db.commit()
    return {"ok": True, "last_test_status": cfg.last_test_status, "last_tested_at": cfg.last_tested_at.isoformat()}


# ---------------------------------------------------------------------------
# Group mappings (admin)
# ---------------------------------------------------------------------------

@router.get("/group-mappings")
def list_group_mappings(
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    cfg = _get_config(tenant_db)
    if not cfg:
        return {"mappings": []}
    rows = tenant_db.query(IdentityGroupRoleMapping).filter(
        IdentityGroupRoleMapping.idp_config_id == cfg.id,
    ).all()
    role_ids = list({r.role_id for r in rows})
    role_lookup = {r.id: r for r in tenant_db.query(Role).filter(Role.id.in_(role_ids)).all()} if role_ids else {}
    return {"mappings": [
        {
            "id": r.id,
            "entra_group_id": r.entra_group_id,
            "entra_group_name": r.entra_group_name,
            "role_id": r.role_id,
            "role_name": role_lookup[r.role_id].name if r.role_id in role_lookup else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]}


@router.post("/group-mappings", status_code=201)
def create_group_mapping(
    body: GroupMappingCreate,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    cfg = _get_config(tenant_db)
    if not cfg:
        raise HTTPException(status_code=400, detail="Connect a Microsoft Entra directory first")
    role = tenant_db.query(Role).filter(Role.id == body.role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")

    existing = tenant_db.query(IdentityGroupRoleMapping).filter(
        IdentityGroupRoleMapping.idp_config_id == cfg.id,
        IdentityGroupRoleMapping.entra_group_id == body.entra_group_id,
        IdentityGroupRoleMapping.role_id == body.role_id,
    ).first()
    if existing:
        return {"id": existing.id, "duplicate": True}

    tenant_row = tenant_db.query(Tenant).first()
    mapping = IdentityGroupRoleMapping(
        tenant_id=tenant_row.id if tenant_row else 0,
        idp_config_id=cfg.id,
        entra_group_id=body.entra_group_id,
        entra_group_name=body.entra_group_name,
        role_id=body.role_id,
    )
    tenant_db.add(mapping)
    tenant_db.commit()
    tenant_db.refresh(mapping)
    return {"id": mapping.id, "created": True}


@router.delete("/group-mappings/{mapping_id}")
def delete_group_mapping(
    mapping_id: int,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    row = tenant_db.query(IdentityGroupRoleMapping).filter(
        IdentityGroupRoleMapping.id == mapping_id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Mapping not found")
    tenant_db.delete(row)
    tenant_db.commit()
    return {"deleted": True}


@router.get("/graph/groups")
def search_groups(
    q: str = Query("", description="Display name search query"),
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    cfg = _get_config(tenant_db)
    if not cfg or not cfg.entra_directory_id:
        raise HTTPException(status_code=400, detail="Connect a Microsoft Entra directory first")
    token = _acquire_app_token(cfg.entra_directory_id)
    needle = (q or "").strip()
    base = "https://graph.microsoft.com/v1.0/groups?$select=id,displayName&$top=25"
    headers = {"Authorization": f"Bearer {token}"}
    if needle:
        url = base + f'&$search="displayName:{urllib.parse.quote(needle)}"'
        headers["ConsistencyLevel"] = "eventual"
    else:
        url = base
    with httpx.Client(timeout=15.0) as c:
        r = c.get(url, headers=headers)
    if r.status_code >= 400:
        raise HTTPException(status_code=400, detail=f"Graph groups call failed: {r.text[:300]}")
    payload = r.json()
    return {"groups": [{"id": g.get("id"), "display_name": g.get("displayName")} for g in payload.get("value", [])]}


# ---------------------------------------------------------------------------
# Provisioning (admin)
# ---------------------------------------------------------------------------

@router.post("/provision")
def provision_users(
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    _require_admin(tenant_db, grc_auth_token, authorization)
    cfg = _get_config(tenant_db)
    if not cfg or not cfg.entra_directory_id:
        raise HTTPException(status_code=400, detail="Connect a Microsoft Entra directory first")
    app_token = _acquire_app_token(cfg.entra_directory_id)
    users_url = "https://graph.microsoft.com/v1.0/users?$select=id,mail,userPrincipalName,displayName"
    entra_users = _graph_get_paged(users_url, app_token)
    tenant_row = tenant_db.query(Tenant).first()
    tenant_id_local = tenant_row.id if tenant_row else 0
    allowed = list(cfg.allowed_email_domains or [])

    created = 0
    skipped = 0
    roles_applied_total = 0
    for u in entra_users:
        oid = u.get("id")
        email = (u.get("mail") or u.get("userPrincipalName") or "").lower().strip()
        display_name = u.get("displayName") or email
        if not oid or not email:
            skipped += 1
            continue
        if not _domain_allowed(email, allowed):
            skipped += 1
            continue
        existing = tenant_db.query(GRCUser).filter(
            (GRCUser.external_id == oid) | (GRCUser.email == email)
        ).first()
        if existing:
            if not existing.external_id:
                existing.external_provider = PROVIDER_ENTRA
                existing.external_id = oid
            user = existing
            skipped += 1
        else:
            user = GRCUser(
                username=email,
                email=email,
                password_hash=_make_unloginable_hash(),
                display_name=display_name,
                is_active=True,
                external_provider=PROVIDER_ENTRA,
                external_id=oid,
            )
            tenant_db.add(user)
            tenant_db.flush()
            created += 1
        roles_applied_total += _apply_sso_role_mappings(
            tenant_db=tenant_db, user=user, app_token=app_token,
            entra_user_id=oid, tenant_id=tenant_id_local,
        )
    tenant_db.commit()
    return {"created": created, "skipped": skipped, "roles_applied": roles_applied_total}


# ---------------------------------------------------------------------------
# Public OAuth-flow endpoints (under /auth/entra)
# ---------------------------------------------------------------------------

def _login_redirect(request: Request, error: str, tenant_slug: Optional[str] = None) -> RedirectResponse:
    base = _tenant_origin(request, tenant_slug) if tenant_slug else _FRONTEND_BASE
    if not base:
        host = request.headers.get("host") or ""
        scheme = request.headers.get("x-forwarded-proto") or request.url.scheme or "https"
        base = f"{scheme}://{host}" if host else ""
    return RedirectResponse(url=f"{base}/login?error={urllib.parse.quote(error)}", status_code=302)


def _admin_redirect_with_status(request: Request, status_key: str, tenant_slug: Optional[str] = None) -> RedirectResponse:
    """After connect callback, send the admin back to the Identity Providers page."""
    base = _tenant_origin(request, tenant_slug) if tenant_slug else _FRONTEND_BASE
    if not base:
        host = request.headers.get("host") or ""
        scheme = request.headers.get("x-forwarded-proto") or request.url.scheme or "https"
        base = f"{scheme}://{host}" if host else ""
    return RedirectResponse(
        url=f"{base}/admin?tab=identity&entra_status={urllib.parse.quote(status_key)}",
        status_code=302,
    )


def _start_oauth(
    *, request: Request, kind: str, redirect_to_on_error: str,
) -> RedirectResponse:
    """Build the Microsoft authorize URL and 302 to it. Sets a state cookie."""
    cid, _ = _entra_app_credentials()
    tenant_slug = getattr(request.state, "tenant_slug", None)
    if not tenant_slug:
        return _login_redirect(request, f"{redirect_to_on_error}_tenant_unresolved")
    nonce = secrets.token_urlsafe(24)
    state = _build_state(kind, tenant_slug, nonce)
    params = {
        "client_id": cid,
        "response_type": "code",
        "redirect_uri": _redirect_uri(request),
        "response_mode": "query",
        "scope": SCOPE,
        "state": state,
        "nonce": nonce,
        # `prompt=select_account` for connect, default for login
    }
    # No `prompt` — let Microsoft decide. The previous `prompt=select_account`
    # value triggered a picker→reprocess loop with cached sessions.
    response = RedirectResponse(url=f"{_authorize_url()}?{urllib.parse.urlencode(params)}", status_code=302)
    _attach_state_cookie(response, state, request)
    return response


def _build_connect_payload(request: Request) -> Tuple[str, str]:
    """Build the Microsoft authorize URL + state JWT for the connect flow.
    Caller is responsible for setting the state cookie on its response."""
    cid, _ = _entra_app_credentials()
    tenant_slug = getattr(request.state, "tenant_slug", None)
    if not tenant_slug:
        raise HTTPException(status_code=400, detail="Tenant context required")
    nonce = secrets.token_urlsafe(24)
    state = _build_state("connect", tenant_slug, nonce)
    params = {
        "client_id": cid,
        "response_type": "code",
        "redirect_uri": _redirect_uri(request),
        "response_mode": "query",
        "scope": SCOPE,
        "state": state,
        "nonce": nonce,
        # No `prompt` — let Microsoft decide. `prompt=select_account` was
        # observed to combine badly with cached sessions and trigger a
        # /common/reprocess loop after account selection.
    }
    return f"{_authorize_url()}?{urllib.parse.urlencode(params)}", state


def _attach_state_cookie(response, state: str, request: Optional[Request] = None) -> None:
    """Set the state cookie. Domain is set to a parent host so the cookie
    survives the subdomain → apex hop (the redirect URI is at the apex but
    init/start runs on a tenant subdomain). For prod set AUTH_COOKIE_DOMAIN
    (e.g. `.compliverse.ai`); for dev `*.localhost` is auto-detected."""
    domain = _resolve_cookie_domain(request) if request is not None else None
    response.set_cookie(
        key=_STATE_COOKIE_NAME,
        value=state,
        httponly=True,
        secure=os.environ.get("REPL_DEPLOYMENT", "") == "1",
        samesite="lax",
        max_age=_STATE_TTL_SECONDS,
        path="/",
        domain=domain,
    )


@router.post("/connect/init")
def connect_init(
    request: Request,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Admin-triggered (axios-friendly) entry to the consent flow.

    Returns the Microsoft authorize URL in JSON so the frontend can perform a
    `window.location.href = ...` redirect itself. We use this instead of a
    server-side 302 from a top-level navigation because Next.js dev rewrites
    don't always forward the auth cookie/Bearer token end-to-end, which made
    the GET-redirect endpoint unauthenticatable.

    The state cookie is attached to this JSON response (same origin as the
    frontend, so it's stored normally) before the redirect.
    """
    from fastapi.responses import JSONResponse  # local import — small surface
    _require_admin(tenant_db, grc_auth_token, authorization)
    authorize_url, state = _build_connect_payload(request)
    used_redirect_uri = _redirect_uri(request)
    logger.info("SSO connect/init authorize_url=%s", authorize_url)
    logger.info("SSO connect/init redirect_uri=%s", used_redirect_uri)
    response = JSONResponse({
        "authorize_url": authorize_url,
        "redirect_uri": used_redirect_uri,
    })
    _attach_state_cookie(response, state, request)
    return response


@entra_router.get("/connect/start")
def connect_start(
    request: Request,
    tenant_db: Session = Depends(get_tenant_db),
    grc_auth_token: Optional[str] = Cookie(None),
    authorization: Optional[str] = Header(None, alias="Authorization"),
):
    """Legacy GET entry to the consent flow. Kept for any external link.
    The recommended path is POST /sso/connect/init from the admin UI."""
    _require_admin(tenant_db, grc_auth_token, authorization)
    return _start_oauth(request=request, kind="connect", redirect_to_on_error="entra_connect")


@router.get("/availability")
@entra_router.get("/availability")
def availability(tenant_db: Session = Depends(get_tenant_db)):
    cfg = _get_config(tenant_db)
    enabled = bool(cfg and cfg.is_enabled and cfg.entra_directory_id)
    return {"enabled": enabled}


@router.get("/login")
@entra_router.get("/login")
def sso_login(
    request: Request,
    tenant_db: Session = Depends(get_tenant_db),
):
    cfg = _get_config(tenant_db)
    if not cfg or not cfg.is_enabled or not cfg.entra_directory_id:
        return _login_redirect(request, "sso_disabled")
    return _start_oauth(request=request, kind="login", redirect_to_on_error="sso")


@router.get("/callback")
@entra_router.get("/callback")
def sso_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    error_description: Optional[str] = None,
    grc_entra_state: Optional[str] = Cookie(None),
    master: Session = Depends(get_master_db),
):
    """The callback URL is the apex (no subdomain), so we cannot rely on the
    request's tenant context. We decode the state JWT first, extract the
    tenant_slug, and explicitly open the matching tenant DB. After processing,
    we redirect to that tenant's subdomain."""
    from ..db import open_tenant_session  # local import — avoid module-load cycles

    # Decode state up-front (if present) so error redirects can land on the
    # correct tenant subdomain rather than falling back to request.host
    # (which on dev is 127.0.0.1:4000 — the backend, not the frontend).
    state_payload = _decode_state(state) if state else None
    pre_tenant_slug = state_payload.get("tenant_slug") if state_payload else None

    if error:
        logger.warning("Entra callback returned error: %s — %s", error, error_description)
        # Surface useful well-known errors to the admin if this was a connect
        # flow — the user is in the admin UI, not /login.
        if state_payload and state_payload.get("kind") == "connect" and pre_tenant_slug:
            status_key = "provider_error"
            if error_description and "AADSTS650051" in error_description:
                status_key = "viral_tenant"
            elif error_description and "AADSTS50020" in error_description:
                status_key = "user_not_in_tenant"
            elif error_description and "AADSTS90094" in error_description:
                status_key = "needs_admin_consent"
            return _admin_redirect_with_status(request, status_key, pre_tenant_slug)
        return _login_redirect(request, "sso_provider_error", pre_tenant_slug)
    if not code or not state:
        return _login_redirect(request, "sso_invalid_callback", pre_tenant_slug)
    if not grc_entra_state or grc_entra_state != state:
        return _login_redirect(request, "sso_state_mismatch", pre_tenant_slug)
    if not state_payload:
        return _login_redirect(request, "sso_state_expired", pre_tenant_slug)

    kind = state_payload.get("kind")
    nonce = state_payload.get("nonce") or ""
    target_tenant_slug = state_payload.get("tenant_slug")
    if not target_tenant_slug:
        return _login_redirect(request, "sso_state_invalid")

    # Explicitly open the tenant DB referenced by the state JWT. This is the
    # one place we don't go through `get_tenant_db` (which expects a subdomain
    # or X-Tenant-Slug on the inbound request — neither is present at the
    # apex callback URL).
    tenant_db: Session = open_tenant_session(target_tenant_slug)
    redirect_uri = _redirect_uri(request)
    try:
        # ------------------------------------------------------------------
        # CONNECT flow: admin consenting on behalf of a customer org.
        # We discover the directory tid from the ID token and persist it.
        # ------------------------------------------------------------------
        if kind == "connect":
            try:
                token_resp = _exchange_code_for_tokens(code=code, redirect_uri=redirect_uri)
            except HTTPException:
                return _admin_redirect_with_status(request, "token_exchange_failed", target_tenant_slug)
            id_token = token_resp.get("id_token")
            if not id_token:
                return _admin_redirect_with_status(request, "no_id_token", target_tenant_slug)
            try:
                claims = _validate_id_token(id_token, expected_nonce=nonce, expected_tid=None)
            except HTTPException:
                return _admin_redirect_with_status(request, "id_token_invalid", target_tenant_slug)
            tid = claims.get("tid")
            if not tid:
                return _admin_redirect_with_status(request, "no_tid", target_tenant_slug)

            cfg = _get_config(tenant_db)
            tenant_row = tenant_db.query(Tenant).first()
            connector_user_id: Optional[int] = None
            cookie_token = request.cookies.get("grc_auth_token")
            if cookie_token:
                payload = _decode_session_token(cookie_token)
                if payload and payload.get("sub"):
                    u = tenant_db.query(GRCUser).filter(GRCUser.username == payload["sub"]).first()
                    if u:
                        connector_user_id = u.id

            if cfg is None:
                cfg = IdentityProviderConfig(
                    tenant_id=tenant_row.id if tenant_row else 0,
                    provider=PROVIDER_ENTRA,
                    is_enabled=True,
                    entra_directory_id=tid,
                    connected_at=datetime.utcnow(),
                    connected_by_id=connector_user_id,
                    auto_provision_on_signin=True,
                    allowed_email_domains=[],
                )
                tenant_db.add(cfg)
            else:
                cfg.entra_directory_id = tid
                cfg.connected_at = datetime.utcnow()
                cfg.connected_by_id = connector_user_id
                cfg.is_enabled = True
            tenant_db.commit()

            response = _admin_redirect_with_status(request, "connected", target_tenant_slug)
            response.delete_cookie(_STATE_COOKIE_NAME, path="/")
            return response

        # ------------------------------------------------------------------
        # LOGIN flow: end user signing in. Verify tid matches stored mapping.
        # ------------------------------------------------------------------
        if kind == "login":
            cfg = _get_config(tenant_db)
            if not cfg or not cfg.is_enabled or not cfg.entra_directory_id:
                return _login_redirect(request, "sso_disabled", target_tenant_slug)
            try:
                token_resp = _exchange_code_for_tokens(code=code, redirect_uri=redirect_uri)
            except HTTPException:
                return _login_redirect(request, "sso_token_exchange_failed", target_tenant_slug)
            id_token = token_resp.get("id_token")
            if not id_token:
                return _login_redirect(request, "sso_no_id_token", target_tenant_slug)
            try:
                claims = _validate_id_token(
                    id_token, expected_nonce=nonce, expected_tid=cfg.entra_directory_id,
                )
            except HTTPException:
                return _login_redirect(request, "sso_id_token_invalid", target_tenant_slug)

            user = _upsert_user_from_claims(tenant_db=tenant_db, claims=claims, config=cfg)
            if not user:
                return _login_redirect(request, "sso_not_provisioned", target_tenant_slug)

            tenant_row = tenant_db.query(Tenant).first()
            try:
                app_token = _acquire_app_token(cfg.entra_directory_id)
                _apply_sso_role_mappings(
                    tenant_db=tenant_db, user=user, app_token=app_token,
                    entra_user_id=user.external_id or "",
                    tenant_id=tenant_row.id if tenant_row else 0,
                )
            except HTTPException:
                logger.exception("Failed to apply SSO role mappings for user %s", user.email)

            tenant_db.commit()

            tenant_obj = master.query(Tenant).filter(Tenant.slug == target_tenant_slug).first()
            if not tenant_obj:
                return _login_redirect(request, "sso_tenant_lost", target_tenant_slug)
            token = create_access_token({
                "sub": user.username,
                "tenant_slug": tenant_obj.slug,
                "tenant_id": tenant_obj.id,
            })

            base = _tenant_origin(request, target_tenant_slug)
            redirect = RedirectResponse(url=f"{base}/dashboard", status_code=302)
            set_auth_cookie(redirect, token, request)  # type: ignore[arg-type]
            redirect.delete_cookie(_STATE_COOKIE_NAME, path="/")
            return redirect

        return _login_redirect(request, "sso_invalid_callback", target_tenant_slug)
    finally:
        tenant_db.close()
