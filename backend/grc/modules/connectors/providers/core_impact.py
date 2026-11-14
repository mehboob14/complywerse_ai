"""Core Impact (Fortra / formerly HelpSystems) adapter — pen-test inbound.

Pulls confirmed exploit sessions / modules-run records via Core Impact's
REST API and maps each to an ExploitConfirmation so a proven exploit can
boost the linked vulnerability's composite priority.

Core Impact's REST surface varies by version: envelope keys, field names,
and timestamp formats drift across releases. Parsing is therefore defensive
and version-tolerant — every field is read through candidate-name fallbacks,
a malformed entry is skipped rather than failing the whole pull, and an
empty/unparseable response degrades to [].
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

from ..base import ConnectionTestResult, ExploitConfirmation, PenTestAdapter
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)

_API_PREFIX = "/api/v1"
_TEST_TIMEOUT = 20
_FETCH_TIMEOUT = 60
_PAGE_SIZE = 200
_MAX_PAGES = 50  # hard cap so a server that ignores paging params can't loop forever
_TOKEN_CACHE_KEY = "core_impact_token"

# Candidate field names across Core Impact versions. First present wins.
_ID_KEYS = ("id", "execution_id", "module_run_id", "moduleRunId", "uuid", "guid", "session_id", "sessionId")
_TS_KEYS = ("executed_at", "executedAt", "completed_at", "completedAt", "timestamp",
            "start_time", "startTime", "end_time", "endTime", "created", "created_at", "date")
_CVE_KEYS = ("cve_ids", "cveIds", "cves", "cve")
_HOST_KEYS = ("hostname", "host", "target_host", "targetHost", "target_name", "targetName", "name")
_IP_KEYS = ("ip", "ip_address", "ipAddress", "address", "target_ip", "targetIp", "host_ip")
_NAME_KEYS = ("module_name", "moduleName", "module", "exploit", "exploit_name", "exploitName", "name", "title")
_PAYLOAD_KEYS = ("payload", "payload_name", "payloadName", "agent")
_TARGET_KEYS = ("target", "host", "asset", "endpoint")  # nested object holding host/ip
_LIST_KEYS = ("data", "items", "results", "exploits", "modules", "records", "content")


def _first(d: Dict[str, Any], keys, default: Any = None) -> Any:
    """First present, non-None value among `keys`."""
    for k in keys:
        v = d.get(k)
        if v is not None:
            return v
    return default


def _as_cve_list(raw: Any) -> List[str]:
    """CVEs may arrive as a list, a comma/space-separated string, or missing."""
    if not raw:
        return []
    if isinstance(raw, str):
        parts = [p.strip() for p in raw.replace(",", " ").split()]
        return [p for p in parts if p]
    if isinstance(raw, (list, tuple)):
        return [str(c).strip() for c in raw if c]
    return [str(raw).strip()]


def _parse_ts(raw: Any) -> datetime:
    """Tolerate ISO-8601 (with Z), epoch seconds, and epoch millis."""
    if raw is None:
        return datetime.now(timezone.utc)
    # Epoch (int/float, or numeric string)
    try:
        num = float(raw)
        if num > 1e11:  # looks like milliseconds
            num /= 1000.0
        return datetime.fromtimestamp(num, tz=timezone.utc)
    except (TypeError, ValueError):
        pass
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc)


def _extract_items(body: Any) -> List[Dict[str, Any]]:
    """Find the list of records inside a version-varying envelope."""
    if isinstance(body, list):
        return [x for x in body if isinstance(x, dict)]
    if isinstance(body, dict):
        for k in _LIST_KEYS:
            v = body.get(k)
            if isinstance(v, list):
                return [x for x in v if isinstance(x, dict)]
        # Some versions nest the list one level deeper under data.items etc.
        data = body.get("data")
        if isinstance(data, dict):
            return _extract_items(data)
    return []


class CoreImpactAdapter(PenTestAdapter):
    provider = "core_impact"

    # ─── Auth ───────────────────────────────────────────────────────

    def _auth_token(self) -> str:
        """Core Impact's REST uses a pre-issued API token as the credential.
        Cache it in `oauth_tokens` to mirror the other pen-test adapters and
        give a clean seam if a session-exchange is ever needed.

        shortcut: token is static (no login round-trip to refresh), so
        `_reauth()` just re-reads the credential; upgrade here if a Core
        Impact version requires exchanging the API token for a session token.
        """
        token = self.oauth_tokens.get(_TOKEN_CACHE_KEY)
        if token:
            return token
        token = self.credentials.get("api_token")
        if not token:
            raise RuntimeError("Core Impact credentials missing api_token")
        self.oauth_tokens[_TOKEN_CACHE_KEY] = token
        return token

    def _reauth(self) -> None:
        self.oauth_tokens.pop(_TOKEN_CACHE_KEY, None)
        self._auth_token()

    def _headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self._auth_token()}",
            "Accept": "application/json",
        }

    # ─── HTTP ───────────────────────────────────────────────────────

    def _get(self, path: str, *, params: Optional[dict] = None,
             timeout: int = _FETCH_TIMEOUT) -> requests.Response:
        """GET with one retry on 401 (re-auth) and token-safe error messages."""
        url = f"{self.console_url}{path}"
        for attempt in (1, 2):
            resp = requests.get(
                url,
                headers=self._headers(),
                params=params,
                verify=self.verify_ssl,
                timeout=timeout,
            )
            if resp.status_code == 401 and attempt == 1:
                self._reauth()
                continue
            return resp
        return resp  # pragma: no cover — loop always returns inside

    @staticmethod
    def _raise_for_status(resp: requests.Response, action: str) -> None:
        if resp.status_code >= 400:
            # Never echo headers; body is truncated and the token lives in the
            # Authorization header, not the response body.
            raise RuntimeError(
                f"Core Impact {action} failed ({resp.status_code}): {resp.text[:200]}"
            )

    # ─── BaseConnectorAdapter ───────────────────────────────────────

    def test_connection(self) -> ConnectionTestResult:
        try:
            resp = self._get(f"{_API_PREFIX}/workspaces", timeout=_TEST_TIMEOUT)
            self._raise_for_status(resp, "workspace list")
            try:
                body = resp.json()
            except ValueError:
                body = {}
            workspaces = _extract_items(body)
            version = None
            if isinstance(body, dict):
                version = body.get("version") or body.get("server_version") or body.get("product_version")
            return ConnectionTestResult(
                success=True,
                message=f"Authenticated to Core Impact ({len(workspaces)} workspace(s) visible).",
                server_version=str(version) if version else None,
                details={"workspaces": len(workspaces)},
            )
        except Exception as exc:
            logger.exception("Core Impact test_connection failed")
            return ConnectionTestResult(success=False, message=str(exc))

    # ─── PenTestAdapter ─────────────────────────────────────────────

    def fetch_exploits(
        self,
        *,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[ExploitConfirmation]:
        workspace = self.config.get("workspace_id")
        if not workspace:
            logger.warning("Core Impact fetch_exploits: no workspace_id configured; returning []")
            return []

        path = f"{_API_PREFIX}/workspaces/{workspace}/exploits"
        confirmations: List[ExploitConfirmation] = []
        seen_ids: set = set()
        offset = 0

        for _page in range(_MAX_PAGES):
            params: Dict[str, Any] = {
                "success": "true",
                "limit": min(_PAGE_SIZE, limit - len(confirmations)),
                "offset": offset,
            }
            if since:
                params["since"] = since.isoformat()

            resp = self._get(path, params=params)
            self._raise_for_status(resp, "exploit fetch")
            try:
                items = _extract_items(resp.json())
            except ValueError:
                items = []
            if not items:
                break

            new_this_page = 0
            for it in items:
                conf = self._map_exploit(it, since=since)
                if conf is None:
                    continue
                if conf.source_id in seen_ids:
                    continue  # guards a server that ignores `offset`
                seen_ids.add(conf.source_id)
                confirmations.append(conf)
                new_this_page += 1
                if len(confirmations) >= limit:
                    return confirmations

            # Stop when the page was short (no more data) or added nothing new.
            if len(items) < params["limit"] or new_this_page == 0:
                break
            offset += len(items)

        return confirmations

    def _map_exploit(
        self,
        it: Dict[str, Any],
        *,
        since: Optional[datetime],
    ) -> Optional[ExploitConfirmation]:
        """Map one record → ExploitConfirmation. Returns None for malformed
        entries so a single bad row never fails the whole pull."""
        try:
            source_id = _first(it, _ID_KEYS)
            if source_id is None:
                return None
            source_id = str(source_id)

            ts = _parse_ts(_first(it, _TS_KEYS))
            if since and ts < since:
                return None

            # Host/IP may be top-level or inside a nested target/host/asset object.
            target_obj: Dict[str, Any] = {}
            for tk in _TARGET_KEYS:
                v = it.get(tk)
                if isinstance(v, dict):
                    target_obj = v
                    break

            host = _first(it, _HOST_KEYS) or _first(target_obj, _HOST_KEYS)
            ip = _first(it, _IP_KEYS) or _first(target_obj, _IP_KEYS)

            return ExploitConfirmation(
                source_id=source_id,
                timestamp=ts,
                cve_ids=_as_cve_list(_first(it, _CVE_KEYS)),
                target_host=str(host) if host is not None else None,
                target_ip=str(ip) if ip is not None else None,
                exploit_name=(lambda n: str(n) if n is not None else None)(_first(it, _NAME_KEYS)),
                payload=(lambda p: str(p) if p is not None else None)(_first(it, _PAYLOAD_KEYS)),
                raw=it,
            )
        except Exception:
            logger.debug("Core Impact: skipped malformed exploit record", exc_info=True)
            return None


META = ProviderMeta(
    provider="core_impact",
    label="Core Impact",
    category="pentest",
    description="Pull confirmed exploit modules from Core Impact workspaces. Confirmed exploits boost the linked vulnerabilities' composite priority.",
    auth_method="token",
    fields=[
        ProviderField(key="console_url", label="Core Impact URL",
                      kind="url", placeholder="https://coreimpact.example.com",
                      is_credential=False),
        ProviderField(key="api_token", label="API token",
                      kind="password", required=True,
                      help_text="Pre-issued Core Impact REST API token. Sent as a Bearer credential."),
        ProviderField(key="workspace_id", label="Workspace id",
                      kind="text", required=True,
                      help_text="Workspace whose confirmed exploits are pulled.",
                      is_credential=False),
    ],
    adapter_cls=CoreImpactAdapter,
    docs_url="https://www.fortra.com/products/penetration-testing/core-impact",
)
