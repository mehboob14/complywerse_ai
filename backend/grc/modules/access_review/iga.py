"""Tier-2 IGA / IAM governance connector framework — one generic engine, a
per-vendor adapter registry.

Every IGA/PAM vendor exposes the same conceptual data (identities + the
entitlements they hold), just over different auth + endpoints. So instead of a
file per vendor we keep ONE engine and a small adapter per vendor describing:

  * auth      — how to get a bearer/session (oauth2_client | token_login |
                basic | apikey)
  * identities— the endpoint + how to page it + where the list sits
  * map(raw)  — normalise one record to our shape (pure, fixture-testable)

All adapters write to the SAME grc_users + grc_roles/grc_user_roles model, so
the privilege / SoD rule packs run on whichever IGA you connect. Secrets are
supplied per-sync and NEVER stored — only the vendor + base URL + status are.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Callable, Dict, List, Optional

import httpx
from sqlalchemy.orm import Session

from ...models import GRCUser, Role, UserRole
from . import sailpoint as _sp

logger = logging.getLogger(__name__)
PROVIDER_IGA = "iga"

_INACTIVE = {"inactive", "disabled", "terminated", "leaver", "suspended", "false", "0", "no"}
_TERMINATED = {"terminated", "leaver"}


def normalize_base_url(url: str) -> str:
    u = (url or "").strip().rstrip("/")
    if u and not u.startswith("http"):
        u = "https://" + u
    return u


def _enabled_from(state: Any) -> bool:
    return str(state).strip().lower() not in _INACTIVE


def _ents(values: Any) -> List[str]:
    out: List[str] = []
    for v in (values or []):
        if isinstance(v, dict):
            nm = v.get("value") or v.get("name") or v.get("display") or v.get("entitlement_value")
        else:
            nm = v
        if nm:
            out.append(str(nm))
    return out


# --------------------------------------------------------------------------- #
# Per-vendor map() functions — pure, fixture-testable.                         #
# --------------------------------------------------------------------------- #
def _map_scim(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """SCIM 2.0 user — used by Oracle IG, IBM Verify, Ping (PingOne)."""
    sid = raw.get("id") or raw.get("externalId")
    emails = raw.get("emails") or []
    email = ""
    if emails:
        email = (emails[0].get("value") if isinstance(emails[0], dict) else emails[0]) or ""
    email = (email or raw.get("userName") or "").lower().strip()
    if not sid or "@" not in email:
        return None
    name = (raw.get("name") or {}).get("formatted") or raw.get("displayName") or raw.get("userName") or email
    ent = (raw.get("enterprise") or raw.get("urn:ietf:params:scim:schemas:extension:enterprise:2.0:User") or {})
    return {
        "external_id": str(sid), "email": email, "display_name": str(name),
        "department": ent.get("department"), "designation": (raw.get("title") or ent.get("title")),
        "account_enabled": bool(raw.get("active", True)),
        "terminated": raw.get("active") is False and str(ent.get("lifecycle", "")).lower() in _TERMINATED,
        "entitlements": _ents(raw.get("roles")) + _ents(raw.get("groups")),
    }


def _map_saviynt(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    email = (raw.get("email") or raw.get("username") or "").lower().strip()
    sid = raw.get("username") or raw.get("systemUserName") or email
    if not sid or "@" not in email:
        return None
    name = (f"{raw.get('firstname','')} {raw.get('lastname','')}".strip() or raw.get("displayname") or email)
    status = str(raw.get("statuskey", raw.get("status", "1")))
    return {
        "external_id": str(sid), "email": email, "display_name": name,
        "department": raw.get("departmentname") or raw.get("department"),
        "designation": raw.get("title") or raw.get("jobcode"),
        "account_enabled": status not in ("0", "inactive", "disabled"),
        "terminated": status in ("terminated", "leaver"),
        "entitlements": _ents(raw.get("entitlements")),
    }


def _map_oneidentity(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    sid = raw.get("UID_Person") or raw.get("id")
    email = (raw.get("DefaultEmailAddress") or raw.get("email") or "").lower().strip()
    if not sid or "@" not in email:
        return None
    name = (f"{raw.get('FirstName','')} {raw.get('LastName','')}".strip()
            or raw.get("CentralAccount") or email)
    return {
        "external_id": str(sid), "email": email, "display_name": name,
        "department": raw.get("Department"), "designation": raw.get("JobTitle"),
        "account_enabled": not bool(raw.get("IsInActive")),
        "terminated": bool(raw.get("IsInActive")) and bool(raw.get("ExitDate")),
        "entitlements": _ents(raw.get("Entitlements") or raw.get("Roles")),
    }


def _map_jumpcloud(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    sid = raw.get("_id") or raw.get("id")
    email = (raw.get("email") or "").lower().strip()
    if not sid or "@" not in email:
        return None
    name = (f"{raw.get('firstname','')} {raw.get('lastname','')}".strip()
            or raw.get("displayname") or email)
    disabled = bool(raw.get("suspended")) or bool(raw.get("account_locked"))
    return {
        "external_id": str(sid), "email": email, "display_name": name,
        "department": raw.get("department"), "designation": raw.get("jobTitle"),
        "account_enabled": not disabled, "terminated": False,
        "entitlements": _ents(raw.get("groups")),
    }


def _map_pam_account(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """CyberArk / BeyondTrust expose privileged ACCOUNTS, not people. Normalise
    each to a user carrying a 'Privileged: <system>' entitlement so the
    privileged-access rules fire."""
    sid = str(raw.get("id") or raw.get("ManagedAccountID") or raw.get("AccountID") or "")
    acct = raw.get("userName") or raw.get("AccountName") or raw.get("name") or ""
    system = raw.get("address") or raw.get("SystemName") or raw.get("platformId") or "system"
    if not sid or not acct:
        return None
    # synthesise an email-like id so it slots into grc_users
    email = f"{str(acct).lower()}@{str(system).lower().replace(' ', '-')}.pam".strip()
    return {
        "external_id": sid, "email": email, "display_name": f"{acct} ({system})",
        "department": "Privileged", "designation": "Privileged account",
        "account_enabled": not bool(raw.get("disabled")), "terminated": False,
        "entitlements": [f"Privileged: {system}"],
    }


# --------------------------------------------------------------------------- #
# Vendor registry.                                                            #
# --------------------------------------------------------------------------- #
def _vendor(label, kind, auth, fields, method, path, list_key, map_fn, default_url=""):
    return {"label": label, "kind": kind, "auth": auth, "fields": fields,
            "method": method, "path": path, "list_key": list_key, "map": map_fn,
            "default_url": default_url}


_OAUTH = [{"name": "client_id", "label": "Client ID", "secret": False},
          {"name": "client_secret", "label": "Client secret", "secret": True}]
_USERPASS = [{"name": "username", "label": "Username", "secret": False},
             {"name": "password", "label": "Password", "secret": True}]
_APIKEY = [{"name": "api_key", "label": "API key", "secret": True}]

VENDORS: Dict[str, Dict[str, Any]] = {
    "sailpoint":   _vendor("SailPoint", "IGA", "oauth2_client", _OAUTH, "POST", "/v3/search", None, _sp.map_identity, "https://acme.api.identitynow.com"),
    "saviynt":     _vendor("Saviynt", "IGA", "token_login", _USERPASS, "POST", "/ECM/api/v5/getUser", "userlist", _map_saviynt),
    "oracle_ig":   _vendor("Oracle Identity Gov", "IGA", "basic", _USERPASS, "GET", "/iam/governance/scim/v1/Users", "Resources", _map_scim),
    "ibm_verify":  _vendor("IBM Security Verify", "IGA", "oauth2_client", _OAUTH, "GET", "/v2.0/Users", "Resources", _map_scim),
    "one_identity":_vendor("One Identity", "IGA", "apikey", _APIKEY, "GET", "/api/identities", "results", _map_oneidentity),
    "ping":        _vendor("Ping Identity", "IGA", "oauth2_client", _OAUTH, "GET", "/scim/v2/Users", "Resources", _map_scim),
    "jumpcloud":   _vendor("JumpCloud", "IGA", "apikey", _APIKEY, "GET", "/api/systemusers", "results", _map_jumpcloud),
    "cyberark":    _vendor("CyberArk", "PAM", "userpass_logon", _USERPASS, "GET", "/PasswordVault/API/Accounts", "value", _map_pam_account),
    "beyondtrust": _vendor("BeyondTrust", "PAM", "apikey", _APIKEY, "GET", "/BeyondTrust/api/public/v3/ManagedAccounts", None, _map_pam_account),
}


def vendor_list() -> List[Dict[str, Any]]:
    return [{"key": k, "label": v["label"], "kind": v["kind"], "auth": v["auth"],
             "fields": v["fields"], "default_url": v["default_url"]} for k, v in VENDORS.items()]


# --------------------------------------------------------------------------- #
# Generic fetch — auth dispatch + paged identities pull.                       #
# --------------------------------------------------------------------------- #
def _auth_headers(vendor: Dict[str, Any], base: str, creds: Dict[str, str], client: httpx.Client) -> Dict[str, str]:
    auth = vendor["auth"]
    if auth == "oauth2_client":
        r = client.post(f"{base}/oauth/token", params={
            "grant_type": "client_credentials",
            "client_id": creds.get("client_id"), "client_secret": creds.get("client_secret")})
        r.raise_for_status()
        return {"Authorization": f"Bearer {r.json()['access_token']}"}
    if auth == "token_login":  # Saviynt-style: POST login -> token
        r = client.post(f"{base}/ECM/api/v5/login", json={
            "username": creds.get("username"), "password": creds.get("password")})
        r.raise_for_status()
        tok = r.json().get("access_token") or r.json().get("token")
        return {"Authorization": f"Bearer {tok}"}
    if auth == "userpass_logon":  # CyberArk-style: POST logon -> session token
        r = client.post(f"{base}/PasswordVault/API/auth/Cyberark/Logon", json={
            "username": creds.get("username"), "password": creds.get("password")})
        r.raise_for_status()
        return {"Authorization": r.text.strip('"')}
    if auth == "basic":
        import base64
        tok = base64.b64encode(f"{creds.get('username')}:{creds.get('password')}".encode()).decode()
        return {"Authorization": f"Basic {tok}"}
    if auth == "apikey":
        return {"Authorization": f"Bearer {creds.get('api_key')}", "x-api-key": creds.get("api_key", "")}
    return {}


def fetch_identities(vendor_key: str, base_url: str, creds: Dict[str, str],
                     max_pages: int = 40, page_size: int = 200) -> List[Dict[str, Any]]:
    vendor = VENDORS[vendor_key]
    base = normalize_base_url(base_url)
    out: List[Dict[str, Any]] = []
    with httpx.Client(timeout=45) as client:
        headers = _auth_headers(vendor, base, creds, client)
        headers["Accept"] = "application/json"
        url = f"{base}{vendor['path']}"
        for page in range(max_pages):
            if vendor["method"] == "POST":
                body = {"indices": ["identities"], "query": {"query": "*"}} if vendor_key == "sailpoint" else {}
                r = client.post(url, headers=headers, params={"limit": page_size, "offset": page * page_size}, json=body)
            else:
                r = client.get(url, headers=headers, params={"count": page_size, "startIndex": page * page_size + 1,
                                                             "limit": page_size, "skip": page * page_size})
            r.raise_for_status()
            data = r.json()
            batch = data.get(vendor["list_key"]) if (vendor["list_key"] and isinstance(data, dict)) else data
            batch = batch or []
            if not isinstance(batch, list) or not batch:
                break
            out.extend(batch)
            if len(batch) < page_size:
                break
    return out


# --------------------------------------------------------------------------- #
# Upsert + sync (shared with the SailPoint pattern).                           #
# --------------------------------------------------------------------------- #
def _get_or_create_role(db: Session, tenant_id: int, name: str, cache: Dict[str, Role]) -> Role:
    if name in cache:
        return cache[name]
    role = db.query(Role).filter(Role.tenant_id == tenant_id, Role.name == name).first()
    if role is None:
        role = Role(tenant_id=tenant_id, name=name, description="Imported from IGA")
        db.add(role); db.flush()
    cache[name] = role
    return role


def sync_iga_population(tenant_db: Session, *, tenant_id: int, vendor_key: str,
                        base_url: str, credentials: Dict[str, str],
                        sample: bool = False) -> Dict[str, Any]:
    if vendor_key not in VENDORS:
        raise ValueError(f"Unknown IGA vendor '{vendor_key}'")
    vendor = VENDORS[vendor_key]
    provider_tag = f"{PROVIDER_IGA}:{vendor_key}"

    # Sample mode: load a representative population through the real ingest path
    # (no external system needed). Tagged with `.sample` emails.
    if sample:
        from .sample_data import make_sample
        from ._ingest import ingest
        result = ingest(tenant_db, tenant_id=tenant_id, records=make_sample(provider_tag),
                        map_fn=lambda x: x, provider_tag=provider_tag)
        return {"vendor": vendor_key, "sample": True, **result}

    missing = [f["name"] for f in vendor["fields"] if not (credentials or {}).get(f["name"])]
    if not base_url or missing:
        raise ValueError(f"{vendor['label']} needs base URL and: {', '.join(missing) or 'credentials'}")
    from ...routers.sso_router import _make_unloginable_hash

    records = fetch_identities(vendor_key, base_url, credentials)
    map_fn: Callable = vendor["map"]
    created = updated = skipped = ent_links = 0
    now = datetime.utcnow()
    role_cache: Dict[str, Role] = {}
    for raw in records:
        m = map_fn(raw)
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
                           external_provider=provider_tag, external_id=m["external_id"])
            tenant_db.add(user); tenant_db.flush()
            created += 1
        else:
            if not user.external_id:
                user.external_provider = provider_tag
                user.external_id = m["external_id"]
            updated += 1
        user.display_name = m["display_name"] or user.display_name
        user.department = m["department"] or user.department
        user.designation = m["designation"] or user.designation
        user.account_enabled = m["account_enabled"]
        if m["terminated"] and not user.termination_date:
            user.termination_date = date.today()
        user.access_synced_at = now

        tenant_db.query(UserRole).filter(
            UserRole.user_id == user.id, UserRole.source == provider_tag
        ).delete(synchronize_session=False)
        for ent in m["entitlements"]:
            role = _get_or_create_role(tenant_db, tenant_id, ent, role_cache)
            tenant_db.add(UserRole(user_id=user.id, role_id=role.id,
                                   tenant_id=tenant_id, source=provider_tag))
            ent_links += 1
    tenant_db.commit()
    return {"vendor": vendor_key, "created": created, "updated": updated, "skipped": skipped,
            "entitlements_linked": ent_links, "total_in_directory": len(records)}
