"""RCSA: daily reminders for overdue self-assessments.

Daily beat fans out per tenant; each tenant task reminds the assessor of every assessment still open after its active
campaign's due date, and past the campaign's grace period (escalation_days_after) tells the RCSA approver too: the
first approval tier's approver, else whoever set the campaign up. In-app, and by email where SMTP is set.
"""
from __future__ import annotations

import logging

from sqlalchemy.orm import Session

from ..celery_app import celery_app
from .base import TenantTask

logger = logging.getLogger(__name__)


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.rcsa_reminders.reminders_for_tenant",
    queue="parsing",
    max_retries=0,
)
def reminders_for_tenant(self, tenant_slug: str, db: Session = None) -> dict:
    from grc.models import Tenant
    from grc.modules.erm.routers.rcsa import send_overdue_reminders

    tenant = db.query(Tenant).first()
    if tenant is None:
        return {"status": "ok", "tenant_slug": tenant_slug, "skipped": "no tenant"}
    result = send_overdue_reminders(db, [tenant.id])
    logger.info("rcsa_reminders tenant=%s reminded=%s escalated=%s", tenant_slug, result["reminded"], result["escalated"])
    return {"status": "ok", "tenant_slug": tenant_slug, **result}


@celery_app.task(
    bind=True,
    name="grc.tasks.rcsa_reminders.daily_reminder_sweep",
    queue="parsing",
    max_retries=0,
)
def daily_reminder_sweep(self) -> dict:
    """Beat-scheduled fan-out: one reminder task per active tenant."""
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
            reminders_for_tenant.delay(tenant_slug=slug)
            dispatched += 1
        except Exception:
            logger.exception("rcsa_reminders.daily_reminder_sweep: dispatch failed tenant=%s", slug)
    return {"status": "ok", "tenants_dispatched": dispatched}
