"""The review that follows an upload: where it stands is recorded on the file, so the page can say so.

It used to be a thread nobody could ask about, plus one browser request that the page waited on. A run that
failed, or that was lost with the server, looked like "AI assessing..." for ever.
"""
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.evidence.routers import ai_assessment, ocr
from grc.services import evidence_quality, evidence_review as er


@pytest.fixture(autouse=True)
def _no_runs_in_flight():
    er._active.clear()
    yield
    er._active.clear()


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    session = Session(engine)
    session.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
    session.add(m.GRCUser(id=3, username="assessor", email="assessor@bank.example", display_name="Assessor"))
    session.add(m.Evidence(id=7, tenant_id=1, name="WAF", file_name="waf.jpg", file_type="image/jpeg", uploaded_by=3,
                           ocr_status="completed", ocr_content="Cloudflare firewall events", status="draft"))
    session.commit()
    yield session
    session.close()


def _ev(db):
    db.expire_all()
    return db.get(m.Evidence, 7)


def _ago(minutes):
    return (datetime.utcnow() - timedelta(minutes=minutes)).isoformat()


def _rated(db, when=None):
    row = m.EvidenceAIAssessment(evidence_id=7, relevance_score=40, adequacy_score=20, audit_readiness=20,
                                 confidence_score=80, content_summary="A firewall screenshot.",
                                 gap_analysis={"gaps": ["No date"], "recommendations": ["Export it"]},
                                 clause_mappings=[], assessed_at=when or datetime.utcnow())
    db.add(row)
    db.commit()
    return row


# -- a run, and what it leaves on the row -------------------------------------

def test_a_file_that_is_rated_and_matched_ends_done_and_the_steps_were_told(db, monkeypatch):
    steps = []

    def assess(e, d, user_id=None, report=None, matching=True):
        report("rating")
        steps.append(er.state(e)["step"])
        report("matching")
        steps.append(er.state(e)["step"])

    monkeypatch.setattr(ai_assessment, "run_ai_assessment", assess)
    er.run(7, "demo", open_session=lambda slug: db)
    state = er.state(_ev(db))
    assert steps == ["rating", "matching"]
    assert state["status"] == "done" and state["step"] is None and state["finished_at"] and not state["error"]


def test_a_file_from_somewhere_with_no_use_for_clauses_is_rated_but_not_matched(db, monkeypatch):
    seen = []
    monkeypatch.setattr(ai_assessment, "run_ai_assessment",
                        lambda e, d, user_id=None, report=None, matching=True: seen.append(matching))
    er.run(7, "demo", matching=False, open_session=lambda slug: db)
    assert seen == [False]
    state = er.state(_ev(db))
    assert state["status"] == "done" and state["mapping_skipped"] is True
    assert er.payload(db, _ev(db))["mapping_skipped"] is True


def test_a_rating_that_was_saved_survives_a_failure_while_matching(db, monkeypatch):
    def assess(e, d, user_id=None, report=None, matching=True):
        _rated(d)
        raise ai_assessment.HTTPException(status_code=502, detail="The AI assessment returned output that couldn't be read, so nothing was saved. Try again.")

    monkeypatch.setattr(ai_assessment, "run_ai_assessment", assess)
    er.run(7, "demo", open_session=lambda slug: db)
    state = er.state(_ev(db))
    assert state["status"] == "done"                                   # the person has the rating
    assert "could not be read" in state["mapping_error"]               # and is told the clauses are missing
    assert er.payload(db, _ev(db))["mapping_error"] == state["mapping_error"]


def test_a_failure_before_any_rating_is_a_failure_with_words_the_person_can_use(db, monkeypatch):
    def assess(e, d, user_id=None, report=None, matching=True):
        raise RuntimeError("gpt-5.5 does not support this parameter")

    monkeypatch.setattr(ai_assessment, "run_ai_assessment", assess)
    er.run(7, "demo", open_session=lambda slug: db)
    state = er.state(_ev(db))
    assert state["status"] == "failed" and "ask an administrator" in state["error"]
    assert "gpt" not in state["error"].lower()                         # never the model's name


def test_a_file_type_nobody_can_read_is_unavailable_not_failed(db, monkeypatch):
    ev = _ev(db)
    ev.file_name, ev.file_type, ev.ocr_content, ev.ocr_status = "bundle.zip", "application/zip", None, "not_applicable"
    db.commit()
    monkeypatch.setattr(ai_assessment, "run_ai_assessment", lambda *a, **k: pytest.fail("nothing to assess"))
    er.run(7, "demo", open_session=lambda slug: db)
    state = er.state(_ev(db))
    assert state["status"] == "unavailable" and "ZIP" in state["error"]
    assert _ev(db).ocr_status == "not_applicable"                      # the file is left as it was


def test_matching_alone_runs_only_the_matching(db, monkeypatch):
    _rated(db)
    seen = []
    monkeypatch.setattr(ai_assessment, "run_mapping_stage", lambda e, d, report=None: seen.append("matching"))
    monkeypatch.setattr(ai_assessment, "run_ai_assessment", lambda *a, **k: pytest.fail("not asked for again"))
    monkeypatch.setattr(evidence_quality, "check_and_save", lambda *a, **k: pytest.fail("not asked for again"))
    er.run(7, "demo", object(), only_mappings=True, open_session=lambda slug: db)
    assert seen == ["matching"] and er.state(_ev(db))["status"] == "done"


# -- a run that is lost -------------------------------------------------------

def test_a_run_that_has_gone_silent_is_reported_stopped_not_running(db):
    ev = _ev(db)
    ev.ai_review = {"status": "running", "step": "matching", "started_at": _ago(20), "updated_at": _ago(7)}
    db.commit()
    state = er.state(_ev(db))
    assert state["status"] == "failed" and state["stopped"] and "stopped before it finished" in state["error"]
    # one that is still beating is running, however long it has been going
    ev.ai_review = {"status": "running", "step": "matching", "started_at": _ago(20), "updated_at": _ago(1)}
    db.commit()
    assert er.state(_ev(db))["status"] == "running"


def test_opening_a_file_whose_run_was_lost_starts_it_again(db, monkeypatch):
    spawned = []
    monkeypatch.setattr(er, "_spawn", spawned.append)
    ev = _ev(db)
    ev.ai_review = {"status": "running", "step": "rating", "started_at": _ago(30), "updated_at": _ago(30)}
    db.commit()
    assert er.ensure(db, _ev(db), "demo", 3) is True and len(spawned) == 1
    assert er.state(_ev(db))["status"] == "queued"


def test_a_file_that_was_never_reviewed_is_started_when_it_is_opened(db, monkeypatch):
    spawned = []
    monkeypatch.setattr(er, "_spawn", spawned.append)
    assert er.ensure(db, _ev(db), "demo", 3) is True and len(spawned) == 1


def test_a_file_that_already_has_its_rating_is_left_alone(db, monkeypatch):
    monkeypatch.setattr(er, "_spawn", lambda job: pytest.fail("already rated"))
    _rated(db)
    assert er.ensure(db, _ev(db), "demo", 3) is False
    assert er.payload(db, _ev(db))["status"] == "done"                 # a file from before reviews were recorded


def test_a_real_failure_waits_for_a_person_to_ask_again(db, monkeypatch):
    spawned = []
    monkeypatch.setattr(er, "_spawn", spawned.append)
    ev = _ev(db)
    ev.ai_review = {"status": "failed", "error": "AI isn't set up on this server: no AI key is configured.",
                    "updated_at": _ago(1), "finished_at": _ago(1)}
    db.commit()
    assert er.ensure(db, _ev(db), "demo", 3) is False and not spawned   # not on every visit
    assert er.start(db, _ev(db), "demo", user_id=3, force=True) is True and len(spawned) == 1


def test_a_file_still_being_read_is_not_started_twice(db, monkeypatch):
    monkeypatch.setattr(er, "_spawn", lambda job: pytest.fail("still being read"))
    ev = _ev(db)
    ev.ocr_status, ev.ocr_content, ev.uploaded_at = "processing", None, datetime.utcnow()
    db.commit()
    assert er.ensure(db, _ev(db), "demo", 3) is False


def test_a_file_whose_reading_was_lost_is_read_again(db, monkeypatch):
    spawned = []
    monkeypatch.setattr(er, "_spawn", spawned.append)
    ev = _ev(db)
    ev.ocr_status, ev.ocr_content, ev.uploaded_at = "processing", None, datetime.utcnow() - timedelta(minutes=30)
    db.commit()
    assert er.payload(db, _ev(db))["ocr_stalled"] is True
    assert er.ensure(db, _ev(db), "demo", 3) is True and len(spawned) == 1


def test_two_asks_start_one_run(db, monkeypatch):
    spawned = []
    monkeypatch.setattr(er, "_spawn", spawned.append)
    assert er.start(db, _ev(db), "demo", user_id=3) is True
    assert er.start(db, _ev(db), "demo", user_id=3) is False            # the first is queued
    assert len(spawned) == 1
    monkeypatch.setattr(er, "run", lambda *a, **k: None)                  # the run itself is tested above
    spawned[0]()
    assert not er._active                                                # when it ends, the file can be started again


def test_a_file_uploaded_from_another_module_is_rated_and_not_matched(db, monkeypatch):
    spawned, ran = [], []
    monkeypatch.setattr(er, "_spawn", spawned.append)
    monkeypatch.setattr(er, "run", lambda *a, **k: ran.append((a, k)))
    db.info["tenant_slug"] = "demo"
    er.rate_upload(db, 7, 3)                                             # a module may hand over the id or the row
    assert er.state(_ev(db))["status"] == "queued" and len(spawned) == 1
    spawned[0]()
    assert ran == [((7, "demo", None, 3), {"only_mappings": False, "matching": False})]


def test_a_file_uploaded_to_a_project_milestone_is_rated_once_it_is_saved(db, monkeypatch, tmp_path):
    import asyncio
    import importlib
    import io

    from starlette.datastructures import Headers, UploadFile

    projects = importlib.import_module("grc.routers.is_projects_router")     # the package exports its router under this name
    rated = []
    monkeypatch.setattr(projects.evidence_review, "rate_upload", lambda d, ev, uid=None, **k: rated.append((ev.id, uid)))
    monkeypatch.setattr(projects, "get_user_primary_tenant", lambda user, session: 1)
    monkeypatch.setattr(projects, "MILESTONE_EVIDENCE_DIR", str(tmp_path))
    db.add(m.ISProject(id=1, tenant_id=1, name="Core banking upgrade"))
    db.add(m.ISProjectMilestone(id=2, project_id=1, name="Go-live"))
    db.commit()
    upload = UploadFile(file=io.BytesIO(b"signed off"), filename="go-live.pdf", headers=Headers({"content-type": "application/pdf"}))
    out = asyncio.run(projects.upload_milestone_evidence(1, 2, upload, db, SimpleNamespace(id=3, email="pm@bank.example")))
    assert rated == [(out["evidence_id"], 3)]                            # after the commit, so the file is there to read


def test_reading_a_file_again_by_hand_starts_its_review_only_if_it_was_never_rated(db, monkeypatch):
    spawned = []
    monkeypatch.setattr(er, "_spawn", spawned.append)
    monkeypatch.setattr(ocr, "validate_evidence_access", lambda *a, **k: None)
    monkeypatch.setattr(ocr, "process_evidence_ocr", lambda ev, d: SimpleNamespace(status="completed"))
    db.info["tenant_slug"] = "demo"
    ocr.process_ocr(7, db, SimpleNamespace(id=3))
    assert len(spawned) == 1 and er.state(_ev(db))["status"] == "queued"
    er._active.clear()
    _ev(db).ai_review = None                                             # nothing on the file but its rating
    _rated(db)
    ocr.process_ocr(7, db, SimpleNamespace(id=3))
    assert len(spawned) == 1                                             # it has its rating: left alone


def test_an_upload_does_not_fail_because_its_review_could_not_start(db, monkeypatch):
    def broken(*a, **k):
        raise RuntimeError("no database")

    monkeypatch.setattr(er, "start", broken)
    er.rate_upload(db, _ev(db), 3)
    er.rate_upload(db, 12345, 3)                                         # a file that is not there is not an error


# -- what the page reads ------------------------------------------------------

def test_the_page_is_told_the_rating_and_what_it_was_rated_against(db):
    _rated(db)
    ev = _ev(db)
    ev.quality_score = 26.0
    db.add(m.EvidenceQualityCheck(tenant_id=1, evidence_id=7, target_kind="assessment_item", target_ref="5.5.18.c",
                                  target_label="Web application firewall", covers="partial", score=40, verdict="Shows events, no policy.",
                                  detail={"gaps": ["No policy"]}, status="ok", checked_at=datetime.utcnow()))
    db.commit()
    p = er.payload(db, _ev(db))
    assert p["status"] == "done" and p["has_assessment"] and p["quality_score"] == 26.0
    assert [(c["target"]["ref"], c["covers"], c["score"]) for c in p["checks"]] == [("5.5.18.c", "partial", 40)]


def test_the_review_endpoints_say_where_it_stands_and_start_what_is_missing(db, monkeypatch):
    from grc.models import get_db
    from grc.routers.auth_router import require_auth

    spawned = []
    monkeypatch.setattr(er, "_spawn", spawned.append)
    monkeypatch.setattr(ai_assessment, "get_user_tenants", lambda user, session: [1])
    app = FastAPI()
    app.include_router(ai_assessment.router, prefix="/evidence-mgmt")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: SimpleNamespace(id=3, is_superuser=False)
    http = TestClient(app)

    seen = http.get("/evidence-mgmt/ai/7/review").json()
    assert seen["status"] is None and seen["ocr_status"] == "completed" and not spawned    # a read never starts anything

    started = http.post("/evidence-mgmt/ai/7/review").json()
    assert started["status"] == "queued" and started["step"] == "reading" and len(spawned) == 1
    assert http.post("/evidence-mgmt/ai/7/review").json()["status"] == "queued" and len(spawned) == 1   # not twice
    assert http.get("/evidence-mgmt/ai/999/review").status_code == 404
