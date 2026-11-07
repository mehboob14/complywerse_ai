"""CrowdStrike Falcon adapter — EDR inbound.

Pulls recent detections from the Falcon platform and maps them to
normalised SecurityEvents so active-endpoint-threat signals enrich vuln
priority, the same way the SIEM adapters do.

Auth: OAuth2 client-credentials. POST {base_url}/oauth2/token with a
form-encoded client_id / client_secret returns a bearer access_token
that expires in ~30 min; we cache it and refresh on expiry (or on a 401).

base_url is region-specific:
    US-1     https://api.crowdstrike.com         (default)
    US-2     https://api.us-2.crowdstrike.com
    EU-1     https://api.eu-1.crowdstrike.com
    US-GOV-1 https://api.laggar.gcw.crowdstrike.com

Detections are a two-step pull: GET /detects/queries/detects/v1 returns a
page of detection ids, then POST /detects/entities/summaries/GET/v1
returns the full detection objects.

The API client (in the Falcon console) must have the **Detections READ**
scope, otherwise the queries endpoint returns 403.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

from ..base import ConnectionTestResult, SecurityEvent, SiemAdapter
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)

_DEFAULT_BASE_URL = "https://api.crowdstrike.com"
_TOKEN_SKEW_SECONDS = 60  # refresh a minute before the real expiry

# Falcon detection severity is a 0-100 int (max_severity) or a
# PatternSeverity string on newer schemas; map both to our bands.
_SEV_WORDS = {
    "critical": "critical",
    "high": "high",
    "medium": "medium",
    "low": "low",
    "informational": "info",
    "info": "info",
}


class CrowdStrikeAdapter(SiemAdapter):
    provider = "crowdstrike"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._token: Optional[str] = None
        self._token_expiry: float = 0.0  # epoch seconds

    # ─── base url + auth ────────────────────────────────────────────

    def _base_url(self) -> str:
        # console_url carries the region base URL; fall back to US-1.
        return self.console_url or _DEFAULT_BASE_URL

    def _get_token(self, *, force: bool = False) -> str:
        if not force and self._token and time.time() < self._token_expiry:
            return self._token

        client_id = self.credentials.get("client_id")
        client_secret = self.credentials.get("client_secret")
        if not client_id or not client_secret:
            raise RuntimeError("CrowdStrike credentials missing client_id / client_secret")

        resp = requests.post(
            f"{self._base_url()}/oauth2/token",
            data={"client_id": client_id, "client_secret": client_secret},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            verify=self.verify_ssl,
            timeout=20,
        )
        if resp.status_code != 201 and resp.status_code != 200:
            # Never echo the request body — it carries the client secret.
            raise RuntimeError(
                f"CrowdStrike OAuth token request failed ({resp.status_code}): "
                f"{resp.text[:200]}"
            )
        body = resp.json()
        token = body.get("access_token")
        if not token:
            raise RuntimeError("CrowdStrike OAuth response had no access_token")
        self._token = token
        self._token_expiry = time.time() + float(body.get("expires_in", 1800)) - _TOKEN_SKEW_SECONDS
        return token

    def _auth_headers(self, *, force_refresh: bool = False) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self._get_token(force=force_refresh)}",
            "Accept": "application/json",
        }

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> requests.Response:
        """GET with a single token-refresh retry on 401."""
        url = f"{self._base_url()}{path}"
        resp = requests.get(url, headers=self._auth_headers(), params=params,
                            verify=self.verify_ssl, timeout=60)
        if resp.status_code == 401:
            resp = requests.get(url, headers=self._auth_headers(force_refresh=True),
                                params=params, verify=self.verify_ssl, timeout=60)
        return resp

    def _post(self, path: str, json_body: Dict[str, Any]) -> requests.Response:
        url = f"{self._base_url()}{path}"
        resp = requests.post(url, headers=self._auth_headers(), json=json_body,
                             verify=self.verify_ssl, timeout=60)
        if resp.status_code == 401:
            resp = requests.post(url, headers=self._auth_headers(force_refresh=True),
                                 json=json_body, verify=self.verify_ssl, timeout=60)
        return resp

    # ─── test_connection ────────────────────────────────────────────

    def test_connection(self) -> ConnectionTestResult:
        try:
            self._get_token(force=True)  # proves the OAuth creds work
        except Exception as exc:
            logger.exception("CrowdStrike token request failed")
            return ConnectionTestResult(success=False, message=str(exc))

        try:
            resp = self._get("/detects/queries/detects/v1", params={"limit": 1})
            if resp.status_code == 200:
                return ConnectionTestResult(
                    success=True,
                    message="Connected to CrowdStrike Falcon.",
                )
            if resp.status_code == 403:
                return ConnectionTestResult(
                    success=False,
                    message=("Authenticated, but the API client is missing the "
                             "Detections READ scope (403). Add it in the Falcon "
                             "console under API Clients & Keys."),
                )
            return ConnectionTestResult(
                success=False,
                message=f"CrowdStrike /detects/queries/detects returned "
                        f"{resp.status_code}: {resp.text[:200]}",
            )
        except Exception as exc:
            logger.exception("CrowdStrike test_connection failed")
            return ConnectionTestResult(success=False, message=str(exc))

    # ─── fetch_events ───────────────────────────────────────────────

    def fetch_events(
        self,
        *,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[SecurityEvent]:
        params: Dict[str, Any] = {"limit": max(1, min(limit, 500)), "sort": "last_behavior|desc"}
        if since:
            # FQL: last_behavior is an ISO-8601 timestamp.
            ts = since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            params["filter"] = f"last_behavior:>'{ts}'"

        q = self._get("/detects/queries/detects/v1", params=params)
        if q.status_code != 200:
            raise RuntimeError(
                f"CrowdStrike detect query failed ({q.status_code}): {q.text[:300]}"
            )
        ids = (q.json().get("resources") or [])[:limit]
        if not ids:
            return []

        summaries = self._post("/detects/entities/summaries/GET/v1", {"ids": ids})
        if summaries.status_code != 200:
            raise RuntimeError(
                f"CrowdStrike detect summaries failed "
                f"({summaries.status_code}): {summaries.text[:300]}"
            )

        events: List[SecurityEvent] = []
        for det in summaries.json().get("resources") or []:
            event = _detection_to_event(det)
            if event:
                events.append(event)
        return events


def _parse_ts(value: Any) -> datetime:
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            pass
    return datetime.now(timezone.utc)


def _severity(det: Dict[str, Any]) -> str:
    # Newer schema: string PatternSeverity; older: numeric max_severity (0-100).
    word = det.get("severity") or det.get("max_severity_displayname")
    if isinstance(word, str) and word.lower() in _SEV_WORDS:
        return _SEV_WORDS[word.lower()]
    num = det.get("max_severity")
    try:
        n = int(num)
    except (TypeError, ValueError):
        return "info"
    if n >= 90: return "critical"
    if n >= 70: return "high"
    if n >= 40: return "medium"
    if n >= 20: return "low"
    return "info"


def _detection_to_event(det: Dict[str, Any]) -> Optional[SecurityEvent]:
    behaviors = det.get("behaviors") or []
    first = behaviors[0] if behaviors else {}
    device = det.get("device") or {}

    det_id = det.get("detection_id") or det.get("composite_id") or first.get("behavior_id")
    title = (first.get("display_name") or first.get("technique")
             or det.get("detection_name") or "crowdstrike_detection")
    host = device.get("hostname") or device.get("device_id")
    ip = device.get("local_ip") or device.get("external_ip")
    message = first.get("description") or det.get("status")

    return SecurityEvent(
        source_event_id=str(det_id or _parse_ts(det.get("created_timestamp")).isoformat()),
        timestamp=_parse_ts(det.get("created_timestamp") or first.get("timestamp")),
        severity=_severity(det),
        rule_name=title,
        cve_ids=[],  # Falcon detections are behaviour-based; no CVE on the detection
        affected_host=host,
        affected_ip=ip,
        message=message,
        raw=det,
    )


META = ProviderMeta(
    provider="crowdstrike",
    label="CrowdStrike Falcon",
    category="edr",
    description="Pull recent endpoint detections from CrowdStrike Falcon. High-severity detections on hosts in the asset register surface as active-threat signals.",
    auth_method="oauth2",
    fields=[
        ProviderField(key="console_url", label="Falcon Base URL", kind="url",
                      placeholder="https://api.crowdstrike.com",
                      help_text="Region API base URL. US-1 https://api.crowdstrike.com, "
                                "US-2 https://api.us-2.crowdstrike.com, "
                                "EU-1 https://api.eu-1.crowdstrike.com, "
                                "US-GOV-1 https://api.laggar.gcw.crowdstrike.com.",
                      required=False,
                      is_credential=False),
        ProviderField(key="client_id", label="API Client ID",
                      kind="text", required=True,
                      help_text="From Falcon console → Support → API Clients & Keys."),
        ProviderField(key="client_secret", label="API Client Secret",
                      kind="password", required=True,
                      help_text="Shown once when the API client is created."),
    ],
    adapter_cls=CrowdStrikeAdapter,
    docs_url="https://falcon.crowdstrike.com/documentation/page/a2a7fc0e/crowdstrike-oauth2-based-apis",
)
