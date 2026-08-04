"""CISA KEV (Known Exploited Vulnerabilities) catalogue.

The KEV catalogue is a small JSON file (~1 MB, ~1,200 entries) published
daily by CISA. We fetch it once per process and keep it in memory. The
daily Celery refresh task calls `refresh_kev_cache()` to re-pull. The
lookup itself is just a dict.get(), so per-CVE lookups are free.

Cold-start failure (e.g. CISA down) → the cache stays empty and
`is_kev()` returns False. We treat that as a deliberate false negative
rather than blocking enrichment — a vuln that should be flagged KEV will
get re-evaluated on the next refresh.
"""
from __future__ import annotations

import logging
import threading
from datetime import datetime
from typing import Dict, Optional

import requests

logger = logging.getLogger(__name__)

CISA_KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
KEV_TIMEOUT_SECONDS = 15

# Module-level cache. Keyed by uppercase CVE-ID. Empty dict on cold start
# until the first successful refresh; we explicitly trigger a refresh on
# first access via `_ensure_loaded()`.
_kev_lock = threading.Lock()
_kev_data: Dict[str, dict] = {}
_kev_last_loaded: Optional[datetime] = None
_load_attempted = False


def _parse_kev_date(value) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    # CISA format: "2024-03-29"
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return None


def _fetch_kev_catalogue() -> Optional[Dict[str, dict]]:
    """Download the JSON and shape it into `{cve_id: metadata}`."""
    try:
        response = requests.get(
            CISA_KEV_URL,
            timeout=KEV_TIMEOUT_SECONDS,
            headers={"User-Agent": "complywerse-vuln-enrichment/1.0"},
        )
    except Exception as exc:
        logger.info("KEV download network error: %s", exc)
        return None
    if response.status_code != 200:
        logger.info("KEV download non-200: %s", response.status_code)
        return None
    try:
        payload = response.json()
    except Exception:
        logger.info("KEV download invalid JSON")
        return None
    vulns = (payload or {}).get("vulnerabilities") or []
    if not vulns:
        return None

    out: Dict[str, dict] = {}
    for entry in vulns:
        cve_id = (entry or {}).get("cveID")
        if not isinstance(cve_id, str):
            continue
        out[cve_id.upper().strip()] = {
            "cve_id": cve_id.upper().strip(),
            "vendor_project": entry.get("vendorProject"),
            "product": entry.get("product"),
            "vulnerability_name": entry.get("vulnerabilityName"),
            "date_added": _parse_kev_date(entry.get("dateAdded")),
            "short_description": entry.get("shortDescription"),
            "required_action": entry.get("requiredAction"),
            "due_date": _parse_kev_date(entry.get("dueDate")),
            "known_ransomware_campaign_use": entry.get("knownRansomwareCampaignUse"),
        }
    return out


def _ensure_loaded() -> None:
    """First-access loader. Safe to call repeatedly — only the first call
    that observes an unloaded cache will actually download.
    """
    global _kev_data, _kev_last_loaded, _load_attempted
    if _load_attempted:
        return
    with _kev_lock:
        if _load_attempted:
            return
        _load_attempted = True
        data = _fetch_kev_catalogue()
        if data is not None:
            _kev_data = data
            _kev_last_loaded = datetime.utcnow()
            logger.info("KEV cache loaded: %d entries", len(data))


def refresh_kev_cache() -> bool:
    """Force a re-download. Used by the daily Celery refresh task. Returns
    True on success, False on failure (cache stays at last good copy).
    """
    global _kev_data, _kev_last_loaded, _load_attempted
    data = _fetch_kev_catalogue()
    if data is None:
        return False
    with _kev_lock:
        _kev_data = data
        _kev_last_loaded = datetime.utcnow()
        _load_attempted = True
    logger.info("KEV cache refreshed: %d entries", len(data))
    return True


def is_kev(cve_id: str) -> bool:
    """True if the CVE is in the CISA KEV catalogue."""
    if not cve_id or not isinstance(cve_id, str):
        return False
    _ensure_loaded()
    return cve_id.upper().strip() in _kev_data


def kev_metadata(cve_id: str) -> Optional[dict]:
    """Full KEV entry for a CVE, or None if not in the catalogue."""
    if not cve_id or not isinstance(cve_id, str):
        return None
    _ensure_loaded()
    return _kev_data.get(cve_id.upper().strip())


def kev_cache_status() -> dict:
    """Lightweight introspection for the /enrich endpoint and Celery logs."""
    return {
        "loaded": _kev_last_loaded is not None,
        "last_loaded_at": _kev_last_loaded.isoformat() if _kev_last_loaded else None,
        "entry_count": len(_kev_data),
    }


def all_kev_cves() -> set:
    """Returns the full set of KEV CVE-IDs (uppercased). Used by the daily
    refresh task to bulk-update the kev_flag on existing vuln rows.
    """
    _ensure_loaded()
    return set(_kev_data.keys())
