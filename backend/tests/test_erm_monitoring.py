"""The Risk Management monitoring pages' read lists (UX revamp, group `monitoring`): every mitigation action of the tenant in one request, the lean risk list
(no 100-risk cap), and the two names the KRI report gained. In-memory SQLite. Tenant scoping is the point: another tenant's rows never come back."""
import importlib
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, GRCUser, Risk, RiskKRI, RiskMitigationAction, Role, Tenant, UserRole, get_db)
from grc.modules.erm.routers import kris as kri_routes
from grc.modules.erm.routers import mitigation_actions as action_routes
from grc.modules.erm.routers import monitoring as monitoring_routes
from grc.routers.auth_router import require_auth

auth_router = importlib.import_module("grc.routers.auth_router")


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add_all([Tenant(id=1, name="Bank", slug="bank"), Tenant(id=2, name="Other", slug="other")])
    s.add(Role(id=1, name="Administrator"))
    s.add_all([GRCUser(id=7, username="officer", display_name="Olu Officer", email="o@bank.test", is_active=True),
               GRCUser(id=8, username="stranger", display_name="Sam Stranger", email="s@other.test", is_active=True)])
    s.add_all([UserRole(user_id=7, role_id=1, tenant_id=1), UserRole(user_id=8, role_id=1, tenant_id=2)])
    s.commit()
    yield s
    s.close()


def client(db, username="officer"):
    app = FastAPI()
    app.include_router(action_routes.router, prefix="/erm")
    app.include_router(kri_routes.router, prefix="/erm")
    app.include_router(monitoring_routes.router, prefix="/erm")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    return TestClient(app)


def risk(db, tenant=1, title="Risk", **kw):
    r = Risk(tenant_id=tenant, title=title, category=kw.pop("category", "operational"), status="open", **kw)
    db.add(r)
    db.commit()
    return r


def test_every_action_of_the_tenant_comes_in_one_request_with_risk_title_and_owner(db):
    first, second = risk(db, title="Phishing"), risk(db, title="Outage")
    foreign = risk(db, tenant=2, title="Not ours")
    for i, r in enumerate([first, first, second, foreign]):
        db.add(RiskMitigationAction(risk_id=r.id, title=f"Action {i}", status="open", owner_id=7 if i == 0 else None,
                                    due_date=datetime.utcnow() + timedelta(days=i)))
    db.commit()
    body = client(db).get("/erm/mitigation-actions").json()
    assert body["total"] == 3 and [a["title"] for a in body["items"]] == ["Action 0", "Action 1", "Action 2"]
    assert body["items"][0]["risk_title"] == "Phishing" and body["items"][0]["owner_name"] == "Olu Officer"
    assert body["items"][2]["risk_title"] == "Outage" and body["items"][2]["owner_name"] is None
    assert all(a["evidence_count"] == 0 for a in body["items"])


def test_the_list_filters_and_reports_the_real_total_when_it_is_cut(db):
    r = risk(db)
    for i in range(7):
        db.add(RiskMitigationAction(risk_id=r.id, title=f"A{i}", status="completed" if i % 2 else "open"))
    db.commit()
    http = client(db)
    assert http.get("/erm/mitigation-actions", params={"status_filter": "completed"}).json()["total"] == 3
    cut = http.get("/erm/mitigation-actions", params={"limit": 2}).json()
    assert cut["total"] == 7 and len(cut["items"]) == 2


def test_the_lean_risk_list_has_every_risk_not_the_newest_hundred(db):
    for i in range(130):
        risk(db, title=f"R{i}", residual_score=float(i % 25), inherent_score=25.0, inherent_likelihood=5, inherent_impact=5)
    risk(db, tenant=2, title="Foreign")
    body = client(db).get("/erm/monitoring/risks").json()
    assert body["total"] == 130 and len(body["items"]) == 130
    first = body["items"][0]
    assert first["title"] == "R0" and first["inherent_likelihood"] == 5 and first["category"] == "operational"
    assert [r["id"] for r in body["items"]] == sorted(r["id"] for r in body["items"])


def test_the_kri_report_names_the_linked_risk_and_the_owner(db, monkeypatch):
    r = risk(db, title="Data loss")
    db.add(RiskKRI(tenant_id=1, risk_id=r.id, owner_id=7, name="Backups failing", metric_type="count", threshold_direction="lower_is_better",
                   frequency="monthly", green_threshold=1, amber_threshold=3, current_value=5, is_active=True, kind="kri"))
    db.add(RiskKRI(tenant_id=1, name="Standalone", metric_type="count", threshold_direction="lower_is_better", frequency="monthly", is_active=True, kind="kri"))
    db.commit()
    items = client(db).get("/erm/kris/report", params={"kind": "kri"}).json()["kris"]
    by_name = {k["name"]: k for k in items}
    assert by_name["Backups failing"]["risk_title"] == "Data loss" and by_name["Backups failing"]["owner_name"] == "Olu Officer"
    assert by_name["Backups failing"]["current_status"] == "red"
    assert by_name["Standalone"]["risk_title"] is None and by_name["Standalone"]["owner_name"] is None
