"""Sync the user population from Google Workspace (Admin SDK Directory API).

Token-based: an OAuth2 access token (Bearer) + the customer id. Reuses the same
grc_users columns as Entra/Okta. Google conveniently provides MFA enrollment
(isEnrolledIn2Sv) and last login, so the enrichment is richer than Okta's.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

import httpx
from sqlalchemy.orm import Session

from ...models import GRCUser

logger = logging.getLogger(__name__)
PROVIDER_GOOGLE = "google"
_API = "https://admin.googleapis.com/admin/directory/v1/users"


def _parse_dt(value: Optional[str]) -> Optional[datetime]:
    if not value or str(value).startswith("1970"):
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _domain_allowed(email: str, allowed: Optional[List[str]]) -> bool:
    if not allowed:
        return True
    dom = email.split("@")[-1].lower()
    return any(dom == a.lower().lstrip("@") for a in allowed)


def fetch_google_users(access_token: str, customer: str = "my_customer", max_pages: int = 50) -> List[Dict[str, Any]]:
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
    out: List[Dict[str, Any]] = []
    params = {"customer": customer, "maxResults": 200, "projection": "full"}
    with httpx.Client(timeout=30) as client:
        for _ in range(max_pages):
            r = client.get(_API, headers=headers, params=params)
            r.raise_for_status()
            data = r.json()
            out.extend(data.get("users", []) or [])
            tok = data.get("nextPageToken")
            if not tok:
                break
            params = {**params, "pageToken": tok}
    return out


def map_user(u: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Map one Google Directory user to grc_users fields (pure, fixture-testable)."""
    gid = u.get("id")
    email = (u.get("primaryEmail") or "").lower().strip()
    if not gid or not email:
        return None
    name = (u.get("name") or {}).get("fullName") or email
    orgs = u.get("organizations") or []
    org = orgs[0] if orgs else {}
    suspended = bool(u.get("suspended"))
    archived = bool(u.get("archived"))
    return {
        "external_id": gid,
        "email": email,
        "display_name": name,
        "department": org.get("department"),
        "designation": org.get("title"),
        "account_enabled": not (suspended or archived),
        "mfa_enabled": bool(u.get("isEnrolledIn2Sv")),
        "entra_last_sign_in": _parse_dt(u.get("lastLoginTime")),
        # Google "archived" ~ off-boarded; treat as terminated (date unknown).
        "terminated": archived,
    }


def sync_google_population(tenant_db: Session, *, access_token: str, customer: str = "my_customer",
                          allowed_domains: Optional[List[str]] = None) -> Dict[str, Any]:
    if not access_token:
        raise ValueError("A Google access token is required")
    from ...routers.sso_router import _make_unloginable_hash
    from datetime import date

    users = fetch_google_users(access_token, customer or "my_customer")
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
                           external_provider=PROVIDER_GOOGLE, external_id=m["external_id"])
            tenant_db.add(user)
            tenant_db.flush()
            created += 1
        else:
            if not user.external_id:
                user.external_provider = PROVIDER_GOOGLE
                user.external_id = m["external_id"]
            updated += 1
        user.display_name = m["display_name"] or user.display_name
        user.department = m["department"] or user.department
        user.designation = m["designation"] or user.designation
        user.account_enabled = m["account_enabled"]
        user.mfa_enabled = m["mfa_enabled"]
        if m["entra_last_sign_in"]:
            user.entra_last_sign_in = m["entra_last_sign_in"]
        if m["terminated"] and not user.termination_date:
            user.termination_date = date.today()
        user.access_synced_at = now
    tenant_db.commit()
    return {"created": created, "updated": updated, "skipped": skipped,
            "total_in_directory": len(users)}
