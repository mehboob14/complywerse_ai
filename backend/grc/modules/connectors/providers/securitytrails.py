"""SecurityTrails adapter — keyed passive EASM source.

Holds a SecurityTrails API key so the external attack-surface collector can
pull a seed domain's subdomains (see
`asset_discovery/services/external_collect.py:fetch_securitytrails`).
Pull-only: no push side, no periodic connector sync — the row stores and
health-checks the key.

Auth: `APIKEY: <api_key>` header. Health endpoint: GET /v1/ping.

API docs: https://docs.securitytrails.com/reference
"""
from __future__ import annotations

import logging

import requests

from ..base import ConnectionTestResult, EasmSourceAdapter
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)


SECURITYTRAILS_PING = "https://api.securitytrails.com/v1/ping"


class SecurityTrailsAdapter(EasmSourceAdapter):
    provider = "securitytrails"

    def test_connection(self) -> ConnectionTestResult:
        key = self.credentials.get("api_key")
        if not key:
            return ConnectionTestResult(success=False, message="SecurityTrails API key missing")
        try:
            resp = requests.get(SECURITYTRAILS_PING, headers={"APIKEY": key}, timeout=20)
            if resp.status_code == 200:
                body = resp.json() or {}
                return ConnectionTestResult(
                    success=True,
                    message="Authenticated to SecurityTrails.",
                    details={"success": body.get("success")},
                )
            return ConnectionTestResult(
                success=False,
                message=f"SecurityTrails returned {resp.status_code}: {resp.text[:300]}",
            )
        except Exception as exc:
            logger.exception("SecurityTrails test_connection failed")
            return ConnectionTestResult(success=False, message=str(exc))


META = ProviderMeta(
    provider="securitytrails",
    label="SecurityTrails",
    category="easm_source",
    description="Passive external attack-surface source. Supplies subdomain enumeration for domain seeds in asset discovery.",
    auth_method="api_key",
    fields=[
        ProviderField(key="api_key", label="API key",
                      kind="password", required=True,
                      help_text="SecurityTrails API key (Account → API Keys)."),
    ],
    adapter_cls=SecurityTrailsAdapter,
    docs_url="https://docs.securitytrails.com/reference",
)
