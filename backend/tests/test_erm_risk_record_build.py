"""Risk record (wave 1-C): target risk, response, acceptance with a second person's approval and an expiry, and a change
history with the reason, on both risk APIs. Non-admin roles throughout: maker-checker has no administrator exception.
In-memory SQLite, the real /erm router and the legacy /risks router.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (AuditLog, Base, GRCUser, Permission, Risk, RiskScoreHistory, Role, RolePermission, Tenant,
                        UserRole, get_db)
from grc.modules.erm.router import router as erm_router
from grc.routers.auth_router import create_access_token, require_auth
from grc.routers.risks_router import router as legacy_router

EDITOR, APPROVER, VIEWER = 7, 8, 9


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add_all([Role(id=1, name="Risk editor"), Role(id=2, name="Risk approver"), Role(id=3, name="Risk viewer")])
    perms = {1: "erm:risks:view", 2: "erm:risks:edit", 3: "erm:risks:delete", 4: "risks:risk_treatment:edit",
             5: "risks:risk_register:edit", 6: "risks:risk_register:delete", 7: "erm:risks:create"}
    s.add_all([Permission(id=i, name=n, resource=n.rsplit(":", 1)[0], action=n.rsplit(":", 1)[1]) for i, n in perms.items()])
    s.add_all([RolePermission(role_id=1, permission_id=p) for p in (1, 2, 3, 5, 6, 7)]
              + [RolePermission(role_id=2, permission_id=p) for p in (1, 4)]
              + [RolePermission(role_id=3, permission_id=1)])
    s.add_all([GRCUser(id=uid, username=name, display_name=name.title(), email=f"{name}@bank.test", is_active=True)
               for uid, name in ((EDITOR, "editor"), (APPROVER, "approver"), (VIEWER, "viewer"))])
    s.add_all([UserRole(user_id=EDITOR, role_id=1, tenant_id=1), UserRole(user_id=APPROVER, role_id=2, tenant_id=1),
               UserRole(user_id=VIEWER, role_id=3, tenant_id=1)])
    s.commit()
    yield s
    s.close()


def client(db, username="editor"):
    app = FastAPI()
    app.include_router(erm_router)
    app.include_router(legacy_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def add(db, title="Ledger outage", **fields):
    risk = Risk(tenant_id=1, title=title, category="operational", **fields)
    db.add(risk)
    db.commit()
    return risk.id


def in_days(days):
    return (datetime.utcnow() + timedelta(days=days)).isoformat()


def test_the_target_score_is_likelihood_times_impact(db):
    http = client(db)
    made = http.post("/erm/risks", json={"title": "Ledger outage", "category": "operational", "response": "mitigate",
                                         "target_likelihood": 2, "target_impact": 2,
                                         "review_date": "2027-03-31T00:00:00", "due_date": "2027-02-28T00:00:00"})
    assert made.status_code == 201, made.text
    body = made.json()
    assert (body["target_score"], body["response"]) == (4, "mitigate")
    assert body["review_date"].startswith("2027-03-31") and body["due_date"].startswith("2027-02-28")
    assert http.put(f"/erm/risks/{body['id']}", json={"target_impact": 3}).json()["target_score"] == 6
    assert http.put(f"/risks/{body['id']}", json={"target_likelihood": 1}).json()["target_score"] == 3
    assert http.put(f"/erm/risks/{body['id']}", json={"response": "ignore"}).status_code == 422
    assert http.put(f"/erm/risks/{body['id']}", json={"target_impact": 6}).status_code == 422


def test_a_score_edit_records_the_reason_and_who(db):
    risk_id = add(db, inherent_likelihood=2, inherent_impact=2, inherent_score=4)
    http = client(db)
    got = http.put(f"/erm/risks/{risk_id}", json={"inherent_likelihood": 4, "reason": "Two outages this quarter"})
    assert got.status_code == 200, got.text
    [row] = db.query(RiskScoreHistory).all()
    assert (row.inherent_score, row.reason, row.changed_by) == (8, "Two outages this quarter", EDITOR)
    # a change that touches no score adds no score row; a title alone is not tracked at all
    http.put(f"/erm/risks/{risk_id}", json={"owner_id": APPROVER})
    http.put(f"/erm/risks/{risk_id}", json={"title": "Core ledger outage"})
    assert db.query(RiskScoreHistory).count() == 1
    assert db.query(AuditLog).filter_by(resource_type="risk", resource_id=risk_id).count() == 2


def test_history_returns_changes_and_scores_newest_first(db):
    risk_id = add(db, inherent_likelihood=2, inherent_impact=2, inherent_score=4)
    http = client(db)
    http.put(f"/erm/risks/{risk_id}", json={"inherent_likelihood": 4, "reason": "Two outages"})
    http.put(f"/risks/{risk_id}", json={"category": "technology", "reason": "It is a systems risk"})
    http.post(f"/erm/risks/{risk_id}/assess", json={"inherent_likelihood": 5, "inherent_impact": 5, "reason": "Workshop"})
    http.post(f"/erm/risks/{risk_id}/treatment", json={"treatment_plan": "Second data centre"})
    got = client(db, "viewer").get(f"/erm/risks/{risk_id}/history")
    assert got.status_code == 200, got.text
    body = got.json()
    assert [c["reason"] for c in body["changes"]] == [None, "Workshop", "It is a systems risk", "Two outages"]
    assert body["changes"][-1]["changes"]["inherent_likelihood"] == {"from": 2, "to": 4}
    assert body["changes"][-1]["user_name"] == "Editor"
    assert body["changes"][0]["changes"]["status"]["to"] == "in_treatment"
    assert body["people"][str(EDITOR)] == "Editor"
    assert body["changes"][2]["changes"]["category"] == {"from": "operational", "to": "technology"}
    assert [s["reason"] for s in body["scores"]] == ["Workshop", "Two outages"]
    assert body["scores"][0]["inherent_score"] == 25


def test_acceptance_needs_a_second_person(db):
    risk_id = add(db, status="in_treatment")
    editor, approver = client(db), client(db, "approver")
    asked = editor.post(f"/erm/risks/{risk_id}/acceptance/request",
                        json={"reason": "Cost of control exceeds the loss", "expires_at": in_days(180)})
    assert asked.status_code == 200, asked.text
    assert (asked.json()["response"], asked.json()["acceptance_status"], asked.json()["acceptance_state"]) == (
        "accept", "requested", "requested")
    assert asked.json()["acceptance_requested_by"] == EDITOR
    # the requester holds the edit right that approves, but cannot approve their own request
    mine = editor.post(f"/erm/risks/{risk_id}/acceptance/approve", json={"note": "fine"})
    assert mine.status_code == 409, mine.text
    assert client(db, "viewer").post(f"/erm/risks/{risk_id}/acceptance/approve", json={}).status_code == 403
    done = approver.post(f"/erm/risks/{risk_id}/acceptance/approve", json={"note": "Within appetite for 6 months"})
    assert done.status_code == 200, done.text
    body = done.json()
    assert (body["status"], body["acceptance_status"], body["acceptance_state"], body["accepted_by"]) == (
        "accepted", "approved", "accepted", APPROVER)
    detail = client(db, "viewer").get(f"/risks/{risk_id}/detail").json()
    assert (detail["acceptance_requested_by_name"], detail["accepted_by_name"]) == ("Editor", "Approver")
    # nothing is waiting any more
    assert approver.post(f"/erm/risks/{risk_id}/acceptance/approve", json={}).status_code == 409
    actions = [r.action for r in db.query(AuditLog).filter_by(resource_type="risk", resource_id=risk_id)]
    assert actions == ["risk_acceptance_requested", "risk_acceptance_approved"]


def test_an_acceptance_request_needs_a_reason_and_an_expiry_within_twelve_months(db):
    risk_id = add(db)
    http = client(db)
    url = f"/erm/risks/{risk_id}/acceptance/request"
    assert http.post(url, json={"reason": "x"}).status_code == 422
    assert http.post(url, json={"reason": "", "expires_at": in_days(30)}).status_code == 422
    assert http.post(url, json={"reason": "x", "expires_at": in_days(-1)}).status_code == 400
    assert http.post(url, json={"reason": "x", "expires_at": in_days(400)}).status_code == 400
    assert client(db, "viewer").post(url, json={"reason": "x", "expires_at": in_days(30)}).status_code == 403
    assert db.get(Risk, risk_id).acceptance_status is None


def test_a_refused_acceptance_returns_the_risk_to_treatment(db):
    risk_id = add(db, status="open")
    client(db).post(f"/erm/risks/{risk_id}/acceptance/request", json={"reason": "Low impact", "expires_at": in_days(90)})
    approver = client(db, "approver")
    assert approver.post(f"/erm/risks/{risk_id}/acceptance/reject", json={}).status_code == 422  # a refusal says why
    got = approver.post(f"/erm/risks/{risk_id}/acceptance/reject", json={"note": "Above appetite"})
    assert got.status_code == 200, got.text
    assert (got.json()["status"], got.json()["acceptance_status"], got.json()["acceptance_state"]) == (
        "in_treatment", "rejected", "none")


def test_accepted_cannot_be_set_directly(db):
    risk_id = add(db, status="open")
    http = client(db)
    for api in ("/erm/risks", "/risks"):
        got = http.put(f"{api}/{risk_id}", json={"status": "accepted"})
        assert got.status_code == 409 and "Request acceptance instead" in got.text
    assert db.get(Risk, risk_id).status == "open"
    # a risk already accepted can be saved with its status as it is
    accepted = add(db, "Accepted one", status="accepted")
    assert http.put(f"/erm/risks/{accepted}", json={"status": "accepted", "title": "Renamed"}).status_code == 200


def test_expiring_and_expired_are_derived_on_read(db):
    def accepted(title, days):
        return add(db, title, status="accepted", response="accept", acceptance_status="approved",
                   accepted_by=APPROVER, acceptance_expires_at=datetime.utcnow() + timedelta(days=days))
    far, soon, gone = accepted("Far", 200), accepted("Soon", 30), accepted("Gone", -1)
    add(db, "Accepted with no approval", status="accepted")
    http = client(db, "viewer")
    states = {r["title"]: r["acceptance_state"] for r in http.get("/erm/risks").json()}
    assert states == {"Far": "accepted", "Soon": "expiring", "Gone": "expired", "Accepted with no approval": "none"}
    assert http.get(f"/risks/{gone}/detail").json()["acceptance_state"] == "expired"
    dash = http.get("/erm/risks/dashboard").json()
    assert (dash["acceptances_expiring"], dash["acceptances_expired"]) == (1, 1)
    # reading writes nothing
    assert db.get(Risk, gone).status == "accepted" and db.get(Risk, far).acceptance_status == "approved"
    assert db.get(Risk, soon).acceptance_status == "approved"


def test_deleting_a_risk_keeps_an_audit_snapshot(db):
    first, second = add(db, "Ledger outage", inherent_score=12), add(db, "Branch fire")
    http = client(db)
    assert http.delete(f"/erm/risks/{first}").status_code == 204
    assert http.delete(f"/risks/{second}").status_code == 204
    assert db.query(Risk).count() == 0
    rows = db.query(AuditLog).filter_by(resource_type="risk", action="risk_deleted").order_by(AuditLog.id).all()
    assert [r.changes["snapshot"]["title"] for r in rows] == ["Ledger outage", "Branch fire"]
    assert rows[0].changes["snapshot"]["inherent_score"] == 12 and rows[0].user_id == EDITOR
