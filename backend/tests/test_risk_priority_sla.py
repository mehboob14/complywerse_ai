"""A risk has a priority, and the Risk Register SLA (Settings tab) follows it.

The priority is the one a person set, or - left on "auto" - the band the risk's score falls in (the same bands the
register dashboard uses). The list says where each risk stands against the SLA for that priority.
"""
import importlib
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Risk, Tenant, get_db
from grc.models._11_enterprise_risk_management import risk_priority_for_score
from grc.routers.auth_router import require_auth
from grc.services import module_settings

# the module itself: the package re-exports its APIRouter under a similar name
risks = importlib.import_module("grc.modules.erm.routers.risks")


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add(GRCUser(id=7, username="officer", display_name="Officer", email="officer@bank.test", is_active=True))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db):
    app = FastAPI()
    app.include_router(risks.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def listed(http):
    return {r["title"]: r for r in http.get("/risks").json()}


def test_the_score_bands_are_the_dashboards():
    assert [risk_priority_for_score(s) for s in (None, 0, 1, 5, 6, 11, 12, 19, 20, 25)] == [
        None, None, "low", "low", "medium", "medium", "high", "high", "critical", "critical"]


def test_the_priority_is_the_one_set_or_the_one_the_score_gives(db, http):
    made = http.post("/risks", json={"title": "Ransomware", "category": "technology", "residual_likelihood": 5,
                                     "residual_impact": 5, "inherent_likelihood": 5, "inherent_impact": 5})
    assert made.status_code == 201, made.text
    assert made.json()["priority"] is None and made.json()["effective_priority"] == "critical"

    # residual wins over inherent; with no residual the inherent score is used
    http.post("/risks", json={"title": "Vendor outage", "category": "third_party", "inherent_likelihood": 4,
                              "inherent_impact": 4, "residual_likelihood": 2, "residual_impact": 3})
    http.post("/risks", json={"title": "Untreated", "category": "operational", "inherent_likelihood": 3, "inherent_impact": 4})
    rows = listed(http)
    assert rows["Vendor outage"]["effective_priority"] == "medium"
    assert rows["Untreated"]["effective_priority"] == "high"

    # a person's choice wins, and "auto" hands it back to the score
    risk_id = rows["Vendor outage"]["id"]
    got = http.put(f"/risks/{risk_id}", json={"priority": "Critical"}).json()
    assert got["priority"] == "critical" and got["effective_priority"] == "critical"
    got = http.put(f"/risks/{risk_id}", json={"priority": "auto"}).json()
    assert got["priority"] is None and got["effective_priority"] == "medium"
    http.put(f"/risks/{risk_id}", json={"priority": "high"})
    got = http.put(f"/risks/{risk_id}", json={"priority": ""}).json()        # what the form sends for "Auto"
    assert got["priority"] is None and got["effective_priority"] == "medium"
    assert http.put(f"/risks/{risk_id}", json={"priority": "urgent"}).status_code == 400
    assert http.post("/risks", json={"title": "x", "category": "operational", "priority": "urgent"}).status_code == 400
    assert http.post("/risks", json={"title": "Chosen", "category": "operational", "priority": "low"}).json()["priority"] == "low"


def test_the_list_says_where_each_risk_stands_against_the_sla(db, http):
    def add(title, **fields):
        db.add(Risk(tenant_id=1, title=title, category="operational", **fields))
    add("New critical", residual_score=25, created_at=datetime.utcnow())
    add("Old and low", priority="low", created_at=datetime.utcnow() - timedelta(days=100))
    add("Closed long ago", priority="low", status="closed", created_at=datetime.utcnow() - timedelta(days=400))
    add("Dated", priority="high", due_date=datetime.utcnow() + timedelta(days=2), created_at=datetime.utcnow() - timedelta(days=300))
    add("No score at all", created_at=datetime.utcnow())
    db.commit()
    rows = listed(http)

    new = rows["New critical"]["sla"]
    assert new["target_days"] == 14 and new["implied_due_date"] and new["state"] == "on_track"
    old = rows["Old and low"]["sla"]
    assert old["target_days"] == 90 and old["state"] == "breached" and old["days_overdue"] in (10, 11)
    assert rows["Closed long ago"]["sla"]["state"] == "closed"
    dated = rows["Dated"]["sla"]
    assert dated["target_days"] == 30 and not dated["implied_due_date"] and dated["state"] == "due_soon"
    assert rows["No score at all"]["effective_priority"] is None and rows["No score at all"]["sla"]["state"] == "no_due_date"


def test_the_settings_tab_sla_table_is_what_the_register_measures_against(db, http):
    db.add(Risk(tenant_id=1, title="High one", category="operational", priority="high", created_at=datetime.utcnow() - timedelta(days=10)))
    db.commit()
    assert listed(http)["High one"]["sla"]["state"] == "on_track"                      # 30 days by default
    module_settings.save_settings(db, 1, "risks", {"sla": {"targets": {"high": {"days": 5}}}}, user_id=7)
    sla = listed(http)["High one"]["sla"]
    assert sla["target_days"] == 5 and sla["state"] == "breached" and sla["days_overdue"] == 5
