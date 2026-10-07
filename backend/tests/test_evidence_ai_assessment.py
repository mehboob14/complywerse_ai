"""The Evidence library's AI assessment of an uploaded file.

Two things made it fail on every file with a current model: with every framework's controls in the prompt a
reasoning model spent its whole token ceiling thinking and answered nothing ("couldn't be read"); and when it
did answer, it handed back the list line it was given ("AU-1: Policy and Procedures") as the control id, which
matched no control, so every mapping was thrown away.

It also took two and a half minutes before anything showed. It is now asked in two steps: the file is rated as
audit evidence first (seconds, no frameworks read) and that rating is saved; the framework clauses are matched
after, and a failure there leaves the rating in place.
"""
import json
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.modules.evidence.routers import ai_assessment as aa


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    session = Session(engine)
    session.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
    session.add(m.GRCUser(id=3, username="assessor", email="assessor@bank.example", display_name="Assessor"))
    fw = m.UploadedFramework(id=5, tenant_id=1, name="NIST SP 800-53 Rev 5", file_name="n.pdf", file_path="n.pdf",
                             file_type="pdf", upload_status="completed", is_active=True, uploaded_by=3)
    session.add(fw)
    session.add_all([
        m.ParsedFrameworkControl(uploaded_framework_id=5, control_id="FW-001", original_reference="AU-1", title="Policy and Procedures"),
        m.ParsedFrameworkControl(uploaded_framework_id=5, control_id="FW-002", original_reference="AC-3", title="Access Enforcement"),
    ])
    session.add(m.Evidence(id=7, tenant_id=1, name="WAF", file_name="waf.jpg", ocr_content="Cloudflare firewall events", status="draft"))
    session.commit()
    yield session
    session.close()


FW = "NIST SP 800-53 Rev 5"


def _map(control_id):
    return {"framework_name": FW, "control_id": control_id, "clause_reference": control_id, "match_type": "implicit", "confidence": 80}


def test_a_control_id_returned_with_its_title_still_counts(db):
    kept = aa.validate_and_filter_clause_mappings(
        [_map("AU-1: Policy and Procedures"), _map("AC-3"), _map("ZZ-9: Invented control")], db, 1)
    assert [k["control_id"] for k in kept] == ["AU-1", "AC-3"]          # the title is dropped, the invented one refused


class _Client:
    """Stands in for the provider: records each call, and refuses `reasoning_effort` when asked to."""

    def __init__(self, refuse_effort=False):
        self.calls, self.refuse_effort = [], refuse_effort
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kw):
        self.calls.append(kw)
        if self.refuse_effort and "reasoning_effort" in kw:
            raise RuntimeError("Unsupported value: 'reasoning_effort' does not support 'none' with this model.")
        body = {"relevance_score": 70, "adequacy_score": 30, "audit_readiness": 20, "confidence_score": 80,
                "summary": "A firewall screenshot.", "gaps": ["No retention shown"], "recommendations": ["Export 90 days"],
                "clause_mappings": [_map("AU-1: Policy and Procedures")]}
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(body)), finish_reason="stop")])


def _assess(db, monkeypatch, model, client):
    monkeypatch.setattr(aa, "MODEL_VERSION", model)
    monkeypatch.setattr(aa, "get_openai_client", lambda: client)
    return aa.run_ai_assessment(db.get(m.Evidence, 7), db, force_refresh=True, user_id=None)


def test_a_reasoning_model_is_asked_not_to_reason(db, monkeypatch):
    client = _Client()
    done = _assess(db, monkeypatch, "gpt-5.5", client)
    assert [c.get("reasoning_effort") for c in client.calls] == ["none", "none"]       # the rating, then the matching
    assert [x["control_id"] for x in done.clause_mappings] == ["AU-1"]
    assert done.gap_analysis["gaps"] == ["No retention shown"] and done.gap_analysis["recommendations"] == ["Export 90 days"]
    assert done.gap_analysis["detected_controls"] == [f"{FW}: AU-1"]    # rebuilt from the mappings the reply left out


def test_a_model_that_refuses_the_setting_is_asked_again_without_it(db, monkeypatch):
    client = _Client(refuse_effort=True)
    _assess(db, monkeypatch, "gpt-5.5", client)
    assert ["reasoning_effort" in c for c in client.calls] == [True, False, True, False]    # each step asks again without it


def test_a_model_without_reasoning_is_never_sent_the_setting(db, monkeypatch):
    client = _Client()
    _assess(db, monkeypatch, "gpt-4o", client)
    assert all("reasoning_effort" not in c for c in client.calls)


# -- the two steps -----------------------------------------------------------

class _Scripted(_Client):
    """Answers each call in turn from `answers`; an Exception in the list is raised instead."""

    def __init__(self, answers):
        super().__init__()
        self.answers = list(answers)

    def _create(self, **kw):
        self.calls.append(kw)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(answer)), finish_reason="stop")])


RATING = {"relevance_score": 70, "adequacy_score": 30, "audit_readiness": 20, "confidence_score": 80,
          "summary": "A firewall screenshot.", "gaps": ["No retention shown"], "recommendations": ["Export 90 days"]}
MATCHES = {"clause_mappings": [_map("AU-1: Policy and Procedures"), _map("AC-3")]}


def test_the_rating_is_saved_before_the_clauses_are_matched_and_survives_a_matching_failure(db, monkeypatch):
    client = _Scripted([RATING, RuntimeError("provider down"), RuntimeError("provider down")])
    steps = []
    monkeypatch.setattr(aa, "MODEL_VERSION", "gpt-4o")
    monkeypatch.setattr(aa, "get_openai_client", lambda: client)
    monkeypatch.setattr(aa.time, "sleep", lambda s: None)
    with pytest.raises(aa.HTTPException):
        aa.run_ai_assessment(db.get(m.Evidence, 7), db, force_refresh=True, report=steps.append)

    ev = db.get(m.Evidence, 7)
    row = db.query(m.EvidenceAIAssessment).filter_by(evidence_id=7).one()
    assert (row.relevance_score, row.adequacy_score, row.audit_readiness) == (70, 30, 20)
    assert row.clause_mappings == [] and row.gap_analysis["gaps"] == ["No retention shown"]
    assert ev.quality_score == pytest.approx(70 * 0.3 + 30 * 0.4 + 20 * 0.3) and ev.content_summary == "A firewall screenshot."
    assert steps[0] == "rating" and "matching" in steps                            # the page is told which step it is on
    assert db.query(m.EvidenceAssessmentCache).count() == 0                        # half an answer is not cached


def test_matching_alone_can_be_run_again_for_a_file_already_rated(db, monkeypatch):
    failing = _Scripted([RATING, RuntimeError("down"), RuntimeError("down")])
    monkeypatch.setattr(aa, "MODEL_VERSION", "gpt-4o")
    monkeypatch.setattr(aa, "get_openai_client", lambda: failing)
    monkeypatch.setattr(aa.time, "sleep", lambda s: None)
    with pytest.raises(aa.HTTPException):
        aa.run_ai_assessment(db.get(m.Evidence, 7), db, force_refresh=True)

    client = _Scripted([MATCHES])
    monkeypatch.setattr(aa, "get_openai_client", lambda: client)
    done = aa.run_mapping_stage(db.get(m.Evidence, 7), db)
    assert len(client.calls) == 1                                                  # one call: the rating is not asked for again
    assert [x["control_id"] for x in done.clause_mappings] == ["AU-1", "AC-3"]
    assert done.relevance_score == 70 and db.query(m.EvidenceAIAssessment).count() == 1
    assert db.query(m.EvidenceAssessmentCache).count() == 1                        # now the whole answer is known


def test_without_any_framework_the_file_is_rated_and_nothing_is_asked_to_match(db, monkeypatch):
    db.query(m.ParsedFrameworkControl).delete()
    db.query(m.UploadedFramework).delete()
    db.commit()
    client = _Scripted([RATING])
    monkeypatch.setattr(aa, "MODEL_VERSION", "gpt-4o")
    monkeypatch.setattr(aa, "get_openai_client", lambda: client)
    done = aa.run_ai_assessment(db.get(m.Evidence, 7), db, force_refresh=True)
    assert len(client.calls) == 1 and done.clause_mappings == [] and done.relevance_score == 70


def test_an_unreadable_rating_is_refused_not_saved(db, monkeypatch):
    client = _Scripted([{"nothing": "useful"}, {"nothing": "useful"}])
    monkeypatch.setattr(aa, "MODEL_VERSION", "gpt-4o")
    monkeypatch.setattr(aa, "get_openai_client", lambda: client)
    with pytest.raises(aa.HTTPException) as err:
        aa.run_ai_assessment(db.get(m.Evidence, 7), db, force_refresh=True)
    assert err.value.status_code == 502 and "couldn't be read" in err.value.detail
    assert db.query(m.EvidenceAIAssessment).count() == 0 and db.get(m.Evidence, 7).quality_score is None
