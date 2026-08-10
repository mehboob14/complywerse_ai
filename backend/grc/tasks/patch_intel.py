"""Phase 6 patch-intelligence Celery tasks.

Three tasks, currently routed to the existing `parsing` queue (same worker
that handles vuln enrichment). When the dedicated `enrichment` queue spins
up (Track C / Phase 6+), these are the first tasks to migrate — that's a
one-line change in `celery_app.py`.

  * `sync_msrc_vuln(tenant_slug, vuln_id)` — single-row MSRC sync. Wired up
    so future ingestion hooks can dispatch it after a new vuln lands; for
    now used by the bulk task below.

  * `bulk_sync_msrc(tenant_slug)` — walks every open vuln in the tenant
    with a CVE ID and asks MSRC for each. Skips rows already synced within
    `MIN_RESYNC_DAYS` to keep the work bounded.

  * `daily_patch_intel_refresh()` — beat-scheduled fan-out, one
    `bulk_sync_msrc` per tenant. Pairs with the existing daily enrichment
    refresh so KEV / EPSS / patch info all stay current.

All tasks are best-effort. A failure on one vuln logs + continues; we
never poison-pill the queue.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from ..celery_app import celery_app
from .base import TenantTask

logger = logging.getLogger(__name__)

# Skip re-syncing a vuln whose `psirt_synced_at` is fresher than this.
# Microsoft's KB → CVE map is essentially immutable post-disclosure, so a
# 7-day window keeps the work bounded without sacrificing freshness.
MIN_RESYNC_DAYS = 7


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.patch_intel.sync_msrc_vuln",
    queue="parsing",
    max_retries=2,
    default_retry_delay=60,
)
def sync_msrc_vuln(self, tenant_slug: str, vuln_id: int, db: Session = None) -> dict:
    """Async MSRC sync for a single Vulnerability row.

    Idempotent — re-syncing replaces this row's MSRC entries with fresh ones
    while preserving entries from other PSIRTs (once those land).
    """
    from ..models import Vulnerability
    from ..modules.vuln_management.patch_intel import sync_patch_intel

    vuln = db.query(Vulnerability).filter(Vulnerability.id == vuln_id).first()
    if not vuln:
        logger.info("sync_msrc_vuln tenant=%s id=%s — vuln not found, skipping", tenant_slug, vuln_id)
        return {"status": "not_found", "vuln_id": vuln_id}
    try:
        summary = sync_patch_intel(vuln, db)
    except Exception:
        logger.exception(
            "sync_msrc_vuln failed tenant=%s vuln=%s", tenant_slug, vuln_id
        )
        return {"status": "error", "vuln_id": vuln_id}
    logger.info(
        "sync_msrc_vuln OK tenant=%s vuln=%s source=%s kb=%d advisories=%d",
        tenant_slug, vuln_id, summary.get("psirt_source"),
        summary.get("kb_count", 0), summary.get("advisory_count", 0),
    )
    return {"status": "ok", "vuln_id": vuln_id, "summary": summary}


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.patch_intel.bulk_sync_msrc",
    queue="parsing",
    max_retries=0,
)
def bulk_sync_msrc(self, tenant_slug: str, force: bool = False, db: Session = None) -> dict:
    """Walk every open CVE-bearing vuln in the tenant and sync MSRC patch info.

    `force=False` (default) skips rows synced within MIN_RESYNC_DAYS so the
    daily beat job stays bounded. `force=True` is for the manual
    "Sync All Patch Info" backfill endpoint.
    """
    from ..models import Vulnerability
    from ..modules.vuln_management.patch_intel import sync_patch_intel

    terminal = (
        "resolved", "remediated", "verified", "closed",
        "accepted", "false_positive", "auto_closed_decommissioned",
        "auto_closed_fixed",
    )
    query = (
        db.query(Vulnerability)
        .filter(~Vulnerability.status.in_(terminal))
        .filter(Vulnerability.cve_id.isnot(None))
    )
    if not force:
        cutoff = datetime.utcnow() - timedelta(days=MIN_RESYNC_DAYS)
        # Refresh rows that have never been synced (NULL) or are stale.
        query = query.filter(
            (Vulnerability.psirt_synced_at.is_(None))
            | (Vulnerability.psirt_synced_at < cutoff)
        )

    total = 0
    synced = 0
    failed = 0
    skipped_not_msft = 0
    for vuln in query.yield_per(50):
        total += 1
        try:
            summary = sync_patch_intel(vuln, db)
            if "not_a_microsoft_cve" in (summary.get("errors") or []):
                skipped_not_msft += 1
            else:
                synced += 1
        except Exception:
            failed += 1
            logger.exception(
                "bulk_sync_msrc: row failed tenant=%s vuln=%s",
                tenant_slug, vuln.id,
            )

    logger.info(
        "bulk_sync_msrc DONE tenant=%s total=%d synced=%d non_msft=%d failed=%d",
        tenant_slug, total, synced, skipped_not_msft, failed,
    )
    return {
        "status": "ok",
        "total": total,
        "synced": synced,
        "non_microsoft": skipped_not_msft,
        "failed": failed,
    }


@celery_app.task(
    bind=True,
    name="grc.tasks.patch_intel.daily_patch_intel_refresh",
    queue="parsing",
    max_retries=0,
)
def daily_patch_intel_refresh(self) -> dict:
    """Daily fan-out: dispatch `bulk_sync_msrc` for every active tenant.

    Runs on the Celery beat schedule alongside the daily enrichment refresh
    so KEV / EPSS / MSRC patch info all stay current on the same cadence.
    """
    from ..db import MasterSession
    from ..models import Tenant

    master = MasterSession()
    try:
        tenants = master.query(Tenant.slug).filter(Tenant.is_active.is_(True)).all()
        slugs = [t.slug for t in tenants if t.slug]
    finally:
        master.close()

    dispatched = 0
    for slug in slugs:
        try:
            bulk_sync_msrc.delay(tenant_slug=slug, force=False)
            dispatched += 1
        except Exception:
            logger.exception("daily_patch_intel_refresh: dispatch failed for tenant=%s", slug)

    logger.info(
        "daily_patch_intel_refresh DONE: dispatched=%d/%d", dispatched, len(slugs)
    )
    return {"status": "ok", "tenants_dispatched": dispatched}
