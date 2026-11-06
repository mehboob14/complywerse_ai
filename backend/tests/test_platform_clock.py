"""The platform clock puts each scheduled job on the queue, once per cadence.

Ten jobs were defined in beat_schedule and none ran in production, because no
VM runs celery beat. The web app now queues them itself; these pin the rules
that keep it from queuing too much, too little, or twice.
"""
from datetime import datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models._61_platform_clock import MasterBase, ScheduledJobRun
from grc.services import platform_clock as clock

NOW = datetime(2026, 9, 23, 12, 0)
JOBS = [
    {"key": "daily", "task": "grc.tasks.x.daily", "every": 86400, "queue": "parsing"},
    {"key": "hourly", "task": "grc.tasks.x.hourly", "every": 3600, "queue": "parsing"},
]


@pytest.fixture()
def db(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    MasterBase.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    monkeypatch.setattr(clock, "schedule", lambda: list(JOBS))
    yield session
    session.close()


def _sent():
    calls = []

    def send(job):
        calls.append(job["key"])
        return f"task-{len(calls)}"
    return calls, send


def test_it_reads_the_real_beat_schedule():
    """One list of jobs, not two: whatever celery_app defines is what the clock runs."""
    from grc.celery_app import celery_app

    keys = {j["key"] for j in clock.schedule()}
    assert keys == set(celery_app.conf.beat_schedule)
    assert "vuln-enrichment-daily-refresh" in keys and "audit-register-daily-reminders" in keys


def test_never_queued_jobs_go_first_then_the_longest_waiting():
    last = {"daily": NOW - timedelta(days=2)}
    order = [j["key"] for j in clock.due(JOBS, last, NOW)]
    assert order == ["hourly", "daily"]


def test_a_job_is_not_due_until_its_cadence_has_passed():
    last = {"daily": NOW - timedelta(hours=23), "hourly": NOW - timedelta(minutes=59)}
    assert clock.due(JOBS, last, NOW) == []
    assert [j["key"] for j in clock.due(JOBS, last, NOW + timedelta(minutes=1))] == ["hourly"]


def test_a_tick_queues_each_due_job_once_and_records_it(db):
    calls, send = _sent()
    queued = clock.tick(now=NOW, db=db, send=send)
    assert sorted(j["key"] for j in queued) == ["daily", "hourly"]
    assert sorted(calls) == ["daily", "hourly"]
    rows = db.query(ScheduledJobRun).all()
    assert {r.job_key for r in rows} == {"daily", "hourly"} and all(r.status == "queued" for r in rows)


def test_a_second_tick_inside_the_cadence_queues_nothing(db):
    calls, send = _sent()
    clock.tick(now=NOW, db=db, send=send)
    clock.tick(now=NOW + timedelta(minutes=1), db=db, send=send)
    assert len(calls) == 2
    clock.tick(now=NOW + timedelta(hours=1), db=db, send=send)
    assert calls[-1] == "hourly" and len(calls) == 3


def test_a_broker_outage_is_retried_and_counted_on_one_row(db):
    def down(job):
        raise ConnectionError("broker unreachable")

    for minute in range(3):
        clock.tick(now=NOW + timedelta(minutes=minute), db=db, send=down)
    failures = db.query(ScheduledJobRun).filter(ScheduledJobRun.status == "failed").all()
    assert {f.job_key for f in failures} == {"daily", "hourly"}
    assert all(f.attempts == 3 for f in failures)

    # the broker comes back: a failure never counted as a run, so both go at once
    calls, send = _sent()
    clock.tick(now=NOW + timedelta(minutes=3), db=db, send=send)
    assert sorted(calls) == ["daily", "hourly"]


def test_status_reports_the_last_queue_and_clears_a_failure_once_it_succeeds(db):
    def down(job):
        raise ConnectionError("broker unreachable")

    clock.tick(now=NOW, db=db, send=down)
    report = {r["key"]: r for r in clock.status(db, now=NOW)}
    assert report["daily"]["last_queued_at"] is None
    assert "broker unreachable" in report["daily"]["last_failure"]["detail"]

    _, send = _sent()
    clock.tick(now=NOW + timedelta(minutes=1), db=db, send=send)
    report = {r["key"]: r for r in clock.status(db, now=NOW + timedelta(minutes=1))}
    assert report["daily"]["last_failure"] is None
    assert report["daily"]["overdue"] is False


def test_run_now_queues_one_job_and_resets_its_clock(db):
    calls, send = _sent()
    clock.run_now(db, "daily", send=send)
    assert calls == ["daily"]
    # it counts as a run: a tick straight afterwards leaves it alone
    calls2, send2 = _sent()
    clock.tick(now=datetime.utcnow(), db=db, send=send2)
    assert "daily" not in calls2


def test_run_now_refuses_a_job_that_does_not_exist(db):
    with pytest.raises(KeyError):
        clock.run_now(db, "no-such-job", send=lambda job: "x")
