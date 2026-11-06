"""FAIR analyses: ranges in order, the FAIR arithmetic, prefill with its reasons, CSV in and out.

Threat event frequency times vulnerability gives loss events; each costs its
primary forms and, as often as the secondary frequency says, its secondary
forms. The same inputs give the same numbers; the one-in-twenty year becomes
the least liability cap; every prefilled number says where it came from.
"""
import csv
import io
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import Base, GRCUser, Tenant, TPRAAuditLog, TPRAFairAnalysis, TPRASurfaceScan, Vendor, get_db
from grc.modules.vendor_risk.tpra import fair, quantification, rbac
from grc.routers.auth_router import require_auth


def _inputs(**kw):
    base = {"tef": [2, 2, 2], "vulnerability": [1, 1, 1], "primary": {"response": [1000, 1000, 1000]},
            "secondary": {}, "iterations": 20000}
    base.update(kw)
    return fair.clean(base)


def test_inputs_are_ranges_in_order():
    cleaned = _inputs()
    assert cleaned["primary"]["productivity"] == [0, 0, 0] and cleaned["secondary"]["probability"] == [0, 0, 0]
    for bad in ({"tef": [3, 2, 4]}, {"vulnerability": [0.1, 0.5, 1.5]}, {"tef": [1, 2, 400]}, {"tef": [1, float("nan"), 2]},
                {"tef": [1, 2]}, {"iterations": 10}):
        with pytest.raises(ValueError):
            _inputs(**bad)


def test_the_simulation_follows_the_fair_arithmetic():
    two_a_year = fair.simulate(_inputs(), 1)
    assert abs(two_a_year["annual"]["mean"] - 2000) < 60                      # Poisson(2) events × 1,000
    assert abs(two_a_year["annual"]["chance"] - 0.8647) < 0.01               # 1 − e^−2
    assert two_a_year["per_event"]["p50"] == 1000 and two_a_year["lef"]["mean"] == 2
    with_secondary = fair.simulate(_inputs(secondary={"probability": [1, 1, 1], "fines": [500, 500, 500]}), 1)
    assert abs(with_secondary["annual"]["mean"] - 3000) < 90 and with_secondary["split"]["secondary_share"] == 1
    never = fair.simulate(_inputs(vulnerability=[0, 0, 0]), 1)
    assert never["annual"]["chance"] == 0 and never["lec"] == [] and never["liability_cap"] == 0
    assert fair.simulate(_inputs(), 7) == fair.simulate(_inputs(), 7)         # the same inputs, the same numbers
    lec = fair.simulate(_inputs(tef=[1, 4, 12], vulnerability=[0.02, 0.1, 0.3],
                                primary={"replacement": [1000, 50000, 900000]}), 3)["lec"]
    assert [p["chance"] for p in lec] == sorted((p["chance"] for p in lec), reverse=True)
    assert [fair._round_up(x) for x in (21811839, 999, 1234, 0)] == [22000000, 1000, 1300, 0]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Acme", slug="acme"))
    s.add(GRCUser(id=7, username="analyst", email="a@acme.test", is_active=True))
    s.add(Vendor(id=1, tenant_id=1, name="Payroll Co", status="active", tier="critical", data_access_level="confidential",
                 risk_rating="medium", owner_id=7))
    s.commit()
    yield s
    s.close()


def test_prefill_says_where_each_number_came_from(db):
    cfg = quantification.merged(None)
    inputs, notes = fair.prefill(db, db.get(Vendor, 1), "confidentiality")
    assert inputs["vulnerability"] == fair.VULN_BY_GRADE["C"] and "residual rating" in notes[0]
    assert inputs["tef"][1] == round(cfg["breach_per_year"]["critical"][1] / 0.1, 3)
    records, per_record = cfg["records"]["confidential"], cfg["cost_per_record"]
    assert inputs["primary"]["replacement"] == [r * c for r, c in zip(records, per_record)]
    assert inputs["secondary"]["probability"] == [0.2, 0.4, 0.7] and any("sensitive data" in n for n in notes)
    db.add(TPRASurfaceScan(tenant_id=1, vendor_id=1, status="done", started_at=datetime.utcnow(), grade="A", score=95))
    db.commit()
    graded, notes = fair.prefill(db, db.get(Vendor, 1), "confidentiality")
    assert graded["vulnerability"] == fair.VULN_BY_GRADE["A"] and "outside-in grade A" in notes[0]
    outage, notes = fair.prefill(db, db.get(Vendor, 1), "availability")
    assert outage["primary"]["productivity"][1] == cfg["outage_hours"][1] * cfg["outage_cost_per_hour"]["critical"][1]
    assert outage["primary"]["replacement"] == [0, 0, 0] and "no continuity process recorded" in " ".join(notes)


@pytest.fixture()
def client(db, monkeypatch):
    monkeypatch.setattr(rbac, "require_write", lambda *a, **k: None)
    app = FastAPI()
    app.include_router(fair.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(GRCUser, 7)
    return TestClient(app)


def test_analyses_are_kept_rerun_and_exported(db, client):
    start = client.get("/vendors/1/fair/prefill", params={"effect": "confidentiality"}).json()
    made = client.post("/fair", json={"vendor_id": 1, "name": start["name"], "effect": "confidentiality",
                                      "inputs": start["inputs"], "notes": start["notes"]})
    assert made.status_code == 201, made.text
    a = made.json()
    assert a["result"]["annual"]["chance"] > 0 and a["liability_cap"] >= a["annual"]["p95"] and a["currency"] == "USD"
    assert client.post("/fair", json={"vendor_id": 1, "inputs": {**start["inputs"], "tef": [5, 1, 9]}}).status_code == 400
    halved = {**a["inputs"], "vulnerability": [x / 2 for x in a["inputs"]["vulnerability"]]}
    changed = client.put(f"/fair/{a['id']}", json={"inputs": halved, "row_version": a["row_version"]}).json()
    assert changed["row_version"] == a["row_version"] + 1 and changed["annual"]["mean"] < a["annual"]["mean"]
    assert client.put(f"/fair/{a['id']}", json={"status": "final", "row_version": a["row_version"]}).status_code == 409
    one = client.get(f"/fair/{a['id']}/export.csv").text
    assert "Threat event frequency (a year)" in one and "Loss exceedance: a year costing at least" in one
    everything = list(csv.reader(io.StringIO(client.get("/fair/export.csv").text)))
    assert everything[0][:3] == ["vendor", "name", "effect"] and everything[1][0] == "Payroll Co"
    assert client.get("/fair", params={"vendor_id": 1}).json()["items"][0]["id"] == a["id"]
    assert client.delete(f"/fair/{a['id']}").status_code == 200 and client.get(f"/fair/{a['id']}").status_code == 404
    assert {r.action for r in db.query(TPRAAuditLog).filter_by(entity="fair_analysis")} == {"create", "update", "delete"}


def test_an_import_is_all_or_nothing(db, client):
    header = client.get("/fair/import/template").text.strip().split(",")
    assert header[:3] == ["vendor", "name", "effect"] and "tef_likely" in header and "fines_most" in header
    good = {"vendor": "Payroll Co", "name": "Payroll outage", "effect": "availability", "tef_least": "0.2", "tef_likely": "1",
            "tef_most": "3", "vulnerability_least": "0.5", "vulnerability_likely": "0.8", "vulnerability_most": "1",
            "productivity_least": "1000", "productivity_likely": "20000", "productivity_most": "200000"}
    bad = {**good, "vendor": "Nobody Ltd"}

    def upload(rows, dry_run):
        out = io.StringIO()
        w = csv.DictWriter(out, fieldnames=header)
        w.writeheader()
        w.writerows(rows)
        return client.post("/fair/import", params={"dry_run": dry_run},
                           files={"file": ("f.csv", io.BytesIO(out.getvalue().encode()), "text/csv")}).json()

    mixed = upload([good, bad], False)
    assert mixed["ready"] == 1 and mixed["problems"] == ["Row 3: no supplier called 'Nobody Ltd'"] and mixed["dry_run"]
    assert db.query(TPRAFairAnalysis).count() == 0                            # a problem anywhere writes nothing
    assert upload([good], False)["dry_run"] is False
    kept = db.query(TPRAFairAnalysis).one()
    assert kept.effect == "availability" and kept.inputs["primary"]["productivity"] == [1000, 20000, 200000] and kept.result
