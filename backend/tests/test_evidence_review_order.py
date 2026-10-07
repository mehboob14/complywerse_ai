"""What an uploaded file proves about its item must not wait for the library-wide assessment.

The Evidence library's AI assessment reads every framework the workspace holds and can take minutes (and
fail); the review against the one item it was attached to takes seconds. The person who just attached the file
is waiting on the second, so it runs first.
"""
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.evidence.routers import ai_assessment, ocr
from grc.services import evidence_quality, evidence_review


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    session = Session(engine)
    session.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
    session.add(m.GRCUser(id=3, username="assessor", email="assessor@bank.example", display_name="Assessor"))
    session.add(m.Evidence(id=7, tenant_id=1, name="WAF", file_name="waf.jpg", file_type="image/jpeg", uploaded_by=3,
                           ocr_status="pending", status="draft"))
    session.commit()
    yield session
    session.close()


def _run(db, monkeypatch, target, text="WAF screenshot", assessment=None):
    """Run the review of file 7 with the model calls replaced; returns what was called, in order."""
    calls = []

    def assess(e, d, user_id=None, report=None, matching=True):
        calls.append("library assessment")
        if assessment:
            assessment()

    def read(evidence, session):
        calls.append("ocr")
        evidence.ocr_content = text or None
        evidence.ocr_status = "completed" if text else "failed"
        session.commit()
        return SimpleNamespace(status=evidence.ocr_status, message="")

    monkeypatch.setattr(ocr, "process_evidence_ocr", read)
    monkeypatch.setattr(ai_assessment, "run_ai_assessment", assess)
    monkeypatch.setattr(evidence_quality, "check_and_save", lambda *a, **k: calls.append("item review"))
    evidence_review.run(7, "demo", target, open_session=lambda slug: db)
    return calls


def test_the_item_review_comes_before_the_library_assessment(db, monkeypatch):
    assert _run(db, monkeypatch, target=object()) == ["ocr", "item review", "library assessment"]


def test_an_upload_with_no_item_is_assessed_for_the_library_only(db, monkeypatch):
    assert _run(db, monkeypatch, target=None) == ["ocr", "library assessment"]


def test_a_failing_library_assessment_does_not_cost_the_item_its_review(db, monkeypatch):
    def fails():
        raise RuntimeError("provider said no")

    assert _run(db, monkeypatch, target=object(), assessment=fails) == ["ocr", "item review", "library assessment"]
    state = evidence_review.state(db.get(m.Evidence, 7))
    assert state["status"] == "failed" and "provider" not in state["error"]      # the person is not shown the provider's words


def test_a_file_with_no_text_is_still_reviewed_against_its_item(db, monkeypatch):
    """The review records "no readable text" on the row, which is what the screen shows."""
    assert _run(db, monkeypatch, target=object(), text="") == ["ocr", "item review"]
    state = evidence_review.state(db.get(m.Evidence, 7))
    assert state["status"] == "failed" and "No text could be read" in state["error"]
