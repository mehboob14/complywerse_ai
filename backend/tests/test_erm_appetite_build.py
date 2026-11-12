"""Risk Appetite build (wave 2-G): board-approved statement versions, limits linked to KRIs, a breach log with escalation.

A statement is drafted, submitted and approved by someone other than the submitter; approving supersedes the last approved
version. Detection opens one breach per breaching risk or red limit KRI, resolves it when back within limit and reopens an
expired excess; the escalation owner is told of a new breach. A breach takes a plan, then a second person approves the plan or
a time-limited excess. Runs through the real /erm router. In-memory SQLite.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, GRCUser, Permission, Risk, RiskAppetiteBreach, RiskAppetiteConfig, RiskKRI, Role,
                        RolePermission, Tenant, UserRole, get_db)
from grc.modules.erm.router import router as erm_router
from grc.modules.erm.routers import appetite
from grc.routers.auth_router import create_access_token, require_auth

OFFICER, CRO, OWNER, PLAIN = 7, 8, 9, 10


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add_all([Tenant(id=1, name="Bank", slug="bank"), Tenant(id=2, name="Other", slug="other")])
    s.add_all([Role(id=1, name="Administrator"), Role(id=2, name="Risk viewer")])
    s.add(Permission(id=1, name="erm:risks:view", resource="erm:risks", action="view"))
    s.add(RolePermission(role_id=2, permission_id=1))
    s.add_all([GRCUser(id=OFFICER, username="officer", display_name="Officer", email="officer@bank.test", is_active=True),
               GRCUser(id=CRO, username="cro", display_name="Chief Risk", email="cro@bank.test", is_active=True),
               GRCUser(id=OWNER, username="owner", display_name="Olu Owner", email="owner@bank.test", is_active=True),
               GRCUser(id=PLAIN, username="plain", display_name="Plain", email="plain@bank.test", is_active=True)])
    s.add_all([UserRole(user_id=OFFICER, role_id=1, tenant_id=1), UserRole(user_id=CRO, role_id=1, tenant_id=1),
               UserRole(user_id=OWNER, role_id=2, tenant_id=1), UserRole(user_id=PLAIN, role_id=2, tenant_id=1)])
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def notes(monkeypatch):
    sent = []
    monkeypatch.setattr(appetite, "send_workflow_notification", lambda db_, **kw: sent.append(kw) or {"notified_users": 1})
    return sent


def client(db, username="officer"):
    app = FastAPI()
    app.include_router(erm_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def limit(db, category="operational", tolerance=10, **kw):
    config = RiskAppetiteConfig(**{"tenant_id": 1, "category": category, "tolerance_threshold": tolerance,
                                   "max_acceptable_score": 20, "escalation_owner_id": OWNER, "alert_enabled": True, **kw})
    db.add(config)
    db.commit()
    return config


def risk(db, title, residual, category="operational", **kw):
    row = Risk(**{"tenant_id": 1, "title": title, "category": category, "risk_category": category, "inherent_score": 20,
                  "residual_score": residual, **kw})
    db.add(row)
    db.commit()
    return row


def open_breaches(db):
    db.expire_all()
    return db.query(RiskAppetiteBreach).filter(RiskAppetiteBreach.status != "resolved").all()


# ── Statements ───────────────────────────────────────────────────────────────

def test_a_statement_is_approved_by_someone_other_than_its_submitter_and_supersedes_the_last(db):
    officer, cro = client(db), client(db, "cro")
    made = officer.post("/erm/appetite/statements", json={"statement": "We accept low operational risk."})
    assert made.status_code == 200, made.text
    first = made.json()
    assert (first["version"], first["status"]) == (1, "draft")
    assert officer.put(f"/erm/appetite/statements/{first['id']}",
                       json={"statement": "We accept low operational risk only."}).json()["statement"].endswith("only.")
    assert officer.post(f"/erm/appetite/statements/{first['id']}/submit").json()["status"] == "pending_approval"
    assert officer.put(f"/erm/appetite/statements/{first['id']}", json={"statement": "x"}).status_code == 409
    assert officer.post(f"/erm/appetite/statements/{first['id']}/approve", json={}).status_code == 409
    approved = cro.post(f"/erm/appetite/statements/{first['id']}/approve", json={"note": "Board, 10 Nov"}).json()
    assert (approved["status"], approved["approved_by"], approved["approval_note"]) == ("approved", CRO, "Board, 10 Nov")
    assert approved["approved_at"] and approved["effective_from"]

    second = officer.post("/erm/appetite/statements", json={"statement": "We accept moderate operational risk."}).json()
    assert second["version"] == 2
    assert officer.post("/erm/appetite/statements", json={"statement": "another"}).status_code == 409, "one open draft"
    officer.post(f"/erm/appetite/statements/{second['id']}/submit")
    assert cro.post(f"/erm/appetite/statements/{second['id']}/approve", json={}).json()["status"] == "approved"
    listed = officer.get("/erm/appetite/statements").json()
    assert [(s["version"], s["status"]) for s in listed] == [(2, "approved"), (1, "superseded")]
    assert officer.get("/erm/appetite/statements/current").json()["version"] == 2

    third = officer.post("/erm/appetite/statements", json={"statement": "Draft three"}).json()
    officer.post(f"/erm/appetite/statements/{third['id']}/submit")
    assert cro.post(f"/erm/appetite/statements/{third['id']}/reject", json={"note": ""}).status_code == 422
    sent_back = cro.post(f"/erm/appetite/statements/{third['id']}/reject", json={"note": "Name the limits"}).json()
    assert (sent_back["status"], sent_back["approval_note"]) == ("draft", "Name the limits")
    assert client(db, "plain").post("/erm/appetite/statements", json={"statement": "x"}).status_code == 403


# ── Detection ────────────────────────────────────────────────────────────────

def test_detection_opens_one_breach_per_breaching_risk_and_resolves_it_when_back_within_limit(db, notes):
    limit(db)
    over = risk(db, "Ledger outage", 12)
    risk(db, "Within", 9)
    risk(db, "Unscored", None, inherent_score=None)
    http = client(db)
    assert http.get("/erm/appetite/with-stats").status_code == 200        # the page data runs detection
    assert [(b.risk_id, b.measured_value, b.limit_value, b.status) for b in open_breaches(db)] == [(over.id, 12, 10, "open")]
    assert http.post("/erm/appetite/check").json()["opened"] == 0, "idempotent"
    log = http.get("/erm/appetite/breach-log").json()
    assert [(b["risk_title"], b["status"], b["days_open"]) for b in log] == [("Ledger outage", "open", 0)]

    db.query(Risk).filter_by(id=over.id).update({"residual_score": 8})
    db.commit()
    assert http.post("/erm/appetite/check").json()["resolved"] == 1
    assert open_breaches(db) == []
    assert http.get("/erm/appetite/breach-log").json()[0]["status"] == "resolved"
    # the old breach endpoints keep their shape
    assert http.get("/erm/appetite/breaches").json() == {"total_breaches": 0, "breaches": []}


def test_a_red_linked_kri_is_a_breach_of_its_categorys_limit(db, notes):
    config = limit(db)
    red = RiskKRI(tenant_id=1, name="Failed payments", current_value=15, green_threshold=5, amber_threshold=10,
                  threshold_direction="lower_is_better")
    green = RiskKRI(tenant_id=1, name="Uptime", current_value=99.9, green_threshold=99.5, amber_threshold=99,
                    threshold_direction="higher_is_better")
    elsewhere = RiskKRI(tenant_id=2, name="Not ours", current_value=1)
    db.add_all([red, green, elsewhere])
    db.commit()
    http = client(db)
    assert http.put(f"/erm/appetite/{config.id}/kris", json={"kri_ids": [elsewhere.id]}).status_code == 404
    linked = http.put(f"/erm/appetite/{config.id}/kris", json={"kri_ids": [red.id, green.id]})
    assert linked.status_code == 200, linked.text
    [breach] = http.get("/erm/appetite/breach-log").json()
    assert (breach["kri_id"], breach["kri_name"], breach["measured_value"], breach["limit_value"]) == (red.id, "Failed payments", 15, 10)
    stats = http.get("/erm/appetite/with-stats").json()[0]
    assert [k["id"] for k in stats["limit_kris"]] == [red.id, green.id]
    assert stats["open_breach_count"] == 1


def test_a_new_breach_tells_the_escalation_owner_once(db, notes):
    limit(db)
    risk(db, "Ledger outage", 12)
    limit(db, "financial", alert_enabled=False)
    risk(db, "Quiet", 25, category="financial")
    http = client(db)
    http.post("/erm/appetite/check")
    http.post("/erm/appetite/check")
    assert [(n["user_ids"], n["link"]) for n in notes] == [([OWNER], "/erm/appetite")], "alerts off: logged, not sent"
    assert "Ledger outage" in notes[0]["message"]
    assert len(open_breaches(db)) == 2


def test_a_risk_score_change_through_the_register_rechecks_appetite(db, notes):
    limit(db)
    row = risk(db, "Ledger outage", 6)
    http = client(db)
    assert http.put(f"/erm/risks/{row.id}", json={"residual_score": 15}).status_code == 200
    [breach] = open_breaches(db)
    assert (breach.risk_id, breach.measured_value) == (row.id, 15)
    assert len(notes) == 1
    http.put(f"/erm/risks/{row.id}", json={"residual_score": 5})
    assert open_breaches(db) == []


# ── Plan and decision ────────────────────────────────────────────────────────

def test_an_excess_is_approved_by_someone_other_than_the_planner_for_at_most_six_months(db, notes):
    limit(db)
    risk(db, "Ledger outage", 12, owner_id=OWNER)
    officer, cro = client(db), client(db, "cro")
    officer.post("/erm/appetite/check")
    [breach] = open_breaches(db)
    path = f"/erm/appetite/breaches/{breach.id}"
    assert client(db, "plain").post(f"{path}/plan", json={"plan": "Wait"}).status_code == 403
    assert officer.post(f"{path}/approve-excess", json={"expires_at": (datetime.utcnow() + timedelta(days=30)).isoformat(),
                                                         "note": "ok"}).status_code == 409, "no plan yet"
    owner_plan = client(db, "owner").post(f"{path}/plan", json={"plan": "Second supplier by March"})
    assert owner_plan.status_code == 200, owner_plan.text
    planned = officer.post(f"{path}/plan", json={"plan": "Second supplier by February"}).json()
    assert (planned["status"], planned["plan_by"]) == ("plan_proposed", OFFICER)
    soon = (datetime.utcnow() + timedelta(days=90)).isoformat()
    assert officer.post(f"{path}/approve-excess", json={"expires_at": soon, "note": "ok"}).status_code == 409
    too_far = (datetime.utcnow() + timedelta(days=200)).isoformat()
    assert cro.post(f"{path}/approve-excess", json={"expires_at": too_far, "note": "ok"}).status_code == 422
    assert cro.post(f"{path}/approve-excess", json={"expires_at": soon, "note": ""}).status_code == 422
    decided = cro.post(f"{path}/approve-excess", json={"expires_at": soon, "note": "Until the supplier is live"}).json()
    assert (decided["status"], decided["decided_by"], decided["decision_note"]) == ("excess_approved", CRO,
                                                                                    "Until the supplier is live")
    assert decided["excess_expires_at"].startswith(soon[:10])
    officer.post("/erm/appetite/check")
    assert open_breaches(db)[0].status == "excess_approved", "an excess in force stays"


def test_approving_a_plan_needs_a_second_person(db, notes):
    limit(db)
    risk(db, "Ledger outage", 12)
    officer, cro = client(db), client(db, "cro")
    officer.post("/erm/appetite/check")
    [breach] = open_breaches(db)
    officer.post(f"/erm/appetite/breaches/{breach.id}/plan", json={"plan": "Patch"})
    assert officer.post(f"/erm/appetite/breaches/{breach.id}/approve-plan", json={}).status_code == 409
    decided = cro.post(f"/erm/appetite/breaches/{breach.id}/approve-plan", json={"note": "Go"}).json()
    assert (decided["status"], decided["decided_by"]) == ("plan_approved", CRO)


def test_an_expired_excess_reopens_the_breach(db, notes):
    limit(db)
    risk(db, "Ledger outage", 12)
    officer, cro = client(db), client(db, "cro")
    officer.post("/erm/appetite/check")
    [breach] = open_breaches(db)
    officer.post(f"/erm/appetite/breaches/{breach.id}/plan", json={"plan": "Patch"})
    cro.post(f"/erm/appetite/breaches/{breach.id}/approve-excess",
             json={"expires_at": (datetime.utcnow() + timedelta(days=10)).isoformat(), "note": "Short"})
    db.query(RiskAppetiteBreach).filter_by(id=breach.id).update({"excess_expires_at": datetime.utcnow() - timedelta(days=1)})
    db.commit()
    assert officer.post("/erm/appetite/check").json()["reopened"] == 1
    [again] = open_breaches(db)
    assert (again.id, again.status) == (breach.id, "open")
    assert len(notes) == 2, "the escalation owner hears of the lapse"
