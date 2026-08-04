"""Vulnerability enrichment Celery tasks.

Two tasks, both run on the existing `parsing` queue so no new worker
service is needed:

  * `enrich_vuln_async(tenant_slug, vuln_id)` — single-row enrichment.
    Fired by ingestion adapters (Nessus / Nexpose / NCA bridge) after a new
    vuln row is created, so the API request returns immediately while
    NVD/EPSS/KEV happens in the background.

  * `bulk_enrich_open_vulns(tenant_slug, only_with_cve=True)` — walks every
    open vuln in the tenant and re-runs enrichment on each. Used by:
    - the manual `POST /vulnerabilities/enrich-all` backfill endpoint
    - the daily Celery-beat refresh (so EPSS scores stay current)

Both tasks are best-effort. A failure on one vuln logs + continues; we
never poison-pill the queue.
"""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy.orm import Session

from ..celery_app import celery_app
from .base import TenantTask

logger = logging.getLogger(__name__)


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.vulnerabilities.enrich_vuln",
    queue="parsing",
    max_retries=2,
    default_retry_delay=60,
)
def enrich_vuln(self, tenant_slug: str, vuln_id: int, db: Session = None) -> dict:
    """Async enrichment for a single Vulnerability row.

    Idempotent — calling repeatedly just refreshes the enrichment fields.
    Used by ingestion hooks (`integrations/adapters/*`) and the NCA vuln
    bridge so the user's upload returns immediately.
    """
    from ..models import Vulnerability
    from ..modules.vuln_management.enrichment import enrich_vulnerability

    vuln = db.query(Vulnerability).filter(Vulnerability.id == vuln_id).first()
    if not vuln:
        logger.info("enrich_vuln tenant=%s id=%s — vuln not found, skipping", tenant_slug, vuln_id)
        return {"status": "not_found", "vuln_id": vuln_id}
    try:
        summary = enrich_vulnerability(vuln, db)
    except Exception:
        logger.exception(
            "enrich_vuln failed tenant=%s vuln=%s", tenant_slug, vuln_id
        )
        return {"status": "error", "vuln_id": vuln_id}
    logger.info(
        "enrich_vuln OK tenant=%s vuln=%s kev=%s epss=%s priority=%s",
        tenant_slug, vuln_id, summary.get("kev_flag"),
        summary.get("epss_score"), summary.get("composite_priority"),
    )
    return {"status": "ok", "vuln_id": vuln_id, "summary": summary}


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.vulnerabilities.bulk_enrich_open_vulns",
    queue="parsing",
    max_retries=0,
)
def bulk_enrich_open_vulns(self, tenant_slug: str, only_with_cve: bool = True, db: Session = None) -> dict:
    """Walk every open vuln in the tenant and re-run enrichment.

    The daily Celery-beat refresh calls this with `only_with_cve=True` so
    we only spend time on rows that actually have something to look up.
    EPSS scores change daily, so this refresh is the mechanism that keeps
    the data warm without anyone having to click anything.
    """
    from ..models import Vulnerability
    from ..modules.vuln_management.enrichment import enrich_vulnerability

    # Only re-enrich rows that aren't in a terminal state. SLA-driven
    # remediation isn't affected by enrichment changes, so closed vulns
    # don't need refreshing.
    terminal = (
        "resolved", "remediated", "verified", "closed",
        "accepted", "false_positive", "auto_closed_decommissioned",
    )
    query = db.query(Vulnerability).filter(~Vulnerability.status.in_(terminal))
    if only_with_cve:
        query = query.filter(Vulnerability.cve_id.isnot(None))

    total = 0
    enriched = 0
    failed = 0
    for vuln in query.yield_per(50):
        total += 1
        try:
            enrich_vulnerability(vuln, db)
            enriched += 1
        except Exception:
            failed += 1
            logger.exception(
                "bulk_enrich_open_vulns: row failed tenant=%s vuln=%s",
                tenant_slug, vuln.id,
            )

    logger.info(
        "bulk_enrich_open_vulns DONE tenant=%s total=%d enriched=%d failed=%d",
        tenant_slug, total, enriched, failed,
    )
    return {"status": "ok", "total": total, "enriched": enriched, "failed": failed}


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.vulnerabilities.run_cpe_matcher_for_vuln",
    queue="parsing",
    max_retries=1,
    default_retry_delay=60,
)
def run_cpe_matcher_for_vuln(self, tenant_slug: str, vuln_id: int, db: Session = None) -> dict:
    """Standalone CPE matcher run for one vuln. Used by:
      * the manual "Re-run matcher" admin button on a vuln, and
      * the daily refresh below (so newly registered SoftwareIdentifier
        rows pick up existing open vulns).
    """
    from ..models import Vulnerability
    from ..modules.vuln_management.enrichment.nvd_client import fetch_nvd
    from ..services.cpe_matcher import match_cve_to_asset_ids, write_auto_links

    vuln = db.query(Vulnerability).filter(Vulnerability.id == vuln_id).first()
    if not vuln or not vuln.cve_id:
        return {"status": "skipped", "vuln_id": vuln_id}

    try:
        nvd = fetch_nvd(vuln.cve_id)
    except Exception:
        return {"status": "error", "reason": "nvd_unavailable", "vuln_id": vuln_id}
    if not nvd or not nvd.configurations:
        return {"status": "no_configurations", "vuln_id": vuln_id}

    try:
        asset_ids = match_cve_to_asset_ids(
            db,
            tenant_id=vuln.tenant_id,
            cve_id=vuln.cve_id,
            configurations=nvd.configurations,
        )
        added = write_auto_links(
            db, vuln_id=vuln.id, tenant_id=vuln.tenant_id, asset_ids=asset_ids,
        )
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("run_cpe_matcher_for_vuln failed tenant=%s vuln=%s", tenant_slug, vuln_id)
        return {"status": "error", "reason": "exception", "vuln_id": vuln_id}

    logger.info(
        "run_cpe_matcher_for_vuln tenant=%s vuln=%s added=%d",
        tenant_slug, vuln_id, added,
    )
    return {"status": "ok", "vuln_id": vuln_id, "matches_added": added}


@celery_app.task(
    bind=True,
    name="grc.tasks.vulnerabilities.daily_refresh",
    queue="parsing",
    max_retries=0,
)
def daily_refresh(self) -> dict:
    """Daily refresh: re-download CISA KEV, then dispatch bulk enrichment
    for every active tenant.

    Runs on the Celery beat schedule (typically 02:30 UTC). KEV is loaded
    once for the process — the worker that handles each tenant's bulk job
    re-uses the freshly refreshed in-memory KEV table.
    """
    from ..db import MasterSession
    from ..models import Tenant
    from ..modules.vuln_management.enrichment.kev_cache import refresh_kev_cache

    kev_ok = refresh_kev_cache()
    logger.info("daily_refresh: KEV refresh %s", "OK" if kev_ok else "FAILED")

    master = MasterSession()
    try:
        tenants = master.query(Tenant.slug).filter(Tenant.is_active.is_(True)).all()
        slugs = [t.slug for t in tenants if t.slug]
    finally:
        master.close()

    dispatched = 0
    for slug in slugs:
        try:
            bulk_enrich_open_vulns.delay(tenant_slug=slug, only_with_cve=True)
            dispatched += 1
        except Exception:
            logger.exception("daily_refresh: dispatch failed for tenant=%s", slug)

    logger.info("daily_refresh DONE: kev=%s dispatched=%d/%d", kev_ok, dispatched, len(slugs))
    return {"status": "ok", "kev_refreshed": kev_ok, "tenants_dispatched": dispatched}


@celery_app.task(
    bind=True,
    name="grc.tasks.vulnerabilities.refresh_exploitdb",
    queue="parsing",
    max_retries=0,
)
def refresh_exploitdb(self) -> dict:
    """Weekly refresh of the offline Exploit-DB CVE→exploits mirror.

    Re-downloads OffSec's files_exploits.csv, rewrites
    ``seed_data/exploit_db/cve_exploits.json``, and reloads the in-memory
    cache. Point-in-time by design — the UI surfaces ``generated_at`` so
    operators know how fresh the public-exploit signal is.
    """
    from ..modules.vuln_management.enrichment.exploitdb_cache import (
        cache_status,
        refresh_exploitdb_mirror,
    )

    ok = refresh_exploitdb_mirror()
    status = cache_status()
    logger.info(
        "refresh_exploitdb: %s generated_at=%s distinct=%s",
        "OK" if ok else "FAILED",
        status.get("generated_at"),
        (status.get("counts") or {}).get("distinct_cves"),
    )
    return {
        "status": "ok" if ok else "error",
        "generated_at": status.get("generated_at"),
        "counts": status.get("counts") or {},
    }
