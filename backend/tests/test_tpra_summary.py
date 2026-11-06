"""The supplier summary: what we hold, placed on NIST CSF 2.0 by code, and kept as a report.

Answers count for a category through our map of the questions (or the CSF
category a question names), open findings and outside-in findings count
against, evidence counts by what it was supplied for, and obligations reach
CSF 2.0 through the crosswalk. The AI's paragraphs are cleaned, and kept only
when the report is.
"""
import json
from datetime import date, datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, Evidence, GRCUser, Tenant, TPRAEvidenceLink, TPRAFinding, TPRAReport, TPRASurfaceScan, Vendor,
    VendorQuestionnaireResponse, VendorQuestionnaireTemplate, get_db,
)
from grc.modules.vendor_risk.tpra import rbac, reports, summary
from grc.routers.auth_router import require_auth

NOW = datetime.utcnow()


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="a@acme.test", is_active=True))
    s.add(Vendor(id=1, tenant_id=1, name="Payroll Co", status="active", tier="critical", owner_id=7,
                 data_access_level="confidential"))
    s.add(VendorQuestionnaireTemplate(id=1, tenant_id=1, name="Security", questions=[
        {"id": "sl_mfa", "text": "Is MFA enforced?", "type": "yes_no"},
        {"id": "sl_enc", "text": "Is data encrypted?", "type": "yes_no"},
        {"id": "own_q", "text": "Do you watch your logs?", "type": "yes_no", "csf": "DE.CM-01"}]))
    s.add(VendorQuestionnaireResponse(id=1, tenant_id=1, vendor_id=1, template_id=1, token="t", status="accepted",
                                      submitted_at=NOW, responses={"sl_mfa": "yes", "sl_enc": "no", "own_q": "yes"}))
    s.add(TPRAFinding(tenant_id=1, vendor_id=1, assessment_id=1, severity="high", title="No central logging",
                      status="open", question_key="sc_logging"))
    s.add(TPRASurfaceScan(tenant_id=1, vendor_id=1, status="done", started_at=NOW, finished_at=NOW, score=85, grade="B", hosts=[],
                          findings=[{"key": "tls_expired", "category": "tls", "severity": "high", "title": "The certificate has expired",
                                     "host": "payroll.test"}]))
    s.add_all([Evidence(id=1, tenant_id=1, name="Pen test 2026", expiry_date=NOW + timedelta(days=200)),
               Evidence(id=2, tenant_id=1, name="Cyber insurance", expiry_date=NOW - timedelta(days=3))])
    s.add_all([TPRAEvidenceLink(tenant_id=1, vendor_id=1, evidence_id=1, requirement="pen_test"),
               TPRAEvidenceLink(tenant_id=1, vendor_id=1, evidence_id=2, requirement="insurance")])
    s.commit()
    yield s
    s.close()


def test_the_profile_places_what_we_hold_on_csf_categories(db, monkeypatch):
    monkeypatch.setattr(summary, "_crosswalk", lambda db, ids: {"IAC-06": {"PR.AA"}, "IRO-10": {"RS.CO"}})
    obligations = [{"vendor_id": 1, "scf_ids": ["IAC-06"], "status": "met", "obligation": "Enforce MFA for admins"},
                   {"vendor_id": 1, "scf_ids": ["IRO-10"], "status": "breached", "obligation": "Tell us of breaches in 24h"},
                   {"vendor_id": 2, "scf_ids": ["IAC-06"], "status": "breached", "obligation": "Someone else's"}]
    rows = {c["code"]: c for c in summary.profile(db, db.get(Vendor, 1), obligations)}
    assert len(rows) == 22 and rows["PR.AA"]["function"] == "Protect"
    assert rows["PR.AA"]["state"] == "evidence" and len(rows["PR.AA"]["support"]) == 2      # an answer and an obligation
    assert rows["PR.DS"]["state"] == "gap"                          # answered No, and the certificate seen expired
    assert any("expired" in a for a in rows["PR.DS"]["against"]) and any("encrypted" in a for a in rows["PR.DS"]["against"])
    assert rows["DE.CM"]["state"] == "gap" and rows["DE.CM"]["support"]     # a question naming DE.CM, and an open finding
    assert rows["PR.PS"]["state"] == "evidence"                     # nothing seen from outside against it
    assert rows["ID.RA"]["state"] == "evidence" and rows["GV.RM"]["state"] == "gap"   # in-date pen test; lapsed insurance
    assert rows["RS.CO"]["state"] == "gap" and rows["GV.OC"]["state"] == "none"


def test_the_summary_is_a_report_and_the_ai_paragraphs_are_cleaned(db):
    content = summary.summary(db, 1, db.get(Vendor, 1), date.today(), narrative=["It is mostly sound."])
    assert content["kind"] == "vendor_summary" and [s["key"] for s in content["sections"]][:2] == ["narrative", "csf"]
    assert content["sections"][0]["paragraphs"] == ["It is mostly sound."] and len(content["sections"][1]["rows"]) == 22
    head = {h["label"]: h for h in content["headline"]}
    assert head["Open findings"]["value"] == 1 and head["Outside-in"]["value"] == "B · 85"
    assert json.dumps(content, default=str)
    text = summary._as_text(content)
    assert "NIST CSF 2.0 profile" in text and "It is mostly sound" not in text     # the AI is given the figures, not itself
    reply = json.dumps({"paragraphs": ["  One.  ", "", "Two."] + ["x"] * 6})
    assert summary.write_narrative(content, complete=lambda m: reply) == ["One.", "Two.", "x", "x", "x"]
    with pytest.raises(ValueError):
        summary.write_narrative(content, complete=lambda m: "{}")


def test_the_summary_is_read_written_and_kept(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    monkeypatch.setattr(summary, "write_narrative", lambda content: ["Mostly sound; fix the certificate."])
    app = FastAPI()
    app.include_router(summary.router)
    app.include_router(reports.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    c = TestClient(app)
    assert c.get("/vendors/1/summary").json()["title"] == "Supplier summary: Payroll Co"
    assert c.get("/vendors/9/summary").status_code == 404
    written = c.post("/vendors/1/summary/narrative").json()
    kept = c.post("/tpra/reports", json={"kind": "vendor_summary", "vendor_id": 1, "narrative": written["paragraphs"]})
    assert kept.status_code == 201, kept.text
    stored = db.query(TPRAReport).one()
    assert stored.kind == "vendor_summary" and stored.content["sections"][0]["paragraphs"] == written["paragraphs"]
