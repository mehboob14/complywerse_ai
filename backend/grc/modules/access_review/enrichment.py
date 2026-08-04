"""Sync + enrich the user population from Microsoft Entra Graph.

Reuses the SSO router's app-token + paged-Graph plumbing so we don't duplicate
the OAuth/consent machinery. Everything degrades gracefully: if a particular
Graph endpoint is not permissioned (MFA report / sign-in activity both need
extra read scopes), that enrichment is skipped and the rest still runs.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ...models import GRCUser, Tenant
from ...routers.sso_router import (
    PROVIDER_ENTRA,
    _acquire_app_token,
    _domain_allowed,
    _graph_get_paged,
    _make_unloginable_hash,
)

logger = logging.getLogger(__name__)


def _parse_graph_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        # Graph returns ISO-8601 with a trailing Z
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _parse_graph_date(value: Optional[str]):
    dt = _parse_graph_dt(value)
    return dt.date() if dt else None


def _fetch_mfa_registration(app_token: str) -> Dict[str, Dict[str, Any]]:
    """user-id -> {isMfaRegistered, methodsRegistered}. Needs AuditLog.Read.All
    or Reports.Read.All; returns {} if not permissioned."""
    url = (
        "https://graph.microsoft.com/v1.0/reports/authenticationMethods/"
        "userRegistrationDetails?$select=id,isMfaRegistered,methodsRegistered"
    )
    try:
        rows = _graph_get_paged(url, app_token)
    except Exception:
        logger.info("MFA registration report not available (missing scope?) — skipping")
        return {}
    out: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        rid = r.get("id")
        if rid:
            out[rid] = r
    return out


def _fetch_sign_in_activity(app_token: str) -> Dict[str, Optional[str]]:
    """user-id -> last interactive sign-in ISO string. Needs AuditLog.Read.All;
    returns {} if not permissioned."""
    url = "https://graph.microsoft.com/v1.0/users?$select=id,signInActivity"
    try:
        rows = _graph_get_paged(url, app_token)
    except Exception:
        logger.info("signInActivity not available (missing scope?) — skipping")
        return {}
    out: Dict[str, Optional[str]] = {}
    for r in rows:
        rid = r.get("id")
        act = r.get("signInActivity") or {}
        if rid:
            out[rid] = act.get("lastSignInDateTime")
    return out


def sync_population(tenant_db: Session, cfg) -> Dict[str, Any]:
    """Pull users from Entra and enrich access attributes onto grc_users.

    `cfg` is the tenant's IdentityProviderConfig (must have entra_directory_id).
    Returns counts for the caller to surface.
    """
    if not cfg or not cfg.entra_directory_id:
        raise ValueError("Connect a Microsoft Entra directory first")

    app_token = _acquire_app_token(cfg.entra_directory_id)
    users_url = (
        "https://graph.microsoft.com/v1.0/users?$select="
        "id,mail,userPrincipalName,displayName,accountEnabled,department,"
        "jobTitle,employeeHireDate,employeeLeaveDateTime"
    )
    entra_users = _graph_get_paged(users_url, app_token)

    mfa_map = _fetch_mfa_registration(app_token)
    signin_map = _fetch_sign_in_activity(app_token)

    allowed = list(cfg.allowed_email_domains or [])
    created = 0
    updated = 0
    skipped = 0
    now = datetime.utcnow()

    for u in entra_users:
        oid = u.get("id")
        email = (u.get("mail") or u.get("userPrincipalName") or "").lower().strip()
        if not oid or not email:
            skipped += 1
            continue
        if not _domain_allowed(email, allowed):
            skipped += 1
            continue

        user = (
            tenant_db.query(GRCUser)
            .filter((GRCUser.external_id == oid) | (GRCUser.email == email))
            .first()
        )
        if user is None:
            user = GRCUser(
                username=email,
                email=email,
                password_hash=_make_unloginable_hash(),
                display_name=u.get("displayName") or email,
                is_active=bool(u.get("accountEnabled", True)),
                external_provider=PROVIDER_ENTRA,
                external_id=oid,
            )
            tenant_db.add(user)
            tenant_db.flush()
            created += 1
        else:
            if not user.external_id:
                user.external_provider = PROVIDER_ENTRA
                user.external_id = oid
            updated += 1

        # --- enrichment ---
        user.department = u.get("department") or user.department
        user.designation = u.get("jobTitle") or user.designation
        user.account_enabled = bool(u.get("accountEnabled", True))
        user.hire_date = _parse_graph_date(u.get("employeeHireDate")) or user.hire_date
        leave = _parse_graph_date(u.get("employeeLeaveDateTime"))
        if leave:
            user.termination_date = leave

        mfa = mfa_map.get(oid)
        if mfa is not None:
            user.mfa_enabled = bool(mfa.get("isMfaRegistered"))
            user.mfa_methods = mfa.get("methodsRegistered") or []

        last_si = signin_map.get(oid)
        if last_si:
            user.entra_last_sign_in = _parse_graph_dt(last_si)

        user.access_synced_at = now

    tenant_db.commit()
    return {
        "created": created,
        "updated": updated,
        "skipped": skipped,
        "total_in_directory": len(entra_users),
        "mfa_report_available": bool(mfa_map),
        "sign_in_activity_available": bool(signin_map),
    }
