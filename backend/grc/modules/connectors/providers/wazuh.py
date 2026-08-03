"""Wazuh adapter — SIEM inbound.

Pulls security alerts from Wazuh API (`/security`/`/alerts` or v4
`/agents/...` endpoints). Beta — `fetch_events()` shape is calibrated
against Wazuh 4.x default schemas but custom decoders may produce
fields this adapter doesn't yet flatten.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

from ..base import ConnectionTestResult, SecurityEvent, SiemAdapter
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)


class WazuhAdapter(SiemAdapter):
    provider = "wazuh"

    def _token(self) -> str:
        token = self.oauth_tokens.get("jwt")
        if token:
            return token
        user = self.credentials.get("username") or "wazuh"
        pwd = self.credentials.get("password")
        if not pwd:
            raise RuntimeError("Wazuh credentials missing password")
        resp = requests.post(
            f"{self.console_url}/security/user/authenticate",
            auth=(user, pwd),
            verify=self.verify_ssl,
            timeout=20,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Wazuh auth failed ({resp.status_code}): {resp.text[:200]}"
            )
        token = resp.json().get("data", {}).get("token")
        if not token:
            raise RuntimeError("Wazuh auth returned no token")
        self.oauth_tokens["jwt"] = token
        return token

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"Bearer {self._token()}"}

    def test_connection(self) -> ConnectionTestResult:
        try:
            resp = requests.get(
                f"{self.console_url}/",
                headers=self._headers(),
                verify=self.verify_ssl,
                timeout=20,
            )
            if resp.status_code == 200:
                api_version = (resp.json().get("data") or {}).get("api_version")
                return ConnectionTestResult(
                    success=True,
                    message="Wazuh manager reachable (beta).",
                    server_version=str(api_version) if api_version else None,
                )
            return ConnectionTestResult(
                success=False,
                message=f"Wazuh returned {resp.status_code}: {resp.text[:200]}",
            )
        except Exception as exc:
            return ConnectionTestResult(success=False, message=str(exc))

    def fetch_events(
        self,
        *,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[SecurityEvent]:
        # Wazuh stores alerts in Elasticsearch/Indexer; the REST API
        # exposes `/manager/api/...` and `/alerts` depending on version.
        # Beta path uses /alerts which exists on Indexer-fronted deployments.
        params: Dict[str, Any] = {"limit": min(limit, 500)}
        if since:
            params["timestamp"] = f">={since.isoformat()}"
        resp = requests.get(
            f"{self.console_url}/alerts",
            headers=self._headers(),
            params=params,
            verify=self.verify_ssl,
            timeout=60,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Wazuh /alerts failed ({resp.status_code}): {resp.text[:200]}"
            )
        items = (resp.json().get("data") or {}).get("affected_items") or []
        events: List[SecurityEvent] = []
        for it in items:
            rule = it.get("rule") or {}
            sev = _sev_from_level(rule.get("level"))
            events.append(SecurityEvent(
                source_event_id=str(it.get("id") or it.get("timestamp")),
                timestamp=_parse_ts(it.get("timestamp")),
                severity=sev,
                rule_name=rule.get("description") or "wazuh_alert",
                cve_ids=list(rule.get("cve") or []),
                affected_host=(it.get("agent") or {}).get("name"),
                affected_ip=(it.get("agent") or {}).get("ip"),
                message=it.get("full_log") or it.get("description"),
                raw=it,
            ))
        return events


def _sev_from_level(level: Any) -> str:
    try:
        lvl = int(level)
    except Exception:
        return "info"
    if lvl >= 13: return "critical"
    if lvl >= 10: return "high"
    if lvl >= 7:  return "medium"
    if lvl >= 4:  return "low"
    return "info"


def _parse_ts(value: Any) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return datetime.now(timezone.utc)


META = ProviderMeta(
    provider="wazuh",
    label="Wazuh",
    category="siem",
    description="Open-source XDR/SIEM. Pull alerts and correlate active exploitation against vulnerabilities. Beta.",
    auth_method="basic",
    fields=[
        ProviderField(key="console_url", label="Wazuh API URL",
                      kind="url", placeholder="https://wazuh.example.com:55000",
                      is_credential=False),
        ProviderField(key="username", label="Username",
                      kind="text", required=False, placeholder="wazuh"),
        ProviderField(key="password", label="Password",
                      kind="password", required=True),
    ],
    adapter_cls=WazuhAdapter,
    beta=True,
    docs_url="https://documentation.wazuh.com/current/user-manual/api/reference.html",
)
