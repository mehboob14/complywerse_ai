"""Microsoft Defender for Endpoint adapter — EDR inbound.

Pulls recent alerts from Microsoft Defender for Endpoint (MDE, the
endpoint EDR — NOT Defender for Cloud) and maps them to normalised
SecurityEvents so active-endpoint-threat signals enrich vuln priority,
the same way the SIEM adapters and the CrowdStrike adapter do.

Auth: Azure AD OAuth2 client-credentials. POST
    https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token
with grant_type=client_credentials, client_id, client_secret and
scope=https://api.securitycenter.microsoft.com/.default returns a bearer
access_token that expires in ~1h; we cache it and refresh on expiry (or
on a 401).

API base defaults to https://api.securitycenter.microsoft.com (the MDE
API). The Azure AD app registration must have the **Alert.Read.All**
application permission (admin-consented), otherwise /api/alerts returns 403.
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

_DEFAULT_API_BASE = "https://api.securitycenter.microsoft.com"
_SCOPE = "https://api.securitycenter.microsoft.com/.default"
_TOKEN_SKEW_SECONDS = 60  # refresh a minute before the real expiry

# MDE alert.severity is a string; map to our bands.
_SEV_WORDS = {
    "informational": "info",
    "information": "info",
    "info": "info",
    "low": "low",
    "medium": "medium",
    "high": "high",
    "critical": "critical",
}


class DefenderAdapter(SiemAdapter):
    provider = "defender"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._token: Optional[str] = None
        self._token_expiry: float = 0.0  # epoch seconds

    # ─── base url + auth ────────────────────────────────────────────

    def _base_url(self) -> str:
        base = (self.config.get("api_base") or self.console_url or _DEFAULT_API_BASE)
        return base.rstrip("/")

    def _get_token(self, *, force: bool = False) -> str:
        if not force and self._token and time.time() < self._token_expiry:
            return self._token

        tenant_id = self.config.get("tenant_id") or self.credentials.get("tenant_id")
        client_id = self.credentials.get("client_id")
        client_secret = self.credentials.get("client_secret")
        if not tenant_id or not client_id or not client_secret:
            raise RuntimeError(
                "Microsoft Defender credentials missing tenant_id / client_id / client_secret"
            )

        resp = requests.post(
            f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": _SCOPE,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            verify=self.verify_ssl,
            timeout=20,
        )
        if resp.status_code != 200:
            # Never echo the request body — it carries the client secret.
            raise RuntimeError(
                f"Microsoft Defender OAuth token request failed ({resp.status_code}): "
                f"{resp.text[:200]}"
            )
        body = resp.json()
        token = body.get("access_token")
        if not token:
            raise RuntimeError("Microsoft Defender OAuth response had no access_token")
        self._token = token
        self._token_expiry = time.time() + float(body.get("expires_in", 3600)) - _TOKEN_SKEW_SECONDS
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

    # ─── test_connection ────────────────────────────────────────────

    def test_connection(self) -> ConnectionTestResult:
        try:
            self._get_token(force=True)  # proves the OAuth creds work
        except Exception as exc:
            logger.exception("Microsoft Defender token request failed")
            return ConnectionTestResult(success=False, message=str(exc))

        try:
            resp = self._get("/api/alerts", params={"$top": 1})
            if resp.status_code == 200:
                return ConnectionTestResult(
                    success=True,
                    message="Connected to Microsoft Defender for Endpoint.",
                )
            if resp.status_code == 403:
                return ConnectionTestResult(
                    success=False,
                    message=("Authenticated, but the Azure AD app is missing the "
                             "Alert.Read.All application permission (403). Add it and "
                             "grant admin consent in the Azure portal → App registrations "
                             "→ API permissions."),
                )
            return ConnectionTestResult(
                success=False,
                message=f"Microsoft Defender /api/alerts returned "
                        f"{resp.status_code}: {resp.text[:200]}",
            )
        except Exception as exc:
            logger.exception("Microsoft Defender test_connection failed")
            return ConnectionTestResult(success=False, message=str(exc))

    # ─── fetch_events ───────────────────────────────────────────────

    def fetch_events(
        self,
        *,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[SecurityEvent]:
        params: Dict[str, Any] = {
            "$top": max(1, min(limit, 500)),
            "$orderby": "alertCreationTime desc",
        }
        if since:
            # OData: alertCreationTime is an ISO-8601 timestamp.
            ts = since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            params["$filter"] = f"alertCreationTime gt {ts}"

        resp = self._get("/api/alerts", params=params)
        if resp.status_code != 200:
            raise RuntimeError(
                f"Microsoft Defender alerts query failed ({resp.status_code}): "
                f"{resp.text[:300]}"
            )
        alerts = resp.json().get("value") or []

        events: List[SecurityEvent] = []
        for alert in alerts:
            event = _alert_to_event(alert)
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


def _severity(alert: Dict[str, Any]) -> str:
    word = alert.get("severity")
    if isinstance(word, str) and word.lower() in _SEV_WORDS:
        return _SEV_WORDS[word.lower()]
    return "info"


def _first_entity_ip(alert: Dict[str, Any]) -> Optional[str]:
    for entity in alert.get("entities") or []:
        if isinstance(entity, dict):
            ip = entity.get("ip") or entity.get("ipAddress")
            if ip:
                return ip
    return None


def _alert_to_event(alert: Dict[str, Any]) -> Optional[SecurityEvent]:
    alert_id = alert.get("id")
    return SecurityEvent(
        source_event_id=str(alert_id or _parse_ts(alert.get("alertCreationTime")).isoformat()),
        timestamp=_parse_ts(alert.get("alertCreationTime")),
        severity=_severity(alert),
        rule_name=alert.get("title") or "defender_alert",
        cve_ids=[],  # MDE alerts are detection-based; no CVE on the alert
        affected_host=alert.get("computerDnsName"),
        affected_ip=_first_entity_ip(alert),
        message=alert.get("description"),
        raw=alert,
    )


META = ProviderMeta(
    provider="defender",
    label="Microsoft Defender for Endpoint",
    category="edr",
    description="Pull recent endpoint alerts from Microsoft Defender for Endpoint (MDE). High-severity alerts on hosts in the asset register surface as active-threat signals.",
    auth_method="oauth2",
    fields=[
        ProviderField(key="api_base", label="MDE API Base URL", kind="url",
                      placeholder="https://api.securitycenter.microsoft.com",
                      help_text="Defender for Endpoint API base URL. Leave as the "
                                "default unless your tenant uses a regional endpoint.",
                      required=False,
                      is_credential=False),
        ProviderField(key="tenant_id", label="Azure AD Tenant ID",
                      kind="text", required=True, is_credential=False,
                      help_text="Directory (tenant) ID of the Azure AD app registration."),
        ProviderField(key="client_id", label="Application (Client) ID",
                      kind="text", required=True,
                      help_text="Application (client) ID of the Azure AD app registration."),
        ProviderField(key="client_secret", label="Client Secret",
                      kind="password", required=True,
                      help_text="Client secret value for the app registration (shown once on creation)."),
    ],
    adapter_cls=DefenderAdapter,
    oauth_scopes=["Alert.Read.All"],
    docs_url="https://learn.microsoft.com/en-us/defender-endpoint/api/exposed-apis-list",
)
