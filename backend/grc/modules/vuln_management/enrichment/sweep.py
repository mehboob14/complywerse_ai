"""MANUAL, one-time CVE enrichment backlog fill for the vulnerability REGISTER.

New findings are enriched automatically now — a scan enriches its own asset at
completion (pentest `_run_scan_job` / `classify_run`), and opening a finding
lazy-enriches it (`ensure_cve_enriched` read-path fallback). This module is NOT
scheduled and there is NO timer: it is a one-shot ops CLI for draining a
HISTORICAL backlog on demand — e.g. after importing old findings, or a first
pass over a register that predates per-scan enrichment. Run it by hand, once;
it exits cheaply when nothing is un-enriched.

It is DELIBERATELY thin. It owns nothing new:
  * scope       -> the shared `exclude_adhoc` register filter (never ad-hoc),
                   plus `nvd_last_synced_at IS NULL` (idempotent) and a CVE-id
                   prefix (GHSA/secret/SAST rows have nothing to enrich).
  * enrichment  -> the SAME `ensure_cve_enriched(db, vuln)` the UI uses. No new
                   data source, no new engine, no hardcoded CVE values.
  * tenants     -> enumerated from the master catalog (`grc_tenants`), so new
                   tenants are swept automatically.

Run it:
    python -m grc.modules.vuln_management.enrichment.sweep

Guarantees: register-scoped (never ad-hoc), idempotent (gated on
nvd_last_synced_at IS NULL — nothing re-enriched), single-instance (flock), and
best-effort (one bad CVE never aborts; never raises out). When nothing is
un-enriched every tenant query returns 0 and the run exits cheaply.
"""
from __future__ import annotations

import logging
import os
import time
from typing import List

# Load .env BEFORE the package imports below. Importing the enrichment subpackage
# pulls in `grc.modules.vuln_management/__init__` -> the router -> a hard
# `SESSION_SECRET` check at import time; when run as a bare `python -m` oneshot
# that env var only exists in .env, so it must be loaded first (same pattern as
# scripts/reset_demo_vulns.py). In-app this is a cheap no-op — env already set.
try:
    from dotenv import load_dotenv
    _BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
    load_dotenv(os.path.join(_BACKEND_DIR, ".env"))
except Exception:
    pass

from sqlalchemy import func, text
from sqlalchemy.orm import Query, Session

from ....models import Vulnerability
from .._adhoc_filter import exclude_adhoc
from . import ensure_cve_enriched

logger = logging.getLogger(__name__)

# Rows fetched per DB round-trip while draining a tenant. Each is enriched then
# stamped nvd_last_synced_at, so the next page naturally excludes it — no offset
# bookkeeping. Small so peak memory stays modest on the 2GB box.
_BATCH = 100

# Hard ceiling on NEW distinct CVEs fetched per invocation. 0 = unlimited (drain
# fully; flock prevents overlap). A bound only matters if someone wants each
# timer fire time-boxed; unkeyed ~400 CVEs is ~40 min, which a 10-min timer with
# Persistent=true picks straight back up on the next fire.
_MAX_NEW_PER_RUN = int(os.environ.get("ENRICH_SWEEP_MAX_PER_RUN", "0") or "0")

# flock path — a second concurrent invocation exits immediately.
_LOCK_PATH = os.environ.get("ENRICH_SWEEP_LOCK", "/tmp/ava-enrich-sweep.lock")


def unenriched_register_query(db: Session) -> Query:
    """The register findings that still need enrichment, in ONE place.

    Scope == the vulnerability register (managed-inventory findings only, via
    the shared `exclude_adhoc`) AND a real CVE id AND never synced. An already
    enriched row, an ad-hoc-only / unlinked row, and a non-CVE row are all
    excluded. `func.upper(...).like('CVE-%')` is the dialect-portable, case
    insensitive form of `~* '^CVE-'` (the enrich pipeline re-guards with
    `.upper().startswith('CVE-')` anyway, so this only narrows the scan).
    """
    return (
        db.query(Vulnerability)
        .filter(
            Vulnerability.cve_id.isnot(None),
            func.upper(Vulnerability.cve_id).like("CVE-%"),
            Vulnerability.nvd_last_synced_at.is_(None),
            exclude_adhoc(db),
        )
        .order_by(Vulnerability.id)
    )


def _pacing_delay() -> float:
    """Seconds to wait before fetching each NEW distinct CVE from NVD.

    Unkeyed NVD = 5 req/30s -> ~6s. With NVD_API_KEY = 50 req/30s -> ~0.7s.
    Repeats within a run are served from the 7-day Redis cache (no sleep).
    """
    return 0.7 if (os.environ.get("NVD_API_KEY") or "").strip() else 6.0


def sweep_tenant(db: Session, *, slug: str, seen: set, delay: float) -> int:
    """Drain one tenant's un-enriched register. Returns #rows enriched.

    `seen` is the set of distinct CVE ids already fetched THIS invocation
    (shared across tenants so the NVD cache dedup and pacing span the whole
    run). Best-effort: a per-CVE failure is swallowed by `ensure_cve_enriched`
    and never aborts the loop.
    """
    enriched = 0
    while True:
        rows = unenriched_register_query(db).limit(_BATCH).all()
        if not rows:
            break
        progressed = False
        for v in rows:
            cve = str(v.cve_id or "").strip().upper()
            if cve not in seen:
                if _MAX_NEW_PER_RUN and len(seen) >= _MAX_NEW_PER_RUN:
                    logger.info("enrich-sweep: hit per-run cap of %d new CVEs; stopping", _MAX_NEW_PER_RUN)
                    return enriched
                if seen:  # pace only between NEW distinct CVEs (never before the first)
                    time.sleep(delay)
                seen.add(cve)
            # ensure_cve_enriched is gated (nvd_last_synced_at IS NULL) + best-effort
            # (swallows its own errors, rolls back) + stamps nvd_last_synced_at so the
            # next page excludes this row. It returning False (e.g. a transient failure
            # that left the row un-synced) would re-select the row forever -> guard with
            # `progressed` so a batch that enriches nothing breaks instead of spinning.
            if ensure_cve_enriched(db, v):
                enriched += 1
                progressed = True
        if not progressed:
            logger.warning("enrich-sweep: tenant %s batch made no progress (%d rows); stopping to avoid a spin", slug, len(rows))
            break
    if enriched:
        logger.info("enrich-sweep: tenant %s enriched %d register CVE finding(s)", slug, enriched)
    return enriched


def list_tenant_slugs() -> List[str]:
    """Active tenant slugs from the master catalog (`grc_tenants`).

    Raw SQL selecting one column — the master DB carries a stripped schema, so
    loading the ORM entity (with its relationships to tables that don't exist
    there) is avoided. `ENRICH_SWEEP_TENANTS` (comma-separated) overrides for a
    pinned list; prefer real enumeration so new tenants are covered.
    """
    override = (os.environ.get("ENRICH_SWEEP_TENANTS") or "").strip()
    if override:
        return [s.strip() for s in override.split(",") if s.strip()]
    from ....db import MasterSession
    m = MasterSession()
    try:
        rows = m.execute(text("SELECT slug FROM grc_tenants WHERE is_active = true ORDER BY slug")).fetchall()
        return [r[0] for r in rows if r[0]]
    finally:
        m.close()


def run_sweep() -> int:
    """Enrich every un-enriched register CVE across every tenant. Returns the
    total #rows enriched. Best-effort end to end: a broken tenant is logged and
    skipped, never fatal."""
    from ....tenant_manager import tenant_session

    delay = _pacing_delay()
    seen: set = set()
    total = 0
    try:
        slugs = list_tenant_slugs()
    except Exception:
        logger.exception("enrich-sweep: could not enumerate tenants; aborting this run")
        return 0

    logger.info("enrich-sweep: starting across %d tenant(s); pacing=%.1fs/new-CVE", len(slugs), delay)
    for slug in slugs:
        if _MAX_NEW_PER_RUN and len(seen) >= _MAX_NEW_PER_RUN:
            break
        try:
            with tenant_session(slug) as db:
                total += sweep_tenant(db, slug=slug, seen=seen, delay=delay)
        except Exception:
            logger.exception("enrich-sweep: tenant %s failed; skipping", slug)
    logger.info("enrich-sweep: done; %d finding(s) enriched, %d distinct CVE(s) fetched", total, len(seen))
    return total


def _acquire_lock():
    """Single-instance guard. Returns the held file object, or None if another
    invocation holds it (then the caller exits immediately). No-op on platforms
    without fcntl (Windows dev/test) — the box is Linux where it is enforced."""
    try:
        import fcntl  # POSIX only
    except Exception:
        return True  # ponytail: no cross-process lock off-POSIX; prod (Linux) has flock
    fh = open(_LOCK_PATH, "w")
    try:
        fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        fh.close()
        return None
    return fh


def main() -> int:
    # .env is already loaded at module import (see top-of-file note) so DB URLs /
    # NVD_API_KEY are present for this bare systemd oneshot.
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    lock = _acquire_lock()
    if lock is None:
        logger.info("enrich-sweep: another invocation holds the lock; exiting")
        return 0
    try:
        run_sweep()
    except Exception:
        logger.exception("enrich-sweep: unexpected top-level failure")
    finally:
        if lock is not True:
            try:
                lock.close()
            except Exception:
                pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
