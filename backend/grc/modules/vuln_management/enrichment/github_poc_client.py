"""GitHub public-exploit (PoC) detection.

Given a CVE-ID, asks the GitHub Search API "are there any public
repositories with this CVE in their name / description / readme?". When
the answer is yes, attackers have ready-to-run code and the operator
should treat the vuln as effectively exploitable regardless of EPSS.

Caching:
  * Redis key `github_poc:{cve_id}` with 3-day TTL. Shorter than NVD/MSRC
    because PoCs are published continuously after disclosure — a CVE that
    has no PoC today might have one next week.
  * Negative cache (zero hits) uses the same TTL — we want to revisit.

Rate limiting:
  * Unauthenticated: 10 requests / minute.
  * With `GITHUB_TOKEN`: 30 requests / minute on the Search API.
  Our daily refresh + per-vuln enrichment paths stay well under either
  limit with the cache in place. On rate-limit (403), we return None so
  the caller treats this CVE as un-checked and the next sync retries.

All external calls are wrapped in try/except — a network failure never
raises into the request path.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Optional

import requests

logger = logging.getLogger(__name__)

GITHUB_SEARCH_URL = "https://api.github.com/search/repositories"
GITHUB_TIMEOUT_SECONDS = 8
# 3 days — long enough to keep API usage cheap, short enough that a newly-
# released PoC surfaces within the daily refresh cycle.
GITHUB_POC_CACHE_TTL_SECONDS = 3 * 24 * 3600
# Cap stored repos — the top-N by stars is plenty for the UI list.
MAX_STORED_REFS = 8


@dataclass
class GithubPocRef:
    """One repo entry. Mirrors the shape stored verbatim in the JSON column."""
    full_name: str             # "owner/repo"
    url: str                   # https://github.com/owner/repo
    stars: int                 # Star count at last lookup
    description: Optional[str] = None  # repo description (truncated)

    def to_dict(self) -> dict:
        return {
            "full_name": self.full_name,
            "url": self.url,
            "stars": int(self.stars),
            "description": self.description,
        }


@dataclass
class GithubPocResult:
    cve_id: str
    found: bool = False
    repo_count: int = 0
    top_refs: List[GithubPocRef] = field(default_factory=list)

    def refs_as_dicts(self) -> List[dict]:
        return [r.to_dict() for r in self.top_refs]


def _redis_client():
    """Best-effort Redis. Returns None if redis isn't available — caller
    falls through to live API."""
    try:
        import redis  # type: ignore
    except Exception:
        return None
    url = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
    try:
        return redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
    except Exception:
        return None


def _from_cache(rc, cve_id: str) -> Optional[GithubPocResult]:
    if rc is None:
        return None
    try:
        raw = rc.get(f"github_poc:{cve_id}")
    except Exception:
        return None
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except Exception:
        return None
    refs = []
    for r in payload.get("top_refs") or []:
        if not isinstance(r, dict) or not r.get("full_name"):
            continue
        refs.append(GithubPocRef(
            full_name=str(r.get("full_name")),
            url=str(r.get("url") or f"https://github.com/{r.get('full_name')}"),
            stars=int(r.get("stars") or 0),
            description=r.get("description"),
        ))
    return GithubPocResult(
        cve_id=str(payload.get("cve_id") or cve_id),
        found=bool(payload.get("found")),
        repo_count=int(payload.get("repo_count") or 0),
        top_refs=refs,
    )


def _to_cache(rc, result: GithubPocResult) -> None:
    if rc is None:
        return
    try:
        rc.set(
            f"github_poc:{result.cve_id}",
            json.dumps({
                "cve_id": result.cve_id,
                "found": result.found,
                "repo_count": result.repo_count,
                "top_refs": result.refs_as_dicts(),
            }),
            ex=GITHUB_POC_CACHE_TTL_SECONDS,
        )
    except Exception:
        logger.debug("GitHub PoC cache write failed for %s", result.cve_id, exc_info=False)


def fetch_github_poc(cve_id: str) -> Optional[GithubPocResult]:
    """Search GitHub for public PoC / exploit repositories for `cve_id`.

    Returns:
        * `GithubPocResult(found=True, ...)` — at least one matching repo.
        * `GithubPocResult(found=False, repo_count=0)` — checked, none found.
        * `None` — transient failure (rate limit, network). Caller should
          treat the column as still un-checked.
    """
    if not cve_id or not cve_id.upper().startswith("CVE-"):
        return None
    cve_id = cve_id.upper().strip()

    rc = _redis_client()
    cached = _from_cache(rc, cve_id)
    if cached is not None:
        return cached

    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "complywerse-vuln-poc-search/1.0",
    }
    token = (os.environ.get("GITHUB_TOKEN") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"

    # The repo-search API matches `q` against name / description / readme.
    # Sort by stars so the top entries are the most "real" PoCs rather
    # than empty forks. `per_page=10` is plenty — we only store the top 8.
    params = {
        "q": f"{cve_id} in:name,description,readme",
        "sort": "stars",
        "order": "desc",
        "per_page": 10,
    }

    try:
        response = requests.get(
            GITHUB_SEARCH_URL, params=params, headers=headers,
            timeout=GITHUB_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.info("GitHub PoC lookup network error for %s: %s", cve_id, exc)
        return None

    # 403 with X-RateLimit-Remaining=0 → rate limited. Don't poison cache.
    if response.status_code in (403, 429):
        logger.info("GitHub PoC lookup rate-limited for %s (%s)", cve_id, response.status_code)
        return None
    if response.status_code != 200:
        logger.info("GitHub PoC lookup non-200 for %s: %s", cve_id, response.status_code)
        return None

    try:
        data = response.json()
    except Exception:
        logger.info("GitHub PoC lookup invalid JSON for %s", cve_id)
        return None

    items = data.get("items") or []
    total = int(data.get("total_count") or 0)
    refs: List[GithubPocRef] = []
    for it in items[:MAX_STORED_REFS]:
        if not isinstance(it, dict):
            continue
        full_name = it.get("full_name")
        if not isinstance(full_name, str) or "/" not in full_name:
            continue
        desc = it.get("description")
        if isinstance(desc, str) and len(desc) > 200:
            desc = desc[:200].rsplit(" ", 1)[0] + "…"
        refs.append(GithubPocRef(
            full_name=full_name,
            url=str(it.get("html_url") or f"https://github.com/{full_name}"),
            stars=int(it.get("stargazers_count") or 0),
            description=desc,
        ))

    result = GithubPocResult(
        cve_id=cve_id,
        found=total > 0,
        repo_count=total,
        top_refs=refs,
    )
    _to_cache(rc, result)
    return result
