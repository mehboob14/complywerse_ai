"""The platform's clock: puts scheduled jobs on the queue.

`celery_app.conf.beat_schedule` defines the platform's recurring jobs — the
vulnerability feed refresh, exception expiry, attestation and audit-register
reminders, the evidence-collector sweep, third-party risk snapshots, monitoring
polls, cloud connector sync — and none of them ran in production: provision.sh
installs a worker to consume the queue but no beat process to fill it. Rather
than add a service to every VM, the web app fills the queue itself.

It reads beat_schedule directly, so there is one list of jobs, not two. It
enqueues rather than runs: the work still happens on the worker, so a long feed
refresh never competes with web requests.

Every uvicorn worker runs this thread. A transaction-scoped Postgres advisory
lock on the master database makes exactly one of them do each tick. A job is due
once its cadence has passed since it was last queued successfully; a failed
attempt does not count as a run, so the job is retried on the next tick, and a
failure that repeats is counted on one row instead of written once a minute.

If a real `celery beat` is ever deployed, set DISABLE_PLATFORM_CLOCK=1, or both
will queue every job.
"""
from __future__ import annotations

import logging
import os
import socket
import threading
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from ..models._61_platform_clock import ScheduledJobRun

logger = logging.getLogger(__name__)

TICK_SECONDS = 60
FIRST_TICK_AFTER = 30          # let startup finish before the first tick
_LOCK_KEY = 7_203_411          # one tick at a time, across every web worker

_stop = threading.Event()
_thread: Optional[threading.Thread] = None


def schedule() -> List[Dict]:
    """The recurring jobs, read from beat_schedule."""
    from ..celery_app import celery_app

    jobs = []
    for key, entry in (celery_app.conf.beat_schedule or {}).items():
        every = entry.get("schedule")
        seconds = every.total_seconds() if isinstance(every, timedelta) else every
        if not isinstance(seconds, (int, float)) or seconds <= 0:
            logger.warning("platform clock: '%s' has a schedule it cannot read (%r); skipped", key, every)
            continue
        jobs.append({
            "key": key, "task": entry["task"], "every": int(seconds),
            "queue": (entry.get("options") or {}).get("queue"),
        })
    return jobs


def last_queued(db: Session) -> Dict[str, datetime]:
    rows = (db.query(ScheduledJobRun.job_key, func.max(ScheduledJobRun.queued_at))
            .filter(ScheduledJobRun.status == "queued")
            .group_by(ScheduledJobRun.job_key).all())
    return {key: at for key, at in rows}


def due(jobs: List[Dict], last: Dict[str, datetime], now: datetime) -> List[Dict]:
    """Jobs whose cadence has passed: never-queued first, then the longest waiting."""
    ready = [j for j in jobs
             if last.get(j["key"]) is None or (now - last[j["key"]]).total_seconds() >= j["every"]]
    return sorted(ready, key=lambda j: (last.get(j["key"]) is not None, last.get(j["key"]) or datetime.min))


def _try_lock(db: Session) -> bool:
    if db.get_bind().dialect.name != "postgresql":
        return True
    return bool(db.execute(text("SELECT pg_try_advisory_xact_lock(:k)"), {"k": _LOCK_KEY}).scalar())


def _send(job: Dict) -> str:
    from ..celery_app import celery_app

    # retry=False: an unreachable broker fails this tick fast rather than stall it.
    result = celery_app.send_task(job["task"], queue=job["queue"], retry=False)
    return str(result.id)


def _record_failure(db: Session, job: Dict, now: datetime, exc: Exception) -> None:
    detail = f"{type(exc).__name__}: {exc}"[:500]
    latest = (db.query(ScheduledJobRun).filter(ScheduledJobRun.job_key == job["key"])
              .order_by(ScheduledJobRun.id.desc()).first())
    if latest is not None and latest.status == "failed" and latest.detail == detail:
        latest.attempts = (latest.attempts or 1) + 1
        latest.queued_at = now
        return
    db.add(ScheduledJobRun(job_key=job["key"], task=job["task"], status="failed", queued_at=now,
                           detail=detail, host=socket.gethostname()[:120], pid=os.getpid()))


def tick(now: Optional[datetime] = None, db: Optional[Session] = None,
         send: Callable[[Dict], str] = _send) -> List[Dict]:
    """Queue every due job once. Returns the jobs it queued."""
    now = now or datetime.utcnow()
    own = db is None
    if own:
        from ..db import MasterSession
        db = MasterSession()
    queued: List[Dict] = []
    try:
        if not _try_lock(db):
            db.rollback()                  # another web worker has this tick
            return []
        for job in due(schedule(), last_queued(db), now):
            try:
                task_id = send(job)
            except Exception as exc:  # noqa: BLE001 — a broker outage must not stop the clock
                logger.warning("platform clock: could not queue %s: %s", job["key"], exc)
                _record_failure(db, job, now, exc)
                continue
            db.add(ScheduledJobRun(job_key=job["key"], task=job["task"], status="queued", queued_at=now,
                                   task_id=task_id, host=socket.gethostname()[:120], pid=os.getpid()))
            queued.append(job)
        db.commit()                        # also releases the advisory lock
    except Exception:
        db.rollback()
        logger.exception("platform clock tick failed")
    finally:
        if own:
            db.close()
    if queued:
        logger.info("platform clock queued: %s", ", ".join(j["key"] for j in queued))
    return queued


def run_now(db: Session, key: str, send: Callable[[Dict], str] = _send) -> Dict:
    """Queue one job immediately, outside its cadence — for an operator who needs
    the feed refreshed now rather than tomorrow. It counts as a run, so the next
    scheduled one is a full cadence later."""
    job = next((j for j in schedule() if j["key"] == key), None)
    if job is None:
        raise KeyError(key)
    now = datetime.utcnow()
    task_id = send(job)
    db.add(ScheduledJobRun(job_key=key, task=job["task"], status="queued", queued_at=now,
                           task_id=task_id, detail="queued by hand",
                           host=socket.gethostname()[:120], pid=os.getpid()))
    db.commit()
    return {"key": key, "task_id": task_id, "queued_at": now.isoformat()}


def status(db: Session, now: Optional[datetime] = None) -> List[Dict]:
    """Each job, when it last went on the queue, when it is next due, and its last failure."""
    now = now or datetime.utcnow()
    last = last_queued(db)
    out = []
    for job in schedule():
        failure = (db.query(ScheduledJobRun)
                   .filter(ScheduledJobRun.job_key == job["key"], ScheduledJobRun.status == "failed")
                   .order_by(ScheduledJobRun.id.desc()).first())
        latest = last.get(job["key"])
        next_due = latest + timedelta(seconds=job["every"]) if latest else now
        out.append({
            "key": job["key"], "task": job["task"], "every_seconds": job["every"],
            "last_queued_at": latest.isoformat() if latest else None,
            "next_due_at": next_due.isoformat(),
            "overdue": next_due < now - timedelta(seconds=TICK_SECONDS * 2),
            "last_failure": None if failure is None or (latest and failure.queued_at <= latest) else {
                "at": failure.queued_at.isoformat() if failure.queued_at else None,
                "attempts": failure.attempts, "detail": failure.detail,
            },
        })
    return out


def _loop() -> None:
    if _stop.wait(FIRST_TICK_AFTER):
        return
    while True:
        try:
            tick()
        except Exception:  # noqa: BLE001
            logger.exception("platform clock loop")
        if _stop.wait(TICK_SECONDS):
            return


def start() -> None:
    global _thread
    if os.getenv("DISABLE_PLATFORM_CLOCK", "").strip().lower() in ("1", "true", "yes", "on"):
        logger.info("platform clock disabled by DISABLE_PLATFORM_CLOCK")
        return
    if _thread is not None and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="platform-clock", daemon=True)
    _thread.start()
    logger.info("platform clock started: ticks every %ss", TICK_SECONDS)


def stop() -> None:
    _stop.set()
