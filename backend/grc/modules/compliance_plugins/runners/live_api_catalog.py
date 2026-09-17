"""Live SaaS API evidence catalog + engine (ported from the grc-s connector set).

Read-only: every call hits the provider's own API with the tenant's stored
credential and maps the response to SOC 2 findings. A successful authenticated
call is recorded as collection health; the declarative checks in
connector_checks.json (run by evidence_engine) are the control evidence.

This is pure data + stdlib (urllib) — no new dependency, no framework coupling.
The thin `@register("live_api")` wrapper lives in live_api_runner.py.

Findings are plain dicts: {control_codes, check, resource, status, detail}
with status in {"pass","fail","error"}.
"""
from __future__ import annotations

import base64
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# provider -> API spec. base ({domain} filled from creds, or domain_default when the
# provider has one well-known host), verify path (proves authenticated
# connectivity), auth scheme, SOC2 control codes, optional method/body (GraphQL),
# static headers, header_templates built from stored values, and token_exchange for
# providers whose access tokens expire within hours (see _exchange_token).
PROVIDER_API: Dict[str, dict] = {
    # source control / change management
    "github": {"base": "https://api.github.com", "verify": "/user", "auth": "bearer", "controls": ["CC6.1", "CC8.1"], "label": "GitHub", "category": "scm"},
    "gitlab": {"base": "https://{domain}/api/v4", "domain_default": "gitlab.com", "verify": "/user", "auth": "header:PRIVATE-TOKEN", "controls": ["CC6.1", "CC8.1"], "label": "GitLab", "category": "scm"},
    "bitbucket": {"base": "https://api.bitbucket.org/2.0", "verify": "/user", "auth": "bearer", "controls": ["CC6.1", "CC8.1"], "label": "Bitbucket", "category": "scm"},
    # identity / access
    "okta": {"base": "https://{domain}/api/v1", "verify": "/users?limit=1", "auth": "ssws", "controls": ["CC6.1", "CC6.2"], "label": "Okta", "category": "identity", "needs_domain": True},
    "google_workspace": {"base": "https://admin.googleapis.com", "verify": "/admin/directory/v1/users?customer=my_customer&maxResults=1", "auth": "bearer", "controls": ["CC6.1"], "label": "Google Workspace", "category": "identity",
                         "token_exchange": {"url": "https://oauth2.googleapis.com/token", "form": {"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer"},
                                            "google_service_account": {"subject": "{email}", "scopes": ["https://www.googleapis.com/auth/admin.directory.user.readonly", "https://www.googleapis.com/auth/admin.directory.domain.readonly"]}}},
    "microsoft_365": {"base": "https://graph.microsoft.com/v1.0", "verify": "/users?$top=1", "auth": "bearer", "controls": ["CC6.1"], "label": "Microsoft Entra ID (Microsoft 365)", "category": "identity", "needs_domain": True,
                      "token_exchange": {"url": "https://login.microsoftonline.com/{domain}/oauth2/v2.0/token", "form": {"grant_type": "client_credentials", "client_id": "{access_key_id}", "client_secret": "{token}", "scope": "https://graph.microsoft.com/.default"}}},
    "clerk": {"base": "https://api.clerk.com/v1", "verify": "/users?limit=1", "auth": "bearer", "controls": ["CC6.1", "CC6.2"], "label": "Clerk", "category": "identity"},
    "tailscale": {"base": "https://api.tailscale.com/api/v2", "verify": "/tailnet/-/devices", "auth": "bearer", "controls": ["CC6.7"], "label": "Tailscale", "category": "identity"},
    "one_password": {"base": "https://{domain}", "verify": "/api/v2/auth/introspect", "auth": "bearer", "controls": ["CC6.1"], "label": "1Password", "category": "identity", "needs_domain": True},
    # cloud / infra
    "cloudflare": {"base": "https://api.cloudflare.com/client/v4", "verify": "/user/tokens/verify", "auth": "bearer", "controls": ["CC6.1"], "label": "Cloudflare", "category": "cloud"},
    "vercel": {"base": "https://api.vercel.com", "verify": "/v2/user", "auth": "bearer", "controls": ["CC6.1"], "label": "Vercel", "category": "cloud"},
    "netlify": {"base": "https://api.netlify.com/api/v1", "verify": "/user", "auth": "bearer", "controls": ["CC6.1"], "label": "Netlify", "category": "cloud"},
    "heroku": {"base": "https://api.heroku.com", "verify": "/account", "auth": "bearer", "controls": ["CC6.1"], "label": "Heroku", "category": "cloud", "headers": {"Accept": "application/vnd.heroku+json; version=3"}},
    "render": {"base": "https://api.render.com/v1", "verify": "/owners", "auth": "bearer", "controls": ["CC6.1"], "label": "Render", "category": "cloud"},
    "supabase": {"base": "https://api.supabase.com/v1", "verify": "/projects", "auth": "bearer", "controls": ["CC6.1"], "label": "Supabase", "category": "cloud"},
    "neon": {"base": "https://console.neon.tech/api/v2", "verify": "/users/me/organizations", "auth": "bearer", "controls": ["CC6.1"], "label": "Neon", "category": "cloud"},
    # Qovery API tokens are sent as "Token <token>"; Bearer is only for console logins
    "qovery": {"base": "https://api.qovery.com", "verify": "/organization", "auth": "none", "header_templates": {"Authorization": "Token {token}"}, "controls": ["CC6.1"], "label": "Qovery", "category": "cloud"},
    "digitalocean": {"base": "https://api.digitalocean.com/v2", "verify": "/account", "auth": "bearer", "controls": ["CC6.1"], "label": "DigitalOcean", "category": "cloud"},
    # Cloud accounts do not authenticate with a static bearer, so they name a
    # transport instead of a base/verify path. Everything downstream — the admin
    # catalog, seeding, collection health, the control crosswalk — is unchanged.
    "aws": {"transport": "aws", "auth": "aws_keys", "controls": ["CC6.1"], "label": "Amazon Web Services", "category": "cloud", "needs_key_id": True, "needs_region": True},
    # observability / monitoring
    # Datadog's read endpoints need an application key alongside the API key; the
    # verify call needs both, so a key pair that cannot read monitors never "passes".
    "datadog": {"base": "https://{domain}/api/v1", "domain_default": "api.datadoghq.com", "verify": "/monitor?page=0&page_size=1", "auth": "none", "header_templates": {"DD-API-KEY": "{token}", "DD-APPLICATION-KEY": "{secret2}"}, "controls": ["CC7.2"], "label": "Datadog", "category": "observability"},
    "sentry": {"base": "https://{domain}/api/0", "domain_default": "sentry.io", "verify": "/organizations/", "auth": "bearer", "controls": ["CC7.2"], "label": "Sentry", "category": "observability"},
    "grafana": {"base": "https://{domain}", "domain_path": True, "verify": "/api/user", "auth": "bearer", "controls": ["CC7.2"], "label": "Grafana", "category": "observability", "needs_domain": True},
    # /api/v1/version answers without a key; this call proves the key itself works
    "signoz": {"base": "https://{domain}", "domain_path": True, "verify": "/api/v1/service_accounts/me", "auth": "header:SIGNOZ-API-KEY", "controls": ["CC7.2"], "label": "SigNoz", "category": "observability", "needs_domain": True},
    "posthog": {"base": "https://{domain}", "domain_default": "us.posthog.com", "verify": "/api/users/@me/", "auth": "bearer", "controls": ["CC7.2"], "label": "PostHog", "category": "observability"},
    "better_stack": {"base": "https://uptime.betterstack.com", "verify": "/api/v2/monitors", "auth": "bearer", "controls": ["CC7.4"], "label": "Better Stack", "category": "observability"},
    # incident
    "pagerduty": {"base": "https://api.pagerduty.com", "verify": "/users?limit=1", "auth": "pdtoken", "controls": ["CC7.4"], "label": "PagerDuty", "category": "incident", "headers": {"Accept": "application/vnd.pagerduty+json;version=2"}},
    # productivity / work management
    "notion": {"base": "https://api.notion.com/v1", "verify": "/users", "auth": "bearer", "controls": ["CC6.3"], "label": "Notion", "category": "productivity", "headers": {"Notion-Version": "2022-06-28"}},
    "linear": {"base": "https://api.linear.app", "verify": "/graphql", "auth": "raw", "controls": ["CC6.3"], "label": "Linear", "category": "productivity", "method": "POST", "body": {"query": "{ viewer { id email } }"}},
    "asana": {"base": "https://app.asana.com/api/1.0", "verify": "/users/me", "auth": "bearer", "controls": ["CC6.3"], "label": "Asana", "category": "productivity"},
    "jira": {"base": "https://{domain}/rest/api/3", "verify": "/myself", "auth": "basic", "controls": ["CC6.3"], "label": "Jira", "category": "productivity", "needs_domain": True, "needs_email": True},
    "clickup": {"base": "https://api.clickup.com/api/v2", "verify": "/user", "auth": "raw", "controls": ["CC6.3"], "label": "ClickUp", "category": "productivity"},
    # pinned: the user fields read here change meaning in later API versions
    "monday": {"base": "https://api.monday.com", "verify": "/v2", "auth": "raw", "controls": ["CC6.3"], "label": "Monday", "category": "productivity", "method": "POST", "body": {"query": "{ me { id } }"}, "headers": {"API-Version": "2026-07"}},
    # comms / support
    # Slack answers HTTP 200 with ok:false for a bad token, so the body decides
    "slack": {"base": "https://slack.com/api", "verify": "/auth.test", "verify_ok_field": "ok", "auth": "bearer", "controls": ["CC6.1"], "label": "Slack", "category": "comms"},
    "zendesk": {"base": "https://{domain}/api/v2", "verify": "/users/me.json", "auth": "bearer", "controls": ["CC6.2"], "label": "Zendesk", "category": "comms", "needs_domain": True,
                "token_exchange": {"url": "https://{domain}/oauth/tokens", "json": True, "form": {"grant_type": "client_credentials", "client_id": "{access_key_id}", "client_secret": "{token}", "scope": "users:read"}}},
    "intercom": {"base": "https://api.intercom.io", "verify": "/me", "auth": "bearer", "controls": ["CC6.2"], "label": "Intercom", "category": "comms"},
    # crm
    "hubspot": {"base": "https://api.hubapi.com", "verify": "/settings/v3/users?limit=1", "auth": "bearer", "controls": ["CC6.2"], "label": "HubSpot", "category": "crm"},
    # email
    "sendgrid": {"base": "https://{domain}/v3", "domain_default": "api.sendgrid.com", "verify": "/scopes", "auth": "bearer", "controls": ["CC6.1"], "label": "SendGrid", "category": "email"},
    "resend": {"base": "https://api.resend.com", "verify": "/domains", "auth": "bearer", "controls": ["CC6.7"], "label": "Resend", "category": "email"},
    # ai
    "openai": {"base": "https://api.openai.com/v1", "verify": "/organization/projects?limit=1", "auth": "bearer", "controls": ["CC6.1"], "label": "OpenAI", "category": "ai"},
    "anthropic": {"base": "https://api.anthropic.com/v1", "verify": "/organizations/me", "auth": "header:x-api-key", "controls": ["CC6.1"], "label": "Anthropic", "category": "ai", "headers": {"anthropic-version": "2023-06-01"}},
}

# Additional connectors supplied as data (git-reviewable JSON) and merged into
# PROVIDER_API so seeding, provider_meta, the runner, and the Evidence Collectors
# page all pick them up automatically. Same spec shape as the literal entries.
_EXTRA_CONNECTORS_PATH = Path(__file__).resolve().parents[3] / "seed_data" / "evidence" / "extra_connectors.json"
try:
    _extra = json.loads(_EXTRA_CONNECTORS_PATH.read_text(encoding="utf-8"))
    if isinstance(_extra, dict):
        for _k, _v in _extra.items():
            if isinstance(_v, dict) and _k not in PROVIDER_API and _v.get("base") and _v.get("verify"):
                PROVIDER_API[_k] = _v
except Exception:  # noqa: BLE001 — safe-empty if the file is absent/invalid
    pass

LIVE_API_PROVIDERS = set(PROVIDER_API.keys())

# Declarative deep-evidence catalog (resources + checks per connector), run by
# evidence_engine on top of the verify call. Git-reviewable data; safe-empty if
# the file is absent so the connectors still report connectivity.
_CONNECTOR_CHECKS_PATH = Path(__file__).resolve().parents[3] / "seed_data" / "evidence" / "connector_checks.json"


def _load_connector_checks() -> Dict[str, dict]:
    try:
        data = json.loads(_CONNECTOR_CHECKS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


CONNECTOR_CHECKS: Dict[str, dict] = _load_connector_checks()


def _finding(codes: List[str], check: str, resource: str, status: str, detail: str = "",
             population: Optional[int] = None, tested: Optional[int] = None,
             truncated: Optional[bool] = None) -> dict:
    """One assertion by one check.

    `population`/`tested`/`truncated` answer "how much did you actually look at",
    which is the question an assessor asks of any sampled result and which no
    finding could answer before. They are optional so the call sites that
    genuinely have no population — a connectivity probe, a single config object —
    stay silent rather than claim a made-up 1. Omitted keys are dropped, so the
    stored shape only grows for findings that can honestly fill them.
    """
    out = {"control_codes": list(codes), "check": check, "resource": resource,
           "status": status, "detail": detail}
    if population is not None:
        out["population_size"] = population
    if tested is not None:
        out["tested_size"] = tested
    if truncated is not None:
        out["truncated"] = bool(truncated)
    return out


def _auth_header(auth: str, token: str) -> dict:
    if auth == "bearer":
        return {"Authorization": f"Bearer {token}"}
    if auth == "ssws":
        return {"Authorization": f"SSWS {token}"}
    if auth == "raw":
        return {"Authorization": token}
    if auth == "pdtoken":
        return {"Authorization": f"Token token={token}"}
    if auth.startswith("header:"):
        return {auth.split(":", 1)[1]: token}
    return {}


_CRED_FIELD = re.compile(r"\{(token|secret2|email|domain|access_key_id|region)\}")


def _fill_creds(template: str, creds: dict) -> str:
    """Fill {token}/{email}/… placeholders, e.g. accessKey={access_key_id};secretKey={token}."""
    return _CRED_FIELD.sub(lambda m: str(creds.get(m.group(1)) or ""), template or "")


def _send(url: str, method: str, headers: dict, data: Optional[bytes], timeout: int = 15) -> Tuple[int, Any, dict]:
    """(status, parsed body, response headers); status 0 when the host could not be reached."""
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 — fixed provider hosts
            body = resp.read().decode("utf-8", "replace")
            try:
                return resp.status, json.loads(body), dict(resp.headers)
            except ValueError:
                return resp.status, body, dict(resp.headers)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8", "replace")), dict(e.headers or {})
        except Exception:  # noqa: BLE001
            return e.code, "", {}
    except Exception as e:  # noqa: BLE001
        return 0, str(e), {}


def _request(spec: dict, creds: dict, url: str, timeout: int = 15, with_headers: bool = False):
    """(status, body), or (status, body, headers) when a paginator reads a Link header."""
    token = creds.get("token") or creds.get("access_token") or ""
    headers = {"Accept": "application/json", "User-Agent": "grc-evidence-collector"}
    headers.update(spec.get("headers", {}))
    if spec.get("auth") == "basic":
        # Most basic-auth APIs take user:secret; some fix one half (Mailgun's user
        # is the literal "api", BambooHR's password is "x"), which the spec states.
        user = _fill_creds(spec.get("basic_user", "{email}"), {**creds, "token": token})
        password = _fill_creds(spec.get("basic_password", "{token}"), {**creds, "token": token})
        headers["Authorization"] = "Basic " + base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
    else:
        headers.update(_auth_header(spec.get("auth", ""), token))
    # Headers built from more than one stored value (Datadog's application key,
    # Tenable's accessKey/secretKey pair).
    for name, template in (spec.get("header_templates") or {}).items():
        value = _fill_creds(template, {**creds, "token": token})
        if value.strip():
            headers[name] = value

    data = None
    if spec.get("body") is not None:
        data = json.dumps(spec["body"]).encode("utf-8")
        headers["Content-Type"] = "application/json"
    status, body, response_headers = _send(url, spec.get("method", "GET"), headers, data, timeout)
    return (status, body, response_headers) if with_headers else (status, body)


# ── short-lived tokens ───────────────────────────────────────────────────────
def _google_assertion(tx: dict, creds: dict) -> str:
    """A service account's signed token request, acting as the admin in `subject`."""
    import jwt  # PyJWT (RS256 via cryptography), both already dependencies

    key = json.loads(creds.get("token") or "")
    cfg = tx["google_service_account"]
    now = int(time.time())
    claims = {"iss": key["client_email"], "scope": " ".join(cfg["scopes"]),
              # our fixed token URL, never the token_uri inside the pasted key file
              "aud": tx["url"], "iat": now, "exp": now + 3600}
    subject = _fill_creds(cfg.get("subject", ""), creds)
    if subject:
        claims["sub"] = subject
    return jwt.encode(claims, key["private_key"], algorithm="RS256", headers={"kid": key.get("private_key_id")})


def _exchange_token(tx: dict, creds: dict) -> Tuple[Optional[str], int, str]:
    """Trade the stored client credentials for an access token: (token, HTTP status, why not).

    Microsoft Graph, Auth0, Zoom, Jamf, OneLogin, Zendesk, Dropbox and Google hand
    out tokens that expire within hours, so a pasted token is dead before the next
    daily collection. The customer stores the long-lived client credentials and
    every run asks for a fresh token.
    """
    url = _fill_creds(tx["url"], creds)
    fields = {k: _fill_creds(v, creds) for k, v in (tx.get("form") or {}).items()}
    if tx.get("google_service_account"):
        try:
            fields["assertion"] = _google_assertion(tx, creds)
        except Exception:  # noqa: BLE001 — malformed JSON, missing keys, unreadable private key
            return None, 400, "The service account key is not a complete JSON key file"
    headers = {"Accept": "application/json", "User-Agent": "grc-evidence-collector"}
    headers.update({k: _fill_creds(v, creds) for k, v in (tx.get("headers") or {}).items()})
    if tx.get("basic"):
        headers["Authorization"] = "Basic " + base64.b64encode(_fill_creds(tx["basic"], creds).encode("utf-8")).decode("ascii")
    if tx.get("json"):
        data, headers["Content-Type"] = json.dumps(fields).encode("utf-8"), "application/json"
    else:
        data, headers["Content-Type"] = urllib.parse.urlencode(fields).encode("utf-8"), "application/x-www-form-urlencoded"

    status, body, _ = _send(url, "POST", headers, data)
    token = body.get(tx.get("token_field", "access_token")) if isinstance(body, dict) else None
    if status == 200 and isinstance(token, str) and token:
        return token, status, ""
    if status == 0:
        return None, 0, f"Could not reach the sign-in endpoint ({body})"
    why = ""
    if isinstance(body, dict):
        why = str(body.get("error_description") or body.get("reason") or body.get("message") or body.get("error") or "")
    return None, status, f"Sign-in with the stored client credentials was refused (HTTP {status})" + (f": {why[:300]}" if why else "")


def run_provider(provider: str, creds: dict) -> dict:
    """Authenticate + collect. Returns {findings, connectivity, summary, summary_text}.
    connectivity in {"pass","fail","error"}. Read-only."""
    spec = PROVIDER_API.get(provider)
    if not spec:
        return {"connectivity": "error", "findings": [], "summary": {}, "summary_text": f"No live client for '{provider}'"}

    if spec.get("transport"):
        from .cloud_transport import run_cloud_provider
        return run_cloud_provider(provider, spec, creds)

    token = creds.get("token") or creds.get("access_token")
    if not token:
        return {"connectivity": "error", "findings": [], "summary": {}, "summary_text": "No API token configured for this collector"}

    exchange = spec.get("token_exchange")
    # a regional host with a well-known default (Datadog's site, GitLab.com) may be left blank
    domain = re.sub(r"^https?://", "", (creds.get("domain") or spec.get("domain_default") or "").strip()).rstrip("/")
    if not domain and "{domain}" in spec["base"] + json.dumps(exchange or {}):
        return {"connectivity": "error", "findings": [], "summary": {}, "summary_text": "Missing 'domain' for this provider"}
    creds = {**creds, "domain": domain}
    base = spec["base"].replace("{domain}", domain)

    reason, body = "", None
    if exchange:
        access, status, reason = _exchange_token(exchange, creds)
        creds = {**creds, "token": access or ""}
    if not reason:
        status, body = _request(spec, creds, base + spec["verify"])
        ok_field = spec.get("verify_ok_field")
        if status == 200 and ok_field and not (isinstance(body, dict) and body.get(ok_field)):
            status = 401
            reason = f"{spec['label']} refused the token: {body.get('error') if isinstance(body, dict) else body}"

    findings: List[dict] = []
    if status == 200:
        conn = "pass"
        # Collection health, not control evidence. A working token proves the
        # collector can see the tenant; it says nothing about whether any control
        # operates, so it must not contribute a "pass" to the controls this
        # connector is indexed under.
        findings.append(_finding(spec["controls"], f"{provider}.connectivity", provider, "info",
                                 "Authenticated read-only API call succeeded"))
        cdef = CONNECTOR_CHECKS.get(provider)
        if cdef and (cdef.get("resources") or cdef.get("checks")):
            from .evidence_engine import run_connector_checks
            findings += run_connector_checks(provider, spec, creds, base, cdef)
    elif (reason and status) or status in (401, 403):
        conn = "fail"
        findings.append(_finding(spec["controls"], f"{provider}.connectivity", provider, "fail",
                                 reason or f"Provider rejected credentials (HTTP {status}) — check the token/scopes"))
    else:
        conn = "error"
        findings.append(_finding(spec["controls"], f"{provider}.connectivity", provider, "error",
                                 reason or f"Unexpected response from provider (HTTP {status})"))

    summary = {"total": len(findings), "pass": 0, "fail": 0, "error": 0}
    touched = set()
    for f in findings:
        summary[f["status"]] = summary.get(f["status"], 0) + 1
        touched.update(f["control_codes"])
    summary["controls_touched"] = sorted(touched)
    return {
        "connectivity": conn,
        "findings": findings,
        "summary": summary,
        "summary_text": (
            f"{provider}: {summary['pass']} pass / {summary['fail']} fail / "
            f"{summary.get('info', 0)} inventory / {summary['error']} error "
            f"across {len(summary['controls_touched'])} controls"
        ),
    }


def provider_meta() -> List[dict]:
    """Catalog for the Evidence Collectors admin page."""
    out = []
    for p, s in sorted(PROVIDER_API.items(), key=lambda kv: (kv[1]["category"], kv[0])):
        out.append({
            "provider": p, "label": s["label"], "category": s["category"],
            "controls": s["controls"], "auth": s["auth"],
            "needs_domain": bool(s.get("needs_domain")), "needs_email": bool(s.get("needs_email")),
            # a cloud account needs a key id and a region alongside the secret
            "transport": s.get("transport"),
            "needs_key_id": bool(s.get("needs_key_id")), "needs_region": bool(s.get("needs_region")),
        })
    return out


def provider_checks(provider: str) -> List[dict]:
    """Every individual check this provider runs, as {id, controls}.

    The binder needs to know which SOC 2 codes each check names, so that a
    control inherits only the checks that speak to it. HTTP connectors declare
    that in CONNECTOR_CHECKS; a cloud transport declares it in CLOUD_CHECKS.
    One accessor so a new transport is bound by the same code that binds the
    other 65, rather than needing its own branch in every caller.
    """
    if PROVIDER_API.get(provider, {}).get("transport"):
        from .cloud_transport import CLOUD_CHECKS, SWEEP_CHECKS
        # sweeps emit findings under their own check ids, so they are indexed
        # like any declared check rather than folded into one catch-all entry
        return [{"id": c["id"], "controls": list(c.get("controls") or [])}
                for c in CLOUD_CHECKS.get(provider, []) + SWEEP_CHECKS.get(provider, [])]
    return list((CONNECTOR_CHECKS.get(provider) or {}).get("checks") or [])


def all_control_codes(provider: str) -> List[str]:
    """Union of every SOC 2 code this provider can emit (verify + declared checks)."""
    codes = set(PROVIDER_API.get(provider, {}).get("controls", []))
    if PROVIDER_API.get(provider, {}).get("transport"):
        from .cloud_transport import cloud_control_codes
        codes.update(cloud_control_codes(provider))
    cdef = CONNECTOR_CHECKS.get(provider)
    if cdef:
        from .evidence_engine import connector_control_codes
        codes.update(connector_control_codes(cdef))
    return sorted(codes)
