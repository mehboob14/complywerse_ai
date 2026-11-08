"""`PATCH /certifications/{journey}/controls/{control}` changes a requirement's status. For a framework whose requirements come from the parsed library
(NDMO, UAE IA, every uploaded framework) the implementation has NO `framework_control_id` (it is NULL; the parsed control id carries the link), and the
response model demanded an integer there, so the change was saved and the answer was a 500. The field may be null now. In-memory SQLite, the
certifications router on a bare app.
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

NAME = "Control Patch Standard"          # no "iso" / "pci" in the name
DATA = {
    "metadata": {"name": NAME, "version": "1", "classification": "regulatory", "framework_type": "regulatory", "document_structure": None},
    "controls": [
        {"control_id": f"C.{i}", "original_reference": f"C.{i}", "title": f"Control {i}", "description": f"The entity shall {i}.",
         "full_text": f"The entity shall {i}.", "domain": "D1 General", "category": "D1.1", "parent_section": None, "is_mandatory": True,
         "priority": "high", "assessment_criteria": [], "evidence_requirements": [{"name": "Record", "description": "x", "filetype": "PDF"}]}
        for i in range(1, 4)
    ],
}


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
    db.commit()
    created = http.post("/certifications", json={"framework_id": fw.id, "name": f"{NAME} journey"})
    assert created.status_code == 201, created.text
    journey = created.json()["id"]
    controls = db.query(m.ControlImplementation).filter_by(journey_id=journey).order_by(m.ControlImplementation.id).all()
    assert len(controls) == 3
    yield SimpleNamespace(db=db, http=http, journey=journey, controls=controls)
    db.close()
    with engine.begin() as conn:                                                 # SQLite does not enforce the foreign keys: any order
        for table in m.Base.metadata.tables.values():
            conn.execute(table.delete())


def test_a_requirement_with_no_framework_control_id_can_change_status_and_the_answer_is_not_a_500(world):
    control = world.controls[0]
    control.framework_control_id = None                                          # a parsed-library requirement
    world.db.commit()
    got = world.http.patch(f"/certifications/{world.journey}/controls/{control.id}", json={"status": "implemented"})
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["status"] == "implemented"
    assert body["framework_control_id"] is None, "the field is there and says it has none"
    assert body["implementation_date"], "marking it implemented stamps the day, as before"
    world.db.expire_all()
    assert world.db.get(m.ControlImplementation, control.id).status == "implemented", "and the change is saved"


def test_a_requirement_that_has_one_still_answers_its_id_and_verified_stamps_who_verified(world):
    control = world.controls[1]
    fc = m.FrameworkControl(objective_id=1, code="L.1", name="A library control")          # SQLite does not enforce the objective's foreign key
    world.db.add(fc)
    world.db.flush()
    control.framework_control_id = fc.id
    world.db.commit()
    got = world.http.patch(f"/certifications/{world.journey}/controls/{control.id}", json={"status": "verified"})
    assert got.status_code == 200, got.text
    assert got.json()["framework_control_id"] == control.framework_control_id
    assert got.json()["verified_by"] == 7


def test_an_unknown_requirement_is_a_404_not_a_500(world):
    got = world.http.patch(f"/certifications/{world.journey}/controls/999999", json={"status": "implemented"})
    assert got.status_code == 404
