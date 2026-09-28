"""How often suppliers are checked and how a scan scores are the tenant's to set,
and a supplier record carries the tenant's own fields.

The shipped numbers stay the defaults. A tenant's scan cadence decides when the
runner scans next; its points, category cap and grade bands decide a supplier's
score and grade everywhere the score is shown. Points must fall with severity
and grades with score. A supplier's own fields are checked like any other
module's: a required one must be filled, and an update touches only what it sends.
"""
from datetime import datetime, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, ModuleSettings, Tenant, TPRASurfaceScan, TPRATieringConfig, Vendor, get_db
from grc.modules.vendor_risk.routers import vendors as vendors_router
from grc.modules.vendor_risk.tpra import api as tpra_api
from grc.modules.vendor_risk.tpra import monitoring_connectors as feeds
from grc.modules.vendor_risk.tpra import monitoring_policy, outside_in, rbac
from grc.routers.auth_router import require_auth

NOW = datetime.utcnow().replace(microsecond=0)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="owner", email="owner@acme.test", is_active=True))
    s.add(Vendor(id=1, tenant_id=1, name="Payroll Co", status="active", tier="critical", owner_id=7,
                 website="https://payroll.test"))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    monkeypatch.setattr(tpra_api, "get_user_tenants", lambda user, db: [1])
    monkeypatch.setattr(vendors_router, "get_user_tenants", lambda user, db: [1])
    app = FastAPI()
    app.include_router(tpra_api.router)
    app.include_router(vendors_router.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def _f(key, severity, category="web"):
    return {"key": key, "severity": severity, "category": category, "host": "payroll.test", "title": key}


def test_a_scan_is_scored_by_the_tenants_points_cap_and_grades():
    findings = [_f("tls_expired", "high", "tls")] + [_f(f"cve:{i}", "critical", "vulns") for i in range(3)]
    assert outside_in.score(findings, [], NOW.date()) == outside_in.score(findings, [], NOW.date(), monitoring_policy.merged(None))
    shipped = outside_in.score(findings, [], NOW.date())
    assert (shipped["score"], shipped["grade"]) == (100 - 15 - 40, "F")
    strict = monitoring_policy.merged({"scan_points": {"high": 5}, "scan_category_cap": 20,
                                       "grades": {"A": 95, "B": 85, "C": 75, "D": 60}})
    mine = outside_in.score(findings, [], NOW.date(), strict)
    assert (mine["score"], mine["grade"]) == (100 - 5 - 20, "C")
    assert monitoring_policy.grade(95, strict["grades"]) == "A" and monitoring_policy.grade(59, strict["grades"]) == "F"


def test_the_tenants_settings_are_checked(db, http):
    got = http.get("/tpra/config").json()
    assert got["monitoring_policy"]["scan_every_days"] == monitoring_policy.SCAN_EVERY_DAYS
    assert got["defaults"]["monitoring_policy"]["grades"] == monitoring_policy.GRADES
    for bad in ({"scan_points": {"low": 99}}, {"grades": {"C": 85}}, {"check_every_days": {"low": 0}},
                {"scan_every_days": {"urgent": 3}}, {"scan_category_cap": 0}, {"guesswork": True}):
        assert http.put("/tpra/config", json={"monitoring_policy": bad}).status_code == 400, bad
    saved = http.put("/tpra/config", json={"monitoring_policy": {"outside_in": True, "scan_every_days": {"critical": 2},
                                                                 "grades": {"A": 95}}})
    assert saved.status_code == 200
    policy = saved.json()["monitoring_policy"]
    assert policy["outside_in"] is True and policy["scan_every_days"]["critical"] == 2
    assert policy["grades"] == {"A": 95, "B": 80, "C": 70, "D": 55} and policy["adverse_media"] is False


def test_the_runner_scans_on_the_tenants_cadence(db, monkeypatch):
    db.add(TPRATieringConfig(tenant_id=1, config_key="default", is_active=True,
                             monitoring_policy={"outside_in": True, "scan_every_days": {"critical": 2}}))
    db.commit()
    host = [{"fqdn": "payroll.test", "live": True, "tls_expires": "2027-01-01"}]
    monkeypatch.setattr(outside_in, "scan_facts", lambda domains, sources=None: (host, []))
    monkeypatch.setattr(outside_in, "_sources", lambda db, tid: {})
    feeds.run_connectors(db, 1, now=NOW)
    feeds.run_connectors(db, 1, now=NOW + timedelta(days=1))           # not yet: every two days
    db.commit()
    assert db.query(TPRASurfaceScan).count() == 1
    feeds.run_connectors(db, 1, now=NOW + timedelta(days=3))           # the shipped default would wait a week
    db.commit()
    assert db.query(TPRASurfaceScan).count() == 2


def test_a_supplier_carries_the_tenants_own_fields(db, http):
    db.add(ModuleSettings(tenant_id=1, module_key="vendors", config={"fields": [
        {"key": "cost_centre", "label": "Cost centre", "type": "text", "required": True, "options": [], "order": 1},
        {"key": "sanctions_check", "label": "Sanctions screened", "type": "checkbox", "required": False, "options": [], "order": 2},
    ]}))
    db.commit()
    missing = http.post("/vendors", json={"name": "Print Co", "custom_values": {"sanctions_check": True}})
    assert missing.status_code == 400 and "Cost centre" in missing.json()["detail"]
    made = http.post("/vendors", json={"name": "Print Co", "custom_values": {"cost_centre": "CC-12"}})
    assert made.status_code == 201, made.text
    assert made.json()["custom_values"] == {"cost_centre": "CC-12"}
    vid = made.json()["id"]
    changed = http.put(f"/vendors/{vid}", json={"custom_values": {"sanctions_check": "yes"}}).json()
    assert changed["custom_values"] == {"cost_centre": "CC-12", "sanctions_check": True}
    assert http.put(f"/vendors/{vid}", json={"custom_values": {"nope": 1}}).status_code == 400
    legacy = http.post("/vendors", json={"name": "Old Screen Co"})           # a screen that sends no values
    assert legacy.status_code == 201 and legacy.json()["custom_values"] == {}
