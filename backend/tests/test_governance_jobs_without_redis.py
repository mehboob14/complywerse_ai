"""Statement parsing and gap analysis without Redis (optional locally; work falls back to threads): the rate limit and the job lock
fail open, the job starts on a thread at once (Celery, whose broker is that Redis, is not tried), and a gap-analysis run is never
left 'running' when its job did not start, found another running, or stopped long ago. No model name reaches the page."""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
import redis
from fastapi import HTTPException

import grc.models as m
from grc import job_status
from grc.tasks import base
from grc.tasks import governance as jobs

from test_governance_permissions import OWNER, world  # noqa: F401  (world is a fixture)

REQUEST = SimpleNamespace(state=SimpleNamespace(tenant_slug="cfsb"))


class RedisDown:
    """A Redis that is not running: every command fails to connect, as redis-py does."""
    def pipeline(self):
        return self

    def incr(self, *a):
        return self

    def expire(self, *a):
        return self

    def _down(self, *a, **k):
        raise redis.exceptions.ConnectionError("Error 10061 connecting to 127.0.0.1:6379.")

    execute = set = get = eval = delete = _down


class RedisUp(RedisDown):
    """A Redis that counts: ``n`` dispatches already in the last minute."""
    def __init__(self, n=0):
        self.n = n

    def incr(self, *a):
        self.n += 1
        return self

    def execute(self):
        return [self.n, True]


@pytest.fixture
def jobs_started(monkeypatch):
    """Redis is down; what is started on a thread or handed to Celery is recorded, nothing runs."""
    for module in (base, job_status):
        monkeypatch.setattr(module, "_redis_client", RedisDown())
    started = SimpleNamespace(threads=[], celery=[])

    def celery(*a, **k):
        started.celery.append(a)
        raise RuntimeError("the broker is not running")

    for task in (jobs.parse_policy_document, jobs.run_gap_analysis):
        monkeypatch.setattr(task, "delay", celery)
    monkeypatch.setattr(jobs, "dispatch_parse", lambda *a: started.celery.append(a))
    monkeypatch.setattr(jobs, "dispatch_parse_in_thread", lambda *a: started.threads.append(("parse", *a)) or "thread-parse")
    monkeypatch.setattr(jobs, "dispatch_gap_analysis_in_thread", lambda *a: started.threads.append(("gap", *a)) or "thread-gap")
    return started


def test_the_rate_limit_fails_open_without_redis_and_still_refuses_over_the_limit_with_it(monkeypatch, caplog):
    monkeypatch.setattr(base, "_redis_client", RedisDown())
    assert base.tenant_rate_limit("cfsb", bucket="gap_analysis") is False
    assert "Redis unreachable" in caplog.text
    monkeypatch.setenv("TENANT_JOB_RATE_PER_MIN", "2")
    monkeypatch.setattr(base, "_redis_client", RedisUp(n=1))
    assert base.tenant_rate_limit("cfsb", bucket="gap_analysis") is True
    with pytest.raises(base.RateLimitExceeded):
        base.tenant_rate_limit("cfsb", bucket="gap_analysis")


def test_without_redis_the_job_lock_is_held_in_this_process(monkeypatch):
    monkeypatch.setattr(base, "_redis_client", RedisDown())
    with base.tenant_lock("cfsb", "gap_analysis:5", owner="first"):
        with pytest.raises(base.LockNotAcquired):
            with base.tenant_lock("cfsb", "gap_analysis:5", owner="second"):
                pass
        with base.tenant_lock("cfsb", "gap_analysis:6", owner="other"):      # another document is not held up
            pass
    with base.tenant_lock("cfsb", "gap_analysis:5", owner="third"):          # released
        pass


def test_statement_parsing_starts_on_a_thread_without_redis(world, jobs_started):
    from grc.modules.governance.routers import policy_parser

    policy_parser._parsing_status.pop(5, None)
    out = policy_parser.parse_policy_document(5, REQUEST, world.db, world.db.get(m.GRCUser, OWNER))
    assert (out["status"], out["dispatched_via"], out["task_id"]) == ("queued", "thread", "thread-parse")
    assert jobs_started.threads == [("parse", "cfsb", 5, OWNER)] and jobs_started.celery == []
    assert policy_parser._parsing_status[5]["updated_at"]          # the status endpoint does not take it for a leftover
    policy_parser._parsing_status.pop(5, None)
    # a document made without Redis is parsed on a thread too, without waiting on the broker
    assert policy_parser.maybe_autoparse_document(world.db, "cfsb", 5, OWNER) is True
    assert jobs_started.threads[-1] == ("parse", "cfsb", 5, OWNER) and jobs_started.celery == []
    policy_parser._parsing_status.pop(5, None)


def test_a_refused_parse_leaves_no_queued_status(world, monkeypatch):
    from grc.modules.governance.routers import policy_parser

    monkeypatch.setenv("TENANT_JOB_RATE_PER_MIN", "1")
    monkeypatch.setattr(base, "_redis_client", RedisUp(n=1))
    monkeypatch.setattr(job_status, "_redis_client", RedisDown())
    policy_parser._parsing_status.pop(5, None)
    with pytest.raises(HTTPException) as refused:
        policy_parser.parse_policy_document(5, REQUEST, world.db, world.db.get(m.GRCUser, OWNER))
    assert refused.value.status_code == 429 and 5 not in policy_parser._parsing_status


def _framework(db):
    db.add(m.UploadedFramework(id=7, tenant_id=1, name="ISO 27001", file_name="iso.pdf", file_path="iso.pdf", file_type="pdf",
                               upload_status="parsed", is_active=True, uploaded_by=OWNER))
    db.add(m.ParsedFrameworkControl(id=70, uploaded_framework_id=7, control_id="A.5.1", title="Policies for information security"))
    db.commit()


def _run(world):
    from grc.modules.governance.routers import gap_analysis as gap

    db = world.db
    return gap.run_gap_analysis(gap.GapAnalysisRunRequest(document_id=5, framework_ids=[7]), REQUEST, db, db.get(m.GRCUser, OWNER))


def _runs(db):
    db.expire_all()
    return db.query(m.PolicyGapAnalysisRun).filter(m.PolicyGapAnalysisRun.id != 1).all()


def test_the_gap_analysis_starts_on_a_thread_without_redis_and_sends_no_model_name(world, jobs_started):
    _framework(world.db)
    out = _run(world)
    assert (out["dispatched_via"], out["task_id"]) == ("thread", "thread-gap") and jobs_started.celery == []
    run = _runs(world.db)[0]
    assert jobs_started.threads == [("gap", "cfsb", [run.id], 5, OWNER)] and run.status == "running"
    assert out["runs"][0]["ai_model_used"] is None and "ai_model_used" in out["runs"][0]


def test_a_gap_analysis_that_cannot_start_leaves_no_run_running(world, jobs_started, monkeypatch):
    _framework(world.db)

    def no_thread(*a):
        raise RuntimeError("can't start new thread")

    monkeypatch.setattr(jobs, "dispatch_gap_analysis_in_thread", no_thread)
    with pytest.raises(HTTPException) as refused:
        _run(world)
    assert refused.value.status_code == 503 and refused.value.detail == "The gap analysis could not be started now. Try again in a minute."
    assert [(r.status, r.error_message) for r in _runs(world.db)] == [("failed", "The gap analysis could not be started.")]


def test_a_refused_gap_analysis_makes_no_run(world, monkeypatch):
    _framework(world.db)
    monkeypatch.setenv("TENANT_JOB_RATE_PER_MIN", "1")
    monkeypatch.setattr(base, "_redis_client", RedisUp(n=1))
    with pytest.raises(HTTPException) as refused:
        _run(world)
    assert refused.value.status_code == 429 and _runs(world.db) == []


def test_a_gap_job_that_finds_another_running_on_the_document_fails_its_runs(world, jobs_started, monkeypatch):
    db = world.db
    db.add(m.PolicyGapAnalysisRun(id=2, tenant_id=1, document_id=5, status="running", started_at=datetime.utcnow()))
    db.commit()
    monkeypatch.setattr("grc.db.open_tenant_session", lambda slug: db)
    with base.tenant_lock("cfsb", "gap_analysis:5", owner="the-first-job"):
        jobs._run_gap_analysis_with_own_session("cfsb", [2], 5, OWNER, "thread-second")
    run = _runs(db)[0]
    assert (run.status, run.error_message) == ("failed", "Another gap analysis of this document was running. Run it again when it is done.")


def test_a_comparison_rerun_refused_without_redis_keeps_the_comparison_there_is(world, monkeypatch):
    from grc.modules.control_library.routers import comparison

    db = world.db
    monkeypatch.setattr(comparison, "check_ai_available", lambda: True)
    monkeypatch.setattr(base, "_redis_client", RedisDown())
    for fid in (7, 8):
        db.add(m.UploadedFramework(id=fid, tenant_id=1, name=f"F{fid}", file_name="f.pdf", file_path="f.pdf", file_type="pdf",
                                   upload_status="parsed", is_active=True, uploaded_by=OWNER))
    db.add(m.ControlComparisonRun(id=4, tenant_id=1, source_framework_id=7, dest_framework_id=8, status="completed"))
    db.commit()
    with pytest.raises(HTTPException) as refused:
        comparison.ai_compare_dispatch(comparison.AiCompareRunRequest(source_framework_id=7, dest_framework_id=8, refresh=True),
                                       REQUEST, db, db.get(m.GRCUser, OWNER))
    assert refused.value.status_code == 503
    db.expire_all()
    assert db.get(m.ControlComparisonRun, 4).status == "completed"          # not deleted before the refusal


def test_a_run_whose_job_went_silent_long_ago_is_shown_cancelled_and_nothing_is_written(world):
    from grc.modules.governance.routers.gap_analysis import ORPHANED

    db = world.db
    old = db.get(m.PolicyGapAnalysisRun, 1)
    old.status, old.started_at, old.ai_model_used = "running", datetime.utcnow() - timedelta(hours=2), "gpt-5.5"
    db.add(m.PolicyGapAnalysisRun(id=3, tenant_id=1, document_id=5, status="running", started_at=datetime.utcnow(), ai_model_used="gpt-5.5"))
    db.commit()
    world.me["id"] = OWNER
    r = world.http.get("/governance/gap-analysis/runs/5")
    assert r.status_code == 200, r.text
    rows = {x["id"]: x for x in r.json()["runs"]}
    assert (rows[1]["status"], rows[1]["error_message"]) == ("failed", ORPHANED)          # no beat for two hours
    assert rows[3]["status"] == "running"
    assert all("ai_model_used" in x and x["ai_model_used"] is None for x in rows.values()) and "gpt" not in r.text
    db.expire_all()
    assert (db.get(m.PolicyGapAnalysisRun, 1).status, db.get(m.PolicyGapAnalysisRun, 1).ai_model_used) == ("running", "gpt-5.5")
