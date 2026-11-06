"""Audit issue register: daily due / past-due reminders.

Daily beat fans out per tenant; each tenant task tells owners about register
findings coming due within 14 days or past due (at most weekly per finding),
and escalates the long-overdue ones to Audit Services. In-app only: the
register's own button can send email as well.
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
    name="grc.tasks.audit_register.reminders_for_tenant",
    queue="parsing",
    max_retries=0,
)
def reminders_for_tenant(self, tenant_slug: str, db: Session = None) -> dict:
    from grc.models import AuditIssueProfile, Tenant
    from grc.modules.issue_management.audit_register.workflow import send_reminders
    from grc.rich_audit import write_rich_audit_log

    if not db.query(AuditIssueProfile.id).first():
        return {"status": "ok", "tenant_slug": tenant_slug, "skipped": "no register"}
    tenant = db.query(Tenant).first()
    result = send_reminders(db, tenant.id)
    if result["owners"]:
        write_rich_audit_log(
            db=db, tenant_id=tenant.id, user_id=None, action="reminders_sent",
            resource_type="audit-register", actor_type="system", actor_source="scheduler",
            actor_display="Scheduler (daily reminders)",
            summary=(f"Daily reminders: {result['owners']} owner(s) told about "
                     f"{result['due_soon'] + result['past_due']} finding(s)"
                     + (f"; {result['escalated']} escalated to Audit Services" if result["escalated"] else "")),
            after={k: result[k] for k in ("due_soon", "past_due", "owners", "escalated")})
    db.commit()
    logger.info("audit_register.reminders tenant=%s due_soon=%s past_due=%s escalated=%s",
                tenant_slug, result["due_soon"], result["past_due"], result["escalated"])
    return {"status": "ok", "tenant_slug": tenant_slug,
            **{k: result[k] for k in ("due_soon", "past_due", "owners", "escalated")}}


@celery_app.task(
    bind=True,
    name="grc.tasks.audit_register.daily_reminder_sweep",
    queue="parsing",
    max_retries=0,
)
def daily_reminder_sweep(self) -> dict:
    """Beat-scheduled fan-out: one reminder task per active tenant."""
    from ..db import MasterSession
    from ..models import Tenant

    master = MasterSession()
    try:
        slugs = [t.slug for t in master.query(Tenant.slug).filter(Tenant.is_active.is_(True)).all()
                 if t.slug]
    finally:
        master.close()
    dispatched = 0
    for slug in slugs:
        try:
            reminders_for_tenant.delay(tenant_slug=slug)
            dispatched += 1
        except Exception:
            logger.exception("audit_register.daily_reminder_sweep: dispatch failed tenant=%s", slug)
    return {"status": "ok", "tenants_dispatched": dispatched}
