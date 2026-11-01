"""BMC Helix ITSM (Remedy) adapter — two-way vulnerability ticketing.

Pushes:
  * Vulnerabilities / exceptions → an Incident on the configured interface
    form (default `HPD:IncidentInterface_Create`).

Pulls back:
  * The configured status field + resolution for known Incident Numbers,
    normalised into our status taxonomy.

Auth is BMC's AR JWT flow:
  * `POST /api/jwt/login` (form: username, password) → an AR-JWT token in
    the plain response body.
  * Every call carries `Authorization: AR-JWT <token>`.
  * `POST /api/jwt/logout` releases the token (best-effort).
The token is cached on the adapter; a 401 triggers one re-login + retry.

Helix form names, the status field and its values vary per instance, so
they are operator-configurable (see META) rather than hardcoded.

API reference: https://docs.bmc.com/docs/ars/91/developing/rest-api-overview
"""
from __future__ import annotations

import logging
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

# Default out-of-the-box HPD:Help Desk status values → our taxonomy. The
# operator-configured open/resolved/closed values are layered on top of this
# in `_normalise_status`, so a customised instance still maps correctly.
_DEFAULT_STATUS_NORMALISED = {
    "new": "new",
    "assigned": "in_progress",
    "in progress": "in_progress",
    "pending": "on_hold",
    "resolved": "resolved",
    "closed": "closed",
    "cancelled": "cancelled",
    "canceled": "cancelled",
}

_DEFAULT_CREATE_FORM = "HPD:IncidentInterface_Create"
_DEFAULT_QUERY_FORM = "HPD:IncidentInterface"
_DEFAULT_STATUS_FIELD = "Status"
_DEFAULT_RESOLUTION_FIELD = "Resolution"
_DEFAULT_INCIDENT_NUMBER_FIELD = "Incident Number"

_HTTP_TIMEOUT = 30
_QUERY_PAGE_SIZE = 100  # Helix entry-query page size for offset pagination.


def _impact(sev: str) -> str:
    return {
        "critical": "1-Extensive/Widespread",
        "high": "2-Significant/Large",
        "medium": "3-Moderate/Limited",
        "low": "4-Minor/Localized",
    }.get((sev or "").lower(), "3-Moderate/Limited")


def _urgency(sev: str) -> str:
    return {
        "critical": "1-Critical",
        "high": "2-High",
        "medium": "3-Medium",
        "low": "4-Low",
    }.get((sev or "").lower(), "3-Medium")


class BmcRemedyAdapter(TicketingAdapter):
    provider = "bmc_remedy"

    # ─── Config accessors ───────────────────────────────────────────

    def _create_form(self) -> str:
        return self.config.get("create_form") or _DEFAULT_CREATE_FORM

    def _query_form(self) -> str:
        return self.config.get("query_form") or _DEFAULT_QUERY_FORM

    def _status_field(self) -> str:
        return self.config.get("status_field") or _DEFAULT_STATUS_FIELD

    def _resolution_field(self) -> str:
        return self.config.get("resolution_field") or _DEFAULT_RESOLUTION_FIELD

    def _incident_number_field(self) -> str:
        return self.config.get("incident_number_field") or _DEFAULT_INCIDENT_NUMBER_FIELD

    def _assignment_group(self, override: Optional[str]) -> Optional[str]:
        return override or self.config.get("assignment_group")

    def _normalise_status(self, raw: Optional[str]) -> str:
        s = (raw or "").strip().lower()
        if not s:
            return "new"
        overrides = {
            (self.config.get("status_open") or "").strip().lower(): "new",
            (self.config.get("status_resolved") or "").strip().lower(): "resolved",
            (self.config.get("status_closed") or "").strip().lower(): "closed",
        }
        overrides.pop("", None)
        return overrides.get(s) or _DEFAULT_STATUS_NORMALISED.get(s, "new")

    # ─── Auth ───────────────────────────────────────────────────────

    def _login(self) -> str:
        token = self.oauth_tokens.get("ar_jwt")
        if token:
            return token
        user = self.credentials.get("username")
        pwd = self.credentials.get("password")
        if not (user and pwd):
            raise RuntimeError("BMC Helix credentials missing username/password")
        resp = requests.post(
            f"{self.console_url}/api/jwt/login",
            data={"username": user, "password": pwd},
            verify=self.verify_ssl,
            timeout=_HTTP_TIMEOUT,
        )
        if resp.status_code != 200 or not resp.text.strip():
            # Never echo the credentials; only the server's own reply.
            raise RuntimeError(
                f"BMC Helix login failed ({resp.status_code}): {resp.text[:200]}"
            )
        token = resp.text.strip()
        self.oauth_tokens["ar_jwt"] = token
        return token

    def _logout(self) -> None:
        token = self.oauth_tokens.pop("ar_jwt", None)
        if not token:
            return
        try:
            requests.post(
                f"{self.console_url}/api/jwt/logout",
                headers={"Authorization": f"AR-JWT {token}"},
                verify=self.verify_ssl,
                timeout=_HTTP_TIMEOUT,
            )
        except Exception:
            logger.debug("BMC Helix logout best-effort call failed", exc_info=True)

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        """Issue an authed request, re-logging-in + retrying once on 401."""
        url = f"{self.console_url}{path}"
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        headers.update(kwargs.pop("headers", None) or {})
        kwargs.setdefault("timeout", _HTTP_TIMEOUT)
        kwargs.setdefault("verify", self.verify_ssl)

        for attempt in (1, 2):
            headers["Authorization"] = f"AR-JWT {self._login()}"
            resp = requests.request(method, url, headers=headers, **kwargs)
            if resp.status_code == 401 and attempt == 1:
                self.oauth_tokens.pop("ar_jwt", None)  # force re-login + retry
                continue
            return resp
        return resp  # unreachable, but keeps type-checkers happy

    # ─── BaseConnectorAdapter ───────────────────────────────────────

    def test_connection(self) -> ConnectionTestResult:
        try:
            jwt = self._login()
            result = ConnectionTestResult(
                success=True,
                message="Authenticated to BMC Helix ITSM successfully.",
                details={"token_acquired": bool(jwt)},
            )
            self._logout()  # release the one-shot test token
            return result
        except Exception as exc:
            logger.exception("BMC Helix test_connection failed")
            return ConnectionTestResult(success=False, message=str(exc))

    # ─── TicketingAdapter ───────────────────────────────────────────

    def create_ticket(self, request: TicketRequest) -> str:
        form = self._create_form()
        num_field = self._incident_number_field()
        values: Dict[str, Any] = {
            "Summary": (request.summary or "")[:254],
            "Description": request.description,
            "Impact": _impact(request.severity),
            "Urgency": _urgency(request.severity),
            "Status": self.config.get("status_open") or "New",
            "Reported Source": "Other",
            "Service_Type": "Infrastructure Event",
            "External_ID": request.external_id,
        }
        company = self.config.get("company")
        if company:
            values["Company"] = company
        ag = self._assignment_group(request.assignment_group)
        if ag:
            values["Assigned Group"] = ag
        # Operator-supplied field overrides win (required fields differ per instance).
        values.update(request.extra_fields or {})

        resp = self._request(
            "POST",
            f"/api/arsys/v1/entry/{form}",
            params={"fields": f"values({num_field})"},
            json={"values": values},
        )
        if resp.status_code not in (200, 201):
            raise RuntimeError(
                f"BMC Helix create_ticket failed ({resp.status_code}): {resp.text[:300]}"
            )
        body = resp.json() if resp.text else {}
        number = (body.get("values") or {}).get(num_field)
        if not number:
            # Fall back to the entry id echoed in the Location header.
            number = resp.headers.get("Location", "").rstrip("/").rsplit("/", 1)[-1]
        if not number:
            raise RuntimeError("BMC Helix returned no Incident Number / entry id")
        return number

    def update_ticket(self, external_id: str, fields: Dict[str, Any]) -> bool:
        form = self._query_form()
        resp = self._request(
            "PUT",
            f"/api/arsys/v1/entry/{form}/{external_id}",
            json={"values": fields},
        )
        if resp.status_code in (200, 204):
            return True
        if resp.status_code == 404:
            logger.warning("BMC Helix update_ticket: entry %s not found", external_id)
            return False
        raise RuntimeError(
            f"BMC Helix update_ticket failed ({resp.status_code}): {resp.text[:300]}"
        )

    def close_ticket(self, external_id: str, resolution_note: str) -> bool:
        # Remedy workflow usually forbids a direct jump to Closed, so we set the
        # configured Resolved status with the resolution note — mirroring the
        # ServiceNow adapter's close == resolve behaviour.
        resolved = self.config.get("status_resolved") or "Resolved"
        return self.update_ticket(external_id, {
            self._status_field(): resolved,
            self._resolution_field(): resolution_note,
        })

    def fetch_statuses(self, external_ids: List[str]) -> List[TicketStatus]:
        if not external_ids:
            return []
        form = self._query_form()
        num_field = self._incident_number_field()
        status_field = self._status_field()
        resolution_field = self._resolution_field()
        results: List[TicketStatus] = []

        # Chunk so a single qualification string / URL stays bounded, then
        # offset-paginate within each chunk's result set.
        for chunk in _chunks(external_ids, _QUERY_PAGE_SIZE):
            qualifier = " OR ".join(
                f"'{num_field}' = \"{_escape(ext)}\"" for ext in chunk
            )
            offset = 0
            while True:
                resp = self._request(
                    "GET",
                    f"/api/arsys/v1/entry/{form}",
                    params={
                        "q": qualifier,
                        "offset": str(offset),
                        "limit": str(_QUERY_PAGE_SIZE),
                    },
                )
                if resp.status_code == 404:
                    break  # no matching entries
                if resp.status_code != 200:
                    raise RuntimeError(
                        f"BMC Helix fetch_statuses failed ({resp.status_code}): "
                        f"{resp.text[:300]}"
                    )
                entries = (resp.json() or {}).get("entries") or []
                for entry in entries:
                    vals = entry.get("values") or {}
                    ext = vals.get(num_field) or ""
                    raw_status = vals.get(status_field) or ""
                    results.append(TicketStatus(
                        external_id=ext,
                        status=raw_status,
                        normalised_status=self._normalise_status(raw_status),
                        resolution_note=vals.get(resolution_field),
                        extra={status_field: raw_status},
                    ))
                if len(entries) < _QUERY_PAGE_SIZE:
                    break
                offset += _QUERY_PAGE_SIZE
        return results


def _chunks(items: List[str], size: int) -> List[List[str]]:
    return [items[i:i + size] for i in range(0, len(items), size)]


def _escape(value: str) -> str:
    """Escape a value for an AR qualification string (double-quote delimited)."""
    return str(value).replace('"', '\\"')


META = ProviderMeta(
    provider="bmc_remedy",
    label="BMC Helix ITSM",
    category="ticketing",
    description="Two-way ticket sync with BMC Helix ITSM (Remedy). Push vulnerabilities as Incidents; resolutions sync back.",
    auth_method="basic",
    fields=[
        ProviderField(key="console_url", label="Helix REST base URL",
                      kind="url", placeholder="https://helix.example.com",
                      help_text="Base URL of your BMC Helix / Remedy AR System REST endpoint.",
                      is_credential=False),
        ProviderField(key="username", label="Service account username",
                      kind="text", required=True),
        ProviderField(key="password", label="Service account password",
                      kind="password", required=True),
        ProviderField(key="create_form", label="Incident create form",
                      kind="text", required=False,
                      placeholder=_DEFAULT_CREATE_FORM,
                      help_text="Interface form used to create incidents. Default: HPD:IncidentInterface_Create.",
                      is_credential=False),
        ProviderField(key="query_form", label="Incident query/update form",
                      kind="text", required=False,
                      placeholder=_DEFAULT_QUERY_FORM,
                      help_text="Interface form used to query and update incidents. Default: HPD:IncidentInterface.",
                      is_credential=False),
        ProviderField(key="status_field", label="Status field name",
                      kind="text", required=False, placeholder=_DEFAULT_STATUS_FIELD,
                      help_text="Name of the status field on your instance. Default: Status.",
                      is_credential=False),
        ProviderField(key="status_open", label="Open status value",
                      kind="text", required=False, placeholder="New",
                      help_text="Status value set on new incidents / treated as open. Default: New.",
                      is_credential=False),
        ProviderField(key="status_resolved", label="Resolved status value",
                      kind="text", required=False, placeholder="Resolved",
                      help_text="Status value written when closing a ticket, and mapped to 'resolved'. Default: Resolved.",
                      is_credential=False),
        ProviderField(key="status_closed", label="Closed status value",
                      kind="text", required=False, placeholder="Closed",
                      help_text="Status value mapped to 'closed' when syncing back. Default: Closed.",
                      is_credential=False),
        ProviderField(key="resolution_field", label="Resolution field name",
                      kind="text", required=False, placeholder=_DEFAULT_RESOLUTION_FIELD,
                      help_text="Field holding the resolution note. Default: Resolution.",
                      is_credential=False),
        ProviderField(key="incident_number_field", label="Incident number field name",
                      kind="text", required=False, placeholder=_DEFAULT_INCIDENT_NUMBER_FIELD,
                      help_text="Field holding the incident identifier used for sync-back queries. Default: Incident Number.",
                      is_credential=False),
        ProviderField(key="assignment_group", label="Default assignment group",
                      kind="text", required=False,
                      help_text="Tickets without a per-request group fall back to this.",
                      is_credential=False),
        ProviderField(key="company", label="Company",
                      kind="text", required=False,
                      help_text="Company value required on incident creation by many Helix instances.",
                      is_credential=False),
    ],
    adapter_cls=BmcRemedyAdapter,
    docs_url="https://docs.bmc.com/docs/ars/91/developing/rest-api-overview",
)
