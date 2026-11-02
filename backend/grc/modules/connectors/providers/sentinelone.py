"""SentinelOne Singularity adapter — EDR inbound.

Pulls recent threats from the SentinelOne Management console and maps
them to normalised SecurityEvents so active-endpoint-threat signals
enrich vuln priority, the same way the other EDR / SIEM adapters do.

Auth: a static API token. Every request carries
`Authorization: ApiToken <api_token>` — there is no token-exchange step
(unlike CrowdStrike's OAuth client-credentials flow).

console_url is the tenant management console, e.g.
    https://<your-tenant>.sentinelone.net
It is a config field, not a credential.

Threats: GET {console_url}/web/api/v2.1/threats returns a page of threat
objects. We pull one page (sorted newest-first) up to `limit`, filtering
by createdAt when `since` is given, and map each threat → SecurityEvent.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

from ..base import ConnectionTestResult, SecurityEvent, SiemAdapter
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)

_API_PREFIX = "/web/api/v2.1"

# SentinelOne grades a threat on two axes:
#   threatInfo.confidenceLevel : suspicious | malicious
#   threatInfo.analystVerdict  : true_positive | suspicious | false_positive | undefined
# Map the strongest signal present to our bands.
_VERDICT_SEV = {
    "true_positive": "critical",
    "suspicious": "medium",
    "false_positive": "info",
    "undefined": "low",
}
_CONFIDENCE_SEV = {
    "malicious": "high",
    "suspicious": "medium",
    "n/a": "info",
}


class SentinelOneAdapter(SiemAdapter):
    provider = "sentinelone"

    # ─── auth + request helpers ──────────────────────────────────────

    def _auth_headers(self) -> Dict[str, str]:
        token = self.credentials.get("api_token")
        if not token:
            raise RuntimeError("SentinelOne credentials missing api_token")
        return {
            "Authorization": f"ApiToken {token}",
            "Accept": "application/json",
        }

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> requests.Response:
        url = f"{self.console_url}{_API_PREFIX}{path}"
        return requests.get(
            url,
            headers=self._auth_headers(),
            params=params,
            verify=self.verify_ssl,
            timeout=60,
        )

    # ─── test_connection ─────────────────────────────────────────────

    def test_connection(self) -> ConnectionTestResult:
        try:
            resp = self._get("/system/status")
            if resp.status_code == 200:
                body = resp.json() or {}
                data = body.get("data") or {}
                return ConnectionTestResult(
                    success=True,
                    message="Connected to SentinelOne.",
                    server_version=data.get("health") or data.get("status"),
                )
            if resp.status_code in (401, 403):
                return ConnectionTestResult(
                    success=False,
                    message=("SentinelOne rejected the request "
                             f"({resp.status_code}) — invalid or expired API token."),
                )
            return ConnectionTestResult(
                success=False,
                message=f"SentinelOne /system/status returned "
                        f"{resp.status_code}: {resp.text[:200]}",
            )
        except Exception as exc:
            logger.exception("SentinelOne test_connection failed")
            return ConnectionTestResult(success=False, message=str(exc))

    # ─── fetch_events ────────────────────────────────────────────────

    def fetch_events(
        self,
        *,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[SecurityEvent]:
        # SentinelOne caps threats page size at 1000; keep one page.
        params: Dict[str, Any] = {
            "limit": max(1, min(limit, 1000)),
            "sortBy": "createdAt",
            "sortOrder": "desc",
        }
        if since:
            params["createdAt__gte"] = (
                since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
            )

        resp = self._get("/threats", params=params)
        if resp.status_code != 200:
            # Never echo headers — the API token lives there, not in the body.
            raise RuntimeError(
                f"SentinelOne threats query failed "
                f"({resp.status_code}): {resp.text[:300]}"
            )

        events: List[SecurityEvent] = []
        for threat in (resp.json() or {}).get("data") or []:
            event = _threat_to_event(threat)
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


def _severity(info: Dict[str, Any]) -> str:
    verdict = str(info.get("analystVerdict") or "").lower()
    if verdict in _VERDICT_SEV:
        return _VERDICT_SEV[verdict]
    confidence = str(info.get("confidenceLevel") or "").lower()
    return _CONFIDENCE_SEV.get(confidence, "info")


def _threat_to_event(threat: Dict[str, Any]) -> Optional[SecurityEvent]:
    info = threat.get("threatInfo") or {}
    agent = threat.get("agentRealtimeInfo") or {}

    threat_id = threat.get("id") or info.get("threatId")
    name = (info.get("threatName")
            or info.get("classification")
            or "sentinelone_threat")
    host = agent.get("agentComputerName") or agent.get("agentName")
    ip = agent.get("agentIp") or agent.get("externalIp")

    return SecurityEvent(
        source_event_id=str(
            threat_id or _parse_ts(info.get("createdAt")).isoformat()
        ),
        timestamp=_parse_ts(info.get("createdAt") or threat.get("createdAt")),
        severity=_severity(info),
        rule_name=name,
        cve_ids=[],  # SentinelOne threats are behaviour/signature-based, not CVE-tagged
        affected_host=host,
        affected_ip=ip,
        message=info.get("threatName") or info.get("classification"),
        raw=threat,
    )


META = ProviderMeta(
    provider="sentinelone",
    label="SentinelOne",
    category="edr",
    description="Pull recent endpoint threats from the SentinelOne Singularity console. Malicious detections on hosts in the asset register surface as active-threat signals.",
    auth_method="api_key",
    fields=[
        ProviderField(key="console_url", label="Management Console URL", kind="url",
                      placeholder="https://<your-tenant>.sentinelone.net",
                      help_text="Your SentinelOne management console base URL.",
                      required=True,
                      is_credential=False),
        ProviderField(key="api_token", label="API Token",
                      kind="password", required=True,
                      help_text="Service-user or console API token. Sent as "
                                "'Authorization: ApiToken <token>'. Needs threats "
                                "read access."),
    ],
    adapter_cls=SentinelOneAdapter,
    docs_url="https://<your-tenant>.sentinelone.net/api-doc/overview",
)
