"""Live SaaS API evidence catalog + engine (ported from the grc-s connector set).

Read-only: every call hits the provider's own API with the tenant's stored token
and maps the response to SOC 2 findings. A successful authenticated call is a
"connectivity" pass; auth failure is a fail carrying the HTTP status (which proves
the request really reached the provider — not demo data). Optional per-entity
"deep" pulls (users/repos/monitors/…) add access-review style findings.

This is pure data + stdlib (urllib) — no new dependency, no framework coupling.
The thin `@register("live_api")` wrapper lives in live_api_runner.py.

Findings are plain dicts: {control_codes, check, resource, status, detail}
with status in {"pass","fail","error"}.
"""
from __future__ import annotations

import base64
import json
import urllib.error
import urllib.request
from typing import Any, Dict, List, Tuple

# provider -> API spec. base ({domain} filled from creds), verify path (proves
# authenticated connectivity), auth scheme, SOC2 control codes, optional
# method/body (GraphQL) and static headers.
PROVIDER_API: Dict[str, dict] = {
    # source control / change management
    "github": {"base": "https://api.github.com", "verify": "/user", "auth": "bearer", "controls": ["CC6.1", "CC8.1"], "label": "GitHub", "category": "scm"},
    "gitlab": {"base": "https://gitlab.com/api/v4", "verify": "/user", "auth": "header:PRIVATE-TOKEN", "controls": ["CC6.1", "CC8.1"], "label": "GitLab", "category": "scm"},
    "bitbucket": {"base": "https://api.bitbucket.org/2.0", "verify": "/user", "auth": "bearer", "controls": ["CC6.1", "CC8.1"], "label": "Bitbucket", "category": "scm"},
    # identity / access
    "okta": {"base": "https://{domain}/api/v1", "verify": "/users?limit=1", "auth": "ssws", "controls": ["CC6.1", "CC6.2"], "label": "Okta", "category": "identity", "needs_domain": True},
    "google_workspace": {"base": "https://www.googleapis.com", "verify": "/oauth2/v3/userinfo", "auth": "bearer", "controls": ["CC6.1"], "label": "Google Workspace", "category": "identity"},
    "microsoft_365": {"base": "https://graph.microsoft.com/v1.0", "verify": "/me", "auth": "bearer", "controls": ["CC6.1"], "label": "Microsoft 365", "category": "identity"},
    "clerk": {"base": "https://api.clerk.com/v1", "verify": "/users?limit=1", "auth": "bearer", "controls": ["CC6.1", "CC6.2"], "label": "Clerk", "category": "identity"},
    "tailscale": {"base": "https://api.tailscale.com/api/v2", "verify": "/tailnet/-/devices", "auth": "bearer", "controls": ["CC6.7"], "label": "Tailscale", "category": "identity"},
    "one_password": {"base": "https://{domain}", "verify": "/heartbeat", "auth": "bearer", "controls": ["CC6.1"], "label": "1Password", "category": "identity", "needs_domain": True},
    # cloud / infra
    "cloudflare": {"base": "https://api.cloudflare.com/client/v4", "verify": "/user/tokens/verify", "auth": "bearer", "controls": ["CC6.1"], "label": "Cloudflare", "category": "cloud"},
    "vercel": {"base": "https://api.vercel.com", "verify": "/v2/user", "auth": "bearer", "controls": ["CC6.1"], "label": "Vercel", "category": "cloud"},
    "netlify": {"base": "https://api.netlify.com/api/v1", "verify": "/user", "auth": "bearer", "controls": ["CC6.1"], "label": "Netlify", "category": "cloud"},
    "heroku": {"base": "https://api.heroku.com", "verify": "/account", "auth": "bearer", "controls": ["CC6.1"], "label": "Heroku", "category": "cloud", "headers": {"Accept": "application/vnd.heroku+json; version=3"}},
    "render": {"base": "https://api.render.com/v1", "verify": "/owners", "auth": "bearer", "controls": ["CC6.1"], "label": "Render", "category": "cloud"},
    "supabase": {"base": "https://api.supabase.com/v1", "verify": "/projects", "auth": "bearer", "controls": ["CC6.1"], "label": "Supabase", "category": "cloud"},
    "neon": {"base": "https://console.neon.tech/api/v2", "verify": "/users/me", "auth": "bearer", "controls": ["CC6.1"], "label": "Neon", "category": "cloud"},
    "qovery": {"base": "https://api.qovery.com", "verify": "/user", "auth": "bearer", "controls": ["CC6.1"], "label": "Qovery", "category": "cloud"},
    "digitalocean": {"base": "https://api.digitalocean.com/v2", "verify": "/account", "auth": "bearer", "controls": ["CC6.1"], "label": "DigitalOcean", "category": "cloud"},
    # observability / monitoring
    "datadog": {"base": "https://api.datadoghq.com/api/v1", "verify": "/validate", "auth": "header:DD-API-KEY", "controls": ["CC7.2"], "label": "Datadog", "category": "observability"},
    "sentry": {"base": "https://sentry.io/api/0", "verify": "/organizations/", "auth": "bearer", "controls": ["CC7.2"], "label": "Sentry", "category": "observability"},
    "grafana": {"base": "https://{domain}", "verify": "/api/user", "auth": "bearer", "controls": ["CC7.2"], "label": "Grafana", "category": "observability", "needs_domain": True},
    "signoz": {"base": "https://{domain}", "verify": "/api/v1/version", "auth": "header:SIGNOZ-API-KEY", "controls": ["CC7.2"], "label": "SigNoz", "category": "observability", "needs_domain": True},
    "posthog": {"base": "https://app.posthog.com", "verify": "/api/users/@me/", "auth": "bearer", "controls": ["CC7.2"], "label": "PostHog", "category": "observability"},
    "better_stack": {"base": "https://uptime.betterstack.com", "verify": "/api/v2/monitors", "auth": "bearer", "controls": ["CC7.4"], "label": "Better Stack", "category": "observability"},
    # incident
    "pagerduty": {"base": "https://api.pagerduty.com", "verify": "/users?limit=1", "auth": "pdtoken", "controls": ["CC7.4"], "label": "PagerDuty", "category": "incident", "headers": {"Accept": "application/vnd.pagerduty+json;version=2"}},
    # productivity / work management
    "notion": {"base": "https://api.notion.com/v1", "verify": "/users", "auth": "bearer", "controls": ["CC6.3"], "label": "Notion", "category": "productivity", "headers": {"Notion-Version": "2022-06-28"}},
    "linear": {"base": "https://api.linear.app", "verify": "/graphql", "auth": "raw", "controls": ["CC6.3"], "label": "Linear", "category": "productivity", "method": "POST", "body": {"query": "{ viewer { id email } }"}},
    "asana": {"base": "https://app.asana.com/api/1.0", "verify": "/users/me", "auth": "bearer", "controls": ["CC6.3"], "label": "Asana", "category": "productivity"},
    "jira": {"base": "https://{domain}/rest/api/3", "verify": "/myself", "auth": "basic", "controls": ["CC6.3"], "label": "Jira", "category": "productivity", "needs_domain": True, "needs_email": True},
    "clickup": {"base": "https://api.clickup.com/api/v2", "verify": "/user", "auth": "raw", "controls": ["CC6.3"], "label": "ClickUp", "category": "productivity"},
    "monday": {"base": "https://api.monday.com", "verify": "/v2", "auth": "raw", "controls": ["CC6.3"], "label": "Monday", "category": "productivity", "method": "POST", "body": {"query": "{ me { id } }"}},
    # comms / support
    "slack": {"base": "https://slack.com/api", "verify": "/auth.test", "auth": "bearer", "controls": ["CC6.1"], "label": "Slack", "category": "comms"},
    "zendesk": {"base": "https://{domain}/api/v2", "verify": "/users/me.json", "auth": "bearer", "controls": ["CC6.2"], "label": "Zendesk", "category": "comms", "needs_domain": True},
    "intercom": {"base": "https://api.intercom.io", "verify": "/me", "auth": "bearer", "controls": ["CC6.2"], "label": "Intercom", "category": "comms"},
    # crm
    "hubspot": {"base": "https://api.hubapi.com", "verify": "/account-info/v3/details", "auth": "bearer", "controls": ["CC6.2"], "label": "HubSpot", "category": "crm"},
    # email
    "sendgrid": {"base": "https://api.sendgrid.com/v3", "verify": "/scopes", "auth": "bearer", "controls": ["CC6.1"], "label": "SendGrid", "category": "email"},
    "resend": {"base": "https://api.resend.com", "verify": "/domains", "auth": "bearer", "controls": ["CC6.7"], "label": "Resend", "category": "email"},
    # ai
    "openai": {"base": "https://api.openai.com/v1", "verify": "/models", "auth": "bearer", "controls": ["CC6.1"], "label": "OpenAI", "category": "ai"},
    "anthropic": {"base": "https://api.anthropic.com/v1", "verify": "/models", "auth": "header:x-api-key", "controls": ["CC6.1"], "label": "Anthropic", "category": "ai", "headers": {"anthropic-version": "2023-06-01"}},
}

LIVE_API_PROVIDERS = set(PROVIDER_API.keys())


def _finding(codes: List[str], check: str, resource: str, status: str, detail: str = "") -> dict:
    return {"control_codes": list(codes), "check": check, "resource": resource, "status": status, "detail": detail}


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


def _request(spec: dict, creds: dict, url: str, timeout: int = 15) -> Tuple[int, Any]:
    token = creds.get("token") or creds.get("access_token") or ""
    headers = {"Accept": "application/json", "User-Agent": "grc-evidence-collector"}
    headers.update(spec.get("headers", {}))
    if spec.get("auth") == "basic":
        raw = f"{creds.get('email','')}:{token}".encode("utf-8")
        headers["Authorization"] = "Basic " + base64.b64encode(raw).decode("ascii")
    else:
        headers.update(_auth_header(spec.get("auth", ""), token))

    method = spec.get("method", "GET")
    data = None
    if spec.get("body") is not None:
        data = json.dumps(spec["body"]).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 — fixed provider hosts, read-only
            body = resp.read().decode("utf-8", "replace")
            try:
                return resp.status, json.loads(body)
            except ValueError:
                return resp.status, body
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8", "replace"))
        except Exception:  # noqa: BLE001
            return e.code, ""
    except Exception as e:  # noqa: BLE001
        return 0, str(e)


# ── per-entity "deep" pulls (access-review style) ─────────────────────────────
CAP = 25


def _name(it: Any, keys: List[str]) -> str:
    if not isinstance(it, dict):
        return str(it)[:48]
    for k in keys:
        v = it.get(k)
        if isinstance(v, str) and v:
            return v
    return next((str(v) for v in it.values() if isinstance(v, (str, int))), "entity")


def _items_at(*path):
    def f(body):
        cur = body
        for p in path:
            cur = cur.get(p, {}) if isinstance(cur, dict) else {}
        return cur if isinstance(cur, list) else []
    return f


def _items_root(body):
    return body if isinstance(body, list) else []


def _inv(codes, check, name_keys):
    return lambda it: (codes, check, _name(it, name_keys), "pass", "present")


def _user_mfa(codes, check, name_keys, mfa_key, bot_key=None):
    def f(it):
        name = _name(it, name_keys)
        if bot_key and isinstance(it, dict) and it.get(bot_key):
            return (codes, check, name, "pass", "service / bot account")
        ok = bool(isinstance(it, dict) and it.get(mfa_key))
        return (codes, check, name, "pass" if ok else "fail", "MFA/2FA enabled" if ok else "No MFA/2FA enrolled")
    return f


def _gitlab_visibility(it):
    vis = it.get("visibility") if isinstance(it, dict) else None
    return (["CC8.1", "CC6.1"], "gitlab.project_visibility", _name(it, ["path_with_namespace", "name"]),
            "fail" if vis == "public" else "pass", f"visibility: {vis}")


DEEP: Dict[str, dict] = {
    "google_workspace": {"path": "/admin/directory/v1/users?customer=my_customer&maxResults=50", "items": _items_at("users"), "finding": _user_mfa(["CC6.1", "CC6.2"], "google.user_2sv", ["primaryEmail"], "isEnrolledIn2Sv"), "controls": ["CC6.1", "CC6.2"]},
    "microsoft_365": {"path": "/users?$select=displayName,userPrincipalName,accountEnabled&$top=50", "items": _items_at("value"), "finding": _inv(["CC6.2"], "m365.user", ["userPrincipalName", "displayName"]), "controls": ["CC6.2"]},
    "slack": {"path": "/users.list?limit=100", "items": _items_at("members"), "finding": _user_mfa(["CC6.1", "CC6.2"], "slack.member_2fa", ["real_name", "name"], "has_2fa", "is_bot"), "controls": ["CC6.1", "CC6.2"]},
    "clerk": {"path": "/users?limit=50", "items": _items_root, "finding": _inv(["CC6.2"], "clerk.user", ["id"]), "controls": ["CC6.2"]},
    "zendesk": {"path": "/users.json", "items": _items_at("users"), "finding": _inv(["CC6.2"], "zendesk.user", ["email", "name"]), "controls": ["CC6.2"]},
    "intercom": {"path": "/admins", "items": _items_at("admins"), "finding": _inv(["CC6.2"], "intercom.admin", ["email", "name"]), "controls": ["CC6.2"]},
    "asana": {"path": "/users?limit=50", "items": _items_at("data"), "finding": _inv(["CC6.3"], "asana.user", ["name"]), "controls": ["CC6.3"]},
    "notion": {"path": "/users", "items": _items_at("results"), "finding": _inv(["CC6.3"], "notion.user", ["name"]), "controls": ["CC6.3"]},
    "hubspot": {"path": "/settings/v3/users", "items": _items_at("results"), "finding": _inv(["CC6.2"], "hubspot.user", ["email"]), "controls": ["CC6.2"]},
    "pagerduty": {"path": "/users?limit=50", "items": _items_at("users"), "finding": _inv(["CC7.4"], "pagerduty.user", ["email", "name"]), "controls": ["CC7.4"]},
    "clickup": {"path": "/team", "items": _items_at("teams"), "finding": _inv(["CC6.3"], "clickup.team", ["id", "name"]), "controls": ["CC6.3"]},
    "sendgrid": {"path": "/teammates", "items": _items_at("result"), "finding": _inv(["CC6.1"], "sendgrid.teammate", ["username", "email"]), "controls": ["CC6.1"]},
    "tailscale": {"path": "/tailnet/-/devices", "items": _items_at("devices"), "finding": _inv(["CC6.7"], "tailscale.device", ["name", "hostname"]), "controls": ["CC6.7"]},
    "linear": {"method": "POST", "body": {"query": "{ users(first: 50) { nodes { name email active admin } } }"}, "path": "/graphql", "items": _items_at("data", "users", "nodes"), "finding": lambda it: (["CC6.3"], "linear.user", _name(it, ["email", "name"]), "fail" if it.get("admin") and not it.get("active") else "pass", "admin" if it.get("admin") else "member"), "controls": ["CC6.3"]},
    "monday": {"method": "POST", "body": {"query": "{ users(limit: 50) { name email is_admin } }"}, "path": "/v2", "items": _items_at("data", "users"), "finding": lambda it: (["CC6.3"], "monday.user", _name(it, ["email", "name"]), "pass", "admin" if it.get("is_admin") else "member"), "controls": ["CC6.3"]},
    "gitlab": {"path": "/projects?membership=true&per_page=50&simple=false", "items": _items_root, "finding": _gitlab_visibility, "controls": ["CC8.1"]},
    "bitbucket": {"path": "/user/permissions/repositories?pagelen=50", "items": _items_at("values"), "finding": _inv(["CC8.1"], "bitbucket.repo_access", ["repository"]), "controls": ["CC8.1"]},
    "vercel": {"path": "/v9/projects", "items": _items_at("projects"), "finding": _inv(["CC6.1"], "vercel.project", ["name"]), "controls": ["CC6.1"]},
    "netlify": {"path": "/sites", "items": _items_root, "finding": _inv(["CC6.1"], "netlify.site", ["name"]), "controls": ["CC6.1"]},
    "cloudflare": {"path": "/zones", "items": _items_at("result"), "finding": _inv(["CC6.1"], "cloudflare.zone", ["name"]), "controls": ["CC6.1"]},
    "heroku": {"path": "/apps", "items": _items_root, "finding": _inv(["CC6.1"], "heroku.app", ["name"]), "controls": ["CC6.1"]},
    "render": {"path": "/services?limit=50", "items": _items_root, "finding": _inv(["CC6.1"], "render.service", ["name", "id"]), "controls": ["CC6.1"]},
    "supabase": {"path": "/projects", "items": _items_root, "finding": _inv(["CC6.1"], "supabase.project", ["name"]), "controls": ["CC6.1"]},
    "neon": {"path": "/projects", "items": _items_at("projects"), "finding": _inv(["CC6.1"], "neon.project", ["name"]), "controls": ["CC6.1"]},
    "qovery": {"path": "/organization", "items": _items_at("results"), "finding": _inv(["CC6.1"], "qovery.org", ["name"]), "controls": ["CC6.1"]},
    "digitalocean": {"path": "/droplets?per_page=50", "items": _items_at("droplets"), "finding": _inv(["CC6.1"], "digitalocean.droplet", ["name"]), "controls": ["CC6.1"]},
    "datadog": {"path": "/monitors", "items": _items_root, "finding": _inv(["CC7.2"], "datadog.monitor", ["name"]), "controls": ["CC7.2"]},
    "sentry": {"path": "/projects/", "items": _items_root, "finding": _inv(["CC7.2"], "sentry.project", ["slug", "name"]), "controls": ["CC7.2"]},
    "grafana": {"path": "/api/search?type=dash-db&limit=50", "items": _items_root, "finding": _inv(["CC7.2"], "grafana.dashboard", ["title"]), "controls": ["CC7.2"]},
    "signoz": {"path": "/api/v1/dashboards", "items": _items_at("data"), "finding": _inv(["CC7.2"], "signoz.dashboard", ["title", "uuid"]), "controls": ["CC7.2"]},
    "posthog": {"path": "/api/projects/", "items": _items_at("results"), "finding": _inv(["CC7.2"], "posthog.project", ["name"]), "controls": ["CC7.2"]},
    "better_stack": {"path": "/api/v2/monitors", "items": _items_at("data"), "finding": _inv(["CC7.4"], "betterstack.monitor", ["id"]), "controls": ["CC7.4"]},
}


def _run_deep(provider: str, creds: dict, base: str) -> List[dict]:
    cfg = DEEP[provider]
    spec = PROVIDER_API[provider]
    call_spec = {**spec, "method": cfg.get("method", "GET"), "body": cfg.get("body")}
    status, body = _request(call_spec, creds, base + cfg["path"])
    if status != 200:
        return [_finding(cfg["controls"], f"{provider}.deep", "directory", "error",
                         f"Could not list entities (HTTP {status}) — token may lack read scope")]
    items = cfg["items"](body) or []
    out, flagged = [], 0
    for it in items[:CAP]:
        try:
            codes, check, resource, st, detail = cfg["finding"](it)
        except Exception:  # noqa: BLE001
            continue
        if st == "fail":
            flagged += 1
        out.append(_finding(codes, check, resource, st, detail))
    out.append(_finding(cfg["controls"], f"{provider}.access_review", "directory",
                        "pass" if flagged == 0 else "fail",
                        f"Pulled {len(items)} entities; {flagged} flagged"))
    return out


def _enrich(provider: str, creds: dict, body: Any) -> List[dict]:
    """Cheap provider-specific extra checks on a successful verify call."""
    p = provider
    try:
        if p == "github" and isinstance(body, dict) and body.get("two_factor_authentication") is not None:
            tfa = body["two_factor_authentication"]
            return [_finding(["CC6.1", "CC6.2"], "github.account_2fa", body.get("login", "account"),
                             "pass" if tfa else "fail", "2FA enabled" if tfa else "Account 2FA disabled")]
        if p == "slack" and isinstance(body, dict):
            if not body.get("ok"):
                return [_finding(["CC6.1"], "slack.auth_test", "workspace", "fail", f"Slack error: {body.get('error')}")]
            return [_finding(["CC6.1"], "slack.workspace", body.get("team", "workspace"), "pass",
                             f"Connected to workspace {body.get('team','')}")]
        if p == "sentry" and isinstance(body, list):
            return [_finding(["CC7.2"], "sentry.org_2fa", o.get("slug", "org"),
                             "pass" if o.get("require2FA") else "fail",
                             "Org requires 2FA" if o.get("require2FA") else "Org does not require 2FA") for o in body[:5]]
        if p in ("google_workspace", "intercom") and isinstance(body, dict) and body.get("email"):
            return [_finding(["CC6.1"], f"{p}.identity", body["email"], "pass", f"Authenticated as {body['email']}")]
        if p == "okta":
            return _okta_mfa_sweep(creds)
    except Exception:  # noqa: BLE001
        pass
    return []


def _okta_mfa_sweep(creds: dict) -> List[dict]:
    domain = (creds.get("domain") or "").replace("https://", "").replace("http://", "")
    if not domain:
        return []
    base = f"https://{domain}/api/v1"
    spec = {"auth": "ssws"}
    status, users = _request(spec, creds, f"{base}/users?limit=50&filter=status+eq+%22ACTIVE%22")
    if status != 200 or not isinstance(users, list):
        status, users = _request(spec, creds, f"{base}/users?limit=50")
    if status != 200 or not isinstance(users, list):
        return []
    out, no_mfa = [], 0
    for u in users[:50]:
        uid = u.get("id")
        login = (u.get("profile") or {}).get("login", uid)
        fstatus, factors = _request(spec, creds, f"{base}/users/{uid}/factors")
        if not (fstatus == 200 and isinstance(factors, list) and len(factors) > 0):
            no_mfa += 1
            out.append(_finding(["CC6.1", "CC6.2"], "okta.user_mfa", login, "fail", "User has no enrolled MFA factor"))
    out.append(_finding(["CC6.1", "CC6.2"], "okta.mfa_summary", "directory",
                        "pass" if no_mfa == 0 else "fail", f"{no_mfa} of {len(users)} active users lack MFA"))
    return out


_CUSTOM_DEEP: Dict[str, Any] = {}  # digitalocean firewall/db-tls deep pull can be added here later


def run_provider(provider: str, creds: dict) -> dict:
    """Authenticate + collect. Returns {findings, connectivity, summary, summary_text}.
    connectivity in {"pass","fail","error"}. Read-only."""
    spec = PROVIDER_API.get(provider)
    if not spec:
        return {"connectivity": "error", "findings": [], "summary": {}, "summary_text": f"No live client for '{provider}'"}

    token = creds.get("token") or creds.get("access_token")
    if not token:
        return {"connectivity": "error", "findings": [], "summary": {}, "summary_text": "No API token configured for this collector"}

    base = spec["base"]
    if "{domain}" in base:
        domain = (creds.get("domain") or "").replace("https://", "").replace("http://", "").rstrip("/")
        if not domain:
            return {"connectivity": "error", "findings": [], "summary": {}, "summary_text": "Missing 'domain' for this provider"}
        base = base.replace("{domain}", domain)

    status, body = _request(spec, creds, base + spec["verify"])
    findings: List[dict] = []
    if status == 200:
        conn = "pass"
        findings.append(_finding(spec["controls"], f"{provider}.connectivity", provider, "pass",
                                 "Authenticated read-only API call succeeded"))
        if provider in _CUSTOM_DEEP:
            findings += _CUSTOM_DEEP[provider](creds, base)
        elif provider in DEEP:
            findings += _run_deep(provider, creds, base)
        else:
            findings += _enrich(provider, creds, body)
    elif status in (401, 403):
        conn = "fail"
        findings.append(_finding(spec["controls"], f"{provider}.connectivity", provider, "fail",
                                 f"Provider rejected credentials (HTTP {status}) — check the token/scopes"))
    else:
        conn = "error"
        findings.append(_finding(spec["controls"], f"{provider}.connectivity", provider, "error",
                                 f"Unexpected response from provider (HTTP {status})"))

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
        "summary_text": f"{provider}: {summary['pass']} pass / {summary['fail']} fail / {summary['error']} error across {len(summary['controls_touched'])} controls",
    }


def provider_meta() -> List[dict]:
    """Catalog for the Evidence Collectors admin page."""
    out = []
    for p, s in sorted(PROVIDER_API.items(), key=lambda kv: (kv[1]["category"], kv[0])):
        out.append({
            "provider": p, "label": s["label"], "category": s["category"],
            "controls": s["controls"], "auth": s["auth"],
            "needs_domain": bool(s.get("needs_domain")), "needs_email": bool(s.get("needs_email")),
        })
    return out


# Codes emitted only by _enrich (not declared in verify/deep specs), so the
# static seed mapping still covers them. Keep in sync with _enrich above.
_ENRICH_EXTRA_CODES = {"github": ["CC6.2"]}


def all_control_codes(provider: str) -> List[str]:
    """Union of every SOC 2 code this provider can emit (verify + deep + enrich)."""
    codes = set(PROVIDER_API.get(provider, {}).get("controls", []))
    if provider in DEEP:
        codes.update(DEEP[provider].get("controls", []))
    codes.update(_ENRICH_EXTRA_CODES.get(provider, []))
    return sorted(codes)
