"""Microsoft Entra ID (Azure AD) adapter — identity telemetry inbound.

Pulls recent sign-in records from the Microsoft Graph sign-in audit log
and maps them to normalised SecurityEvents, so risky / failed sign-ins on
the tenant surface as identity-risk evidence the same way the SIEM and
EDR adapters feed exploitation signals. Modeled as a SiemAdapter.

Auth: Azure AD OAuth2 client-credentials (identical shape to office365.py).
POST https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token with a
form-encoded grant_type=client_credentials / client_id / client_secret /
scope=https://graph.microsoft.com/.default returns a bearer access_token
that expires in ~60 min; we cache it and refresh on expiry (or on a 401),
mirroring the crowdstrike.py token cache.

The Azure AD app registration must have the **AuditLog.Read.All** APPLICATION
permission (admin-consented), and the tenant needs an Entra ID P1/P2 licence,
otherwise the sign-in log endpoint returns 403.
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

_GRAPH_BASE = "https://graph.microsoft.com/v1.0"
_LOGIN_BASE = "https://login.microsoftonline.com"
_TOKEN_SKEW_SECONDS = 60  # refresh a minute before the real expiry
_GRAPH_MAX_PAGE = 1000  # Graph signIns $top ceiling

# Entra risk levels → our severity bands.
_RISK_WORDS = {
    "high": "high",
    "medium": "medium",
    "low": "low",
    "none": "info",
    "hidden": "info",
    "unknownFutureValue": "info",
}


class EntraAdapter(SiemAdapter):
    provider = "entra"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._token: Optional[str] = None
        self._token_expiry: float = 0.0  # epoch seconds

    # ─── auth ───────────────────────────────────────────────────────

    def _get_token(self, *, force: bool = False) -> str:
        if not force and self._token and time.time() < self._token_expiry:
            return self._token

        tenant_id = self.credentials.get("tenant_id") or self.config.get("tenant_id")
        client_id = self.credentials.get("client_id")
        client_secret = self.credentials.get("client_secret")
        if not (tenant_id and client_id and client_secret):
            raise RuntimeError("Entra credentials missing tenant_id / client_id / client_secret")

        resp = requests.post(
            f"{_LOGIN_BASE}/{tenant_id}/oauth2/v2.0/token",
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": "https://graph.microsoft.com/.default",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            verify=self.verify_ssl,
            timeout=20,
        )
        if resp.status_code != 200:
            # Never echo the request body — it carries the client secret.
            raise RuntimeError(
                f"Entra OAuth token request failed ({resp.status_code}): "
                f"{resp.text[:200]}"
            )
        body = resp.json()
        token = body.get("access_token")
        if not token:
            raise RuntimeError("Entra OAuth response had no access_token")
        self._token = token
        self._token_expiry = time.time() + float(body.get("expires_in", 3600)) - _TOKEN_SKEW_SECONDS
        return token

    def _auth_headers(self, *, force_refresh: bool = False) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self._get_token(force=force_refresh)}",
            "Accept": "application/json",
        }

    def _get(self, path: str, params: Optional[Dict[str, Any]] = None) -> requests.Response:
        """GET Graph with a single token-refresh retry on 401."""
        url = path if path.startswith("http") else f"{_GRAPH_BASE}{path}"
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
            logger.exception("Entra token request failed")
            return ConnectionTestResult(success=False, message=str(exc))

        try:
            resp = self._get("/auditLogs/signIns", params={"$top": 1})
            if resp.status_code == 200:
                return ConnectionTestResult(
                    success=True,
                    message="Connected to Microsoft Entra ID (Graph sign-in logs).",
                )
            if resp.status_code == 403:
                return ConnectionTestResult(
                    success=False,
                    message=("Authenticated, but the app registration is missing the "
                             "AuditLog.Read.All application permission (403). Grant and "
                             "admin-consent it in Entra admin center → App registrations → "
                             "API permissions. Sign-in logs also require an Entra ID "
                             "P1/P2 licence."),
                )
            return ConnectionTestResult(
                success=False,
                message=f"Graph /auditLogs/signIns returned "
                        f"{resp.status_code}: {resp.text[:200]}",
            )
        except Exception as exc:
            logger.exception("Entra test_connection failed")
            return ConnectionTestResult(success=False, message=str(exc))

    # ─── fetch_events ───────────────────────────────────────────────

    def fetch_events(
        self,
        *,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[SecurityEvent]:
        params: Dict[str, Any] = {
            "$top": max(1, min(limit, _GRAPH_MAX_PAGE)),
            "$orderby": "createdDateTime desc",
        }
        if since:
            ts = since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            params["$filter"] = f"createdDateTime ge {ts}"

        resp = self._get("/auditLogs/signIns", params=params)
        if resp.status_code != 200:
            raise RuntimeError(
                f"Entra sign-in fetch failed ({resp.status_code}): {resp.text[:300]}"
            )
        rows = (resp.json().get("value") or [])[:limit]  # one page is enough

        events: List[SecurityEvent] = []
        for row in rows:
            event = _signin_to_event(row)
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


def _severity(row: Dict[str, Any]) -> str:
    # Prefer the Identity-Protection risk level; fall back to sign-in status.
    risk = row.get("riskLevelDuringSignIn") or row.get("riskLevelAggregated")
    if isinstance(risk, str) and risk.lower() in _RISK_WORDS:
        return _RISK_WORDS[risk.lower()]
    status = row.get("status") or {}
    try:
        code = int(status.get("errorCode"))
    except (TypeError, ValueError):
        return "info"
    if code == 0:
        return "info"  # successful sign-in
    # Any non-zero error code is a failed auth attempt.
    return "low"


def _signin_to_event(row: Dict[str, Any]) -> Optional[SecurityEvent]:
    status = row.get("status") or {}
    upn = row.get("userPrincipalName") or row.get("userDisplayName") or "unknown"
    reason = status.get("failureReason")
    app = row.get("appDisplayName")

    return SecurityEvent(
        source_event_id=str(row.get("id") or _parse_ts(row.get("createdDateTime")).isoformat()),
        timestamp=_parse_ts(row.get("createdDateTime")),
        severity=_severity(row),
        rule_name=app or "Entra sign-in",
        cve_ids=[],  # identity telemetry — no CVE
        affected_host=None,
        affected_ip=row.get("ipAddress"),
        message=f"{upn} — {reason or 'success'}",
        raw=row,
    )


META = ProviderMeta(
    provider="entra",
    label="Microsoft Entra ID",
    category="identity",
    description="Pull Entra ID (Azure AD) sign-in and risk telemetry from Microsoft Graph. "
                "Risky and failed sign-ins surface as identity-risk evidence. Requires the "
                "AuditLog.Read.All application permission and an Entra ID P1/P2 licence.",
    auth_method="oauth2",
    fields=[
        ProviderField(key="tenant_id", label="Azure AD tenant id",
                      kind="text", required=True, is_credential=False,
                      help_text="Directory (tenant) id of the Entra tenant to read sign-in logs from."),
        ProviderField(key="client_id", label="Client id",
                      kind="text", required=True,
                      help_text="Application (client) id of the Entra app registration."),
        ProviderField(key="client_secret", label="Client secret",
                      kind="password", required=True,
                      help_text="Client secret value from the app registration (shown once)."),
    ],
    adapter_cls=EntraAdapter,
    docs_url="https://learn.microsoft.com/en-us/graph/api/signin-list",
)
