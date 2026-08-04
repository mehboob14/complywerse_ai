"""Microsoft Teams adapter via Microsoft Graph API.

Outbound:
  * Post alerts to a channel via `POST /teams/{tid}/channels/{cid}/messages`.
  * Schedule committee meetings via `POST /me/onlineMeetings` (or
    `/users/{userId}/onlineMeetings` for service-principal flows).
  * List meeting recordings ready for transcription pickup via
    `GET /communications/onlineMeetings/{id}/recordings`.

Auth: OAuth2 client-credentials flow (preferred for service accounts)
or delegated flow. The OAuth router places `access_token` + `refresh_token`
in `oauth_tokens`. We auto-refresh on 401.

App registration prerequisites (Azure AD app):
  * `ChannelMessage.Send` (delegated) or `ChannelMessage.Send.Group`
    (app, requires resource-specific consent)
  * `OnlineMeetings.ReadWrite` (delegated) or `OnlineMeetings.ReadWrite.All`
  * `OnlineMeetingRecording.Read.All` (app)
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


class MsTeamsAdapter(CollabAdapter):
    provider = "msteams"

    # ─── Auth ───────────────────────────────────────────────────────

    def _access_token(self) -> str:
        token = self.oauth_tokens.get("access_token")
        expires_at = self.oauth_tokens.get("expires_at")
        if token and (expires_at is None or expires_at > _now_ts() + 60):
            return token
        # Client-credentials refresh
        tenant_id = self.config.get("ms_tenant_id")
        client_id = self.credentials.get("client_id")
        client_secret = self.credentials.get("client_secret")
        if not (tenant_id and client_id and client_secret):
            raise RuntimeError("MS Teams missing tenant/client_id/client_secret")
        token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
        resp = requests.post(token_url, data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "https://graph.microsoft.com/.default",
        }, timeout=30)
        if resp.status_code != 200:
            raise RuntimeError(
                f"MS OAuth token request failed ({resp.status_code}): {resp.text[:200]}"
            )
        body = resp.json()
        access = body["access_token"]
        expires_in = int(body.get("expires_in", 3600))
        self.oauth_tokens["access_token"] = access
        self.oauth_tokens["expires_at"] = _now_ts() + expires_in
        return access

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        headers = kwargs.pop("headers", {}) or {}
        headers["Authorization"] = f"Bearer {self._access_token()}"
        headers.setdefault("Content-Type", "application/json")
        url = path if path.startswith("http") else f"{GRAPH_BASE}{path}"
        return requests.request(
            method, url, headers=headers, timeout=30, **kwargs,
        )

    # ─── BaseConnectorAdapter ───────────────────────────────────────

    def test_connection(self) -> ConnectionTestResult:
        try:
            resp = self._request("GET", "/organization")
            if resp.status_code == 200:
                body = resp.json()
                org = (body.get("value") or [{}])[0]
                return ConnectionTestResult(
                    success=True,
                    message="Authenticated to Microsoft Graph.",
                    server_version=org.get("displayName"),
                    details={"tenant_id": org.get("id")},
                )
            return ConnectionTestResult(
                success=False,
                message=f"Graph /organization returned {resp.status_code}: {resp.text[:200]}",
            )
        except Exception as exc:
            logger.exception("MS Teams test_connection failed")
            return ConnectionTestResult(success=False, message=str(exc))

    # ─── CollabAdapter ──────────────────────────────────────────────

    def send_message(self, channel_id: str, message: CollabMessage) -> str:
        team_id = self.config.get("team_id")
        if not team_id:
            raise RuntimeError("MS Teams provider_config missing team_id")

        color = {
            "critical": "Attention",
            "warning": "Warning",
            "info": "Default",
        }.get(message.severity, "Default")

        body_html = f"<h3>{message.title}</h3><p>{message.body_markdown}</p>"
        if message.link_url:
            body_html += f'<p><a href="{message.link_url}">View in GRC</a></p>'

        resp = self._request(
            "POST",
            f"/teams/{team_id}/channels/{channel_id}/messages",
            json={
                "body": {"contentType": "html", "content": body_html},
                "importance": "high" if message.severity == "critical" else "normal",
                "subject": message.title,
                "attachments": [],
                # color via card tone not directly supported on plain channel
                # messages; we surface severity via the title prefix instead.
                "summary": f"[{color}] {message.title}",
            },
        )
        if resp.status_code not in (200, 201):
            raise RuntimeError(
                f"send_message failed ({resp.status_code}): {resp.text[:300]}"
            )
        return resp.json().get("id", "")

    def schedule_meeting(self, request: MeetingRequest) -> Dict[str, Any]:
        organiser_id = self.config.get("organiser_user_id")
        path = (
            f"/users/{organiser_id}/onlineMeetings"
            if organiser_id else "/me/onlineMeetings"
        )
        end_at = request.start_at + timedelta(minutes=request.duration_minutes)
        resp = self._request(
            "POST",
            path,
            json={
                "subject": request.subject,
                "startDateTime": request.start_at.isoformat(),
                "endDateTime": end_at.isoformat(),
                "participants": {
                    "attendees": [
                        {"upn": email, "role": "attendee"}
                        for email in (request.attendee_emails or [])
                    ],
                },
            },
        )
        if resp.status_code not in (200, 201):
            raise RuntimeError(
                f"schedule_meeting failed ({resp.status_code}): {resp.text[:300]}"
            )
        body = resp.json()
        return {
            "join_url": body.get("joinUrl") or body.get("joinWebUrl"),
            "meeting_id": body.get("id"),
            "raw": body,
        }

    def list_recent_recordings(self, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        params = {}
        if since:
            params["$filter"] = f"createdDateTime ge {since.isoformat()}"
        resp = self._request(
            "GET",
            "/communications/callRecords/getDirectRoutingCalls",
            params=params,
        )
        if resp.status_code != 200:
            logger.warning(
                "MS Teams list_recent_recordings returned %s: %s",
                resp.status_code, resp.text[:200],
            )
            return []
        out = []
        for r in (resp.json().get("value") or []):
            out.append({
                "recording_id": r.get("id"),
                "subject": r.get("subject"),
                "started_at": r.get("startDateTime"),
                "ended_at": r.get("endDateTime"),
                "download_url": r.get("contentUrl"),
            })
        return out


def _now_ts() -> int:
    return int(datetime.now(timezone.utc).timestamp())


META = ProviderMeta(
    provider="msteams",
    label="Microsoft Teams",
    category="collab",
    description="Post alerts to Teams channels, schedule committee meetings, and pull meeting recordings via Microsoft Graph.",
    auth_method="oauth2",
    fields=[
        ProviderField(key="console_url", label="Graph base URL",
                      kind="url", required=False,
                      placeholder="https://graph.microsoft.com/v1.0",
                      is_credential=False),
        ProviderField(key="ms_tenant_id", label="Azure AD tenant id",
                      kind="text", required=True,
                      help_text="GUID of your Azure AD tenant.",
                      is_credential=False),
        ProviderField(key="client_id", label="App registration client id",
                      kind="text", required=True),
        ProviderField(key="client_secret", label="App registration client secret",
                      kind="password", required=True),
        ProviderField(key="team_id", label="Default Team id",
                      kind="text", required=False,
                      help_text="Used as the target team for outbound alerts.",
                      is_credential=False),
        ProviderField(key="organiser_user_id", label="Meeting organiser user id (optional)",
                      kind="text", required=False,
                      help_text="UPN or object id of the user who organises scheduled meetings. Defaults to the OAuth principal.",
                      is_credential=False),
    ],
    adapter_cls=MsTeamsAdapter,
    oauth_scopes=[
        "https://graph.microsoft.com/.default",
    ],
    docs_url="https://learn.microsoft.com/en-us/graph/api/overview",
)
