"""DigitalOcean as an access-review source.

DigitalOcean publishes no API for team members — no endpoint, no console
export — so a review of its estate covers what the API does expose: who the
token belongs to, and every key, token and database user that can reach the
infrastructure. Each of those is an access grant somebody has to justify once a
quarter, so each becomes a population row. They are accounts, not people, and
are named the way ``iga._map_pam_account`` names CyberArk accounts: a
synthesised address (ending ``.do``, which is what the cloud rules match on) so
the row slots into grc_users, and ``is_person=False`` so they stay out of the
app's owner/assignee pickers.

One read-only token does it. Every resource is read on its own, so a token
without a scope skips that resource instead of failing the whole sync, and the
result says what was read and what was skipped — an auditor has to know what
the review actually covered.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlalchemy import desc
from sqlalchemy.orm import Session

from ._ingest import ROLE_NAME_MAX, ingest

API = "https://api.digitalocean.com/v2"
# grc_user_roles.source is VARCHAR(16) — the tag has to fit it.
PROVIDER_DO = "digitalocean"
TIMEOUT = 30
MAX_PAGES = 20
MAX_CLUSTERS = 25                 # bound the per-cluster user calls
KEY_AGE_DAYS = 90
OLD_KEY_ENTITLEMENT = f"DigitalOcean: key older than {KEY_AGE_DAYS} days"
# ponytail: department is "IT", not "DigitalOcean" — these are IT-owned
# infrastructure objects, and PRIV-01 flags privileged access held outside
# IT/Security, which would otherwise fire on every key. Revisit if tenants
# want per-project ownership.
DEPARTMENT = "IT"


def _slug(value: Any) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    return text or "unnamed"


def _entitlement(text: str) -> str:
    """Role names are VARCHAR(100); a long bucket name must not break a sync."""
    return text[:ROLE_NAME_MAX]


def _first_list(payload: Dict[str, Any], *names: str) -> List[Dict[str, Any]]:
    """The list a DigitalOcean response carries, by its documented key or,
    failing that, the first list in the body — the key differs per resource."""
    for name in names:
        value = payload.get(name)
        if isinstance(value, list):
            return value
    for value in payload.values():
        if isinstance(value, list):
            return value
    return []


def _older_than(created_at: Any, days: int = KEY_AGE_DAYS, now: Optional[datetime] = None) -> bool:
    if not created_at:
        return False
    try:
        stamp = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
    except ValueError:
        return False
    if stamp.tzinfo is not None:
        stamp = stamp.astimezone(timezone.utc).replace(tzinfo=None)
    return stamp < (now or datetime.utcnow()) - timedelta(days=days)


def _get(token: str, path: str, params: Optional[Dict[str, Any]] = None) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """(payload, skip reason). A refusal is a skip, not a failure: a read-only
    token is often scoped to some resources and not others."""
    try:
        r = httpx.get(f"{API}{path}", headers={"Authorization": f"Bearer {token}"},
                      params=params, timeout=TIMEOUT)
    except Exception as e:  # noqa: BLE001
        return None, f"could not be reached ({type(e).__name__})"
    if r.status_code == 401:
        return None, "the token was refused (401)"
    if r.status_code in (403, 404):
        return None, f"the token has no access to it ({r.status_code})"
    if r.status_code >= 400:
        return None, f"DigitalOcean returned {r.status_code}"
    try:
        return r.json(), None
    except ValueError:
        return None, "the response was not JSON"


def _paged(token: str, path: str, *names: str) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    rows: List[Dict[str, Any]] = []
    page = 1
    while page <= MAX_PAGES:
        payload, skipped = _get(token, path, {"per_page": 200, "page": page})
        if skipped:
            return rows, skipped
        rows.extend(_first_list(payload or {}, *names))
        if not (((payload or {}).get("links") or {}).get("pages") or {}).get("next"):
            break
        page += 1
    return rows, None


# --------------------------------------------------------------------------- #
# Mapping — each access-bearing object becomes one population record.         #
# --------------------------------------------------------------------------- #
def _record(external_id: str, email: str, display_name: str, designation: str,
            entitlements: List[str], *, is_person: bool = False,
            account_enabled: bool = True) -> Dict[str, Any]:
    return {"external_id": external_id, "email": email, "display_name": display_name,
            "department": DEPARTMENT, "designation": designation,
            "account_enabled": account_enabled, "terminated": False,
            "entitlements": [_entitlement(e) for e in entitlements], "is_person": is_person}


def account_slug(account: Dict[str, Any]) -> str:
    """Names the estate the credentials belong to, so two teams' keys can't
    collide on the same synthesised address."""
    team = (account.get("team") or {}).get("name")
    return _slug(team) if team else str(account.get("uuid") or "do")[:8]


def map_account(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The person the token belongs to — the one real human the API names."""
    email = (raw.get("email") or "").strip().lower()
    uuid = str(raw.get("uuid") or "").strip()
    if not email or not uuid:
        return None
    team = (raw.get("team") or {}).get("name") or "DigitalOcean"
    return _record(f"do:account:{uuid}", email, f"{raw.get('name') or email} (DigitalOcean)",
                   "Cloud account owner", [f"DigitalOcean: team {team}"],
                   is_person=True, account_enabled=(raw.get("status") or "active") == "active")


def map_ssh_key(raw: Dict[str, Any], *, acct: str) -> Optional[Dict[str, Any]]:
    """An SSH key opens every droplet built with it — a standing root grant."""
    key_id = str(raw.get("id") or raw.get("fingerprint") or "").strip()
    if not key_id:
        return None
    name = raw.get("name") or key_id
    return _record(f"do:sshkey:{key_id}", f"{_slug(name)}-{_slug(key_id)}@ssh.{acct}.do",
                   f"{name} (DigitalOcean SSH key)",
                   f"SSH key {raw.get('fingerprint') or ''}".strip(),
                   ["DigitalOcean: SSH root access to droplets"])


def map_spaces_key(raw: Dict[str, Any], *, acct: str, now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    access_key = str(raw.get("access_key") or "").strip()
    if not access_key:
        return None
    name = raw.get("name") or access_key
    grants = [g for g in (raw.get("grants") or []) if isinstance(g, dict)]
    unscoped = not grants or any(
        not g.get("bucket") or (g.get("permission") or "").lower() == "fullaccess" for g in grants)
    if unscoped:
        entitlements = ["DigitalOcean: Spaces full access (all buckets)"]
    else:
        entitlements = [f"DigitalOcean: Spaces {g.get('permission') or 'access'} on {g.get('bucket')}"
                        for g in grants]
    if _older_than(raw.get("created_at"), now=now):
        entitlements.append(OLD_KEY_ENTITLEMENT)
    return _record(f"do:spaceskey:{access_key}",
                   f"{_slug(name)}-{_slug(access_key[:8])}@spaces.{acct}.do",
                   f"{name} (DigitalOcean Spaces key)", "Spaces access key", entitlements)


def map_database_user(raw: Dict[str, Any], *, cluster: Dict[str, Any], acct: str) -> Optional[Dict[str, Any]]:
    name = (raw.get("name") or "").strip()
    cluster_id = str(cluster.get("id") or "").strip()
    if not name or not cluster_id:
        return None
    cluster_name = cluster.get("name") or cluster_id
    role = (raw.get("role") or "normal").strip()
    # "primary" is DigitalOcean's admin role; say so, so the privileged-role
    # heuristic (admin/owner/root) recognises it.
    label = "admin (primary)" if role == "primary" else role
    return _record(f"do:dbuser:{cluster_id}:{name}",
                   f"{_slug(name)}@{_slug(cluster_name)}.db.{acct}.do",
                   f"{name} ({cluster_name} database)", "Managed database user",
                   [f"DigitalOcean: database {label} on {cluster_name}"])


def map_api_token(raw: Dict[str, Any], *, acct: str, now: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
    token_id = str(raw.get("id") or raw.get("uuid") or "").strip()
    if not token_id:
        return None
    name = raw.get("name") or token_id
    scopes = raw.get("scopes") or raw.get("scope") or []
    if isinstance(scopes, str):
        scopes = [scopes]
    # A scope is read-only when it says so ("droplet:read"); everything else —
    # create, update, delete, a bare "*", or no scopes at all — can change things.
    writes = not scopes or any(not str(s).strip().lower().endswith(":read") for s in scopes)
    entitlements = [f"DigitalOcean: API token {'read-write (account admin)' if writes else 'read-only'}"]
    entitlements += [f"DigitalOcean: API scope {s}" for s in scopes]
    if _older_than(raw.get("created_at"), now=now):
        entitlements.append(OLD_KEY_ENTITLEMENT)
    return _record(f"do:token:{token_id}", f"{_slug(name)}-{_slug(token_id)}@token.{acct}.do",
                   f"{name} (DigitalOcean API token)", "API token", entitlements)


# --------------------------------------------------------------------------- #
# Collect + sync                                                              #
# --------------------------------------------------------------------------- #
def collect(token: str) -> Dict[str, Any]:
    """Every access-bearing object the token can see, as population records."""
    records: List[Dict[str, Any]] = []
    read: Dict[str, Any] = {}
    skipped: List[Dict[str, str]] = []

    def note(resource: str, reason: Optional[str], count: int = 0) -> bool:
        if reason:
            skipped.append({"resource": resource, "reason": reason})
            return False
        read[resource] = count
        return True

    payload, reason = _get(token, "/account")
    if reason:
        # The account call is the token test: if it fails, nothing else works.
        raise ValueError(f"DigitalOcean rejected the token — {reason}")
    account = (payload or {}).get("account") or {}
    acct = account_slug(account)
    mapped = map_account(account)
    note("account", None, 1 if mapped else 0)
    if mapped:
        records.append(mapped)

    keys, reason = _paged(token, "/account/keys", "ssh_keys")
    if note("ssh_keys", reason, len(keys)):
        records.extend([r for r in (map_ssh_key(k, acct=acct) for k in keys) if r])

    spaces, reason = _paged(token, "/spaces/keys", "keys", "spaces_keys")
    if note("spaces_keys", reason, len(spaces)):
        records.extend([r for r in (map_spaces_key(k, acct=acct) for k in spaces) if r])

    clusters, reason = _paged(token, "/databases", "databases")
    if note("databases", reason, len(clusters)):
        db_users = 0
        for cluster in clusters[:MAX_CLUSTERS]:
            users, user_reason = _paged(token, f"/databases/{cluster.get('id')}/users", "users")
            if user_reason:
                skipped.append({"resource": f"database users ({cluster.get('name')})",
                                "reason": user_reason})
                continue
            for u in users:
                rec = map_database_user(u, cluster=cluster, acct=acct)
                if rec:
                    records.append(rec)
                    db_users += 1
        read["database_users"] = db_users

    # Listing API tokens is not in DigitalOcean's published reference; ask for
    # it, and move on quietly when the token may not.
    tokens, reason = _paged(token, "/tokens", "tokens")
    if note("api_tokens", reason, len(tokens)):
        records.extend([r for r in (map_api_token(t, acct=acct) for t in tokens) if r])

    # Context only. Teams give a member COUNT and no members, so a per-member
    # row would be invented — the review says so instead of guessing.
    projects, reason = _paged(token, "/projects", "projects")
    note("projects", reason, len(projects))
    teams, reason = _paged(token, "/organizations/teams", "teams")
    note("teams", reason, len(teams))

    return {
        "records": records, "read": read, "skipped": skipped,
        "team": (account.get("team") or {}).get("name"),
        "account_email": account.get("email"),
        "scope_note": ("DigitalOcean publishes no team-member endpoint, so people with console "
                       "logins are outside this review; it covers keys, tokens, database users "
                       "and the account the token belongs to."),
    }


def token_for_tenant(tenant_db: Session, tenant_id: int) -> Optional[str]:
    """A token DigitalOcean is already connected with — the evidence collector
    first, then asset discovery — so a re-sync needs nobody to paste it again."""
    from ...models import IntegrationConnection
    from ..compliance_plugins.services.credentials import resolve_credentials_for_connection

    for integration_type in ("digitalocean", "digitalocean_api"):
        conn = (
            tenant_db.query(IntegrationConnection)
            .filter(IntegrationConnection.tenant_id == tenant_id,
                    IntegrationConnection.integration_type == integration_type)
            .order_by(desc(IntegrationConnection.id))
            .first()
        )
        if conn is None:
            continue
        try:
            creds = resolve_credentials_for_connection(conn) or {}
        except Exception:  # noqa: BLE001 — a broken row must not hide a working one
            continue
        token = (creds.get("token") or creds.get("do_api_token") or "").strip()
        if token:
            return token
    return None


def remember_token(tenant_db: Session, tenant_id: int, token: str, user_id: Optional[int] = None) -> None:
    """Keep the token the way the DigitalOcean evidence collector keeps it —
    encrypted, one connection per tenant — so a review can refresh itself and
    both features share the one credential. Connecting here is connecting
    DigitalOcean, not a second copy of it."""
    from ...crypto import encrypt_secret
    from ...models import IntegrationConnection

    conn = (
        tenant_db.query(IntegrationConnection)
        .filter(IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.integration_type == "digitalocean")
        .order_by(desc(IntegrationConnection.id))
        .first()
    )
    extra = {**(getattr(conn, "credentials_extra_json", None) or {}), "token": encrypt_secret(token)}
    if conn is not None:
        conn.credentials_extra_json = extra
        conn.is_active = True
        conn.status = "connected"
        return
    tenant_db.add(IntegrationConnection(
        tenant_id=tenant_id, integration_type="digitalocean", category="evidence_collector",
        connection_name="DigitalOcean", console_url=API, auth_method="apikey",
        credentials_extra_json=extra, is_active=True, status="connected",
        created_by_user_id=user_id,
    ))


def sync_digitalocean_population(tenant_db: Session, *, tenant_id: int,
                                 token: Optional[str] = None, remember: bool = True,
                                 user_id: Optional[int] = None) -> Dict[str, Any]:
    """Pull DigitalOcean's access-bearing objects into the review population.
    An explicit token wins; otherwise the stored connection's is used."""
    supplied = (token or "").strip()
    resolved = supplied or token_for_tenant(tenant_db, tenant_id)
    if not resolved:
        raise ValueError("No DigitalOcean token. Paste a read-only token to connect DigitalOcean, "
                         "or connect it under Administration → Evidence Collectors.")
    collected = collect(resolved)          # a bad token fails here, before anything is kept
    if supplied and remember:
        remember_token(tenant_db, tenant_id, supplied, user_id)
    result = ingest(tenant_db, tenant_id=tenant_id, records=collected["records"],
                    map_fn=lambda record: record, provider_tag=PROVIDER_DO)
    return {**result, "source": "request" if supplied else "stored",
            "token_saved": bool(supplied and remember),
            "read": collected["read"], "skipped": collected["skipped"],
            "team": collected["team"], "account_email": collected["account_email"],
            "scope_note": collected["scope_note"]}
