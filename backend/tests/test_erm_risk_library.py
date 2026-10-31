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

from grc.models import Base, GRCUser, Risk, Role, Tenant, UserRole, get_db
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
    ({"category": "made-up"}, 400), ({"residual_likelihood": 3}, 400), ({"title": "   "}, 400), ({"owner_id": BOT}, 400),
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
