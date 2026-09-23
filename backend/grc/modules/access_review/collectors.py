"""Every connected SaaS tool as an access-review source.

The platform already holds a connection for 66 providers (Administration →
Evidence Collectors) and already knows how to call each one: the base URL and
auth live in ``live_api_catalog.PROVIDER_API`` and each provider's resources —
path, where the list sits, how it pages, which fields to keep — are declared in
``connector_checks.json``. All this module adds is which resource holds the
people and what their fields mean, so "who has access to GitHub, Slack, Jira,
Zoom…" needs a table entry rather than a connector.

Credentials are the ones already stored, encrypted, for that provider. Nothing
new is kept here, and every call is a read.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import desc
from sqlalchemy.orm import Session

from ._ingest import ROLE_NAME_MAX, ingest


@dataclass(frozen=True)
class People:
    """Which resource lists the people, and what its fields mean.

    `resource` names a resource the provider already declares; `inline` gives
    one when the provider declares none that lists everybody.
    """
    resource: str
    label: str
    email: str = "email"
    name: Optional[str] = "name"
    external_id: Optional[str] = None            # defaults to the email
    disabled_if: Tuple[str, ...] = ()            # truthy → the account is off
    enabled_if: Tuple[str, ...] = ()             # truthy → the account is on
    skip_if: Tuple[str, ...] = ()                # truthy → not a person (bots)
    role_fields: Tuple[str, ...] = ()            # value becomes an entitlement
    flags: Dict[str, str] = field(default_factory=dict)   # field → entitlement when truthy
    inline: Optional[Dict[str, Any]] = None      # a resource definition of our own
    parents: Tuple[str, ...] = ()                # resources to collect first (for_each)


#: provider key → where its people are. Everything here is already connectable
#: under Administration → Evidence Collectors.
PEOPLE: Dict[str, People] = {
    "slack": People("users", "Slack", name="real_name", external_id="name",
                    disabled_if=("deleted",), skip_if=("is_bot",),
                    flags={"is_owner": "Slack: workspace owner", "is_admin": "Slack: workspace admin",
                           "is_restricted": "Slack: guest"}),
    "google_workspace": People("users", "Google Workspace", name="email",
                               disabled_if=("suspended",),
                               flags={"admin": "Google Workspace: super admin"}),
    "microsoft_365": People("users", "Microsoft 365", email="upn", name="name",
                            enabled_if=("enabled",)),
    "okta": People("active_users", "Okta", email="login", name="login", external_id="id"),
    "jumpcloud": People("systemusers", "JumpCloud", name="username",
                        disabled_if=("suspended", "account_locked")),
    "onelogin": People("users", "OneLogin", name="username", external_id="id",
                       role_fields=("status",)),
    "jira": People("users", "Jira", name="displayName", external_id="accountId",
                   enabled_if=("active",), skip_if=("accountType",),
                   role_fields=()),
    "confluence": People("group_members", "Confluence", email="account", name="display"),
    "github": People("members", "GitHub", email="login", name="login",
                     inline={"name": "members", "path": "/orgs/{org}/members",
                             "method": "GET",
                             "for_each": {"resource": "orgs", "vars": {"org": "login"},
                                          "label_field": "login"},
                             "paginate": {"style": "page", "param": "page",
                                          "size_param": "per_page", "size": 100},
                             "fields": {"login": "login", "id": "id"}},
                     parents=("orgs",), flags={}),
    "gitlab": People("members", "GitLab", email="username", name="name",
                     inline={"name": "members", "path": "/groups/{group}/members/all",
                             "method": "GET",
                             "for_each": {"resource": "groups", "vars": {"group": "id"},
                                          "label_field": "full_path"},
                             "paginate": {"style": "page", "param": "page",
                                          "size_param": "per_page", "size": 100},
                             "fields": {"username": "username", "name": "name",
                                        "access_level": "access_level", "state": "state"}},
                     parents=("groups",), role_fields=("access_level",)),
    "zoom": People("user", "Zoom", role_fields=("type",), enabled_if=("status",)),
    "monday": People("users", "monday.com", role_fields=("kind",)),
    "linear": People("users", "Linear", enabled_if=("active",),
                     flags={"admin": "Linear: admin", "guest": "Linear: guest"}),
    "notion": People("users", "Notion", skip_if=("is_bot",)),
    "hubspot": People("users", "HubSpot", flags={"superAdmin": "HubSpot: super admin"}),
    "intercom": People("admins", "Intercom", external_id="admin_id",
                       flags={"has_inbox_seat": "Intercom: inbox seat"}),
    "sentry": People("members", "Sentry", role_fields=("role",),
                     flags={"pending": "Sentry: invitation pending"}),
    "grafana": People("org_users", "Grafana", name="login", role_fields=("role",)),
    "posthog": People("members", "PostHog", email="user_email", name="user_name",
                      role_fields=("level",)),
    "opsgenie": People("users", "Opsgenie", email="username", name="username",
                       role_fields=("role",), disabled_if=("blocked",)),
    "openai": People("org_users", "OpenAI", external_id="id", role_fields=("role",)),
    "cloudflare": People("members", "Cloudflare", role_fields=("status",), parents=("accounts",)),
    "netlify": People("members", "Netlify", name="full_name", role_fields=("role",), parents=("accounts",)),
    "vercel": People("team_members", "Vercel", name="username", role_fields=("role",)),
    "heroku": People("team_members", "Heroku", external_id="id", role_fields=("role",)),
    "qovery": People("member", "Qovery", external_id="id", role_fields=("role_name",)),
    "dropbox": People("members", "Dropbox", external_id="tmid"),
    "databricks": People("users", "Databricks", email="user", name="user", enabled_if=("active",)),
    "clerk": People("users", "Clerk", email="id", name="id", external_id="id",
                    disabled_if=("banned", "locked")),
    "sentinelone": People("users", "SentinelOne"),
    "tenable": People("users", "Tenable", email="username", name="username",
                      enabled_if=("enabled",), role_fields=("permissions",)),
    "calendly": People("members", "Calendly", role_fields=("role",)),
    "servicenow": People("admin_roles", "ServiceNow", email="user", name="user",
                         role_fields=("role",)),
}


def _truthy(row: Dict[str, Any], keys: Tuple[str, ...]) -> bool:
    for key in keys:
        value = row.get(key)
        if isinstance(value, str):
            if value.strip().lower() in ("true", "yes", "1", "active", "enabled"):
                return True
        elif value:
            return True
    return False


def map_person(row: Dict[str, Any], spec: People, provider: str) -> Optional[Dict[str, Any]]:
    """One collected row → a population record."""
    email = str(row.get(spec.email) or "").strip().lower()
    if not email or _truthy(row, spec.skip_if):
        return None
    if "@" not in email:                      # a handle, not an address: keep it addressable
        email = f"{email}@{provider}.account"
    name = str(row.get(spec.name) or "").strip() if spec.name else ""
    enabled = True
    if spec.enabled_if:
        enabled = _truthy(row, spec.enabled_if)
    if spec.disabled_if and _truthy(row, spec.disabled_if):
        enabled = False

    entitlements = [f"{spec.label}: {str(row[f]).strip()}"[:ROLE_NAME_MAX]
                    for f in spec.role_fields if row.get(f) not in (None, "", [])]
    entitlements += [text[:ROLE_NAME_MAX] for flag, text in spec.flags.items() if _truthy(row, (flag,))]
    if not entitlements:
        entitlements = [f"{spec.label}: member"]
    return {
        "external_id": f"{provider}:{row.get(spec.external_id) or email}",
        "email": email, "display_name": name or email,
        "department": None, "designation": f"{spec.label} account",
        "account_enabled": enabled, "terminated": False,
        "entitlements": entitlements, "is_person": True,
    }


def available(tenant_db: Session, tenant_id: int) -> List[Dict[str, Any]]:
    """Every provider that can feed a review, and whether it is connected."""
    from ...models import IntegrationConnection
    from ..compliance_plugins.runners.live_api_catalog import PROVIDER_API

    connected = {
        row[0] for row in tenant_db.query(IntegrationConnection.integration_type)
        .filter(IntegrationConnection.tenant_id == tenant_id).distinct().all()
    }
    out = []
    for provider, spec in PEOPLE.items():
        meta = PROVIDER_API.get(provider) or {}
        out.append({
            "key": provider, "label": meta.get("label") or spec.label,
            "category": meta.get("category") or "saas",
            "connected": provider in connected,
            "reads": spec.label,
        })
    return sorted(out, key=lambda p: (not p["connected"], p["label"]))


def _authenticate(provider: str, creds: Dict[str, Any]) -> Tuple[str, Dict[str, Any], Dict[str, Any]]:
    """(base URL, creds ready to call with, provider spec). Mirrors the
    collector's own preamble — domain substitution and token exchange."""
    import re

    from ..compliance_plugins.runners.live_api_catalog import PROVIDER_API, _exchange_token

    spec = PROVIDER_API.get(provider)
    if not spec:
        raise ValueError(f"No API client for '{provider}'")
    if spec.get("transport"):
        raise ValueError(f"{spec.get('label', provider)} is collected over a cloud SDK, not its REST API")
    if not (creds.get("token") or creds.get("access_token")):
        raise ValueError(f"{spec.get('label', provider)} has no token stored — connect it first")
    domain = re.sub(r"^https?://", "", (creds.get("domain") or spec.get("domain_default") or "").strip()).rstrip("/")
    creds = {**creds, "domain": domain}
    if spec.get("token_exchange"):
        access, _status, reason = _exchange_token(spec["token_exchange"], creds)
        if not access:
            raise ValueError(reason or "the provider refused the stored credential")
        creds = {**creds, "token": access}
    return spec["base"].replace("{domain}", domain), creds, spec


def collect_people(provider: str, creds: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """The provider's people, as population records."""
    from ..compliance_plugins.runners.evidence_engine import _collect_resource
    from ..compliance_plugins.runners.live_api_catalog import CONNECTOR_CHECKS

    spec_people = PEOPLE.get(provider)
    if not spec_people:
        raise ValueError(f"'{provider}' has no people to review")
    base, creds, spec = _authenticate(provider, creds)

    declared = {r.get("name"): r for r in ((CONNECTOR_CHECKS.get(provider) or {}).get("resources") or [])}
    collected: Dict[str, List[dict]] = {}
    for parent in spec_people.parents:                 # for_each resources need their list first
        if parent in declared:
            collected[parent], _ = _collect_resource(spec, creds, base, declared[parent], collected)
    resource = spec_people.inline or declared.get(spec_people.resource)
    if not resource:
        raise ValueError(f"{spec.get('label', provider)} declares no '{spec_people.resource}' resource")
    rows, note = _collect_resource(spec, creds, base, resource, collected)
    records = [r for r in (map_person(row, spec_people, provider) for row in rows) if r]
    return records, note


def sync_collector_population(tenant_db: Session, *, tenant_id: int, provider: str) -> Dict[str, Any]:
    """Pull a connected provider's people into the review population, using the
    credential it is already connected with."""
    from ...models import IntegrationConnection
    from ..compliance_plugins.services.credentials import resolve_credentials_for_connection

    conn = (
        tenant_db.query(IntegrationConnection)
        .filter(IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.integration_type == provider)
        .order_by(desc(IntegrationConnection.id))
        .first()
    )
    if conn is None:
        raise ValueError(f"'{provider}' is not connected. Connect it under Administration → "
                         "Evidence Collectors, then sync it here.")
    creds = resolve_credentials_for_connection(conn) or {}
    records, note = collect_people(provider, creds)
    result = ingest(tenant_db, tenant_id=tenant_id, records=records,
                    map_fn=lambda record: record, provider_tag=provider[:16])
    return {**result, "provider": provider, "partial": note}
