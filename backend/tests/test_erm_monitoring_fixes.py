"""KRIs, Risk Appetite and Risk Reviews (2026-11-11): the defects found by reading the code, pinned.

Uploaded KRIs were saved with no tenant and vanished from the list; the trend refused a KRI with no risk; a value sent
for review overwrote the published one; approving did not ask whether the value had been submitted; appetite took the
tenant from the client; a completed review stamped nothing; and every write took any signed-in user. In-memory SQLite.
"""
import importlib
from datetime import datetime, timedelta
from io import BytesIO

import openpyxl
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, GRCUser, Risk, RiskAppetiteConfig, RiskKRI, RiskKRIMeasurement, RiskReview,
                        RiskScoreHistory, Role, Tenant, UserRole, get_db)
from grc.modules.erm.routers import appetite, kris, kris_workflow, reviews
from grc.routers.auth_router import create_access_token, require_auth

auth_router = importlib.import_module("grc.routers.auth_router")
OFFICER, PLAIN, OWNER = 7, 8, 9


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add(Role(id=1, name="Administrator"))
    s.add_all([GRCUser(id=OFFICER, username="officer", display_name="Officer", email="officer@bank.test", is_active=True),
               GRCUser(id=PLAIN, username="plain", display_name="Plain", email="plain@bank.test", is_active=True),
               GRCUser(id=OWNER, username="owner", display_name="Olu Owner", email="owner@bank.test", is_active=True)])
    s.add(UserRole(user_id=OFFICER, role_id=1, tenant_id=1))
    s.commit()
    yield s
    s.close()


def client(db, username="officer"):
    app = FastAPI()
    for module in (kris, kris_workflow, appetite, reviews):
        app.include_router(module.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def workbook(*rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "KRIs"
    for row in rows:
        ws.append(row)
    out = BytesIO()
    wb.save(out)
    return out.getvalue()


# ── KRIs ─────────────────────────────────────────────────────────────────────

def test_an_uploaded_kri_is_in_the_list(db):
    http = client(db)
    data = workbook(["KRI Name", "Frequency", "Green Threshold", "Amber Threshold", "Current Value"],
                    ["Failed logins", "Annual", 5, 10, 3])
    sent = http.post("/kris/upload", files={"file": ("kris.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert sent.status_code == 200 and sent.json()["created"] == 1, sent.text
    listed = http.get("/kris").json()
    assert [k["name"] for k in listed] == ["Failed logins"]
    assert listed[0]["frequency"] == "annually"
    assert db.query(RiskKRI).one().tenant_id == 1
    # wave 5: the file's value waits for a checker like any submitted value; it is not the current value yet
    assert (listed[0]["current_value"], db.query(RiskKRIMeasurement).one().review_status) == (None, "submitted")


def test_the_trend_answers_for_a_kri_with_no_risk_and_shows_only_published_values(db):
    http = client(db)
    kri = http.post("/kris", json={"name": "Open phishing cases", "green_threshold": 2, "amber_threshold": 5}).json()
    assert kri["risk_id"] is None
    db.add(UserRole(user_id=OWNER, role_id=1, tenant_id=1))
    db.commit()
    for value in (1, 4):   # wave 2-F: a KRI value is published once a second person approves it
        sent = http.post(f"/kris/{kri['id']}/measure", json={"value": value})
        assert sent.status_code == 200
        assert client(db, "owner").post(f"/kri-workflow/measurements/{sent.json()['id']}/approve").status_code == 200
    held = http.post(f"/kris/{kri['id']}/measure", json={"value": 9, "review_status": "submitted"})
    assert held.status_code == 200 and held.json()["review_status"] == "submitted"

    trend = http.get(f"/kris/{kri['id']}/trend")
    assert trend.status_code == 200, trend.text
    assert [m["value"] for m in trend.json()] == [1, 4], "a value awaiting review is not on the trend"
    assert http.get(f"/kris/{kri['id']}").json()["current_value"] == 4, "a value sent for review does not publish"


def test_the_kri_list_can_leave_out_kpis_and_an_annual_frequency_reads_as_annually(db):
    http = client(db)
    http.post("/kris", json={"name": "A KRI"})
    http.post("/kris", json={"name": "A KPI", "kind": "kpi", "frequency": "annual"})
    assert [k["name"] for k in http.get("/kris", params={"kind": "kri"}).json()] == ["A KRI"]
    kpi = http.get("/kris", params={"kind": "kpi"}).json()[0]
    assert kpi["frequency"] == "annually" and db.query(RiskKRI).filter_by(kind="kpi").one().frequency == "annually"


def test_approving_needs_a_submitted_value_and_then_publishes_it(db):
    http = client(db)
    kri = http.post("/kris", json={"name": "Overdue patches", "green_threshold": 1, "amber_threshold": 3}).json()
    approved = http.post(f"/kris/{kri['id']}/measure", json={"value": 2}).json()
    again = http.post(f"/kri-workflow/measurements/{approved['id']}/approve")
    assert again.status_code == 409, again.text
    assert http.post(f"/kri-workflow/measurements/{approved['id']}/reject", json={}).status_code == 409

    submitted = http.post(f"/kris/{kri['id']}/measure", json={"value": 7, "review_status": "submitted"}).json()
    # maker-checker: a second administrator approves the value the officer reported
    db.add(UserRole(user_id=OWNER, role_id=1, tenant_id=1))
    db.commit()
    checker = client(db, "owner")
    ok = checker.post(f"/kri-workflow/measurements/{submitted['id']}/approve")
    assert ok.status_code == 200 and ok.json()["current_value"] == 7
    assert db.get(RiskKRIMeasurement, submitted["id"]).review_status == "approved"
    assert checker.post(f"/kri-workflow/measurements/{submitted['id']}/approve").status_code == 409, "approved once only"


def test_a_view_only_user_cannot_write_kris(db, monkeypatch):
    plain = client(db, "plain")
    assert plain.post("/kris", json={"name": "Nope"}).status_code == 403
    assert db.query(RiskKRI).count() == 0
    assert plain.get("/kris").status_code == 200, "reading stays open to the module's viewers"
    kri = client(db).post("/kris", json={"name": "Officer's"}).json()
    assert plain.put(f"/kris/{kri['id']}", json={"name": "x"}).status_code == 403
    assert plain.post(f"/kris/{kri['id']}/measure", json={"value": 1}).status_code == 403
    assert plain.delete(f"/kris/{kri['id']}").status_code == 403
    monkeypatch.setattr(auth_router, "has_tenant_permission", lambda db_, user, *names: "erm:risks:create" in names)
    assert plain.post("/kris", json={"name": "A risk editor may"}).status_code == 201


# ── Risk appetite ────────────────────────────────────────────────────────────

def test_appetite_is_filed_under_the_users_tenant_whatever_the_client_sends(db):
    http = client(db)
    made = http.post("/appetite", params={"tenant_id": 999}, json={"category": "operational", "tolerance_threshold": 10})
    assert made.status_code == 200, made.text
    assert made.json()["tenant_id"] == 1
    seeded = http.post("/appetite/seed-defaults", params={"tenant_id": 999})
    assert seeded.status_code == 200 and "operational" not in seeded.json()["created_categories"]
    assert {c.tenant_id for c in db.query(RiskAppetiteConfig)} == {1}
    assert client(db, "plain").post("/appetite", json={"category": "financial"}).status_code == 403


def test_one_breach_rule_on_both_appetite_views(db):
    db.add_all([RiskAppetiteConfig(tenant_id=1, category="operational", tolerance_threshold=10, max_acceptable_score=20),
                RiskAppetiteConfig(tenant_id=1, category="financial", tolerance_threshold=None, max_acceptable_score=8)])
    risk = lambda title, category, **kw: Risk(tenant_id=1, title=title, category=category, risk_category=category, **kw)  # noqa: E731
    db.add_all([
        risk("residual over", "operational", inherent_score=20, residual_score=12),
        risk("residual under", "operational", inherent_score=20, residual_score=9),
        risk("only inherent", "financial", inherent_score=9),                       # over max acceptable 8
        risk("closed", "operational", residual_score=25, status="closed"),
        risk("closure done", "operational", residual_score=25, closure_status="closed"),
        risk("unscored", "operational"),
        risk("no config", "strategic", residual_score=25),                           # no invented default of 15
    ])
    db.commit()
    http = client(db)
    breaches = http.get("/appetite/breaches").json()
    assert sorted(b["risk_title"] for b in breaches["breaches"]) == ["only inherent", "residual over"]
    stats = {c["category"]: c for c in http.get("/appetite/with-stats").json()}
    assert (stats["operational"]["exceeding_count"], stats["operational"]["risks_count"]) == (1, 3), "closed risks are left out"
    assert (stats["financial"]["exceeding_count"], stats["financial"]["tolerance_threshold"]) == (1, 8)


# ── Risk reviews ─────────────────────────────────────────────────────────────

def test_starting_keeps_the_assigned_reviewer_and_completing_stamps_and_records(db):
    db.add(Risk(id=1, tenant_id=1, title="Payments outage", category="operational", inherent_likelihood=4,
                inherent_impact=4, inherent_score=16, residual_likelihood=2, residual_impact=3, residual_score=6))
    db.commit()
    http = client(db)
    due = (datetime.utcnow() + timedelta(days=7)).isoformat()
    review = http.post("/reviews", json={"risk_id": 1, "due_date": due, "reviewer_id": OWNER}).json()

    started = http.put(f"/reviews/{review['id']}", json={"status": "in_review"}).json()
    assert started["reviewer_id"] == OWNER and started["started_at"], "the officer who clicked Start is not the reviewer"

    # Wave 2-H: "completed" is now the reviewer's submission; the approval (by someone else) stamps and records.
    db.add(UserRole(user_id=OWNER, role_id=1, tenant_id=1))
    db.commit()
    done = client(db, "owner").put(f"/reviews/{review['id']}",
                                   json={"status": "completed", "new_residual_score": 5, "findings": "ok"})
    assert done.status_code == 200, done.text
    assert done.json()["status"] == "submitted" and done.json()["approver_id"] is None, "completing is not an approval"
    assert done.json()["completed_at"] is None and db.query(RiskScoreHistory).count() == 0
    approved = http.put(f"/reviews/{review['id']}", json={"status": "approved"})
    assert approved.status_code == 200 and approved.json()["completed_at"], approved.text
    history = db.query(RiskScoreHistory).one()
    assert (history.risk_id, history.residual_score, history.change_reason) == (1, 5, f"Review #{review['id']} approved")
    assert client(db, "plain").put(f"/reviews/{review['id']}", json={"findings": "x"}).status_code == 403
    assert client(db, "plain").post("/reviews", json={"risk_id": 1, "due_date": due}).status_code == 403
    assert db.query(RiskReview).count() == 2, "this review and the next one the approval scheduled"
