"""Celery beat fan-out that fires due scheduled reports - NOT WIRED YET.

Nothing imports this module until grc/celery_app.py lists it in `include=[...]`, so
shipping the file changes no behaviour. To switch timed delivery on, add to
grc/celery_app.py:

    include=[ ..., "grc.modules.report_scheduler.tasks" ],

    beat_schedule={ ...,
        "scheduled-reports-fan-out": {
            "task": "grc.modules.report_scheduler.tasks.scheduled_reports_fan_out",
            "schedule": 5 * 60,                      # a due schedule goes out within ~5 min
            "options": {"queue": "parsing"},
        },
    },

and make sure a worker consuming the `parsing` queue plus the beat container are running
(same as discovery's scheduled fan-out, whose shape this mirrors).

Layers:
  * scheduled_reports_fan_out  - beat tick: walks every active tenant, CLAIMS due schedules
                                 (next_run advanced with a compare-and-set UPDATE, so a
                                 double tick / second worker cannot double-send) and
                                 dispatches one task per claimed schedule.
  * run_scheduled_report_task  - sends one claimed schedule (generate + email).
Best-effort: one tenant's or one schedule's failure logs and moves on.
"""
from __future__ import annotations

import logging
from datetime import datetime

from grc.celery_app import celery_app

from . import service
from .models import ScheduledReport

logger = logging.getLogger(__name__)


@celery_app.task(
    bind=True,
    name="grc.modules.report_scheduler.tasks.run_scheduled_report_task",
    queue="parsing",
    max_retries=0,
)
def run_scheduled_report_task(self, tenant_slug: str, schedule_id: int) -> dict:
    from grc.db import open_tenant_session

    db = open_tenant_session(tenant_slug)
    try:
        row = db.query(ScheduledReport).filter(ScheduledReport.id == schedule_id).first()
        if row is None:
            return {"status": "not_found", "schedule_id": schedule_id}
        res = service.run_schedule(db, row, trigger="scheduled")
        return {"status": "sent" if res["ok"] else "error", "schedule_id": schedule_id,
                "message": res["message"]}
    except Exception:  # noqa: BLE001
        logger.exception("scheduled report failed slug=%s schedule=%s", tenant_slug, schedule_id)
        return {"status": "error", "schedule_id": schedule_id}
    finally:
        db.close()


@celery_app.task(
    bind=True,
    name="grc.modules.report_scheduler.tasks.scheduled_reports_fan_out",
    queue="parsing",
    max_retries=0,
)
def scheduled_reports_fan_out(self) -> dict:
    """Beat tick: claim and dispatch due scheduled reports for every active tenant."""
    from grc.db import MasterSession, open_tenant_session
    from grc.models import Tenant

    now = datetime.utcnow()
    master = MasterSession()
    try:
        slugs = [t.slug for t in master.query(Tenant.slug).filter(Tenant.is_active.is_(True)).all() if t.slug]
    finally:
        master.close()

    dispatched = 0
    for slug in slugs:
        try:
            db = open_tenant_session(slug)
        except Exception:  # noqa: BLE001
            logger.exception("scheduled reports fan-out: tenant session failed slug=%s", slug)
            continue
        try:
            for sid in service.claim_due(db, now):
                try:
                    run_scheduled_report_task.delay(tenant_slug=slug, schedule_id=sid)
                    dispatched += 1
                except Exception:  # noqa: BLE001
                    logger.exception("scheduled reports fan-out: dispatch failed slug=%s schedule=%s", slug, sid)
        except Exception:  # noqa: BLE001
            logger.exception("scheduled reports fan-out: per-tenant failure slug=%s", slug)
        finally:
            db.close()

    logger.info("scheduled_reports_fan_out DONE dispatched=%d", dispatched)
    return {"status": "ok", "dispatched": dispatched}
