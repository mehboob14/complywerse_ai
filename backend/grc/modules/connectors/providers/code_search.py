"""Code search — GitHub, for credentials published by mistake.

Pull-only: the connector row holds and health-checks the tenant's GitHub token,
and third-party risk monitoring searches public code for a supplier's domains
next to words like password or secret (vendor_risk/tpra/leaks.py). What is found
is linked, never copied: the file may hold the secret itself.

ponytail: built to GitHub's documented REST code search and tested against that
shape; not yet run against a live account. Code search allows about ten
requests a minute, so the monitoring batch is small.
"""
from __future__ import annotations

import logging
from typing import Callable, List

import requests

from ..base import ConnectionTestResult, EasmSourceAdapter
from ..registry import ProviderField, ProviderMeta

logger = logging.getLogger(__name__)
TIMEOUT = 30
WORDS = "password OR secret OR token OR apikey OR api_key"


def search(domain: str, token: str, get: Callable = requests.get, limit: int = 30) -> List[dict]:
    """Public files that name the domain beside a credential word: repository, path and link only."""
    resp = get("https://api.github.com/search/code", params={"q": f'"{domain}" {WORDS}', "per_page": limit},
               headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28"}, timeout=TIMEOUT)
    if resp.status_code == 422:              # GitHub refuses some queries outright; nothing to report
        return []
    resp.raise_for_status()
    out = []
    for item in (resp.json() or {}).get("items") or []:
        repo = (item.get("repository") or {}).get("full_name")
        if repo and item.get("path") and item.get("html_url"):
            out.append({"repository": repo, "path": item["path"], "url": item["html_url"]})
    return out


class GitHubCodeSearchAdapter(EasmSourceAdapter):
    provider = "github_code"
    category = "code_search"

    def test_connection(self) -> ConnectionTestResult:
        token = self.credentials.get("api_token")
        if not token:
            return ConnectionTestResult(success=False, message="GitHub token missing")
        try:
            resp = requests.get("https://api.github.com/user", timeout=20,
                                headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"})
        except Exception as exc:  # noqa: BLE001
            return ConnectionTestResult(success=False, message=str(exc))
        if resp.status_code == 200:
            return ConnectionTestResult(success=True, message="Authenticated to GitHub.")
        return ConnectionTestResult(success=False, message=f"GitHub returned {resp.status_code}: {resp.text[:300]}")


META = ProviderMeta(
    provider="github_code", label="GitHub code search", category="code_search",
    description="Searches public code for suppliers' and our own domains beside words like password or secret.",
    auth_method="api_key", adapter_cls=GitHubCodeSearchAdapter, docs_url="https://docs.github.com/en/rest/search/search#search-code",
    fields=[ProviderField(key="api_token", label="Personal access token", kind="password", required=True,
                          help_text="A fine-grained token with no repository access is enough for public code search.")],
)
