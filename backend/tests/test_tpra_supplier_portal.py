"""The supplier portal: a personal link per contact, and a home with everything open for the supplier.

Each contact of a supplier can be sent a private link by email; only its sha256
is kept. It opens the supplier's home and, through it, the supplier's
questionnaires, with the same code as a questionnaire's own link, which still
works for one sent before. Every failure (unknown, expired, revoked, another
supplier's questionnaire) gets the same answer and counts against the address it
came from; a lost link is asked for again by email, with an answer that never
says whether the address is known. A questionnaire sent now has a sealed token
and reaches its contact, and every reminder, through a fresh personal link.
"""
import hashlib
import re
import secrets
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, Evidence, EvidenceQualityCheck, GRCUser, Role, Tenant, TPRAActionItem, TPRAApproval, TPRAAuditLog,
    TPRACheckin, TPRAContract, TPRAControlObligation, TPRAEmailTemplate, TPRAEvidenceLink, TPRAFinding,
    TPRAMonitoringSignal, TPRAPortalToken, TPRAQuestion, TPRAQuestionResponse, TPRAReminder, TPRARemediation,
    TPRARiskAcceptance, TPRARiskSnapshot, TPRASurfaceWaiver, TPRATemplateVersion, TPRATieringConfig,
    TPRAVendorContact, UserRole, Vendor, VendorAssessment, VendorQuestionnaireEvidence, VendorQuestionnaireResponse,
    VendorQuestionnaireTemplate, get_db,
)
from grc.models import TPRAMessage, TPRASupplierRequest, TPRASupplierRequestFile  # the home's requests and messages
from grc.modules.vendor_risk.routers import questionnaires as routes
from grc.modules.vendor_risk.tpra import contacts, portal, rbac, reminders, supplier_portal, versions
from grc.modules.vendor_risk.tpra import questionnaire_evidence as qevidence
from grc.modules.vendor_risk.tpra.bootstrap import DEFAULT_TIERING_CONFIG
from grc.routers.auth_router import require_auth

from grc.models import TPRAEngagement  # noqa: E402

_TABLES = [Tenant, GRCUser, Role, UserRole, Vendor, VendorAssessment, VendorQuestionnaireTemplate,
           VendorQuestionnaireResponse, VendorQuestionnaireEvidence, TPRATemplateVersion, TPRAQuestion,
           TPRAQuestionResponse, TPRAFinding, TPRATieringConfig, TPRAAuditLog, TPRAReminder, TPRARiskAcceptance,
           TPRARemediation, TPRAContract, TPRAControlObligation, TPRAEvidenceLink, Evidence, EvidenceQualityCheck,
           TPRAApproval, TPRARiskSnapshot, TPRAMonitoringSignal, TPRACheckin, TPRASurfaceWaiver, TPRAEmailTemplate,
           TPRAActionItem, TPRAVendorContact, TPRAPortalToken, TPRASupplierRequest, TPRASupplierRequestFile, TPRAMessage,
           TPRAEngagement]   # the reminder sweep reads each engagement's review date

QUESTIONS = [
    {"id": "subs", "text": "Do you use subprocessors?", "type": "yes_no", "required": True},
    {"id": "subs_list", "text": "List them.", "type": "text", "show_if": {"question": "subs", "in": ["yes"]}},
    {"id": "mfa", "text": "Is MFA enforced?", "type": "yes_no", "required": True},
]
GONE = supplier_portal.GONE


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme Bank", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="a@acme.test", display_name="Ana Lyst", is_active=True))
    s.add(Vendor(id=1, tenant_id=1, name="Payroll Co", status="active", owner_id=7,
                 primary_contact_name="Sam Lee", primary_contact_email="Sam@Payroll.test"))
    s.add(Vendor(id=2, tenant_id=1, name="Print Co", status="active", owner_id=7))
    s.add(VendorQuestionnaireTemplate(id=5, tenant_id=1, name="Security", questions=QUESTIONS))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def mail(monkeypatch):
    """Emails to suppliers, recorded instead of sent: (to, subject, text)."""
    box = []
    monkeypatch.setattr(contacts, "deliver", lambda db, tid, to, subject, text, html: box.append((to, subject, text)) or True)
    monkeypatch.setattr(contacts, "deliver_later", lambda slug, tid, to, subject, text, html: box.append((to, subject, text)))
    return box


@pytest.fixture()
def http(db, monkeypatch, mail, tmp_path):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    monkeypatch.setattr(portal, "throttle", portal.Throttle())
    monkeypatch.setattr(supplier_portal, "asks", portal.Throttle(limit=5, window=900.0))
    monkeypatch.setattr(routes, "EVIDENCE_UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(qevidence, "_review_later", lambda *a, **k: None)
    app = FastAPI()
    for r in (routes.router, contacts.router, supplier_portal.router):
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


def _contact(http, vendor_id=1, **fields) -> dict:
    added = http.post(f"/vendor-risk/vendors/{vendor_id}/contacts", json=fields)
    assert added.status_code == 201, added.text
    return added.json()


def _raw(link: str) -> str:
    return link.split("/supplier/", 1)[1].split("?")[0]


def _link(http, contact_id, vendor_id=1) -> str:
    issued = http.post(f"/vendor-risk/vendors/{vendor_id}/contacts/{contact_id}/portal-link", json={"send_email": False})
    assert issued.status_code == 200, issued.text
    return _raw(issued.json()["link"])


def _token_row(db, raw) -> TPRAPortalToken:
    return db.query(TPRAPortalToken).filter(TPRAPortalToken.token_hash == portal.hash_token(raw)).one()


def _questionnaire(db, vendor_id=1, **kw) -> VendorQuestionnaireResponse:
    qr = VendorQuestionnaireResponse(tenant_id=1, vendor_id=vendor_id, template_id=5,
                                     token=kw.pop("token", portal.sealed_token()), status=kw.pop("status", "pending"),
                                     **kw)
    db.add(qr)
    db.commit()
    return qr


# ── contacts ─────────────────────────────────────────────────────────────────

def test_the_supplier_record_stands_in_until_the_first_write_makes_it_a_row(db, http):
    with _statements(db) as seen:
        listed = http.get("/vendor-risk/vendors/1/contacts").json()["items"]
    assert _writes(seen) == []                                            # a GET writes nothing
    assert [(c["id"], c["source"], c["email"], c["is_primary"]) for c in listed] == [
        (None, "supplier record", "sam@payroll.test", True)]

    _contact(http, name="Ana Ops", email="Ana@Payroll.test", roles=["security", "primary"])
    with _statements(db) as seen:
        rows = http.get("/vendor-risk/vendors/1/contacts").json()["items"]
    assert [(c["name"], c["email"], c["is_primary"], c["roles"]) for c in rows] == [
        ("Sam Lee", "sam@payroll.test", True, ["primary"]), ("Ana Ops", "ana@payroll.test", False, ["security"])]
    assert any("FROM grc_tpra_vendor_contacts" in s and "ORDER BY grc_tpra_vendor_contacts.is_primary DESC" in s
               for s in seen)                                             # an edited list keeps its order
    assert http.post("/vendor-risk/vendors/1/contacts", json={"name": "Again", "email": "ana@payroll.test"}).status_code == 400
    assert http.post("/vendor-risk/vendors/1/contacts", json={"name": "Bad", "email": "not-an-address"}).status_code == 400


def test_making_a_contact_primary_moves_the_flag_and_the_supplier_record_follows(db, http):
    ana = _contact(http, name="Ana Ops", email="ana@payroll.test")
    moved = http.put(f"/vendor-risk/vendors/1/contacts/{ana['id']}", json={"is_primary": True, "phone": "+44 20 1"})
    assert moved.status_code == 200 and moved.json()["roles"] == ["primary"]
    rows = http.get("/vendor-risk/vendors/1/contacts").json()["items"]
    assert [c["name"] for c in rows if c["is_primary"]] == ["Ana Ops"]
    vendor = db.get(Vendor, 1)
    assert (vendor.primary_contact_name, vendor.primary_contact_email, vendor.primary_contact_phone) == (
        "Ana Ops", "ana@payroll.test", "+44 20 1")
    # A supplier with nobody on record: its first contact is its primary.
    pat = _contact(http, vendor_id=2, name="Pat Print", email="pat@print.test")
    assert pat["is_primary"] and db.get(Vendor, 2).primary_contact_email == "pat@print.test"


def test_a_contact_is_archived_not_deleted_and_its_links_stop_working(db, http):
    ana = _contact(http, name="Ana Ops", email="ana@payroll.test")
    raw = _link(http, ana["id"])
    assert http.get(f"/vendor-risk/portal/{raw}").status_code == 200

    assert http.post(f"/vendor-risk/vendors/1/contacts/{ana['id']}/archive").json()["archived_at"]
    assert db.get(TPRAVendorContact, ana["id"]) is not None                   # kept
    assert ana["id"] not in [c["id"] for c in http.get("/vendor-risk/vendors/1/contacts").json()["items"]]
    assert ana["id"] in [c["id"] for c in http.get("/vendor-risk/vendors/1/contacts",
                                                   params={"include_archived": True}).json()["items"]]
    gone = http.get(f"/vendor-risk/portal/{raw}")
    assert (gone.status_code, gone.json()["detail"]) == (410, GONE)
    assert _token_row(db, raw).revoked_at is not None
    assert http.delete(f"/vendor-risk/vendors/1/contacts/{ana['id']}").status_code == 405     # no delete
    assert http.post(f"/vendor-risk/vendors/1/contacts/{ana['id']}/portal-link", json={}).status_code == 400

    assert http.post(f"/vendor-risk/vendors/1/contacts/{ana['id']}/restore").json()["archived_at"] is None
    assert http.get(f"/vendor-risk/portal/{raw}").status_code == 410          # a restored contact gets a new link
    actions = [a.action for a in db.query(TPRAAuditLog).filter(TPRAAuditLog.entity == "contact")]
    assert actions == ["create", "archive", "restore"]


def test_a_changed_email_or_lost_portal_access_ends_the_contacts_links(db, http):
    ana = _contact(http, name="Ana Ops", email="ana@payroll.test")
    first, second = _link(http, ana["id"]), _link(http, ana["id"])
    http.put(f"/vendor-risk/vendors/1/contacts/{ana['id']}", json={"email": "ana.ops@payroll.test"})
    assert http.get(f"/vendor-risk/portal/{first}").status_code == 410
    third = _link(http, ana["id"])
    http.put(f"/vendor-risk/vendors/1/contacts/{ana['id']}", json={"portal_access": False})
    assert {http.get(f"/vendor-risk/portal/{t}").status_code for t in (second, third)} == {410}
    refused = http.post(f"/vendor-risk/vendors/1/contacts/{ana['id']}/portal-link", json={})
    assert refused.status_code == 400 and "portal access" in refused.json()["detail"]


# ── personal links ───────────────────────────────────────────────────────────

def test_a_personal_link_is_emailed_once_and_kept_only_as_its_hash(db, http, mail):
    ana = _contact(http, name="Ana Ops", email="ana@payroll.test")
    sent = http.post(f"/vendor-risk/vendors/1/contacts/{ana['id']}/portal-link", json={})
    assert sent.status_code == 200 and sent.json()["emailed"] is True
    raw = _raw(sent.json()["link"])
    row = db.get(TPRAPortalToken, sent.json()["id"])
    assert row.token_hash == hashlib.sha256(raw.encode()).hexdigest() and row.purpose == "invite"
    assert (row.expires_at - row.created_at).days == 30
    stored = "\n".join(str(tuple(r)) for m in _TABLES for r in db.execute(m.__table__.select()).fetchall())
    assert raw not in stored                                                   # nowhere in the database
    assert mail == [("ana@payroll.test", "Your supplier portal link for Payroll Co", mail[0][2])]
    assert sent.json()["link"] in mail[0][2] and "Hello Ana Ops" in mail[0][2]

    listed = http.get("/vendor-risk/vendors/1/portal-links").json()["items"]
    assert raw not in str(listed)
    assert (listed[0]["contact"]["name"], listed[0]["purpose"], listed[0]["active"], listed[0]["created_by"]) == (
        "Ana Ops", "invite", True, "Ana Lyst")

    no_mail = _contact(http, name="No Mail")
    assert http.post(f"/vendor-risk/vendors/1/contacts/{no_mail['id']}/portal-link", json={}).status_code == 400
    assert http.post(f"/vendor-risk/vendors/1/contacts/{ana['id']}/portal-link",
                     json={"expires_in_days": 91}).status_code == 422


def test_every_failure_gets_the_same_answer_and_another_suppliers_questionnaire_is_out_of_reach(db, http):
    ana = _contact(http, name="Ana Ops", email="ana@payroll.test")
    raw, expired, revoked = (_link(http, ana["id"]) for _ in range(3))
    _token_row(db, expired).expires_at = datetime.utcnow() - timedelta(minutes=1)
    db.commit()
    assert http.post(f"/vendor-risk/portal-links/{_token_row(db, revoked).id}/revoke").json()["active"] is False
    mine, theirs = _questionnaire(db), _questionnaire(db, vendor_id=2)

    for path, code in ((f"/vendor-risk/portal/{secrets.token_urlsafe(32)}", 404),
                       (f"/vendor-risk/portal/{expired}", 410),
                       (f"/vendor-risk/portal/{revoked}", 410),
                       (f"/vendor-risk/portal/{raw}/questionnaires/{theirs.id}", 404),
                       (f"/vendor-risk/portal/{raw}/questionnaires/999999", 404)):
        refused = http.get(path)
        assert (refused.status_code, refused.json()["detail"]) == (code, GONE), path
    assert http.post(f"/vendor-risk/portal/{raw}/questionnaires/{theirs.id}",
                     json={"responses": {"subs": "no"}, "submit": False}).status_code == 404
    assert db.get(VendorQuestionnaireResponse, theirs.id).responses in (None, {})
    assert http.get(f"/vendor-risk/portal/{raw}/questionnaires/{mine.id}").status_code == 200


def test_failed_lookups_from_one_address_are_throttled_for_old_and_new_links(db, http):
    ana = _contact(http, name="Ana Ops", email="ana@payroll.test")
    raw = _link(http, ana["id"])
    for _ in range(5):
        assert http.get(f"/vendor-risk/portal/{secrets.token_urlsafe(32)}").status_code == 404
        assert http.get(f"/vendor-risk/questionnaires/external/{uuid.uuid4()}").status_code == 404
    assert http.get(f"/vendor-risk/portal/{raw}").status_code == 429           # even a good link, from there
    assert http.get(f"/vendor-risk/questionnaires/external/{uuid.uuid4()}").status_code == 429
    elsewhere = TestClient(http.app, client=("203.0.113.9", 50000))
    assert elsewhere.get(f"/vendor-risk/portal/{raw}").status_code == 200
    # Behind a proxy that does not pass the client on, nobody is counted rather than everybody at once.
    assert portal.client_ip(SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"))) is None


# ── the home ─────────────────────────────────────────────────────────────────

def test_the_home_lists_what_is_waiting_and_a_get_writes_nothing(db, http):
    ana = _contact(http, name="Ana Ops", email="ana@payroll.test")
    raw = _link(http, ana["id"])
    now = datetime.utcnow()
    soon = _questionnaire(db, due_date=now + timedelta(days=3), template_version_id=versions.publish(
        db, db.get(VendorQuestionnaireTemplate, 5)).id)
    unpinned = _questionnaire(db, token=str(uuid.uuid4()), status="in_progress", responses={"subs": "no"},
                              due_date=now + timedelta(days=9))               # sent before versions and personal links
    returned = _questionnaire(db, status="returned", review={"mfa": {"status": "clarify", "note": "Which systems?"}},
                              due_date=now + timedelta(days=5), submitted_at=now - timedelta(days=4))
    answered = _questionnaire(db, status="submitted", submitted_at=now - timedelta(days=10))
    _questionnaire(db, status="accepted", submitted_at=now - timedelta(days=200))   # long ago: not shown
    _questionnaire(db, vendor_id=2)                                                # another supplier's
    _questionnaire(db, status="pending", expires_at=now - timedelta(days=120))      # closed long ago
    db.commit()
    unpinned_version = db.get(VendorQuestionnaireResponse, unpinned.id).template_version_id

    with _statements(db) as seen:
        home = http.get(f"/vendor-risk/portal/{raw}").json()
    assert _writes(seen) == []
    assert db.get(VendorQuestionnaireResponse, unpinned.id).template_version_id == unpinned_version is None
    assert (home["organisation"], home["supplier"], home["contact"]) == (
        {"name": "Acme Bank"}, {"name": "Payroll Co"}, {"name": "Ana Ops", "email": "ana@payroll.test"})
    assert home["requests"] == [] and home["messages"] == {"unread": 0, "latest": []} and home["expires_at"]
    items = home["questionnaires"]
    assert [i["id"] for i in items] == [soon.id, returned.id, unpinned.id, answered.id]   # waiting by due date first
    by_id = {i["id"]: i for i in items}
    assert by_id[unpinned.id]["progress"] == {"answered": 1, "total": 2} and by_id[unpinned.id]["title"] == "Security"
    assert by_id[returned.id]["returned_questions"] == 1 and by_id[soon.id]["open"] is True
    assert by_id[answered.id]["open"] is False and by_id[answered.id]["status"] == "submitted"
    row = _token_row(db, raw)
    assert (row.use_count, row.last_used_at) == (0, None)

    opened = http.post(f"/vendor-risk/portal/{raw}/open").json()
    assert [i["id"] for i in opened["questionnaires"]] == [i["id"] for i in items]
    row = _token_row(db, raw)
    assert row.use_count == 1 and row.last_used_at and db.get(TPRAVendorContact, ana["id"]).last_portal_at


def test_a_questionnaire_with_a_link_of_its_own_still_opens_there(db, http):
    own = _questionnaire(db, token=str(uuid.uuid4()), respondent_email="sam@payroll.test")
    path = f"/vendor-risk/questionnaires/external/{own.token}"
    assert http.get(path).status_code == 200
    done = http.post(path, json={"responses": {"subs": "no", "mfa": "yes"}, "submit": True,
                                 "attestation": {"name": "Sam Lee", "email": "sam@payroll.test", "confirm": True}})
    assert done.status_code == 200 and done.json()["status"] == "submitted"


# ── sending, answering, reminding ────────────────────────────────────────────

def test_a_questionnaire_sent_to_a_contact_is_answered_through_their_personal_link(db, http, mail):
    ana = _contact(http, name="Ana Ops", email="ana@payroll.test", job_title="CISO")
    sent = http.post("/vendor-risk/questionnaires/send", json={"vendor_id": 1, "template_id": 5, "contact_id": ana["id"]})
    assert sent.status_code == 201, sent.text
    body = sent.json()
    qr = db.get(VendorQuestionnaireResponse, body["questionnaire_response"]["id"])
    assert body["token"] is None and body["questionnaire_response"]["token"] is None and body["emailed"] is True
    assert qr.token.startswith("sealed:") and qr.contact_id == ana["id"] and body["contact"]["id"] == ana["id"]
    assert body["link"].endswith(f"?q={qr.id}") and _token_row(db, _raw(body["link"])).purpose == "questionnaire"
    assert mail[-1][0] == "ana@payroll.test" and body["link"] in mail[-1][2]
    assert http.get(f"/vendor-risk/questionnaires/external/{qr.token}").status_code == 404   # sealed: never a link

    base = f"/vendor-risk/portal/{_raw(body['link'])}/questionnaires/{qr.id}"
    shown = http.get(base).json()
    assert (shown["title"], shown["respondent_email"], shown["attestation"]["title"]) == ("Security", "ana@payroll.test", "CISO")
    up = http.post(f"{base}/evidence/mfa", files={"file": ("mfa.pdf", b"%PDF-1.4 mfa policy", "application/pdf")})
    assert up.status_code == 200, up.text
    assert list(http.get(f"{base}/evidence").json()) == ["mfa"]
    assert http.delete(f"{base}/evidence/{up.json()['id']}").status_code == 200
    assert http.get(f"{base}/workbook").content[:2] == b"PK" and http.get(f"{base}/pdf").content[:4] == b"%PDF"

    assert http.post(base, json={"responses": {"subs": "no"}, "submit": False}).json()["status"] == "in_progress"
    done = http.post(base, json={"responses": {"subs": "no", "mfa": "yes"}, "attestation": {"confirm": True}, "submit": True})
    assert done.status_code == 200 and done.json()["status"] == "submitted"
    qr = db.get(VendorQuestionnaireResponse, qr.id)
    assert (qr.attested_name, qr.attested_email, qr.attested_title) == ("Ana Ops", "ana@payroll.test", "CISO")
    assert http.get(base).status_code == 400                                   # submitted: no more changes


def test_a_send_with_nobody_named_goes_to_the_primary_and_a_new_name_becomes_a_contact(db, http, mail):
    to_primary = http.post("/vendor-risk/questionnaires/send", json={"vendor_id": 1, "template_id": 5}).json()
    assert to_primary["contact"]["email"] == "sam@payroll.test" and mail[-1][0] == "sam@payroll.test"
    named = http.post("/vendor-risk/questionnaires/send", json={
        "vendor_id": 1, "template_id": 5, "respondent_name": "Kim Sec", "respondent_email": "kim@payroll.test"}).json()
    kim = db.get(TPRAVendorContact, named["contact"]["id"])
    assert (kim.name, kim.is_primary) == ("Kim Sec", False)
    nobody = http.post("/vendor-risk/questionnaires/send", json={"vendor_id": 2, "template_id": 5})
    assert nobody.status_code == 201 and nobody.json()["link"] is None and nobody.json()["emailed"] is False


def test_each_reminder_carries_a_fresh_personal_link_and_an_old_one_keeps_its_own(db, http):
    ana = _contact(http, name="Ana Ops", email="ana@payroll.test")
    qr_id = http.post("/vendor-risk/questionnaires/send", json={"vendor_id": 1, "template_id": 5, "contact_id": ana["id"],
                                                                "due_in_days": 5}).json()["questionnaire_response"]["id"]
    _questionnaire(db, token=str(uuid.uuid4()), respondent_email="old@payroll.test",
                   due_date=datetime.utcnow() + timedelta(days=5), expires_at=datetime.utcnow() + timedelta(days=20))
    outbox = []
    policy = dict(DEFAULT_TIERING_CONFIG["reminder_policy"])
    for _ in range(2):                                                         # once per period, however often it runs
        reminders.run(db, 1, policy, deliver=lambda *a: None,
                      deliver_external=lambda db, tid, email, subject, message: outbox.append((email, message)))
    assert sorted(e for e, _ in outbox) == ["ana@payroll.test", "old@payroll.test"]
    message = dict(outbox)["ana@payroll.test"]
    raw, q = re.search(r"/supplier/([\w-]+)\?q=(\d+)", message).groups()
    assert int(q) == qr_id and _token_row(db, raw).purpose == "reminder"
    assert http.get(f"/vendor-risk/portal/{raw}").status_code == 200
    assert db.query(TPRAPortalToken).filter(TPRAPortalToken.purpose == "reminder").count() == 1
    assert "/supplier/" not in dict(outbox)["old@payroll.test"]                 # its own link, as before


# ── a new link by email, and revoking ────────────────────────────────────────

def test_a_new_link_is_asked_for_by_email_and_the_answer_never_tells(db, http, mail):
    _contact(http, name="Ana Ops", email="ana@payroll.test")
    known = http.post("/vendor-risk/portal/request-link", json={"email": "  ANA@payroll.test "})
    unknown = http.post("/vendor-risk/portal/request-link", json={"email": "nobody@nowhere.test"})
    assert (known.status_code, known.json()) == (unknown.status_code, unknown.json()) == (200, {"message": supplier_portal.SENT})
    assert [to for to, _, _ in mail] == ["ana@payroll.test"]
    raw = re.search(r"/supplier/([\w-]+)", mail[0][2]).group(1)
    assert _token_row(db, raw).purpose == "request" and http.get(f"/vendor-risk/portal/{raw}").status_code == 200

    # Per address: a few, then 429. Per email: a few, then the same answer and no email.
    for _ in range(3):
        http.post("/vendor-risk/portal/request-link", json={"email": "nobody@nowhere.test"})
    assert http.post("/vendor-risk/portal/request-link", json={"email": "ana@payroll.test"}).status_code == 429
    for n in range(6):
        other = TestClient(http.app, client=(f"198.51.100.{n}", 50000))
        assert other.post("/vendor-risk/portal/request-link", json={"email": "ana@payroll.test"}).json() == {
            "message": supplier_portal.SENT}
    assert len(mail) == 5


def test_revoke_all_stops_every_live_link_of_the_supplier(db, http):
    ana = _contact(http, name="Ana Ops", email="ana@payroll.test")
    kim = _contact(http, name="Kim Sec", email="kim@payroll.test")
    links = [_link(http, ana["id"]), _link(http, kim["id"])]
    assert http.post("/vendor-risk/vendors/1/portal-links/revoke-all").json() == {"revoked": 2}
    assert {http.get(f"/vendor-risk/portal/{raw}").status_code for raw in links} == {410}
    audit = db.query(TPRAAuditLog).filter(TPRAAuditLog.entity == "portal_link", TPRAAuditLog.action == "revoke_all").one()
    assert (audit.to_value, audit.reason) == ("2", "Revoked by hand")
    assert contacts.revoke_all(db, 1, 7) == 0                                  # nothing live is left


def test_the_audit_log_keeps_no_portal_token():
    from grc.audit_logger import PORTAL_TOKEN_IN_PATH

    mask = lambda path: PORTAL_TOKEN_IN_PATH.sub(r"\1***", path)
    assert mask("/grc/vendor-risk/portal/Ab-c_9/questionnaires/3/evidence") == "/grc/vendor-risk/portal/***/questionnaires/3/evidence"
    assert mask("/vendor-risk/portal/Ab-c_9") == "/vendor-risk/portal/***"
    assert mask("/vendor-risk/portal/request-link") == "/vendor-risk/portal/request-link"
