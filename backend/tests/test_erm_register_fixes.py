"""Risk Register defects (2026-11-11): what the register's own pages already meant to do.

Score edits were dropped by PUT, /aging was taken for a risk id, a second mitigation-action route saved actions as "pending"
(which no open or overdue count reads), the list stopped at 100 risks, unscored risks counted as Low, a treatment set a
status the register does not list, the legacy detail left out the template fields, and any signed-in user could write.
Runs through the real /erm router (its include order is what shadowed routes). In-memory SQLite.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, GRCUser, IssueAction, Permission, Risk, Role, RolePermission, Tenant, UserRole,
                        get_db)
from grc.modules.erm.router import router as erm_router
from grc.modules.erm.routers import mitigation_actions
from grc.routers.auth_router import create_access_token, require_auth
from grc.routers.risks_router import router as legacy_router

OFFICER, VIEWER = 7, 8


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add_all([Role(id=1, name="Administrator"), Role(id=2, name="Risk viewer")])
    s.add(Permission(id=1, name="erm:risks:view", resource="erm:risks", action="view"))
    s.add(RolePermission(role_id=2, permission_id=1))
    s.add_all([GRCUser(id=OFFICER, username="officer", display_name="Officer", email="officer@bank.test", is_active=True),
               GRCUser(id=VIEWER, username="viewer", display_name="Viewer", email="viewer@bank.test", is_active=True)])
    s.add_all([UserRole(user_id=OFFICER, role_id=1, tenant_id=1), UserRole(user_id=VIEWER, role_id=2, tenant_id=1)])
    s.commit()
    yield s
    s.close()


def client(db, username="officer"):
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


def test_editing_scores_saves_them_and_rederives_the_score(db):
    http = client(db)
    risk_id = http.post("/erm/risks", json={"title": "Ledger outage", "category": "operational",
                                            "inherent_likelihood": 2, "inherent_impact": 2}).json()["id"]
    got = http.put(f"/erm/risks/{risk_id}", json={"inherent_likelihood": 4, "inherent_impact": 5,
                                                  "residual_likelihood": 2, "residual_impact": 3,
                                                  "due_date": "2027-01-31T00:00:00"})
    assert got.status_code == 200, got.text
    body = got.json()
    assert (body["inherent_likelihood"], body["inherent_impact"], body["inherent_score"]) == (4, 5, 20)
    assert (body["residual_likelihood"], body["residual_impact"], body["residual_score"]) == (2, 3, 6)
    assert body["due_date"].startswith("2027-01-31")
    # one side alone re-derives from what is stored; a score sent wins, as on create
    assert http.put(f"/erm/risks/{risk_id}", json={"inherent_impact": 3}).json()["inherent_score"] == 12
    assert http.put(f"/erm/risks/{risk_id}", json={"residual_score": 4.5}).json()["residual_score"] == 4.5
    assert http.put(f"/erm/risks/{risk_id}", json={"title": "Renamed"}).json()["residual_score"] == 4.5
    assert http.put(f"/erm/risks/{risk_id}", json={"inherent_likelihood": 6}).status_code == 422
    # the legacy API takes the same edit
    assert http.put(f"/risks/{risk_id}", json={"inherent_likelihood": 5}).json()["inherent_score"] == 15


def test_a_score_outside_the_scale_is_refused(db):
    risk_id = add(db)
    http = client(db)
    assert http.put(f"/erm/risks/{risk_id}", json={"inherent_score": 1e9}).status_code == 422
    assert http.put(f"/erm/risks/{risk_id}", json={"residual_score": -5}).status_code == 422


def test_aging_is_its_own_route(db):
    add(db, created_at=datetime.utcnow() - timedelta(days=10))
    got = client(db).get("/erm/risks/aging")
    assert got.status_code == 200, got.text
    assert got.json()[0]["days_since_created"] == 10


def test_a_mitigation_action_added_from_a_risk_is_open_and_counts_as_overdue(db):
    http = client(db)
    risk_id = add(db)
    made = http.post(f"/erm/risks/{risk_id}/mitigation-actions", json={
        "title": "Patch the ledger", "due_date": (datetime.utcnow() - timedelta(days=1)).isoformat()})
    assert made.status_code == 201, made.text
    assert made.json()["status"] in mitigation_actions.OPEN_STATUSES
    assert db.query(IssueAction).one().status == "planned"     # a CAPA action since wave 2-E
    queue = http.get("/erm/dashboard/sections-overview").json()["attention_queue"]
    assert queue["overdue_mitigation_actions"] == 1
    listed = http.get(f"/erm/risks/{risk_id}/mitigation-actions").json()
    assert [a["title"] for a in listed] == ["Patch the ledger"]
    assert http.get("/erm/risks").json()[0]["mitigation_action_count"] == 1


def test_unscored_risks_are_not_counted_as_low(db):
    add(db, "Scored low", inherent_score=4)
    add(db, "Scored high", inherent_score=16, residual_score=12)
    add(db, "Never scored")
    http = client(db)
    assert http.get("/erm/risks/dashboard").json()["by_score_range"] == {
        "critical": 0, "high": 1, "medium": 0, "low": 1, "unscored": 1}
    [register] = http.get("/erm/risks/dashboard/by-register").json()["registers"]
    assert register["by_score_range"] == {"critical": 0, "high": 1, "medium": 0, "low": 1, "unscored": 1}


def test_the_list_returns_the_whole_register(db):
    db.add_all([Risk(tenant_id=1, title=f"Risk {n}", category="operational") for n in range(150)])
    db.commit()
    assert len(client(db).get("/erm/risks").json()) == 150


def test_a_treatment_puts_the_risk_in_treatment(db):
    http = client(db)
    first, second = add(db, "One"), add(db, "Two")
    assert http.post(f"/erm/risks/{first}/treatment", json={"treatment_plan": "Add a control"}).json()["status"] == "in_treatment"
    assert http.post(f"/risks/{second}/treatment", json={"treatment_plan": "Add a control"}).json()["status"] == "in_treatment"


def test_the_legacy_detail_carries_the_register_template(db):
    risk_id = add(db, register_type="NCA Template", template_fields={"threat": "Insider"})
    body = client(db).get(f"/risks/{risk_id}/detail").json()
    assert (body["register_type"], body["template_fields"]) == ("NCA Template", {"threat": "Insider"})


def test_a_view_only_user_cannot_write(db):
    risk_id = add(db)
    http = client(db, "viewer")
    assert http.get("/erm/risks").status_code == 200
    assert http.post("/erm/risks", json={"title": "x", "category": "operational"}).status_code == 403
    assert http.put(f"/erm/risks/{risk_id}", json={"title": "y"}).status_code == 403
    assert http.delete(f"/erm/risks/{risk_id}").status_code == 403
    assert http.post(f"/erm/risks/{risk_id}/close").status_code == 403
    assert http.post(f"/erm/risks/{risk_id}/assess", json={"inherent_likelihood": 1, "inherent_impact": 1}).status_code == 403
    assert http.post(f"/erm/risks/{risk_id}/treatment", json={"treatment_plan": "z"}).status_code == 403
    assert db.get(Risk, risk_id).title == "Ledger outage" and db.query(Risk).count() == 1
    # scales, scorecard weights and stored reports are writes too (found by the security review)
    assert http.post("/erm/scales", json={"scale_type": "likelihood", "level": 6, "label": "x"}).status_code == 403
    assert http.post("/erm/scales/seed-defaults").status_code == 403
    assert http.put("/erm/dashboard/scorecard-config", json={}).status_code == 403
    assert http.post("/erm/reports/generate", json={"report_type": "executive"}).status_code == 403
    # linking a risk to other records is a write too, on both risk APIs
    for api in ("/erm/risks", "/risks"):
        assert http.post(f"{api}/{risk_id}/assets", json={"asset_id": 1}).status_code == 403
        assert http.post(f"{api}/{risk_id}/evidence", json={"evidence_id": 1}).status_code == 403
        assert http.delete(f"{api}/{risk_id}/controls/1").status_code == 403
