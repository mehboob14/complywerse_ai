"""Deterministic external-feed fetchers for the Risk Posture upgrade.

Two sources, both authoritative, both free, both deterministic — no AI:

  FIRST.org EPSS  https://api.first.org/data/v1/epss?cve=CVE-X,CVE-Y
                  → per-CVE probability of exploitation in the next 30
                  days. Bulk-friendly (100 CVEs per call).

  CISA KEV        https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json
                  → full catalog of vulns known to be actively exploited
                  in the wild, with added/due dates per CVE.

Both are cached in-process with a daily TTL so a per-vuln lookup during
risk recompute doesn't hit the network — we batch-refresh once a day
from a cron, and individual reads use the cached map.

No new pip deps — urllib only.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timedelta
from typing import Dict, Iterable, List, Optional
from urllib import request as urlrequest
from urllib.parse import quote

logger = logging.getLogger(__name__)

EPSS_BASE = "https://api.first.org/data/v1/epss"
KEV_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"

# Cache TTL — both feeds publish once per day. 23h gives slack for
# clock drift while still ensuring at most one refetch per business day.
_CACHE_TTL = timedelta(hours=23)


class _Cache:
    """Process-local cache. One row per feed, refreshed on demand."""

    def __init__(self):
        self.epss: Dict[str, Dict[str, float]] = {}   # cve_id → {score, percentile}
        self.epss_fetched_at: Optional[datetime] = None
        self.kev: Dict[str, Dict[str, str]] = {}      # cve_id → {kev_added_at, kev_due_date}
        self.kev_fetched_at: Optional[datetime] = None


_cache = _Cache()


def _http_get_json(url: str, timeout_s: int = 30) -> dict:
    """Single GET → JSON. Lifts the dict; raises on transport / parse error."""
    req = urlrequest.Request(url, headers={"User-Agent": "Compliverse-RiskPosture/1.0"})
    with urlrequest.urlopen(req, timeout=timeout_s) as r:
        body = r.read().decode("utf-8")
        return json.loads(body)


# ─── EPSS ──────────────────────────────────────────────────────────────

def fetch_epss(cves: Iterable[str]) -> Dict[str, Dict[str, float]]:
    """Look up EPSS for a list of CVE IDs. Honors the per-call 100-CVE limit
    the public endpoint enforces by chunking.

    Returns: {cve_id: {"score": 0..1, "percentile": 0..100}}.
    CVEs the EPSS feed doesn't have (e.g. very recent) are silently
    missing from the result — caller treats absence as "no signal yet."
    """
    cves = [c.strip().upper() for c in cves if c and c.strip()]
    cves = sorted({c for c in cves if c.startswith("CVE-")})
    if not cves:
        return {}

    out: Dict[str, Dict[str, float]] = {}
    chunk_size = 100
    for i in range(0, len(cves), chunk_size):
        chunk = cves[i : i + chunk_size]
        url = f"{EPSS_BASE}?cve={quote(','.join(chunk))}"
        try:
            data = _http_get_json(url)
        except Exception:  # noqa: BLE001
            # Network / parse failure shouldn't crash the recompute path.
            # Caller already treats missing CVEs as "no EPSS signal".
            logger.exception("EPSS chunk %d-%d failed", i, i + chunk_size)
            continue
        for row in data.get("data") or []:
            cve = (row.get("cve") or "").upper()
            if not cve:
                continue
            try:
                out[cve] = {
                    "score": float(row.get("epss") or 0.0),
                    "percentile": float(row.get("percentile") or 0.0) * 100,
                }
            except (TypeError, ValueError):
                # Malformed row — skip, don't poison the cache.
                continue
    return out


def refresh_epss_cache(cves: Iterable[str]) -> int:
    """Ensure the EPSS values for these CVEs are in the cache. Returns
    count newly fetched (vs already cached and still fresh)."""
    now = datetime.utcnow()
    if (_cache.epss_fetched_at and
            (now - _cache.epss_fetched_at) < _CACHE_TTL):
        # Cache still fresh; only fetch missing keys
        needed = [c for c in cves if c.upper() not in _cache.epss]
    else:
        needed = list(cves)
    if not needed:
        return 0
    fresh = fetch_epss(needed)
    _cache.epss.update(fresh)
    _cache.epss_fetched_at = now
    return len(fresh)


def epss_lookup(cve: str) -> Optional[Dict[str, float]]:
    """Single-CVE accessor — returns None if not in cache."""
    return _cache.epss.get((cve or "").upper())


# ─── CISA KEV ──────────────────────────────────────────────────────────

def refresh_kev_cache() -> int:
    """Pull the full KEV catalogue (~1100 CVEs) once a day. Returns count
    of entries loaded. Subsequent calls within TTL are no-ops."""
    now = datetime.utcnow()
    if (_cache.kev_fetched_at and
            (now - _cache.kev_fetched_at) < _CACHE_TTL and
            _cache.kev):
        return 0  # already fresh
    try:
        data = _http_get_json(KEV_URL, timeout_s=60)
    except Exception:  # noqa: BLE001
        logger.exception("KEV refresh failed; keeping stale cache if any")
        return 0
    fresh: Dict[str, Dict[str, str]] = {}
    for row in data.get("vulnerabilities") or []:
        cve = (row.get("cveID") or "").upper()
        if not cve:
            continue
        fresh[cve] = {
            "kev_added_at": row.get("dateAdded") or "",
            "kev_due_date": row.get("dueDate") or "",
        }
    _cache.kev = fresh
    _cache.kev_fetched_at = now
    return len(fresh)


def kev_lookup(cve: str) -> Optional[Dict[str, str]]:
    """Single-CVE KEV lookup. Returns dict if listed, None otherwise."""
    return _cache.kev.get((cve or "").upper())


# ─── Bulk recompute helper — used by the daily cron ────────────────────

def hydrate_vulnerabilities(db, tenant_id: Optional[int] = None) -> Dict[str, int]:
    """Walk every vuln with a CVE for the given tenant (or all tenants if
    None), refresh its EPSS + KEV columns from the cache, persist. Returns
    a per-source count of how many rows were updated.

    Idempotent — re-running on the same data only writes when values change.
    Safe to call from a cron without coordination.
    """
    from grc.models import Vulnerability
    from sqlalchemy import or_

    refresh_kev_cache()
    q = db.query(Vulnerability).filter(Vulnerability.cve_id.isnot(None))
    if tenant_id is not None:
        q = q.filter(Vulnerability.tenant_id == tenant_id)
    rows = q.all()
    cves = [(v.cve_id or "").strip() for v in rows if v.cve_id]
    refresh_epss_cache(cves)

    updated_epss = 0
    updated_kev = 0
    now = datetime.utcnow()
    for v in rows:
        cve = (v.cve_id or "").strip().upper()
        if not cve:
            continue
        ep = epss_lookup(cve)
        if ep:
            new_score = ep.get("score")
            new_pct = ep.get("percentile")
            if v.epss_score != new_score or v.epss_percentile != new_pct:
                v.epss_score = new_score
                v.epss_percentile = new_pct
                v.epss_updated_at = now
                updated_epss += 1
        kv = kev_lookup(cve)
        new_kev_flag = kv is not None
        if v.kev_flag != new_kev_flag:
            v.kev_flag = new_kev_flag
            if kv:
                # Parse the CISA date strings (YYYY-MM-DD). Defensive on
                # malformed values — leave as None.
                for col, key in (("kev_added_at", "kev_added_at"),
                                 ("kev_due_date", "kev_due_date")):
                    raw = kv.get(key)
                    if raw:
                        try:
                            setattr(v, col, datetime.fromisoformat(raw))
                        except ValueError:
                            pass
            updated_kev += 1
    db.commit()
    return {
        "epss_updated": updated_epss,
        "kev_updated": updated_kev,
        "vulns_processed": len(rows),
    }
