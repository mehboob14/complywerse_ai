"""A gap analysis that stopped (the server or the worker restarted, the job was stopped) is cancelled automatically: a run that waits
or runs with no sign of life for 15 minutes shows as cancelled at once (a GET writes nothing) and is cancelled in the database by the
next run of the organisation and by the next job. The job beats for all its runs, so a long job of several frameworks stays running;
it never redoes a run that is no longer running, and stops spending on one cancelled while it works. A lock left by a stopped job does
not refuse the next run as busy. Each run records the document version it read. On in-memory SQLite."""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

import grc.models as m
from grc.modules.governance.routers import gap_analysis as gap
from grc.tasks import base

from test_governance_jobs_without_redis import REQUEST, RedisDown, _framework, _run, _runs, jobs_started  # noqa: F401  (a fixture)
from test_governance_permissions import OWNER, world  # noqa: F401  (world is a fixture)

R = m.PolicyGapAnalysisRun
LOCK = "lock:cfsb:gap_analysis:5"


def _set(db, rid, **fields):
    run = db.get(R, rid)
    for k, v in fields.items():
        setattr(run, k, v)
    db.commit()


def _ago(**kw):
    return datetime.utcnow() - timedelta(**kw)


def _controls(db, fid, n):
    db.add(m.UploadedFramework(id=fid, tenant_id=1, name=f"Framework {fid}", file_name="f.pdf", file_path="f.pdf", file_type="pdf",
                               upload_status="parsed", is_active=True, uploaded_by=OWNER))
    for i in range(n):
        db.add(m.ParsedFrameworkControl(id=fid * 100 + i, uploaded_framework_id=fid, control_id=f"C.{i:02d}", title=f"Clause {i}"))
    db.commit()


def _ai(calls, during=None):
    """The AI: one finding per clause; ``during(batch)`` runs inside the call (another process at that moment)."""
    def analyze(policy_text, clauses, framework_name, document_title=""):
        calls.append([c["reference"] for c in clauses])
        if during:
            during(clauses)
        return [{"clause_reference": c["reference"], "clause_title": c["title"], "compliance_status": "not_addressed"} for c in clauses]
    return analyze


def _findings(db, rid):
    return db.query(m.PolicyGapFinding).filter(m.PolicyGapFinding.analysis_run_id == rid).count()


class RedisDeletes(RedisDown):
    """Redis answers DEL only (the rate limit still fails open, so the job goes to a thread)."""
    def __init__(self):
        self.deleted = []

    def delete(self, key):
        self.deleted.append(key)


def test_a_run_silent_for_two_hours_shows_cancelled_and_the_gets_write_nothing(world):
    db = world.db
    _set(db, 1, status="running", started_at=_ago(hours=2), updated_at=_ago(hours=2))
    world.me["id"] = OWNER
    rows = {r["id"]: r for r in world.http.get("/governance/gap-analysis/runs/5").json()["runs"]}
    assert (rows[1]["status"], rows[1]["error_message"]) == ("failed", gap.ORPHANED)
    run = world.http.get("/governance/gap-analysis/findings/1").json()["run"]
    assert (run["status"], run["error_message"]) == ("failed", gap.ORPHANED)
    db.expire_all()
    row = db.get(R, 1)
    assert (row.status, row.error_message, row.completed_at) == ("running", None, None)


def test_the_next_run_cancels_it_in_the_database_and_starts(world, jobs_started):
    db = world.db
    _framework(db)
    _set(db, 1, status="queued", started_at=None, created_at=_ago(hours=2))       # never picked up: its creation is its last sign
    out = _run(world)
    db.expire_all()
    old = db.get(R, 1)
    assert (old.status, old.error_message) == ("failed", gap.ORPHANED) and old.completed_at is not None
    new = _runs(db)[0]
    assert new.status == "running" and jobs_started.threads == [("gap", "cfsb", [new.id], 5, OWNER)]
    assert [r["id"] for r in out["runs"]] == [new.id]
    assert gap.public_job_error(gap.ORPHANED) == gap.ORPHANED                  # shown as written once it is stored


def test_a_run_started_long_ago_that_beat_a_minute_ago_stays_running(world, jobs_started):
    db = world.db
    _framework(db)
    _set(db, 1, status="running", started_at=_ago(hours=2), updated_at=_ago(minutes=1))   # a long job of several frameworks
    world.me["id"] = OWNER
    rows = {r["id"]: r for r in world.http.get("/governance/gap-analysis/runs/5").json()["runs"]}
    assert (rows[1]["status"], rows[1]["error_message"]) == ("running", None)
    _run(world)
    db.expire_all()
    assert (db.get(R, 1).status, db.get(R, 1).completed_at) == ("running", None)


def test_the_job_does_only_the_runs_still_running_and_cancels_the_orphans_it_finds(world, monkeypatch):
    db = world.db
    _framework(db)
    db.add_all([R(id=2, tenant_id=1, document_id=5, uploaded_framework_id=7, status="failed", error_message=gap.ORPHANED,
                  started_at=_ago(hours=1)),                                                         # cancelled: stays cancelled
                R(id=3, tenant_id=1, document_id=5, uploaded_framework_id=7, status="completed", started_at=_ago(minutes=9),
                  clauses_total=1, clauses_processed=1),
                R(id=4, tenant_id=1, document_id=5, uploaded_framework_id=7, status="running", started_at=_ago(minutes=9)),
                R(id=9, tenant_id=1, document_id=6, uploaded_framework_id=7, status="running", started_at=_ago(hours=3))])  # another job's
    db.add(m.PolicyGapFinding(id=30, tenant_id=1, analysis_run_id=3, document_id=5, clause_reference="A.5.1"))
    db.commit()
    calls = []
    monkeypatch.setattr(gap, "analyze_clauses_batch", _ai(calls))
    # a redelivered job (Celery, after its worker was lost): run 3 was done by the first delivery, run 4 was being done
    gap._gap_analysis_body(db, [2, 3, 4], 5, OWNER, "cfsb")
    db.expire_all()
    assert calls == [["A.5.1"]]                                                  # once, for run 4
    assert [(db.get(R, i).status, _findings(db, i)) for i in (2, 3, 4)] == [("failed", 0), ("completed", 1), ("completed", 1)]
    assert db.get(R, 2).error_message == gap.ORPHANED and db.get(R, 4).updated_at is not None
    assert (db.get(R, 3).clauses_total, db.get(R, 3).clauses_processed) == (1, 1)          # not started over either
    assert (db.get(R, 9).status, db.get(R, 9).error_message) == ("failed", gap.ORPHANED)


def test_a_run_cancelled_while_the_job_does_it_stays_cancelled_and_no_more_ai_is_spent(world, monkeypatch):
    db = world.db
    _controls(db, 8, 16)                                                         # two batches
    db.add(R(id=4, tenant_id=1, document_id=5, uploaded_framework_id=8, status="running", started_at=_ago(minutes=1)))
    db.commit()
    calls = []

    def cancelled(_):                                                            # what the sweep of a run or a job does meanwhile
        db.query(R).filter(R.id == 4).update({R.status: "failed", R.error_message: gap.ORPHANED}, synchronize_session=False)

    monkeypatch.setattr(gap, "analyze_clauses_batch", _ai(calls, during=cancelled))
    gap._gap_analysis_body(db, [4], 5, OWNER, "cfsb")
    db.expire_all()
    assert len(calls) == 1 and _findings(db, 4) == 0
    assert (db.get(R, 4).status, db.get(R, 4).error_message, db.get(R, 4).total_clauses_analyzed) == ("failed", gap.ORPHANED, 0)


def test_a_job_longer_than_fifteen_minutes_keeps_all_its_runs_alive(world, monkeypatch):
    """Each batch takes ten minutes and a sweep runs in every one of them: without a beat after every batch the second batch would
    find both runs silent for twenty minutes, and the second framework's run waits for its turn the whole time."""
    db = world.db
    _controls(db, 8, 16)
    _controls(db, 9, 1)
    clock = SimpleNamespace(now=datetime(2026, 10, 21, 9, 0))
    monkeypatch.setattr(gap, "datetime", SimpleNamespace(utcnow=lambda: clock.now))
    for rid, fid in ((4, 8), (5, 9)):
        db.add(R(id=rid, tenant_id=1, document_id=5, uploaded_framework_id=fid, status="running", started_at=clock.now))
    db.commit()

    def ten_minutes_and_a_sweep(_):
        clock.now += timedelta(minutes=10)
        gap.cancel_orphaned_runs(db)

    calls = []
    monkeypatch.setattr(gap, "analyze_clauses_batch", _ai(calls, during=ten_minutes_and_a_sweep))
    gap._gap_analysis_body(db, [4, 5], 5, OWNER, "cfsb")
    db.expire_all()
    assert len(calls) == 3 and clock.now == datetime(2026, 10, 21, 9, 30)
    assert [(db.get(R, i).status, _findings(db, i)) for i in (4, 5)] == [("completed", 16), ("completed", 1)]


def test_the_next_run_releases_the_lock_a_stopped_job_left(world, jobs_started, monkeypatch):
    db = world.db
    _framework(db)
    _set(db, 1, status="running", started_at=_ago(hours=1), updated_at=_ago(minutes=40))
    redis = RedisDeletes()
    monkeypatch.setattr(base, "_redis_client", redis)
    with base.tenant_lock("cfsb", "gap_analysis:5", owner="the-stopped-job"):    # held in this process (Redis does not answer SET)
        _run(world)
        assert redis.deleted == [LOCK]
        with base.tenant_lock("cfsb", "gap_analysis:5", owner="the-new-job"):    # the new job is not refused as busy
            pass
    db.expire_all()
    assert db.get(R, 1).status == "failed"


def test_the_lock_stays_while_another_run_of_the_document_is_live(world, jobs_started, monkeypatch):
    db = world.db
    _framework(db)
    _set(db, 1, status="running", started_at=_ago(hours=1), updated_at=_ago(minutes=2))
    redis = RedisDeletes()
    monkeypatch.setattr(base, "_redis_client", redis)
    with base.tenant_lock("cfsb", "gap_analysis:5", owner="the-live-job"):
        _run(world)
        assert redis.deleted == []
        with pytest.raises(base.LockNotAcquired):
            with base.tenant_lock("cfsb", "gap_analysis:5", owner="the-new-job"):
                pass


def test_each_run_records_the_document_version_it_read(world, jobs_started):
    db = world.db
    _framework(db)
    db.get(m.GovernanceDocument, 5).current_version = "2.3"
    db.commit()
    out = _run(world)
    assert out["runs"][0]["document_version"] == "2.3"
    new = _runs(db)[0]
    assert new.document_version == "2.3"
    world.me["id"] = OWNER
    body = world.http.get("/governance/gap-analysis/runs/5").json()
    assert body["current_version"] == "2.3"
    assert {r["id"]: r["document_version"] for r in body["runs"]} == {1: None, new.id: "2.3"}     # older runs: not recorded


def test_the_ai_call_has_a_timeout(monkeypatch):
    made = {}

    class Client:
        def __init__(self, **kwargs):
            made.update(kwargs)
            answer = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content='{"findings": []}'))])
            self.chat = SimpleNamespace(completions=SimpleNamespace(create=lambda **kw: answer))

    monkeypatch.setattr(gap, "OpenAI", Client)
    monkeypatch.setattr(gap, "AI_INTEGRATIONS_OPENAI_API_KEY", "test-key")
    assert gap.analyze_clauses_batch("Access is reviewed.", [{"reference": "A.1", "title": "t", "requirement": "r"}], "ISO 27001") == []
    assert made["timeout"] == 180
