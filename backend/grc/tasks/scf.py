"""SCF attestation reminder Celery tasks.

Daily beat fans out per tenant; each tenant task notifies owners/assignees
of controls whose next_due_at is overdue or within 14 days.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ..celery_app import celery_app
from .base import TenantTask

logger = logging.getLogger(__name__)


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.scf.attestation_reminders_for_tenant",
    queue="parsing",
    max_retries=0,
)
def attestation_reminders_for_tenant(self, tenant_slug: str, db: Session = None) -> dict:
    """Notify owners/assignees for due/overdue SCF control attestations."""
    from grc.models import SCFControlState
    from grc.modules.scf.ownership import _as_int_list
    from grc.modules.workflow_engine.services.notification_service import (
        send_workflow_notification,
    )

    now = datetime.utcnow()
    horizon = now + timedelta(days=14)
    rows = (
        db.query(SCFControlState)
        .filter(
            SCFControlState.next_due_at.isnot(None),
            SCFControlState.next_due_at <= horizon,
        )
        .all()
    )

    notified = 0
    for state in rows:
        user_ids = set(_as_int_list(state.assigned_user_ids))
        if state.owner_user_id is not None:
            user_ids.add(int(state.owner_user_id))
        if not user_ids:
            continue
        overdue = state.next_due_at < now
        due_label = state.next_due_at.isoformat() if state.next_due_at else ""
        subject = (
            f"Control {state.scf_id} attestation overdue"
            if overdue
            else f"Control {state.scf_id} attestation due soon"
        )
        message = (
            f"SCF control {state.scf_id} attestation is due on {due_label}."
            + (" This item is overdue." if overdue else "")
        )
        try:
            send_workflow_notification(
                db,
                tenant_id=state.tenant_id,
                subject=subject,
                message=message,
                workflow_instance_id=None,
                user_ids=sorted(user_ids),
                notification_type="warning" if overdue else "info",
            )
            notified += 1
        except Exception:
            logger.exception(
                "attestation reminder failed tenant=%s scf_id=%s",
                tenant_slug, state.scf_id,
            )

    try:
        db.commit()
    except Exception:
        logger.exception("attestation_reminders_for_tenant commit failed tenant=%s", tenant_slug)

    logger.info(
        "attestation_reminders_for_tenant tenant=%s candidates=%d notified=%d",
        tenant_slug, len(rows), notified,
    )
    return {
        "status": "ok",
        "tenant_slug": tenant_slug,
        "candidates": len(rows),
        "notified": notified,
    }


@celery_app.task(
    bind=True,
    name="grc.tasks.scf.daily_attestation_sweep",
    queue="parsing",
    max_retries=0,
)
def daily_attestation_sweep(self) -> dict:
    """Beat-scheduled fan-out: one attestation-reminder task per active tenant."""
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
            attestation_reminders_for_tenant.delay(tenant_slug=slug)
            dispatched += 1
        except Exception:
            logger.exception("daily_attestation_sweep: dispatch failed for tenant=%s", slug)

    logger.info(
        "daily_attestation_sweep DONE: dispatched=%d/%d", dispatched, len(slugs)
    )
    return {"status": "ok", "tenants_dispatched": dispatched}
