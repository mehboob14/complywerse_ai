"""Governance documents: daily reminders, overdue notices and escalation for approvals and acknowledgements.

Daily beat fans out per tenant; a tenant without document lifecycle (config.DOCUMENT_LIFECYCLE_TENANTS) does nothing.
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..celery_app import celery_app
from .base import TenantTask

logger = logging.getLogger(__name__)


@celery_app.task(base=TenantTask, bind=True, name="grc.tasks.document_lifecycle.sweep_tenant", queue="parsing", max_retries=0)
def sweep_tenant(self, tenant_slug: str, db: Session = None) -> dict:
    from grc.modules.governance import doc_lifecycle

    result = doc_lifecycle.sweep(db)
    logger.info("document_lifecycle.sweep tenant=%s %s", tenant_slug, result)
    return {"status": "ok", "tenant_slug": tenant_slug, **result}


@celery_app.task(bind=True, name="grc.tasks.document_lifecycle.daily_sweep", queue="parsing", max_retries=0)
def daily_sweep(self) -> dict:
    """Beat-scheduled fan-out: one sweep task per active tenant."""
    from ..db import MasterSession
    from ..models import Tenant

    master = MasterSession()
    try:
        slugs = [t.slug for t in master.query(Tenant.slug).filter(Tenant.is_active.is_(True)).all() if t.slug]
    finally:
        master.close()
    dispatched = 0
    for slug in slugs:
        try:
            sweep_tenant.delay(tenant_slug=slug)
            dispatched += 1
        except Exception:
            logger.exception("document_lifecycle.daily_sweep: dispatch failed tenant=%s", slug)
    return {"status": "ok", "tenants_dispatched": dispatched}
