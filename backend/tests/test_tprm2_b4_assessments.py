"""The Assessments tab of a supplier: a card per questionnaire sent for an engagement, and one
questionnaire read in full.

A card says which review cycle the questionnaire was sent in, how much of it the supplier has
answered (of the questions its answers make apply), what evidence is still owed, its status,
and the cycle's grade with the residual's movement against the cycle before. Each scope (an
engagement, or General) has its own cards. The detail reads answers by section with each
credited, what backs them and what moved since the last cycle. Both are reads: nothing is
written, not even the version a legacy questionnaire would be pinned to.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, Evidence, GRCUser, Role, Tenant, TPRAEngagement, TPRAStageInstance, TPRATemplateVersion, TPRAVendorContact,
    UserRole, Vendor, VendorAssessment, VendorQuestionnaireEvidence, VendorQuestionnaireResponse,
    VendorQuestionnaireTemplate,
)
from grc.modules.vendor_risk.routers import assessments
from grc.modules.vendor_risk.tpra import portal, versions
from grc.modules.vendor_risk.tpra import questionnaire_evidence as qevidence

ANALYST = 7
QUESTIONS = [
    {"id": "mfa", "text": "Is MFA enforced?", "type": "yes_no", "required": True, "domain": "cybersecurity",
     "critical_control": True, "evidence": "required", "evidence_on": ["yes", "partial"]},
    {"id": "enc", "text": "Is data encrypted at rest?", "type": "yes_no", "required": True, "domain": "cybersecurity"},
    {"id": "dpa", "text": "Will you sign our DPA?", "type": "yes_no", "required": False, "section": "Privacy"},
    {"id": "hosting", "text": "Where is our data held?", "type": "multiple_choice", "section": "Privacy",
     "options": [{"value": "eu", "label": "In the EU", "score": 1},
                 {"value": "elsewhere", "label": "Elsewhere", "score": 0.5, "comment_required": True},
                 {"value": "none_held", "label": "We hold none", "not_applicable": True}]},
    {"id": "notes", "text": "Anything else we should know?", "type": "text", "required": False, "section": "Privacy"},
    {"id": "subs", "text": "Do you use subprocessors?", "type": "yes_no", "required": True, "domain": "fourth_party"},
    {"id": "subs_list", "text": "List them.", "type": "text", "required": True, "domain": "fourth_party",
     "show_if": {"question": "subs", "in": ["yes"]}},
]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme Bank", slug="acme"))
    s.add(Role(id=1, name="Administrator"))
    s.add(GRCUser(id=ANALYST, username="ana", email="ana@acme.test", display_name="Ana Lyst", is_active=True))
    s.add(UserRole(user_id=ANALYST, role_id=1, tenant_id=1))
    s.add(Vendor(id=1, tenant_id=1, name="Payroll Co", status="active", tier="high", owner_id=ANALYST,
                 inherent_risk_score=60.0, active_assessment_id=12))
    s.add(VendorAssessment(id=11, tenant_id=1, vendor_id=1, version_no=1, lifecycle_status="superseded",
                           status="approved", current_stage="reassessment", inherent_tier="high", inherent_score=60.0,
                           residual_score=40.0, residual_rating="medium", rating_grade="C"))
    s.add(VendorAssessment(id=12, tenant_id=1, vendor_id=1, version_no=2, supersedes_id=11, lifecycle_status="active",
                           status="in_progress", current_stage="questionnaire", inherent_tier="high",
                           inherent_score=60.0, residual_score=28.3, residual_rating="medium", rating_grade="B",
                           domain_scores={"cybersecurity": {"posture": 0.7, "inherent": 60.0, "residual": 30.6,
                                                            "rating": "medium", "answered": 2, "total": 2},
                                          "fourth_party": {"posture": 1.0, "inherent": 60.0, "residual": 18.0,
                                                           "rating": "low", "answered": 1, "total": 1}}))
    s.add(TPRAStageInstance(tenant_id=1, vendor_id=1, assessment_id=12, stage_key="approval", stage_order=8,
                            is_gate=True, status="not_started"))
    s.add(VendorQuestionnaireTemplate(id=5, tenant_id=1, name="Security", questions=QUESTIONS))
    s.add(TPRAVendorContact(id=3, tenant_id=1, vendor_id=1, name="Sam Lee", email="sam@payroll.test",
                            is_primary=True, portal_access=True))
    s.commit()
    yield s
    s.close()


def _user(db):
    return db.get(GRCUser, ANALYST)


def _sent(db, assessment_id=12, status="in_progress", responses=None, pin=True, **kw):
    template = db.get(VendorQuestionnaireTemplate, 5)
    fields = dict(
        tenant_id=1, vendor_id=1, assessment_id=assessment_id, template_id=5,
        template_version_id=versions.publish(db, template).id if pin else None,
        token=portal.sealed_token(), status=status, contact_id=3, responses=responses or {},
        expires_at=datetime.utcnow() + timedelta(days=30), due_date=datetime.utcnow() + timedelta(days=14))
    qr = VendorQuestionnaireResponse(**{**fields, **kw})
    db.add(qr)
    db.commit()
    return qr


def _cards(db, vendor_id=1, engagement_id=None):
    return assessments.assessment_cards(vendor_id, engagement_id=engagement_id, db=db, current_user=_user(db))


def _detail(db, qr):
    return assessments.questionnaire_detail(qr.id, db=db, current_user=_user(db))


def _rows(detail):
    return {r["id"]: r for s in detail["sections"] for r in s["rows"]}


# ── the routes ───────────────────────────────────────────────────────────────

def test_both_reads_are_reached_through_the_modules_router_and_nothing_earlier_answers_for_them(db):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from grc.models import get_db
    from grc.modules.vendor_risk.router import router
    from grc.routers.auth_router import require_auth

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: _user(db)
    http = TestClient(app)
    qr = _sent(db, responses={"mfa": "yes"})

    cards = http.get("/vendor-risk/vendors/1/assessment-cards")
    assert cards.status_code == 200 and [c["id"] for c in cards.json()["items"]] == [qr.id]
    detail = http.get(f"/vendor-risk/questionnaire-responses/{qr.id}/detail")
    assert detail.status_code == 200 and detail.json()["sections"][0]["rows"][0]["id"] == "mfa"
    assert http.get("/vendor-risk/vendors/1/assessment-cards", params={"engagement_id": 99}).status_code == 404
    assert http.get("/vendor-risk/questionnaire-responses/999/detail").status_code == 404


# ── the cards ────────────────────────────────────────────────────────────────

def test_a_card_for_each_questionnaire_newest_cycle_first_with_the_cycle_and_the_movement(db):
    old = _sent(db, 11, "accepted", {"mfa": "yes", "enc": "yes", "subs": "no"}, submitted_at=datetime(2025, 3, 2))
    new = _sent(db, 12, "in_progress", {"mfa": "yes", "enc": "partial"})

    out = _cards(db)
    assert [c["id"] for c in out["items"]] == [new.id, old.id]
    fresh, first = out["items"]
    assert (fresh["kind"], fresh["cycle"], fresh["name"], fresh["status"], fresh["active"]) == (
        "reassessment", 2, "Security", "in_progress", True)
    assert (first["kind"], first["cycle"], first["status"], first["active"]) == ("initial", 1, "accepted", False)
    # the grade and score are the review cycle's; the movement is against the cycle before it
    assert (fresh["scored"], fresh["grade"], fresh["residual_score"], fresh["residual_change"]) == (True, "B", 28.3, -11.7)
    assert fresh["previous"] == {"cycle": 1, "residual_score": 40.0, "grade": "C"}
    assert (first["grade"], first["residual_change"], first["previous"]) == ("C", None, None)
    assert fresh["contact"] == {"id": 3, "name": "Sam Lee", "email": "sam@payroll.test"}
    assert first["submitted_at"] == "2025-03-02T00:00:00"


def test_x_of_y_answered_counts_the_questions_the_answers_make_apply_and_evidence_still_owed(db):
    qr = _sent(db, responses={"mfa": "yes", "enc": "partial"})
    # six questions apply until subs is answered yes: subs_list then joins them
    card = _cards(db)["items"][0]
    assert (card["questions"], card["answered"], card["missing_evidence"]) == (6, 2, 1)       # mfa owes a document

    qr.responses = {"mfa": "yes", "enc": "partial", "subs": "yes"}
    ev = Evidence(tenant_id=1, name="MFA policy", status="approved")
    db.add(ev)
    db.flush()
    qevidence.attach_library(db, qr, {"id": "mfa"}, ev, ANALYST)
    db.commit()
    card = _cards(db)["items"][0]
    assert (card["questions"], card["answered"], card["missing_evidence"]) == (7, 3, 0)       # its document is linked


def test_a_link_that_has_run_out_reads_expired_only_while_the_supplier_still_owes_answers(db):
    waiting = _sent(db, status="pending", expires_at=datetime.utcnow() - timedelta(days=1))
    done = _sent(db, 11, status="submitted", expires_at=datetime.utcnow() - timedelta(days=1))
    by_id = {c["id"]: c for c in _cards(db)["items"]}
    assert by_id[waiting.id]["expired"] is True and by_id[done.id]["expired"] is False


def test_a_follow_up_says_so_and_a_questionnaire_sent_with_no_review_belongs_to_general_only(db):
    parent = _sent(db, status="accepted")
    follow = _sent(db, parent_response_id=parent.id)
    loose = _sent(db, assessment_id=None, status="pending")
    payroll = TPRAEngagement(id=2, tenant_id=1, vendor_id=1, name="Payroll", tier="medium")
    db.add(payroll)
    db.commit()

    general = {c["id"]: c for c in _cards(db)["items"]}
    assert general[follow.id]["kind"] == "follow_up"
    assert (general[loose.id]["kind"], general[loose.id]["cycle"], general[loose.id]["scored"]) == ("unlinked", None, False)
    assert [c["id"] for c in _cards(db, engagement_id=2)["items"]] == []          # nothing of General's is the engagement's


def test_each_engagement_has_its_own_cards_and_scope(db):
    db.add(TPRAEngagement(id=2, tenant_id=1, vendor_id=1, name="Payroll", tier="medium", inherent_risk_score=30.0,
                          active_assessment_id=21))
    db.add(VendorAssessment(id=21, tenant_id=1, vendor_id=1, engagement_id=2, version_no=1, lifecycle_status="active",
                            status="in_progress", current_stage="approval", inherent_tier="medium", inherent_score=30.0))
    db.add(TPRAStageInstance(tenant_id=1, vendor_id=1, assessment_id=21, stage_key="approval", stage_order=8,
                             is_gate=True, status="complete"))
    db.commit()
    general_qr, payroll_qr = _sent(db, 12), _sent(db, 21)

    payroll = _cards(db, engagement_id=2)
    assert [c["id"] for c in payroll["items"]] == [payroll_qr.id]
    assert payroll["scope"] == {"engagement_id": 2, "tier": "medium", "tiered": True, "active_assessment_id": 21,
                                "approval_passed": True, "closed": None}
    general = _cards(db)
    assert [c["id"] for c in general["items"]] == [general_qr.id]
    assert (general["scope"]["active_assessment_id"], general["scope"]["approval_passed"]) == (12, False)
    with pytest.raises(HTTPException) as nope:
        _cards(db, engagement_id=99)
    assert nope.value.status_code == 404


def test_the_scope_tells_the_buttons_what_they_may_do(db):
    scope = _cards(db)["scope"]
    assert (scope["tiered"], scope["tier"], scope["approval_passed"], scope["closed"]) == (True, "high", False, None)

    db.query(TPRAStageInstance).update({"status": "complete"})
    db.commit()
    assert _cards(db)["scope"]["approval_passed"] is True

    # nothing tiered yet: no tier on the review, no inherent score
    db.get(VendorAssessment, 12).inherent_tier = None
    db.get(Vendor, 1).inherent_risk_score = None
    db.commit()
    assert _cards(db)["scope"]["tiered"] is False

    db.get(Vendor, 1).status = "offboarded"
    db.commit()
    assert _cards(db)["scope"]["closed"] == "This vendor is offboarded."
    db.add(TPRAEngagement(id=2, tenant_id=1, vendor_id=1, name="Payroll", status="ended"))
    db.get(Vendor, 1).status = "active"
    db.commit()
    assert _cards(db, engagement_id=2)["scope"]["closed"] == "This engagement has ended."


def test_a_supplier_scored_before_the_lifecycle_began_has_no_review_to_send_under(db):
    db.query(VendorAssessment).update({"lifecycle_status": "archived"})
    db.get(Vendor, 1).active_assessment_id = None
    db.commit()
    scope = _cards(db)["scope"]
    assert (scope["tiered"], scope["active_assessment_id"], scope["approval_passed"]) == (False, None, False)


def test_reading_the_cards_and_the_detail_writes_nothing_not_even_a_legacy_questionnaires_version(db):
    qr = _sent(db, pin=False, responses={"mfa": "yes"})                      # sent before versions existed
    before = (db.query(TPRATemplateVersion).count(), len(db.new), len(db.dirty))

    card = _cards(db)["items"][0]
    assert (card["questions"], card["answered"], card["template_version"]) == (6, 1, None)
    assert _rows(_detail(db, qr))["mfa"]["label"] == "Yes"

    assert qr.template_version_id is None
    assert (db.query(TPRATemplateVersion).count(), len(db.new), len(db.dirty)) == before


# ── one questionnaire, read in full ──────────────────────────────────────────

def test_a_questionnaire_is_read_by_section_in_question_order_with_each_answer_credited(db):
    qr = _sent(db, status="submitted",
               responses={"mfa": "yes", "enc": "no", "dpa": "partial", "hosting": "none_held", "notes": "All good.",
                          "subs": "yes", "subs_list": "Acme Mail"},
               vendor_comments={"hosting": "We hold none.", "mfa": "On all staff."})
    d = _detail(db, qr)

    assert [(s["key"], s["label"], [r["id"] for r in s["rows"]]) for s in d["sections"]] == [
        ("cybersecurity", "Cybersecurity", ["mfa", "enc"]),
        ("privacy", "Privacy", ["dpa", "hosting", "notes"]),
        ("fourth party", "Fourth party", ["subs", "subs_list"])]
    rows = _rows(d)
    assert [(rows[k]["credit"], rows[k]["label"]) for k in ("mfa", "enc", "dpa")] == [
        ("full", "Yes"), ("gap", "No"), ("partial", "Partial")]
    assert (rows["hosting"]["state"], rows["hosting"]["credit"], rows["hosting"]["label"]) == ("na", "na", "We hold none")
    assert (rows["notes"]["state"], rows["notes"]["text_answer"], rows["notes"]["credit"]) == (
        "answered", "All good.", None)
    assert rows["mfa"]["critical"] is True and rows["dpa"]["optional"] is True
    assert (d["questions"], d["answered"]) == (7, 7)
    # the section's residual is its domain's, when the section is one domain
    assert [s["residual"] for s in d["sections"]] == [30.6, None, 18.0]
    # the pieces the review components read: the review and comments as the response serializes them
    assert d["status"] == "submitted" and d["comments"]["hosting"] == "We hold none." and d["review"] == {}


def test_a_question_the_answers_hide_is_left_out_and_unanswered_ones_say_so(db):
    qr = _sent(db, responses={"mfa": "yes", "subs": "no"})
    rows = _rows(_detail(db, qr))
    assert "subs_list" not in rows                                         # only asked after subs is yes
    assert (rows["enc"]["state"], rows["enc"]["label"], rows["enc"]["credit"]) == ("unanswered", None, None)


def test_evidence_is_owed_missing_or_in_hand_by_question_and_a_file_is_listed(db):
    qr = _sent(db, status="submitted", responses={"mfa": "yes", "enc": "yes"})
    db.add(VendorQuestionnaireEvidence(response_id=qr.id, question_id="enc", file_name="enc.pdf",
                                       file_path="uploads/enc.pdf", file_type="application/pdf", file_size=10))
    db.commit()
    rows = _rows(_detail(db, qr))
    assert (rows["mfa"]["evidence"]["owed"], rows["mfa"]["evidence"]["has"], rows["mfa"]["evidence"]["missing"]) == (
        True, False, True)
    assert rows["enc"]["evidence"]["owed"] is False and rows["enc"]["evidence"]["files"][0]["file_name"] == "enc.pdf"

    ev = Evidence(tenant_id=1, name="MFA policy", status="approved")
    db.add(ev)
    db.flush()
    qevidence.attach_library(db, qr, {"id": "mfa"}, ev, ANALYST)
    db.commit()
    d = _detail(db, qr)
    assert _rows(d)["mfa"]["evidence"]["missing"] is False and _rows(d)["mfa"]["evidence"]["has"] is True
    assert d["missing_evidence"] == 0 and d["library_evidence"]["mfa"][0]["name"] == "MFA policy"


def test_a_reassessment_reads_what_moved_since_the_last_cycle_weaker_first(db):
    _sent(db, 11, "accepted", {"mfa": "yes", "enc": "yes", "dpa": "no", "notes": "Fine.", "subs": "no"})
    qr = _sent(db, 12, "submitted", {"mfa": "no", "enc": "yes", "dpa": "yes", "notes": "Better.", "subs": "no"})
    d = _detail(db, qr)

    ch = d["changes"]
    assert (ch["cycle"], ch["compared"], ch["moved"], ch["of"], ch["weaker"], ch["stronger"]) == (1, True, 3, 6, 1, 1)
    assert ch["residual"] == {"now": 28.3, "before": 40.0, "change": -11.7}
    assert ch["grade"] == {"now": "B", "before": "C"}
    # weaker first, then stronger, then a change of words that ranks the same
    assert [(m["id"], m["from"], m["to"], m["weaker"]) for m in ch["items"]] == [
        ("mfa", "Yes", "No", True), ("dpa", "No", "Yes", False), ("notes", "Fine.", "Better.", None)]
    rows = _rows(d)
    assert (rows["mfa"]["changed"], rows["mfa"]["was"]) == (True, "Yes")
    assert (rows["enc"]["changed"], rows["enc"]["was"]) == (False, None)


def test_a_question_not_answered_yet_has_not_moved(db):
    _sent(db, 11, "accepted", {"mfa": "yes", "enc": "yes", "dpa": "no", "subs": "no"})
    fresh = _sent(db, 12, "pending", {})                                     # a reassessment just sent
    ch = _detail(db, fresh)["changes"]
    assert (ch["compared"], ch["moved"], ch["weaker"], ch["stronger"], ch["items"]) == (True, 0, 0, 0, [])
    half = _sent(db, 12, "in_progress", {"mfa": "no"})
    ch = _detail(db, half)["changes"]
    assert (ch["moved"], ch["weaker"], [m["id"] for m in ch["items"]]) == (1, 1, ["mfa"])


def test_the_first_cycle_has_no_changes_and_a_reassessment_with_no_answered_cycle_before_says_so(db):
    first = _sent(db, 11, "accepted", {"mfa": "yes"})
    assert _detail(db, first)["changes"] is None
    again = _sent(db, 12, "submitted", {"mfa": "yes"})
    d = _detail(db, again)
    assert d["changes"]["cycle"] == 1 and d["changes"]["compared"] is True
    db.get(VendorQuestionnaireResponse, first.id).status = "pending"            # cycle 1 was never answered
    db.commit()
    d = _detail(db, again)
    assert (d["changes"]["compared"], d["changes"]["moved"], d["changes"]["items"]) == (False, 0, [])


def test_the_score_steps_are_the_saved_score_laid_out(db):
    qr = _sent(db, status="submitted", responses={"mfa": "no", "enc": "yes", "subs": "no"})
    d = _detail(db, qr)
    assert [(s["label"], s["value"]) for s in d["steps"]] == [
        ("Inherent risk", "60.0"), ("Cybersecurity", "30.6"), ("Fourth-Party/Concentration", "18.0"),
        ("Critical controls failed", "1"), ("Residual risk", "28.3"), ("Grade", "B")]
    assert d["steps"][1]["detail"] == "controls 70% · 2 of 2 scored"
    assert d["assessment"] == {"id": 12, "cycle": 2, "active": True, "lifecycle": True, "scored": True,
                               "scoring_skipped": False, "inherent_score": 60.0, "residual_score": 28.3,
                               "rating": "medium", "grade": "B"}
    db.add(TPRAStageInstance(tenant_id=1, vendor_id=1, assessment_id=12, stage_key="scoring", stage_order=5,
                             status="skipped"))
    db.commit()
    assert _detail(db, qr)["assessment"]["scoring_skipped"] is True        # a tier that skips scoring is not scored here

    unscored = _sent(db, 11, "submitted", {"mfa": "yes"})
    db.get(VendorAssessment, 11).residual_score = None
    db.get(VendorAssessment, 11).rating_grade = None
    db.commit()
    assert _detail(db, unscored)["steps"] == []                           # nothing scored yet: nothing to lay out


def test_a_questionnaire_with_no_review_reads_without_scores_or_changes(db):
    loose = _sent(db, assessment_id=None, status="submitted", responses={"mfa": "yes"})
    d = _detail(db, loose)
    assert (d["assessment"], d["changes"], d["steps"]) == (None, None, [])
    assert _rows(d)["mfa"]["credit"] == "full"


def test_another_tenants_questionnaire_is_not_found(db):
    qr = _sent(db)
    qr.tenant_id = 2
    db.commit()
    with pytest.raises(HTTPException) as nope:
        _detail(db, qr)
    assert nope.value.status_code == 404
    with pytest.raises(HTTPException) as gone:
        _cards(db, vendor_id=999)
    assert gone.value.status_code == 404
