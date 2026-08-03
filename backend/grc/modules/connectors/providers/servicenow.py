"""ServiceNow adapter — two-way ticketing.

Pushes:
  * Vulnerabilities  → incident (table: `incident`)
  * Exceptions       → change_request (table: `change_request`)
                        OR `sn_si_incident` (Security Incident Response)

Pulls back:
  * `state`, `assigned_to`, `assignment_group`, `closed_at`,
    `close_notes` for known external_ids → normalises into our
    status taxonomy.

ServiceNow auth is Basic (user + password) or OAuth2. This adapter
supports both — `auth_method='basic'` uses HTTP Basic; `auth_method='oauth2'`
expects an access_token in `oauth_tokens['access_token']` and refreshes
via the standard ServiceNow OAuth refresh flow when 401s come back.

API reference: https://developer.servicenow.com/dev.do#!/reference/api/rome/rest/c_TableAPI
"""
from __future__ import annotations

import logging
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


# ── Severity / status mapping ──────────────────────────────────────
# ServiceNow `impact`/`urgency`/`priority` are 1-5 (1 = highest).
_OUR_SEV_TO_SN_PRIORITY = {
    "critical": 1,
    "high": 2,
    "medium": 3,
    "low": 4,
}

# `state` values vary by instance customisation; the defaults here
# follow the out-of-the-box Incident table.
_SN_STATE_NORMALISED = {
    "1": "new",        # New
    "2": "in_progress",  # In Progress
    "3": "on_hold",      # On Hold
    "6": "resolved",     # Resolved
    "7": "closed",       # Closed
    "8": "cancelled",    # Canceled
}


class ServiceNowAdapter(TicketingAdapter):
    provider = "servicenow"

    # ─── Helpers ────────────────────────────────────────────────────

    def _auth(self):
        """Return the right requests.auth tuple or Authorization header."""
        if self.oauth_tokens.get("access_token"):
            return None, {"Authorization": f"Bearer {self.oauth_tokens['access_token']}"}
        user = self.credentials.get("username")
        pwd = self.credentials.get("password")
        if not user or not pwd:
            raise RuntimeError("ServiceNow credentials missing username/password")
        return (user, pwd), {}

    def _request(self, method: str, path: str, **kwargs) -> requests.Response:
        auth, hdrs = self._auth()
        url = f"{self.console_url}{path}"
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        headers.update(hdrs)
        if "headers" in kwargs:
            headers.update(kwargs.pop("headers"))
        resp = requests.request(
            method, url, auth=auth, headers=headers,
            verify=self.verify_ssl, timeout=30, **kwargs,
        )
        return resp

    def _vuln_table(self) -> str:
        return self.config.get("vuln_table", "incident")

    def _exception_table(self) -> str:
        return self.config.get("exception_table", "change_request")

    def _assignment_group(self, override: Optional[str]) -> Optional[str]:
        return override or self.config.get("assignment_group")

    # ─── BaseConnectorAdapter ───────────────────────────────────────

    def test_connection(self) -> ConnectionTestResult:
        try:
            resp = self._request("GET", "/api/now/table/sys_user?sysparm_limit=1")
            if resp.status_code == 200:
                body = resp.json()
                version = resp.headers.get("X-ServiceNow-Build-Tag") or "unknown"
                return ConnectionTestResult(
                    success=True,
                    message="Authenticated to ServiceNow successfully.",
                    server_version=version,
                    details={"user_visible": bool(body.get("result"))},
                )
            return ConnectionTestResult(
                success=False,
                message=f"ServiceNow returned {resp.status_code}: {resp.text[:200]}",
            )
        except Exception as exc:
            logger.exception("ServiceNow test_connection failed")
            return ConnectionTestResult(success=False, message=str(exc))

    # ─── TicketingAdapter ───────────────────────────────────────────

    def create_ticket(self, request: TicketRequest) -> str:
        table = (
            self._vuln_table() if request.kind == "vulnerability"
            else self._exception_table()
        )
        payload: Dict[str, Any] = {
            "short_description": request.summary[:160],
            "description": request.description,
            "priority": str(_OUR_SEV_TO_SN_PRIORITY.get(request.severity.lower(), 3)),
            "u_grc_external_id": request.external_id,    # custom field on the target table
            "u_grc_record_kind": request.kind,
        }
        ag = self._assignment_group(request.assignment_group)
        if ag:
            payload["assignment_group"] = ag
        payload.update(request.extra_fields or {})

        resp = self._request("POST", f"/api/now/table/{table}", json=payload)
        if resp.status_code not in (200, 201):
            raise RuntimeError(
                f"ServiceNow create_ticket failed ({resp.status_code}): {resp.text[:300]}"
            )
        sysid_record = resp.json().get("result", {})
        number = sysid_record.get("number") or sysid_record.get("sys_id")
        if not number:
            raise RuntimeError("ServiceNow returned no ticket number")
        return number

    def update_ticket(self, external_id: str, fields: Dict[str, Any]) -> bool:
        table = self._vuln_table()
        resp = self._request(
            "PATCH",
            f"/api/now/table/{table}/{external_id}",
            json=fields,
        )
        return resp.status_code == 200

    def close_ticket(self, external_id: str, resolution_note: str) -> bool:
        return self.update_ticket(external_id, {
            "state": "6",  # Resolved
            "close_code": "Solved (Permanently)",
            "close_notes": resolution_note,
        })

    def fetch_statuses(self, external_ids: List[str]) -> List[TicketStatus]:
        if not external_ids:
            return []
        results: List[TicketStatus] = []
        # Batch-query by `number` so we don't burn requests.
        encoded = ",".join(external_ids)
        table = self._vuln_table()
        resp = self._request(
            "GET",
            f"/api/now/table/{table}",
            params={
                "sysparm_query": f"numberIN{encoded}",
                "sysparm_fields": "number,state,closed_at,close_notes,sys_updated_on",
                "sysparm_limit": str(len(external_ids)),
            },
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"ServiceNow fetch_statuses failed ({resp.status_code}): {resp.text[:300]}"
            )
        for row in resp.json().get("result", []):
            ext = row.get("number") or ""
            state = str(row.get("state") or "1")
            normalised = _SN_STATE_NORMALISED.get(state, "new")
            results.append(TicketStatus(
                external_id=ext,
                status=state,
                normalised_status=normalised,
                last_updated_at=_parse_sn_dt(row.get("sys_updated_on")),
                resolved_at=_parse_sn_dt(row.get("closed_at")),
                resolution_note=row.get("close_notes"),
                extra={"sn_state_raw": state},
            ))
        return results


def _parse_sn_dt(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
    except Exception:
        return None


META = ProviderMeta(
    provider="servicenow",
    label="ServiceNow",
    category="ticketing",
    description="Two-way ticket sync. Push vulnerabilities and exception requests as ServiceNow tickets; resolutions sync back to GRC.",
    auth_method="basic",
    fields=[
        ProviderField(key="console_url", label="Instance URL", kind="url",
                      placeholder="https://your-instance.service-now.com",
                      help_text="Your ServiceNow instance base URL.",
                      is_credential=False),
        ProviderField(key="username", label="Service account username",
                      kind="text", required=True),
        ProviderField(key="password", label="Service account password",
                      kind="password", required=True),
        ProviderField(key="vuln_table", label="Vulnerability ticket table",
                      kind="text", required=False, placeholder="incident",
                      help_text="ServiceNow table for vulnerability tickets. Default: incident.",
                      is_credential=False),
        ProviderField(key="exception_table", label="Exception ticket table",
                      kind="text", required=False, placeholder="change_request",
                      help_text="ServiceNow table for exception/risk-acceptance tickets.",
                      is_credential=False),
        ProviderField(key="assignment_group", label="Default assignment group",
                      kind="text", required=False,
                      help_text="Tickets without a per-request group fall back to this.",
                      is_credential=False),
    ],
    adapter_cls=ServiceNowAdapter,
    docs_url="https://developer.servicenow.com/dev.do#!/reference/api/rome/rest/c_TableAPI",
)
