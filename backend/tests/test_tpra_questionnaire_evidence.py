"""Questionnaire evidence lives in the library once, and a certificate can answer questions.

A vendor's upload becomes an evidence-library record linked to the question it
answers, carrying the expiry the vendor gives, and is reviewed against that
question. A certificate answers the questions a template lets it — prefilled,
or not asked at all — but only when it is in date, names the vendor, and the AI
review (when it can run) does not find it fails to support the vendor.
"""
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, Evidence, EvidenceQualityCheck, GRCUser, Tenant, TPRAApproval, TPRAAuditLog, TPRAContract,
    TPRAControlObligation, TPRAEvidenceLink, TPRAFinding, TPRAQuestion, TPRAQuestionResponse, TPRARiskAcceptance,
    TPRARiskSnapshot, TPRATemplateVersion, TPRATieringConfig, Vendor, VendorAssessment, VendorQuestionnaireEvidence,
    VendorQuestionnaireResponse, VendorQuestionnaireTemplate, get_db,
)
from grc.modules.vendor_risk.routers import questionnaires as routes
from grc.modules.vendor_risk.tpra import attention, portal, rbac
from grc.modules.vendor_risk.tpra import questionnaire_evidence as qevidence
from grc.routers.auth_router import require_auth

_TABLES = [Tenant, GRCUser, Vendor, VendorAssessment, VendorQuestionnaireTemplate, VendorQuestionnaireResponse,
           VendorQuestionnaireEvidence, TPRATemplateVersion, TPRAQuestion, TPRAQuestionResponse, TPRAFinding,
           TPRATieringConfig, TPRAAuditLog, Evidence, EvidenceQualityCheck, TPRAEvidenceLink, TPRAContract,
           TPRAControlObligation, TPRAApproval, TPRARiskAcceptance, TPRARiskSnapshot]

QUESTIONS = [
    {"id": "isms", "text": "Do you run an information security programme?", "type": "yes_no",
     "certificate_covers": True},
    {"id": "enc", "text": "Is data encrypted at rest?", "type": "yes_no", "certificate_covers": True},
    {"id": "bcp", "text": "Do you test your continuity plan?", "type": "yes_no", "evidence_required": True},
]
SOC2_TEXT = "Independent Service Auditor's Report ... ACME CLOUD SERVICES, INC. ... SOC 2 Type II"
TODAY = datetime.utcnow().date()


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
def reviews(monkeypatch):
    """Reviews that would run in a background thread, recorded instead."""
    started = []
    monkeypatch.setattr(qevidence, "_review_later",
                        lambda evidence_id, tenant_id, db, target: started.append((evidence_id, target.ref)))
    # No model is configured under test: the AI review never blocks unless a test says so.
    monkeypatch.setattr(qevidence, "check_and_save", lambda *a, **k: None)
    return started


@pytest.fixture()
def http(db, monkeypatch, tmp_path, reviews):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    monkeypatch.setattr(routes, "_email_link", lambda *a, **k: None)
    monkeypatch.setattr(routes, "EVIDENCE_UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(portal, "throttle", portal.Throttle())
    app = FastAPI()
    app.include_router(routes.router, prefix="/vendor-risk")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def _vendor_and_template(db):
    template = VendorQuestionnaireTemplate(tenant_id=1, name="Security", questions=QUESTIONS)
    vendor = Vendor(tenant_id=1, name="Acme Cloud Services (demo)", status="active", owner_id=7)
    db.add_all([template, vendor])
    db.commit()
    return vendor, template


def _certificate(db, *, expires=TODAY + timedelta(days=200), text=SOC2_TEXT, name="Acme SOC 2 Type II 2026"):
    ev = Evidence(tenant_id=1, name=name, status="approved", ocr_content=text,
                  expiry_date=datetime(expires.year, expires.month, expires.day) if expires else None)
    db.add(ev)
    db.commit()
    return ev


def _send(http, vendor, template, **extra):
    return http.post("/vendor-risk/questionnaires/send",
                     json={"vendor_id": vendor.id, "template_id": template.id, **extra})


# ── naming the vendor ────────────────────────────────────────────────────────

@pytest.mark.parametrize("text,name,expected", [
    (SOC2_TEXT, "Acme Cloud Services (demo)", True),
    ("issued to Acme Cloud Services Ltd.", "ACME CLOUD SERVICES, INC.", True),
    ("issued to Acmex Cloud Services", "Acme Cloud Services", False),
    ("issued to Acme Cloud", "Acme Cloud Services", False),
])
def test_a_certificate_names_the_vendor_whatever_the_suffix(text, name, expected):
    assert qevidence.names_vendor(text, name) is expected


def test_a_certificate_must_be_in_date_read_and_about_this_vendor(db, reviews):
    vendor, _ = _vendor_and_template(db)
    problem = lambda ev: qevidence.certificate_problem(db, ev, vendor, today=TODAY)
    assert "not in the evidence library" in problem(None)
    assert "expires" in problem(_certificate(db, expires=None))
    assert "expired on" in problem(_certificate(db, expires=TODAY - timedelta(days=1)))
    assert "not been read" in problem(_certificate(db, text=""))
    assert "does not name" in problem(_certificate(db, text="issued to Globex Corporation"))
    assert problem(_certificate(db)) is None


def test_the_ai_review_can_refuse_a_certificate(db, monkeypatch, reviews):
    vendor, _ = _vendor_and_template(db)
    monkeypatch.setattr(qevidence, "check_and_save", lambda *a, **k: SimpleNamespace(
        status="ok", covers="none", verdict="This is a bridge letter, not a report."))
    assert "bridge letter" in qevidence.certificate_problem(db, _certificate(db), vendor, today=TODAY)


# ── the certificate answering questions ──────────────────────────────────────

def test_skip_answers_the_covered_questions_and_the_vendor_cannot_change_them(db, http):
    vendor, template = _vendor_and_template(db)
    cert = _certificate(db)
    sent = _send(http, vendor, template, certificate_evidence_id=cert.id, certificate_mode="skip")
    assert sent.status_code == 201, sent.text
    token, qr_id = sent.json()["token"], sent.json()["questionnaire_response"]["id"]

    shown = http.get(f"/vendor-risk/questionnaires/external/{token}").json()
    assert [q["id"] for q in shown["questions"] if q.get("locked")] == ["isms", "enc"]
    assert shown["certificate"]["mode"] == "skip"

    http.post(f"/vendor-risk/questionnaires/external/{token}",
              json={"responses": {"isms": "no", "bcp": "yes"}, "submit": False})
    qr = db.get(VendorQuestionnaireResponse, qr_id)
    assert qr.responses == {"isms": "yes", "enc": "yes", "bcp": "yes"}
    links = db.query(TPRAEvidenceLink).filter(TPRAEvidenceLink.questionnaire_id == qr_id).all()
    assert sorted(l.question_key for l in links) == ["enc", "isms"] and {l.evidence_id for l in links} == {cert.id}


def test_prefill_answers_them_but_the_vendor_can_change_them(db, http):
    vendor, template = _vendor_and_template(db)
    sent = _send(http, vendor, template, certificate_evidence_id=_certificate(db).id, certificate_mode="prefill")
    token, qr_id = sent.json()["token"], sent.json()["questionnaire_response"]["id"]
    assert not any(q.get("locked") for q in http.get(f"/vendor-risk/questionnaires/external/{token}").json()["questions"])
    http.post(f"/vendor-risk/questionnaires/external/{token}",
              json={"responses": {"isms": "partial", "enc": "yes"}, "submit": False})
    assert db.get(VendorQuestionnaireResponse, qr_id).responses == {"isms": "partial", "enc": "yes"}


def test_a_certificate_that_fails_its_checks_is_refused_at_sending(db, http):
    vendor, template = _vendor_and_template(db)
    expired = _certificate(db, expires=TODAY - timedelta(days=3))
    refused = _send(http, vendor, template, certificate_evidence_id=expired.id, certificate_mode="skip")
    assert refused.status_code == 400 and "expired" in refused.json()["detail"]
    assert db.query(VendorQuestionnaireResponse).count() == 0             # nothing was sent


# ── the vendor's uploads ─────────────────────────────────────────────────────

def test_an_upload_becomes_library_evidence_for_its_question(db, http, reviews):
    vendor, template = _vendor_and_template(db)
    sent = _send(http, vendor, template).json()
    token = sent["token"]
    up = http.post(f"/vendor-risk/questionnaires/external/{token}/evidence/bcp",
                   files={"file": ("bcp-test.pdf", b"%PDF-1.4 continuity test report", "application/pdf")},
                   data={"expires_on": (TODAY + timedelta(days=10)).isoformat()})
    assert up.status_code == 200, up.text

    library = db.query(Evidence).one()
    assert library.source_system == "vendor_portal" and library.expiry_date.date() == TODAY + timedelta(days=10)
    link = db.query(TPRAEvidenceLink).one()
    assert (link.question_key, link.vendor_id, link.questionnaire_id) == ("bcp", vendor.id, sent["questionnaire_response"]["id"])
    assert reviews == [(library.id, f"v{sent['questionnaire_response']['template_version_id']}:bcp")]

    # its expiry is now tracked where everything else's is
    items = [i for i in attention.open_items(db, 1, TODAY, {"remind_before_days": 14})
             if i["condition"] == "certificate_expiring"]
    assert len(items) == 1 and items[0]["badge"] == "Expires in 10 days"

    removed = http.delete(f"/vendor-risk/questionnaires/external/{token}/evidence/{up.json()['id']}")
    assert removed.status_code == 200
    assert db.get(Evidence, library.id).status == "archived" and db.get(TPRAEvidenceLink, link.id).deleted_at


def test_uploads_go_only_to_questions_that_can_change(db, http):
    vendor, template = _vendor_and_template(db)
    sent = _send(http, vendor, template).json()
    token, qr_id = sent["token"], sent["questionnaire_response"]["id"]
    pdf = lambda: {"file": ("x.pdf", b"%PDF-1.4 x", "application/pdf")}
    assert http.post(f"/vendor-risk/questionnaires/external/{token}/evidence/nope", files=pdf()).status_code == 404

    attest = {"name": "Sam", "email": "sam@vendor.test", "confirm": True}
    http.post(f"/vendor-risk/questionnaires/external/{token}",
              json={"responses": {"isms": "yes", "enc": "yes", "bcp": "no"}, "attestation": attest})
    http.post(f"/vendor-risk/questionnaire-responses/{qr_id}/review",
              json={"question_key": "bcp", "decision": "clarify", "note": "Send the last test report"})
    http.post(f"/vendor-risk/questionnaire-responses/{qr_id}/return")
    assert http.post(f"/vendor-risk/questionnaires/external/{token}/evidence/enc", files=pdf()).status_code == 409
    assert http.post(f"/vendor-risk/questionnaires/external/{token}/evidence/bcp", files=pdf()).status_code == 200


def test_an_analyst_attaches_library_evidence_once(db, http, reviews):
    vendor, template = _vendor_and_template(db)
    qr_id = _send(http, vendor, template).json()["questionnaire_response"]["id"]
    policy = Evidence(tenant_id=1, name="Business continuity policy", status="approved", ocr_content="BCP")
    db.add(policy)
    db.commit()
    db.add(EvidenceQualityCheck(tenant_id=1, evidence_id=policy.id, target_kind="tpra_question",
                                target_ref=f"v{db.get(VendorQuestionnaireResponse, qr_id).template_version_id}:bcp",
                                status="ok", covers="partial", score=55, verdict="A policy, not a test record."))
    db.commit()

    found = http.get(f"/vendor-risk/questionnaire-responses/{qr_id}/library", params={"search": "continuity"}).json()
    assert [f["id"] for f in found] == [policy.id]
    for _ in range(2):
        assert http.post(f"/vendor-risk/questionnaire-responses/{qr_id}/evidence",
                         json={"question_key": "bcp", "evidence_id": policy.id}).status_code == 200
    behind = http.get(f"/vendor-risk/questionnaire-responses/{qr_id}/evidence").json()
    assert len(behind["bcp"]) == 1 and behind["bcp"][0]["quality"]["covers"] == "partial"

    gone = http.delete(f"/vendor-risk/questionnaire-responses/{qr_id}/evidence/{behind['bcp'][0]['link_id']}")
    assert gone.status_code == 200
    assert http.get(f"/vendor-risk/questionnaire-responses/{qr_id}/evidence").json() == {}


def test_a_vendors_certificates_are_the_in_date_evidence_linked_to_it(db, http):
    vendor, _ = _vendor_and_template(db)
    current, lapsed = _certificate(db), _certificate(db, expires=TODAY - timedelta(days=1), name="Old")
    for ev in (current, lapsed):
        db.add(TPRAEvidenceLink(tenant_id=1, vendor_id=vendor.id, evidence_id=ev.id))
    db.commit()
    listed = http.get("/vendor-risk/questionnaires/certificates", params={"vendor_id": vendor.id}).json()
    assert [c["id"] for c in listed] == [current.id] and listed[0]["read"] is True
