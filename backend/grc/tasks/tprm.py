"""TPRM risk-snapshot Celery tasks.

The dashboard's "risk over time" trend and the "rating never goes stale" promise
depend on a real time-series. Snapshots are written event-driven on score and
finding-close (in the TPRA service); this module adds the DAILY portfolio + per-
vendor snapshot so the trend keeps moving even when nothing was assessed that day.

Fanned out per tenant by `daily_tprm_snapshot_sweep`, mirroring the existing
exception-expiry sweep. Routed to the `parsing` queue (light work).
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
    name="grc.tasks.tprm.write_tprm_snapshot_for_tenant",
    queue="parsing",
    max_retries=0,
)
def write_tprm_snapshot_for_tenant(self, tenant_slug: str, db: Session = None) -> dict:
    """Write one portfolio snapshot + a per-vendor snapshot for every active
    (non-retired) vendor in the tenant."""
    from ..modules.vendor_risk.tpra.engine_snapshots import (
        write_portfolio_snapshot, write_vendor_snapshot,
    )
    from ..models import Vendor, Tenant

    tenant = db.query(Tenant).first()
    if not tenant:
        return {"status": "skipped", "tenant_slug": tenant_slug, "reason": "no_tenant"}
    tenant_id = tenant.id

    write_portfolio_snapshot(db, tenant_id, source="schedule")
    vendors = db.query(Vendor).filter(
        Vendor.tenant_id == tenant_id, Vendor.status != "retired",
    ).all()
    for v in vendors:
        try:
            write_vendor_snapshot(db, v, assessment=None, source="schedule")
        except Exception:
            logger.exception("tprm snapshot failed for vendor=%s", getattr(v, "id", "?"))
    db.commit()

    # Dashboard history layer (DASH-001): also capture today's reconciled portfolio
    # KPI snapshot here so it runs daily on the same per-tenant fan-out.
    try:
        from ..services.metric_snapshots import write_daily
        write_daily(db, tenant_id)
    except Exception:
        logger.exception("metric snapshot failed for tenant=%s", tenant_slug)

    logger.info("write_tprm_snapshot_for_tenant tenant=%s vendors=%d", tenant_slug, len(vendors))
    return {"status": "ok", "tenant_slug": tenant_slug, "vendors": len(vendors)}


@celery_app.task(
    bind=True,
    name="grc.tasks.tprm.daily_tprm_snapshot_sweep",
    queue="parsing",
    max_retries=0,
)
def daily_tprm_snapshot_sweep(self) -> dict:
    """Beat-scheduled fan-out: one snapshot task per active tenant."""
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
            write_tprm_snapshot_for_tenant.delay(tenant_slug=slug)
            dispatched += 1
        except Exception:
            logger.exception("daily_tprm_snapshot_sweep: dispatch failed for tenant=%s", slug)
    logger.info("daily_tprm_snapshot_sweep DONE: dispatched=%d/%d", dispatched, len(slugs))
    return {"status": "ok", "tenants_dispatched": dispatched}


# ── Continuous-monitoring connector poll (Wave 4 scaffolding) ─────────────────

@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.tprm.poll_monitoring_connectors_for_tenant",
    queue="parsing",
    max_retries=0,
)
def poll_monitoring_connectors_for_tenant(self, tenant_slug: str, db: Session = None) -> dict:
    """Poll every configured live monitoring connector for one tenant. A no-op until
    a provider + credentials are registered in tpra.monitoring_connectors.CONNECTORS."""
    from ..models import Tenant
    from ..modules.vendor_risk.tpra.monitoring_connectors import run_connectors

    tenant = db.query(Tenant).first()
    if not tenant:
        return {"status": "skipped", "tenant_slug": tenant_slug, "reason": "no_tenant"}
    result = run_connectors(db, tenant.id)
    db.commit()
    return {"status": "ok", "tenant_slug": tenant_slug, **result}


@celery_app.task(
    bind=True,
    name="grc.tasks.tprm.poll_monitoring_connectors_sweep",
    queue="parsing",
    max_retries=0,
)
def poll_monitoring_connectors_sweep(self) -> dict:
    """Beat-scheduled fan-out: one connector-poll task per active tenant."""
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
            poll_monitoring_connectors_for_tenant.delay(tenant_slug=slug)
            dispatched += 1
        except Exception:
            logger.exception("poll_monitoring_connectors_sweep: dispatch failed for tenant=%s", slug)
    return {"status": "ok", "tenants_dispatched": dispatched}


# ── Questionnaire invite email (Wave 4 scaffolding) ──────────────────────────

@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.tprm.send_questionnaire_invite",
    queue="parsing",
    max_retries=3,
    default_retry_delay=300,
)
def send_questionnaire_invite(self, tenant_slug: str, response_id: int,
                              base_url: str = "", is_reminder: bool = False, db: Session = None) -> dict:
    """Email a vendor their questionnaire portal link. Reuses the platform SMTP
    helper (tenant config or SMTP_* env). Graceful: if email isn't configured it
    returns success=False and the analyst still has the copyable link — 'Generate
    link' never depends on this succeeding."""
    from ..models import VendorQuestionnaireResponse, Tenant, Vendor
    from ..modules.workflow_engine.services.email_service import send_email

    qr = db.query(VendorQuestionnaireResponse).filter(
        VendorQuestionnaireResponse.id == response_id).first()
    if not qr or not qr.respondent_email or not qr.token:
        return {"status": "skipped", "reason": "no_recipient_or_token"}
    tenant = db.query(Tenant).first()
    vendor = db.query(Vendor).filter(Vendor.id == qr.vendor_id).first()
    vendor_name = vendor.name if vendor else "your organization"
    link = f"{(base_url or '').rstrip('/')}/vendor-risk/questionnaires/{qr.token}"
    verb = "Reminder: please complete" if is_reminder else "Please complete"
    subject = f"{'Reminder — ' if is_reminder else ''}Security questionnaire for {vendor_name}"
    body_html = (
        f"<p>Hello,</p><p>{verb} the security assessment questionnaire for "
        f"<strong>{vendor_name}</strong>.</p>"
        f'<p><a href="{link}">Open the questionnaire</a></p>'
        f"<p>Or paste this link into your browser:<br>{link}</p>"
    )
    body_text = f"{verb} the security questionnaire for {vendor_name}: {link}"
    result = send_email(db, tenant.id if tenant else qr.tenant_id, qr.respondent_email,
                        subject, body_html, body_text)
    if result.get("success"):
        logger.info("questionnaire invite sent response=%s reminder=%s", response_id, is_reminder)
    else:
        logger.warning("questionnaire invite NOT sent (email not configured?) response=%s: %s",
                       response_id, result.get("message"))
    return {"status": "sent" if result.get("success") else "not_configured", **result}
