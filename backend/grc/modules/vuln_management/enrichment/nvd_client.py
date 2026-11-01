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
from typing import Any, Dict, Iterable, List, Optional, Set

import requests

from ....config import REDIS_URL

logger = logging.getLogger(__name__)

NVD_API_URL = "https://services.nvd.nist.gov/rest/json/cves/2.0"
NVD_TIMEOUT_SECONDS = 10
NVD_CACHE_TTL_SECONDS = 7 * 24 * 3600  # 7 days
# Namespaced by payload shape: bump when the cached fields change so pre-change
# entries are ignored rather than served missing a new field. v2 added cwe_ids
# (Phase 1) — without the bump, a CVE cached before the change would keep reading
# back with no CWE for up to the 7-day TTL.
NVD_CACHE_KEY = "nvd:v2:"
# Separate negative cache for the existence check below. A positive result is
# already cached under NVD_CACHE_KEY (a stored NvdResult == the CVE exists); the
# only thing missing was a record of "NVD positively has no such CVE" so a
# reserved/synthetic feed id isn't re-looked-up on every re-scan. A 404 is stable
# for far longer than real metadata, so this TTL is long.
NVD_NOTFOUND_KEY = "nvd:notfound:v1:"
NVD_NOTFOUND_TTL_SECONDS = 30 * 24 * 3600  # 30 days


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
    # CVSS base vector, e.g. "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H".
    # Only scanner imports used to supply this, so any manually-entered finding
    # had none — and its absence is not harmless: priority scoring falls back to
    # a 0.5 attack-vector guess worth 10% of the weight, and the exploitability
    # page cannot say whether the flaw is network-reachable.
    cvss_vector: Optional[str] = None
    cvss_score: Optional[float] = None
    # All NVD-listed CWEs, Primary first, with the placeholders NVD-CWE-noinfo /
    # NVD-CWE-Other dropped. cwe_ids[0] is the Primary the single cwe_id keeps.
    cwe_ids: List[str] = field(default_factory=list)


def _redis_client():
    """Return a redis client or None. Imported lazily so the rest of the
    module loads cleanly when redis isn't available (tests, local dev).
    """
    try:
        import redis  # type: ignore
    except Exception:
        return None
    url = REDIS_URL
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
        raw = redis_client.get(f"{NVD_CACHE_KEY}{cve_id}")
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
        cvss_vector=payload.get("cvss_vector"),
        cvss_score=payload.get("cvss_score"),
        cwe_ids=list(payload.get("cwe_ids") or []),
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
            "cvss_vector": result.cvss_vector,
            "cvss_score": result.cvss_score,
            "cwe_ids": result.cwe_ids,
        }
        redis_client.set(
            f"{NVD_CACHE_KEY}{result.cve_id}",
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

    # NVD nests scores under metrics.cvssMetricV31 / V30 / V2, newest first.
    # Take the first entry that carries a vector string.
    cvss_vector: Optional[str] = None
    cvss_score: Optional[float] = None
    metrics = cve.get("metrics") or {}
    for key in ("cvssMetricV31", "cvssMetricV30", "cvssMetricV2"):
        for entry in metrics.get(key) or []:
            data = (entry or {}).get("cvssData") or {}
            vector = data.get("vectorString")
            if isinstance(vector, str) and vector.strip():
                cvss_vector = vector.strip()
                base = data.get("baseScore")
                if isinstance(base, (int, float)):
                    cvss_score = float(base)
                break
        if cvss_vector:
            break

    # Weaknesses (CWE) — NVD lists a Primary and often one or more Secondary CWEs
    # under cve.weaknesses[].description[].value. The placeholders NVD-CWE-noinfo /
    # NVD-CWE-Other carry no CWE id, so skip them. Primary first (so cwe_ids[0] is
    # the Primary the single cwe_id column keeps); a Secondary is frequently the
    # more specific weakness, and specificity is what drives a good technique
    # selection, so we keep the whole list.
    cwe_ids: List[str] = []
    weaknesses = cve.get("weaknesses") or []
    for want_primary in (True, False):
        for w in weaknesses:
            if ((w or {}).get("type") == "Primary") != want_primary:
                continue
            for desc in (w or {}).get("description") or []:
                val = ((desc or {}).get("value") or "").strip()
                if val.upper().startswith("CWE-") and val not in cwe_ids:
                    cwe_ids.append(val)

    return NvdResult(
        cve_id=cve.get("id") or cve_id,
        cvss_vector=cvss_vector,
        cvss_score=cvss_score,
        cwe_ids=cwe_ids,
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


# ----------------------------------------------------------------------------------------------------
# Existence check — does a CVE id actually exist in NVD?
#
# The nmap-vulners feed can surface CURRENT-YEAR CVE ids that no date/digit heuristic can tell apart from
# a real id — a genuinely unassigned/reserved id looks exactly like a legitimate high-number current-year
# CVE. The only reliable signal is: ask NVD. This drops ONLY ids NVD positively does not have; a real
# current-year CVE (e.g. an old service's freshly-published flaw) returns a record and is kept. `fetch_nvd()`
# collapses "not found" and "network error" both to None, so it can't be reused here — we must distinguish a
# POSITIVE 404/empty (drop) from an error (keep, fail-open).
# ----------------------------------------------------------------------------------------------------
def existence_filter_enabled() -> bool:
    """Master switch for the NVD existence filter at the scan ingest boundary.

    Default OFF: shipped inactive (the observed 2026 CVEs turned out to be REAL per
    live NVD, so this fixes nothing active and would add scan-time lookups). It is a
    durable guard available on demand — set ``VULN_NVD_EXISTENCE_FILTER=1`` to enable
    (and set ``NVD_API_KEY`` first to avoid rate-limit scan slowdown). Mirrors
    ``VULN_AUTO_LINK_ASSETS``. When positively enabled it drops only CVE ids NVD 404s.
    """
    return os.getenv("VULN_NVD_EXISTENCE_FILTER", "0").strip().lower() in ("1", "true", "yes", "on")


def _neg_cached(redis_client, cve_id: str) -> bool:
    if redis_client is None:
        return False
    try:
        return bool(redis_client.get(f"{NVD_NOTFOUND_KEY}{cve_id}"))
    except Exception:
        return False


def _neg_cache(redis_client, cve_id: str) -> None:
    if redis_client is None:
        return
    try:
        redis_client.set(f"{NVD_NOTFOUND_KEY}{cve_id}", "1", ex=NVD_NOTFOUND_TTL_SECONDS)
    except Exception:
        logger.debug("NVD not-found cache write failed for %s", cve_id, exc_info=False)


def cve_exists(cve_id: str) -> Optional[bool]:
    """Does this CVE exist in authoritative data?

    Returns:
        True  — the CVE exists (KEV, a cached NVD result, or a live NVD hit).
        False — NVD POSITIVELY reports no such CVE (reserved/synthetic feed id).
        None  — couldn't determine (network error / rate-limit / bad id). The
                caller MUST fail open and KEEP the finding; we never drop a CVE
                we only failed to confirm.

    Order is cheapest-first so the common case costs no network: KEV in-memory →
    Redis positive cache → Redis negative cache → one live NVD lookup (whose
    result is cached, so a repeat scan of the same id is free).
    """
    if not cve_id or not cve_id.upper().startswith("CVE-"):
        return None
    cve_id = cve_id.upper().strip()

    try:
        from .kev_cache import is_kev
        if is_kev(cve_id):  # in the exploited-in-the-wild catalogue => unquestionably real
            return True
    except Exception:
        pass  # KEV unavailable is not a signal either way — fall through

    redis_client = _redis_client()
    if _from_cache(redis_client, cve_id) is not None:  # a stored NvdResult means it exists
        return True
    if _neg_cached(redis_client, cve_id):
        return False

    params = {"cveId": cve_id}
    headers = {"User-Agent": "complywerse-vuln-enrichment/1.0"}
    api_key = (os.environ.get("NVD_API_KEY") or "").strip()
    if api_key:
        headers["apiKey"] = api_key
    try:
        response = requests.get(NVD_API_URL, params=params, headers=headers, timeout=NVD_TIMEOUT_SECONDS)
    except Exception as exc:
        logger.info("NVD existence network error for %s: %s", cve_id, exc)
        return None
    if response.status_code == 404:
        _neg_cache(redis_client, cve_id)
        return False
    if response.status_code != 200:
        logger.info("NVD existence non-200 for %s: %s", cve_id, response.status_code)
        return None
    try:
        raw = response.json()
    except Exception:
        return None
    # A well-formed but unassigned id comes back 200 with an empty list — also "does not exist".
    if not (raw.get("vulnerabilities") or []):
        _neg_cache(redis_client, cve_id)
        return False
    result = _extract_payload(raw, cve_id)
    if result is not None:
        _to_cache(redis_client, result)  # warm the positive cache so enrichment doesn't re-fetch
    return True


def confirmed_absent_cves(cve_ids: Iterable[str]) -> Set[str]:
    """Of the given ids, the subset NVD POSITIVELY reports do not exist.

    Fail-open: an id we cannot resolve (error / rate-limit) is NOT returned, so
    the caller keeps it. Only CURRENT-YEAR-or-newer ids are checked live — older
    ids are overwhelmingly real, and a cold-cache scan must not pay an NVD lookup
    per historical CVE. shortcut: scopes the live check to the current year (the
    one window the date guard in `_parse_nmap` can't catch); widen the year test
    here if the feed is ever seen emitting reserved ids for past years.
    """
    absent: Set[str] = set()
    try:
        cur_year = datetime.utcnow().year
        seen: Set[str] = set()
        for raw in cve_ids:
            if not raw:
                continue
            cid = str(raw).upper().strip()
            if cid in seen or not cid.startswith("CVE-"):
                continue
            seen.add(cid)
            try:
                if int(cid[4:8]) < cur_year:  # historical id — trust it, no lookup
                    continue
            except ValueError:
                continue
            if cve_exists(cid) is False:
                absent.add(cid)
    except Exception:  # noqa: BLE001 — the filter must never sink an ingest; keep everything
        logger.warning("confirmed_absent_cves failed; keeping all CVEs (fail-open)", exc_info=True)
        return set()
    return absent
