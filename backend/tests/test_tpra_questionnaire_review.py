"""The questionnaire reviewer loop and a hardened vendor portal.

A submission now takes a named person attesting to it. The reviewer accepts or
questions each answer, returns the questionnaire (after which the vendor can
change only what was asked about) or accepts it (after which the link is dead).
A resend issues a new link and kills the old one; each link is rate-limited;
conditional questions are re-worked on the server at submit; and the answers
are due on a date of their own, apart from when the link expires, with the
respondent reminded on the usual rhythm.
"""
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    TPRAMonitoringSignal, Base, GRCUser, Role, Tenant, TPRAAuditLog, TPRAFinding, TPRAQuestion, TPRAQuestionResponse, TPRAReminder,
    TPRARiskAcceptance, TPRARemediation, TPRAContract, TPRAControlObligation, TPRAEvidenceLink, Evidence,
    TPRAApproval, TPRARiskSnapshot, TPRATemplateVersion, TPRATieringConfig, UserRole, Vendor,
    VendorAssessment, VendorQuestionnaireEvidence, VendorQuestionnaireResponse, VendorQuestionnaireTemplate, get_db,
)
from grc.modules.vendor_risk.routers import questionnaires as routes
from grc.modules.vendor_risk.tpra import attention, portal, rbac, reminders
from grc.modules.vendor_risk.tpra.bootstrap import DEFAULT_TIERING_CONFIG
from grc.routers.auth_router import require_auth

_TABLES = [Tenant, GRCUser, Role, UserRole, Vendor, VendorAssessment, VendorQuestionnaireTemplate,
           VendorQuestionnaireResponse, VendorQuestionnaireEvidence, TPRATemplateVersion, TPRAQuestion,
           TPRAQuestionResponse, TPRAFinding, TPRATieringConfig, TPRAAuditLog, TPRAReminder, TPRARiskAcceptance,
           TPRARemediation, TPRAContract, TPRAControlObligation, TPRAEvidenceLink, Evidence, TPRAApproval,
           TPRARiskSnapshot, TPRAMonitoringSignal]

QUESTIONS = [
    {"id": "subs", "text": "Do you use subprocessors?", "type": "yes_no", "required": True},
    {"id": "subs_list", "text": "List them.", "type": "text", "required": True,
     "show_if": {"question": "subs", "in": ["yes"]}},
    {"id": "mfa", "text": "Is MFA enforced?", "type": "yes_no", "required": True},
]
ATTEST = {"name": "Sam Vendor", "email": "sam@vendor.test", "title": "CISO", "confirm": True}


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


@pytest.fixture()
def http(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    monkeypatch.setattr(routes, "_email_link", lambda *a, **k: None)
    monkeypatch.setattr(portal, "throttle", portal.Throttle())
    app = FastAPI()
    app.include_router(routes.router, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def _send(db, http, **extra):
    template = VendorQuestionnaireTemplate(tenant_id=1, name="Security", questions=QUESTIONS)
    vendor = Vendor(tenant_id=1, name="Acme Cloud", status="active", owner_id=7)
    db.add_all([template, vendor])
    db.commit()
    sent = http.post("/vendor-risk/questionnaires/send",
                     json={"vendor_id": vendor.id, "template_id": template.id, **extra})
    assert sent.status_code == 201, sent.text
    body = sent.json()
    return body["token"], body["questionnaire_response"]["id"]


def _portal(http, token):
    return f"/vendor-risk/questionnaires/external/{token}"


def _submit(http, token, answers, attestation=ATTEST, **extra):
    return http.post(_portal(http, token), json={"responses": answers, "attestation": attestation,
                                                 "submit": True, **extra})


# ── the rules on their own ───────────────────────────────────────────────────

def test_a_conditional_question_applies_only_when_its_trigger_does():
    assert [q["id"] for q in portal.visible_questions(QUESTIONS, {"subs": "yes"})] == ["subs", "subs_list", "mfa"]
    assert [q["id"] for q in portal.visible_questions(QUESTIONS, {"subs": "no"})] == ["subs", "mfa"]
    assert portal.missing_required(QUESTIONS, {"subs": "no", "mfa": "yes"}) == []
    assert portal.missing_required(QUESTIONS, {"subs": "yes", "mfa": "yes"}) == ["subs_list"]


def test_an_attestation_needs_a_name_an_email_and_a_confirmation():
    for broken in ({}, {**ATTEST, "name": " "}, {**ATTEST, "email": "sam"}, {**ATTEST, "confirm": False}):
        with pytest.raises(ValueError):
            portal.clean_attestation(broken)
    assert portal.clean_attestation(ATTEST)["name"] == "Sam Vendor"


def test_a_link_is_rate_limited():
    limiter = portal.Throttle(limit=3, window=60)
    assert [limiter.allow("t", now=n) for n in (0, 1, 2, 3)] == [True, True, True, False]
    assert limiter.allow("t", now=62) is True                 # the window moved on
    assert limiter.allow("other", now=3) is True              # each link has its own


# ── through the portal ───────────────────────────────────────────────────────

def test_submitting_takes_a_named_attester_and_hidden_answers_do_not_count(db, http):
    token, qr_id = _send(db, http)
    draft = http.post(_portal(http, token), json={"responses": {"subs": "no"}, "submit": False})
    assert draft.json()["status"] == "in_progress"

    assert _submit(http, token, {"subs": "no", "mfa": "yes"}, attestation=None).status_code == 400
    assert _submit(http, token, {"subs": "yes", "mfa": "yes"}).status_code == 400   # the list is now required
    done = _submit(http, token, {"subs": "no", "subs_list": "stale answer", "mfa": "yes"})
    assert done.status_code == 200 and done.json()["status"] == "submitted"

    qr = db.get(VendorQuestionnaireResponse, qr_id)
    assert qr.responses == {"subs": "no", "mfa": "yes"}                 # the hidden answer was dropped
    assert (qr.attested_name, qr.attested_title, qr.attested_email) == ("Sam Vendor", "CISO", "sam@vendor.test")
    assert http.get(_portal(http, token)).status_code == 400           # submitted: no more changes


def test_a_returned_questionnaire_lets_the_vendor_change_only_what_was_asked(db, http):
    token, qr_id = _send(db, http)
    _submit(http, token, {"subs": "no", "mfa": "partial"})
    base = f"/vendor-risk/questionnaire-responses/{qr_id}"

    assert http.post(f"{base}/return").status_code == 400             # nothing asked about yet
    assert http.post(f"{base}/review", json={"question_key": "mfa", "decision": "clarify"}).status_code == 400
    http.post(f"{base}/review", json={"question_key": "subs", "decision": "accept"})
    http.post(f"{base}/review", json={"question_key": "mfa", "decision": "clarify",
                                      "note": "Which systems are not covered?"})
    returned = http.post(f"{base}/return", json={"due_in_days": 5})
    assert returned.json()["status"] == "returned"

    shown = http.get(_portal(http, token)).json()
    assert shown["clarifications"] == {"mfa": "Which systems are not covered?"}
    again = _submit(http, token, {"subs": "yes", "mfa": "yes"}, comments={"mfa": "Now on every system."})
    assert again.status_code == 200

    qr = db.get(VendorQuestionnaireResponse, qr_id)
    assert qr.responses == {"subs": "no", "mfa": "yes"}                 # subs was not asked about
    assert qr.vendor_comments == {"mfa": "Now on every system."}
    assert qr.review["mfa"]["status"] == "answered" and qr.status == "submitted"


def test_accepting_closes_the_link_and_records_who_accepted(db, http):
    token, qr_id = _send(db, http)
    _submit(http, token, {"subs": "no", "mfa": "yes"})
    base = f"/vendor-risk/questionnaire-responses/{qr_id}"

    http.post(f"{base}/review", json={"question_key": "mfa", "decision": "clarify", "note": "Evidence?"})
    assert http.post(f"{base}/accept").status_code == 409             # a question is still open
    http.post(f"{base}/review", json={"question_key": "mfa", "decision": "clear"})
    accepted = http.post(f"{base}/accept").json()

    assert accepted["status"] == "accepted" and accepted["token"] is None
    assert {k: v["status"] for k, v in accepted["review"].items()} == {"subs": "accepted", "mfa": "accepted"}
    assert http.get(_portal(http, token)).status_code == 404           # the old link is dead
    actions = [a.action for a in db.query(TPRAAuditLog).filter(TPRAAuditLog.entity == "questionnaire")]
    assert actions == ["review", "review", "accept"]


def test_a_resend_issues_a_new_link_and_kills_the_old_one(db, http):
    token, qr_id = _send(db, http, due_in_days=10, expires_in_days=20)
    qr = db.get(VendorQuestionnaireResponse, qr_id)
    assert (qr.expires_at - qr.due_date).days == 10

    fresh = http.post(f"/vendor-risk/questionnaire-responses/{qr_id}/resend").json()["token"]
    assert fresh != token
    assert http.get(_portal(http, token)).status_code == 404
    assert http.get(_portal(http, fresh)).status_code == 200

    _submit(http, fresh, {"subs": "no", "mfa": "yes"})
    assert http.post(f"/vendor-risk/questionnaire-responses/{qr_id}/resend").status_code == 409


def test_an_expired_link_answers_gone(db, http):
    token, qr_id = _send(db, http)
    db.get(VendorQuestionnaireResponse, qr_id).expires_at = datetime.utcnow() - timedelta(minutes=1)
    db.commit()
    assert http.get(_portal(http, token)).status_code == 410


# ── reminders and the queue ──────────────────────────────────────────────────

class Outbox:
    def __init__(self):
        self.sent = []

    def __call__(self, db, tenant_id, email, subject, message):
        self.sent.append((email, subject, message))


def _waiting(db, due: date, status="pending", expires: date = None):
    vendor = Vendor(tenant_id=1, name="Acme Cloud", status="active", owner_id=7)
    db.add(vendor)
    db.flush()
    qr = VendorQuestionnaireResponse(
        tenant_id=1, vendor_id=vendor.id, token="tok", status=status, respondent_email="sam@vendor.test",
        due_date=datetime(due.year, due.month, due.day, 9),
        expires_at=datetime(*(expires or due + timedelta(days=30)).timetuple()[:3], 9))
    db.add(qr)
    db.commit()
    return qr


def test_the_respondent_is_reminded_by_email_once_per_period(db):
    today = date(2026, 9, 23)
    _waiting(db, due=today + timedelta(days=5))
    outbox = Outbox()
    policy = dict(DEFAULT_TIERING_CONFIG["reminder_policy"])
    for _ in range(2):
        reminders.run(db, 1, policy, today=today, deliver=lambda *a: None, deliver_external=outbox)
    assert len(outbox.sent) == 1
    email, subject, _ = outbox.sent[0]
    assert email == "sam@vendor.test" and subject.startswith("Reminder: the questionnaire for Acme Cloud, due in 5 days")
    assert db.query(TPRAReminder).filter(TPRAReminder.recipient_id == 0).count() == 1


def test_no_reminder_once_the_link_has_expired(db):
    today = date(2026, 9, 23)
    _waiting(db, due=today - timedelta(days=20), expires=today - timedelta(days=1))
    outbox = Outbox()
    reminders.run(db, 1, dict(DEFAULT_TIERING_CONFIG["reminder_policy"]), today=today,
                  deliver=lambda *a: None, deliver_external=outbox)
    assert outbox.sent == []


def test_answers_waiting_for_review_join_the_attention_queue(db):
    today = date(2026, 9, 23)
    qr = _waiting(db, due=today, status="submitted")
    qr.submitted_at = datetime(2026, 9, 18, 10)
    db.commit()
    items = [i for i in attention.open_items(db, 1, today, {}) if i["condition"] == "questionnaire_to_review"]
    assert len(items) == 1 and items[0]["badge"] == "Submitted 5 days ago"
