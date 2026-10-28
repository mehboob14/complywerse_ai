"""Requests to suppliers outside a questionnaire, and messages with them, on both sides of the portal.

We ask a supplier for a document or for information, or share a finding with it;
it answers in the portal with files, a reply, or a plan and a date, and a reviewer
accepts the answer or returns it with a note. A file is in the evidence library at
once and becomes the supplier's paperwork only on acceptance. Another supplier's
request gets the same answer as a dead link. Internal messages never reach a public
payload. Answers and overdue requests join the attention queue, and the right
people are emailed each way.
"""
import json
import os
import re
from contextlib import contextmanager
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, Evidence, GRCUser, Tenant, TPRAAuditLog, TPRAEvidenceLink, TPRAFinding, TPRAMessage, TPRAPortalToken,
    TPRARemediation, TPRASupplierRequest, TPRASupplierRequestFile, TPRAVendorContact, Vendor, VendorAssessment, get_db,
)
from grc.modules.vendor_risk.routers import questionnaires as routes
from grc.modules.vendor_risk.tpra import (
    attention, contacts, paperwork, portal, rbac, supplier_portal, supplier_requests, tier_policy,
)
from grc.modules.workflow_engine.services import notification_service
from grc.routers.auth_router import require_auth
from grc.services import evidence_review

GONE = supplier_portal.GONE
PDF = ("soc2.pdf", b"%PDF-1.4 the report", "application/pdf")


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme Bank", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="a@acme.test", display_name="Ana Lyst", is_active=True))
    s.add(GRCUser(id=8, username="owner", email="o@acme.test", display_name="Otto Owner", is_active=True))
    s.add(Vendor(id=1, tenant_id=1, name="Payroll Co", status="active", owner_id=8, active_assessment_id=11))
    s.add(Vendor(id=2, tenant_id=1, name="Print Co", status="active", owner_id=8))
    s.add(VendorAssessment(id=11, tenant_id=1, vendor_id=1, version_no=1, lifecycle_status="active",
                           status="in_progress", current_stage="findings"))
    s.commit()
    yield s
    s.close()


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
def checks(monkeypatch):
    """The permissions each write asked for."""
    seen = []
    monkeypatch.setattr(rbac, "require_write", lambda db, user, resource, action="edit", **k: seen.append((resource, action)))
    return seen


@pytest.fixture()
def http(db, monkeypatch, mail, told, checks, tmp_path):
    monkeypatch.setattr(portal, "throttle", portal.Throttle())
    monkeypatch.setattr(routes, "EVIDENCE_UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(evidence_review, "rate_upload", lambda *a, **k: None)
    app = FastAPI()
    for r in (supplier_portal.router, supplier_requests.router):
        app.include_router(r, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


@contextmanager
def _statements(db):
    seen = []
    engine = db.get_bind()

    def spy(conn, cursor, statement, *args):
        seen.append(statement)
    event.listen(engine, "before_cursor_execute", spy)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", spy)


def _writes(statements):
    return [s for s in statements if s.lstrip().split(" ", 1)[0].upper() in ("INSERT", "UPDATE", "DELETE")]


def _contact(db, name, email, vendor_id=1, **kw) -> TPRAVendorContact:
    c = TPRAVendorContact(tenant_id=1, vendor_id=vendor_id, name=name, email=email, portal_access=kw.pop("portal_access", True),
                          is_primary=kw.pop("is_primary", False), roles=[], **kw)
    db.add(c)
    db.commit()
    return c


def _link(db, contact) -> str:
    raw, _ = contacts.issue(db, contact, "invite")
    db.commit()
    return raw


def _ask(http, vendor_id=1, **body) -> dict:
    made = http.post(f"/vendor-risk/vendors/{vendor_id}/supplier-requests", json=body)
    assert made.status_code == 201, made.text
    return made.json()


def _soon(days=14) -> str:
    return (datetime.utcnow().date() + timedelta(days=days)).isoformat()


def _queue(db, condition):
    return [i for i in attention.open_items(db, 1, datetime.utcnow().date(), {}) if i["condition"] == condition]


# ── a document, end to end ───────────────────────────────────────────────────

def test_a_document_is_asked_for_answered_in_the_portal_and_becomes_paperwork_on_acceptance(db, http, mail, told):
    ana = _contact(db, "Ana Ops", "ana@payroll.test", is_primary=True)
    _contact(db, "Kim Sec", "kim@payroll.test")
    asked = _ask(http, kind="document", evidence_kind="assurance_report", due_date=_soon(), contact_id=ana.id)
    label = tier_policy.EVIDENCE_KINDS["assurance_report"]
    assert (asked["title"], asked["status"], asked["assessment_id"], asked["contact"]["id"]) == (label, "open", 11, ana.id)
    assert [(s["email"], s["emailed"]) for s in asked["sent"]] == [("ana@payroll.test", True)]
    (to, subject, text), = mail
    assert to == "ana@payroll.test" and subject == f"Request for Payroll Co: {label}"
    raw, rid = re.search(r"/supplier/([\w-]+)/requests/(\d+)", text).groups()
    assert int(rid) == asked["id"]
    assert db.query(TPRAPortalToken).filter(TPRAPortalToken.token_hash == portal.hash_token(raw)).one().purpose == "supplier_request"

    home = http.get(f"/vendor-risk/portal/{raw}").json()
    assert [(i["id"], i["status"], i["open"], i["evidence_label"]) for i in home["requests"]] == [(asked["id"], "open", True, label)]
    base = f"/vendor-risk/portal/{raw}/requests/{asked['id']}"
    assert http.post(f"{base}/submit", json={}).json()["detail"] == "Attach the document first"

    sent = http.post(f"{base}/files", files={"file": PDF},
                     data={"coverage_from": "2026-01-01", "coverage_to": "2026-12-31", "expires_on": "2027-03-31"})
    assert sent.status_code == 200, sent.text
    assert sent.json()["coverage_to"] == "2026-12-31" and sent.json()["expiry_date"] == "2027-03-31"
    ev = db.query(Evidence).one()
    assert (ev.source_system, ev.status, ev.file_name, ev.expiry_date.date().isoformat()) == (
        "vendor_portal", "pending_review", "soc2.pdf", "2027-03-31")
    assert os.path.basename(ev.file_path) != "soc2.pdf" and open(ev.file_path, "rb").read() == PDF[1]
    # Not the supplier's paperwork until a reviewer accepts it.
    vendor, today = db.get(Vendor, 1), datetime.utcnow().date()
    assert db.query(TPRAEvidenceLink).count() == 0 and paperwork._documents(db, vendor, today)["items"] == []
    assert tier_policy.evidence_status(db, vendor, ["assurance_report"])[0]["satisfied"] is False

    done = http.post(f"{base}/submit", json={"response_text": "Our latest report."})
    assert done.status_code == 200 and done.json()["status"] == "submitted" and done.json()["open"] is False
    r = db.get(TPRASupplierRequest, asked["id"])
    assert (r.responded_by_contact_id, r.response_text) == (ana.id, "Our latest report.")
    assert [(t["user_ids"], t["subject"]) for t in told] == [([7, 8], f"Payroll Co answered the request '{label}'")]
    assert http.post(f"{base}/files", files={"file": PDF}).status_code == 409           # sent: nothing changes now
    item, = _queue(db, "supplier_responded")
    assert (item["record_id"], item["people"], item["link"]) == (
        asked["id"], [7], f"/vendor-risk/vendors/1?tab=portal&request={asked['id']}")

    accepted = http.post(f"/vendor-risk/vendors/1/supplier-requests/{asked['id']}/accept", json={"note": "Checked"})
    assert accepted.status_code == 200 and accepted.json()["status"] == "accepted"
    link = db.query(TPRAEvidenceLink).one()
    assert (link.vendor_id, link.evidence_id, link.requirement, link.reviewed_by, str(link.coverage_from), str(link.coverage_to)) == (
        1, ev.id, "assurance_report", 7, "2026-01-01", "2026-12-31")
    assert db.query(TPRASupplierRequestFile).one().link_id == link.id
    docs = paperwork._documents(db, vendor, today)["items"]
    assert [(d["evidence_id"], d["from_supplier"], d["coverage_to"]) for d in docs] == [(ev.id, True, "2026-12-31")]
    assert tier_policy.evidence_status(db, vendor, ["assurance_report"])[0]["satisfied"] is True
    assert _queue(db, "supplier_responded") == []
    assert http.post(f"/vendor-risk/vendors/1/supplier-requests/{asked['id']}/accept").status_code == 409
    assert [a.action for a in db.query(TPRAAuditLog).filter(TPRAAuditLog.entity == "supplier_request")] == [
        "create", "submit", "accept"]
    assert http.get(base).json()["review_note"] is None                                  # our note stays ours


def test_a_returned_answer_goes_back_with_its_note_and_comes_round_again(db, http, mail, told):
    ana = _contact(db, "Ana Ops", "ana@payroll.test", is_primary=True)
    raw = _link(db, ana)
    asked = _ask(http, kind="information", title="Where is our data hosted?")
    base = f"/vendor-risk/portal/{raw}/requests/{asked['id']}"
    assert http.post(f"{base}/submit", json={"response_text": "  "}).status_code == 400
    assert http.post(f"{base}/submit", json={"response_text": "In Frankfurt."}).status_code == 200
    path = f"/vendor-risk/vendors/1/supplier-requests/{asked['id']}"
    assert http.post(f"{path}/return", json={"note": "  "}).status_code == 400
    mail.clear()
    back = http.post(f"{path}/return", json={"note": "Name the data centres, please."})
    assert back.status_code == 200 and back.json()["status"] == "returned"

    shown = http.get(base).json()
    assert (shown["status"], shown["open"], shown["review_note"]) == ("returned", True, "Name the data centres, please.")
    assert [(m["from_supplier"], m["author"], m["body"]) for m in shown["messages"]] == [
        (False, "Ana Lyst", "Name the data centres, please.")]
    (to, subject, text), = mail
    assert to == "ana@payroll.test" and "Name the data centres, please." in text and f"/requests/{asked['id']}" in text

    told.clear()
    reply = http.post(f"/vendor-risk/portal/{raw}/messages",
                      json={"subject_type": "request", "subject_id": asked["id"], "body": "Two, both in Frankfurt."})
    assert reply.status_code == 201 and reply.json()["from_supplier"] is True
    assert [(t["user_ids"], t["subject"]) for t in told] == [
        ([7, 8], "Payroll Co sent a message about the request 'Where is our data hosted?'")]
    again = http.post(f"{base}/submit", json={"response_text": "Equinix FR2 and FR5."})
    assert again.json()["status"] == "submitted" and db.get(TPRASupplierRequest, asked["id"]).response_text == "Equinix FR2 and FR5."


def test_another_suppliers_request_is_out_of_reach_and_gets_the_same_answer(db, http):
    ana = _contact(db, "Ana Ops", "ana@payroll.test", is_primary=True)
    _contact(db, "Pat Print", "pat@print.test", vendor_id=2, is_primary=True)
    raw = _link(db, ana)
    theirs = _ask(http, vendor_id=2, kind="information", title="Your insurance details")
    base = f"/vendor-risk/portal/{raw}/requests/{theirs['id']}"
    for refused in (http.get(base), http.post(f"{base}/files", files={"file": PDF}),
                    http.post(f"{base}/submit", json={"response_text": "x"}), http.delete(f"{base}/files/1"),
                    http.get(f"/vendor-risk/portal/{raw}/messages", params={"subject_type": "request", "subject_id": theirs["id"]}),
                    http.post(f"/vendor-risk/portal/{raw}/messages",
                              json={"subject_type": "request", "subject_id": theirs["id"], "body": "hello"}),
                    http.get(f"/vendor-risk/portal/{raw}/requests/999999")):
        assert (refused.status_code, refused.json()["detail"]) == (404, GONE)
    r = db.get(TPRASupplierRequest, theirs["id"])
    assert (r.status, r.response_text) == ("open", None)
    assert db.query(TPRASupplierRequestFile).count() == 0 and db.query(TPRAMessage).count() == 0
    assert http.get(f"/vendor-risk/portal/{raw}").json()["requests"] == []
    # Nor can a request be addressed to another supplier's contact.
    pat = db.query(TPRAVendorContact).filter_by(vendor_id=2).one()
    wrong = http.post("/vendor-risk/vendors/1/supplier-requests", json={"kind": "information", "title": "x", "contact_id": pat.id})
    assert wrong.status_code == 400


# ── messages ─────────────────────────────────────────────────────────────────

def test_internal_messages_never_reach_a_public_payload(db, http, mail):
    ana = _contact(db, "Ana Ops", "ana@payroll.test", is_primary=True)
    raw = _link(db, ana)
    asked = _ask(http, kind="information", title="Your sub-processors")
    mail.clear()
    for subject_type, subject_id, visibility, body in (
            ("vendor", None, "internal", "SECRET-1 their CISO left"), ("vendor", None, "shared", "Hello from Acme"),
            ("request", asked["id"], "internal", "SECRET-2 chase them"), ("request", asked["id"], "shared", "Any news?")):
        made = http.post("/vendor-risk/vendors/1/messages", json={
            "subject_type": subject_type, "subject_id": subject_id, "visibility": visibility, "body": body})
        assert made.status_code == 201 and made.json()["visibility"] == visibility
    assert len(mail) == 2 and all(to == "ana@payroll.test" for to, _, _ in mail)       # only the shared ones went
    ours = http.get("/vendor-risk/vendors/1/messages").json()["items"]
    assert [(m["visibility"], m["body"]) for m in ours] == [("internal", "SECRET-1 their CISO left"), ("shared", "Hello from Acme")]

    public = [http.get(f"/vendor-risk/portal/{raw}").json(),
              http.get(f"/vendor-risk/portal/{raw}/requests/{asked['id']}").json(),
              http.get(f"/vendor-risk/portal/{raw}/messages").json(),
              http.get(f"/vendor-risk/portal/{raw}/messages", params={"subject_type": "request", "subject_id": asked["id"]}).json()]
    seen = json.dumps(public)
    assert "SECRET" not in seen and "Hello from Acme" in seen and "Any news?" in seen
    assert "visibility" not in seen and "author_kind" not in seen
    assert [m["body"] for m in public[2]["items"]] == ["Hello from Acme"]
    # A contact's message is always shared, and our people hear of it.
    http.post(f"/vendor-risk/portal/{raw}/messages", json={"body": "Thanks!"})
    assert db.query(TPRAMessage).filter_by(body="Thanks!").one().visibility == "shared"
    assert http.post(f"/vendor-risk/portal/{raw}/messages", json={"body": "   "}).status_code == 400


def test_the_home_counts_our_new_messages_and_a_get_writes_nothing(db, http):
    ana = _contact(db, "Ana Ops", "ana@payroll.test", is_primary=True)
    raw = _link(db, ana)
    asked = _ask(http, kind="information", title="Your sub-processors")
    http.post("/vendor-risk/vendors/1/messages", json={"visibility": "shared", "body": "Welcome"})
    http.post("/vendor-risk/vendors/1/messages", json={"subject_type": "request", "subject_id": asked["id"],
                                                       "visibility": "shared", "body": "Any news?"})
    http.post("/vendor-risk/vendors/1/messages", json={"visibility": "internal", "body": "Not for them"})
    opened = http.post(f"/vendor-risk/portal/{raw}/open").json()
    assert opened["messages"]["unread"] == 1 and opened["requests"][0]["unread"] == 1
    assert [m["body"] for m in opened["messages"]["latest"]] == ["Welcome"]
    with _statements(db) as seen:
        home = http.get(f"/vendor-risk/portal/{raw}").json()
        http.get(f"/vendor-risk/portal/{raw}/requests/{asked['id']}")
        http.get(f"/vendor-risk/portal/{raw}/messages")
    assert _writes(seen) == []
    assert home["messages"]["unread"] == 0 and home["requests"][0]["unread"] == 0    # read since the visit began
    assert any("FROM grc_tpra_messages" in s and "ORDER BY grc_tpra_messages.created_at DESC" in s for s in seen)
    visit = db.get(TPRAVendorContact, ana.id).last_portal_at
    http.post("/vendor-risk/vendors/1/messages", json={"visibility": "shared", "body": "One more thing"})
    db.query(TPRAMessage).filter_by(body="One more thing").one().created_at = visit + timedelta(seconds=1)
    db.commit()
    assert http.get(f"/vendor-risk/portal/{raw}").json()["messages"]["unread"] == 1


# ── findings shared with the supplier ────────────────────────────────────────

def _finding(db, **kw) -> TPRAFinding:
    f = TPRAFinding(**{"tenant_id": 1, "vendor_id": 1, "assessment_id": 11, "severity": "critical",
                       "is_critical_control_fail": True, "title": "MFA is not enforced for administrators",
                       "status": "open", "created_by": 7,
                       "description": "INTERNAL: answered no to question 12, weight 3.0, scored 0.", **kw})
    db.add(f)
    db.commit()
    return f


def test_a_shared_finding_asks_for_a_plan_once_and_the_supplier_sees_only_what_we_wrote(db, http, checks):
    ana = _contact(db, "Ana Ops", "ana@payroll.test", is_primary=True)
    raw = _link(db, ana)
    f = _finding(db)
    shared = http.post(f"/vendor-risk/tpra/findings/{f.id}/share",
                       json={"note": "Please enforce MFA for every admin account.", "due_date": _soon(30)})
    assert shared.status_code == 201, shared.text
    body = shared.json()
    assert (body["kind"], body["title"], body["detail"], body["finding"]["id"], body["assessment_id"]) == (
        "finding", "MFA is not enforced for administrators", "Please enforce MFA for every admin account.", f.id, 11)
    assert ("findings", "edit") in checks
    again = http.post(f"/vendor-risk/tpra/findings/{f.id}/share", json={"due_date": _soon(30)})
    assert again.status_code == 409                                                     # one request per finding
    assert db.query(TPRASupplierRequest).count() == 1

    seen = json.dumps([http.get(f"/vendor-risk/portal/{raw}").json(),
                       http.get(f"/vendor-risk/portal/{raw}/requests/{body['id']}").json()])
    assert "INTERNAL" not in seen and "critical" not in seen and "weight" not in seen and "severity" not in seen
    base = f"/vendor-risk/portal/{raw}/requests/{body['id']}"
    assert http.post(f"{base}/submit", json={"plan_text": "Roll out MFA"}).status_code == 400       # and by when?
    target = _soon(45)
    assert http.post(f"{base}/submit", json={"plan_text": "Roll out MFA to all admins", "target_date": target}).status_code == 200

    accepted = http.post(f"/vendor-risk/vendors/1/supplier-requests/{body['id']}/accept", json={"finding": "plan"})
    assert accepted.status_code == 200, accepted.text
    rem = db.query(TPRARemediation).one()
    assert (rem.finding_id, rem.plan, rem.due_date.date().isoformat(), rem.status) == (
        f.id, "Roll out MFA to all admins", target, "open")
    assert db.get(TPRAFinding, f.id).status == "in_remediation"
    # Now it is answered, the finding can be shared again; a closed one cannot.
    assert http.post(f"/vendor-risk/tpra/findings/{f.id}/share", json={"due_date": _soon()}).status_code == 201
    shut = _finding(db, title="Old")
    shut.status = "closed"
    db.commit()
    assert http.post(f"/vendor-risk/tpra/findings/{shut.id}/share", json={"due_date": _soon()}).status_code == 409


def test_a_verified_fix_closes_the_finding_through_its_own_path(db, http, checks):
    ana = _contact(db, "Ana Ops", "ana@payroll.test", is_primary=True)
    raw = _link(db, ana)
    f = _finding(db)
    rid = http.post(f"/vendor-risk/tpra/findings/{f.id}/share", json={"note": "Enforce MFA.", "due_date": _soon()}).json()["id"]
    base = f"/vendor-risk/portal/{raw}/requests/{rid}"
    http.post(f"{base}/files", files={"file": ("mfa.png", b"\x89PNG screenshot", "image/png")})
    http.post(f"{base}/submit", json={"plan_text": "Done: MFA is on.", "target_date": datetime.utcnow().date().isoformat()})
    checks.clear()
    closed = http.post(f"/vendor-risk/vendors/1/supplier-requests/{rid}/accept", json={"finding": "close"})
    assert closed.status_code == 200, closed.text
    assert ("findings", "edit") in checks
    assert db.get(TPRAFinding, f.id).status == "closed"
    rem = db.query(TPRARemediation).one()
    assert rem.status == "completed" and rem.completed_at is not None
    link = db.query(TPRAEvidenceLink).one()
    assert (link.finding_id, link.requirement) == (f.id, None)                          # the fix's evidence, on the finding
    # Nothing left to settle: a finding action on an information request is refused.
    other = _ask(http, kind="information", title="x")
    http.post(f"/vendor-risk/portal/{raw}/requests/{other['id']}/submit", json={"response_text": "y"})
    refused = http.post(f"/vendor-risk/vendors/1/supplier-requests/{other['id']}/accept", json={"finding": "close"})
    assert refused.status_code == 409 and db.get(TPRASupplierRequest, other["id"]).status == "submitted"


# ── attention, emails, the list ──────────────────────────────────────────────

def test_overdue_requests_and_answers_join_the_attention_queue(db, http):
    ana = _contact(db, "Ana Ops", "ana@payroll.test", is_primary=True)
    raw = _link(db, ana)
    late = _ask(http, kind="information", title="Your insurance", due_date=_soon(3))
    gone = _ask(http, kind="information", title="Withdrawn", due_date=_soon(3))
    for rid in (late["id"], gone["id"]):
        db.get(TPRASupplierRequest, rid).due_date = datetime.utcnow().date() - timedelta(days=4)
    db.commit()
    http.post(f"/vendor-risk/vendors/1/supplier-requests/{gone['id']}/cancel", json={"reason": "Not needed"})
    item, = _queue(db, "supplier_request_overdue")
    assert (item["record_type"], item["record_id"], item["tone"], item["badge"], item["people"]) == (
        "supplier_request", late["id"], "red", "4 days overdue", [7])
    assert http.get(f"/vendor-risk/portal/{raw}").json()["requests"][0]["overdue"] is True
    http.post(f"/vendor-risk/portal/{raw}/requests/{late['id']}/submit", json={"response_text": "Attached"})
    assert _queue(db, "supplier_request_overdue") == [] and len(_queue(db, "supplier_responded")) == 1
    assert attention.queue(db, 1, 7, scope="mine")["by_condition"]["supplier_responded"] == 1


def test_a_request_goes_to_its_contact_or_else_to_every_contact_with_portal_access(db, http, mail):
    ana = _contact(db, "Ana Ops", "ana@payroll.test", is_primary=True)
    _contact(db, "Kim Sec", "kim@payroll.test")
    _contact(db, "No Portal", "np@payroll.test", portal_access=False)
    _contact(db, "Gone Away", "old@payroll.test", archived_at=datetime.utcnow())
    _ask(http, kind="information", title="Your org chart")
    assert sorted(to for to, _, _ in mail) == ["ana@payroll.test", "kim@payroll.test"]
    mail.clear()
    _ask(http, kind="information", title="Just Ana", contact_id=ana.id)
    assert [to for to, _, _ in mail] == ["ana@payroll.test"]
    mail.clear()
    http.post("/vendor-risk/vendors/1/messages", json={"visibility": "shared", "body": "Hello all"})
    assert sorted(to for to, _, _ in mail) == ["ana@payroll.test", "kim@payroll.test"]
    assert all("Hello all" in text for _, _, text in mail)
    # A supplier with only the contact on its record: it becomes a contact and is written to.
    db.get(Vendor, 2).primary_contact_name, db.get(Vendor, 2).primary_contact_email = "Pat Print", "pat@print.test"
    db.commit()
    mail.clear()
    sent = _ask(http, vendor_id=2, kind="information", title="Your address")["sent"]
    assert [s["email"] for s in sent] == ["pat@print.test"] and [to for to, _, _ in mail] == ["pat@print.test"]
    assert http.post("/vendor-risk/vendors/1/supplier-requests",
                     json={"kind": "information", "title": "x", "due_date": "2020-01-01"}).status_code == 400
    assert http.post("/vendor-risk/vendors/1/supplier-requests", json={"kind": "document"}).status_code == 400
    assert http.post("/vendor-risk/vendors/1/supplier-requests",
                     json={"kind": "document", "evidence_kind": "nonsense"}).status_code == 400


def test_the_list_puts_answers_to_review_first_and_requests_change_only_while_waiting(db, http):
    ana = _contact(db, "Ana Ops", "ana@payroll.test", is_primary=True)
    raw = _link(db, ana)
    first = _ask(http, kind="information", title="First")
    second = _ask(http, kind="information", title="Second")
    http.post(f"/vendor-risk/portal/{raw}/requests/{first['id']}/submit", json={"response_text": "Here"})
    with _statements(db) as seen:
        listed = http.get("/vendor-risk/vendors/1/supplier-requests").json()
    assert [i["title"] for i in listed["items"]] == ["First", "Second"]                     # answered first
    assert any("FROM grc_tpra_supplier_requests" in s and "ORDER BY grc_tpra_supplier_requests.requested_at DESC" in s
               for s in seen)
    assert {k["key"] for k in listed["evidence_kinds"]} >= {"assurance_report", "pen_test"}
    path = "/vendor-risk/vendors/1/supplier-requests"
    changed = http.put(f"{path}/{second['id']}", json={"title": "Second, reworded", "due_date": _soon(7)})
    assert changed.status_code == 200 and changed.json()["title"] == "Second, reworded"
    assert http.put(f"{path}/{first['id']}", json={"title": "Too late"}).status_code == 409
    assert http.post(f"{path}/{second['id']}/cancel").json()["status"] == "cancelled"
    assert http.post(f"{path}/{second['id']}/cancel").status_code == 409
    shown = http.get(f"/vendor-risk/portal/{raw}/requests/{second['id']}").json()
    assert (shown["status"], shown["open"]) == ("cancelled", False)
    assert http.post(f"/vendor-risk/portal/{raw}/requests/{second['id']}/submit", json={"response_text": "x"}).status_code == 409


# ── the upload ───────────────────────────────────────────────────────────────

def test_uploads_are_hardened_like_a_questionnaires_and_can_be_taken_back_before_sending(db, http, monkeypatch):
    ana = _contact(db, "Ana Ops", "ana@payroll.test", is_primary=True)
    raw = _link(db, ana)
    asked = _ask(http, kind="document", evidence_kind="pen_test")
    base = f"/vendor-risk/portal/{raw}/requests/{asked['id']}/files"
    assert http.post(base, files={"file": ("run.exe", b"MZ", "application/octet-stream")}).status_code == 415
    assert http.post(base, files={"file": ("empty.pdf", b"", "application/pdf")}).status_code == 400
    assert http.post(base, files={"file": PDF}, data={"coverage_from": "2026-06-01", "coverage_to": "2026-01-01"}).status_code == 400
    monkeypatch.setattr(routes, "_MAX_EVIDENCE_BYTES", 8)
    assert http.post(base, files={"file": PDF}).status_code == 413
    monkeypatch.setattr(routes, "_MAX_EVIDENCE_BYTES", 25 * 1024 * 1024)
    monkeypatch.setattr(supplier_requests, "MAX_FILES", 1)
    kept = http.post(base, files={"file": PDF}).json()
    assert http.post(base, files={"file": PDF}).status_code == 429
    ev = db.query(Evidence).one()
    assert http.delete(f"{base}/{kept['id'] + 99}").status_code == 404
    assert http.delete(f"{base}/{kept['id']}").json() == {"deleted": True, "id": kept["id"]}
    assert db.query(TPRASupplierRequestFile).count() == 0
    assert db.get(Evidence, ev.id).status == "archived" and not os.path.exists(ev.file_path)
