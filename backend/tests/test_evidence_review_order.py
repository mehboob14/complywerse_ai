"""What an uploaded file proves about its item must not wait for the library-wide assessment.

The Evidence library's AI assessment reads every framework the workspace holds and can take minutes (and
fail); the review against the one item it was attached to takes seconds. The person who just attached the file
is waiting on the second, so it runs first.
"""
from types import SimpleNamespace

from grc.modules.evidence.routers import ai_assessment, evidence as ev_router, ocr
from grc.services import evidence_quality


def _run(monkeypatch, target, ocr_status="completed", text="WAF screenshot"):
    calls = []
    row = SimpleNamespace(id=7, tenant_id=1, file_name="waf.jpg", file_type="image/jpeg", ocr_content=text, uploaded_by=3)
    db = SimpleNamespace(
        query=lambda *_: SimpleNamespace(filter=lambda *_: SimpleNamespace(first=lambda: row)),
        commit=lambda: None, rollback=lambda: None, close=lambda: None)
    monkeypatch.setattr(ev_router, "open_tenant_session", lambda slug: db)
    monkeypatch.setattr(ocr, "process_evidence_ocr", lambda e, d: calls.append("ocr") or SimpleNamespace(status=ocr_status))
    monkeypatch.setattr(ai_assessment, "run_ai_assessment", lambda e, d, user_id=None: calls.append("library assessment"))
    monkeypatch.setattr(evidence_quality, "check_and_save", lambda *a, **k: calls.append("item review"))
    ev_router.process_evidence_background(7, "demo", target)
    return calls


def test_the_item_review_comes_before_the_library_assessment(monkeypatch):
    assert _run(monkeypatch, target=object()) == ["ocr", "item review", "library assessment"]


def test_an_upload_with_no_item_is_assessed_for_the_library_only(monkeypatch):
    assert _run(monkeypatch, target=None) == ["ocr", "library assessment"]


def test_a_failing_library_assessment_does_not_cost_the_item_its_review(monkeypatch):
    def fails(e, d, user_id=None):
        raise RuntimeError("couldn't be read")

    calls = _run(monkeypatch, target=object())
    assert "item review" in calls
    monkeypatch.setattr(ai_assessment, "run_ai_assessment", fails)
    assert "item review" in _run(monkeypatch, target=object())


def test_a_file_with_no_text_is_still_reviewed_against_its_item(monkeypatch):
    """The review records "no readable text" on the row, which is what the screen shows."""
    assert _run(monkeypatch, target=object(), text="") == ["ocr", "item review"]
