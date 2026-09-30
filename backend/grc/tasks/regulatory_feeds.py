"""Scheduled regulatory-feed polling (Thomson Reuters Regulatory Intelligence).

Hourly beat tick → one task per active tenant → polls every active source whose
``poll_interval_hours`` has elapsed. By default ONLY Regulatory Intelligence
sources are auto-polled, so existing RSS/Atom behaviour (manual poll) is
unchanged; set REGULATORY_FEEDS_AUTO_POLL_RSS=1 to schedule RSS/Atom sources too.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from ..celery_app import celery_app
from .base import TenantTask

logger = logging.getLogger(__name__)


def due_sources(db: Session, tenant_id: int, now: datetime = None, include_rss: bool = None):
    from ..models import RegulatoryFeedSource
    from ..modules.governance.routers.regulatory_feeds import TRRI_SOURCE_TYPE

    now = now or datetime.utcnow()
    if include_rss is None:
        include_rss = os.environ.get("REGULATORY_FEEDS_AUTO_POLL_RSS", "").strip() in ("1", "true", "yes")
    q = db.query(RegulatoryFeedSource).filter(
        RegulatoryFeedSource.tenant_id == tenant_id, RegulatoryFeedSource.is_active.is_(True),
    )
    if not include_rss:
        q = q.filter(RegulatoryFeedSource.source_type == TRRI_SOURCE_TYPE)
    out = []
    for s in q.all():
        interval = timedelta(hours=max(1, int(s.poll_interval_hours or 24)))
        if s.last_polled_at is None or now - s.last_polled_at >= interval:
            out.append(s)
    return out


@celery_app.task(
    base=TenantTask,
    bind=True,
    name="grc.tasks.regulatory_feeds.poll_due_feeds_for_tenant",
    queue="parsing",
    max_retries=0,
)
def poll_due_feeds_for_tenant(self, tenant_slug: str, db: Session = None) -> dict:
    from ..models import Tenant
    from ..modules.governance.routers.regulatory_feeds import poll_feed

    tenant = db.query(Tenant).first()
    if not tenant:
        return {"status": "skipped", "reason": "no_tenant"}
    polled = new_items = failures = 0
    for source in due_sources(db, tenant.id):
        try:
            res = poll_feed(source, db, tenant.id)
            polled += 1
            new_items += res.new_items or 0
            failures += 0 if res.success else 1
        except Exception:  # noqa: BLE001 — one bad source must not stop the rest
            db.rollback()
            failures += 1
            logger.exception("regulatory feed poll failed tenant=%s source=%s", tenant_slug, source.id)
    return {"status": "ok", "tenant_slug": tenant_slug, "polled": polled, "new_items": new_items,
            "failures": failures}


@celery_app.task(
    bind=True,
    name="grc.tasks.regulatory_feeds.poll_regulatory_feeds_sweep",
    queue="parsing",
    max_retries=0,
)
def poll_regulatory_feeds_sweep(self) -> dict:
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
            poll_due_feeds_for_tenant.delay(tenant_slug=slug)
            dispatched += 1
        except Exception:
            logger.exception("regulatory feed sweep dispatch failed tenant=%s", slug)
    return {"status": "ok", "tenants_dispatched": dispatched}
