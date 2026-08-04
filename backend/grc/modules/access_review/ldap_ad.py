"""Sync the user population from an on-prem directory over LDAP — Microsoft
Active Directory (the common case) or any LDAPv3 server (OpenLDAP, etc.).

This is the connector senior asked for: orgs that run their identity on-prem
rather than in a cloud IdP. Like Okta/Google it writes to the SAME grc_users
columns, so Stages 2-6 are identical regardless of source ("two faucets, one
tank"). The bind password is supplied per-sync and is NEVER stored at rest —
only the server URL + base DN live on the provider='ldap' config row.

`map_entry()` is pure (no network, no ldap3) so it is fixture-testable without a
real directory; `fetch_ldap_users()` lazily imports ldap3 so the rest of the
app loads even when the optional dependency is absent.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from ...models import GRCUser

logger = logging.getLogger(__name__)
PROVIDER_LDAP = "ldap"

# Active Directory userAccountControl flag: the account is disabled.
UAC_ACCOUNTDISABLE = 0x0002

# Default search: real person accounts in AD. Override per-sync if needed.
DEFAULT_USER_FILTER = "(&(objectClass=user)(objectCategory=person))"

# AD stores some times as Windows FILETIME (100-ns ticks since 1601-01-01).
_FILETIME_EPOCH = datetime(1601, 1, 1)


def normalize_server(server: str, use_ssl: bool = False) -> str:
    """Turn 'dc01.acme.local' into a full ldap:// / ldaps:// URL."""
    s = (server or "").strip()
    if not s:
        return s
    if s.startswith("ldap://") or s.startswith("ldaps://"):
        return s
    return f"{'ldaps' if use_ssl else 'ldap'}://{s}"


def _first(attrs: Dict[str, Any], *keys: str) -> Any:
    """ldap3 returns each attribute as a list; pull the first scalar.

    Accepts already-scalar values too, so the same helper works in fixture
    tests where we pass plain dicts.
    """
    for k in keys:
        if k in attrs and attrs[k] not in (None, "", []):
            v = attrs[k]
            return v[0] if isinstance(v, (list, tuple)) else v
        # case-insensitive fallback (AD attribute case varies by client)
        for ak, av in attrs.items():
            if ak.lower() == k.lower() and av not in (None, "", []):
                return av[0] if isinstance(av, (list, tuple)) else av
    return None


def _to_dt(value: Any) -> Optional[datetime]:
    """Normalise a last-logon value: datetime, Windows FILETIME, or ISO text."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    s = str(value).strip()
    if not s or s in ("0", "9223372036854775807"):  # 0 / "never" sentinel
        return None
    if s.isdigit():  # Windows FILETIME
        try:
            return _FILETIME_EPOCH + timedelta(microseconds=int(s) // 10)
        except Exception:
            return None
    # AD GeneralizedTime e.g. 20260612073000.0Z, or ISO 8601
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        pass
    try:
        return datetime.strptime(s[:14], "%Y%m%d%H%M%S")
    except Exception:
        return None


def map_entry(attrs: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Map one directory entry to grc_users fields (pure, fixture-testable).

    Resolves email from mail > userPrincipalName; identity from
    objectGUID > distinguishedName. Reads AD's userAccountControl to decide
    whether the account is enabled.
    """
    if not attrs:
        return None
    email = (_first(attrs, "mail", "userPrincipalName") or "")
    email = str(email).lower().strip()
    ext_id = _first(attrs, "objectGUID", "distinguishedName", "dn", "entryUUID")
    if "@" not in email or not ext_id:
        return None

    name = (_first(attrs, "displayName", "cn", "name")
            or f"{_first(attrs, 'givenName') or ''} {_first(attrs, 'sn') or ''}".strip()
            or email)

    # account_enabled: AD userAccountControl bit, else a generic status string.
    enabled = True
    uac = _first(attrs, "userAccountControl")
    if uac is not None:
        try:
            enabled = (int(uac) & UAC_ACCOUNTDISABLE) == 0
        except Exception:
            enabled = True
    else:
        status = str(_first(attrs, "accountStatus", "nsAccountLock") or "").lower()
        if status in ("disabled", "inactive", "true", "locked"):
            enabled = False

    return {
        "external_id": str(ext_id),
        "email": email,
        "display_name": str(name),
        "department": _first(attrs, "department"),
        "designation": _first(attrs, "title"),
        "account_enabled": enabled,
        "entra_last_sign_in": _to_dt(_first(attrs, "lastLogonTimestamp", "lastLogon")),
    }


def fetch_ldap_users(server: str, base_dn: str, bind_dn: str, bind_password: str, *,
                     use_ssl: bool = False, user_filter: str = DEFAULT_USER_FILTER,
                     page_size: int = 500, max_entries: int = 50000) -> List[Dict[str, Any]]:
    """Bind and paged-search the directory. Lazily imports ldap3 so the optional
    dependency is only required when an on-prem sync is actually run."""
    try:
        from ldap3 import Server, Connection, ALL, SUBTREE
    except ImportError as e:  # pragma: no cover - environment dependent
        raise RuntimeError(
            "The on-prem AD/LDAP connector needs the 'ldap3' package. "
            "Install it on the backend (pip install ldap3) and retry."
        ) from e

    url = normalize_server(server, use_ssl)
    srv = Server(url, use_ssl=use_ssl, get_info=ALL, connect_timeout=15)
    conn = Connection(srv, user=bind_dn, password=bind_password, auto_bind=True)
    attributes = [
        "objectGUID", "distinguishedName", "entryUUID", "mail", "userPrincipalName",
        "sAMAccountName", "displayName", "cn", "name", "givenName", "sn",
        "department", "title", "userAccountControl", "accountStatus", "nsAccountLock",
        "lastLogonTimestamp", "lastLogon",
    ]
    out: List[Dict[str, Any]] = []
    try:
        cookie = None
        while True:
            conn.search(
                search_base=base_dn, search_filter=user_filter, search_scope=SUBTREE,
                attributes=attributes, paged_size=page_size, paged_cookie=cookie,
            )
            for entry in conn.entries:
                d = entry.entry_attributes_as_dict
                d["distinguishedName"] = entry.entry_dn
                out.append(d)
            if len(out) >= max_entries:
                break
            ctrls = conn.result.get("controls", {}) if conn.result else {}
            cookie = (ctrls.get("1.2.840.113556.1.4.319", {})
                      .get("value", {}).get("cookie"))
            if not cookie:
                break
    finally:
        try:
            conn.unbind()
        except Exception:
            pass
    return out


def sync_ldap_population(tenant_db: Session, *, server: str, base_dn: str, bind_dn: str,
                        bind_password: str, use_ssl: bool = False,
                        user_filter: Optional[str] = None) -> Dict[str, Any]:
    """Pull users from the on-prem directory and upsert into grc_users."""
    if not server or not base_dn or not bind_dn or not bind_password:
        raise ValueError("LDAP server, base DN, bind DN and password are all required")
    from ...routers.sso_router import _make_unloginable_hash

    entries = fetch_ldap_users(
        server, base_dn, bind_dn, bind_password, use_ssl=use_ssl,
        user_filter=user_filter or DEFAULT_USER_FILTER,
    )
    created = updated = skipped = 0
    now = datetime.utcnow()
    for raw in entries:
        m = map_entry(raw)
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
                           external_provider=PROVIDER_LDAP, external_id=m["external_id"])
            tenant_db.add(user)
            tenant_db.flush()
            created += 1
        else:
            if not user.external_id:
                user.external_provider = PROVIDER_LDAP
                user.external_id = m["external_id"]
            updated += 1
        user.display_name = m["display_name"] or user.display_name
        user.department = m["department"] or user.department
        user.designation = m["designation"] or user.designation
        user.account_enabled = m["account_enabled"]
        if m["entra_last_sign_in"]:
            user.entra_last_sign_in = m["entra_last_sign_in"]
        user.access_synced_at = now
    tenant_db.commit()
    return {"created": created, "updated": updated, "skipped": skipped,
            "total_in_directory": len(entries)}
