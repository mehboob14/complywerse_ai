"""Metabase SSO / embed helpers for the Reports › Analytics surface.

Env:
  METABASE_SITE_URL              e.g. https://metabase.internal or http://127.0.0.1:3001
  METABASE_JWT_SHARED_SECRET     Pro JWT SSO shared secret (Admin → Auth → JWT)
  METABASE_PRO_JWT               1 to enable Pro JWT SSO path (OSS has no jwt-* settings)
  METABASE_EMBEDDING_SECRET_KEY  Static embedding secret (OSS-compatible)
  METABASE_EMBED_ENABLED         1 to advertise embed-ready mode to the frontend

Modes:
  - pro JWT SSO when METABASE_PRO_JWT=1 and JWT secret are set (Metabase Pro)
  - static embed URLs when embedding secret is set (works on OSS)
  - open_link fallback when only site URL is set (manual Metabase login)

Tenant isolation is enforced by Metabase DB connections / collections — JWT
(when used) carries tenant_slug for group/collection mapping.
"""
from __future__ import annotations

import os
import time
from typing import Any, Dict, List, Optional

import jwt


def metabase_site_url() -> str:
    return (os.getenv("METABASE_SITE_URL") or "").rstrip("/")


def metabase_jwt_secret() -> str:
    return (os.getenv("METABASE_JWT_SHARED_SECRET") or "").strip()


def metabase_embedding_secret() -> str:
    return (os.getenv("METABASE_EMBEDDING_SECRET_KEY") or "").strip()


def metabase_embed_enabled() -> bool:
    return (os.getenv("METABASE_EMBED_ENABLED") or "").strip().lower() in (
        "1", "true", "yes", "on",
    )


def jwt_sso_configured() -> bool:
    """Pro JWT SSO — opt in with METABASE_PRO_JWT=1 (OSS has no jwt-* settings)."""
    if (os.getenv("METABASE_PRO_JWT") or "").strip().lower() not in ("1", "true", "yes", "on"):
        return False
    return bool(metabase_site_url() and metabase_jwt_secret())


def static_embed_configured() -> bool:
    return bool(metabase_site_url() and metabase_embedding_secret() and metabase_embed_enabled())


def metabase_enabled() -> bool:
    """True when Analytics can open Metabase somehow (SSO, embed, or deep-link)."""
    return bool(metabase_site_url())


def metabase_mode() -> str:
    if jwt_sso_configured() and metabase_embed_enabled():
        return "embed"
    if jwt_sso_configured():
        return "sso_link"
    if static_embed_configured():
        return "static_embed"
    if metabase_site_url():
        return "open_link"
    return "not_configured"


def mint_sso_token(
    *,
    email: str,
    display_name: Optional[str] = None,
    groups: Optional[List[str]] = None,
    tenant_slug: Optional[str] = None,
    ttl_seconds: int = 300,
) -> str:
    secret = metabase_jwt_secret()
    if not secret:
        raise RuntimeError("METABASE_JWT_SHARED_SECRET is not configured (requires Metabase Pro JWT)")

    name = (display_name or email.split("@")[0] or "User").strip()
    parts = name.split(None, 1)
    first = parts[0]
    last = parts[1] if len(parts) > 1 else ""

    now = int(time.time())
    payload: Dict[str, Any] = {
        "email": email,
        "first_name": first,
        "last_name": last,
        "groups": groups or ["compliverse_analyst"],
        "exp": now + max(60, ttl_seconds),
        "iat": now,
    }
    if tenant_slug:
        payload["tenant_slug"] = tenant_slug
    return jwt.encode(payload, secret, algorithm="HS256")


def sso_login_url(token: str, return_to: str = "/") -> str:
    """Metabase JWT SSO entry: /auth/sso?jwt=…&return_to=…"""
    from urllib.parse import quote

    base = metabase_site_url()
    if not base:
        raise RuntimeError("METABASE_SITE_URL is not configured")
    path = return_to if return_to.startswith("/") else f"/{return_to}"
    return f"{base}/auth/sso?jwt={quote(token, safe='')}&return_to={quote(path, safe='')}"


def open_site_url(return_to: str = "/") -> str:
    base = metabase_site_url()
    if not base:
        raise RuntimeError("METABASE_SITE_URL is not configured")
    path = return_to if return_to.startswith("/") else f"/{return_to}"
    return f"{base}{path}"


def mint_static_embed_url(
    *,
    resource_type: str,
    resource_id: int,
    params: Optional[Dict[str, Any]] = None,
    ttl_seconds: int = 600,
) -> str:
    """Signed static embed URL (OSS). resource_type: dashboard | question."""
    secret = metabase_embedding_secret()
    base = metabase_site_url()
    if not secret or not base:
        raise RuntimeError("Static embedding is not configured")
    now = int(time.time())
    payload = {
        "resource": {resource_type: resource_id},
        "params": params or {},
        "exp": now + max(60, ttl_seconds),
    }
    token = jwt.encode(payload, secret, algorithm="HS256")
    return f"{base}/embed/{resource_type}/{token}#bordered=true&titled=true"


def starter_dashboard_catalog() -> List[Dict[str, Any]]:
    """Curated packs — ids from env METABASE_DASHBOARD_<KEY> or dashboard_ids.json."""
    hints = [
        {"key": "risk_posture", "title": "Risk posture", "hint": "Open risks, residual, aging"},
        {"key": "vendor_tpra", "title": "Vendor & TPRA", "hint": "Tiers, findings, residual"},
        {"key": "issues_vulns", "title": "Issues & vulnerabilities", "hint": "Backlog and severity"},
        {"key": "evidence_compliance", "title": "Evidence & compliance", "hint": "Stale evidence, mappings"},
    ]
    file_ids: Dict[str, Any] = {}
    # Prefer env absolute path, else repo deploy/metabase/dashboard_ids.json
    path = (os.getenv("METABASE_DASHBOARD_IDS_FILE") or "").strip()
    if not path:
        here = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
        candidate = os.path.join(here, "deploy", "metabase", "dashboard_ids.json")
        if os.path.isfile(candidate):
            path = candidate
    if path and os.path.isfile(path):
        try:
            import json
            with open(path, encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                file_ids = raw
        except Exception:
            file_ids = {}

    out: List[Dict[str, Any]] = []
    for h in hints:
        key = h["key"]
        env_id = (os.getenv(f"METABASE_DASHBOARD_{key.upper()}") or "").strip()
        dash_id: Optional[int] = None
        if env_id.isdigit():
            dash_id = int(env_id)
        else:
            entry = file_ids.get(key)
            if isinstance(entry, dict) and entry.get("id") is not None:
                try:
                    dash_id = int(entry["id"])
                except (TypeError, ValueError):
                    dash_id = None
            elif isinstance(entry, int):
                dash_id = entry
        out.append({**h, "metabase_dashboard_id": dash_id})
    return out
