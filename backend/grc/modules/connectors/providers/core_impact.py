"""Core Impact (Fortra / formerly HelpSystems) adapter — pen-test inbound.

Pulls modules-run / exploit-success records via Core Impact's REST API.
Beta — Core Impact's REST surface varies by version; verified shapes
are noted inline. Adapter falls back to empty-list when responses
don't match the expected schema rather than crashing.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, List, Optional

import requests

from ..base import ConnectionTestResult, ExploitConfirmation, PenTestAdapter
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)


class CoreImpactAdapter(PenTestAdapter):
    provider = "core_impact"

    def _headers(self) -> dict:
        token = self.credentials.get("api_token")
        if not token:
            raise RuntimeError("Core Impact credentials missing api_token")
        return {"Authorization": f"Bearer {token}", "Accept": "application/json"}

    def test_connection(self) -> ConnectionTestResult:
        try:
            resp = requests.get(
                f"{self.console_url}/api/v1/workspaces",
                headers=self._headers(),
                verify=self.verify_ssl,
                timeout=20,
            )
            if resp.status_code == 200:
                return ConnectionTestResult(
                    success=True,
                    message="Core Impact API reachable (beta).",
                )
            return ConnectionTestResult(
                success=False,
                message=f"Core Impact returned {resp.status_code}: {resp.text[:200]}",
            )
        except Exception as exc:
            return ConnectionTestResult(success=False, message=str(exc))

    def fetch_exploits(
        self,
        *,
        since: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[ExploitConfirmation]:
        workspace = self.config.get("workspace_id")
        if not workspace:
            return []
        params = {"limit": limit, "success": "true"}
        if since:
            params["since"] = since.isoformat()
        resp = requests.get(
            f"{self.console_url}/api/v1/workspaces/{workspace}/exploits",
            headers=self._headers(),
            params=params,
            verify=self.verify_ssl,
            timeout=60,
        )
        if resp.status_code != 200:
            raise RuntimeError(
                f"Core Impact fetch failed ({resp.status_code}): {resp.text[:200]}"
            )
        items = resp.json().get("data") or resp.json() or []
        out: List[ExploitConfirmation] = []
        for it in items:
            ts_raw = it.get("executed_at") or it.get("timestamp")
            try:
                ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
            except Exception:
                ts = datetime.now(timezone.utc)
            out.append(ExploitConfirmation(
                source_id=str(it.get("id") or it.get("execution_id")),
                timestamp=ts,
                cve_ids=list(it.get("cve_ids") or []),
                target_host=(it.get("target") or {}).get("hostname"),
                target_ip=(it.get("target") or {}).get("ip"),
                exploit_name=it.get("module_name") or it.get("name"),
                payload=it.get("payload"),
                raw=it,
            ))
        return out


META = ProviderMeta(
    provider="core_impact",
    label="Core Impact",
    category="pentest",
    description="Pull confirmed exploit modules from Core Impact workspaces. Beta — verify response schema against your Core Impact version.",
    auth_method="token",
    fields=[
        ProviderField(key="console_url", label="Core Impact URL",
                      kind="url", placeholder="https://coreimpact.example.com",
                      is_credential=False),
        ProviderField(key="api_token", label="API token",
                      kind="password", required=True),
        ProviderField(key="workspace_id", label="Workspace id",
                      kind="text", required=False,
                      help_text="If set, sync is scoped to this workspace.",
                      is_credential=False),
    ],
    adapter_cls=CoreImpactAdapter,
    beta=True,
    docs_url="https://www.fortra.com/products/penetration-testing/core-impact",
)
