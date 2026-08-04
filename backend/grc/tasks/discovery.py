"""Scheduled discovery — Celery beat fan-out that runs due campaigns unattended.

Layers (mirrors tasks/cloud_sync.py):

  * due_campaign_ids(db, now)           — pure selection: which campaigns are
                                          eligible to run right now. Testable
                                          without Celery or a broker.
  * run_discovery_campaign_task(slug,id) — one campaign: create a run + execute
                                          it. Fired per due campaign by the
                                          fan-out (and reusable on demand).
  * discovery_scheduled_fan_out()        — beat-scheduled tick. Per tenant, picks
                                          due campaigns, advances next_run_at so
                                          the same campaign isn't double-fired,
                                          and dispatches a task per campaign.

Eligibility (all must hold): the campaign is active, has a schedule, is due
(next_run_at unset or in the past), has at least one runnable network scope, is
NOT inside a blackout window, and has no run already in flight. Blackout / in-
flight campaigns are skipped WITHOUT advancing next_run_at, so they fire as soon
as the window lifts / the current run finishes.

Best-effort: a single campaign's failure logs and continues — never poisons the
queue.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import List, Optional

from sqlalchemy.orm import Session

from ..celery_app import celery_app

logger = logging.getLogger(__name__)


def _has_runnable_scope(campaign) -> bool:
    include = [s for s in campaign.scopes if not s.exclude]
    return any(s.kind in ("cidr", "ip_range") for s in include)


def _has_inflight_run(db: Session, campaign_id: int) -> bool:
    from ..models import DiscoveryRun
    return db.query(DiscoveryRun.id).filter(
        DiscoveryRun.campaign_id == campaign_id,
        DiscoveryRun.status.in_(("queued", "running")),
    ).first() is not None


def due_campaign_ids(db: Session, now: Optional[datetime] = None) -> List[int]:
    """Campaigns eligible to run right now, in this tenant DB. Pure read — no
    side effects — so the fan-out and the tests can both call it."""
    from ..models import DiscoveryCampaign
    from ..modules.asset_discovery.services.executor import is_in_blackout

    now = now or datetime.utcnow()
    campaigns = db.query(DiscoveryCampaign).filter(
        DiscoveryCampaign.is_active.is_(True),
        DiscoveryCampaign.schedule_seconds.isnot(None),
    ).all()

    due: List[int] = []
    for c in campaigns:
        if c.next_run_at is not None and c.next_run_at > now:
            continue  # not due yet
        if not _has_runnable_scope(c):
            continue  # nothing a network sweep can act on
        if is_in_blackout(c, now):
            continue  # change freeze / quiet hours — try again next tick
        if _has_inflight_run(db, c.id):
            continue  # a previous run is still going
        due.append(c.id)
    return due


def run_discovery_campaign(db: Session, campaign_id: int) -> dict:
    """Create + execute one scheduled run. Synchronous body shared by the task."""
    from ..models import DiscoveryCampaign
    from ..modules.asset_discovery.services.executor import create_run, execute_run

    campaign = db.get(DiscoveryCampaign, campaign_id)
    if campaign is None:
        return {"status": "not_found", "campaign_id": campaign_id}
    run = create_run(db, campaign, trigger="scheduled")
    execute_run(db, run.id)
    finished = db.get(DiscoveryCampaign, campaign_id)  # re-read (execute_run committed)
    return {"status": "ok", "campaign_id": campaign_id, "run_id": run.id,
            "run_status": db.get(type(run), run.id).status}


@celery_app.task(
    bind=True,
    name="grc.tasks.discovery.run_discovery_campaign_task",
    queue="parsing",
    max_retries=0,
)
def run_discovery_campaign_task(self, tenant_slug: str, campaign_id: int) -> dict:
    from ..db import get_tenant_session_factory
    db = get_tenant_session_factory(tenant_slug)()
    try:
        return run_discovery_campaign(db, campaign_id)
    except Exception:
        logger.exception("scheduled discovery run failed slug=%s campaign=%s",
                         tenant_slug, campaign_id)
        return {"status": "error", "campaign_id": campaign_id}
    finally:
        db.close()


def _fan_out_one_tenant(db: Session, tenant_slug: str, now: datetime) -> int:
    """Dispatch a task per due campaign and advance its next_run_at so the next
    tick doesn't re-fire it. Advancing at dispatch (not completion) is
    deliberate — the in-flight guard stops overlap if a run outlasts its
    interval."""
    from ..models import DiscoveryCampaign

    ids = due_campaign_ids(db, now)
    dispatched = 0
    for cid in ids:
        campaign = db.get(DiscoveryCampaign, cid)
        if campaign is None:
            continue
        campaign.next_run_at = now + timedelta(seconds=campaign.schedule_seconds or 3600)
        db.commit()
        try:
            run_discovery_campaign_task.delay(tenant_slug=tenant_slug, campaign_id=cid)
            dispatched += 1
        except Exception:
            logger.exception("discovery fan-out dispatch failed slug=%s campaign=%s",
                             tenant_slug, cid)
    return dispatched


@celery_app.task(
    bind=True,
    name="grc.tasks.discovery.discovery_scheduled_fan_out",
    queue="parsing",
    max_retries=0,
)
def discovery_scheduled_fan_out(self) -> dict:
    """Beat tick: walk every active tenant, dispatch due campaigns."""
    from ..db import MasterSession, get_tenant_session_factory
    from ..models import Tenant

    now = datetime.utcnow()
    master = MasterSession()
    try:
        slugs = [t.slug for t in master.query(Tenant.slug)
                 .filter(Tenant.is_active.is_(True)).all() if t.slug]
    finally:
        master.close()

    total = 0
    for slug in slugs:
        try:
            db = get_tenant_session_factory(slug)()
        except Exception:
            logger.exception("discovery fan-out: tenant session failed slug=%s", slug)
            continue
        try:
            total += _fan_out_one_tenant(db, slug, now)
        except Exception:
            logger.exception("discovery fan-out: per-tenant failed slug=%s", slug)
        finally:
            db.close()

    logger.info("discovery_scheduled_fan_out DONE dispatched=%d", total)
    return {"status": "ok", "dispatched": total}
