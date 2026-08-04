"""Sync the user population from Okta — an alternative identity source to
Microsoft Entra.

Okta is token-based (an SSWS API token + the org domain); there is no app
registration or admin-consent flow, so this is simpler than Entra to connect.
It writes to the SAME grc_users columns, so everything downstream of the
population (Stages 2-6) is identical regardless of source — the "two faucets,
one tank" pattern.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.orm import Session

from ...models import GRCUser

logger = logging.getLogger(__name__)
PROVIDER_OKTA = "okta"


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def normalize_domain(domain: str) -> str:
    d = (domain or "").strip()
    for p in ("https://", "http://"):
        if d.startswith(p):
            d = d[len(p):]
    return d.strip("/")


def _domain_allowed(email: str, allowed: Optional[List[str]]) -> bool:
    if not allowed:
        return True
    dom = email.split("@")[-1].lower()
    return any(dom == a.lower().lstrip("@") for a in allowed)


def fetch_okta_users(domain: str, token: str, max_pages: int = 50) -> List[Dict[str, Any]]:
    """Page through GET /api/v1/users (Okta uses Link-header cursor paging)."""
    base = f"https://{normalize_domain(domain)}/api/v1/users"
    headers = {"Authorization": f"SSWS {token}", "Accept": "application/json"}
    out: List[Dict[str, Any]] = []
    url = base + "?limit=200"
    with httpx.Client(timeout=30) as client:
        for _ in range(max_pages):
            r = client.get(url, headers=headers)
            r.raise_for_status()
            page = r.json()
            if isinstance(page, list):
                out.extend(page)
            nxt = (r.links.get("next") or {}).get("url")
            if not nxt:
                break
            url = nxt
    return out


def map_user(u: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Map one Okta user object to grc_users fields (pure, fixture-testable)."""
    oid = u.get("id")
    prof = u.get("profile") or {}
    email = (prof.get("email") or prof.get("login") or "").lower().strip()
    if not oid or not email:
        return None
    status = (u.get("status") or "").upper()
    name = (prof.get("displayName")
            or f"{prof.get('firstName', '')} {prof.get('lastName', '')}".strip()
            or email)
    out = {
        "external_id": oid,
        "email": email,
        "display_name": name,
        "department": prof.get("department"),
        "designation": prof.get("title"),
        # SUSPENDED / DEPROVISIONED / STAGED = not an active, usable account.
        "account_enabled": status not in ("SUSPENDED", "DEPROVISIONED", "STAGED"),
        "entra_last_sign_in": _parse_dt(u.get("lastLogin")),
        "termination_date": None,
    }
    if status == "DEPROVISIONED":
        sc = _parse_dt(u.get("statusChanged"))
        out["termination_date"] = sc.date() if sc else None
    return out


def sync_okta_population(tenant_db: Session, *, domain: str, token: str,
                        allowed_domains: Optional[List[str]] = None) -> Dict[str, Any]:
    """Pull users from Okta and upsert into grc_users."""
    if not domain or not token:
        raise ValueError("Okta domain and API token are required")
    from ...routers.sso_router import _make_unloginable_hash

    users = fetch_okta_users(domain, token)
    created = updated = skipped = 0
    now = datetime.utcnow()
    for raw in users:
        m = map_user(raw)
        if not m or not _domain_allowed(m["email"], allowed_domains):
            skipped += 1
            continue
        user = (
            tenant_db.query(GRCUser)
            .filter((GRCUser.external_id == m["external_id"]) | (GRCUser.email == m["email"]))
            .first()
        )
        if user is None:
            user = GRCUser(username=m["email"], email=m["email"],
                           password_hash=_make_unloginable_hash(), is_active=True,
                           external_provider=PROVIDER_OKTA, external_id=m["external_id"])
            tenant_db.add(user)
            tenant_db.flush()
            created += 1
        else:
            if not user.external_id:
                user.external_provider = PROVIDER_OKTA
                user.external_id = m["external_id"]
            updated += 1
        user.display_name = m["display_name"] or user.display_name
        user.department = m["department"] or user.department
        user.designation = m["designation"] or user.designation
        user.account_enabled = m["account_enabled"]
        if m["entra_last_sign_in"]:
            user.entra_last_sign_in = m["entra_last_sign_in"]
        if m["termination_date"]:
            user.termination_date = m["termination_date"]
        user.access_synced_at = now
    tenant_db.commit()
    return {"created": created, "updated": updated, "skipped": skipped,
            "total_in_directory": len(users)}
