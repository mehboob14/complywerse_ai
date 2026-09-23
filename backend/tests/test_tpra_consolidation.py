"""Stage 0 of the third-party risk plan: one store for each thing.

Two consolidations, each guarding a behaviour that was quietly wrong:

* The vendor portal saved one JSON blob, so the per-question answer table stayed
  empty. Scoring prefers those rows, so they must score exactly like the blob —
  including a failed critical control on a custom template that was never
  backfilled into the question table.
* The AI scoring endpoint wrote its findings into the analyst's own list,
  overwriting it, and a string and a dict ended up sharing one list — which
  crashed gap analysis the moment anyone typed a finding by hand.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, Tenant, Vendor, VendorAssessment, VendorQuestionnaireTemplate,
    VendorQuestionnaireResponse, TPRAQuestion, TPRAQuestionResponse, TPRAFinding, TPRATieringConfig,
    TPRATemplateVersion,
)
from grc.modules.vendor_risk.routers.assessments import _split, serialize_assessment
from grc.modules.vendor_risk.tpra import service
from grc.modules.vendor_risk.tpra.bootstrap import get_tiering_config
from grc.modules.vendor_risk.tpra.engine_scoring import score_assessment

_TABLES = [Tenant, Vendor, VendorAssessment, VendorQuestionnaireTemplate,
           VendorQuestionnaireResponse, TPRAQuestion, TPRAQuestionResponse, TPRAFinding, TPRATieringConfig,
           TPRATemplateVersion]

# A custom template, never backfilled into grc_tpra_questions, with one critical control.
QUESTIONS = [
    {"id": "q1", "text": "Is MFA enforced for all administrators?", "domain": "cybersecurity",
     "weight": 3, "critical_control": True, "evidence_required": True},
    {"id": "q2", "text": "Is data encrypted at rest?", "domain": "data_privacy", "weight": 2},
    {"id": "q3", "text": "Do you have a tested BCP?", "domain": "operational_resilience", "weight": 1},
    {"id": "q4", "text": "Describe your SDLC.", "domain": "cybersecurity", "type": "text"},
]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.commit()
    yield s
    s.close()


def _setup(db, answers):
    template = VendorQuestionnaireTemplate(tenant_id=1, name="Custom", questions=QUESTIONS)
    vendor = Vendor(tenant_id=1, name="Acme Cloud", tier="high", status="active")
    db.add_all([template, vendor])
    db.flush()
    assessment = VendorAssessment(tenant_id=1, vendor_id=vendor.id, template_id=template.id,
                                  assessment_type="security", status="submitted", inherent_score=70.0)
    db.add(assessment)
    db.flush()
    qr = VendorQuestionnaireResponse(tenant_id=1, vendor_id=vendor.id, assessment_id=assessment.id,
                                     template_id=template.id, token="t", status="submitted",
                                     responses=answers)
    db.add(qr)
    db.commit()
    return assessment, qr


def _score(db, assessment):
    return score_assessment(service.collect_responses_for_scoring(db, assessment.id),
                            inherent_score=assessment.inherent_score,
                            config=get_tiering_config(db, assessment.tenant_id))


# ── per-question answers ─────────────────────────────────────────────────────

@pytest.mark.parametrize("answers", [
    {"q1": "no", "q2": "yes", "q3": "partial", "q4": "Agile with code review"},   # critical control fails
    {"q1": "yes", "q2": "yes", "q3": "yes"},                                        # all good, q4 unanswered
    {"q1": {"value": "Partial"}, "q2": "N/A", "q3": "no"},                          # wrapped + N/A answers
])
def test_the_normalized_rows_score_exactly_like_the_portal_blob(db, answers):
    assessment, qr = _setup(db, answers)
    from_blob = _score(db, assessment)                 # no rows yet: scores the blob

    written = service.materialise_responses(db, assessment, qr)
    db.commit()
    assert written == len(QUESTIONS)
    from_rows = _score(db, assessment)                 # rows now exist: scores them

    for key in ("overall_residual", "residual_rating", "rating_grade", "domain_scores"):
        assert from_rows[key] == from_blob[key], key


def test_a_failed_critical_control_survives_the_switch_to_rows(db):
    assessment, qr = _setup(db, {"q1": "no", "q2": "yes", "q3": "yes"})
    service.materialise_responses(db, assessment, qr)
    db.commit()
    critical = db.query(TPRAQuestion).filter(TPRAQuestion.question_key == "q1").one()
    assert critical.critical_control is True and critical.weight == 3.0
    rows = service.collect_responses_for_scoring(db, assessment.id)
    assert any(r["critical_control"] and r["answer"] == "No" for r in rows)


def test_writing_the_rows_twice_changes_nothing(db):
    assessment, qr = _setup(db, {"q1": "yes", "q2": "no", "q3": "yes"})
    service.materialise_responses(db, assessment, qr)
    db.commit()
    before = {r.question_key: (r.answer, r.row_version)
              for r in db.query(TPRAQuestionResponse).all()}
    service.materialise_responses(db, assessment, qr)
    db.commit()
    after = {r.question_key: (r.answer, r.row_version)
             for r in db.query(TPRAQuestionResponse).all()}
    assert after == before
    assert db.query(TPRAQuestion).count() == len(QUESTIONS)


def test_a_changed_answer_bumps_its_row_version(db):
    assessment, qr = _setup(db, {"q1": "yes", "q2": "no", "q3": "yes"})
    service.materialise_responses(db, assessment, qr)
    db.commit()
    qr.responses = {"q1": "yes", "q2": "yes", "q3": "yes"}
    service.materialise_responses(db, assessment, qr)
    db.commit()
    rows = {r.question_key: r for r in db.query(TPRAQuestionResponse).all()}
    assert (rows["q2"].answer, rows["q2"].row_version) == ("Yes", 2)
    assert rows["q1"].row_version == 1


def test_an_unanswered_question_is_still_a_row(db):
    """The blob path scores unanswered questions too; the rows must match it."""
    assessment, qr = _setup(db, {"q1": "yes"})
    service.materialise_responses(db, assessment, qr)
    db.commit()
    rows = {r.question_key: r for r in db.query(TPRAQuestionResponse).all()}
    assert set(rows) == {"q1", "q2", "q3", "q4"}
    assert rows["q2"].answer is None


# ── the AI's suggestions stay out of the analyst's list ──────────────────────

def test_strings_are_the_analysts_and_dicts_are_the_ais():
    analyst, ai = _split(["Access review overdue", {"finding": "No DPA", "severity": "high"}, "Stale SOC 2"])
    assert analyst == ["Access review overdue", "Stale SOC 2"]
    assert ai == [{"finding": "No DPA", "severity": "high"}]


def test_the_serializer_separates_a_mixed_legacy_list(db):
    assessment, _ = _setup(db, {})
    assessment.findings = ["Typed by the analyst", {"finding": "From the AI", "severity": "medium"}]
    assessment.ai_findings = [{"finding": "Newer AI suggestion", "severity": "low"}]
    out = serialize_assessment(assessment)
    assert out["findings"] == ["Typed by the analyst"]
    assert [f["finding"] for f in out["ai_findings"]] == ["Newer AI suggestion", "From the AI"]
