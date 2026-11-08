"""A GET never writes: the framework charts of a journey (`GET /certifications/{id}/charts`) used to upsert today's `ComplianceHistory` row and
commit on every call (the Overview tab even polled it every minute). The trend now gains a point when someone captures a snapshot
(`POST /certifications/{id}/snapshots`), and the charts only read it. In-memory SQLite, the certifications router on a bare app.
"""
import copy
import importlib
import os
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

import grc.models as m  # noqa: E402
from grc.seed_frameworks import seed_framework_from_json  # noqa: E402

certs = importlib.import_module("grc.routers.certification_router")
auth = importlib.import_module("grc.routers.auth_router")

NAME = "Charts Test Standard"          # no "iso" / "pci" in the name
DATA = {
    "metadata": {"name": NAME, "version": "1", "classification": "regulatory", "framework_type": "regulatory", "document_structure": None},
    "controls": [
        {"control_id": f"C.{i}", "original_reference": f"C.{i}", "title": f"Control {i}", "description": f"The entity shall {i}.",
         "full_text": f"The entity shall {i}.", "domain": "D1 General", "category": "D1.1", "parent_section": None, "is_mandatory": True,
         "priority": "high", "assessment_criteria": [], "evidence_requirements": [{"name": "Record", "description": "x", "filetype": "PDF"}]}
        for i in range(1, 5)
    ],
}
CHART_KEYS = {"gauge", "stats", "status_donut", "automation_donut", "maturity", "trend"}


@pytest.fixture(scope="module")
def engine():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    return engine


@pytest.fixture
def world(engine):
    db = sessionmaker(bind=engine, autoflush=False)()
    db.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
    user = m.GRCUser(id=7, username="owner", email="owner@bank.example", display_name="Owner")
    db.add(user)
    db.commit()
    app = FastAPI()
    app.include_router(certs.router)
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[auth.require_auth] = lambda: user
    http = TestClient(app)
    fw = seed_framework_from_json(db, copy.deepcopy(DATA), tenant_id=1)
    db.add(m.FrameworkOnboarding(tenant_id=1, uploaded_framework_id=fw.id, family="general", state="underway", answers={}))
    db.commit()                                                                  # the journey gate: a framework that already runs is "underway"
    created = http.post("/certifications", json={"framework_id": fw.id, "name": f"{NAME} journey"})
    assert created.status_code == 201, created.text
    journey = created.json()["id"]

    def history():
        db.expire_all()
        return db.query(m.ComplianceHistory).filter_by(journey_id=journey).all()

    def snapshots():
        db.expire_all()
        return db.query(m.ComplianceSnapshot).filter_by(journey_id=journey).all()

    yield SimpleNamespace(db=db, http=http, journey=journey, history=history, snapshots=snapshots)
    db.close()
    with engine.begin() as conn:                                                 # SQLite does not enforce the foreign keys: any order
        for table in m.Base.metadata.tables.values():
            conn.execute(table.delete())


def test_opening_the_charts_writes_nothing_however_often(world):
    for _ in range(3):
        got = world.http.get(f"/certifications/{world.journey}/charts")
        assert got.status_code == 200, got.text
        assert set(got.json()) == CHART_KEYS, "the response keeps its shape"
        assert got.json()["trend"] == [], "no snapshot, no point"
    assert world.history() == [], "a GET must not add a history row"
    assert world.snapshots() == []


def test_a_snapshot_is_what_adds_the_trend_point_and_taking_two_in_a_day_keeps_one_point(world):
    first = world.http.post(f"/certifications/{world.journey}/snapshots", json={"year": 2026, "label": "2026 Assessment"})
    assert first.status_code == 200, first.text
    assert first.json()["label"] == "2026 Assessment"
    assert len(world.snapshots()) == 1
    rows = world.history()
    assert len(rows) == 1 and rows[0].total_controls == 4, "the snapshot also records today's point of the trend"

    world.http.post(f"/certifications/{world.journey}/snapshots", json={"year": 2026, "label": "Again"})
    assert len(world.snapshots()) == 2, "every snapshot is kept"
    assert len(world.history()) == 1, "one trend point per journey and day"

    charts = world.http.get(f"/certifications/{world.journey}/charts").json()
    assert len(charts["trend"]) == 1
    assert set(charts["trend"][0]) == {"label", "completion", "readiness"}
    assert len(world.history()) == 1, "and reading it again still writes nothing"


def test_a_snapshot_that_cannot_record_the_trend_point_is_still_saved(world, monkeypatch):
    monkeypatch.setattr(certs, "ComplianceHistory", None)                       # the trend table is unavailable: the upsert fails inside its try
    got = world.http.post(f"/certifications/{world.journey}/snapshots", json={"year": 2026, "label": "Kept"})
    assert got.status_code == 200, got.text
    assert [s.label for s in world.snapshots()] == ["Kept"]
