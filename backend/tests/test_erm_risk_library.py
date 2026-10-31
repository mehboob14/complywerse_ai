"""Risk Library (2026-10-31): the risks the UAE IA Standard lists under its control objectives, and moving one into the register.

The library is shipped data built from the standard (47 control objectives, 159 listed threats and vulnerabilities, every one
of the 134 core controls under exactly one objective). A person can browse it by framework, family and objective, and add a
risk to the register with the details the library cannot know (owner, likelihood, impact...): a normal register risk that
remembers where it came from. In-memory SQLite.
"""
import importlib
import json
import re
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
from grc.services import module_settings as ms
from grc.modules.erm.routers import risk_library as routes
from grc.modules.erm.services import risk_library as library
from grc.routers.auth_router import create_access_token, require_auth

auth_router = importlib.import_module("grc.routers.auth_router")      # the package re-exports a router under the same name

FRAMEWORK_FILE = Path(library.LIBRARY_DIR).parent / "frameworks" / "uae_ia.json"
OFFICER, PLAIN, OWNER, BOT = 7, 8, 9, 10


# ── the shipped data ─────────────────────────────────────────────────────────

def test_the_library_is_what_the_standard_lists():
    lib = library.library("uae_ia")
    assert (len(lib["families"]), len(lib["objectives"]), len(lib["risks"])) == (15, 47, 159)
    assert library.frameworks() == [{**lib["framework"], "families": 15, "objectives": 47, "risks": 159}]
    ids = [r["id"] for r in lib["risks"]]
    assert len(set(ids)) == len(ids) and all(re.fullmatch(r"uae_ia:[MT]\d\.\d:\d\d", i) for i in ids)
    assert all(r["title"].strip() and not r["title"].endswith(".") for r in lib["risks"])
    assert all(r["suggested_category"] in routes.CATEGORIES for r in lib["risks"])


def test_every_objective_holds_its_controls_and_every_core_control_sits_under_one_objective():
    lib = library.library("uae_ia")
    framework = json.loads(FRAMEWORK_FILE.read_text(encoding="utf-8"))
    core = {c["control_id"]: c for c in framework["controls"] if re.fullmatch(r"[MT]\d\.\d\.\d", c["control_id"])}
    under = [c["control_id"] for o in lib["objectives"] for c in o["controls"]]
    assert sorted(under) == sorted(core) and len(under) == 134
    assert all(o["controls"] and o["objective"] for o in lib["objectives"])
    for o in lib["objectives"]:
        assert all(core[c["control_id"]]["category"].split()[0] == o["id"] for c in o["controls"])


def test_the_text_of_a_few_risks_is_the_standards_own():
    risks = {r["id"]: r for r in library.library("uae_ia")["risks"]}
    assert risks["uae_ia:M2.3:03"]["title"] == "Too high residual risks"
    assert risks["uae_ia:T5.3:04"]["title"] == "Password fatigue"
    assert risks["uae_ia:M5.3:03"]["title"] == "Regular operations affected due to non-planned audit activities"
    assert risks["uae_ia:M2.3:03"]["controls"][0]["control_id"] == "M2.3.1"
    assert risks["uae_ia:T6.2:01"]["suggested_category"] == "third_party" and risks["uae_ia:M5.1:01"]["suggested_category"] == "compliance"


def test_searching_narrows_by_family_objective_and_words():
    assert len(library.search("uae_ia")) == 159
    assert len(library.search("uae_ia", family="M2")) == 18
    assert [r["id"] for r in library.search("uae_ia", objective="M5.3")] == ["uae_ia:M5.3:01", "uae_ia:M5.3:02", "uae_ia:M5.3:03"]
    assert len(library.search("uae_ia", text="phishing")) == 2
    assert library.search("uae_ia", text="T5.2.1")                      # a control id finds the risks of its objective
    assert library.search("uae_ia", text="no-such-words") == [] and library.search("nothing") == []
    facets = library.facets("uae_ia")
    assert sum(f["count"] for f in facets["families"]) == 159 == sum(o["count"] for o in facets["objectives"])


# ── the endpoints ────────────────────────────────────────────────────────────

@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add(Tenant(id=1, name="Bank", slug="bank"))
    s.add(Role(id=1, name="Administrator"))
    s.add_all([GRCUser(id=OFFICER, username="officer", display_name="Officer", email="officer@bank.test", is_active=True),
               GRCUser(id=PLAIN, username="plain", display_name="Plain", email="plain@bank.test", is_active=True),
               GRCUser(id=OWNER, username="owner", display_name="Olu Owner", email="owner@bank.test", is_active=True),
               GRCUser(id=BOT, username="bot", email="bot@do.test", is_active=True, external_provider="digitalocean")])
    s.add(UserRole(user_id=OFFICER, role_id=1, tenant_id=1))
    s.commit()
    yield s
    s.close()


def client(db, username="officer"):
    app = FastAPI()
    app.include_router(routes.router)
    app.include_router(link_routes.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


ADD = {"owner_id": OWNER, "inherent_likelihood": 4, "inherent_impact": 3}


def test_the_list_pages_filters_and_says_what_is_in_the_register(db):
    http = client(db)
    first = http.get("/risk-library").json()
    assert first["framework"]["key"] == "uae_ia" and first["total"] == 159 and len(first["items"]) == 50
    assert first["in_register_total"] == 0 and all(i["in_register"] is None for i in first["items"])
    assert http.get("/risk-library", params={"family": "T5", "limit": 500}).json()["total"] == 14
    assert http.get("/risk-library", params={"objective": "M2.3"}).json()["total"] == 6
    page2 = http.get("/risk-library", params={"skip": 50, "limit": 50}).json()
    assert page2["items"][0]["id"] == library.library("uae_ia")["risks"][50]["id"]
    assert http.get("/risk-library", params={"framework": "nope"}).status_code == 404
    assert http.get("/risk-library/frameworks").json()["items"][0]["risks"] == 159
    one = http.get("/risk-library/uae_ia:M2.3:03").json()
    assert one["title"] == "Too high residual risks" and one["objective_id"] == "M2.3" and one["in_register"] is None
    assert http.get("/risk-library/uae_ia:M9.9:01").status_code == 404


def test_adding_a_risk_makes_a_register_risk_that_remembers_its_source(db):
    http = client(db)
    made = http.post("/risk-library/uae_ia:M2.3:03/add-to-register", json={**ADD, "treatment_plan": "Reduce by adding controls"})
    assert made.status_code == 201, made.text
    body = made.json()
    risk = db.get(Risk, body["risk"]["id"])
    assert (risk.title, risk.category, risk.risk_sub_category, risk.register_type) == (
        "Too high residual risks", "operational", "Information Security Risk Treatment", "UAE IA")
    assert (risk.source_type, risk.source_reference, risk.owner_id, risk.status) == ("risk_library", "uae_ia:M2.3:03", OWNER, "open")
    assert (risk.inherent_likelihood, risk.inherent_impact, risk.inherent_score) == (4, 3, 12) and risk.effective_priority == "high"
    assert "Related controls: M2.3.1, M2.3.2" in risk.description and risk.treatment_plan == "Reduce by adding controls"
    assert body["risk"]["inherent_score"] == 12 and body["library_risk"]["in_register"]["risk_id"] == risk.id
    # and the library shows it, and the filter follows
    listed = http.get("/risk-library", params={"objective": "M2.3"}).json()
    assert {i["id"]: i["in_register"] is not None for i in listed["items"]}["uae_ia:M2.3:03"] is True and listed["in_register_total"] == 1
    assert http.get("/risk-library", params={"in_register": True}).json()["total"] == 1
    assert http.get("/risk-library", params={"in_register": False}).json()["total"] == 158


def test_what_the_person_edits_in_the_popup_wins(db):
    http = client(db)
    made = http.post("/risk-library/uae_ia:T6.2:01/add-to-register", json={
        **ADD, "title": "Supplier abuses the service we gave it", "description": "Our wording", "category": "compliance",
        "residual_likelihood": 2, "residual_impact": 2, "status": "mitigating", "priority": "critical"})
    assert made.status_code == 201, made.text
    risk = db.get(Risk, made.json()["risk"]["id"])
    assert (risk.title, risk.description, risk.category, risk.residual_score, risk.status, risk.priority) == (
        "Supplier abuses the service we gave it", "Our wording", "compliance", 4, "mitigating", "critical")
    assert risk.source_reference == "uae_ia:T6.2:01"                      # the source stays, whatever the words say
    assert db.get(Risk, made.json()["risk"]["id"]).category == "compliance"
    # no category given: the family's suggestion (T6 is third party)
    again = http.post("/risk-library/uae_ia:T6.2:02/add-to-register", json=ADD).json()
    assert again["risk"]["category"] == "third_party"


def test_a_risk_already_in_the_register_is_not_added_twice_unless_asked(db):
    http = client(db)
    url = "/risk-library/uae_ia:M1.1:01/add-to-register"
    first = http.post(url, json=ADD).json()["risk"]["id"]
    refused = http.post(url, json=ADD)
    assert refused.status_code == 409 and f"#{first}" in refused.json()["detail"]
    assert db.query(Risk).count() == 1
    forced = http.post(url, json={**ADD, "allow_duplicate": True})
    assert forced.status_code == 201 and db.query(Risk).count() == 2
    assert forced.json()["library_risk"]["in_register"]["times"] == 2


@pytest.mark.parametrize("change,expected", [
    ({"inherent_likelihood": 0}, 422), ({"inherent_impact": 6}, 422), ({"owner_id": None}, 422),
    ({"category": "   "}, 400), ({"category": "x" * 51}, 422), ({"residual_likelihood": 3}, 400), ({"title": "   "}, 400), ({"owner_id": BOT}, 400),
    ({"priority": "urgent"}, 400)])
def test_a_wrong_pop_up_is_refused_and_nothing_is_added(db, change, expected):
    sent = client(db).post("/risk-library/uae_ia:M1.1:01/add-to-register", json={**ADD, **change})
    assert sent.status_code == expected, sent.text
    assert db.query(Risk).count() == 0
    assert client(db).post("/risk-library/uae_ia:ZZ:01/add-to-register", json=ADD).status_code == 404


def test_only_someone_who_may_create_risks_can_add_one(db, monkeypatch):
    plain = client(db, "plain")
    denied = plain.post("/risk-library/uae_ia:M1.1:01/add-to-register", json=ADD)
    assert denied.status_code == 403 and db.query(Risk).count() == 0
    assert plain.get("/risk-library").status_code == 200                   # reading is the module's own permission (erm:risks:view)
    monkeypatch.setattr(auth_router, "has_tenant_permission", lambda db_, user, *names: "erm:risks:edit" in names)
    assert plain.post("/risk-library/uae_ia:M1.1:01/add-to-register", json=ADD).status_code == 201


# ── the framework controls a risk is linked to, and the tenant's own fields ───

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


M23 = ["M2.3.1", "M2.3.2", "M2.3.3", "M2.3.4"]            # the controls of objective M2.3


def links_of(db, risk_id):
    return [l.control_code for l in db.query(RiskFrameworkRequirementLink).filter_by(risk_id=risk_id)
            .order_by(RiskFrameworkRequirementLink.id)]


def test_adding_a_risk_links_the_controls_of_its_objective_that_the_tenant_has(db):
    fw = install_uae_ia(db)
    http = client(db)
    listed = http.get("/risk-library", params={"objective": "M2.3"}).json()
    assert listed["installed_framework"] == {"id": fw.id, "name": "UAE Information Assurance Standard"}
    assert all(c["installed"] for i in listed["items"] for c in i["controls"])
    made = http.post("/risk-library/uae_ia:M2.3:03/add-to-register", json=ADD).json()
    assert made["linked_controls"] == M23 and made["controls_not_installed"] == []
    assert links_of(db, made["risk"]["id"]) == M23
    link = db.query(RiskFrameworkRequirementLink).first()
    assert (link.uploaded_framework_id, link.mitigation_effectiveness, link.created_by) == (fw.id, "partial", OFFICER)


def test_the_person_can_leave_controls_out_or_link_none(db):
    install_uae_ia(db)
    http = client(db)
    some = http.post("/risk-library/uae_ia:M2.3:03/add-to-register", json={**ADD, "control_codes": ["M2.3.2", "T5.1.1"]}).json()
    assert some["linked_controls"] == ["M2.3.2"]                          # a control that is not the objective's is ignored
    none = http.post("/risk-library/uae_ia:M2.3:04/add-to-register", json={**ADD, "control_codes": []}).json()
    assert none["linked_controls"] == [] and links_of(db, none["risk"]["id"]) == []


def test_without_the_framework_installed_the_risk_is_still_added_and_the_gap_is_reported(db):
    http = client(db)
    assert http.get("/risk-library").json()["installed_framework"] is None
    made = http.post("/risk-library/uae_ia:M2.3:03/add-to-register", json=ADD)
    assert made.status_code == 201 and made.json()["linked_controls"] == []
    assert made.json()["controls_not_installed"] == M23
    # only some controls installed: those are linked, the rest named
    install_uae_ia(db, only={"M2.3.1"})
    part = http.post("/risk-library/uae_ia:M2.3:04/add-to-register", json=ADD).json()
    assert part["linked_controls"] == ["M2.3.1"] and part["controls_not_installed"] == M23[1:]


def test_a_framework_another_tenant_installed_is_not_used(db):
    db.add(Tenant(id=2, name="Other", slug="other"))
    db.commit()
    install_uae_ia(db, tenant_id=2)
    made = client(db).post("/risk-library/uae_ia:M2.3:03/add-to-register", json=ADD).json()
    assert made["linked_controls"] == [] and links_of(db, made["risk"]["id"]) == []


def test_the_installed_copy_with_the_most_controls_is_the_one_linked(db):
    install_uae_ia(db, only={"M2.3.1"})
    full = install_uae_ia(db)
    made = client(db).post("/risk-library/uae_ia:M2.3:03/add-to-register", json=ADD).json()
    assert {l.uploaded_framework_id for l in db.query(RiskFrameworkRequirementLink)} == {full.id}
    assert made["linked_controls"] == M23


def test_a_deactivated_framework_is_not_offered_or_linked(db):
    fw = install_uae_ia(db)
    fw.is_active = False
    db.commit()
    http = client(db)
    assert http.get("/framework-requirements/frameworks").json()["items"] == []
    assert http.get("/risk-library").json()["installed_framework"] is None
    made = http.post("/risk-library/uae_ia:M2.3:03/add-to-register", json=ADD).json()
    assert made["linked_controls"] == [] and made["controls_not_installed"] == M23


RESTRICTED = [{"key": "business_line", "label": "Business line", "type": "select", "options": ["Retail", "Treasury"], "required": True},
              {"key": "note", "label": "Note", "type": "text"}]


def test_the_tenants_required_risk_fields_are_asked_for_and_kept(db):
    ms.save_settings(db, 1, "risks", {"fields": RESTRICTED})
    http = client(db)
    refused = http.post("/risk-library/uae_ia:M1.1:01/add-to-register", json={**ADD, "custom_values": {"note": "x"}})
    assert refused.status_code == 400 and "Business line" in refused.json()["detail"] and db.query(Risk).count() == 0
    bad = http.post("/risk-library/uae_ia:M1.1:01/add-to-register", json={**ADD, "custom_values": {"business_line": "Mining"}})
    assert bad.status_code == 400 and db.query(Risk).count() == 0
    unknown = http.post("/risk-library/uae_ia:M1.1:01/add-to-register", json={**ADD, "custom_values": {"nope": 1, "business_line": "Retail"}})
    assert unknown.status_code == 400
    ok = http.post("/risk-library/uae_ia:M1.1:01/add-to-register", json={**ADD, "custom_values": {"business_line": "Treasury", "note": "n"}})
    assert ok.status_code == 201, ok.text
    assert db.get(Risk, ok.json()["risk"]["id"]).custom_values == {"business_line": "Treasury", "note": "n"}


def test_a_tenant_with_its_own_category_list_can_use_it(db):
    made = client(db).post("/risk-library/uae_ia:M1.1:01/add-to-register", json={**ADD, "category": "Conduct "})
    assert made.status_code == 201 and made.json()["risk"]["category"] == "conduct"


def test_the_register_risk_shows_its_framework_links_and_the_picker_adds_and_removes_them(db):
    install_uae_ia(db)
    http = client(db)
    rid = http.post("/risk-library/uae_ia:M2.3:03/add-to-register", json=ADD).json()["risk"]["id"]
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
    assert len(added.json()["linked"]) == 2 and len(added.json()["links"]) == 6
    again = http.post(f"/risks/{rid}/framework-requirements", json={"framework_id": fid, "control_ids": picked}).json()
    assert again["linked"] == [] and len(again["already"]) == 2 and len(again["links"]) == 6
    mine = [l for l in again["links"] if l["notes"] == "Policy covers it"]
    assert len(mine) == 2 and mine[0]["mitigation_effectiveness"] == "full" and mine[0]["framework_name"].startswith("UAE")
    assert http.delete(f"/risks/{rid}/framework-requirements/{mine[0]['id']}").status_code == 204
    assert len(links_of(db, rid)) == 5
    assert http.delete(f"/risks/{rid}/framework-requirements/{mine[0]['id']}").status_code == 404


@pytest.mark.parametrize("body,expected", [
    ({"control_ids": []}, 422), ({"control_ids": [999999]}, 400), ({"mitigation_effectiveness": "total"}, 400), ({"framework_id": 999}, 404)])
def test_a_wrong_link_request_is_refused(db, body, expected):
    fw = install_uae_ia(db)
    http = client(db)
    rid = http.post("/risk-library/uae_ia:M2.3:03/add-to-register", json={**ADD, "control_codes": []}).json()["risk"]["id"]
    first = db.query(ParsedFrameworkControl).first().id
    sent = http.post(f"/risks/{rid}/framework-requirements", json={"framework_id": fw.id, "control_ids": [first], **body})
    assert sent.status_code == expected, sent.text
    assert links_of(db, rid) == []


def test_linking_needs_the_edit_right_and_stays_inside_the_tenant(db, monkeypatch):
    fw = install_uae_ia(db)
    rid = client(db).post("/risk-library/uae_ia:M2.3:03/add-to-register", json=ADD).json()["risk"]["id"]
    link = db.query(RiskFrameworkRequirementLink).first()
    plain = client(db, "plain")
    one = db.query(ParsedFrameworkControl).filter_by(control_id="M5.1.1").first()
    body = {"framework_id": fw.id, "control_ids": [one.id]}
    assert plain.post(f"/risks/{rid}/framework-requirements", json=body).status_code == 403
    assert plain.delete(f"/risks/{rid}/framework-requirements/{link.id}").status_code == 403
    assert plain.get("/framework-requirements/frameworks").status_code == 200
    monkeypatch.setattr(auth_router, "has_tenant_permission", lambda db_, user, *names: "erm:risks:edit" in names)
    assert plain.post(f"/risks/{rid}/framework-requirements", json=body).status_code == 201
    # a risk of another tenant is not there for this one, to link or to unlink
    db.add(Tenant(id=2, name="Other", slug="other"))
    db.commit()
    foreign = Risk(tenant_id=2, title="Theirs", category="operational", owner_id=OWNER, status="open")
    db.add(foreign)
    db.commit()
    assert plain.post(f"/risks/{foreign.id}/framework-requirements", json=body).status_code == 404
    assert client(db).post(f"/risks/{foreign.id}/framework-requirements", json=body).status_code == 404
    assert client(db).delete(f"/risks/{foreign.id}/framework-requirements/{link.id}").status_code == 404


def test_deleting_a_risk_takes_its_links_with_it(db):
    install_uae_ia(db)
    rid = client(db).post("/risk-library/uae_ia:M2.3:03/add-to-register", json=ADD).json()["risk"]["id"]
    assert len(links_of(db, rid)) == 4
    db.delete(db.get(Risk, rid))
    db.commit()
    assert db.query(RiskFrameworkRequirementLink).count() == 0


@pytest.mark.parametrize("module", ["grc.modules.erm.routers.risks", "grc.routers.risks_router"])
def test_both_register_detail_endpoints_give_the_framework_links(db, module):
    """The risk page reads /risks/{id}/detail (the older router); /erm/risks/{id}/detail is the module's own twin."""
    install_uae_ia(db)
    rid = client(db).post("/risk-library/uae_ia:M2.3:03/add-to-register", json=ADD).json()["risk"]["id"]
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
    rid = client(db).post("/risk-library/uae_ia:M2.3:03/add-to-register", json=ADD).json()["risk"]["id"]
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
