"""EPSS (Exploit Prediction Scoring System) client.

EPSS rates the probability (0..1) that a CVE will be exploited in the wild
in the next 30 days. Published by FIRST.org and refreshed daily. The score
changes over time, so unlike NVD details, EPSS is NOT cached for longer
than the daily refresh cadence — the daily Celery beat re-queries every
open vuln.

Single-CVE and bulk lookups are both supported. The bulk path is used by
the daily refresh task; single-CVE is used by the on-demand enrich button
and ingest hooks.

Best-effort: any network failure → None / empty mapping. Caller decides.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Dict, Iterable, Optional

import requests

logger = logging.getLogger(__name__)

EPSS_API_URL = "https://api.first.org/data/v1/epss"
EPSS_TIMEOUT_SECONDS = 10
EPSS_BULK_BATCH_SIZE = 50  # FIRST.org accepts up to ~100 per call; 50 keeps URLs short.


@dataclass
class EpssResult:
    cve_id: str
    score: float          # 0.0 - 1.0
    percentile: float     # 0.0 - 1.0


def _parse_row(row: dict) -> Optional[EpssResult]:
    cve_id = (row or {}).get("cve")
    if not isinstance(cve_id, str):
        return None
    try:
        score = float(row.get("epss"))
        percentile = float(row.get("percentile"))
    except (TypeError, ValueError):
        return None
    return EpssResult(cve_id=cve_id.upper().strip(), score=score, percentile=percentile)


def fetch_epss(cve_id: str) -> Optional[EpssResult]:
    """Look up EPSS for one CVE. Returns None on failure or unknown CVE."""
    if not cve_id or not cve_id.upper().startswith("CVE-"):
        return None
    try:
        response = requests.get(
            EPSS_API_URL,
            params={"cve": cve_id.upper().strip()},
            timeout=EPSS_TIMEOUT_SECONDS,
        )
    except Exception as exc:
        logger.info("EPSS lookup network error for %s: %s", cve_id, exc)
        return None
    if response.status_code != 200:
        logger.info("EPSS lookup non-200 for %s: %s", cve_id, response.status_code)
        return None
    try:
        rows = (response.json() or {}).get("data") or []
    except Exception:
        return None
    for row in rows:
        result = _parse_row(row)
        if result and result.cve_id.upper() == cve_id.upper().strip():
            return result
    return None


def fetch_epss_bulk(cve_ids: Iterable[str]) -> Dict[str, EpssResult]:
    """Look up EPSS for many CVEs in batched API calls. Returns a map of
    CVE-ID → EpssResult for whatever the API found. CVEs not in the EPSS
    catalogue are silently absent from the map.
    """
    # Dedupe + uppercase + filter to valid-looking ids before hitting the API.
    seen = []
    seen_set = set()
    for raw in cve_ids:
        if not isinstance(raw, str):
            continue
        normalized = raw.upper().strip()
        if not normalized.startswith("CVE-") or normalized in seen_set:
            continue
        seen_set.add(normalized)
        seen.append(normalized)

    out: Dict[str, EpssResult] = {}
    for batch_start in range(0, len(seen), EPSS_BULK_BATCH_SIZE):
        batch = seen[batch_start: batch_start + EPSS_BULK_BATCH_SIZE]
        params = {"cve": ",".join(batch)}
        try:
            response = requests.get(EPSS_API_URL, params=params, timeout=EPSS_TIMEOUT_SECONDS)
        except Exception as exc:
            logger.info("EPSS bulk network error (batch %d-%d): %s",
                        batch_start, batch_start + len(batch), exc)
            continue
        if response.status_code != 200:
            logger.info("EPSS bulk non-200 (batch %d-%d): %s",
                        batch_start, batch_start + len(batch), response.status_code)
            continue
        try:
            rows = (response.json() or {}).get("data") or []
        except Exception:
            continue
        for row in rows:
            result = _parse_row(row)
            if result is not None:
                out[result.cve_id] = result
    return out
