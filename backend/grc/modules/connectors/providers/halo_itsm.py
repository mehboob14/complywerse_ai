"""Halo ITSM adapter — two-way vulnerability ticketing.

Pushes:
  * Vulnerabilities / exceptions → Halo tickets (POST /api/Tickets)

Pulls back:
  * status / closure state for known Halo ticket ids → normalises into
    our status taxonomy.

Halo auth is OAuth2 client-credentials. Halo exposes a separate Auth
(identity) URL and Resource (API) URL. This adapter takes both; if only
the resource URL is given, the auth URL defaults to
`{resource}/auth/token`. The bearer token is cached with its expiry,
refreshed when expired, and re-fetched once on a 401.

Halo's status ids, ticket-type id and team are instance-customisable, so
the open/resolved/closed status ids used for the status taxonomy and the
close action are operator-configurable (sensible defaults, no code change
per tenant).

API reference: https://halo.haloservicedesk.com/apidoc/info
"""
from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests

from ..base import (
    ConnectionTestResult,
    TicketingAdapter,
    TicketRequest,
    TicketStatus,
)
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)

_HTTP_TIMEOUT = 30
_TOKEN_SKEW_SECONDS = 60  # refresh a little before real expiry

# Our severity → Halo priority id (Halo defaults: 1 = Critical … 4 = Low).
_OUR_SEV_TO_HALO_PRIORITY = {
    "critical": 1,
    "high": 2,
    "medium": 3,
    "low": 4,
}

# Halo ticket `status_id` → our taxonomy. Halo's out-of-the-box statuses:
# 1 New, 2 In Progress, 3 (customer) Action Required/On Hold, 8 Resolved,
# 9 Closed. Instances customise these, so the operator-configured status
# ids (open/resolved/closed) override this map, and unmapped ids fall back
# to "new".
_HALO_STATUS_NORMALISED = {
    1: "new",
    2: "in_progress",
    3: "on_hold",
    4: "on_hold",
    8: "resolved",
    9: "closed",
    18: "resolved",
    20: "closed",
}

# Default Halo out-of-the-box id used to close a ticket when the operator
# has not configured one.
_DEFAULT_CLOSED_STATUS_ID = 9

# Config key → normalised taxonomy value for the operator-overridable ids.
_STATUS_CONFIG_KEYS = (
    ("open_status_id", "in_progress"),
    ("resolved_status_id", "resolved"),
    ("closed_status_id", "closed"),
)


class HaloAdapter(TicketingAdapter):
    provider = "halo_itsm"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._token: Optional[str] = None
        self._token_expires_at: float = 0.0

    # ─── Helpers ────────────────────────────────────────────────────

    def _resource_url(self) -> str:
        """The Halo API base URL (where /api/... lives)."""
        url = (self.config.get("resource_url") or self.console_url or "").rstrip("/")
        if not url:
            raise RuntimeError("Halo resource/API URL is not configured")
        return url

    def _auth_url(self) -> str:
        """The Halo token endpoint. Defaults to {resource}/auth/token."""
        configured = (self.config.get("auth_url") or "").rstrip("/")
        if configured:
            return configured
        return f"{self._resource_url()}/auth/token"

    def _fetch_token(self) -> str:
        client_id = self.credentials.get("client_id")
        client_secret = self.credentials.get("client_secret")
        if not client_id or not client_secret:
            raise RuntimeError("Halo credentials missing client_id/client_secret")
        resp = requests.post(
            self._auth_url(),
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": client_secret,
                "scope": "all",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            verify=self.verify_ssl,
            timeout=_HTTP_TIMEOUT,
        )
        if resp.status_code != 200:
            # Never echo the request body — it carries the client secret.
            raise RuntimeError(
                f"Halo token request failed ({resp.status_code}): {resp.text[:200]}"
            )
        body = resp.json()
        token = body.get("access_token")
        if not token:
            raise RuntimeError("Halo token endpoint returned no access_token")
        expires_in = body.get("expires_in")
        try:
            ttl = float(expires_in)
        except (TypeError, ValueError):
            ttl = 3600.0
        self._token = token
        self._token_expires_at = time.time() + max(ttl - _TOKEN_SKEW_SECONDS, 0)
        return token

    def _bearer(self) -> str:
        if self._token and time.time() < self._token_expires_at:
            return self._token
        return self._fetch_token()

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        url = f"{self._resource_url()}{path}"
        extra_headers = kwargs.pop("headers", None)
        resp: Optional[requests.Response] = None
        # One retry: a 401 usually means the cached token was revoked or
        # expired early, so drop it and re-auth once before giving up.
        for attempt in (1, 2):
            headers = {
                "Accept": "application/json",
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self._bearer()}",
            }
            if extra_headers:
                headers.update(extra_headers)
            resp = requests.request(
                method, url, headers=headers,
                verify=self.verify_ssl, timeout=_HTTP_TIMEOUT, **kwargs,
            )
            if resp.status_code == 401 and attempt == 1:
                self._token = None
                self._token_expires_at = 0.0
                continue
            break
        return resp  # type: ignore[return-value]

    def _default_tickettype_id(self) -> Optional[int]:
        raw = self.config.get("default_tickettype_id")
        try:
            return int(raw) if raw not in (None, "") else None
        except (TypeError, ValueError):
            return None

    def _default_team(self) -> Optional[str]:
        return self.config.get("default_team") or None

    def _status_overrides(self) -> Dict[int, str]:
        """Operator-configured status ids → normalised taxonomy. These take
        precedence over the out-of-the-box default map."""
        out: Dict[int, str] = {}
        for key, normalised in _STATUS_CONFIG_KEYS:
            sid = _as_int(self.config.get(key))
            if sid is not None:
                out[sid] = normalised
        return out

    def _normalise_status(self, status_id: Any) -> str:
        sid = _as_int(status_id)
        if sid is None:
            return "new"
        return self._status_overrides().get(
            sid, _HALO_STATUS_NORMALISED.get(sid, "new")
        )

    def _closed_status_id(self) -> int:
        return _as_int(self.config.get("closed_status_id")) or _DEFAULT_CLOSED_STATUS_ID

    # ─── BaseConnectorAdapter ───────────────────────────────────────

    def test_connection(self) -> ConnectionTestResult:
        try:
            self._bearer()  # proves the OAuth client-credentials flow works
            resp = self._request("GET", "/api/Tickets", params={"count": 1})
            if resp.status_code == 200:
                return ConnectionTestResult(
                    success=True,
                    message="Authenticated to Halo ITSM successfully.",
                    details={"endpoint": "/api/Tickets"},
                )
            return ConnectionTestResult(
                success=False,
                message=f"Halo returned {resp.status_code}: {resp.text[:200]}",
            )
        except Exception as exc:
            logger.exception("Halo test_connection failed")
            return ConnectionTestResult(success=False, message=str(exc))

    # ─── TicketingAdapter ───────────────────────────────────────────

    def create_ticket(self, request: TicketRequest) -> str:
        ticket: Dict[str, Any] = {
            "summary": request.summary[:160],
            "details": request.description,
            "priority_id": _OUR_SEV_TO_HALO_PRIORITY.get(request.severity.lower(), 3),
            # custom fields so resolutions can be traced back to our record
            "grc_external_id": request.external_id,
            "grc_record_kind": request.kind,
        }
        tickettype_id = self._default_tickettype_id()
        if tickettype_id is not None:
            ticket["tickettype_id"] = tickettype_id
        team = request.assignment_group or self._default_team()
        if team:
            ticket["team"] = team
        ticket.update(request.extra_fields or {})

        resp = self._request("POST", "/api/Tickets", json=[ticket])
        if resp.status_code not in (200, 201):
            raise RuntimeError(
                f"Halo create_ticket failed ({resp.status_code}): {resp.text[:300]}"
            )
        body = resp.json()
        # Halo returns either the created object or a one-element array.
        record = body[0] if isinstance(body, list) and body else body
        ticket_id = (record or {}).get("id")
        if ticket_id in (None, ""):
            raise RuntimeError("Halo returned no ticket id")
        return str(ticket_id)

    def update_ticket(self, external_id: str, fields: Dict[str, Any]) -> bool:
        payload = {"id": _as_int(external_id)}
        payload.update(fields)
        resp = self._request("POST", "/api/Tickets", json=[payload])
        return 200 <= resp.status_code < 300

    def close_ticket(self, external_id: str, resolution_note: str) -> bool:
        return self.update_ticket(external_id, {
            "status_id": self._closed_status_id(),
            "details": resolution_note,
        })

    def fetch_statuses(self, external_ids: List[str]) -> List[TicketStatus]:
        out: List[TicketStatus] = []
        for ext in external_ids:
            try:
                resp = self._request("GET", f"/api/Tickets/{ext}")
                if resp.status_code == 404:
                    continue
                if resp.status_code != 200:
                    logger.warning(
                        "Halo fetch status %s returned %s", ext, resp.status_code
                    )
                    continue
                row = resp.json() or {}
                status_id = row.get("status_id")
                raw_status = str(row.get("status_name") or status_id or "")
                normalised = self._normalise_status(status_id)
                out.append(TicketStatus(
                    external_id=str(ext),
                    status=raw_status,
                    normalised_status=normalised,
                    last_updated_at=_parse_halo_dt(row.get("lastactiondate")),
                    resolved_at=_parse_halo_dt(row.get("dateclosed")),
                    resolution_note=row.get("resolution"),
                    extra={"halo_status_id": status_id},
                ))
            except Exception:
                logger.exception("Halo fetch status failed for %s", ext)
        return out


def _as_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _parse_halo_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(str(value)[:19], fmt)
            except ValueError:
                continue
    return None


META = ProviderMeta(
    provider="halo_itsm",
    label="Halo ITSM",
    category="ticketing",
    description="Two-way ticket sync. Push vulnerabilities as Halo ITSM tickets; resolutions sync back.",
    auth_method="oauth2",
    fields=[
        ProviderField(key="resource_url", label="Resource / API URL",
                      kind="url",
                      placeholder="https://your-instance.haloitsm.com",
                      help_text="Halo API base URL (where /api/Tickets lives).",
                      is_credential=False),
        ProviderField(key="auth_url", label="Auth URL",
                      kind="url", required=False,
                      placeholder="https://your-instance.haloitsm.com/auth/token",
                      help_text="OAuth2 token endpoint. Defaults to the resource URL + /auth/token.",
                      is_credential=False),
        ProviderField(key="client_id", label="Client ID",
                      kind="text", required=True, is_credential=True),
        ProviderField(key="client_secret", label="Client secret",
                      kind="password", required=True, is_credential=True),
        ProviderField(key="default_tickettype_id", label="Default ticket type id",
                      kind="text", required=False,
                      help_text="Halo ticket type id applied to new tickets.",
                      is_credential=False),
        ProviderField(key="default_team", label="Default team",
                      kind="text", required=False,
                      help_text="Tickets without a per-request group fall back to this team.",
                      is_credential=False),
        ProviderField(key="open_status_id", label="Open status id",
                      kind="text", required=False,
                      placeholder="2",
                      help_text="Halo status id treated as in-progress when syncing status back. Overrides the built-in map.",
                      is_credential=False),
        ProviderField(key="resolved_status_id", label="Resolved status id",
                      kind="text", required=False,
                      placeholder="8",
                      help_text="Halo status id treated as resolved when syncing status back.",
                      is_credential=False),
        ProviderField(key="closed_status_id", label="Closed status id",
                      kind="text", required=False,
                      placeholder="9",
                      help_text="Halo status id used to close a ticket and treated as closed on sync-back. Defaults to 9.",
                      is_credential=False),
    ],
    adapter_cls=HaloAdapter,
    oauth_scopes=["all"],
    docs_url="https://halo.haloservicedesk.com/apidoc/info",
)


if __name__ == "__main__":
    # Self-check: configured ids override the built-in map; unknowns → "new".
    a = HaloAdapter(
        console_url="https://x",
        credentials={},
        config={"open_status_id": "11", "resolved_status_id": "12",
                "closed_status_id": "13"},
    )
    assert a._normalise_status(11) == "in_progress"
    assert a._normalise_status(12) == "resolved"
    assert a._normalise_status(13) == "closed"
    assert a._closed_status_id() == 13
    assert a._normalise_status(999) == "new"      # unknown id
    assert a._normalise_status(None) == "new"      # missing id
    b = HaloAdapter(console_url="https://x", credentials={}, config={})
    assert b._normalise_status(1) == "new"         # default map still works
    assert b._normalise_status(9) == "closed"
    assert b._closed_status_id() == _DEFAULT_CLOSED_STATUS_ID
    print("halo_itsm self-check OK")
