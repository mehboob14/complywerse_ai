"""Censys adapter — keyed passive EASM source.

Holds Censys Search API credentials (API ID + secret) so the external
attack-surface collector can query Censys hosts for a seed domain (see
`asset_discovery/services/external_collect.py:fetch_censys`). Pull-only: no
push side, no periodic connector sync — the row stores and health-checks the
key pair.

Auth: HTTP basic (api_id:api_secret). Health endpoint: GET /api/v2/account.

API docs: https://search.censys.io/api
"""
from __future__ import annotations

import logging

import requests

from ..base import ConnectionTestResult, EasmSourceAdapter
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)


CENSYS_ACCOUNT = "https://search.censys.io/api/v2/account"


class CensysAdapter(EasmSourceAdapter):
    provider = "censys"

    def test_connection(self) -> ConnectionTestResult:
        api_id = self.credentials.get("api_id")
        api_secret = self.credentials.get("api_secret")
        if not (api_id and api_secret):
            return ConnectionTestResult(success=False, message="Censys API id/secret missing")
        try:
            resp = requests.get(CENSYS_ACCOUNT, auth=(api_id, api_secret), timeout=20)
            if resp.status_code == 200:
                acct = resp.json() or {}
                return ConnectionTestResult(
                    success=True,
                    message="Authenticated to Censys.",
                    details={"email": acct.get("email"), "login": acct.get("login")},
                )
            return ConnectionTestResult(
                success=False,
                message=f"Censys returned {resp.status_code}: {resp.text[:300]}",
            )
        except Exception as exc:
            logger.exception("Censys test_connection failed")
            return ConnectionTestResult(success=False, message=str(exc))


META = ProviderMeta(
    provider="censys",
    label="Censys",
    category="easm_source",
    description="Passive external attack-surface source. Supplies host names, open ports/services and CPEs for domain seeds in asset discovery.",
    auth_method="basic",
    fields=[
        ProviderField(key="api_id", label="API ID",
                      kind="text", required=True,
                      help_text="Censys Search API ID (Account → API)."),
        ProviderField(key="api_secret", label="API secret",
                      kind="password", required=True,
                      help_text="Censys Search API secret."),
    ],
    adapter_cls=CensysAdapter,
    docs_url="https://search.censys.io/api",
)
