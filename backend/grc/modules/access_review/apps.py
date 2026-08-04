"""Tier-3 connector framework: pull access from the TARGET BUSINESS APPS where
the real risk sits — Core Banking, SAP, Salesforce, Oracle EBS, ServiceNow and
Databases.

Same shape as the Tier-2 IGA framework (one engine + a per-app adapter), but
these read *app-level permissions* directly: a user's profile/permission-sets
in Salesforce, roles in ServiceNow, SAP roles/profiles, granted DB privileges,
etc. Each becomes an entitlement → role, so the privilege / SoD / over-privilege
rules run on app data. Credentials are supplied per-sync and NEVER stored.
"""
from __future__ import annotations

import base64
import logging
from typing import Any, Callable, Dict, List, Optional

import httpx
from sqlalchemy.orm import Session

from ._ingest import ingest

logger = logging.getLogger(__name__)
PROVIDER_APP = "app"
_INACTIVE = {"inactive", "disabled", "terminated", "false", "0", "no", "locked"}


def normalize_base_url(url: str) -> str:
    u = (url or "").strip().rstrip("/")
    if u and not u.startswith("http"):
        u = "https://" + u
    return u


def _ents(values: Any) -> List[str]:
    out: List[str] = []
    for v in (values or []):
        if isinstance(v, dict):
            nm = v.get("name") or v.get("value") or v.get("display")
        else:
            nm = v
        if nm:
            out.append(str(nm))
    return out


# --------------------------------------------------------------------------- #
# Per-app map() functions — pure, fixture-testable.                            #
# --------------------------------------------------------------------------- #
def _map_rest_user(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Generic REST/OData user — Core Banking, SAP, Oracle EBS."""
    uid = raw.get("id") or raw.get("userId") or raw.get("UserName") or raw.get("Bname")
    email = (raw.get("email") or raw.get("Email") or raw.get("userName") or "").lower().strip()
    if not uid or "@" not in email:
        return None
    name = (raw.get("displayName") or raw.get("fullName") or raw.get("name")
            or f"{raw.get('firstName','')} {raw.get('lastName','')}".strip() or email)
    status = str(raw.get("status", raw.get("active", "active"))).lower()
    ents = _ents(raw.get("roles") or raw.get("profiles") or raw.get("permissions") or raw.get("entitlements"))
    return {
        "external_id": str(uid), "email": email, "display_name": str(name),
        "department": raw.get("department") or raw.get("Department"),
        "designation": raw.get("title") or raw.get("jobTitle"),
        "account_enabled": status not in _INACTIVE, "terminated": status == "terminated",
        "entitlements": ents,
    }


def _map_salesforce(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    sid = raw.get("Id")
    email = (raw.get("Email") or raw.get("Username") or "").lower().strip()
    if not sid or "@" not in email:
        return None
    profile = ((raw.get("Profile") or {}).get("Name")) if isinstance(raw.get("Profile"), dict) else raw.get("Profile")
    ents = ([profile] if profile else []) + _ents((raw.get("PermissionSetAssignments") or {}).get("records")
                                                  if isinstance(raw.get("PermissionSetAssignments"), dict) else None)
    return {
        "external_id": str(sid), "email": email,
        "display_name": raw.get("Name") or email, "department": raw.get("Department"),
        "designation": raw.get("Title"), "account_enabled": bool(raw.get("IsActive", True)),
        "terminated": raw.get("IsActive") is False, "entitlements": [e for e in ents if e],
    }


def _map_servicenow(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    sid = raw.get("sys_id")
    email = (raw.get("email") or raw.get("user_name") or "").lower().strip()
    if not sid or "@" not in email:
        return None
    active = str(raw.get("active", "true")).lower() in ("true", "1", "yes")
    return {
        "external_id": str(sid), "email": email,
        "display_name": raw.get("name") or email, "department": raw.get("department"),
        "designation": raw.get("title"), "account_enabled": active, "terminated": not active,
        "entitlements": _ents(raw.get("roles")),
    }


def _map_db_account(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """A database account (e.g. Postgres pg_roles row) + the roles it belongs to."""
    name = raw.get("rolname") or raw.get("name") or raw.get("username")
    if not name:
        return None
    host = raw.get("_host", "db")
    return {
        "external_id": f"db:{host}:{name}", "email": f"{str(name).lower()}@{host}.db",
        "display_name": f"{name} (db)", "department": "Database",
        "designation": "DB account",
        "account_enabled": bool(raw.get("rolcanlogin", True)) and not raw.get("disabled"),
        "terminated": False,
        # superuser / member-of roles are the entitlements
        "entitlements": (["DB Superuser"] if raw.get("rolsuper") else []) + _ents(raw.get("memberof")),
    }


# --------------------------------------------------------------------------- #
# App registry.                                                               #
# --------------------------------------------------------------------------- #
_BASIC = [{"name": "username", "label": "Username", "secret": False},
          {"name": "password", "label": "Password", "secret": True}]
_OAUTH = [{"name": "client_id", "label": "Client ID", "secret": False},
          {"name": "client_secret", "label": "Client secret", "secret": True}]
_DBFIELDS = [{"name": "db_type", "label": "Engine (postgresql/mysql/mssql)", "secret": False},
             {"name": "host", "label": "Host", "secret": False},
             {"name": "port", "label": "Port", "secret": False},
             {"name": "database", "label": "Database", "secret": False},
             {"name": "username", "label": "Username", "secret": False},
             {"name": "password", "label": "Password", "secret": True}]


def _app(label, auth, fields, method, path, list_key, map_fn, default_url=""):
    return {"label": label, "kind": "app", "auth": auth, "fields": fields,
            "method": method, "path": path, "list_key": list_key, "map": map_fn,
            "default_url": default_url}


APPS: Dict[str, Dict[str, Any]] = {
    "core_banking": _app("Core Banking", "basic", _BASIC, "GET", "/api/v1/users", "users", _map_rest_user, "https://corebank.internal"),
    "sap":          _app("SAP", "basic", _BASIC, "GET", "/sap/bc/rest/users", "results", _map_rest_user),
    "salesforce":   _app("Salesforce", "oauth2_client", _OAUTH, "GET", "/services/data/v60.0/query?q=SELECT+Id,Name,Email,IsActive,Profile.Name+FROM+User", "records", _map_salesforce, "https://acme.my.salesforce.com"),
    "oracle_ebs":   _app("Oracle EBS", "basic", _BASIC, "GET", "/webservices/rest/users", "items", _map_rest_user),
    "servicenow":   _app("ServiceNow", "basic", _BASIC, "GET", "/api/now/table/sys_user", "result", _map_servicenow, "https://acme.service-now.com"),
    "database":     _app("Database", "db", _DBFIELDS, "SQL", "", None, _map_db_account),
}


def app_list() -> List[Dict[str, Any]]:
    return [{"key": k, "label": v["label"], "kind": v["kind"], "auth": v["auth"],
             "fields": v["fields"], "default_url": v["default_url"]} for k, v in APPS.items()]


# --------------------------------------------------------------------------- #
# Fetch — HTTP for SaaS/REST apps, SQL for the Database adapter.               #
# --------------------------------------------------------------------------- #
def _auth_headers(app: Dict[str, Any], base: str, creds: Dict[str, str], client: httpx.Client) -> Dict[str, str]:
    auth = app["auth"]
    if auth == "basic":
        tok = base64.b64encode(f"{creds.get('username')}:{creds.get('password')}".encode()).decode()
        return {"Authorization": f"Basic {tok}"}
    if auth == "oauth2_client":
        r = client.post(f"{base}/services/oauth2/token", data={
            "grant_type": "client_credentials",
            "client_id": creds.get("client_id"), "client_secret": creds.get("client_secret")})
        r.raise_for_status()
        return {"Authorization": f"Bearer {r.json()['access_token']}"}
    return {}


def _fetch_db_accounts(creds: Dict[str, str]) -> List[Dict[str, Any]]:
    """Read DB accounts + their role memberships from the engine's catalog."""
    from sqlalchemy import create_engine, text
    engine = (creds.get("db_type") or "postgresql").strip()
    url = f"{engine}://{creds['username']}:{creds['password']}@{creds['host']}:{creds.get('port') or 5432}/{creds['database']}"
    eng = create_engine(url, connect_args={"connect_timeout": 15} if engine.startswith("postgre") else {})
    rows: List[Dict[str, Any]] = []
    with eng.connect() as conn:
        if engine.startswith("postgre"):
            res = conn.execute(text(
                "SELECT r.rolname, r.rolsuper, r.rolcanlogin, "
                "ARRAY(SELECT b.rolname FROM pg_auth_members m JOIN pg_roles b ON m.roleid=b.oid "
                "WHERE m.member=r.oid) AS memberof FROM pg_roles r"))
        else:  # mysql / mssql best-effort
            res = conn.execute(text("SELECT User AS rolname FROM mysql.user"))
        for row in res.mappings():
            d = dict(row)
            d["_host"] = creds.get("host", "db")
            rows.append(d)
    eng.dispose()
    return rows


def fetch_app_records(app_key: str, base_url: str, creds: Dict[str, str],
                      max_pages: int = 40, page_size: int = 200) -> List[Dict[str, Any]]:
    app = APPS[app_key]
    if app["auth"] == "db":
        return _fetch_db_accounts(creds)
    base = normalize_base_url(base_url)
    out: List[Dict[str, Any]] = []
    with httpx.Client(timeout=45) as client:
        headers = _auth_headers(app, base, creds, client)
        headers["Accept"] = "application/json"
        url = f"{base}{app['path']}"
        for page in range(max_pages):
            sep = "&" if "?" in url else "?"
            r = client.get(f"{url}{sep}limit={page_size}&offset={page * page_size}", headers=headers)
            r.raise_for_status()
            data = r.json()
            batch = data.get(app["list_key"]) if (app["list_key"] and isinstance(data, dict)) else data
            batch = batch or []
            if not isinstance(batch, list) or not batch:
                break
            out.extend(batch)
            if len(batch) < page_size:
                break
    return out


def sync_app_population(tenant_db: Session, *, tenant_id: int, app_key: str,
                        base_url: str, credentials: Dict[str, str],
                        sample: bool = False) -> Dict[str, Any]:
    if app_key not in APPS:
        raise ValueError(f"Unknown app '{app_key}'")
    app = APPS[app_key]
    provider_tag = f"{PROVIDER_APP}:{app_key}"

    if sample:
        from .sample_data import make_sample
        result = ingest(tenant_db, tenant_id=tenant_id, records=make_sample(provider_tag),
                        map_fn=lambda x: x, provider_tag=provider_tag)
        return {"app": app_key, "sample": True, **result}

    missing = [f["name"] for f in app["fields"] if not (credentials or {}).get(f["name"])]
    needs_url = app["auth"] != "db"
    if (needs_url and not base_url) or missing:
        raise ValueError(f"{app['label']} needs {'base URL and ' if needs_url else ''}{', '.join(missing) or 'credentials'}")
    records = fetch_app_records(app_key, base_url, credentials)
    result = ingest(tenant_db, tenant_id=tenant_id, records=records,
                    map_fn=app["map"], provider_tag=provider_tag)
    return {"app": app_key, **result}
