"""
Celery application for the GRC platform.

Production-grade job runtime configured for the multi-tenant
per-database-per-tenant architecture:

  * Redis as broker AND result backend (different DB indices to keep keys
    namespaced cleanly).
  * Late acknowledgements + reject_on_worker_lost so a worker crash mid-task
    doesn't lose the work — the message is requeued.
  * Per-task time limits (soft + hard) so a runaway LLM call can't hang a
    worker forever.
  * Visibility timeout sized for our longest task (framework parse can take
    ~10 minutes), so tasks aren't redelivered while still running.
  * Worker prefetch=1 so a slow tenant doesn't reserve a queue of fast jobs
    behind a long one (fair queueing).
  * Task autodiscovery from `grc.tasks` modules.

Workers should always be started against the same code tree so import paths
match (no remote-only handlers).
"""

from __future__ import annotations

import logging
import os
from typing import Any

from celery import Celery
from celery.signals import (
    setup_logging,
    task_failure,
    task_prerun,
    task_postrun,
    worker_process_init,
)
from dotenv import load_dotenv

# Load the same .env the FastAPI app uses so workers see DB URLs, secrets, etc.
load_dotenv()

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")
BROKER_URL = os.getenv("CELERY_BROKER_URL", "redis://127.0.0.1:6379/1")
RESULT_BACKEND = os.getenv("CELERY_RESULT_BACKEND", "redis://127.0.0.1:6379/2")


celery_app = Celery(
    "grc",
    broker=BROKER_URL,
    backend=RESULT_BACKEND,
    include=[
        "grc.tasks.base",
        "grc.tasks.governance",
        "grc.tasks.frameworks",
        "grc.tasks.control_library",
        # Vulnerability enrichment — dispatched by ingestion adapters and the
        # daily beat refresh. Runs on the existing `parsing` queue so no new
        # worker service is required.
        "grc.tasks.vulnerabilities",
        # Phase 6 — Vendor patch intelligence (MSRC). Shares the parsing
        # queue with vuln enrichment until the dedicated `enrichment` queue
        # spins up (Track C).
        "grc.tasks.patch_intel",
        # Phase 8 — Exception workflow expiry sweep. Light per-tenant
        # task that fans out daily; lives on `parsing` until the dedicated
        # `notification` queue spins up.
        "grc.tasks.exceptions",
        # Phase 7 — Cloud connector sync. Lives on `parsing` until the
        # dedicated `sync` queue spins up.
        "grc.tasks.cloud_sync",
        # External connector framework — Ticketing/SIEM/Pen-test/Collab/Transcribe.
        "grc.tasks.connectors",
        # Async AI document drafting — moves the multi-stage pipeline off the
        # request thread so it can't time out at the HTTP layer.
        "grc.tasks.ai_drafting",
    ],
)

celery_app.conf.update(
    # ── Serialization ────────────────────────────────────────────────────────
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,

    # ── Reliability ──────────────────────────────────────────────────────────
    # Don't ack a task until the handler returns. If a worker dies mid-task,
    # the broker redelivers the message to another worker.
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,

    # Result lifetime: 24h. Keep just long enough for a UI to poll status.
    result_expires=24 * 60 * 60,
    result_extended=True,

    # ── Time limits ──────────────────────────────────────────────────────────
    # Soft limit raises an exception inside the task (clean cleanup possible).
    # Hard limit kills the worker process (protection against true hangs).
    task_soft_time_limit=15 * 60,   # 15 min
    task_time_limit=20 * 60,        # 20 min
    # Visibility timeout must be >= longest expected task so Redis doesn't
    # redeliver a still-running message to another worker.
    broker_transport_options={
        "visibility_timeout": 30 * 60,  # 30 min
    },

    # ── Routing ──────────────────────────────────────────────────────────────
    # Queue inventory (worker -Q flag should subscribe to the relevant set):
    #   default       — short interactive tasks (<5s)
    #   parsing       — long AI-heavy tasks (framework parse, gap analysis)
    #   maintenance   — periodic / housekeeping
    #   enrichment    — Track C (Phase 5+): NVD/EPSS/KEV/MSRC + future cloud
    #                   enrichment HTTP work. Currently empty; vuln enrichment
    #                   shares `parsing` for backward compat. Future phases
    #                   (6 MSRC patch sync, 9 reporting aggregations) will
    #                   route their tasks here so they don't compete with
    #                   AI parse runs for worker slots.
    #   sync          — Track C (Phase 7): cloud asset/vulnerability sync
    #                   (AWS Inspector, Azure Defender, GCP SCC). Long-poll
    #                   work that benefits from a dedicated worker pool.
    #   notification  — Track C (Phase 8): exception-expiry notifications,
    #                   stale-asset reminders, scheduled report emails. Short
    #                   bursts of fan-out, isolated so a stuck email send
    #                   can't block enrichment or sync work.
    # No existing routes are changed below — `parsing` keeps owning vuln
    # enrichment until a future PR explicitly opts it into `enrichment`.
    task_default_queue="default",
    task_routes={
        "grc.tasks.frameworks.*": {"queue": "parsing"},
        "grc.tasks.governance.parse_policy_document": {"queue": "parsing"},
        "grc.tasks.governance.run_gap_analysis": {"queue": "parsing"},
        "grc.tasks.control_library.ai_compare_frameworks": {"queue": "parsing"},
        # Vuln enrichment shares the parsing queue — same worker can handle
        # it; the work is light (HTTP calls + a small DB write per row).
        "grc.tasks.vulnerabilities.*": {"queue": "parsing"},
        # Phase 6 — patch intelligence shares `parsing` for now. When the
        # `enrichment` queue + worker land we'll flip this to {"queue":
        # "enrichment"} without touching task code.
        "grc.tasks.patch_intel.*": {"queue": "parsing"},
        # Phase 8 — exception workflow sweep. Same story: shares `parsing`
        # until the dedicated `notification` queue lands.
        "grc.tasks.exceptions.*": {"queue": "parsing"},
        # Phase 7 — cloud connector sync. Shares `parsing` for now.
        "grc.tasks.cloud_sync.*": {"queue": "parsing"},
        # External-connector framework (ticketing / SIEM / pentest / collab /
        # transcribe). Reuses the `parsing` queue until a dedicated worker pool
        # is justified by traffic.
        "grc.tasks.connectors.*": {"queue": "parsing"},
        "connectors.*": {"queue": "parsing"},
        # Async AI drafting routes onto the same parsing queue (long-running
        # AI work, same character as policy parse / gap analysis).
        "grc.tasks.ai_drafting.*": {"queue": "parsing"},
        "ai_drafting.*": {"queue": "parsing"},
    },

    # ── Beat schedule ────────────────────────────────────────────────────────
    # Daily 02:30 UTC: re-download CISA KEV, then dispatch per-tenant bulk
    # enrichment to refresh EPSS scores (which change daily) and recompute
    # composite priority. Runs in a dedicated `celery-beat` container so a
    # restart of the worker doesn't lose the schedule.
    beat_schedule={
        "vuln-enrichment-daily-refresh": {
            "task": "grc.tasks.vulnerabilities.daily_refresh",
            "schedule": 24 * 60 * 60,   # 24h cadence (Python int seconds)
            "options": {"queue": "parsing"},
        },
        # Phase 6 — Daily PSIRT (MSRC) refresh. Stagger from the enrichment
        # refresh so the two don't compete for the same MSRC/redis pool
        # bandwidth at the same minute (the actual offset is whatever beat
        # gives them after startup; the schedules are independent counters).
        "patch-intel-daily-refresh": {
            "task": "grc.tasks.patch_intel.daily_patch_intel_refresh",
            "schedule": 24 * 60 * 60,
            "options": {"queue": "parsing"},
        },
        # Phase 8 — Daily exception-expiry sweep. Transitions approved
        # exceptions past their `exception_expires_at` to `expired` and
        # syncs the legacy `is_exception` flag so existing reports update
        # without further code changes.
        "exception-expiry-daily-sweep": {
            "task": "grc.tasks.exceptions.daily_exception_expiry_sweep",
            "schedule": 24 * 60 * 60,
            "options": {"queue": "parsing"},
        },
        # Phase 7 — Cloud connector sync fan-out. Every 6 hours; per-row
        # `sync_schedule_seconds` further filters out fresh connectors,
        # so an admin can opt a connector into hourly sync without us
        # changing beat config.
        "cloud-connector-sync-fan-out": {
            "task": "grc.tasks.cloud_sync.daily_cloud_connector_fan_out",
            "schedule": 6 * 60 * 60,
            "options": {"queue": "parsing"},
        },
        # External-connector fan-out (ticketing / SIEM / pen-test / collab /
        # transcribe). Every hour — most categories are cheap polls; ticketing
        # status sync benefits from a tighter cadence than the 6h cloud sync.
        "connectors-hourly-sync": {
            "task": "connectors.sync_all_active",
            "schedule": 60 * 60,
            "options": {"queue": "parsing"},
        },
    },

    # ── Retry policy ─────────────────────────────────────────────────────────
    # Default retry behaviour for tasks that opt in via `autoretry_for`.
    task_default_retry_delay=10,
    task_default_max_retries=3,

    # ── Worker hygiene ───────────────────────────────────────────────────────
    # Recycle worker child every 200 tasks to free memory leaked by AI libs.
    worker_max_tasks_per_child=200,
    # Send-events lets `celery events` and Flower see what's running.
    worker_send_task_events=True,
    task_send_sent_event=True,
)


# ─── Logging integration with the existing FastAPI logger ─────────────────────

@setup_logging.connect
def _configure_celery_logging(**_: Any) -> None:
    """Use a single logging config so worker logs match app logs."""
    import logging as _logging
    _logging.basicConfig(
        level=_logging.INFO,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )


# ─── Per-process engine cache management ──────────────────────────────────────

@worker_process_init.connect
def _init_worker_process(**_: Any) -> None:
    """Each Celery worker child is a separate process: it gets its own per-tenant
    engine cache. We pre-import the heavy modules a task body would need so the
    first task isn't penalised by 20+ seconds of cold-import time.

    Trade-off: worker boot is slower (~5-10s), but first-task latency drops to
    near-zero. In production with long-running workers this is the right call.
    """
    import time as _time
    started = _time.monotonic()
    from . import db as _db  # noqa: F401
    from . import models as _models  # noqa: F401  ← 7000-line ORM models
    # Task bodies — eagerly resolved so first dispatch isn't slow.
    try:
        from .modules.governance.routers import policy_parser as _pp  # noqa: F401
        from .modules.governance.routers import gap_analysis as _ga  # noqa: F401
        from .modules.framework_upload.routers import parser as _fp  # noqa: F401
    except Exception:
        # Don't crash the worker if a module fails to import; the per-task
        # `from x import y` will surface the error at dispatch time.
        logger.exception("Worker preload failed for one or more task modules")
    logger.info("Celery worker process initialised in %.2fs; engine cache + task bodies ready", _time.monotonic() - started)


# ─── Lifecycle hooks ──────────────────────────────────────────────────────────

@task_prerun.connect
def _task_prerun(sender=None, task_id=None, task=None, args=None, kwargs=None, **_: Any) -> None:
    tenant = (kwargs or {}).get("tenant_slug") or (args[0] if args else None)
    logger.info("task.prerun id=%s name=%s tenant=%s", task_id, task.name if task else "?", tenant)


@task_postrun.connect
def _task_postrun(sender=None, task_id=None, task=None, args=None, kwargs=None, retval=None, state=None, **_: Any) -> None:
    logger.info("task.postrun id=%s name=%s state=%s", task_id, task.name if task else "?", state)


@task_failure.connect
def _task_failure(sender=None, task_id=None, exception=None, args=None, kwargs=None, traceback=None, einfo=None, **_: Any) -> None:
    logger.error("task.failure id=%s exc=%r", task_id, exception)


__all__ = ["celery_app"]
