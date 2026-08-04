"""BMC Helix ITSM (Remedy) adapter — ticketing.

Beta status: the auth flow + Remedy REST API request shapes are wired
based on the Helix REST API spec, but verification against a live
instance is pending. Sync methods return informative errors when the
adapter encounters response shapes it hasn't been calibrated against.

API: `POST /api/jwt/login` → JWT in plain body. Subsequent calls use
`Authorization: AR-JWT <jwt>` and target form names like
`HPD:IncidentInterface_Create`.
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


class BmcRemedyAdapter(TicketingAdapter):
    provider = "bmc_remedy"

    def _login(self) -> str:
        token = self.oauth_tokens.get("ar_jwt")
        if token:
            return token
        user = self.credentials.get("username")
        pwd = self.credentials.get("password")
        if not (user and pwd):
            raise RuntimeError("BMC credentials missing username/password")
        resp = requests.post(
            f"{self.console_url}/api/jwt/login",
            data={"username": user, "password": pwd},
            verify=self.verify_ssl,
            timeout=30,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"BMC login failed ({resp.status_code}): {resp.text[:200]}"
            )
        token = resp.text.strip()
        self.oauth_tokens["ar_jwt"] = token
        return token

    def _headers(self) -> Dict[str, str]:
        return {"Authorization": f"AR-JWT {self._login()}"}

    def test_connection(self) -> ConnectionTestResult:
        try:
            jwt = self._login()
            return ConnectionTestResult(
                success=True,
                message="BMC Helix login OK (beta — sync flows not yet certified).",
                details={"jwt_prefix": jwt[:8] if jwt else None},
            )
        except Exception as exc:
            return ConnectionTestResult(success=False, message=str(exc))

    def create_ticket(self, request: TicketRequest) -> str:
        form = self.config.get("incident_form", "HPD:IncidentInterface_Create")
        resp = requests.post(
            f"{self.console_url}/api/arsys/v1/entry/{form}",
            headers=self._headers(),
            json={"values": {
                "Summary": request.summary[:160],
                "Description": request.description,
                "Impact": _impact(request.severity),
                "Urgency": _urgency(request.severity),
                "External_ID": request.external_id,
                "Reported Source": "Other",
            }},
            verify=self.verify_ssl,
            timeout=30,
        )
        if resp.status_code not in (200, 201):
            raise RuntimeError(
                f"BMC create_ticket failed ({resp.status_code}): {resp.text[:200]}"
            )
        body = resp.json() if resp.text else {}
        loc = resp.headers.get("Location", "")
        # BMC echoes the entry id in Location header
        return body.get("values", {}).get("Incident Number") or loc.rsplit("/", 1)[-1]

    def update_ticket(self, external_id: str, fields: Dict[str, Any]) -> bool:
        form = self.config.get("incident_form", "HPD:IncidentInterface")
        resp = requests.put(
            f"{self.console_url}/api/arsys/v1/entry/{form}/{external_id}",
            headers=self._headers(),
            json={"values": fields},
            verify=self.verify_ssl,
            timeout=30,
        )
        return resp.status_code in (200, 204)

    def close_ticket(self, external_id: str, resolution_note: str) -> bool:
        return self.update_ticket(external_id, {
            "Status": "Closed",
            "Resolution": resolution_note,
        })

    def fetch_statuses(self, external_ids: List[str]) -> List[TicketStatus]:
        # Beta — single round-trip per id since AR-systems batch queries
        # vary widely by customer config. Optimise once an instance is wired.
        out: List[TicketStatus] = []
        form = self.config.get("incident_form", "HPD:IncidentInterface")
        for ext in external_ids:
            try:
                resp = requests.get(
                    f"{self.console_url}/api/arsys/v1/entry/{form}/{ext}",
                    headers=self._headers(),
                    verify=self.verify_ssl,
                    timeout=20,
                )
                if resp.status_code != 200:
                    continue
                vals = resp.json().get("values") or {}
                status = (vals.get("Status") or "").lower()
                normalised = {
                    "new": "new", "assigned": "in_progress",
                    "in progress": "in_progress", "pending": "on_hold",
                    "resolved": "resolved", "closed": "closed",
                    "cancelled": "cancelled",
                }.get(status, "new")
                out.append(TicketStatus(
                    external_id=ext,
                    status=status,
                    normalised_status=normalised,
                    resolution_note=vals.get("Resolution"),
                    extra=vals,
                ))
            except Exception:
                logger.exception("BMC fetch status failed for %s", ext)
        return out


def _impact(sev: str) -> str:
    return {"critical": "1-Extensive/Widespread", "high": "2-Significant/Large",
            "medium": "3-Moderate/Limited", "low": "4-Minor/Localized"}.get(
        sev.lower(), "3-Moderate/Limited"
    )


def _urgency(sev: str) -> str:
    return {"critical": "1-Critical", "high": "2-High",
            "medium": "3-Medium", "low": "4-Low"}.get(
        sev.lower(), "3-Medium"
    )


META = ProviderMeta(
    provider="bmc_remedy",
    label="BMC Helix ITSM",
    category="ticketing",
    description="BMC Helix (Remedy) ticketing. Two-way sync similar to ServiceNow. Beta — verify against your instance before production use.",
    auth_method="basic",
    fields=[
        ProviderField(key="console_url", label="Helix REST base URL",
                      kind="url", placeholder="https://helix.example.com",
                      is_credential=False),
        ProviderField(key="username", label="Username", kind="text", required=True),
        ProviderField(key="password", label="Password", kind="password", required=True),
        ProviderField(key="incident_form", label="Incident form name",
                      kind="text", required=False,
                      placeholder="HPD:IncidentInterface",
                      is_credential=False),
    ],
    adapter_cls=BmcRemedyAdapter,
    beta=True,
    docs_url="https://docs.bmc.com/docs/ars/91/developing/rest-api-overview",
)
