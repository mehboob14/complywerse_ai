"""Scenario Analysis (wave 4, L1): a saved scenario estimated in a currency, run on the FAIR / Monte Carlo engine,
compared with appetite, approved by a second person, with agreed actions on its risks.

Runs through the real /erm router as non-admin risk managers (maker-checker has no admin exception). In-memory SQLite.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, GRCUser, Issue, IssueAction, Permission, Risk, RiskAppetiteConfig, RiskKRI, Role,
                        RolePermission, Tenant, UserRole, get_db)
from grc.modules.erm.quantification.engine import ENGINE_VERSION, simulate
from grc.modules.erm.router import router as erm_router
from grc.modules.erm.routers.scenarios import approved_scenarios
from grc.routers.auth_router import create_access_token, require_auth

MAKER, CHECKER, THIRD, VIEWER = 11, 12, 13, 14


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add_all([Tenant(id=1, name="Bank", slug="bank"), Tenant(id=2, name="Other", slug="other")])
    s.add_all([Role(id=1, name="Risk manager"), Role(id=2, name="Risk viewer")])
    perms = ["erm:risks:view", "erm:risks:create", "erm:risks:edit"]
    s.add_all([Permission(id=i + 1, name=p, resource="erm:risks", action=p.split(":")[-1]) for i, p in enumerate(perms)])
    s.add_all([RolePermission(role_id=1, permission_id=i + 1) for i in range(3)] + [RolePermission(role_id=2, permission_id=1)])
    for uid, name, role in ((MAKER, "maker", 1), (CHECKER, "checker", 1), (THIRD, "third", 1), (VIEWER, "viewer", 2)):
        s.add(GRCUser(id=uid, username=name, display_name=name.title(), email=f"{name}@bank.test", is_active=True))
        s.add(UserRole(user_id=uid, role_id=role, tenant_id=1))
    s.commit()
    yield s
    s.close()


def client(db, username="maker"):
    app = FastAPI()
    app.include_router(erm_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def risk(db, title="Payments outage", tenant_id=1, category="operational"):
    row = Risk(tenant_id=tenant_id, title=title, category=category, risk_category=category, residual_score=12)
    db.add(row)
    db.commit()
    return row.id


ESTIMATES = {"currency": "GBP", "one_in_years": 5, "loss_typical": 200_000, "loss_severe": 4_000_000,
             "workshop_notes": "Payments ops and IT: a full-day outage roughly once in five years."}


def scenario(http, risk_ids, **extra):
    got = http.post("/erm/scenarios", json={"title": "Card payments down for a day", "risk_ids": risk_ids,
                                            **ESTIMATES, **extra})
    assert got.status_code == 201, got.text
    return got.json()


def run(http, scenario_id, iterations=2000):
    got = http.post(f"/erm/scenarios/{scenario_id}/run", json={"iterations": iterations})
    assert got.status_code == 200, got.text
    return got.json()


def test_a_scenario_links_risks_in_the_tenant_only(db):
    mine, theirs = risk(db), risk(db, "Elsewhere", tenant_id=2)
    http = client(db)
    made = scenario(http, [mine])
    assert made["status"] == "draft"
    assert [r["title"] for r in made["risks"]] == ["Payments outage"]
    assert made["frequency_per_year"] == pytest.approx(0.2)      # 1 in 5 years
    assert http.post("/erm/scenarios", json={"title": "X", "risk_ids": [mine, theirs]}).status_code == 422
    assert http.post("/erm/scenarios", json={"title": "X", "risk_ids": [999]}).status_code == 422
    assert client(db, "viewer").post("/erm/scenarios", json={"title": "X"}).status_code == 403


def test_run_stores_the_engine_result_in_the_scenario_currency_and_keeps_the_previous_time(db):
    http = client(db)
    made = scenario(http, [risk(db)])
    first = run(http, made["id"])
    result = first["result"]
    assert first["status"] == "estimated"
    assert result["currency"] == "GBP" and result["engine_version"] == ENGINE_VERSION and result["iterations"] == 2000
    assert result["one_in_100"] >= result["one_in_20"] > 0
    # the real engine: the same inputs and seed give the same figures
    again = simulate({"tef": (0.2, 0.2, 0.2), "pos": (1.0, 1.0, 1.0),
                      "components": [{"key": "loss", "label": "Loss per event", "min": 0.0, "ml": 200_000.0,
                                      "max": 4_000_000.0, "probability": 1.0}]},
                     iterations=2000, seed=result["seed"])
    assert (result["mean"], result["one_in_20"], result["one_in_100"]) == (again["ale_mean"], again["p95"], again["p99"])
    assert first["previous_run_at"] is None and first["last_run_at"]

    second = run(http, made["id"])
    assert second["previous_run_at"] == first["last_run_at"]
    [row] = http.get("/erm/scenarios").json()
    assert (row["status"], row["currency"], row["severe_loss"]) == ("estimated", "GBP", second["result"]["one_in_100"])
    assert row["last_run_at"] == second["last_run_at"]


def test_run_needs_the_estimates_and_the_workshop_reasoning(db):
    http = client(db)
    bare = http.post("/erm/scenarios", json={"title": "Not estimated yet"}).json()
    assert http.post(f"/erm/scenarios/{bare['id']}/run", json={}).status_code == 422
    noted = scenario(http, [], workshop_notes="")
    assert http.post(f"/erm/scenarios/{noted['id']}/run", json={}).status_code == 422
    assert http.post("/erm/scenarios", json={"title": "Bad", "loss_typical": 5, "loss_severe": 1}).status_code == 422


def test_changing_the_inputs_after_a_run_asks_for_a_new_run(db):
    http = client(db)
    made = scenario(http, [risk(db)])
    run(http, made["id"])
    assert http.put(f"/erm/scenarios/{made['id']}", json={"title": "Renamed"}).json()["status"] == "estimated"
    edited = http.put(f"/erm/scenarios/{made['id']}", json={"loss_severe": 6_000_000}).json()
    assert edited["status"] == "draft" and edited["result"] is not None


def test_appetite_comparison_says_when_no_loss_tolerance_is_set(db):
    http = client(db)
    made = scenario(http, [risk(db)])
    detail = run(http, made["id"])
    assert detail["appetite"] == [{"category": "operational", "tolerance": None, "reason": "No loss tolerance set"}]
    # a score tolerance is not a money tolerance
    db.add(RiskAppetiteConfig(tenant_id=1, category="operational", max_acceptable_score=12, tolerance_threshold=15))
    db.commit()
    assert http.get(f"/erm/scenarios/{made['id']}").json()["appetite"][0]["tolerance"] is None


def test_appetite_comparison_uses_a_money_limit_in_the_scenario_currency(db):
    kri = RiskKRI(tenant_id=1, name="Operational losses", unit="GBP", amber_threshold=500_000,
                  threshold_direction="lower_is_better")
    db.add(kri)
    db.commit()
    db.add(RiskAppetiteConfig(tenant_id=1, category="operational", limit_kri_ids=[kri.id]))
    db.commit()
    http = client(db)
    made = scenario(http, [risk(db)])
    [row] = run(http, made["id"])["appetite"]
    assert (row["tolerance"], row["currency"], row["limit"]) == (500_000, "GBP", "Operational losses")
    assert row["severe_loss"] > 0 and row["within"] == (row["severe_loss"] <= 500_000)
    # a limit in another currency is not compared
    usd = scenario(http, [made["risks"][0]["id"]], currency="USD")
    assert run(http, usd["id"])["appetite"][0]["reason"] == "No loss tolerance set"


def test_the_estimator_and_the_reviewer_cannot_approve(db):
    maker = client(db)
    made = scenario(maker, [risk(db)])
    run(maker, made["id"])
    assert maker.post(f"/erm/scenarios/{made['id']}/approve", json={}).status_code == 409   # not reviewed yet
    reviewed = client(db, "checker").post(f"/erm/scenarios/{made['id']}/review", json={"note": "Compared with appetite"})
    assert reviewed.status_code == 200 and reviewed.json()["status"] == "reviewed"
    assert maker.post(f"/erm/scenarios/{made['id']}/approve", json={}).status_code == 409
    assert client(db, "checker").post(f"/erm/scenarios/{made['id']}/approve", json={}).status_code == 409
    assert maker.get(f"/erm/scenarios/{made['id']}").json()["can_approve"] is False
    third = client(db, "third")
    assert third.get(f"/erm/scenarios/{made['id']}").json()["can_approve"] is True
    approved = third.post(f"/erm/scenarios/{made['id']}/approve", json={})
    assert approved.status_code == 200, approved.text
    assert (approved.json()["status"], approved.json()["approved_by_name"]) == ("approved", "Third")
    [pack_row] = approved_scenarios(db, [1])
    assert pack_row["title"] == "Card payments down for a day" and pack_row["one_in_100"] >= pack_row["one_in_20"]


def test_a_scenario_can_be_sent_back_with_a_note(db):
    maker = client(db)
    made = scenario(maker, [risk(db)])
    run(maker, made["id"])
    client(db, "checker").post(f"/erm/scenarios/{made['id']}/review", json={})
    third = client(db, "third")
    assert third.post(f"/erm/scenarios/{made['id']}/send-back", json={"note": ""}).status_code == 422
    back = third.post(f"/erm/scenarios/{made['id']}/send-back", json={"note": "Severe loss ignores fines"}).json()
    assert (back["status"], back["review_note"], back["reviewed_by_name"]) == ("draft", "Severe loss ignores fines", None)


def test_an_approved_scenario_is_read_only_until_reopened_as_a_new_draft(db):
    maker = client(db)
    risk_id = risk(db)
    made = scenario(maker, [risk_id])
    run(maker, made["id"])
    client(db, "checker").post(f"/erm/scenarios/{made['id']}/review", json={})
    client(db, "third").post(f"/erm/scenarios/{made['id']}/approve", json={})
    assert maker.put(f"/erm/scenarios/{made['id']}", json={"title": "Changed"}).status_code == 409
    assert maker.post(f"/erm/scenarios/{made['id']}/run", json={}).status_code == 409
    assert maker.post(f"/erm/scenarios/{made['id']}/actions", json={"risk_id": risk_id, "title": "X"}).status_code == 409
    reopened = maker.post(f"/erm/scenarios/{made['id']}/reopen")
    assert reopened.status_code == 201, reopened.text
    draft = reopened.json()
    assert (draft["status"], draft["reopened_from_id"], draft["loss_severe"]) == ("draft", made["id"], 4_000_000)
    assert draft["id"] != made["id"] and draft["result"] is None
    assert maker.get(f"/erm/scenarios/{made['id']}").json()["status"] == "approved"


def test_an_agreed_action_lands_on_the_risk_treatment_issue(db):
    maker = client(db)
    risk_id, other = risk(db), risk(db, "Not linked")
    made = scenario(maker, [risk_id])
    added = maker.post(f"/erm/scenarios/{made['id']}/actions",
                       json={"risk_id": risk_id, "title": "Second card processor"})
    assert added.status_code == 201, added.text
    action = db.query(IssueAction).one()
    issue = db.get(Issue, action.issue_id)
    assert (issue.issue_type, issue.source_type, issue.source_id) == ("risk_treatment", "risk", risk_id)
    assert action.title == "Second card processor" and action.created_by == MAKER
    [listed] = maker.get(f"/erm/scenarios/{made['id']}").json()["actions"]
    assert (listed["id"], listed["risk_id"], listed["status"]) == (action.id, risk_id, "planned")
    assert maker.post(f"/erm/scenarios/{made['id']}/actions", json={"risk_id": other, "title": "X"}).status_code == 422
