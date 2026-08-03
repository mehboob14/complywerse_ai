"""IBM QRadar adapter — SIEM inbound.

Pulls offenses + recent events via the QRadar REST API
(`/api/siem/offenses`, `/api/ariel/searches`). Beta — verify the AQL
query and offense schema against your QRadar build before promoting
to scheduled sync.

Auth: SEC token issued via the QRadar admin UI, sent as `SEC: <token>`.
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


class QRadarAdapter(SiemAdapter):
    provider = "qradar"

    def _headers(self) -> Dict[str, str]:
        token = self.credentials.get("sec_token")
        if not token:
            raise RuntimeError("QRadar credentials missing sec_token")
        return {
            "SEC": token,
            "Accept": "application/json",
            "Version": self.config.get("api_version", "16.0"),
        }

    def test_connection(self) -> ConnectionTestResult:
        try:
            resp = requests.get(
                f"{self.console_url}/api/system/about",
                headers=self._headers(),
                verify=self.verify_ssl,
                timeout=20,
            )
            if resp.status_code == 200:
                body = resp.json()
                return ConnectionTestResult(
                    success=True,
                    message="QRadar reachable (beta).",
                    server_version=body.get("release_name"),
                )
            return ConnectionTestResult(
                success=False,
                message=f"QRadar /api/system/about returned {resp.status_code}",
            )
        except Exception as exc:
            return ConnectionTestResult(success=False, message=str(exc))

    def fetch_events(
        self,
        *,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[SecurityEvent]:
        params: Dict[str, Any] = {"Range": f"items=0-{limit - 1}"}
        flt = ["status=OPEN"]
        if since:
            flt.append(f"last_updated_time>={int(since.timestamp()*1000)}")
        params["filter"] = " AND ".join(flt)
        resp = requests.get(
            f"{self.console_url}/api/siem/offenses",
            headers=self._headers(),
            params=params,
            verify=self.verify_ssl,
            timeout=60,
        )
        if resp.status_code not in (200, 206):
            raise RuntimeError(
                f"QRadar /siem/offenses failed ({resp.status_code}): {resp.text[:200]}"
            )
        events: List[SecurityEvent] = []
        for it in resp.json() or []:
            sev = _qradar_sev(it.get("severity"))
            events.append(SecurityEvent(
                source_event_id=str(it.get("id")),
                timestamp=_ms_to_dt(it.get("last_updated_time")),
                severity=sev,
                rule_name=it.get("description") or "qradar_offense",
                cve_ids=[],  # QRadar doesn't surface CVE on offense; pull via rule custom prop if configured
                affected_host=it.get("offense_source"),
                affected_ip=None,
                message=it.get("offense_type"),
                raw=it,
            ))
        return events


def _qradar_sev(level: Any) -> str:
    try:
        lvl = int(level)
    except Exception:
        return "info"
    if lvl >= 9:  return "critical"
    if lvl >= 7:  return "high"
    if lvl >= 4:  return "medium"
    return "low"


def _ms_to_dt(value: Any) -> datetime:
    try:
        return datetime.fromtimestamp(float(value) / 1000, tz=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


META = ProviderMeta(
    provider="qradar",
    label="IBM QRadar",
    category="siem",
    description="Pull open offenses from QRadar. High-severity offenses tagged with hostnames matching the asset register surface as exploitation signals. Beta.",
    auth_method="token",
    fields=[
        ProviderField(key="console_url", label="QRadar console URL",
                      kind="url", placeholder="https://qradar.example.com",
                      is_credential=False),
        ProviderField(key="sec_token", label="SEC token",
                      kind="password", required=True),
        ProviderField(key="api_version", label="API version",
                      kind="text", required=False, placeholder="16.0",
                      is_credential=False),
    ],
    adapter_cls=QRadarAdapter,
    beta=True,
    docs_url="https://www.ibm.com/docs/en/qsip/7.5?topic=overview-rest-api",
)
