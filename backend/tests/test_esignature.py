"""Electronic signatures: drawn on screen, kept with the record, sealed, and shown to an auditor.

A formal sign-off was a typed name and an acknowledgement a tick. Now a person draws a signature; the image, its
SHA-256 and a keyed seal over who/what/when are kept in an append-only record tied to the sign-off or attestation, and
the audit trail names the fingerprints.
"""
import asyncio
import base64
import os
from datetime import datetime, timedelta
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from PIL import Image, ImageDraw
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc import audit_logger, rich_audit
from grc.modules.governance.routers import attestation_campaigns as campaigns
from grc.modules.governance.routers import attestations as older
from grc.modules.governance.routers import document_attestations as external
from grc.modules.governance.routers import document_signoff as signoff
from grc.modules.governance.routers import esignatures
from grc.schemas import AttestationCompleteRequest
from grc.services import esign


@pytest.fixture(autouse=True)
def _secret(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "unit-test-secret")
    monkeypatch.delenv("SESSION_SECRET_OLD", raising=False)


def _png(ink=True, size=(300, 120)):
    im = Image.new("RGB", size, "white")
    if ink:
        ImageDraw.Draw(im).line([(10, 100), (80, 20), (150, 90), (280, 30)], fill="#0f172a", width=3)
    out = BytesIO()
    im.save(out, "PNG")
    return "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()


def _request():
    return SimpleNamespace(client=SimpleNamespace(host="10.1.2.3"), headers={"user-agent": "UnitTest/1.0"})


_TABLE = "| Role | Name | Designation | Signature / Date |\n| --- | --- | --- | --- |\n| Approved by | ______ | ______ | ______ |"


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)   # the HTTP test runs it on another thread
    m.Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
        session.add(m.GRCUser(id=3, username="sara", email="sara@bank.example", display_name="Sara Khan", designation="CISO"))
        session.add(m.GovernanceDocument(id=5, tenant_id=1, title="Access policy", doc_type="policy", status="pending_approval",
                                         content=f"# Access policy\n\n{_TABLE}", current_version="1.2"))
        session.add(m.DocumentSignoffAssignment(tenant_id=1, document_id=5, role_type="approver", target_type="user", target_id=3, added_by=3))
        session.commit()
        yield session


def _user(db):
    return db.get(m.GRCUser, 3)


def _record(db, **kw):
    base = dict(tenant_id=1, record_type="document_signoff", record_id=1, signature_image=_png(), meaning="Approved by: Access policy",
                signer_name="Sara Khan", content_sha256=esign.fingerprint(text="policy text"), request=_request())
    return esign.record(db, **{**base, **kw})


# -- the image ---------------------------------------------------------------

def test_only_a_real_png_with_ink_on_it_is_accepted():
    assert esign.image_from_data_url(_png()).startswith(b"\x89PNG")
    big = Image.frombytes("RGB", (700, 700), os.urandom(700 * 700 * 3))      # noise does not compress
    out = BytesIO()
    big.save(out, "PNG")
    for bad in (None, "", "hello", "data:image/png;base64,!!!", "data:image/jpeg;base64,AAAA", _png(ink=False),
                "data:image/png;base64," + base64.b64encode(out.getvalue()).decode()):
        with pytest.raises(HTTPException) as err:
            esign.image_from_data_url(bad)
        assert err.value.status_code == 400


def test_a_transparent_png_with_no_ink_is_not_a_signature():
    out = BytesIO()
    Image.new("RGBA", (300, 120), (0, 0, 0, 0)).save(out, "PNG")
    with pytest.raises(HTTPException):
        esign.image_from_data_url("data:image/png;base64," + base64.b64encode(out.getvalue()).decode())


# -- the seal ------------------------------------------------------------------

def test_a_signature_is_kept_with_its_fingerprints_and_verifies(db):
    sig = _record(db)
    db.commit()
    assert len(sig.image_sha256) == 64 and len(sig.seal) == 64 and sig.ip_address == "10.1.2.3"
    assert esign.verify(sig) == {"valid": True, "image_ok": True, "seal_ok": True, "document_changed_since": None}


def test_changing_the_row_or_the_image_breaks_the_seal(db):
    sig = _record(db)
    sig.signer_name = "Someone Else"
    assert esign.verify(sig)["seal_ok"] is False and esign.verify(sig)["valid"] is False
    sig.signer_name = "Sara Khan"
    assert esign.verify(sig)["valid"] is True
    sig.image_png = sig.image_png + b"0"
    assert esign.verify(sig)["image_ok"] is False


def test_rotating_the_secret_does_not_unseal_old_signatures(db, monkeypatch):
    sig = _record(db)
    monkeypatch.setenv("SESSION_SECRET", "a-new-secret")
    assert esign.verify(sig)["seal_ok"] is False
    monkeypatch.setenv("SESSION_SECRET_OLD", "unit-test-secret")
    assert esign.verify(sig)["valid"] is True


def test_a_document_edited_after_an_acknowledgement_is_reported_but_a_stamped_sign_off_is_not(db):
    doc = db.get(m.GovernanceDocument, 5)
    ack = _record(db, record_type="attestation_request", document=doc, content_sha256=esign.document_fingerprint(doc))
    assert esign.verify(ack, doc)["document_changed_since"] is False
    doc.content += "\nA new clause."
    assert esign.verify(ack, doc)["document_changed_since"] is True
    stamped = _record(db, document=doc, content_sha256="0" * 64)            # signing a sign-off edits the document itself
    assert esign.verify(stamped, doc)["document_changed_since"] is None


# -- formal sign-off ----------------------------------------------------------------

def _sign(db, monkeypatch, **body):
    monkeypatch.setattr(signoff, "get_user_tenants", lambda user, session: [1])
    return signoff.sign_document(document_id=5, body=signoff.SignRequest(**body), request=_request(), db=db, current_user=_user(db))


def test_a_formal_sign_off_needs_a_drawn_signature_and_changes_nothing_without_one(db, monkeypatch):
    with pytest.raises(HTTPException) as err:
        _sign(db, monkeypatch, comment="Looks right")
    assert err.value.status_code == 400
    with pytest.raises(HTTPException):
        _sign(db, monkeypatch, signature_image=_png(ink=False))
    db.rollback()
    assert db.query(m.DocumentSignature).count() == 0 and db.query(m.ElectronicSignature).count() == 0
    assert db.get(m.GovernanceDocument, 5).status == "pending_approval"


def test_signing_off_keeps_the_signature_stamps_the_fingerprint_and_names_it_in_the_audit_trail(db, monkeypatch):
    before = esign.document_fingerprint(db.get(m.GovernanceDocument, 5))
    out = _sign(db, monkeypatch, comment="Looks right", signature_image=_png())

    doc = db.get(m.GovernanceDocument, 5)
    row = db.query(m.DocumentSignature).one()
    sig = db.query(m.ElectronicSignature).one()
    assert doc.status == "approved" and row.decision == "signed"
    assert (sig.record_type, sig.record_id, sig.document_id, sig.document_version) == ("document_signoff", row.id, 5, "1.2")
    assert sig.content_sha256 == before                        # the document as the signer saw it, before the stamp
    assert (sig.signer_user_id, sig.signer_name, sig.signer_title, sig.meaning) == (3, "Sara Khan", "CISO", "Approved by: Access policy")
    assert f"E-signed {sig.image_sha256[:8]}" in doc.content   # the printed sign-off table carries the fingerprint
    entry = db.query(m.DocumentAuditLog).filter_by(action="signed").one()
    assert sig.image_sha256[:12] in entry.action_details and sig.seal[:12] in entry.action_details
    assert out["signatures"][0]["esign"]["id"] == sig.id and out["signatures"][0]["esign"]["image_sha256"] == sig.image_sha256
    assert esign.verify(sig)["valid"]


def test_rejecting_needs_no_signature(db, monkeypatch):
    monkeypatch.setattr(signoff, "get_user_tenants", lambda user, session: [1])
    signoff.reject_document(document_id=5, body=signoff.RejectRequest(comment="Scope is wrong"), db=db, current_user=_user(db))
    assert db.get(m.GovernanceDocument, 5).status == "draft" and db.query(m.ElectronicSignature).count() == 0


# -- acknowledgements ---------------------------------------------------------------

def _campaign(db, required):
    db.add(m.AttestationCampaign(id=1, tenant_id=1, name="Annual policy acknowledgement", campaign_type="policy_signoff",
                                 due_date=datetime.utcnow() + timedelta(days=7), attestation_text="I have read and will follow the policy.",
                                 requires_signature=required, linked_document_id=5, status="active"))
    db.add(m.AttestationRequest(id=1, tenant_id=1, campaign_id=1, user_id=3, attestation_type="policy_signoff",
                                due_date=datetime.utcnow() + timedelta(days=7)))
    db.commit()


def _complete(db, monkeypatch, **body):
    monkeypatch.setattr(campaigns, "get_user_tenants", lambda user, session: [1])
    return campaigns.complete_attestation(request_id=1, completion_data=AttestationCompleteRequest(**body), request=_request(),
                                          db=db, current_user=_user(db))


def test_a_campaign_can_require_the_acknowledgement_to_be_signed(db, monkeypatch):
    _campaign(db, required=True)
    with pytest.raises(HTTPException) as err:
        _complete(db, monkeypatch)
    assert err.value.status_code == 400 and db.get(m.AttestationRequest, 1).status == "pending"
    out = _complete(db, monkeypatch, signature_image=_png())
    sig = db.query(m.ElectronicSignature).one()
    assert db.get(m.AttestationRequest, 1).status == "completed"
    assert (sig.record_type, sig.record_id, sig.meaning) == ("attestation_request", 1, "I have read and will follow the policy.")
    assert sig.content_sha256 == esign.document_fingerprint(db.get(m.GovernanceDocument, 5))     # the linked document
    assert out["esign_id"] == sig.id and out["esign_fingerprint"] == sig.image_sha256[:16] and out["requires_signature"] is True


def test_signing_an_acknowledgement_is_optional_unless_required(db, monkeypatch):
    _campaign(db, required=False)
    assert _complete(db, monkeypatch)["esign_id"] is None
    assert db.query(m.ElectronicSignature).count() == 0


def test_the_older_per_user_attestation_keeps_a_signature_when_one_is_drawn(db, monkeypatch):
    monkeypatch.setattr(older, "get_user_tenants", lambda user, session: [1])
    db.add(m.PolicyAttestation(id=1, tenant_id=1, document_id=5, user_id=3))
    db.commit()
    asyncio.run(older.complete_attestation(attestation_id=1, completion_data=older.AttestationComplete(signature_image=_png()),
                                           request=_request(), db=db, current_user=_user(db)))
    sig = db.query(m.ElectronicSignature).one()
    assert db.get(m.PolicyAttestation, 1).status == "completed" and (sig.record_type, sig.record_id) == ("policy_attestation", 1)
    assert sig.content_sha256 == esign.document_fingerprint(db.get(m.GovernanceDocument, 5))


def test_an_outside_acknowledger_gets_a_sealed_record_and_signing_again_keeps_the_first(db, monkeypatch, tmp_path):
    monkeypatch.setattr(external, "_SIG_DIR", str(tmp_path))
    db.add(m.DocumentAttestationCampaign(id=1, tenant_id=1, document_id=5, name="Access policy", status="active",
                                         public_token="tok", allowed_email_domain="bank.example"))
    db.commit()
    body = dict(name="Ali Raza", email="ali@bank.example", designation="Analyst")
    first = external.public_acknowledge(token="tok", body=external.PublicAckSubmit(**body, signature_data=_png()), request=_request(), db=db)
    again = external.public_acknowledge(token="tok", body=external.PublicAckSubmit(**body, signature_data=_png()), request=_request(), db=db)
    rows = db.query(m.ElectronicSignature).order_by(m.ElectronicSignature.id).all()
    assert len(rows) == 2 and db.query(m.DocumentAttestationAcknowledgment).count() == 1      # the acknowledgement is one row, its history is two
    assert {r.record_id for r in rows} == {first["acknowledgment_id"]} and rows[0].signer_user_id is None
    assert (rows[0].signer_name, rows[0].signer_email, rows[0].signer_title) == ("Ali Raza", "ali@bank.example", "Analyst")
    assert first["signature_fingerprint"] == rows[0].image_sha256[:16] and again["signature_fingerprint"] == rows[1].image_sha256[:16]
    with pytest.raises(HTTPException):
        external.public_acknowledge(token="tok", body=external.PublicAckSubmit(**body, signature_data=_png(ink=False)), request=_request(), db=db)
    listing = external._serialize_campaign(db, db.get(m.DocumentAttestationCampaign, 1), with_acks=True)
    assert listing["acknowledgments"][0]["esign_fingerprint"] == rows[1].image_sha256[:16]       # the latest one is shown


# -- reading and verifying ----------------------------------------------------------

def test_a_signature_is_shown_and_verified_to_people_of_its_own_tenant_only(db, monkeypatch):
    sig = _record(db)
    db.commit()
    monkeypatch.setattr(esignatures, "get_user_tenants", lambda user, session: [1])
    seen = esignatures.get_signature(signature_id=sig.id, db=db, current_user=_user(db))
    assert seen["valid"] is True and seen["signer_name"] == "Sara Khan" and seen["image_sha256"] == sig.image_sha256
    assert seen["ip_address"] == "10.1.2.3" and seen["method"] == "drawn"
    image = esignatures.get_signature_image(signature_id=sig.id, db=db, current_user=_user(db))
    assert image.media_type == "image/png" and image.body == sig.image_png
    monkeypatch.setattr(esignatures, "get_user_tenants", lambda user, session: [2])
    with pytest.raises(HTTPException) as err:
        esignatures.get_signature(signature_id=sig.id, db=db, current_user=_user(db))
    assert err.value.status_code == 404


def test_an_audit_row_says_that_a_drawing_was_sent_not_what_it_contained():
    png = _png()
    assert audit_logger._sanitize_value({"signature_image": png, "comment": "ok"}) == {"signature_image": f"<data URL, {len(png)} chars>", "comment": "ok"}
    assert rich_audit._sanitize({"signature_image": png}) == {"signature_image": f"<data URL, {len(png)} chars>"}
    assert rich_audit.brief_data_url("data:text/plain;base64,aGk=") == "data:text/plain;base64,aGk="      # short ones are left alone


# -- over HTTP -------------------------------------------------------------------------

def test_over_http_a_sign_off_carries_the_drawing_and_the_signature_can_be_read_back(db, monkeypatch):
    from fastapi.testclient import TestClient
    from grc.main import app
    from grc.routers.auth_router import require_auth

    monkeypatch.setattr(signoff, "get_user_tenants", lambda user, session: [1])
    monkeypatch.setattr(esignatures, "get_user_tenants", lambda user, session: [1])
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: _user(db)
    try:
        http = TestClient(app)
        refused = http.post("/governance/documents/5/signoff/sign", json={"comment": "no drawing"})
        assert refused.status_code == 400 and "signature" in refused.json()["detail"].lower()
        done = http.post("/governance/documents/5/signoff/sign", json={"comment": "ok", "signature_image": _png()})
        assert done.status_code == 200 and done.json()["signatures"][0]["esign"]["image_sha256"]
        sig = db.query(m.ElectronicSignature).one()
        seen = http.get(f"/governance/esignatures/{sig.id}")
        assert seen.status_code == 200 and seen.json()["valid"] is True and seen.json()["signer_name"] == "Sara Khan"
        image = http.get(f"/governance/esignatures/{sig.id}/image")
        assert image.headers["content-type"] == "image/png" and image.content == sig.image_png
    finally:
        app.dependency_overrides.clear()
