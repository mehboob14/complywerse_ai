"""
Tenant resolution middleware.

Extracts the tenant slug from the request (subdomain or `X-Tenant-Slug` header),
looks it up in the master catalog, and stashes the result on `request.state` so
downstream dependencies (`get_tenant_db`) can resolve to the right per-tenant DB.
"""

import os
import re
from typing import Optional

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware

from ..db import MasterSession
from ..models import Tenant


def extract_subdomain(host: str) -> Optional[str]:
    if not host:
        return None

    host = host.split(":")[0].lower()

    if host in ("localhost", "127.0.0.1"):
        return None

    if re.match(r"^\d+\.\d+\.\d+\.\d+$", host):
        return None

    parts = host.split(".")

    if len(parts) >= 3:
        subdomain = parts[0]
        if subdomain not in ("www", "api", "app"):
            return subdomain

    return None


def _lookup_tenant(db: Session, *, subdomain: Optional[str], slug: Optional[str]) -> Optional[Tenant]:
    if subdomain:
        t = db.query(Tenant).filter(
            Tenant.subdomain == subdomain,
            Tenant.is_active.is_(True),
        ).first()
        if t:
            return t
    if slug:
        return db.query(Tenant).filter(
            Tenant.slug == slug,
            Tenant.is_active.is_(True),
        ).first()
    return None


def _slug_from_auth_cookie(request: Request) -> Optional[str]:
    """Last-resort tenant resolution: decode the auth cookie and read tenant_slug from JWT.

    Useful when the frontend proxies via /api (so the backend sees Host=127.0.0.1
    and subdomain extraction yields nothing) and the calling code path didn't
    forward `X-Tenant-Slug` (e.g. raw fetch() instead of the axios interceptor).
    Local import avoids a circular dependency with auth_router.
    """
    token = request.cookies.get("grc_auth_token")
    if not token:
        # Also accept "Bearer <token>" via Authorization header.
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip() or None
    if not token:
        return None
    try:
        from ..routers.auth_router import decode_token  # type: ignore
    except Exception:
        return None
    payload = decode_token(token) or {}
    slug = payload.get("tenant_slug")
    return slug if isinstance(slug, str) and slug else None


class TenantMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        host = request.headers.get("host", "")
        subdomain = extract_subdomain(host)
        x_tenant_slug = request.headers.get("X-Tenant-Slug")
        # Top-level navigations (e.g. SSO `/auth/entra/connect/start`) can't set
        # custom headers, and when proxied via Next.js the backend sees
        # Host=127.0.0.1 — no subdomain to extract. Accept `?tenant_slug=` as a
        # last-resort fallback. JWT cookie still wins when present, so this
        # cannot be used to override an authenticated session's tenant.
        try:
            qp_tenant_slug = request.query_params.get("tenant_slug")
        except Exception:
            qp_tenant_slug = None

        request.state.subdomain = subdomain
        request.state.tenant = None
        request.state.tenant_slug = None
        request.state.tenant_id = None

        # Resolution priority for AUTHENTICATED requests:
        #
        #   1. Auth cookie's JWT tenant_slug  (authoritative — the user is
        #      provably logged in to this tenant; URL/header are advisory)
        #   2. Subdomain (e.g. acme.localhost)
        #   3. X-Tenant-Slug header
        #
        # Why JWT-first? Without it, a user logged in to tenant A who lands on
        # tenant B's subdomain (e.g. via stale tab, copy-pasted link, or a
        # cross-tab redirect race) would be auth'd against B's user table —
        # their A-bound JWT user wouldn't exist in B → 401 → bounce loop.
        # Trusting the JWT means the resolved tenant always matches the user's
        # actual session.
        #
        # For UNAUTHENTICATED requests (login, register-organization), the
        # cookie is absent so we fall through to subdomain/header resolution,
        # which is exactly what those flows need.
        cookie_slug = _slug_from_auth_cookie(request)

        # Single-tenant / IP-only deployment fallback: when nothing in the
        # request identifies a tenant and DEFAULT_TENANT_SLUG is set, resolve
        # to that tenant. Useful for staging-on-IP and pure single-tenant
        # installs where there's no subdomain to extract.
        default_slug = (os.environ.get("DEFAULT_TENANT_SLUG") or "").strip() or None

        chosen_slug = cookie_slug or x_tenant_slug or qp_tenant_slug or default_slug
        if subdomain or chosen_slug:
            db = MasterSession()
            try:
                tenant = _lookup_tenant(
                    db,
                    subdomain=None if cookie_slug else subdomain,
                    slug=chosen_slug or subdomain,
                )
                if tenant:
                    # Detach a lightweight view of the tenant so it survives the
                    # session close without lazy-loading any relationships.
                    request.state.tenant = {
                        "id": tenant.id,
                        "name": tenant.name,
                        "slug": tenant.slug,
                        "subdomain": tenant.subdomain,
                    }
                    request.state.tenant_slug = tenant.slug
                    request.state.tenant_id = tenant.id
                    try:
                        from ..services.ai_tracing import set_ai_tenant_slug
                        set_ai_tenant_slug(tenant.slug)
                    except Exception:
                        pass
            finally:
                db.close()

        return await call_next(request)


def get_current_tenant(request: Request) -> Optional[dict]:
    return getattr(request.state, "tenant", None)


def get_current_tenant_slug(request: Request) -> Optional[str]:
    return getattr(request.state, "tenant_slug", None)


def require_tenant(request: Request) -> dict:
    tenant = get_current_tenant(request)
    if not tenant:
        raise HTTPException(
            status_code=400,
            detail="Tenant not found. Please access via your organization subdomain or set X-Tenant-Slug.",
        )
    return tenant
