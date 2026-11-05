"""The register's Controls tab for the framework library (kept when the Risk Library was removed, 2026-11-06): pick a control of an installed
framework (UAE IA, ISO 27001, ...) and link it to a risk, or take the link off. In-memory SQLite."""
import importlib
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, GRCUser, ParsedFrameworkControl, Risk, RiskFrameworkRequirementLink, Role, Tenant,
                        UploadedFramework, UserRole, get_db)
from grc.modules.erm.routers import risk_framework_requirements as link_routes
from grc.routers.auth_router import create_access_token, require_auth

auth_router = importlib.import_module("grc.routers.auth_router")      # the package re-exports a router under the same name

FRAMEWORK_FILE = Path(link_routes.__file__).parents[3] / "seed_data" / "frameworks" / "uae_ia.json"
OFFICER, PLAIN, OWNER = 7, 8, 9
M23 = ["M2.3.1", "M2.3.2", "M2.3.3", "M2.3.4"]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add(Role(id=1, name="Administrator"))
    s.add_all([GRCUser(id=OFFICER, username="officer", display_name="Officer", email="officer@bank.test", is_active=True),
               GRCUser(id=PLAIN, username="plain", display_name="Plain", email="plain@bank.test", is_active=True),
               GRCUser(id=OWNER, username="owner", display_name="Olu Owner", email="owner@bank.test", is_active=True)])
    s.add(UserRole(user_id=OFFICER, role_id=1, tenant_id=1))
    s.commit()
    yield s
    s.close()


def client(db, username="officer"):
    app = FastAPI()
    app.include_router(link_routes.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def install_uae_ia(db, only=None, tenant_id=None, name="UAE Information Assurance Standard"):
    """The UAE IA controls as the framework library holds them (seeded by name, no slug)."""
    fw = UploadedFramework(name=name, slug=None, version="2.1", tenant_id=tenant_id, file_name="uae_ia.json", file_path="seed", file_type="json", uploaded_by=OFFICER)
    db.add(fw)
    db.flush()
    for c in json.loads(FRAMEWORK_FILE.read_text(encoding="utf-8"))["controls"]:
        if only is None or c["control_id"] in only:
            db.add(ParsedFrameworkControl(uploaded_framework_id=fw.id, control_id=c["control_id"], title=c["title"],
                                          domain=c.get("domain"), category=c.get("category")))
    db.commit()
    return fw


def make_risk(db, tenant_id=1, title="Too high residual risks"):
    r = Risk(tenant_id=tenant_id, title=title, category="operational", owner_id=OWNER, status="open")
    db.add(r)
    db.commit()
    return r.id


def control_ids(db, codes):
    return [db.query(ParsedFrameworkControl).filter_by(control_id=c).first().id for c in codes]


def links_of(db, risk_id):
    return [l.control_code for l in db.query(RiskFrameworkRequirementLink).filter_by(risk_id=risk_id)
            .order_by(RiskFrameworkRequirementLink.id)]


def test_the_picker_lists_frameworks_searches_links_and_unlinks(db):
    install_uae_ia(db)
    http = client(db)
    rid = make_risk(db)
    frameworks = http.get("/framework-requirements/frameworks").json()["items"]
    assert [f["name"] for f in frameworks] == ["UAE Information Assurance Standard"] and frameworks[0]["controls"] == 262
    fid = frameworks[0]["id"]
    found = http.get("/framework-requirements", params={"framework_id": fid, "q": "M5.1"}).json()
    assert found["total"] >= 2 and found["items"][0]["code"].startswith("M5.1")
    assert http.get("/framework-requirements", params={"framework_id": fid + 99}).status_code == 404
    picked = [i["id"] for i in found["items"][:2]]
    added = http.post(f"/risks/{rid}/framework-requirements", json={"framework_id": fid, "control_ids": picked,
                                                                   "mitigation_effectiveness": "full", "notes": "Policy covers it"})
    assert added.status_code == 201, added.text
    assert len(added.json()["linked"]) == 2 and len(added.json()["links"]) == 2
    again = http.post(f"/risks/{rid}/framework-requirements", json={"framework_id": fid, "control_ids": picked}).json()
    assert again["linked"] == [] and len(again["already"]) == 2 and len(again["links"]) == 2
    mine = [l for l in again["links"] if l["notes"] == "Policy covers it"]
    assert len(mine) == 2 and mine[0]["mitigation_effectiveness"] == "full" and mine[0]["framework_name"].startswith("UAE")
    assert http.delete(f"/risks/{rid}/framework-requirements/{mine[0]['id']}").status_code == 204
    assert len(links_of(db, rid)) == 1
    assert http.delete(f"/risks/{rid}/framework-requirements/{mine[0]['id']}").status_code == 404


def test_a_deactivated_framework_or_another_tenants_is_not_offered(db):
    mine = install_uae_ia(db)
    db.add(Tenant(id=2, name="Other", slug="other"))
    db.commit()
    install_uae_ia(db, tenant_id=2, name="Theirs")
    http = client(db)
    assert [f["name"] for f in http.get("/framework-requirements/frameworks").json()["items"]] == ["UAE Information Assurance Standard"]
    mine.is_active = False
    db.commit()
    assert http.get("/framework-requirements/frameworks").json()["items"] == []


@pytest.mark.parametrize("body,expected", [
    ({"control_ids": []}, 422), ({"control_ids": [999999]}, 400), ({"mitigation_effectiveness": "total"}, 400), ({"framework_id": 999}, 404)])
def test_a_wrong_link_request_is_refused(db, body, expected):
    fw = install_uae_ia(db)
    http = client(db)
    rid = make_risk(db)
    first = db.query(ParsedFrameworkControl).first().id
    sent = http.post(f"/risks/{rid}/framework-requirements", json={"framework_id": fw.id, "control_ids": [first], **body})
    assert sent.status_code == expected, sent.text
    assert links_of(db, rid) == []


def test_linking_needs_the_edit_right_and_stays_inside_the_tenant(db, monkeypatch):
    fw = install_uae_ia(db)
    rid = make_risk(db)
    http = client(db)
    body = {"framework_id": fw.id, "control_ids": control_ids(db, ["M5.1.1"])}
    link_id = http.post(f"/risks/{rid}/framework-requirements", json=body).json()["links"][0]["id"]
    plain = client(db, "plain")
    assert plain.post(f"/risks/{rid}/framework-requirements", json=body).status_code == 403
    assert plain.delete(f"/risks/{rid}/framework-requirements/{link_id}").status_code == 403
    assert plain.get("/framework-requirements/frameworks").status_code == 200
    monkeypatch.setattr(auth_router, "has_tenant_permission", lambda db_, user, *names: "erm:risks:edit" in names)
    assert plain.post(f"/risks/{rid}/framework-requirements", json={**body, "control_ids": control_ids(db, ["M5.1.2"])}).status_code == 201
    # a risk of another tenant is not there for this one, to link or to unlink
    db.add(Tenant(id=2, name="Other", slug="other"))
    db.commit()
    foreign = make_risk(db, tenant_id=2, title="Theirs")
    assert plain.post(f"/risks/{foreign}/framework-requirements", json=body).status_code == 404
    assert http.post(f"/risks/{foreign}/framework-requirements", json=body).status_code == 404
    assert http.delete(f"/risks/{foreign}/framework-requirements/{link_id}").status_code == 404


def test_deleting_a_risk_takes_its_links_with_it(db):
    fw = install_uae_ia(db)
    rid = make_risk(db)
    assert client(db).post(f"/risks/{rid}/framework-requirements", json={"framework_id": fw.id, "control_ids": control_ids(db, M23)}).status_code == 201
    assert len(links_of(db, rid)) == 4
    db.delete(db.get(Risk, rid))
    db.commit()
    assert db.query(RiskFrameworkRequirementLink).count() == 0


@pytest.mark.parametrize("module", ["grc.modules.erm.routers.risks", "grc.routers.risks_router"])
def test_both_register_detail_endpoints_give_the_framework_links(db, module):
    """The risk page reads /risks/{id}/detail (the older router); /erm/risks/{id}/detail is the module's own twin."""
    fw = install_uae_ia(db)
    rid = make_risk(db)
    client(db).post(f"/risks/{rid}/framework-requirements", json={"framework_id": fw.id, "control_ids": control_ids(db, M23)})
    app = FastAPI()
    app.include_router(importlib.import_module(module).router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username="officer").one()
    detail = TestClient(app).get(f"/risks/{rid}/detail")
    assert detail.status_code == 200, detail.text
    got = detail.json()["linked_framework_requirements"]
    assert [l["code"] for l in got] == M23 and got[0]["framework_name"] == "UAE Information Assurance Standard"
    assert got[0]["title"] and got[0]["domain"] and got[0]["mitigation_effectiveness"] == "partial"
    assert detail.json()["linked_framework_controls"] == []                 # the legacy-catalog links are a separate list


def test_deleting_the_installed_framework_takes_the_risk_links_with_it(db):
    from grc.modules.framework_upload.routers import upload
    fw = install_uae_ia(db)
    rid = make_risk(db)
    assert client(db).post(f"/risks/{rid}/framework-requirements", json={"framework_id": fw.id, "control_ids": control_ids(db, M23)}).status_code == 201
    assert len(links_of(db, rid)) == 4
    app = FastAPI()
    app.include_router(upload.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username="officer").one()
    paths = [r.path for r in upload.router.routes if "DELETE" in getattr(r, "methods", ())]
    assert paths, "the framework upload router has no delete route"
    gone = TestClient(app).delete(paths[0].replace("{framework_id}", str(fw.id)))
    assert gone.status_code in (200, 204), gone.text
    assert db.query(RiskFrameworkRequirementLink).count() == 0 and db.get(Risk, rid) is not None
