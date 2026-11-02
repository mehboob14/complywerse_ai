"""Okta adapter — identity inbound.

Pulls Okta System Log events (sign-ins, MFA challenges, policy and
lifecycle changes) and maps them to normalised SecurityEvents, so
identity signals — brute-force sign-ins, MFA resets, admin policy
changes — enrich the same evidence stream the SIEM adapters feed.

Modeled as a SiemAdapter: the System Log is an event feed, one row per
LogEvent, exactly the shape `fetch_events` already expects.

console_url is the Okta org, e.g. https://acme.okta.com — a provider
field (not a credential).

Auth: an Okta API token sent as `Authorization: SSWS <token>` on every
request. The token's admin role must have read access to the System Log
(a read-only admin is enough).

System Log API: GET {console_url}/api/v1/logs?limit=&since=<iso8601>.
Docs: https://developer.okta.com/docs/reference/api/system-log/
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import requests

from ..base import ConnectionTestResult, SecurityEvent, SiemAdapter
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)

# Okta LogEvent.severity is one of DEBUG / INFO / WARN / ERROR.
_SEV_MAP = {
    "DEBUG": "info",
    "INFO": "info",
    "WARN": "medium",
    "ERROR": "high",
}


class OktaAdapter(SiemAdapter):
    provider = "okta"

    def _auth_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"SSWS {self.credentials.get('api_token', '')}",
            "Accept": "application/json",
        }

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> requests.Response:
        return requests.get(
            f"{self.console_url}{path}",
            headers=self._auth_headers(),
            params=params,
            verify=self.verify_ssl,
            timeout=60,
        )

    # ─── test_connection ────────────────────────────────────────────

    def test_connection(self) -> ConnectionTestResult:
        try:
            resp = self._get("/api/v1/logs", params={"limit": 1})
            if resp.status_code == 200:
                return ConnectionTestResult(success=True, message="Connected to Okta.")
            if resp.status_code == 401:
                return ConnectionTestResult(
                    success=False,
                    message="Okta rejected the API token (401) — invalid API token.",
                )
            if resp.status_code == 403:
                return ConnectionTestResult(
                    success=False,
                    message=("Authenticated, but the API token's admin role lacks "
                             "read access to the System Log (403)."),
                )
            # Never echo response bodies verbatim beyond a short tail — logs can
            # carry user data; the token is only ever in the request header.
            return ConnectionTestResult(
                success=False,
                message=f"Okta /api/v1/logs returned {resp.status_code}: {resp.text[:200]}",
            )
        except Exception as exc:
            logger.exception("Okta test_connection failed")
            return ConnectionTestResult(success=False, message=str(exc))

    # ─── fetch_events ───────────────────────────────────────────────

    def fetch_events(
        self,
        *,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[SecurityEvent]:
        # Okta caps page size at 1000; keep our contract's 1..limit window.
        params: Dict[str, Any] = {"limit": max(1, min(limit, 1000))}
        if since:
            params["since"] = since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

        resp = self._get("/api/v1/logs", params=params)
        if resp.status_code != 200:
            raise RuntimeError(
                f"Okta System Log fetch failed ({resp.status_code}): {resp.text[:300]}"
            )

        body = resp.json()
        if not isinstance(body, list):
            return []

        events: List[SecurityEvent] = []
        for row in body[:limit]:
            if isinstance(row, dict):
                events.append(_log_to_event(row))
        return events


def _parse_ts(value: Any) -> datetime:
    if isinstance(value, str) and value:
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except Exception:
            pass
    return datetime.now(timezone.utc)


def _log_to_event(row: Dict[str, Any]) -> SecurityEvent:
    client = row.get("client") or {}
    ip = client.get("ipAddress") if isinstance(client, dict) else None

    return SecurityEvent(
        source_event_id=str(row.get("uuid") or _parse_ts(row.get("published")).isoformat()),
        timestamp=_parse_ts(row.get("published")),
        severity=_SEV_MAP.get(str(row.get("severity") or "").upper(), "info"),
        rule_name=row.get("eventType") or "okta_log_event",
        cve_ids=[],  # identity events carry no CVE
        affected_host=None,
        affected_ip=ip,
        message=row.get("displayMessage"),
        raw=row,
    )


META = ProviderMeta(
    provider="okta",
    label="Okta",
    category="identity",
    description="Pull Okta System Log events (sign-ins, MFA, policy and lifecycle changes) as identity evidence. Suspicious sign-in and admin-change signals enrich the security event stream.",
    auth_method="token",
    fields=[
        ProviderField(key="console_url", label="Okta Org URL", kind="url",
                      placeholder="https://<your-org>.okta.com",
                      help_text="Your Okta org base URL, e.g. https://acme.okta.com.",
                      is_credential=False),
        ProviderField(key="api_token", label="API Token",
                      kind="password", required=True,
                      help_text="Okta API token (Security → API → Tokens). The token's "
                                "admin role needs read access to the System Log. Sent as "
                                "`Authorization: SSWS <token>`."),
    ],
    adapter_cls=OktaAdapter,
    docs_url="https://developer.okta.com/docs/reference/api/system-log/",
)
