"""Scheduled evidence collection for connected collectors.

An automated test only shows a control is operating if it keeps running.
Collection used to happen only when someone pressed Collect or Run tests, so a
result quietly aged past its control's reassessment window. The beat sweep runs
every hour; each connected collector is collected again once its last run is 20
hours old, which is daily without repeating a run someone just started by hand.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from ..celery_app import celery_app
from .base import TenantTask

logger = logging.getLogger(__name__)

#: Collect again once the latest run is at least this old.
DUE_AFTER = timedelta(hours=20)


def is_due(last_started_at: Optional[datetime], now: datetime, due_after: timedelta = DUE_AFTER) -> bool:
    return last_started_at is None or now - last_started_at >= due_after


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.evidence_collectors.collect_for_tenant",
    queue="parsing",
    max_retries=0,
)
def collect_for_tenant(self, tenant_slug: str, db: Session = None) -> dict:
    """Run every connected collector in one tenant whose latest run is due."""
    from sqlalchemy import desc

    from grc.models import CompliancePluginRun, IntegrationConnection
    from grc.modules.automation.router import _connector_plugin
    from grc.modules.compliance_plugins.runners.live_api_catalog import PROVIDER_API
    from grc.modules.compliance_plugins.services.run_service import execute_plugin

    now = datetime.utcnow()
    counts = {"ran": 0, "not_due": 0, "failed": 0}
    connections = (
        db.query(IntegrationConnection)
        .filter(IntegrationConnection.is_active.is_(True),
                IntegrationConnection.integration_type.in_(list(PROVIDER_API)))
        .all()
    )
    for conn in connections:
        plugin = _connector_plugin(db, conn.integration_type)
        if plugin is None:
            continue
        last = (
            db.query(CompliancePluginRun.started_at)
            .filter(CompliancePluginRun.tenant_id == conn.tenant_id,
                    CompliancePluginRun.plugin_id == plugin.id)
            .order_by(desc(CompliancePluginRun.started_at))
            .first()
        )
        if not is_due(last[0] if last else None, now):
            counts["not_due"] += 1
            continue
        try:
            execute_plugin(db, tenant_id=conn.tenant_id, user_id=None, plugin=plugin,
                           asset=None, connection=conn, triggered_by="schedule")
            counts["ran"] += 1
        except Exception:
            # one broken collector must not stop the others collecting
            db.rollback()
            counts["failed"] += 1
            logger.exception("scheduled collection failed tenant=%s provider=%s",
                             tenant_slug, conn.integration_type)
    logger.info("collect_for_tenant tenant=%s %s", tenant_slug, counts)
    return {"status": "ok", "tenant_slug": tenant_slug, **counts}


@celery_app.task(
    bind=True,
    name="grc.tasks.evidence_collectors.hourly_sweep",
    queue="parsing",
    max_retries=0,
)
def hourly_sweep(self) -> dict:
    """Beat-scheduled fan-out: one collection task per active tenant."""
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
            collect_for_tenant.delay(tenant_slug=slug)
            dispatched += 1
        except Exception:
            logger.exception("evidence collection dispatch failed tenant=%s", slug)
    return {"status": "ok", "dispatched": dispatched}
