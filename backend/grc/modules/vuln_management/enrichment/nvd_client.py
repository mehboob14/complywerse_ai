"""NVD (National Vulnerability Database) lookup with optional Redis cache.

Returns canonical CVE metadata — publication date, last-modified date, and
references (exploit links + advisories). CVSS score isn't read from NVD
because the scanner that produced the row almost always has a more current
value; we don't want to overwrite a v3.1 score with a v2.0 score from NVD.

Cache strategy:
  * Redis key  `nvd:{cve_id}` with 7-day TTL (CVE details change rarely).
  * On Redis miss: hit the API directly. Honors `NVD_API_KEY` env var.
  * On any failure (timeout, 4xx, 5xx): returns None. Caller decides what
    to do with a missing result; never raises.

NVD rate limit without key: 5 req / 30s. With key (free signup at
https://nvd.nist.gov/developers/request-an-api-key): 50 req / 30s. With
the 7-day cache + per-CVE dedup, even an unkeyed deployment stays
comfortably under the limit for normal tenant traffic.
"""
from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

import requests

logger = logging.getLogger(__name__)

NVD_API_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
NVD_TIMEOUT_SECONDS = 10
NVD_CACHE_TTL_SECONDS = 7 * 24 * 3600  # 7 days


@dataclass
class NvdResult:
    cve_id: str
    published_at: Optional[datetime] = None
    last_modified_at: Optional[datetime] = None
    description: Optional[str] = None
    references: List[str] = field(default_factory=list)
    # Phase 4 (CPE matcher) — raw affected-configuration nodes from NVD.
    # Each node carries `cpeMatch[]` with `criteria`, `vulnerable`, and the
    # `versionStartIncluding`/`Excluding` + `versionEndIncluding`/`Excluding`
    # range bounds. Consumed by `services/cpe_matcher.py` to find assets
    # with matching SoftwareIdentifier rows.
    configurations: List[Dict[str, Any]] = field(default_factory=list)


def _redis_client():
    """Return a redis client or None. Imported lazily so the rest of the
    module loads cleanly when redis isn't available (tests, local dev).
    """
    try:
        import redis  # type: ignore
    except Exception:
        return None
    url = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
    try:
        return redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
    except Exception:
        return None


def _parse_nvd_datetime(value: Any) -> Optional[datetime]:
    """NVD returns ISO 8601 like '2024-03-29T16:15:21.123' — sometimes with
    a 'Z' or '+00:00' suffix. We normalise to naive UTC since the column
    type is `DateTime` without timezone, matching the rest of the model.
    """
    if not value or not isinstance(value, str):
        return None
    try:
        # Python's fromisoformat doesn't accept 'Z' until 3.11.
        if value.endswith("Z"):
            value = value[:-1] + "+00:00"
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is not None:
            dt = dt.replace(tzinfo=None)
        return dt
    except (ValueError, TypeError):
        return None


def _from_cache(redis_client, cve_id: str) -> Optional[NvdResult]:
    if redis_client is None:
        return None
    try:
        raw = redis_client.get(f"nvd:{cve_id}")
    except Exception:
        return None
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except Exception:
        return None
    return NvdResult(
        cve_id=payload.get("cve_id") or cve_id,
        published_at=_parse_nvd_datetime(payload.get("published_at")),
        last_modified_at=_parse_nvd_datetime(payload.get("last_modified_at")),
        description=payload.get("description"),
        references=list(payload.get("references") or []),
        configurations=list(payload.get("configurations") or []),
    )


def _to_cache(redis_client, result: NvdResult) -> None:
    if redis_client is None:
        return
    try:
        payload = {
            "cve_id": result.cve_id,
            "published_at": result.published_at.isoformat() if result.published_at else None,
            "last_modified_at": result.last_modified_at.isoformat() if result.last_modified_at else None,
            "description": result.description,
            "references": result.references,
            "configurations": result.configurations,
        }
        redis_client.set(
            f"nvd:{result.cve_id}",
            json.dumps(payload),
            ex=NVD_CACHE_TTL_SECONDS,
        )
    except Exception:
        # Cache write failure is non-fatal — just log once at debug.
        logger.debug("NVD cache write failed for %s", result.cve_id, exc_info=False)


def _extract_payload(raw: Dict[str, Any], cve_id: str) -> Optional[NvdResult]:
    """Pull the bits we care about out of NVD's nested JSON shape."""
    vulnerabilities = raw.get("vulnerabilities") or []
    if not vulnerabilities:
        return None
    cve = (vulnerabilities[0] or {}).get("cve") or {}

    description = None
    for desc in cve.get("descriptions") or []:
        if (desc or {}).get("lang") == "en":
            description = (desc.get("value") or "").strip() or None
            break

    references: List[str] = []
    for ref in cve.get("references") or []:
        url = (ref or {}).get("url")
        if isinstance(url, str) and url.strip():
            references.append(url.strip())

    # Affected-configuration nodes — captured verbatim for the CPE matcher.
    # Cap to a reasonable size so the Redis-cached blob stays sane on
    # outlier CVEs that list hundreds of CPE variants.
    configurations = cve.get("configurations") or []
    if isinstance(configurations, list):
        configurations = configurations[:50]
    else:
        configurations = []

    return NvdResult(
        cve_id=cve.get("id") or cve_id,
        published_at=_parse_nvd_datetime(cve.get("published")),
        last_modified_at=_parse_nvd_datetime(cve.get("lastModified")),
        description=description,
        references=references[:25],  # cap to keep the JSON column compact
        configurations=configurations,
    )


def fetch_nvd(cve_id: str) -> Optional[NvdResult]:
    """Look up CVE metadata. Returns None on any failure.

    Order: Redis cache → live API → cache on success.
    """
    if not cve_id or not cve_id.upper().startswith("CVE-"):
        return None
    cve_id = cve_id.upper().strip()

    redis_client = _redis_client()
    cached = _from_cache(redis_client, cve_id)
    if cached is not None:
        return cached

    params = {"cveId": cve_id}
    headers = {"User-Agent": "complywerse-vuln-enrichment/1.0"}
    api_key = (os.environ.get("NVD_API_KEY") or "").strip()
    if api_key:
        headers["apiKey"] = api_key

    try:
        response = requests.get(
            NVD_API_URL,
            params=params,
            headers=headers,
            timeout=NVD_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.info("NVD lookup network error for %s: %s", cve_id, exc)
        return None

    if response.status_code == 404:
        return None
    if response.status_code != 200:
        logger.info("NVD lookup non-200 for %s: %s", cve_id, response.status_code)
        return None

    try:
        raw = response.json()
    except Exception:
        logger.info("NVD lookup invalid JSON for %s", cve_id)
        return None

    result = _extract_payload(raw, cve_id)
    if result is not None:
        _to_cache(redis_client, result)
    return result
