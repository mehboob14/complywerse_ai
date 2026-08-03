"""Zoom adapter — collaboration / meeting scheduling.

Uses Zoom's Server-to-Server OAuth (account-credentials flow). Beta —
the meeting-scheduling and recording-pickup flows are wired against
Zoom's public v2 API; verify scopes match the app registered for this
tenant before promoting to production.
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

ZOOM_BASE = "https://api.zoom.us/v2"
ZOOM_OAUTH_URL = "https://zoom.us/oauth/token"


class ZoomAdapter(CollabAdapter):
    provider = "zoom"

    def _access_token(self) -> str:
        token = self.oauth_tokens.get("access_token")
        expires_at = self.oauth_tokens.get("expires_at")
        if token and (expires_at is None or expires_at > _now_ts() + 60):
            return token
        account_id = self.config.get("zoom_account_id")
        client_id = self.credentials.get("client_id")
        client_secret = self.credentials.get("client_secret")
        if not (account_id and client_id and client_secret):
            raise RuntimeError("Zoom missing account_id/client_id/client_secret")
        resp = requests.post(
            ZOOM_OAUTH_URL,
            params={"grant_type": "account_credentials", "account_id": account_id},
            auth=(client_id, client_secret),
            timeout=30,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Zoom OAuth failed ({resp.status_code}): {resp.text[:200]}"
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
        url = path if path.startswith("http") else f"{ZOOM_BASE}{path}"
        return requests.request(method, url, headers=headers, timeout=30, **kwargs)

    def test_connection(self) -> ConnectionTestResult:
        try:
            resp = self._request("GET", "/users/me")
            if resp.status_code == 200:
                return ConnectionTestResult(
                    success=True,
                    message="Zoom S2S auth OK (beta).",
                    details={"account_id": resp.json().get("account_id")},
                )
            return ConnectionTestResult(
                success=False,
                message=f"Zoom /users/me returned {resp.status_code}",
            )
        except Exception as exc:
            return ConnectionTestResult(success=False, message=str(exc))

    def send_message(self, channel_id: str, message: CollabMessage) -> str:
        """Zoom Team Chat — send a message to a channel."""
        resp = self._request(
            "POST",
            "/chat/users/me/messages",
            json={"message": f"**{message.title}**\n\n{message.body_markdown}",
                  "to_channel": channel_id},
        )
        if resp.status_code not in (200, 201):
            raise RuntimeError(
                f"Zoom chat send failed ({resp.status_code}): {resp.text[:200]}"
            )
        return resp.json().get("id", "")

    def schedule_meeting(self, request: MeetingRequest) -> Dict[str, Any]:
        organiser = self.config.get("organiser_email", "me")
        resp = self._request(
            "POST",
            f"/users/{organiser}/meetings",
            json={
                "topic": request.subject,
                "type": 2,  # scheduled
                "start_time": request.start_at.isoformat(),
                "duration": request.duration_minutes,
                "agenda": request.body,
                "settings": {
                    "auto_recording": "cloud",
                    "meeting_invitees": [
                        {"email": e} for e in (request.attendee_emails or [])
                    ],
                },
            },
        )
        if resp.status_code not in (200, 201):
            raise RuntimeError(
                f"Zoom create_meeting failed ({resp.status_code}): {resp.text[:200]}"
            )
        body = resp.json()
        return {
            "join_url": body.get("join_url"),
            "meeting_id": body.get("id"),
            "raw": body,
        }

    def list_recent_recordings(self, since: Optional[datetime] = None) -> List[Dict[str, Any]]:
        params = {"page_size": 100}
        if since:
            params["from"] = since.strftime("%Y-%m-%d")
        resp = self._request("GET", "/users/me/recordings", params=params)
        if resp.status_code != 200:
            return []
        out = []
        for m in (resp.json().get("meetings") or []):
            out.append({
                "recording_id": m.get("uuid") or m.get("id"),
                "subject": m.get("topic"),
                "started_at": m.get("start_time"),
                "ended_at": None,
                "download_url": (m.get("recording_files") or [{}])[0].get("download_url"),
            })
        return out


def _now_ts() -> int:
    return int(datetime.now(timezone.utc).timestamp())


META = ProviderMeta(
    provider="zoom",
    label="Zoom",
    category="collab",
    description="Schedule committee meetings, post Team Chat notifications, and pull recordings for transcription. Beta.",
    auth_method="oauth2",
    fields=[
        ProviderField(key="zoom_account_id", label="Account id",
                      kind="text", required=True, is_credential=False),
        ProviderField(key="client_id", label="App client id",
                      kind="text", required=True),
        ProviderField(key="client_secret", label="App client secret",
                      kind="password", required=True),
        ProviderField(key="organiser_email", label="Default organiser email",
                      kind="text", required=False,
                      help_text="Email of the user who organises scheduled meetings.",
                      is_credential=False),
    ],
    adapter_cls=ZoomAdapter,
    beta=True,
    docs_url="https://developers.zoom.us/docs/api/",
)
