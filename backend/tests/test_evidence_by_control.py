"""``GET /evidence-mgmt/links/by-control``: which files are linked to one control (UX revamp, Stage 4, the record page's group).

What "evidence for this control" links open the Library on. The three kinds of control live in three tables whose ids overlap, so the caller names the kind; a control that
does not exist answers an empty list, not an error; another tenant's files are never listed. Over HTTP through the evidence router on in-memory SQLite.
"""
from datetime import datetime
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.routers.auth_router import require_auth

NOW = datetime.utcnow()


def seed(db):
    db.add_all([m.Tenant(id=1, name="CFSB", slug="cfsb"), m.Tenant(id=2, name="Other", slug="other")])
    db.add(m.GRCUser(id=1, username="u1", email="u1@cfsb.test", display_name="Ayesha Khan"))
    db.add(m.GRCUser(id=2, username="u2", email="u2@other.test", display_name="Other Person"))
    db.add(m.Framework(id=1, name="ISO 27001", short_code="ISO27001"))
    db.add(m.FrameworkDomain(id=1, framework_id=1, code="A", name="Domain"))
    db.add(m.ControlObjective(id=1, domain_id=1, code="A.5", name="Objective"))
    db.add(m.FrameworkControl(id=3, objective_id=1, code="A.5.3", name="Segregation of duties"))
    db.add(m.UploadedFramework(id=7, tenant_id=1, name="NCA ECC", file_name="f.pdf", file_path="f.pdf", file_type="pdf", uploaded_by=1))
    db.add(m.UploadedFramework(id=8, tenant_id=2, name="Other ECC", file_name="g.pdf", file_path="g.pdf", file_type="pdf", uploaded_by=2))
    db.add(m.ParsedFrameworkControl(id=3, uploaded_framework_id=7, control_id="NCA-1-1", title="A parsed control"))      # the same number as the framework control above
    db.add(m.ParsedFrameworkControl(id=80, uploaded_framework_id=8, control_id="OT-1", title="Someone else's control"))
    db.add(m.NormalizedControl(id=5, code="SCF-IAC-01", scf_id="IAC-01", name="Identity and access"))
    db.flush()
    for i, tenant in ((1, 1), (2, 1), (3, 1), (4, 2)):
        db.add(m.Evidence(id=i, tenant_id=tenant, name=f"File {i}", status="approved", uploaded_at=NOW))
    db.flush()
    db.add_all([
        m.EvidenceControlMapping(evidence_id=1, framework_control_id=3),
        m.EvidenceControlMapping(evidence_id=2, parsed_control_id=3, uploaded_framework_id=7),
        m.EvidenceControlMapping(evidence_id=3, normalized_control_id=5),
        m.EvidenceControlMapping(evidence_id=1, normalized_control_id=5),
        m.EvidenceControlMapping(evidence_id=1, normalized_control_id=5),                        # a second link of the same file: listed once
        m.EvidenceControlMapping(evidence_id=4, parsed_control_id=80, uploaded_framework_id=8),    # another tenant's file on another tenant's control
        m.EvidenceControlMapping(evidence_id=4, normalized_control_id=5),                        # another tenant's file on the shared common control
    ])
    db.commit()


@pytest.fixture()
def world():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False)()
    seed(db)
    from grc.modules.evidence.router import router

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, 1)
    yield SimpleNamespace(db=db, http=TestClient(app))
    db.close()


def ask(world, ref, kind=None):
    params = {"ref": ref, **({"kind": kind} if kind else {})}
    r = world.http.get("/evidence-mgmt/links/by-control", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_a_framework_control_lists_the_files_linked_to_it_and_names_itself(world):
    body = ask(world, "3")                                                     # the default kind is a library framework control
    assert body["evidence_ids"] == [1]
    assert body["control"] == {"kind": "framework", "id": 3, "code": "A.5.3", "title": "Segregation of duties", "framework": "ISO 27001"}


def test_the_same_number_means_another_control_for_another_kind(world):
    body = ask(world, "3", "parsed")
    assert body["evidence_ids"] == [2]
    assert body["control"]["code"] == "NCA-1-1" and body["control"]["framework"] == "NCA ECC"


def test_a_common_control_is_found_by_its_scf_id_or_its_number_and_lists_a_file_once(world):
    assert ask(world, "IAC-01", "common")["evidence_ids"] == [1, 3]            # file 1 is linked twice and is listed once; the other tenant's file 4 is not
    assert ask(world, "5", "common")["evidence_ids"] == [1, 3]
    assert ask(world, "IAC-01", "common")["control"]["code"] == "IAC-01"


def test_a_control_of_another_organisation_or_one_that_does_not_exist_is_an_empty_answer(world):
    assert ask(world, "80", "parsed") == {"control": None, "evidence_ids": []}      # an uploaded framework of tenant 2
    assert ask(world, "999") == {"control": None, "evidence_ids": []}
    assert ask(world, "NOPE-1", "common") == {"control": None, "evidence_ids": []}
    assert ask(world, "abc") == {"control": None, "evidence_ids": []}              # a framework control id is a number


def test_a_control_with_no_files_names_itself_and_lists_none(world):
    world.db.add(m.FrameworkControl(id=9, objective_id=1, code="A.5.9", name="Nothing yet"))
    world.db.commit()
    body = ask(world, "9")
    assert body["evidence_ids"] == [] and body["control"]["code"] == "A.5.9"


def test_the_kind_is_checked(world):
    assert world.http.get("/evidence-mgmt/links/by-control", params={"ref": "3", "kind": "other"}).status_code == 422
    assert world.http.get("/evidence-mgmt/links/by-control").status_code == 422
