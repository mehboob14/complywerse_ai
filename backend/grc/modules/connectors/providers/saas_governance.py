"""SaaS governance connectors — Grip Security (discovery) and Zscaler Internet Access (blocking).

Pull-only for Grip: the connector row holds and health-checks the tenant's API
token, and third-party risk reads discovered SaaS with it
(vendor_risk/tpra/shadow_saas.py). Zscaler is the one push: a denied app's
domain is added to a URL category the tenant chose, and taken off it again if
the decision is reopened. Nothing else in the tenant's Zscaler policy is read
or changed.

ponytail: both are built to each vendor's published API (Grip's public SaaS
endpoints; Zscaler's documented obfuscated-key session and URL-category list
actions) and tested against those shapes; neither has run against a live
tenant yet. A call that answers differently fails loudly, never quietly.
"""
from __future__ import annotations

import logging
import time
from typing import Dict, List, Optional

import requests

from ..base import ConnectionTestResult, EasmSourceAdapter
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)
TIMEOUT = 30


# ── Grip Security ────────────────────────────────────────────────────────────

def grip_apps(base_url: str, token: str, get=requests.get, page: int = 200, limit: int = 20000) -> List[dict]:
    """Every SaaS app Grip has discovered, page by page."""
    out: List[dict] = []
    while len(out) < limit:
        resp = get(base_url.rstrip("/"), params={"offset": len(out), "limit": page},
                   headers={"access-token": token, "Accept": "application/json"}, timeout=TIMEOUT)
        resp.raise_for_status()
        body = resp.json()
        rows = body if isinstance(body, list) else (body or {}).get("data") or (body or {}).get("items") or []
        out += [r for r in rows if isinstance(r, dict)]
        if len(rows) < page:
            break
    return out


def _sibling(base_url: str, name: str) -> str:
    """Grip's other lists hang off /public beside /public/saas."""
    base = base_url.rstrip("/")
    return (base[: -len("/saas")] if base.endswith("/saas") else base) + f"/{name}"


def grip_users(base_url: str, token: str, get=requests.get, page: int = 200, limit: int = 50000) -> List[dict]:
    """Everyone Grip has seen using SaaS, page by page."""
    return grip_apps(_sibling(base_url, "users"), token, get=get, page=page, limit=limit)


def _apps_of(user: dict) -> List[dict]:
    """The apps a Grip user record names, however it names them."""
    for key in ("saas", "apps", "applications", "saasApps", "saasList"):
        value = user.get(key)
        if isinstance(value, list):
            return [v if isinstance(v, dict) else {"name": str(v)} for v in value]
    return []


def rosters(users: List[dict]) -> Dict[str, List[dict]]:
    """Who uses each app, keyed by Grip app id or, failing that, lower-cased app name."""
    out: Dict[str, List[dict]] = {}
    for u in users:
        email = u.get("email") or u.get("userEmail") or u.get("username")
        name = u.get("name") or u.get("displayName") or " ".join(
            str(x) for x in (u.get("firstName"), u.get("lastName")) if x) or None
        if not email and not name:
            continue
        person = {"email": email, "name": name, "department": u.get("department") or u.get("team"),
                  "last_seen": u.get("lastSeen") or u.get("last_seen") or u.get("lastActivity")}
        for app in _apps_of(u):
            key = str(app.get("id") or app.get("saasId") or "").strip() or str(app.get("name") or "").strip().lower()
            if key:
                out.setdefault(key, []).append(person)
    return out


class GripAdapter(EasmSourceAdapter):
    provider = "grip"
    category = "saas_discovery"

    def test_connection(self) -> ConnectionTestResult:
        token, base = self.credentials.get("api_token"), (self.config.get("base_url") or self.console_url or "").strip()
        if not token or not base:
            return ConnectionTestResult(success=False, message="Grip base URL and API token are both needed")
        try:
            resp = requests.get(base.rstrip("/"), params={"offset": 0, "limit": 1},
                                headers={"access-token": token}, timeout=20)
        except Exception as exc:  # noqa: BLE001
            return ConnectionTestResult(success=False, message=str(exc))
        if resp.status_code == 200:
            return ConnectionTestResult(success=True, message="Authenticated to Grip Security.")
        return ConnectionTestResult(success=False, message=f"Grip returned {resp.status_code}: {resp.text[:300]}")


# ── Zscaler Internet Access ─────────────────────────────────────────────────

def _obfuscate(api_key: str, now_ms: Optional[int] = None) -> tuple:
    """Zscaler's documented key obfuscation: pick characters of the key by the
    last six digits of the timestamp, then by those digits halved, offset by two."""
    now_ms = now_ms or int(time.time() * 1000)
    n = str(now_ms)[-6:]
    r = str(int(n) >> 1).zfill(6)
    return now_ms, "".join(api_key[int(c)] for c in n) + "".join(api_key[int(c) + 2] for c in r)


class ZscalerSession:
    """A logged-in ZIA admin session, closed (and changes activated) on exit."""

    def __init__(self, creds: Dict[str, str], http: Optional[requests.Session] = None):
        self.base = (creds.get("base_url") or "https://zsapi.zscaler.net").rstrip("/") + "/api/v1"
        self.creds, self.http, self.changed = creds, http or requests.Session(), False

    def __enter__(self):
        stamp, key = _obfuscate(self.creds["api_key"])
        resp = self.http.post(f"{self.base}/authenticatedSession", timeout=TIMEOUT, json={
            "apiKey": key, "username": self.creds["username"], "password": self.creds["password"], "timestamp": stamp})
        resp.raise_for_status()
        return self

    def __exit__(self, *exc):
        try:
            if self.changed:
                self.http.post(f"{self.base}/status/activate", timeout=TIMEOUT).raise_for_status()
        finally:
            try:
                self.http.delete(f"{self.base}/authenticatedSession", timeout=TIMEOUT)
            except Exception:  # noqa: BLE001 — logging out is best effort
                logger.warning("Zscaler logout failed", exc_info=True)
        return False

    def _list(self, domain: str, action: str) -> None:
        category_id = self.creds["category_id"]
        current = self.http.get(f"{self.base}/urlCategories/{category_id}", timeout=TIMEOUT)
        current.raise_for_status()
        body = current.json() or {}
        payload = {k: body[k] for k in ("id", "configuredName", "customCategory", "superCategory") if k in body}
        payload["urls"] = [domain]
        self.http.put(f"{self.base}/urlCategories/{category_id}", params={"action": action}, json=payload,
                      timeout=TIMEOUT).raise_for_status()
        self.changed = True

    def block(self, domain: str) -> None:
        self._list(domain, "ADD_TO_LIST")

    def allow(self, domain: str) -> None:
        self._list(domain, "REMOVE_FROM_LIST")


class ZscalerAdapter(EasmSourceAdapter):
    provider = "zscaler"
    category = "web_gateway"

    def test_connection(self) -> ConnectionTestResult:
        creds = {**self.config, **self.credentials}
        missing = [k for k in ("username", "password", "api_key", "category_id") if not creds.get(k)]
        if missing:
            return ConnectionTestResult(success=False, message=f"Missing: {', '.join(missing)}")
        try:
            with ZscalerSession(creds) as z:
                z.http.get(f"{z.base}/urlCategories/{creds['category_id']}", timeout=20).raise_for_status()
        except Exception as exc:  # noqa: BLE001
            return ConnectionTestResult(success=False, message=f"Zscaler: {exc}")
        return ConnectionTestResult(success=True, message="Signed in to Zscaler and found the URL category.")


METAS = [
    ProviderMeta(
        provider="grip", label="Grip Security", category="saas_discovery", auth_method="api_key",
        description="Brings the SaaS apps Grip has discovered into third-party risk's Shadow SaaS list.",
        adapter_cls=GripAdapter, docs_url="https://apidocs.grip.security/",
        fields=[
            ProviderField(key="base_url", label="Base URL", kind="url", required=True, is_credential=False,
                          placeholder="https://<tenant>.dep.grip.security/public/saas"),
            ProviderField(key="api_token", label="API token", kind="password", required=True),
        ]),
    ProviderMeta(
        provider="zscaler", label="Zscaler Internet Access", category="web_gateway", auth_method="basic",
        description="Adds the domain of an app third-party risk denies to a URL category you block, and removes it if reopened.",
        adapter_cls=ZscalerAdapter,
        docs_url="https://help.zscaler.com/zia/getting-started-zia-api",
        fields=[
            ProviderField(key="base_url", label="API base URL", kind="url", required=True, is_credential=False,
                          placeholder="https://zsapi.zscaler.net"),
            ProviderField(key="username", label="API admin username", kind="text", required=True),
            ProviderField(key="password", label="Password", kind="password", required=True),
            ProviderField(key="api_key", label="API key", kind="password", required=True),
            ProviderField(key="category_id", label="URL category ID to block", kind="text", required=True,
                          is_credential=False, help_text="A custom URL category your policy already blocks."),
        ]),
]
