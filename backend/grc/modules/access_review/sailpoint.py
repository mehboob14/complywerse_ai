"""Tier-2 connector: pull the population from an IGA governance system —
SailPoint Identity Security Cloud (the market leader; Saviynt/Oracle IG follow
the same token+REST shape).

Why Tier 2 matters: the directory connectors (Entra/Okta/Google/AD) give
*identity + basic directory roles*. An IGA system is where the **full
entitlements** live — every access profile / role / entitlement a person holds
across apps. This connector pulls those entitlements and writes them as
grc_roles + grc_user_roles (source='sailpoint'), so the privilege / SoD /
over-privileged rule packs finally run on real governance data, not just login
roles.

`map_identity()` is pure (fixture-testable); `fetch_sailpoint_identities()`
lazily talks to the API so the rest of the app loads without credentials. The
client secret is supplied per-sync and is NEVER stored.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.orm import Session

from ...models import GRCUser, Role, UserRole

logger = logging.getLogger(__name__)
PROVIDER_SAILPOINT = "sailpoint"

# SailPoint cloudLifecycleState values that mean the account is not usable.
_INACTIVE_STATES = {"inactive", "disabled", "terminated", "leaver"}
_TERMINATED_STATES = {"terminated", "leaver"}


def normalize_base_url(url: str) -> str:
    u = (url or "").strip().rstrip("/")
    if u and not u.startswith("http"):
        u = "https://" + u
    return u


def get_token(base_url: str, client_id: str, client_secret: str) -> str:
    """OAuth2 client-credentials grant — returns a bearer access token."""
    url = f"{normalize_base_url(base_url)}/oauth/token"
    with httpx.Client(timeout=30) as client:
        r = client.post(url, params={
            "grant_type": "client_credentials",
            "client_id": client_id, "client_secret": client_secret,
        })
        r.raise_for_status()
        return r.json()["access_token"]


def fetch_sailpoint_identities(base_url: str, client_id: str, client_secret: str,
                               max_pages: int = 50, page_size: int = 250) -> List[Dict[str, Any]]:
    """Page the Search API for identities + their access (entitlements)."""
    token = get_token(base_url, client_id, client_secret)
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    search_url = f"{normalize_base_url(base_url)}/v3/search"
    out: List[Dict[str, Any]] = []
    with httpx.Client(timeout=45) as client:
        for page in range(max_pages):
            body = {
                "indices": ["identities"],
                "query": {"query": "*"},
                "sort": ["id"],
                "searchAfter": [out[-1]["id"]] if out else None,
            }
            r = client.post(search_url, headers=headers,
                            params={"limit": page_size}, json=body)
            r.raise_for_status()
            batch = r.json() or []
            if not batch:
                break
            out.extend(batch)
            if len(batch) < page_size:
                break
    return out


def map_identity(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Map one SailPoint identity doc to our fields (pure, fixture-testable)."""
    sid = raw.get("id")
    attrs = raw.get("attributes") or {}
    email = (attrs.get("email") or raw.get("email") or "").lower().strip()
    if not sid or not email:
        return None
    name = attrs.get("displayName") or raw.get("name") or email
    state = str(attrs.get("cloudLifecycleState") or raw.get("lifecycleState") or "active").lower()
    # Entitlements / access profiles / roles the identity holds.
    ents: List[str] = []
    for a in (raw.get("access") or []):
        nm = a.get("name") if isinstance(a, dict) else a
        if nm:
            ents.append(str(nm))
    return {
        "external_id": str(sid),
        "email": email,
        "display_name": str(name),
        "department": attrs.get("department"),
        "designation": attrs.get("jobTitle") or attrs.get("title"),
        "account_enabled": state not in _INACTIVE_STATES,
        "terminated": state in _TERMINATED_STATES,
        "entitlements": ents,
    }


def _get_or_create_role(db: Session, tenant_id: int, name: str, cache: Dict[str, Role]) -> Role:
    if name in cache:
        return cache[name]
    role = db.query(Role).filter(Role.tenant_id == tenant_id, Role.name == name).first()
    if role is None:
        role = Role(tenant_id=tenant_id, name=name, description="Imported from SailPoint IGA")
        db.add(role)
        db.flush()
    cache[name] = role
    return role


def sync_sailpoint_population(tenant_db: Session, *, tenant_id: int, base_url: str,
                             client_id: str, client_secret: str) -> Dict[str, Any]:
    """Pull identities + entitlements from SailPoint and upsert users + roles.

    `tenant_id` is the tenant whose roles/assignments these belong to (new users
    carry no tenant_id of their own, and UserRole.tenant_id is required)."""
    if not base_url or not client_id or not client_secret:
        raise ValueError("SailPoint base URL, client id and client secret are all required")
    from ...routers.sso_router import _make_unloginable_hash

    identities = fetch_sailpoint_identities(base_url, client_id, client_secret)
    created = updated = skipped = ent_links = 0
    now = datetime.utcnow()
    role_cache: Dict[str, Role] = {}
    for raw in identities:
        m = map_identity(raw)
        if not m:
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
                           external_provider=PROVIDER_SAILPOINT, external_id=m["external_id"])
            tenant_db.add(user)
            tenant_db.flush()
            created += 1
        else:
            if not user.external_id:
                user.external_provider = PROVIDER_SAILPOINT
                user.external_id = m["external_id"]
            updated += 1
        user.display_name = m["display_name"] or user.display_name
        user.department = m["department"] or user.department
        user.designation = m["designation"] or user.designation
        user.account_enabled = m["account_enabled"]
        if m["terminated"] and not user.termination_date:
            user.termination_date = date.today()
        user.access_synced_at = now

        # Reconcile this user's SailPoint-sourced entitlements → roles, so a
        # re-sync replaces (not duplicates) them. Other sources are untouched.
        tenant_db.query(UserRole).filter(
            UserRole.user_id == user.id, UserRole.source == PROVIDER_SAILPOINT
        ).delete(synchronize_session=False)
        for ent in m["entitlements"]:
            role = _get_or_create_role(tenant_db, tenant_id, ent, role_cache)
            tenant_db.add(UserRole(user_id=user.id, role_id=role.id,
                                   tenant_id=tenant_id, source=PROVIDER_SAILPOINT))
            ent_links += 1
    tenant_db.commit()
    return {"created": created, "updated": updated, "skipped": skipped,
            "entitlements_linked": ent_links, "total_in_directory": len(identities)}
