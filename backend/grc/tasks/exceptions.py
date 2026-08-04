"""Phase 8 exception-workflow Celery tasks.

One scheduled task today: `expire_due_exceptions_for_tenant`. Walks every
approved exception whose `exception_expires_at` is in the past and
transitions it to `expired`. Fanned out per tenant by
`daily_exception_expiry_sweep`.

Routed to the existing `parsing` queue for now — the work is light, and it
shares a worker with vuln enrichment + patch-intel. When the dedicated
`notification` queue spins up (Track C / future), this task is a natural
first candidate.
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
    name="grc.tasks.exceptions.expire_due_exceptions_for_tenant",
    queue="parsing",
    max_retries=0,
)
def expire_due_exceptions_for_tenant(self, tenant_slug: str, db: Session = None) -> dict:
    """Expire every approved exception that's past its `exception_expires_at`."""
    from ..services.vuln_exception import expire_due_exceptions

    count = expire_due_exceptions(db)
    logger.info(
        "expire_due_exceptions_for_tenant tenant=%s expired=%d",
        tenant_slug, count,
    )
    return {"status": "ok", "tenant_slug": tenant_slug, "expired": count}


@celery_app.task(
    bind=True,
    name="grc.tasks.exceptions.daily_exception_expiry_sweep",
    queue="parsing",
    max_retries=0,
)
def daily_exception_expiry_sweep(self) -> dict:
    """Beat-scheduled fan-out: one expire-sweep task per active tenant.

    Runs on the same 24h cadence as the enrichment + patch-intel refreshes
    so auditors get a single daily cron-style heartbeat that "all the
    overnight work happened."
    """
    from ..db import MasterSession
    from ..models import Tenant

    master = MasterSession()
    try:
        rows = master.query(Tenant.slug).filter(Tenant.is_active.is_(True)).all()
        slugs = [t.slug for t in rows if t.slug]
    finally:
        master.close()

    dispatched = 0
    for slug in slugs:
        try:
            expire_due_exceptions_for_tenant.delay(tenant_slug=slug)
            dispatched += 1
        except Exception:
            logger.exception("daily_exception_expiry_sweep: dispatch failed for tenant=%s", slug)

    logger.info(
        "daily_exception_expiry_sweep DONE: dispatched=%d/%d", dispatched, len(slugs)
    )
    return {"status": "ok", "tenants_dispatched": dispatched}
