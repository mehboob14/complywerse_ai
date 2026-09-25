"""Exposure as a range, and the suppliers our own discovery finds that nobody reviewed.

A number is only published with its range, the inputs that drove it and the
assumptions behind them. The same inputs give the same numbers, better controls
never cost more, and every change to the constants is audited. Shadow suppliers
come from software and assets we already discover, never from a paid feed.
"""
from datetime import date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (
    Base, BcmBiaDependency, BcmBiaRecord, BcmPlan, GRCUser, ITAsset, SoftwareIdentifier, Tenant, TPRAApproval,
    TPRAAuditLog, TPRAFinding, TPRAFourthParty, TPRAMonitoringSignal, TPRAPlatformAlias, TPRARemediation,
    TPRARiskAcceptance, TPRAStageInstance, TPRATieringConfig, TPRAVendorLink, Vendor, VendorAssessment,
    VendorIncident, VendorQuestionnaireResponse, get_db,
)
from grc.modules.vendor_risk.tpra import api as tpra_api
from grc.modules.vendor_risk.tpra import graph, quantification, rbac, reports
from grc.routers.auth_router import require_auth

_TABLES = [Tenant, GRCUser, Vendor, VendorAssessment, TPRAApproval, TPRAAuditLog, TPRATieringConfig, TPRAVendorLink,
           BcmPlan, BcmBiaRecord, BcmBiaDependency, TPRAFourthParty, TPRAPlatformAlias, ITAsset, SoftwareIdentifier,
           TPRAStageInstance, TPRAFinding, TPRARemediation, TPRARiskAcceptance, TPRAMonitoringSignal, VendorIncident,
           VendorQuestionnaireResponse]
CFG = quantification.merged(None)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine, tables=[m.__table__ for m in _TABLES])
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="a@x.test", is_active=True))
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def http(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(tpra_api.router)
    app.include_router(quantification.router)
    app.include_router(graph.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def _vendor(db, name, tier="high", access="confidential", rating="high"):
    v = Vendor(tenant_id=1, name=name, status="active", tier=tier, data_access_level=access, risk_rating=rating)
    db.add(v)
    db.flush()
    return v


def _process(db, vendor_name, criticality="critical", rto=4):
    plan = BcmPlan(tenant_id=1, title="Continuity")
    db.add(plan)
    db.flush()
    bia = BcmBiaRecord(tenant_id=1, plan_id=plan.id, process_name="Take card payments", criticality_rating=criticality,
                       rto_hours=rto)
    db.add(bia)
    db.flush()
    db.add(BcmBiaDependency(tenant_id=1, bia_id=bia.id, dependency_type="vendor", name=vendor_name))
    db.flush()


def _exposure(db, v):
    return quantification.quantify(v, reports.functions(db, 1, date.today(), [v]), CFG)


def test_every_number_comes_with_its_range_inputs_and_assumptions(db):
    v = _vendor(db, "Zenvia Payments Ltd")
    _process(db, "Zenvia Payments")
    db.commit()
    out = _exposure(db, v)
    year = out["annual"]
    assert 0 < year["chance"] < 1 and 0 < year["mean"] and year["p90"] <= year["p95"]
    data, outage = out["scenarios"]
    assert data["active"] and data["per_event"]["p10"] <= data["per_event"]["p50"] <= data["per_event"]["p90"]
    assert [i["factor"] for i in data["inputs"]] == ["Events a year", "Records exposed", "Cost per record",
                                                     "Response cost per event"]
    assert all(len(i["range"]) == 3 for s in out["scenarios"] for i in s["inputs"])
    assert outage["inputs"][2]["basis"] == "Take card payments is critical"
    assert "RTO of 4 h" in outage["inputs"][1]["basis"]
    assert out["assumptions"] and out["currency"] == "USD"


def test_the_same_inputs_give_the_same_numbers_and_better_controls_never_cost_more(db):
    v = _vendor(db, "Acme Hosting", rating="high")
    db.commit()
    first, second = _exposure(db, v), _exposure(db, v)
    assert first == second
    better = first["if_improved"]
    assert (better["rating_from"], better["rating_to"]) == ("high", "medium")
    assert better["annual"]["mean"] < first["annual"]["mean"]
    assert better["annual"]["p95"] <= first["annual"]["p95"] and better["annual"]["chance"] <= first["annual"]["chance"]
    v.risk_rating = "low"
    assert _exposure(db, v)["if_improved"] is None


def test_a_vendor_that_reaches_none_of_our_data_exposes_none(db):
    v = _vendor(db, "Catering Co", tier="low", access="none", rating="low")
    db.commit()
    data = _exposure(db, v)["scenarios"][0]
    assert not data["active"] and data["per_year"]["mean"] == 0 and data["note"]


def test_the_portfolio_ranks_the_worst_vendor_first_and_shows_in_the_pack(db):
    _vendor(db, "Catering Co", tier="low", access="none", rating="low")
    _vendor(db, "Core Banking Ltd", tier="critical", access="regulated", rating="critical")
    db.commit()
    book = quantification.portfolio(db, 1, CFG)
    assert [x["name"] for x in book["vendors"]] == ["Core Banking Ltd", "Catering Co"]
    assert book["annual"]["mean"] >= book["vendors"][0]["annual"]["mean"]
    assert any("independent" in a for a in book["assumptions"])
    pack = reports.committee_pack(db, 1, *reports.last_quarter(date.today()), date.today())
    exposure = next(s for s in pack["sections"] if s["key"] == "exposure")
    assert exposure["rows"][0][0] == "All vendors in use" and exposure["rows"][1][0] == "Core Banking Ltd"
    assert exposure["rows"][0][4].startswith("USD ")


def test_constants_are_checked_and_every_change_is_audited(db, http):
    for bad in ({"cost_per_record": [10, 5, 1]}, {"iterations": 500}, {"breach_per_year": {"critical": [1, 2, 99]}},
                {"control_effect": {"medium": 0}}, {"guesswork": 1}):
        assert http.put("/tpra/config", json={"quantification": bad}).status_code == 400, bad
    ok = http.put("/tpra/config", json={"quantification": {"cost_per_record": [30, 160, 500],
                                                           "control_effect": {"low": 0.5}}})
    assert ok.status_code == 200 and ok.json()["quantification"]["cost_per_record"] == [30, 160, 500]
    assert http.put("/tpra/config", json={"quantification": {"cost_per_record": [30, 160, 500]}}).status_code == 200
    history = http.get("/tpra/quantification/history").json()["items"]
    assert len(history) == 1                                   # nothing moved the second time
    assert history[0]["was"] == {"cost_per_record": [20, 150, 400], "control_effect.low": 0.6}
    assert history[0]["now"] == {"cost_per_record": [30.0, 160.0, 500.0], "control_effect.low": 0.5}
    assert history[0]["by"] == "analyst"


def test_shadow_suppliers_come_from_our_own_discovery(db, http):
    _vendor(db, "Microsoft")
    laptop = ITAsset(tenant_id=1, name="laptop-7", asset_type="infrastructure", vendor="Dell Inc.",
                     detected_software_json=[{"name": "Teams", "publisher": "Microsoft Corporation"},
                                             {"name": "Zoom", "publisher": "Zoom Video Communications, Inc."},
                                             {"name": "Tool", "publisher": "Various"}])
    crm = ITAsset(tenant_id=1, name="CRM", asset_type="application", vendor="Salesforce.com")
    db.add_all([laptop, crm])
    db.flush()
    db.add(SoftwareIdentifier(tenant_id=1, asset_id=laptop.id, identifier_type="cpe", identifier="cpe:2.3:a:x",
                              vendor="palo_alto_networks", product="globalprotect"))
    db.commit()
    found = {s["name"]: s for s in http.get("/tpra/shadow-suppliers").json()["items"]}
    assert set(found) == {"Zoom Video Communications, Inc.", "Salesforce", "Palo Alto Networks"}
    assert found["Salesforce"]["sources"] == ["asset register"] and found["Zoom Video Communications, Inc."]["products"] == ["Zoom"]

    db.add(TPRAPlatformAlias(tenant_id=1, alias="zoom video communications", excluded=True))
    db.commit()
    assert "Zoom Video Communications, Inc." not in {s["name"] for s in graph.shadow_suppliers(db, 1)}
