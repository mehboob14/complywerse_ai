"""The supplier portal saves each answer as it is given, and shows no scoring.

An answer is its own request: it changes that question and its note and nothing else, so a
page left open (or a colleague answering at the same time) cannot wipe what is already
saved. The same rules as the whole-draft save apply, with a reason where the draft save would
have ignored the change. Sending afterwards needs no answers in the request: what is stored
is what is checked and attested. And what the supplier is sent of a question is what to ask
and how to answer it, never a weight, a score or a critical mark.
"""
import uuid
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, Evidence, EvidenceQualityCheck, GRCUser, Role, Tenant, TPRAActionItem, TPRAApproval, TPRAAuditLog, TPRACheckin,
    TPRAContract, TPRAControlObligation, TPRAEmailTemplate, TPRAEngagement, TPRAEvidenceLink, TPRAFinding, TPRAMessage,
    TPRAMonitoringSignal, TPRAPortalToken, TPRAQuestion, TPRAQuestionResponse, TPRAReminder, TPRARemediation,
    TPRAReviewAssignment, TPRARiskAcceptance, TPRARiskSnapshot, TPRASupplierRequest, TPRASupplierRequestFile,
    TPRASurfaceWaiver, TPRATemplateVersion, TPRATieringConfig, TPRAVendorContact, UserRole, Vendor, VendorAssessment,
    VendorQuestionnaireEvidence, VendorQuestionnaireResponse, VendorQuestionnaireTemplate, get_db,
)
from grc.modules.vendor_risk.routers import questionnaires as routes
from grc.modules.vendor_risk.tpra import contacts, portal, supplier_portal

_TABLES = [Tenant, GRCUser, Role, UserRole, Vendor, VendorAssessment, VendorQuestionnaireTemplate,
           VendorQuestionnaireResponse, VendorQuestionnaireEvidence, TPRATemplateVersion, TPRAQuestion,
           TPRAQuestionResponse, TPRAFinding, TPRATieringConfig, TPRAAuditLog, TPRAReminder, TPRARiskAcceptance,
           TPRARemediation, TPRAContract, TPRAControlObligation, TPRAEvidenceLink, Evidence, EvidenceQualityCheck,
           TPRAApproval, TPRARiskSnapshot, TPRAMonitoringSignal, TPRACheckin, TPRASurfaceWaiver, TPRAEmailTemplate,
           TPRAActionItem, TPRAVendorContact, TPRAPortalToken, TPRASupplierRequest, TPRASupplierRequestFile, TPRAMessage,
           TPRAEngagement, TPRAReviewAssignment]

# What an author writes, with everything the supplier must not see: weights, scores, critical and
# blocking marks, the follow-up questionnaire, the certificate switch.
QUESTIONS = [
    {"id": "subs", "text": "Do you use subprocessors?", "type": "yes_no", "required": True, "weight": 3,
     "critical_control": True, "domain": "fourth_party", "certificate_covers": True, "blocks_approval": True,
     "follow_up": {"when": ["no"], "template_id": 9}},
    {"id": "subs_list", "text": "List them.", "type": "text", "show_if": {"question": "subs", "in": ["yes"]}},
    {"id": "mfa", "text": "Is MFA enforced?", "type": "yes_no", "required": True, "section": "Access",
     "evidence": "required", "evidence_on": ["yes"], "help_text": "For staff and admins."},
    {"id": "region", "text": "Where is the data held?", "type": "multiple_choice", "options": [
        {"value": "eu", "label": "EU", "score": 1.0}, {"value": "us", "label": "US", "score": 0.4},
        {"value": "other", "label": "Somewhere else", "score": 0.0, "comment_required": True}]},
    {"id": "policy", "text": "Upload your policy.", "type": "file"},
]
NOT_SHOWN = {"weight", "critical_control", "certificate_covers", "blocks_approval", "follow_up", "order", "key", "qtype"}
SHOWN_OPTION = {"value", "label", "na", "not_applicable", "comment_required"}


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme Bank", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="a@acme.test", display_name="Ana Lyst", is_active=True))
    s.add(Vendor(id=1, tenant_id=1, name="Payroll Co", status="active", owner_id=7))
    s.add(Vendor(id=2, tenant_id=1, name="Print Co", status="active", owner_id=7))
    s.add(VendorQuestionnaireTemplate(id=5, tenant_id=1, name="Security", questions=QUESTIONS))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db, monkeypatch):
    monkeypatch.setattr(portal, "throttle", portal.Throttle(limit=portal.throttle.limit))   # fresh counts, the real allowance
    app = FastAPI()
    for r in (routes.router, supplier_portal.router):
        app.include_router(r, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app)


def _link(db, vendor_id=1) -> str:
    contact = contacts.add(db, db.get(Vendor, vendor_id), 7, name="Ana Ops", email="ana@payroll.test", job_title="CISO")
    raw, _ = contacts.issue(db, contact, "invite")
    db.commit()
    return raw


def _questionnaire(db, vendor_id=1, **kw) -> VendorQuestionnaireResponse:
    qr = VendorQuestionnaireResponse(tenant_id=1, vendor_id=vendor_id, template_id=5,
                                     token=kw.pop("token", portal.sealed_token()), status=kw.pop("status", "pending"), **kw)
    db.add(qr)
    db.commit()
    return qr


def _put(http, base, question, value=None, comment=None):
    return http.put(f"{base}/answers/{question}", json={"value": value, "comment": comment})


def _stored(db, qr) -> VendorQuestionnaireResponse:
    db.expire_all()
    return db.get(VendorQuestionnaireResponse, qr.id)


@pytest.fixture()
def mine(db, http):
    """A questionnaire and the personal-link path to it."""
    qr = _questionnaire(db)
    return qr, f"/vendor-risk/portal/{_link(db)}/questionnaires/{qr.id}"


# ── what the supplier is sent ────────────────────────────────────────────────

def test_the_supplier_is_sent_what_to_ask_and_never_how_an_answer_scores(db, http, mine):
    qr, base = mine
    own = _questionnaire(db, token=str(uuid.uuid4()))
    for path in (base, f"/vendor-risk/questionnaires/external/{own.token}"):
        shown = http.get(path)
        assert shown.status_code == 200, path
        questions = {q["id"]: q for q in shown.json()["questions"]}
        assert list(questions) == ["subs", "subs_list", "mfa", "region", "policy"], path
        for q in questions.values():
            assert not NOT_SHOWN & set(q), (path, q["id"], sorted(NOT_SHOWN & set(q)))
            for option in q["options"]:
                assert set(option) <= SHOWN_OPTION, (path, q["id"], option)      # no score, no finding
        # ...and what the page needs to ask and to apply its own rules is all there
        assert (questions["subs"]["text"], questions["subs"]["type"], questions["subs"]["required"]) == (
            "Do you use subprocessors?", "yes_no", True)
        assert [(o["value"], o.get("na", False)) for o in questions["subs"]["options"]] == [
            ("yes", False), ("partial", False), ("no", False), ("n-a", True)]
        assert questions["subs_list"]["show_if"] == {"question": "subs", "in": ["yes"]}
        assert (questions["mfa"]["section"], questions["mfa"]["evidence"], questions["mfa"]["evidence_on"],
                questions["mfa"]["help_text"]) == ("Access", "required", ["yes"], "For staff and admins.")
        assert questions["subs"]["domain"] == "fourth_party"                    # a section heading, not a score
        assert questions["region"]["options"][2] == {"value": "other", "label": "Somewhere else", "comment_required": True}
        assert questions["policy"]["type"] == "file"


def test_the_questionnaire_names_who_asks_and_when_it_was_sent(db, http, mine):
    qr, base = mine
    first = http.get(base).json()
    assert (first["organisation"], first["vendor_name"], first["submitted_at"]) == ("Acme Bank", "Payroll Co", None)
    _put(http, base, "subs", "no")
    _put(http, base, "mfa", "no")
    assert http.post(base, json={"attestation": {"confirm": True}, "submit": True}).status_code == 200
    again = http.get(base).json()
    assert again["status"] == "submitted" and again["submitted_at"]
    assert not NOT_SHOWN & set(again["questions"][0])


def test_the_vendor_view_rules_on_their_own():
    shown = portal.vendor_questions([{**QUESTIONS[0], "qtype": "yes_no", "options": ["Yes", {"value": "no", "score": 0}]}])
    assert shown == [{"id": "subs", "text": "Do you use subprocessors?", "required": True, "domain": "fourth_party",
                      "type": "yes_no", "options": ["Yes", {"value": "no"}]}]
    assert portal.vendor_questions(None) == [] and portal.vendor_questions([{"id": "x", "qtype": "rating"}])[0]["type"] == "rating"


# ── one answer ───────────────────────────────────────────────────────────────

def test_an_answer_saves_on_its_own_and_leaves_every_other_answer_alone(db, http, mine):
    qr, base = mine
    first = _put(http, base, "subs", "no")
    assert first.status_code == 200 and first.json()["status"] == "in_progress"
    assert _put(http, base, "mfa", "yes", "Everywhere").status_code == 200
    stored = _stored(db, qr)
    assert stored.responses == {"subs": "no", "mfa": "yes"} and stored.vendor_comments == {"mfa": "Everywhere"}
    assert stored.contact_id                                                          # the contact is answering

    # A colleague's answer, then a page that never saw it saves its own: both stay.
    assert _put(http, base, "region", "eu").status_code == 200
    assert _stored(db, qr).responses == {"subs": "no", "mfa": "yes", "region": "eu"}

    # Nothing in the request clears an answer except an empty value, and a note only an empty note.
    assert _put(http, base, "mfa", "yes", None).status_code == 200
    assert _stored(db, qr).vendor_comments == {}
    _put(http, base, "mfa", "", "")
    assert _stored(db, qr).responses == {"subs": "no", "region": "eu"}
    _put(http, base, "region", "", "Still deciding")
    stored = _stored(db, qr)
    assert stored.responses == {"subs": "no"} and stored.vendor_comments == {"region": "Still deciding"}


def test_a_follow_up_answer_goes_when_the_answer_that_asked_for_it_changes(db, http, mine):
    qr, base = mine
    _put(http, base, "subs", "yes")
    assert _put(http, base, "subs_list", "Stripe, AWS").status_code == 200
    assert _stored(db, qr).responses == {"subs": "yes", "subs_list": "Stripe, AWS"}
    _put(http, base, "subs", "no")
    assert _stored(db, qr).responses == {"subs": "no"}                                # the list no longer applies
    _put(http, base, "subs_list", "stale")                                            # not asked now: nothing is kept
    assert _stored(db, qr).responses == {"subs": "no"}


def test_an_answer_that_needs_words_is_refused_without_them(db, http, mine):
    qr, base = mine
    for question, value, said in (("mfa", "n-a", "Say why this does not apply to you"),
                                  ("region", "other", "Explain your answer")):
        refused = _put(http, base, question, value)
        assert (refused.status_code, refused.json()["detail"]) == (400, said)
        assert _put(http, base, question, value, "  ").status_code == 400
    assert _stored(db, qr).responses in (None, {})
    assert _put(http, base, "mfa", "n-a", "Not offered to staff").status_code == 200
    assert _put(http, base, "region", "other", "Hosted in Dubai").status_code == 200
    assert _stored(db, qr).responses == {"mfa": "n-a", "region": "other"}
    # an answer that is not one of the options is not stored; free text and files are not checked that way
    assert _put(http, base, "mfa", "maybe").json()["detail"] == "That is not one of the answers to this question"
    assert _put(http, base, "policy", "typed").status_code == 200
    assert "policy" not in _stored(db, qr).responses                                  # a file is its own answer
    assert _put(http, base, "nope", "yes").status_code == 404


def test_a_returned_questionnaire_takes_an_answer_only_where_it_was_asked(db, http):
    qr = _questionnaire(db, status="returned", responses={"subs": "no", "mfa": "partial"},
                        review={"mfa": {"status": "clarify", "note": "Which systems?"}})
    base = f"/vendor-risk/portal/{_link(db)}/questionnaires/{qr.id}"
    refused = _put(http, base, "subs", "yes")
    assert (refused.status_code, refused.json()["detail"]) == (409, "Only the questions your contact asked about can change now")
    assert _put(http, base, "mfa", "yes", "Now on every system").status_code == 200
    stored = _stored(db, qr)
    assert (stored.status, stored.responses, stored.vendor_comments) == (
        "returned", {"subs": "no", "mfa": "yes"}, {"mfa": "Now on every system"})


def test_an_answer_a_certificate_gave_cannot_change(db, http):
    qr = _questionnaire(db, responses={"subs": "yes"}, certificate_mode="skip", certificate_evidence_id=1)
    base = f"/vendor-risk/portal/{_link(db)}/questionnaires/{qr.id}"
    refused = _put(http, base, "subs", "no")
    assert (refused.status_code, _stored(db, qr).responses) == (409, {"subs": "yes"})
    assert _put(http, base, "mfa", "no").status_code == 200


# ── the link rules still hold for one answer ─────────────────────────────────

def test_a_single_answer_gets_the_same_refusals_as_the_rest_of_the_portal(db, http, mine):
    qr, base = mine
    theirs = _questionnaire(db, vendor_id=2)
    raw = base.split("/portal/")[1].split("/")[0]
    other = _put(http, f"/vendor-risk/portal/{raw}/questionnaires/{theirs.id}", "subs", "no")
    assert (other.status_code, other.json()["detail"]) == (404, supplier_portal.GONE)       # another supplier's
    assert _put(http, f"/vendor-risk/portal/{raw}/questionnaires/999999", "subs", "no").status_code == 404
    assert _stored(db, theirs).responses in (None, {})
    assert _put(http, f"/vendor-risk/portal/{uuid.uuid4().hex}/questionnaires/{qr.id}", "subs", "no").status_code == 404

    qr.expires_at = datetime.utcnow() - timedelta(minutes=1)
    db.commit()
    assert _put(http, base, "subs", "no").status_code == 410                                # the questionnaire has expired
    qr.expires_at, qr.status = None, "submitted"
    db.commit()
    assert _put(http, base, "subs", "no").status_code == 400                                # sent: no more changes


def test_failed_lookups_from_one_address_stop_it_saving_too(db, http, mine):
    qr, base = mine
    for _ in range(10):
        assert _put(http, f"/vendor-risk/portal/{uuid.uuid4().hex}/questionnaires/{qr.id}", "subs", "no").status_code == 404
    assert _put(http, base, "subs", "no").status_code == 429                          # even a good link, from there
    elsewhere = TestClient(http.app, client=("203.0.113.9", 50000))
    assert _put(elsewhere, base, "subs", "no").status_code == 200


def test_a_questionnaire_sent_on_a_link_of_its_own_saves_answers_the_same_way(db, http):
    own = _questionnaire(db, token=str(uuid.uuid4()))
    base = f"/vendor-risk/questionnaires/external/{own.token}"
    assert _put(http, base, "subs", "no").status_code == 200
    assert _put(http, base, "mfa", "yes", "All staff").status_code == 200
    assert _stored(db, own).responses == {"subs": "no", "mfa": "yes"}
    assert _put(http, base, "mfa", "n-a").status_code == 400
    assert _put(http, f"/vendor-risk/questionnaires/external/{uuid.uuid4()}", "subs", "no").status_code == 404
    sealed = _questionnaire(db)                                                       # a personal-link questionnaire's own token is never a link
    assert _put(http, f"/vendor-risk/questionnaires/external/{sealed.token}", "subs", "no").status_code == 404


def test_the_questionnaire_row_is_locked_before_it_is_read(db, http, mine, monkeypatch):
    qr, base = mine
    calls, real = [], db.refresh
    monkeypatch.setattr(db, "refresh", lambda obj, *a, **k: (calls.append(k), real(obj, *a, **k))[1])
    assert _put(http, base, "subs", "no").status_code == 200
    assert calls[0] == {"with_for_update": True}                 # two answers arriving together are applied one after the other


def test_a_long_questionnaire_can_be_answered_without_hitting_the_limit(db, http, mine):
    qr, base = mine
    assert portal.throttle.limit == 600
    for n in range(130):
        assert _put(http, base, "region", "eu" if n % 2 else "us").status_code == 200, n


# ── sending ──────────────────────────────────────────────────────────────────

def test_sending_with_no_answers_in_the_request_checks_and_keeps_what_is_stored(db, http, mine):
    qr, base = mine
    _put(http, base, "subs", "no")
    short = http.post(base, json={"attestation": {"confirm": True}, "submit": True})
    assert short.status_code == 400 and "1 question needs an answer" in short.json()["detail"]
    assert _stored(db, qr).responses == {"subs": "no"}                                # the failed send wiped nothing

    _put(http, base, "mfa", "no")
    done = http.post(base, json={"attestation": {"confirm": True}, "submit": True})
    assert done.status_code == 200 and done.json()["status"] == "submitted" and done.json()["submitted_at"]
    stored = _stored(db, qr)
    assert stored.responses == {"subs": "no", "mfa": "no"}
    assert (stored.attested_name, stored.attested_title) == ("Ana Ops", "CISO")


def test_a_request_that_does_send_answers_still_replaces_them(db, http, mine):
    qr, base = mine
    _put(http, base, "subs", "no")
    _put(http, base, "mfa", "no")
    assert http.post(base, json={"responses": {"subs": "yes"}, "submit": False}).status_code == 200
    assert _stored(db, qr).responses == {"subs": "yes"}                               # the whole-draft save, as before
    assert http.post(base, json={"responses": {}, "submit": False}).status_code == 200
    assert _stored(db, qr).responses in (None, {})


def test_a_questionnaire_on_its_own_link_is_sent_the_same_way(db, http):
    own = _questionnaire(db, token=str(uuid.uuid4()))
    base = f"/vendor-risk/questionnaires/external/{own.token}"
    _put(http, base, "subs", "no")
    _put(http, base, "mfa", "no")
    who = {"name": "Sam Lee", "email": "sam@payroll.test", "confirm": True}
    done = http.post(base, json={"attestation": who, "submit": True})
    assert done.status_code == 200 and done.json()["status"] == "submitted"
    assert _stored(db, own).responses == {"subs": "no", "mfa": "no"}
