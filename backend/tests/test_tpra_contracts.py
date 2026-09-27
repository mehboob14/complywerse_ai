"""The contracts inbox: every contract, the ones needing a decision first.

A contract needs deciding by the last day to give notice, not the day it ends;
writes are cleaned field by field and leave out what they do not name; a renewal
moves the term on; the AI's reading is only ever a suggestion, cleaned the same way.
"""
import json
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, Evidence, GRCUser, Tenant, TPRAAuditLog, TPRAContract, Vendor, get_db
from grc.modules.vendor_risk.tpra import api, attention, contracts, rbac, reminders
from grc.routers.auth_router import require_auth

NOW = datetime.utcnow()
TODAY = NOW.date()


def ahead(days):
    return NOW + timedelta(days=days)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add_all([GRCUser(id=7, username="owner", email="owner@acme.test", is_active=True),
               GRCUser(id=12, username="buyer", email="buyer@acme.test", is_active=True)])
    s.add(Vendor(id=1, tenant_id=1, name="Payroll Co", status="active", tier="high", owner_id=7))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def client(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(api.router)
    app.include_router(contracts.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def _contract(db, title, **kw):
    c = TPRAContract(tenant_id=1, vendor_id=1, title=title, status=kw.pop("status", "active"), **kw)
    db.add(c)
    db.commit()
    return c


def test_the_inbox_comes_first_and_decisions_fall_on_the_notice_date(db, client):
    _contract(db, "Rolls over", renewal_type="auto", notice_days=90, renewal_date=ahead(100),
              annual_value=12000, currency="USD")                   # notice due in 10 days
    _contract(db, "Ends soon", expiry_date=ahead(60), annual_value=500, currency="EUR")
    _contract(db, "Lapsed", expiry_date=ahead(-3), annual_value=100, currency="USD")
    _contract(db, "Long way off", expiry_date=ahead(400))
    _contract(db, "No end", renewal_type="evergreen")
    _contract(db, "Negotiating", status="draft", expiry_date=ahead(5), annual_value=9999, currency="USD")
    _contract(db, "Gone", status="terminated", expiry_date=ahead(-100))
    body = client.get("/contracts").json()
    assert [(r["title"], r["state"]) for r in body["items"]] == [
        ("Lapsed", "lapsed"), ("Rolls over", "decide"), ("Ends soon", "ending"),
        ("Long way off", "in_force"), ("No end", "in_force"), ("Negotiating", "draft"), ("Gone", "ended")]
    rolls = body["items"][1]
    assert rolls["days_left"] == 10 and rolls["act_by"] == (TODAY + timedelta(days=10)).isoformat()
    assert body["annual_value"] == {"USD": 12100, "EUR": 500}                     # drafts do not count
    assert body["counts"]["decide"] == 1 and body["decide_days"] == 30


def test_writes_are_cleaned_and_leaving_a_field_out_keeps_it(db, client):
    bad = {"record_link": "javascript:alert(1)"}, {"currency": "dollars"}, {"pricing": {"secret": 1}}, \
        {"effective_date": ahead(10).isoformat(), "expiry_date": ahead(5).isoformat()}
    for extra in bad:
        assert client.post("/tpra/vendors/1/contracts", json={"title": "x", **extra}).status_code == 400, extra
    made = client.post("/tpra/vendors/1/contracts", json={
        "title": "Master", "status": "active", "contract_type": "master", "currency": "gbp", "annual_value": "1200.5",
        "pricing": {"unit_price": 10, "uplift": "no"}, "record_link": "https://contracts.acme.test/42"})
    assert made.status_code == 201, made.text
    c = made.json()
    assert (c["currency"], c["annual_value"], c["pricing"]) == ("GBP", 1200.5, {"unit_price": 10.0, "uplift": False})
    edited = client.put(f"/tpra/contracts/{c['id']}", json={"notice_days": 60, "record_link": None,
                                                           "reason": "Read the notice clause"})
    assert edited.status_code == 200, edited.text
    assert (edited.json()["status"], edited.json()["notice_days"], edited.json()["record_link"]) == ("active", 60, None)
    row = db.query(TPRAAuditLog).filter_by(entity="contract", action="update").one()
    assert row.extra["changes"] == {"notice_days": [None, 60], "record_link": ["https://contracts.acme.test/42", None]}
    assert client.put(f"/tpra/contracts/{c['id']}", json={"status": "signed"}).status_code == 400


def test_a_renewal_moves_the_term_on(db, client):
    c = _contract(db, "Annual", expiry_date=ahead(-2), annual_value=1000, currency="USD")
    assert client.post(f"/contracts/{c.id}/renew", json={"expiry_date": (TODAY - timedelta(days=5)).isoformat()}).status_code == 400
    done = client.post(f"/contracts/{c.id}/renew", json={"expiry_date": (TODAY + timedelta(days=363)).isoformat(),
                                                         "annual_value": 1100, "note": "3% uplift agreed"})
    assert done.status_code == 200, done.text
    assert (done.json()["state"], done.json()["annual_value"]) == ("in_force", 1100)
    audit = db.query(TPRAAuditLog).filter_by(entity="contract", action="renew").one()
    assert audit.to_value == (TODAY + timedelta(days=363)).isoformat() and audit.reason == "3% uplift agreed"
    history = client.get(f"/contracts/{c.id}").json()["history"]
    assert history[0]["action"] == "renew" and history[0]["changes"]["annual_value"] == [1000, 1100]


def test_the_ai_reading_is_cleaned_field_by_field():
    reply = json.dumps({
        "title": "  Master   Services Agreement ", "contract_type": "master", "annual_value": "USD 12,000 per year",
        "notice_days": "90 days", "currency": "usd", "renewal_type": "auto", "billing": "yearly",
        "record_link": "see portal", "uplift": "no", "unit_price": "$4.50", "effective_date": "2026-01-01",
        "expiry_date": "31/12/2026", "termination": "Either party on 60 days' written notice."})
    suggested, skipped = contracts.ai_terms("text", "Acme", complete=lambda messages: reply)
    assert suggested == {
        "title": "Master Services Agreement", "contract_type": "master", "annual_value": 12000.0, "notice_days": 90,
        "currency": "USD", "renewal_type": "auto", "pricing": {"unit_price": 4.5, "uplift": False},
        "effective_date": "2026-01-01", "termination": "Either party on 60 days' written notice."}
    assert sorted(skipped) == ["billing", "expiry_date", "record_link"]


def test_the_signed_copy_and_reading_it(db, client, monkeypatch):
    c = _contract(db, "DPA", contract_type="dpa")
    assert client.post(f"/contracts/{c.id}/read-terms").status_code == 400          # nothing attached yet
    assert client.post(f"/contracts/{c.id}/file", files={"file": ("run.exe", b"MZ")}).status_code == 400

    async def save(db_, tenant_id, name, evidence_type, file, user_id):
        ev = Evidence(tenant_id=tenant_id, name=name, file_name=file.filename, evidence_type=evidence_type,
                      ocr_content=(await file.read()).decode())
        db_.add(ev)
        db_.flush()
        return ev

    monkeypatch.setattr(api, "_save_evidence_file", save)
    up = client.post(f"/contracts/{c.id}/file", files={"file": ("dpa.txt", b"Renews yearly unless 30 days notice.")})
    assert up.status_code == 200, up.text
    monkeypatch.setattr(contracts, "ai_terms", lambda text, vendor: ({"notice_days": 30}, []) if "30 days" in text else ({}, []))
    read = client.post(f"/contracts/{c.id}/read-terms")
    assert read.json() == {"suggested": {"notice_days": 30}, "skipped": []}
    db.refresh(c)
    assert c.notice_days is None                                                     # suggestions are not saved
    assert client.get(f"/contracts/{c.id}").json()["file"]["name"] == "dpa.txt"


def test_reminders_and_the_queue_use_the_notice_date(db):
    c = _contract(db, "Payroll MSA", renewal_type="auto", notice_days=90, renewal_date=ahead(100))
    _contract(db, "Far away", expiry_date=ahead(200))
    policy = {"contract_notify": ["user:12"]}
    notices = [n for n in reminders.due_notices(db, 1, TODAY, policy) if n.kind == "contract_expiring"]
    assert [(n.subject_id, sorted(n.recipients)) for n in notices] == [(c.id, [7, 12])]
    assert "Notice on contract 'Payroll MSA'" in notices[0].title and "renews on" in notices[0].title
    assert notices[0].link == f"/vendor-risk/contracts?contract={c.id}"
    item = next(i for i in attention.open_items(db, 1, TODAY, {}) if i["condition"] == "contract_expiring")
    assert item["record_id"] == c.id and "notice is due by" in item["title"] and item["badge"] == "Due in 10 days"
    assert reminders.clean_policy({"contract_before_days": 60, "contract_notify": ["role:Procurement"]}, {}) == {
        "contract_before_days": 60, "contract_notify": ["role:Procurement"]}
