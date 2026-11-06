"""Reviewers per section, comments on answers, and the question rules.

A reviewer's "done" means something: it needs a decision on every question of the
section, accepting the questionnaire waits for every reviewer, and planning counts
the people assigned. Only the reviewer, the assessment's TPRM lead or an
administrator moves an assignment along. A comment shared with the supplier
reaches it on that question in the portal (and by email), where the contact
replies; an internal one is in no public payload. At submit, and again at the
stage-4 gate, evidence counts only when linked to the question that owes it, a
not-applicable answer needs a reason, a file question is answered by its file,
and hidden or optional questions never count as unanswered. A question from
before the rules, with only evidence_required, owes evidence on Yes or Partial.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, Evidence, GRCUser, Role, Tenant, TPRAAuditLog, TPRAEvidenceLink, TPRAMessage, TPRAVendorContact, UserRole,
    Vendor, VendorAssessment, VendorQuestionnaireEvidence, VendorQuestionnaireResponse, VendorQuestionnaireTemplate,
    get_db,
)
from grc.modules.vendor_risk.routers import questionnaires as routes
from grc.modules.vendor_risk.tpra import (
    contacts, portal, rbac, reviews, service, supplier_portal, supplier_requests, versions,
)
from grc.modules.vendor_risk.tpra import questionnaire_evidence as qevidence
from grc.modules.vendor_risk.tpra.engine_gates import evaluate_stage_exit
from grc.modules.vendor_risk.tpra.engine_scoring import answer_score
from grc.modules.workflow_engine.services import notification_service
from grc.routers.auth_router import require_auth

ANALYST, RITA, LEAD, ADMIN, SAM = 7, 8, 9, 10, 12
QUESTIONS = [
    {"id": "mfa", "text": "Is MFA enforced?", "type": "yes_no", "required": True, "domain": "cybersecurity",
     "evidence": "required", "evidence_on": ["yes", "partial"]},
    {"id": "enc", "text": "Is data encrypted at rest?", "type": "yes_no", "required": True, "domain": "cybersecurity"},
    {"id": "dpa", "text": "Will you sign our DPA?", "type": "yes_no", "required": True, "section": "Privacy",
     "evidence": "required"},
    {"id": "hosting", "text": "Where is our data held?", "type": "multiple_choice", "required": True,
     "section": "Privacy", "options": [{"value": "eu", "label": "In the EU", "score": 1},
                                       {"value": "elsewhere", "label": "Elsewhere", "score": 0.5,
                                        "comment_required": True},
                                       {"value": "none_held", "label": "We hold none", "not_applicable": True}]},
    {"id": "soc2", "text": "Your latest SOC 2 report.", "type": "file", "required": True, "section": "Assurance"},
    {"id": "subs", "text": "Do you use subprocessors?", "type": "yes_no", "required": False, "domain": "fourth_party"},
    {"id": "subs_list", "text": "List them.", "type": "text", "required": True, "domain": "fourth_party",
     "show_if": {"question": "subs", "in": ["yes"]}},
]
PDF = ("x.pdf", b"%PDF-1.4 x", "application/pdf")


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme Bank", slug="acme"))
    s.add(Role(id=1, name="Administrator"))
    s.add_all([GRCUser(id=uid, username=f"u{uid}", email=f"u{uid}@acme.test", display_name=name, is_active=True)
               for uid, name in ((ANALYST, "Ana Lyst"), (RITA, "Rita Ray"), (LEAD, "Leo Lead"), (ADMIN, "Ada Admin"),
                                 (SAM, "Sam Second"))])
    s.add(UserRole(user_id=ADMIN, role_id=1, tenant_id=1))
    s.add(Vendor(id=1, tenant_id=1, name="Payroll Co", status="active", tier="high", owner_id=ANALYST,
                 active_assessment_id=11))
    s.add(VendorAssessment(id=11, tenant_id=1, vendor_id=1, version_no=1, lifecycle_status="active",
                           status="in_progress", current_stage="dd_planning", inherent_tier="high",
                           team_roster={"tprm_lead": LEAD}))
    s.add(VendorQuestionnaireTemplate(id=5, tenant_id=1, name="Security", questions=QUESTIONS))
    s.add(TPRAVendorContact(id=3, tenant_id=1, vendor_id=1, name="Sam Lee", email="sam@payroll.test",
                            is_primary=True, portal_access=True))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def me():
    return {"id": ANALYST}


@pytest.fixture()
def mail(monkeypatch):
    """Emails to suppliers, recorded instead of sent: (to, subject, text)."""
    box = []
    monkeypatch.setattr(contacts, "deliver", lambda db, tid, to, subject, text, html: box.append((to, subject, text)) or True)
    return box


@pytest.fixture()
def told(monkeypatch):
    """Notices to our people, recorded instead of sent."""
    box = []
    monkeypatch.setattr(notification_service, "send_workflow_notification", lambda db, **kw: box.append(kw) or {})
    return box


@pytest.fixture()
def http(db, me, mail, told, monkeypatch, tmp_path):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    monkeypatch.setattr(portal, "throttle", portal.Throttle())
    monkeypatch.setattr(routes, "EVIDENCE_UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(qevidence, "_review_later", lambda *a, **k: None)
    app = FastAPI()
    for r in (reviews.router, supplier_portal.router, supplier_requests.router, routes.router):
        app.include_router(r, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, me["id"])
    return TestClient(app)


def _sent(db, status="pending", responses=None, questions=None, **kw) -> VendorQuestionnaireResponse:
    template = db.get(VendorQuestionnaireTemplate, 5)
    if questions is not None:
        template.questions = questions
    qr = VendorQuestionnaireResponse(
        tenant_id=1, vendor_id=1, assessment_id=11, template_id=5, template_version_id=versions.publish(db, template).id,
        token=portal.sealed_token(), status=status, contact_id=3, responses=responses or {},
        expires_at=datetime.utcnow() + timedelta(days=30), due_date=datetime.utcnow() + timedelta(days=14), **kw)
    db.add(qr)
    db.commit()
    return qr


def _link(db) -> str:
    raw, _ = contacts.issue(db, db.get(TPRAVendorContact, 3), "questionnaire")
    db.commit()
    return raw


def _base(raw, qr) -> str:
    return f"/vendor-risk/portal/{raw}/questionnaires/{qr.id}"


def _submit(http, base, responses, comments=None):
    return http.post(base, json={"responses": responses, "comments": comments or {}, "attestation": {"confirm": True},
                                 "submit": True})


GOOD = {"mfa": "yes", "enc": "yes", "dpa": "yes", "hosting": "eu", "subs": "no"}


# ── the rules on their own ───────────────────────────────────────────────────

def test_the_question_rules_on_their_own():
    q = {q["id"]: q for q in versions.freeze(QUESTIONS)}
    assert portal.evidence_rule(q["mfa"]) == ("required", {"yes", "partial"})
    assert portal.owes_evidence(q["mfa"], "yes") and portal.owes_evidence(q["mfa"], "Partial")
    assert not portal.owes_evidence(q["mfa"], "no") and not portal.owes_evidence(q["mfa"], "")
    assert portal.owes_evidence(q["dpa"], "no")                          # required on any answer
    assert not portal.owes_evidence(q["dpa"], "n-a")                    # not applicable: a reason instead
    assert not portal.owes_evidence(q["enc"], "yes")                    # neither key: optional
    assert portal.note_needed(q["hosting"], "elsewhere") == "note"
    assert portal.note_needed(q["hosting"], "none_held") == "reason"
    assert portal.note_needed(q["enc"], "n-a") == "reason" and portal.note_needed(q["hosting"], "eu") is None
    assert portal.missing_required(QUESTIONS, GOOD) == ["soc2"]
    assert portal.missing_required(QUESTIONS, GOOD, evidence={"soc2"}) == []
    found = portal.problems(QUESTIONS, {**GOOD, "hosting": "elsewhere"}, {}, evidence={"enc"})
    assert found == {"answer": ["soc2"], "document": ["mfa", "dpa"], "reason": [], "note": ["hosting"]}
    assert portal.problem_sentence(found) == ("Before you submit: 1 question needs an answer, 2 questions need a "
                                              "document and 1 answer needs a note.")
    assert portal.problem_sentence({"answer": [], "document": []}) is None


def test_the_rules_ride_along_in_the_version_sent():
    frozen = {q["id"]: q for q in versions.freeze([
        {"id": "a", "type": "yes_no", "options": [{"value": "no", "comment_required": True}]},
        {"id": "b", "type": "multiple_choice", "evidence": "required", "evidence_on": ["x"],
         "options": [{"value": "x", "label": "X", "score": 1}, {"value": "skip", "label": "N/A", "not_applicable": True}]},
    ])}
    no = frozen["a"]["options"][2]
    assert (no["label"], no["score"], no["comment_required"]) == ("No", 0.0, True)     # the defaults it left out stay
    assert [o["value"] for o in frozen["a"]["options"]] == ["yes", "partial", "no", "n-a"]
    assert frozen["b"]["evidence_on"] == ["x"] and frozen["b"]["options"][1]["na"] is True
    assert answer_score(frozen["b"], "skip") == ("N/A", None) and frozen["b"]["options"][1].get("finding") is None


# ── at submit ────────────────────────────────────────────────────────────────

def test_submit_holds_the_supplier_to_the_rules_with_one_sentence(db, http):
    qr, raw = _sent(db), _link(db)
    base = _base(raw, qr)
    refused = _submit(http, base, {**GOOD, "hosting": "elsewhere"})
    assert refused.status_code == 400
    assert refused.json()["detail"] == ("Before you submit: 1 question needs an answer, 2 questions need a document "
                                        "and 1 answer needs a note.")
    # Evidence on another question does not count for the one that owes it.
    assert http.post(f"{base}/evidence/enc", files={"file": PDF}).status_code == 200
    assert "2 questions need a document" in _submit(http, base, {**GOOD, "hosting": "elsewhere"}).json()["detail"]
    for key in ("mfa", "dpa", "soc2"):                                  # the file is soc2's answer
        assert http.post(f"{base}/evidence/{key}", files={"file": PDF}).status_code == 200
    assert _submit(http, base, {**GOOD, "hosting": "elsewhere"}).json()["detail"] == (
        "Before you submit: 1 answer needs a note.")
    done = _submit(http, base, {**GOOD, "hosting": "elsewhere"}, comments={"hosting": "Our DR site is in the UK."})
    assert done.status_code == 200 and done.json()["status"] == "submitted"


def test_a_not_applicable_answer_needs_a_reason(db, http):
    qr, raw = _sent(db), _link(db)
    base = _base(raw, qr)
    for key in ("mfa", "dpa", "soc2"):
        http.post(f"{base}/evidence/{key}", files={"file": PDF})
    for answers in ({**GOOD, "hosting": "none_held"}, {**GOOD, "enc": "n-a"}):
        refused = _submit(http, base, answers)
        assert refused.json()["detail"] == "Before you submit: 1 not-applicable answer needs a reason.", answers
    assert _submit(http, base, {**GOOD, "enc": "n-a"}, comments={"enc": "We hold no data at rest."}).status_code == 200


def test_returned_answers_are_held_to_the_rules_only_where_they_can_change(db, http):
    qr, raw = _sent(db), _link(db)
    base = _base(raw, qr)
    for key in ("mfa", "dpa", "soc2"):
        http.post(f"{base}/evidence/{key}", files={"file": PDF})
    assert _submit(http, base, GOOD).status_code == 200
    # dpa's evidence is gone (say a reviewer took it off), and enc is sent back.
    db.query(TPRAEvidenceLink).filter(TPRAEvidenceLink.question_key == "dpa").update({"deleted_at": datetime.utcnow()})
    db.query(VendorQuestionnaireEvidence).filter_by(question_id="dpa").delete()
    qr = db.get(VendorQuestionnaireResponse, qr.id)
    qr.review, qr.status = {"enc": {"status": "clarify", "note": "Which keys?"}}, "returned"
    db.commit()
    # dpa owes evidence again but cannot change now, so only enc is held to the rules.
    assert _submit(http, base, {"enc": "n-a"}).json()["detail"] == (
        "Before you submit: 1 not-applicable answer needs a reason.")
    assert _submit(http, base, {"enc": "n-a"}, comments={"enc": "No data at rest."}).status_code == 200


def test_old_templates_with_evidence_required_owe_it_on_yes_or_partial_only(db, http):
    legacy = [{"id": "bcp", "text": "Do you test your continuity plan?", "type": "yes_no", "evidence_required": True},
              {"id": "sdlc", "text": "Describe your SDLC.", "type": "text", "evidence_required": True},
              {"id": "mfa", "text": "Is MFA enforced?", "type": "yes_no"}]
    qr, raw = _sent(db, questions=legacy), _link(db)
    base = _base(raw, qr)
    assert _submit(http, base, {"bcp": "partial", "sdlc": "Agile", "mfa": "yes"}).json()["detail"] == (
        "Before you submit: 1 question needs a document.")
    assert _submit(http, base, {"bcp": "no", "sdlc": "Agile", "mfa": "yes"}).status_code == 200
    # The same rule at the gate.
    qr = db.get(VendorQuestionnaireResponse, qr.id)
    qr.responses = {"bcp": "yes", "sdlc": "Agile", "mfa": "yes"}
    db.commit()
    assert service._questionnaire_gaps(db, db.get(VendorAssessment, 11)) == (3, 0, 1)


# ── at the stage-4 gate ──────────────────────────────────────────────────────

def test_the_gate_wants_evidence_on_the_question_and_skips_hidden_and_optional_ones(db):
    a, v = db.get(VendorAssessment, 11), db.get(Vendor, 1)
    qr = _sent(db, status="submitted", responses={**GOOD, "subs": None})      # subs optional and unanswered
    ev = Evidence(tenant_id=1, name="Policy", status="approved")
    db.add(ev)
    db.flush()
    db.add_all([TPRAEvidenceLink(tenant_id=1, vendor_id=1, assessment_id=11, evidence_id=ev.id),       # the assessment's
                TPRAEvidenceLink(tenant_id=1, vendor_id=1, assessment_id=11, evidence_id=ev.id,
                                 questionnaire_id=qr.id, question_key="enc")])                       # another question's
    db.commit()

    ctx = service.build_stage_context(db, v, a, "questionnaire")
    # subs_list is hidden, subs optional: neither is unanswered. soc2 owes its file.
    assert (ctx["responses_total"], ctx["responses_answered"], ctx["required_evidence_missing"]) == (6, 5, 2)
    gate = evaluate_stage_exit("questionnaire", ctx)
    assert "1 of 6 questions remain unanswered." in gate["blockers"]
    assert "2 required evidence item(s) missing." in gate["blockers"]
    for key in ("mfa", "dpa", "soc2"):
        db.add(TPRAEvidenceLink(tenant_id=1, vendor_id=1, assessment_id=11, evidence_id=ev.id,
                                questionnaire_id=qr.id, question_key=key))
    db.commit()
    ctx = service.build_stage_context(db, v, a, "questionnaire")
    assert (ctx["responses_answered"], ctx["required_evidence_missing"]) == (6, 0)


# ── reviewers per section ────────────────────────────────────────────────────

def _assign(http, qr, reviewer, section=None):
    made = http.post(f"/vendor-risk/questionnaire-responses/{qr.id}/reviewers",
                     json={"reviewer_id": reviewer, "section_key": section})
    assert made.status_code == 201, made.text
    return made.json()


def _decide(http, qr, key, decision="accept", note=None):
    r = http.post(f"/vendor-risk/questionnaire-responses/{qr.id}/review",
                  json={"question_key": key, "decision": decision, "note": note})
    assert r.status_code == 200, r.text


def _status(http, qr, a, status):
    return http.put(f"/vendor-risk/questionnaire-responses/{qr.id}/reviewers/{a['id']}", json={"status": status})


def test_sections_come_from_the_questions_and_each_is_assigned_and_emailed(db, http, me, told):
    qr = _sent(db, status="submitted", responses=GOOD)
    listed = http.get(f"/vendor-risk/questionnaire-responses/{qr.id}/reviewers").json()
    assert [(s["key"], s["label"], s["questions"]) for s in listed["sections"]] == [
        ("cybersecurity", "Cybersecurity", ["mfa", "enc"]), ("privacy", "Privacy", ["dpa", "hosting"]),
        ("assurance", "Assurance", ["soc2"]), ("fourth party", "Fourth party", ["subs"])]
    rita = _assign(http, qr, RITA, "cybersecurity")
    _assign(http, qr, SAM)                                                  # the whole questionnaire
    assert (rita["status"], rita["section_label"], rita["reviewer"]["name"]) == ("assigned", "Cybersecurity", "Rita Ray")
    assert [t["user_ids"] for t in told] == [[RITA], [SAM]]
    assert told[0]["subject"] == "Please review the Cybersecurity section for Payroll Co"
    assert told[0]["link"] == "/vendor-risk/assessments/11?tab=questionnaire" and "email" in told[0]["channels"]

    again = http.post(f"/vendor-risk/questionnaire-responses/{qr.id}/reviewers",
                      json={"reviewer_id": RITA, "section_key": "cybersecurity"})
    assert again.status_code == 409 and "already reviews the Cybersecurity section" in again.json()["detail"]
    assert http.post(f"/vendor-risk/questionnaire-responses/{qr.id}/reviewers",
                     json={"reviewer_id": RITA, "section_key": "nowhere"}).status_code == 404
    assert http.post(f"/vendor-risk/questionnaire-responses/{qr.id}/reviewers",
                     json={"reviewer_id": 999}).status_code == 400
    me["id"] = RITA
    _assign(http, qr, RITA, "privacy")                                      # assigning yourself tells nobody
    assert len(told) == 2
    rows = [(a["section_key"], a["reviewer"]["id"]) for a in
            http.get(f"/vendor-risk/questionnaire-responses/{qr.id}/reviewers").json()["assignments"]]
    assert rows == [(None, SAM), ("cybersecurity", RITA), ("privacy", RITA)]   # the whole first, then by section


def test_only_the_reviewer_the_lead_or_an_admin_moves_it_and_done_needs_every_decision(db, http, me):
    qr = _sent(db, status="submitted", responses=GOOD)
    rita = _assign(http, qr, RITA, "cybersecurity")
    for who in (ANALYST, SAM):
        me["id"] = who
        refused = _status(http, qr, rita, "in_review")
        assert refused.status_code == 403 and "TPRM lead" in refused.json()["detail"]
    me["id"] = RITA
    opened = _status(http, qr, rita, "in_review").json()
    assert opened["status"] == "in_review" and opened["started_at"] and opened["mine"] is True
    early = _status(http, qr, rita, "done")
    assert (early.status_code, early.json()["detail"]) == (
        409, "2 questions in the Cybersecurity section still need a decision")
    _decide(http, qr, "mfa")
    _decide(http, qr, "enc", "clarify", "Which keys?")
    assert _status(http, qr, rita, "done").json()["status"] == "done"
    for who in (LEAD, ADMIN):                                               # the lead and an admin may too
        me["id"] = who
        assert _status(http, qr, rita, "in_review").status_code == 200
        assert _status(http, qr, rita, "done").status_code == 200
    audit = [(r.from_value, r.to_value) for r in db.query(TPRAAuditLog).filter_by(entity="review_assignment",
                                                                                    action="status")]
    assert audit == [("assigned", "in_review"), ("in_review", "done"), ("done", "in_review"), ("in_review", "done"),
                     ("done", "in_review"), ("in_review", "done")]


def test_accepting_waits_for_every_reviewer_and_a_cleared_decision_reopens_done(db, http, me):
    qr = _sent(db, status="submitted", responses=GOOD)
    rita, sam = _assign(http, qr, RITA, "cybersecurity"), _assign(http, qr, SAM)
    for key in ("mfa", "enc"):
        _decide(http, qr, key)
    me["id"] = RITA
    _status(http, qr, rita, "done")
    me["id"] = ANALYST
    refused = http.post(f"/vendor-risk/questionnaire-responses/{qr.id}/accept")
    assert (refused.status_code, refused.json()["detail"]) == (
        409, "Not every reviewer is done: Sam Second (Whole questionnaire).")

    _decide(http, qr, "mfa", "clear")                                     # done no longer holds for Rita
    shown = {a["id"]: a for a in http.get(f"/vendor-risk/questionnaire-responses/{qr.id}/reviewers").json()["assignments"]}
    assert (shown[rita["id"]]["status"], shown[rita["id"]]["undecided"]) == ("in_review", 1)
    assert "Rita Ray (Cybersecurity)" in http.post(f"/vendor-risk/questionnaire-responses/{qr.id}/accept").json()["detail"]

    for key in ("mfa", "dpa", "hosting", "soc2", "subs"):
        _decide(http, qr, key)
    for a, who in ((rita, RITA), (sam, SAM)):
        me["id"] = who
        assert _status(http, qr, a, "done").json()["status"] == "done"
    me["id"] = ANALYST
    assert http.post(f"/vendor-risk/questionnaire-responses/{qr.id}/accept").json()["status"] == "accepted"
    assert http.delete(f"/vendor-risk/questionnaire-responses/{qr.id}/reviewers/{sam['id']}").json()["deleted"] is True
    assert db.query(TPRAAuditLog).filter_by(entity="review_assignment", action="unassign").count() == 1


def test_planning_counts_the_people_assigned_and_its_chip_agrees_with_the_gate(db, http):
    qr = _sent(db)
    a, v = db.get(VendorAssessment, 11), db.get(Vendor, 1)
    assert service.reviewers_assigned(db, a) == 0
    _assign(http, qr, RITA, "cybersecurity")
    _assign(http, qr, RITA, "privacy")                                      # one person, counted once
    _assign(http, qr, SAM)
    a.reviewed_by = SAM
    db.commit()
    assert service.reviewers_assigned(db, a) == 2
    chip = http.get("/vendor-risk/assessments/11/reviewers").json()
    assert chip == {"assigned": 2, "required": 2, "roles": ["security", "privacy"]}
    assert not any("reviewer" in b for b in service.evaluate_current(db, v, a, "dd_planning")["blockers"])
    # A questionnaire linked to the assessment later brings its reviewers with it.
    loose = _sent(db)
    loose.assessment_id = None
    db.commit()
    _assign(http, loose, LEAD)
    assert service.reviewers_assigned(db, a) == 2
    assert http.patch(f"/vendor-risk/questionnaire-responses/{loose.id}", json={"assessment_id": 11}).status_code == 200
    assert service.reviewers_assigned(db, a) == 3


def test_the_assignments_list_is_ordered_by_the_database(db, http):
    qr = _sent(db)
    seen = []

    def spy(conn, cursor, statement, *args):
        seen.append(statement)
    event.listen(db.get_bind(), "before_cursor_execute", spy)
    try:
        http.get(f"/vendor-risk/questionnaire-responses/{qr.id}/reviewers")
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", spy)
    listed = [s for s in seen if "FROM grc_tpra_review_assignments" in s]
    assert listed and all("ORDER BY" in s for s in listed)


# ── comments on answers ──────────────────────────────────────────────────────

def _comment(http, qr, key, body, visibility):
    sent = http.post("/vendor-risk/vendors/1/messages", json={"subject_type": "questionnaire", "subject_id": qr.id,
                                                              "question_key": key, "visibility": visibility, "body": body})
    assert sent.status_code == 201, sent.text
    return sent.json()


def test_a_shared_comment_reaches_the_supplier_on_its_question_and_an_internal_one_never(db, http, mail, told):
    qr, raw = _sent(db, status="submitted", responses=GOOD, submitted_at=datetime.utcnow()), _link(db)
    _assign(http, qr, RITA, "cybersecurity")
    _comment(http, qr, "mfa", "Looks thin: we will ask.", "internal")
    _comment(http, qr, "mfa", "Which admin tools does MFA not cover?", "shared")
    assert mail[-1][0] == "sam@payroll.test" and f"?q={qr.id}" in mail[-1][2]            # emailed, with a fresh link
    assert "Which admin tools" in mail[-1][2] and not any("Looks thin" in m[2] for m in mail)

    shown = http.get(_base(raw, qr)).json()                                 # sent already: there to read
    assert shown["status"] == "submitted"
    assert [m["body"] for m in shown["messages"]["mfa"]] == ["Which admin tools does MFA not cover?"]
    assert set(shown["messages"]) == {"mfa"} and "Looks thin" not in str(shown)
    assert set(shown["messages"]["mfa"][0]) == {"id", "from_supplier", "author", "body", "created_at"}
    home = http.get(f"/vendor-risk/portal/{raw}").json()
    assert home["questionnaires"][0]["unread"] == 1 and "Looks thin" not in str(home)

    told.clear()
    replied = http.post(f"{_base(raw, qr)}/messages", json={"question_key": "mfa", "body": "All but the old VPN."})
    assert replied.status_code == 201 and replied.json()["from_supplier"] is True
    m = db.query(TPRAMessage).order_by(TPRAMessage.id.desc()).first()
    assert (m.visibility, m.author_kind, m.question_key, m.author_contact_id) == ("shared", "contact", "mfa", 3)
    assert [t["user_ids"] for t in told] == [[RITA]]                        # the question's reviewer hears of it
    assert told[0]["subject"] == "Payroll Co replied on a question in 'Security'"
    assert http.post(f"{_base(raw, qr)}/messages", json={"question_key": "nope", "body": "x"}).status_code == 404
    shown = http.get(_base(raw, qr)).json()["messages"]["mfa"]
    assert [x["from_supplier"] for x in shown] == [False, True]


def test_a_supplier_cannot_reach_another_suppliers_questionnaire_thread(db, http):
    db.add(Vendor(id=2, tenant_id=1, name="Print Co", status="active"))
    db.commit()
    theirs = _sent(db, status="submitted")
    theirs.vendor_id = 2
    db.commit()
    raw = _link(db)
    assert http.get(_base(raw, theirs)).status_code == 404
    assert http.post(f"{_base(raw, theirs)}/messages", json={"question_key": "mfa", "body": "x"}).status_code == 404
    assert db.query(TPRAMessage).count() == 0
