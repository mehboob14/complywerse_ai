"""Splunk Enterprise / Splunk Cloud adapter — SIEM inbound.

Uses the Splunk REST search API with a saved or ad-hoc SPL query to
pull alerts whose semantics map to "this CVE is being exploited
in your environment right now".

Recommended SPL (configurable per tenant via `provider_config['spl_query']`):

    index=main sourcetype=stash | search "CVE-*"
    | stats latest(_time) as ts, values(cve) as cves, count by host

When the canonical SPL is not configured, defaults to a vulnerability-
ish dashboard query that requires the user has Splunk ES installed:

    `notable` | search severity!=informational
    | head 500

Auth: API token (Splunk recommends `Authorization: Bearer <token>`)
or username/password. Token preferred.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

from ..base import ConnectionTestResult, SecurityEvent, SiemAdapter
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)


_SEV_MAP = {
    "critical": "critical",
    "high": "high",
    "medium": "medium",
    "low": "low",
    "informational": "info",
    "info": "info",
}


class SplunkAdapter(SiemAdapter):
    provider = "splunk"

    def _auth_headers(self) -> Dict[str, str]:
        token = self.credentials.get("api_token")
        if token:
            return {"Authorization": f"Bearer {token}"}
        return {}

    def _auth(self):
        token = self.credentials.get("api_token")
        if token:
            return None
        return (self.credentials.get("username"), self.credentials.get("password"))

    def _spl(self) -> str:
        return (
            self.config.get("spl_query")
            or "search index=main `notable` | search severity!=informational | head 500"
        )

    def test_connection(self) -> ConnectionTestResult:
        try:
            url = f"{self.console_url}/services/server/info"
            resp = requests.get(
                url,
                params={"output_mode": "json"},
                auth=self._auth(),
                headers=self._auth_headers(),
                verify=self.verify_ssl,
                timeout=20,
            )
            if resp.status_code == 200:
                body = resp.json()
                entry = (body.get("entry") or [{}])[0]
                content = entry.get("content") or {}
                return ConnectionTestResult(
                    success=True,
                    message="Connected to Splunk.",
                    server_version=content.get("version"),
                    details={"build": content.get("build")},
                )
            return ConnectionTestResult(
                success=False,
                message=f"Splunk returned {resp.status_code}: {resp.text[:200]}",
            )
        except Exception as exc:
            logger.exception("Splunk test_connection failed")
            return ConnectionTestResult(success=False, message=str(exc))

    def fetch_events(
        self,
        *,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[SecurityEvent]:
        spl = self._spl()
        if since:
            # Splunk earliest=epoch
            spl = f"{spl} | where _time>={int(since.timestamp())}"
        spl = f"{spl} | head {limit}"

        resp = requests.post(
            f"{self.console_url}/services/search/jobs/export",
            data={"search": spl, "output_mode": "json", "earliest_time": "-7d"},
            auth=self._auth(),
            headers=self._auth_headers(),
            verify=self.verify_ssl,
            timeout=60,
            stream=False,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Splunk search failed ({resp.status_code}): {resp.text[:300]}"
            )

        events: List[SecurityEvent] = []
        for line in resp.text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                import json
                row = json.loads(line)
            except Exception:
                continue
            result = row.get("result") or row
            if not isinstance(result, dict):
                continue
            event = _row_to_event(result)
            if event:
                events.append(event)
        return events


def _row_to_event(row: Dict[str, Any]) -> Optional[SecurityEvent]:
    sev = (row.get("severity") or "info").lower()
    ts = row.get("_time") or row.get("time")
    try:
        ts_dt = (
            datetime.fromtimestamp(float(ts), tz=timezone.utc)
            if ts is not None else datetime.now(timezone.utc)
        )
    except Exception:
        ts_dt = datetime.now(timezone.utc)

    cves = row.get("cve") or row.get("cves") or row.get("CVE") or []
    if isinstance(cves, str):
        cves = [cves]
    cves = [c for c in cves if isinstance(c, str)]

    return SecurityEvent(
        source_event_id=str(row.get("_cd") or row.get("event_id") or row.get("source") or ts_dt.isoformat()),
        timestamp=ts_dt,
        severity=_SEV_MAP.get(sev, "info"),
        rule_name=row.get("rule_name") or row.get("search_name") or row.get("source") or "splunk_event",
        cve_ids=cves,
        affected_host=row.get("host") or row.get("dest"),
        affected_ip=row.get("src") or row.get("src_ip") or row.get("dest_ip"),
        message=row.get("_raw") or row.get("message"),
        raw=row,
    )


META = ProviderMeta(
    provider="splunk",
    label="Splunk",
    category="siem",
    description="Pull notable alerts and CVE-tagged events from Splunk Enterprise or Splunk Cloud. Active-exploitation signals enrich vuln priority.",
    auth_method="token",
    fields=[
        ProviderField(key="console_url", label="Splunk REST URL", kind="url",
                      placeholder="https://splunk.example.com:8089",
                      help_text="Splunk management port (default 8089).",
                      is_credential=False),
        ProviderField(key="api_token", label="API token (preferred)",
                      kind="password", required=False,
                      help_text="HEC or REST API token. Leave blank to use username/password."),
        ProviderField(key="username", label="Username (fallback)",
                      kind="text", required=False),
        ProviderField(key="password", label="Password (fallback)",
                      kind="password", required=False),
        ProviderField(key="spl_query", label="SPL query",
                      kind="textarea", required=False,
                      placeholder="search index=main `notable` | head 500",
                      help_text="SPL that returns the events to ingest. Each row is one event.",
                      is_credential=False),
    ],
    adapter_cls=SplunkAdapter,
    docs_url="https://docs.splunk.com/Documentation/Splunk/latest/RESTREF",
)
