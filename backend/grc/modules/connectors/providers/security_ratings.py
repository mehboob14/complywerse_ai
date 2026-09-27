"""Security-rating providers — UpGuard, SecurityScorecard, BitSight.

Pull-only, like the EASM sources: the connector row holds and health-checks the
tenant's API key, and third-party risk monitoring reads each supplier's rating
with it (vendor_risk/tpra/rating_feeds.py). No push side, no periodic sync of
its own.
"""
from __future__ import annotations

import logging

import requests

from ..base import ConnectionTestResult, EasmSourceAdapter
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)


class _RatingAdapter(EasmSourceAdapter):
    category = "security_rating"
    label = ""

    def _request(self) -> requests.Response:      # pragma: no cover - per provider
        raise NotImplementedError

    def test_connection(self) -> ConnectionTestResult:
        if not self.credentials.get("api_key"):
            return ConnectionTestResult(success=False, message=f"{self.label} API key missing")
        try:
            resp = self._request()
        except Exception as exc:  # noqa: BLE001
            logger.exception("%s test_connection failed", self.label)
            return ConnectionTestResult(success=False, message=str(exc))
        if resp.status_code == 200:
            return ConnectionTestResult(success=True, message=f"Authenticated to {self.label}.")
        if resp.status_code in (401, 403):
            return ConnectionTestResult(success=False, message=f"{self.label} refused the key ({resp.status_code}).")
        return ConnectionTestResult(success=False, message=f"{self.label} returned {resp.status_code}: {resp.text[:300]}")


class UpGuardAdapter(_RatingAdapter):
    provider, label = "upguard", "UpGuard"

    def _request(self):
        return requests.get("https://cyber-risk.upguard.com/api/public/organisation",
                            headers={"Authorization": self.credentials["api_key"]}, timeout=20)


class SecurityScorecardAdapter(_RatingAdapter):
    provider, label = "securityscorecard", "SecurityScorecard"

    def _request(self):
        return requests.get("https://api.securityscorecard.io/portfolios",
                            headers={"Authorization": f"Token {self.credentials['api_key']}"}, timeout=20)


class BitSightAdapter(_RatingAdapter):
    provider, label = "bitsight", "BitSight"

    def _request(self):
        return requests.get("https://api.bitsighttech.com/ratings/v2/portfolio", params={"limit": 1},
                            auth=(self.credentials["api_key"], ""), timeout=20)


def _meta(adapter, description: str, help_text: str, docs: str) -> ProviderMeta:
    return ProviderMeta(
        provider=adapter.provider, label=adapter.label, category="security_rating", description=description,
        auth_method="api_key", adapter_cls=adapter, docs_url=docs,
        fields=[ProviderField(key="api_key", label="API key", kind="password", required=True, help_text=help_text)],
    )


METAS = [
    _meta(UpGuardAdapter, "Reads each supplier's UpGuard security rating for third-party risk monitoring.",
          "UpGuard → Settings → API.", "https://cyber-risk.upguard.com/api/docs"),
    _meta(SecurityScorecardAdapter, "Reads each supplier's SecurityScorecard score for third-party risk monitoring.",
          "SecurityScorecard → My Settings → API.", "https://securityscorecard.readme.io/"),
    _meta(BitSightAdapter, "Reads each supplier's BitSight rating for third-party risk monitoring.",
          "BitSight → Settings → API token.", "https://help.bitsighttech.com/hc/en-us/articles/231872628-API-Documentation-Overview"),
]
