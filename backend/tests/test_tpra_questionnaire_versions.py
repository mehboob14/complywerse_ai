"""What a vendor was sent stays what it was, and answers score by their options.

Stage 3 of the third-party risk plan. A template's questions used to be read live
by everything — the portal, scoring, the assessment view — and even the saved
per-question rows were rewritten to follow the template. Editing a question
therefore changed the meaning of answers already given. Now a questionnaire is
pinned to a frozen version, and so is its scoring: option scores (decision 6:
"Partial" is worth what the tenant says) and the finding each weak answer raises.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, GRCUser, Risk, Tenant, TPRAAuditLog, TPRAFinding, TPRAQuestion, TPRAQuestionResponse, TPRARiskSnapshot,
    TPRATemplateVersion, TPRATieringConfig, Vendor, VendorAssessment, VendorQuestionnaireEvidence,
    VendorQuestionnaireResponse, VendorQuestionnaireTemplate, get_db,
)
from grc.modules.vendor_risk.routers import questionnaires as questionnaire_routes
from grc.modules.vendor_risk.tpra import rbac, service, versions
from grc.modules.vendor_risk.tpra.engine_scoring import answer_score, score_assessment
from grc.routers.auth_router import require_auth

_TABLES = [Tenant, GRCUser, Vendor, VendorAssessment, VendorQuestionnaireTemplate, VendorQuestionnaireResponse,
           VendorQuestionnaireEvidence, TPRATemplateVersion, TPRAQuestion, TPRAQuestionResponse, TPRAFinding,
           TPRATieringConfig, TPRARiskSnapshot, TPRAAuditLog, Risk]

QUESTIONS = [
    {"id": "mfa", "text": "Is MFA enforced for administrators?", "domain": "cybersecurity", "weight": 1.5,
     "critical_control": True, "type": "yes_no"},
    {"id": "enc", "text": "Is data encrypted at rest?", "domain": "data_privacy", "weight": 1.5, "type": "yes_no"},
    {"id": "bcp", "text": "Do you test your continuity plan?", "domain": "operational", "weight": 1.0, "type": "yes_no"},
    {"id": "pen", "text": "How often are you penetration tested?", "domain": "cybersecurity", "type": "multiple_choice",
     "options": [{"value": "annual", "label": "Annually", "score": 1.0},
                 {"value": "never", "label": "Never", "score": 0.0}]},
    {"id": "sdlc", "text": "Describe your SDLC.", "type": "text"},
]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="a@x.test", is_active=True))
    s.commit()
    yield s
    s.close()


def _template(db, questions=QUESTIONS):
    t = VendorQuestionnaireTemplate(tenant_id=1, name="Security", questions=[dict(q) for q in questions])
    db.add(t)
    db.commit()
    return t


def _edit(db, template, **changes):
    """Change the first question the way the template editor would."""
    questions = [dict(q) for q in template.questions]
    questions[0] = {**questions[0], **changes}
    template.questions = questions
    db.commit()


def _sent(db, template, answers=None, status="submitted"):
    vendor = Vendor(tenant_id=1, name="Acme Cloud", status="active")
    db.add(vendor)
    db.flush()
    assessment = VendorAssessment(tenant_id=1, vendor_id=vendor.id, template_id=template.id,
                                  status="submitted", inherent_score=70.0)
    db.add(assessment)
    db.flush()
    version = versions.publish(db, template)
    qr = VendorQuestionnaireResponse(tenant_id=1, vendor_id=vendor.id, assessment_id=assessment.id,
                                     template_id=template.id, template_version_id=version.id,
                                     token=f"t-{assessment.id}", status=status, responses=answers or {})
    db.add(qr)
    db.commit()
    return vendor, assessment, qr


def _policy(db, partial_credit):
    row = db.query(TPRATieringConfig).first() or TPRATieringConfig(tenant_id=1, config_key="default", is_active=True)
    row.scoring_policy = {"partial_credit": partial_credit}
    db.add(row)
    db.commit()


# ── versions ─────────────────────────────────────────────────────────────────

def test_editing_a_template_never_moves_a_questionnaire_already_sent(db):
    template = _template(db)
    _, _, qr = _sent(db, template)
    _edit(db, template, text="Is phishing-resistant MFA enforced everywhere?", weight=3)

    assert versions.questions_for(db, qr)[0]["text"] == "Is MFA enforced for administrators?"
    assert versions.questions_for(db, qr)[0]["weight"] == 1.5
    v2 = versions.publish(db, template)
    assert v2.version_no == 2 and v2.questions[0]["text"].startswith("Is phishing-resistant")
    assert versions.publish(db, template).id == v2.id        # nothing changed: no third version


def test_a_link_sent_before_versions_existed_is_pinned_on_first_read(db):
    template = _template(db)
    qr = VendorQuestionnaireResponse(tenant_id=1, vendor_id=1, template_id=template.id, token="old", status="pending")
    db.add(qr)
    db.commit()
    first = versions.questions_for(db, qr)
    db.commit()
    _edit(db, template, text="Rewritten")
    assert versions.questions_for(db, qr) == first and qr.template_version_id is not None


def test_saved_answers_keep_their_meaning_after_the_template_changes(db):
    template = _template(db)
    _, first, qr1 = _sent(db, template, {"mfa": "yes"})
    service.materialise_responses(db, first, qr1)
    db.commit()

    _edit(db, template, text="A different question entirely")
    _, second, qr2 = _sent(db, template, {"mfa": "no"})
    service.materialise_responses(db, second, qr2)
    db.commit()

    def asked(assessment):
        row = db.query(TPRAQuestionResponse).filter(TPRAQuestionResponse.assessment_id == assessment.id,
                                                    TPRAQuestionResponse.question_key == "mfa").one()
        return db.get(TPRAQuestion, row.question_id).text

    assert asked(first) == "Is MFA enforced for administrators?"
    assert asked(second) == "A different question entirely"


# ── scoring by option ────────────────────────────────────────────────────────

def _posture(db, assessment, domain):
    responses = service.collect_responses_for_scoring(db, assessment.id)
    return score_assessment(responses, inherent_score=70.0)["domain_scores"][domain]["posture"]


def test_partial_is_worth_what_the_tenant_says_as_of_sending(db):
    _policy(db, 0.2)
    template = _template(db)
    _, assessment, qr = _sent(db, template, {"bcp": "partial"})
    assert _posture(db, assessment, "operational") == pytest.approx(0.2)

    _policy(db, 0.8)                                         # later policy: old answers unmoved
    service.materialise_responses(db, assessment, qr)
    db.commit()
    assert _posture(db, assessment, "operational") == pytest.approx(0.2)
    _, newer, _ = _sent(db, template, {"bcp": "partial"})
    assert _posture(db, newer, "operational") == pytest.approx(0.8)


def test_the_blob_and_the_saved_rows_score_the_same(db):
    template = _template(db)
    _, assessment, qr = _sent(db, template, {"mfa": "yes", "enc": "partial", "bcp": "no", "pen": "annual",
                                             "sdlc": "Agile"})
    before = score_assessment(service.collect_responses_for_scoring(db, assessment.id), 70.0)
    service.materialise_responses(db, assessment, qr)
    db.commit()
    after = score_assessment(service.collect_responses_for_scoring(db, assessment.id), 70.0)
    assert after["domain_scores"] == before["domain_scores"]
    assert after["overall_residual"] == before["overall_residual"]


def test_a_multiple_choice_answer_scores_by_its_option(db):
    frozen = versions.freeze(QUESTIONS)
    pen = next(q for q in frozen if q["id"] == "pen")
    assert answer_score(pen, "annual") == ("Annually", 1.0)
    assert answer_score(pen, "never") == ("Never", 0.0)
    assert answer_score(pen, "Never") == ("Never", 0.0)      # case does not matter


def test_a_rating_of_one_is_the_worst_not_the_best(db):
    rating = versions.freeze([{"id": "r", "text": "Rate your patching", "type": "rating"}])[0]
    assert answer_score(rating, "1") == ("1", 0.0)
    assert answer_score(rating, "5") == ("5", 1.0)


def test_not_applicable_and_free_text_do_not_count(db):
    frozen = {q["id"]: q for q in versions.freeze(QUESTIONS)}
    assert answer_score(frozen["bcp"], "n-a") == ("Not applicable", None)
    assert answer_score(frozen["sdlc"], "Agile") == (None, None)


# ── weak answers become findings ─────────────────────────────────────────────

def test_weak_answers_raise_findings_that_say_where_they_came_from(db):
    template = _template(db)
    vendor, assessment, qr = _sent(db, template, {"mfa": "no", "enc": "no", "bcp": "partial", "pen": "never"})
    service.materialise_responses(db, assessment, qr)
    result = service.run_scoring(db, vendor, assessment, actor_id=7)
    db.commit()

    found = {f.question_key: f for f in db.query(TPRAFinding).all()}
    assert {k: f.severity for k, f in found.items()} == {
        "mfa": "critical", "enc": "high", "bcp": "low", "pen": "medium"}
    assert found["mfa"].is_critical_control_fail and not found["enc"].is_critical_control_fail
    assert found["enc"].answer_value == "No" and found["bcp"].answer_value == "Partial"
    assert found["mfa"].template_version_id == qr.template_version_id
    assert result["findings_created"] == 4 and result["blocking"]

    again = service.run_scoring(db, vendor, assessment, actor_id=7)
    db.commit()
    assert again["findings_created"] == 0 and db.query(TPRAFinding).count() == 4


def test_a_good_questionnaire_raises_nothing(db):
    template = _template(db)
    vendor, assessment, qr = _sent(db, template, {"mfa": "yes", "enc": "yes", "bcp": "yes", "pen": "annual"})
    service.materialise_responses(db, assessment, qr)
    assert service.run_scoring(db, vendor, assessment, actor_id=7)["findings_created"] == 0


# ── through the routes ───────────────────────────────────────────────────────

@pytest.fixture()
def http(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(questionnaire_routes.router, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def test_the_portal_shows_the_version_that_was_sent(db, http):
    template = _template(db)
    vendor = Vendor(tenant_id=1, name="Acme Cloud", status="active")
    db.add(vendor)
    db.commit()
    sent = http.post("/vendor-risk/questionnaires/send", json={"vendor_id": vendor.id, "template_id": template.id})
    assert sent.status_code == 201, sent.text
    token = sent.json()["token"]
    _edit(db, template, text="Edited after sending")

    shown = http.get(f"/vendor-risk/questionnaires/external/{token}").json()
    assert shown["questions"][0]["text"] == "Is MFA enforced for administrators?"
    assert [o["value"] for o in shown["questions"][0]["options"]] == ["yes", "partial", "no", "n-a"]


def test_a_template_that_has_been_sent_cannot_be_deleted(db, http):
    template, unused = _template(db), _template(db)
    _sent(db, template)
    assert http.delete(f"/vendor-risk/questionnaire-templates/{template.id}").status_code == 409
    assert http.delete(f"/vendor-risk/questionnaire-templates/{unused.id}").status_code == 200
    listed = {t["id"]: t for t in http.get("/vendor-risk/questionnaire-templates").json()["items"]}
    assert listed[template.id]["latest_version"] == 1
