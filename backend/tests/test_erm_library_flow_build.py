"""Risk Library as an identification step (wave 4-N): suggest, propose to the owner, the owner drafts, the risk team accepts.

The risk team asks what the library suggests for a unit (library risks whose requirements the organisation has adopted, in the
categories the unit already records, and not yet in that unit's register, each with the reason), proposes one to a risk owner,
the owner confirms it applies and drafts the inherent score (a Draft register risk that remembers the library item) or declines
with a reason, and someone other than the drafter accepts it into the register (Draft -> Open, with the library item's
requirements and controls linked and a history row naming the item) or returns it with comments. A draft is not counted on the
register list, its dashboard or appetite. "Add to register" stays for administrators, and it makes a draft too.
Runs through the real /erm router. In-memory SQLite.
"""
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from grc.models import (Base, BusinessUnit, GRCUser, NormalizedControl, NormalizedControlLink, ParsedFrameworkControl, Permission,
                        Risk, RiskAppetiteBreach, RiskAppetiteConfig, RiskControl,
                        RiskLibraryProposal, Role, RolePermission, Tenant, UploadedFramework, UserRole, get_db)
from grc.modules.erm.router import router as erm_router
from grc.modules.erm.routers import appetite
from grc.modules.erm.routers import risk_library as routes
from grc.modules.erm.services import risk_library as library
from grc.routers.auth_router import create_access_token, require_auth

FRAMEWORK_FILE = Path(library.LIBRARY_DIR).parent / "frameworks" / "uae_ia.json"
OFFICER, ANALYST, OWNER, PLAIN = 7, 8, 9, 10
RETAIL, TREASURY = 1, 2
ITEM = "uae_ia:M2.3:01"
M23 = ["M2.3.1", "M2.3.2", "M2.3.3", "M2.3.4"]


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add_all([Tenant(id=1, name="Bank", slug="bank"), Tenant(id=2, name="Other", slug="other")])
    s.add_all([Role(id=1, name="Administrator"), Role(id=2, name="Risk team"), Role(id=3, name="Risk viewer")])
    names = ["erm:risks:view", "erm:risks:create", "erm:risks:edit"]
    s.add_all([Permission(id=i + 1, name=n, resource="erm:risks", action=n.split(":")[-1]) for i, n in enumerate(names)])
    s.add_all([RolePermission(role_id=2, permission_id=i + 1) for i in range(3)] + [RolePermission(role_id=3, permission_id=1)])
    s.add_all([GRCUser(id=OFFICER, username="officer", display_name="Officer", email="officer@bank.test", is_active=True),
               GRCUser(id=ANALYST, username="analyst", display_name="Ana Analyst", email="analyst@bank.test", is_active=True),
               GRCUser(id=OWNER, username="owner", display_name="Olu Owner", email="owner@bank.test", is_active=True),
               GRCUser(id=PLAIN, username="plain", display_name="Plain", email="plain@bank.test", is_active=True)])
    s.add_all([UserRole(user_id=OFFICER, role_id=1, tenant_id=1), UserRole(user_id=ANALYST, role_id=2, tenant_id=1),
               UserRole(user_id=OWNER, role_id=3, tenant_id=1)])
    s.add_all([BusinessUnit(id=RETAIL, tenant_id=1, name="Retail"), BusinessUnit(id=TREASURY, tenant_id=1, name="Treasury"),
               BusinessUnit(id=3, tenant_id=2, name="Theirs")])
    s.commit()
    yield s
    s.close()


@pytest.fixture()
def notes(monkeypatch):
    sent = []
    monkeypatch.setattr(routes, "send_workflow_notification", lambda db_, **kw: sent.append(kw) or {"notified_users": 1})
    return sent


def client(db, username="analyst"):
    app = FastAPI()
    app.include_router(erm_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username=username).one()
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": username})
    return http


def install_uae_ia(db, only=None):
    fw = UploadedFramework(name="UAE Information Assurance Standard", version="2.1", file_name="uae_ia.json", file_path="seed",
                           file_type="json", uploaded_by=OFFICER)
    db.add(fw)
    db.flush()
    for c in json.loads(FRAMEWORK_FILE.read_text(encoding="utf-8"))["controls"]:
        if only is None or c["control_id"] in only:
            db.add(ParsedFrameworkControl(uploaded_framework_id=fw.id, control_id=c["control_id"], title=c["title"]))
    db.commit()
    return fw


def live_risk(db, title, unit=RETAIL, category="operational", **kw):
    row = Risk(**{"tenant_id": 1, "title": title, "category": category, "risk_category": category, "business_unit_id": unit,
                  "status": "open", **kw})
    db.add(row)
    db.commit()
    return row


def propose(db, item=ITEM, unit=RETAIL, owner=OWNER, who="analyst"):
    sent = client(db, who).post(f"/erm/risk-library/{item}/propose", json={"business_unit_id": unit, "owner_id": owner, "note": "Fits"})
    assert sent.status_code == 201, sent.text
    return sent.json()


def drafted(db, owner="owner", **body):
    pid = propose(db, owner={"owner": OWNER, "officer": OFFICER}[owner])["id"]
    sent = client(db, owner).post(f"/erm/risk-library/proposals/{pid}/draft",
                                  json={"inherent_likelihood": 4, "inherent_impact": 3, **body})
    assert sent.status_code == 200, sent.text
    return pid, sent.json()["risk"]["id"]


# ── 1. Suggestions per unit ──────────────────────────────────────────────────

def test_suggestions_rank_by_adopted_requirements_and_unit_categories_say_why_and_skip_the_units_register(db):
    install_uae_ia(db, only={"M2.3.1"})
    live_risk(db, "Residual too high", source_type="risk_library", source_reference="uae_ia:M2.3:03")     # Retail has it already
    live_risk(db, "Treasury has this one", unit=TREASURY, category="financial", source_type="risk_library",
              source_reference="uae_ia:M2.3:04")
    got = client(db).get("/erm/risk-library/suggestions", params={"business_unit_id": RETAIL, "limit": 500})
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["unit"] == {"id": RETAIL, "name": "Retail"}
    items = body["items"]
    ids = [i["id"] for i in items]
    assert "uae_ia:M2.3:03" not in ids                                       # already in Retail's register
    assert "uae_ia:M2.3:04" in ids                                           # in Treasury's, not Retail's
    top = items[0]
    assert top["objective_id"] == "M2.3" and top["score"] == 3
    assert top["reasons"] == ["Matches UAE IA M2.3.1 you have adopted", "Retail already records operational risks"]
    assert all(i["reasons"] for i in items)                                  # nothing is suggested without a reason
    assert [i["score"] for i in items] == sorted((i["score"] for i in items), reverse=True)
    others = [i for i in items if i["objective_id"] != "M2.3"]
    assert others and all(i["suggested_category"] == "operational" and i["reasons"] == ["Retail already records operational risks"]
                          for i in others)
    assert body["total"] == len(items)
    assert client(db).get("/erm/risk-library/suggestions", params={"business_unit_id": 3}).status_code == 404   # another tenant's unit
    assert client(db).get("/erm/risk-library/units").json()["items"] == [{"id": RETAIL, "name": "Retail"},
                                                                         {"id": TREASURY, "name": "Treasury"}]


def test_a_unit_with_nothing_to_match_gets_no_suggestions(db):
    body = client(db).get("/erm/risk-library/suggestions", params={"business_unit_id": TREASURY}).json()
    assert body["items"] == [] and body["total"] == 0


# ── 2. Propose to the owner ──────────────────────────────────────────────────

def test_proposing_records_who_and_where_tells_the_owner_and_marks_the_list(db, notes):
    made = propose(db)
    row = db.get(RiskLibraryProposal, made["id"])
    assert (row.tenant_id, row.library_item_id, row.business_unit_id, row.owner_id, row.proposed_by, row.status) == (
        1, ITEM, RETAIL, OWNER, ANALYST, "proposed")
    assert made["unit_name"] == "Retail" and made["owner_name"] == "Olu Owner" and made["title"] == library.find(ITEM)["title"]
    assert len(notes) == 1 and notes[0]["user_ids"] == [OWNER] and notes[0]["tenant_id"] == 1
    assert notes[0]["link"] == f"/erm/risk-library?tab=proposals&proposal={row.id}"
    listed = client(db).get("/erm/risk-library", params={"objective": "M2.3"}).json()
    mark = {i["id"]: i for i in listed["items"]}[ITEM]
    assert mark["in_register"] is None and [(p["status"], p["unit_name"]) for p in mark["proposals"]] == [("proposed", "Retail")]
    # the same item for the same unit is not proposed twice while open; another unit may have it
    again = client(db).post(f"/erm/risk-library/{ITEM}/propose", json={"business_unit_id": RETAIL, "owner_id": OWNER})
    assert again.status_code == 409
    assert client(db).post(f"/erm/risk-library/{ITEM}/propose", json={"business_unit_id": TREASURY, "owner_id": OWNER}).status_code == 201


@pytest.mark.parametrize("who,body,expected", [
    ("owner", {}, 403), ("plain", {}, 403), ("analyst", {"business_unit_id": 3}, 404), ("analyst", {"business_unit_id": 99}, 404),
    ("analyst", {"owner_id": None}, 422)])
def test_a_wrong_proposal_is_refused(db, notes, who, body, expected):
    sent = client(db, who).post(f"/erm/risk-library/{ITEM}/propose", json={"business_unit_id": RETAIL, "owner_id": OWNER, **body})
    assert sent.status_code == expected, sent.text
    assert db.query(RiskLibraryProposal).count() == 0 and notes == []
    assert client(db).post("/erm/risk-library/uae_ia:ZZ:01/propose", json={"business_unit_id": RETAIL, "owner_id": OWNER}).status_code == 404


# ── 3. The owner drafts (or declines) ────────────────────────────────────────

def test_the_owner_confirms_and_drafts_a_score_making_a_draft_risk_that_remembers_the_item(db, notes):
    pid, rid = drafted(db)
    risk = db.get(Risk, rid)
    assert (risk.status, risk.source_type, risk.source_reference, risk.owner_id, risk.business_unit_id) == (
        "draft", "risk_library", ITEM, OWNER, RETAIL)
    assert (risk.inherent_likelihood, risk.inherent_impact, risk.inherent_score, risk.title) == (4, 3, 12, library.find(ITEM)["title"])
    row = db.get(RiskLibraryProposal, pid)
    assert (row.status, row.risk_id, row.drafted_by) == ("drafted", rid, OWNER)
    assert notes[-1]["user_ids"] == [ANALYST] and "challenge" in notes[-1]["subject"].lower()
    mine = client(db, "owner").get("/erm/risk-library/proposals", params={"mine": True}).json()["items"]
    assert [p["id"] for p in mine] == [pid] and mine[0]["risk"]["inherent_score"] == 12
    one = client(db).get(f"/erm/risk-library/proposals/{pid}").json()
    assert one["library_risk"]["id"] == ITEM and one["risk"]["status"] == "draft"
    # what each person may do now: the risk team challenges, the owner waits
    assert one["you"] == {"may_draft": False, "may_decline": False, "may_challenge": True}
    assert mine[0]["you"] == {"may_draft": False, "may_decline": False, "may_challenge": False}


def test_only_the_named_owner_drafts_and_only_once(db, notes):
    pid = propose(db)["id"]
    body = {"inherent_likelihood": 2, "inherent_impact": 2}
    assert client(db, "analyst").post(f"/erm/risk-library/proposals/{pid}/draft", json=body).status_code == 403
    assert client(db, "officer").post(f"/erm/risk-library/proposals/{pid}/draft", json=body).status_code == 403
    assert client(db, "owner").post(f"/erm/risk-library/proposals/{pid}/draft", json={"inherent_likelihood": 6, "inherent_impact": 2}).status_code == 422
    assert client(db, "owner").post(f"/erm/risk-library/proposals/{pid}/draft", json=body).status_code == 200
    assert client(db, "owner").post(f"/erm/risk-library/proposals/{pid}/draft", json=body).status_code == 409
    assert db.query(Risk).count() == 1


def test_the_owner_may_decline_with_a_reason_and_no_risk_is_made(db, notes):
    pid = propose(db)["id"]
    owner = client(db, "owner")
    assert owner.post(f"/erm/risk-library/proposals/{pid}/decline", json={"reason": "  "}).status_code == 400
    sent = owner.post(f"/erm/risk-library/proposals/{pid}/decline", json={"reason": "Retail has no such system"})
    assert sent.status_code == 200, sent.text
    row = db.get(RiskLibraryProposal, pid)
    assert (row.status, row.decline_reason, row.risk_id) == ("declined", "Retail has no such system", None)
    assert db.query(Risk).count() == 0 and notes[-1]["user_ids"] == [ANALYST]
    propose(db)                                                              # a declined one can be proposed again


# ── a draft does not count yet ───────────────────────────────────────────────

def test_a_draft_is_left_out_of_the_register_list_its_dashboards_and_appetite(db, notes):
    live_risk(db, "Counted", residual_score=4)
    db.add(RiskAppetiteConfig(tenant_id=1, category="operational", tolerance_threshold=5, max_acceptable_score=20, alert_enabled=True))
    db.commit()
    _, rid = drafted(db, inherent_likelihood=5, inherent_impact=5, category="operational")
    http = client(db, "officer")
    assert [r["title"] for r in http.get("/erm/risks").json()] == ["Counted"]
    assert [r["id"] for r in http.get("/erm/risks", params={"status_filter": "draft"}).json()] == [rid]
    dash = http.get("/erm/risks/dashboard").json()
    assert dash["total_risks"] == 1 and "draft" not in dash["by_status"]
    assert http.get("/erm/risks/dashboard/by-register").json()["total_risks"] == 1
    assert http.post("/erm/appetite/check").status_code == 200
    assert db.query(RiskAppetiteBreach).count() == 0
    assert http.get("/erm/appetite/breaches").json()["total_breaches"] == 0
    assert http.get(f"/erm/risks/{rid}").status_code == 200                 # the draft itself is still there to review
    assert http.get("/erm/analytics/heatmap").json()["total_risks"] == 1
    # the legacy /risks API the risk detail page still reads: same rule
    from grc.routers.risks_router import router as legacy_router
    app = FastAPI()
    app.include_router(legacy_router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.query(GRCUser).filter_by(username="officer").one()
    legacy = TestClient(app)
    legacy.headers["Authorization"] = "Bearer " + create_access_token({"sub": "officer"})
    got = legacy.get("/risks")
    assert got.status_code == 200, got.text
    assert [r["title"] for r in got.json()] == ["Counted"]
    assert [r["id"] for r in legacy.get("/risks", params={"status_filter": "draft"}).json()] == [rid]
    assert legacy.get("/risks/dashboard").json()["total_risks"] == 1


def test_a_draft_cannot_be_opened_by_editing_its_status(db, notes):
    _, rid = drafted(db)
    sent = client(db, "officer").put(f"/erm/risks/{rid}", json={"status": "open", "reason": "skip"})
    assert sent.status_code == 409 and db.get(Risk, rid).status == "draft"


# ── 4. The risk team challenges and accepts, or returns ──────────────────────

def test_the_person_who_drafted_cannot_accept_their_own_draft(db, notes):
    pid, rid = drafted(db, owner="officer")                                  # an administrator who owns the risk drafted it
    assert client(db, "officer").get(f"/erm/risk-library/proposals/{pid}").json()["you"]["may_challenge"] is False
    refused = client(db, "officer").post(f"/erm/risk-library/proposals/{pid}/accept", json={})
    assert refused.status_code == 409 and db.get(Risk, rid).status == "draft"
    assert client(db, "officer").post(f"/erm/risk-library/proposals/{pid}/return", json={"comment": "x"}).status_code == 409
    assert client(db, "analyst").post(f"/erm/risk-library/proposals/{pid}/accept", json={}).status_code == 200
    assert client(db, "owner").post(f"/erm/risk-library/proposals/{propose(db, unit=TREASURY)['id']}/accept", json={}).status_code == 403


def test_a_second_person_accepts_into_the_register_with_history_and_the_items_links(db, notes):
    install_uae_ia(db)
    m231 = db.query(ParsedFrameworkControl).filter_by(control_id="M2.3.1").one()
    nc = NormalizedControl(code="NC-RT-1", name="Risk treatment plan")
    db.add(nc)
    db.flush()
    db.add(NormalizedControlLink(normalized_control_id=nc.id, parsed_control_id=m231.id))
    db.commit()
    pid, rid = drafted(db)
    sent = client(db, "analyst").post(f"/erm/risk-library/proposals/{pid}/accept", json={"comment": "Agreed"})
    assert sent.status_code == 200, sent.text
    risk = db.get(Risk, rid)
    assert risk.status == "open" and sent.json()["risk"]["status"] == "open"
    # the one risk–control link (wave 5): the requirements and the mapped common control
    links = db.query(RiskControl).filter_by(risk_id=rid).order_by(RiskControl.id).all()
    assert sorted(db.get(ParsedFrameworkControl, l.control_id).control_id for l in links if l.control_source == "framework") == M23
    assert [l.control_id for l in links if l.control_source == "normalized"] == [nc.id]
    assert sent.json()["linked_requirements"] == M23 and sent.json()["linked_controls"] == ["NC-RT-1"]
    row = db.get(RiskLibraryProposal, pid)
    assert (row.status, row.reviewed_by, row.review_comment) == ("accepted", ANALYST, "Agreed")
    history = client(db, "officer").get(f"/erm/risks/{rid}/history").json()["changes"]
    accepted = next(c for c in history if c["changes"].get("status"))
    assert accepted["changes"]["status"] == {"from": "draft", "to": "open"} and accepted["user_id"] == ANALYST
    assert ITEM in accepted["reason"] and library.find(ITEM)["title"] in accepted["reason"]
    assert notes[-1]["user_ids"] == [OWNER]
    # now it is in the register: the list counts it and the library marks it for Retail
    assert [r["id"] for r in client(db, "officer").get("/erm/risks").json()] == [rid]
    mark = {i["id"]: i for i in client(db).get("/erm/risk-library", params={"objective": "M2.3"}).json()["items"]}[ITEM]
    assert mark["in_register"]["risk_id"] == rid and mark["in_register"]["units"] == ["Retail"] and mark["proposals"] == []
    assert ITEM not in [i["id"] for i in client(db).get("/erm/risk-library/suggestions", params={"business_unit_id": RETAIL}).json()["items"]]
    assert client(db, "analyst").post(f"/erm/risk-library/proposals/{pid}/accept", json={}).status_code == 409


def test_returning_sends_it_back_with_the_comment_and_the_owner_redrafts(db, notes):
    pid, rid = drafted(db)
    analyst = client(db, "analyst")
    assert analyst.post(f"/erm/risk-library/proposals/{pid}/return", json={"comment": " "}).status_code == 400
    sent = analyst.post(f"/erm/risk-library/proposals/{pid}/return", json={"comment": "Impact looks low for Retail"})
    assert sent.status_code == 200, sent.text
    row = db.get(RiskLibraryProposal, pid)
    assert (row.status, row.review_comment, db.get(Risk, rid).status) == ("returned", "Impact looks low for Retail", "draft")
    assert notes[-1]["user_ids"] == [OWNER] and "Impact looks low" in notes[-1]["message"]
    assert analyst.post(f"/erm/risk-library/proposals/{pid}/accept", json={}).status_code == 409    # nothing to accept until redrafted
    again = client(db, "owner").post(f"/erm/risk-library/proposals/{pid}/draft", json={"inherent_likelihood": 4, "inherent_impact": 5})
    assert again.status_code == 200 and again.json()["risk"]["id"] == rid
    assert (db.get(Risk, rid).inherent_score, db.get(RiskLibraryProposal, pid).status) == (20, "drafted")
    assert db.query(Risk).count() == 1


# ── 5. Adding straight from the library ──────────────────────────────────────

ADD = {"owner_id": OWNER, "inherent_likelihood": 4, "inherent_impact": 3}


@pytest.mark.parametrize("state", ["accepted", "closed", "Accepted", "mitigated"])
def test_adding_from_the_library_cannot_set_accepted_or_closed(db, state):
    sent = client(db, "officer").post(f"/erm/risk-library/{ITEM}/add-to-register", json={**ADD, "status": state})
    assert sent.status_code == 400 and db.query(Risk).count() == 0


def test_adding_straight_to_the_register_is_for_administrators_and_still_goes_through_draft(db, notes):
    assert client(db, "analyst").post(f"/erm/risk-library/{ITEM}/add-to-register", json=ADD).status_code == 403
    made = client(db, "officer").post(f"/erm/risk-library/{ITEM}/add-to-register", json={**ADD, "team_id": None})
    assert made.status_code == 201, made.text
    rid = made.json()["risk"]["id"]
    assert db.get(Risk, rid).status == "draft" and made.json()["risk"]["status"] == "draft"
    row = db.query(RiskLibraryProposal).filter_by(risk_id=rid).one()
    assert (row.status, row.drafted_by, row.proposed_by, row.owner_id) == ("drafted", OFFICER, OFFICER, OWNER)
    assert client(db, "officer").post(f"/erm/risk-library/proposals/{row.id}/accept", json={}).status_code == 409
    assert client(db, "analyst").post(f"/erm/risk-library/proposals/{row.id}/accept", json={}).status_code == 200
    assert db.get(Risk, rid).status == "open"


# ── 6. More libraries are data files ─────────────────────────────────────────

def test_the_loader_reads_every_library_file_and_skips_a_broken_one(tmp_path, monkeypatch):
    (tmp_path / "uae_ia.json").write_text((library.LIBRARY_DIR / "uae_ia.json").read_text(encoding="utf-8"), encoding="utf-8")
    (tmp_path / "demo.json").write_text(json.dumps({
        "framework": {"key": "demo", "name": "Demo Standard", "short_name": "Demo"},
        "families": [{"id": "D1", "name": "Doing", "kind": "Management", "suggested_category": "operational"}],
        "objectives": [{"id": "D1.1", "family_id": "D1", "title": "Do it", "objective": "To do it.",
                        "controls": [{"control_id": "D1.1.1", "title": "Do"}]}],
        "risks": [{"id": "demo:D1.1:01", "objective_id": "D1.1", "title": "Not done", "description": "It is not done."}]}), encoding="utf-8")
    (tmp_path / "broken.json").write_text('{"framework": {"key": "broken"}}', encoding="utf-8")
    monkeypatch.setattr(library, "LIBRARY_DIR", tmp_path)
    library._load.cache_clear()
    try:
        assert sorted(f["key"] for f in library.frameworks()) == ["demo", "uae_ia"]
        assert library.find("demo:D1.1:01")["title"] == "Not done" and library.short_name("demo") == "Demo"
        assert library.short_name("uae_ia") == "UAE IA"
        monkeypatch.setattr(library, "LIBRARY_DIR", tmp_path / "none")
        library._load.cache_clear()
        assert library.frameworks() == []
    finally:
        library._load.cache_clear()
