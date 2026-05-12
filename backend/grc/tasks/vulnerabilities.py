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
    terminal = ("resolved", "remediated", "verified", "closed", "accepted", "false_positive")
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
