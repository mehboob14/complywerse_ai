"""Office 365 / Microsoft 365 adapter — collaboration via Graph.

Subset of the MS Teams adapter that targets calendar + Outlook
notifications. Useful when the tenant wants meeting invites and email
notifications but not Teams channel posts.

Beta — auth path is identical to `msteams.py` (Azure AD app
registration, client-credentials flow). Wire scopes:
  * Calendars.ReadWrite
  * Mail.Send
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests

from ..base import (
    CollabAdapter,
    CollabMessage,
    ConnectionTestResult,
    MeetingRequest,
)
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"


class Office365Adapter(CollabAdapter):
    provider = "office365"

    def _access_token(self) -> str:
        token = self.oauth_tokens.get("access_token")
        expires_at = self.oauth_tokens.get("expires_at")
        if token and (expires_at is None or expires_at > _now_ts() + 60):
            return token
        tenant_id = self.config.get("ms_tenant_id")
        client_id = self.credentials.get("client_id")
        client_secret = self.credentials.get("client_secret")
        if not (tenant_id and client_id and client_secret):
            raise RuntimeError("Office 365 missing tenant/client_id/client_secret")
        token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
        resp = requests.post(token_url, data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "https://graph.microsoft.com/.default",
        }, timeout=30)
        if resp.status_code != 200:
            raise RuntimeError(
                f"O365 OAuth failed ({resp.status_code}): {resp.text[:200]}"
            )
        body = resp.json()
        self.oauth_tokens["access_token"] = body["access_token"]
        self.oauth_tokens["expires_at"] = _now_ts() + int(body.get("expires_in", 3600))
        return body["access_token"]

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        headers = kwargs.pop("headers", {}) or {}
        headers["Authorization"] = f"Bearer {self._access_token()}"
        headers.setdefault("Content-Type", "application/json")
        url = path if path.startswith("http") else f"{GRAPH_BASE}{path}"
        return requests.request(method, url, headers=headers, timeout=30, **kwargs)

    def test_connection(self) -> ConnectionTestResult:
        try:
            resp = self._request("GET", "/organization")
            if resp.status_code == 200:
                return ConnectionTestResult(
                    success=True,
                    message="Office 365 / Graph reachable (beta).",
                )
            return ConnectionTestResult(
                success=False,
                message=f"Graph /organization returned {resp.status_code}",
            )
        except Exception as exc:
            return ConnectionTestResult(success=False, message=str(exc))

    def send_message(self, channel_id: str, message: CollabMessage) -> str:
        """`channel_id` is interpreted as an email recipient for the O365
        adapter. Sends via `/users/<from>/sendMail`."""
        sender = self.config.get("notification_sender_upn")
        if not sender:
            raise RuntimeError("O365 provider_config missing notification_sender_upn")
        resp = self._request(
            "POST",
            f"/users/{sender}/sendMail",
            json={
                "message": {
                    "subject": message.title,
                    "body": {"contentType": "HTML", "content": _format_email_body(message)},
                    "toRecipients": [{"emailAddress": {"address": channel_id}}],
                    "importance": "high" if message.severity == "critical" else "normal",
                },
                "saveToSentItems": True,
            },
        )
        if resp.status_code not in (202, 200):
            raise RuntimeError(
                f"O365 sendMail failed ({resp.status_code}): {resp.text[:200]}"
            )
        return f"mailto:{channel_id}"

    def schedule_meeting(self, request: MeetingRequest) -> Dict[str, Any]:
        organiser = self.config.get("organiser_upn")
        if not organiser:
            raise RuntimeError("O365 provider_config missing organiser_upn")
        end = request.start_at + timedelta(minutes=request.duration_minutes)
        resp = self._request(
            "POST",
            f"/users/{organiser}/events",
            json={
                "subject": request.subject,
                "body": {"contentType": "HTML", "content": request.body},
                "start": {"dateTime": request.start_at.isoformat(), "timeZone": "UTC"},
                "end":   {"dateTime": end.isoformat(),           "timeZone": "UTC"},
                "attendees": [
                    {"emailAddress": {"address": e, "name": e}, "type": "required"}
                    for e in (request.attendee_emails or [])
                ],
                "isOnlineMeeting": True,
                "onlineMeetingProvider": "teamsForBusiness",
            },
        )
        if resp.status_code not in (200, 201):
            raise RuntimeError(
                f"O365 create_event failed ({resp.status_code}): {resp.text[:200]}"
            )
        body = resp.json()
        return {
            "join_url": (body.get("onlineMeeting") or {}).get("joinUrl"),
            "meeting_id": body.get("id"),
            "raw": body,
        }

    def list_recent_recordings(self, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        # O365 doesn't expose recordings via the calendar surface — these
        # land in Stream / Teams. Use the MS Teams adapter for recording
        # pickup instead.
        return []


def _format_email_body(message: CollabMessage) -> str:
    html = f"<h2>{message.title}</h2><p>{message.body_markdown}</p>"
    if message.link_url:
        html += f'<p><a href="{message.link_url}">View in GRC</a></p>'
    return html


def _now_ts() -> int:
    return int(datetime.now(timezone.utc).timestamp())


META = ProviderMeta(
    provider="office365",
    label="Office 365 / Outlook",
    category="collab",
    description="Send email notifications and create calendar invites (with Teams meeting link). Beta — wire app permissions Calendars.ReadWrite + Mail.Send.",
    auth_method="oauth2",
    fields=[
        ProviderField(key="ms_tenant_id", label="Azure AD tenant id",
                      kind="text", required=True, is_credential=False),
        ProviderField(key="client_id", label="Client id",
                      kind="text", required=True),
        ProviderField(key="client_secret", label="Client secret",
                      kind="password", required=True),
        ProviderField(key="organiser_upn", label="Organiser UPN",
                      kind="text", required=True,
                      help_text="Email/UPN of the user account that creates calendar invites.",
                      is_credential=False),
        ProviderField(key="notification_sender_upn", label="Notification sender UPN",
                      kind="text", required=False,
                      help_text="Email/UPN of the mailbox used for outbound alert emails.",
                      is_credential=False),
    ],
    adapter_cls=Office365Adapter,
    beta=True,
    docs_url="https://learn.microsoft.com/en-us/graph/api/overview",
)
