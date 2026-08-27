"""Shodan adapter — keyed passive EASM source.

Holds a Shodan API key so the external attack-surface collector can query
Shodan's passive DNS + host data for a seed domain (see
`asset_discovery/services/external_collect.py:fetch_shodan`). Pull-only: there
is no push side and no periodic connector sync — the connector row exists to
store and health-check the key.

Auth: `?key=<api_key>` query param. Health endpoint: GET /api-info.

API docs: https://developer.shodan.io/api
"""
from __future__ import annotations

import logging

import requests

from ..base import ConnectionTestResult, EasmSourceAdapter
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)


SHODAN_API_INFO = "https://api.shodan.io/api-info"


class ShodanAdapter(EasmSourceAdapter):
    provider = "shodan"

    def test_connection(self) -> ConnectionTestResult:
        key = self.credentials.get("api_key")
        if not key:
            return ConnectionTestResult(success=False, message="Shodan API key missing")
        try:
            resp = requests.get(SHODAN_API_INFO, params={"key": key}, timeout=20)
            if resp.status_code == 200:
                info = resp.json() or {}
                return ConnectionTestResult(
                    success=True,
                    message="Authenticated to Shodan.",
                    details={"plan": info.get("plan"),
                             "query_credits": info.get("query_credits")},
                )
            return ConnectionTestResult(
                success=False,
                message=f"Shodan returned {resp.status_code}: {resp.text[:300]}",
            )
        except Exception as exc:
            logger.exception("Shodan test_connection failed")
            return ConnectionTestResult(success=False, message=str(exc))


META = ProviderMeta(
    provider="shodan",
    label="Shodan",
    category="easm_source",
    description="Passive external attack-surface source. Supplies subdomains, open ports and product/CPE fingerprints for domain seeds in asset discovery.",
    auth_method="api_key",
    fields=[
        ProviderField(key="api_key", label="API key",
                      kind="password", required=True,
                      help_text="Shodan API key (Account → API)."),
    ],
    adapter_cls=ShodanAdapter,
    docs_url="https://developer.shodan.io/api",
)
