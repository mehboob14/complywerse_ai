"""One risk–control link and an editable bow-tie (wave 4, L2). In-memory SQLite.

grc_risk_controls is the one link of a risk to a control of any kind. The rows of the older link tables are copied in
once per database (the old rows stay as they were; wave 5), the old link endpoints write it, and risk_control_links() reads it with
the control's kind, type and latest tested effectiveness. The bow-tie saves its causes and consequences per risk, places
the linked controls by type, and a cause or consequence with no control on its side is a gap that can become an action.
"""
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import grc.models as m
from grc.models import get_db
from grc.modules.control_library.routers import workbench
from grc.modules.erm.router import router as erm_router
from grc.modules.erm.services.risk_control_links import copy_legacy_links, risk_control_links
from grc.modules.issue_management.services.risk_actions import risk_actions_query
from grc.routers.auth_router import create_access_token, require_auth

OFFICER = 7
TESTED, DUE = datetime(2026, 9, 30, 10, 0), datetime(2026, 12, 31, 0, 0)


@pytest.fixture()
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    s = sessionmaker(bind=engine)()
    s.add_all([m.Tenant(id=1, name="Bank", slug="bank"), m.Tenant(id=2, name="Other", slug="other")])
    s.add(m.Role(id=1, name="Administrator"))
    s.add(m.GRCUser(id=OFFICER, username="officer", display_name="Officer", email="officer@bank.test", is_active=True))
    s.add(m.UserRole(user_id=OFFICER, role_id=1, tenant_id=1))
    s.add_all([m.Risk(id=1, tenant_id=1, title="Wire fraud", category="operational", status="open",
                      root_cause="Manual keying of payment instructions", consequences="Customer funds lost",
                      inherent_likelihood=4, inherent_impact=4, inherent_score=16, residual_score=12),
               m.Risk(id=3, tenant_id=2, title="Someone else's risk", category="operational", status="open")])
    s.add_all([
        m.InternalControl(id=21, tenant_id=1, control_id="IC-021", name="Call-back on new payees", control_type="preventive",
                          operating_effectiveness="effective", last_tested_at=TESTED, next_test_date=DUE),
        m.InternalControl(id=22, tenant_id=1, control_id="IC-022", name="Daily exceptions review", control_type="detective"),
        m.InternalControl(id=29, tenant_id=2, control_id="IC-029", name="Not ours", control_type="preventive"),
        m.NormalizedControl(id=31, code="LIB-31", name="Payment limits"),
        m.FrameworkControl(id=41, objective_id=1, code="FC-41", name="Segregation of duties"),
        m.ParsedFrameworkControl(id=51, uploaded_framework_id=1, control_id="M2.3.1", title="Access reviews"),
    ])
    s.commit()
    yield s
    s.close()


def client(db):
    app = FastAPI()
    app.include_router(erm_router)
    app.include_router(workbench.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[require_auth] = lambda: db.get(m.GRCUser, OFFICER)
    http = TestClient(app)
    http.headers["Authorization"] = "Bearer " + create_access_token({"sub": "officer"})
    return http


def canonical(db, risk_id=1):
    return {(r.control_source, r.control_id): r for r in db.query(m.RiskControl).filter_by(risk_id=risk_id)}


def old_links(db):
    """One link in each old table (the work-item one repeats the internal-control one)."""
    wi = m.ControlWorkItem(id=61, tenant_id=1, source_type="internal", source_id=21, name="Call-back on new payees")
    db.add(wi)
    db.add_all([
        m.InternalControlRiskLink(id=1, control_id=21, risk_id=1, link_type="mitigates", notes="from the register"),
        m.ControlWorkRiskLink(id=1, work_item_id=61, tenant_id=1, risk_id=1),
        m.RiskControlLink(id=1, risk_id=1, normalized_control_id=31),
        m.RiskFrameworkControlLink(id=1, risk_id=1, framework_control_id=41, mitigation_effectiveness="partial"),
        m.RiskFrameworkRequirementLink(id=1, risk_id=1, uploaded_framework_id=1, parsed_control_id=51, control_code="M2.3.1"),
        m.InternalControlRiskLink(id=2, control_id=29, risk_id=3),                       # another tenant's
    ])
    db.commit()


# ── the copy ─────────────────────────────────────────────────────────────────

def test_the_copy_brings_each_old_link_in_once_and_leaves_the_old_rows_as_they_were(db):
    old_links(db)
    assert copy_legacy_links(db) == 5         # once per database; the work-item row repeats the internal-control link
    assert copy_legacy_links(db) == 0
    links = canonical(db)
    assert set(links) == {("internal", 21), ("normalized", 31), ("catalog", 41), ("framework", 51)}
    assert (links[("internal", 21)].legacy_table, links[("internal", 21)].legacy_id) == ("grc_internal_control_risk_links", 1)
    assert links[("internal", 21)].notes == "from the register" and links[("internal", 21)].tenant_id == 1
    for model in (m.InternalControlRiskLink, m.ControlWorkRiskLink, m.RiskControlLink, m.RiskFrameworkControlLink,
                  m.RiskFrameworkRequirementLink):
        assert db.query(model).filter(model.risk_id == 1).count() == 1   # kept
    assert set(canonical(db, 3)) == {("internal", 29)} and canonical(db, 3)[("internal", 29)].tenant_id == 2


def test_after_the_copy_the_old_tables_are_not_read(db):
    # wave 5: nothing writes the old tables any more, so a change there no longer reaches the one link
    old_links(db)
    copy_legacy_links(db)
    db.query(m.RiskFrameworkControlLink).delete()
    db.commit()
    copy_legacy_links(db)
    assert ("catalog", 41) in canonical(db)


# ── the old endpoints write it ───────────────────────────────────────────────

def test_a_link_made_through_the_internal_controls_endpoint_lands_in_the_canonical_table(db):
    http = client(db)
    made = http.post("/erm/internal-controls/21/risks", json={"risk_id": 1})
    assert made.status_code == 201, made.text
    row = canonical(db)[("internal", 21)]
    assert (row.id, row.created_by) == (made.json()["id"], OFFICER)               # wave 5: the response names the one link
    assert db.query(m.InternalControlRiskLink).count() == 0                       # and the old table is not written
    assert [r["risk_id"] for r in http.get("/erm/internal-controls/21/risks").json()] == [1]      # the old list still works
    assert http.delete(f"/erm/internal-controls/21/risks/{made.json()['id']}").status_code == 204
    assert canonical(db) == {}


def test_links_made_in_the_control_library_land_in_the_canonical_table_and_show_on_the_control(db):
    db.add_all([m.ControlWorkItem(id=62, tenant_id=1, source_type="normalized", source_id=31, name="Payment limits"),
                m.ControlWorkItem(id=63, tenant_id=1, source_type="framework", source_id=51, name="Access reviews")])
    db.commit()
    http = client(db)
    for wid in (62, 63):
        assert http.post(f"/workbench/items/{wid}/risks", json={"risk_id": 1}).status_code == 200
    assert set(canonical(db)) == {("normalized", 31), ("framework", 51)}
    assert db.query(m.RiskControlLink).count() == 0                  # wave 5: FAIR reads the one link, no twin is written
    detail = http.get("/workbench/controls/normalized/31").json()
    assert [(r["risk_id"], r["risk_title"]) for r in detail["risk_links"]] == [(1, "Wire fraud")]
    gone = http.delete(f"/workbench/risks/{detail['risk_links'][0]['id']}")
    assert gone.status_code == 200, gone.text
    assert set(canonical(db)) == {("framework", 51)} and db.query(m.RiskControlLink).count() == 0


# ── the read helper ──────────────────────────────────────────────────────────

def test_the_helper_gives_each_control_its_kind_type_and_latest_tested_effectiveness(db):
    old_links(db)
    copy_legacy_links(db)
    db.add(m.CustomControlProfile(tenant_id=1, normalized_control_id=31, control_type="corrective"))
    db.add(m.ControlWorkItem(id=64, tenant_id=1, source_type="normalized", source_id=31, name="Payment limits",
                             operating_effectiveness="partially_effective", last_tested_at=TESTED, next_test_date=DUE))
    db.commit()
    rows = {(r["kind"], r["control_id"]): r for r in risk_control_links(db, [1])[1]}
    assert set(rows) == {("internal", 21), ("library", 31), ("framework", 41), ("framework", 51)}
    internal, library = rows[("internal", 21)], rows[("library", 31)]
    assert (internal["name"], internal["code"], internal["control_type"], internal["effectiveness"]) == \
        ("Call-back on new payees", "IC-021", "preventive", "effective")
    assert (internal["last_tested_at"], internal["next_test_due"]) == ("2026-09-30T10:00:00", "2026-12-31T00:00:00")
    assert (library["control_type"], library["effectiveness"], library["last_tested_at"]) == \
        ("corrective", "partially_effective", "2026-09-30T10:00:00")
    catalog = rows[("framework", 41)]
    assert (catalog["control_type"], catalog["effectiveness"], catalog["last_tested_at"]) == (None, None, None)
    assert rows[("framework", 51)]["code"] == "M2.3.1"


def test_the_risk_record_lists_and_unlinks_its_controls_and_never_another_tenants(db):
    old_links(db)
    copy_legacy_links(db)
    http = client(db)
    got = http.get("/erm/internal-controls/risk-links/1")
    assert got.status_code == 200, got.text
    assert {c["kind"] for c in got.json()} == {"internal", "library", "framework"}
    link = next(c for c in got.json() if c["kind"] == "library")
    assert http.delete(f"/erm/internal-controls/risk-links/1/{link['link_id']}").status_code == 204
    assert ("normalized", 31) not in canonical(db)
    assert http.get("/erm/internal-controls/risk-links/3").status_code == 404
    theirs = canonical(db, 3)[("internal", 29)]
    assert http.delete(f"/erm/internal-controls/risk-links/3/{theirs.id}").status_code == 404
    assert http.delete(f"/erm/internal-controls/risk-links/1/{theirs.id}").status_code == 404
    assert http.post("/erm/internal-controls/29/risks", json={"risk_id": 1}).status_code == 404       # their control


# ── the bow-tie ──────────────────────────────────────────────────────────────

def test_causes_and_consequences_are_saved_edited_and_removed_and_seeded_from_the_record(db):
    db.add(m.RiskIncident(id=5, tenant_id=1, risk_id=1, title="Payday mis-keying", incident_date=TESTED,
                          root_cause="Fat-finger error on bulk upload"))
    db.commit()
    http = client(db)
    bow = http.get("/erm/analytics/bowtie/1").json()
    assert bow["threats"] == [] and bow["consequences"] == [] and bow["controls"] == []
    assert {(s["title"], s["source"]) for s in bow["suggested_causes"]} == {
        ("Manual keying of payment instructions", "risk_cause"), ("Fat-finger error on bulk upload", "loss_event")}
    assert bow["suggested_consequences"] == [{"title": "Customer funds lost", "source": "risk_consequence"}]

    cause = http.post("/erm/analytics/bowtie/1/items",
                      json={"side": "cause", "title": "Fat-finger error on bulk upload", "source": "loss_event"})
    assert cause.status_code == 201, cause.text
    loss = http.post("/erm/analytics/bowtie/1/items",
                     json={"side": "consequence", "title": "Customer funds lost", "impact_category": "financial"}).json()
    assert http.post("/erm/analytics/bowtie/1/items", json={"side": "middle", "title": "x"}).status_code == 422
    assert http.post("/erm/analytics/bowtie/1/items",
                     json={"side": "consequence", "title": "x", "impact_category": "cosmic"}).status_code == 422
    edited = http.put(f"/erm/analytics/bowtie/1/items/{loss['id']}",
                      json={"title": "Customer funds lost to fraud", "impact_category": "customer"})
    assert edited.status_code == 200 and edited.json()["impact_category"] == "customer"
    bow = http.get("/erm/analytics/bowtie/1").json()
    assert [c["title"] for c in bow["threats"]] == ["Fat-finger error on bulk upload"]
    assert [c["title"] for c in bow["consequences"]] == ["Customer funds lost to fraud"]
    assert [s["title"] for s in bow["suggested_causes"]] == ["Manual keying of payment instructions"]
    assert http.delete(f"/erm/analytics/bowtie/1/items/{cause.json()['id']}").status_code == 204
    assert http.get("/erm/analytics/bowtie/1").json()["threats"] == []
    assert http.post("/erm/analytics/bowtie/3/items", json={"side": "cause", "title": "x"}).status_code == 404
    assert http.get("/erm/analytics/bowtie/3").status_code == 404


def test_a_cause_with_no_preventive_control_or_a_consequence_with_no_mitigating_one_is_a_gap(db):
    http = client(db)
    assert http.post("/erm/internal-controls/21/risks", json={"risk_id": 1}).status_code == 201     # preventive
    cause = http.post("/erm/analytics/bowtie/1/items", json={"side": "cause", "title": "Manual keying"}).json()
    loss = http.post("/erm/analytics/bowtie/1/items", json={"side": "consequence", "title": "Funds lost"}).json()
    bow = http.get("/erm/analytics/bowtie/1").json()
    assert [(c["id"], c["kind"], c["effectiveness"]) for c in bow["preventive_controls"]] == [(21, "internal", "effective")]
    assert bow["mitigating_controls"] == []
    gaps = {i["id"]: i["gap"] for i in bow["threats"] + bow["consequences"]}
    assert gaps == {cause["id"]: False, loss["id"]: True}

    assert http.post("/erm/internal-controls/22/risks", json={"risk_id": 1}).status_code == 201     # detective
    detective = canonical(db)[("internal", 22)].id
    # placed on the consequence: covered; a cause that names only the detective control has no preventive one
    http.put(f"/erm/analytics/bowtie/1/items/{loss['id']}", json={"control_link_ids": [detective]})
    http.put(f"/erm/analytics/bowtie/1/items/{cause['id']}", json={"control_link_ids": [detective]})
    bow = http.get("/erm/analytics/bowtie/1").json()
    assert [c["id"] for c in bow["mitigating_controls"]] == [22]
    assert bow["mitigating_controls"][0]["effectiveness"] == "not assessed"
    assert {i["id"]: i["gap"] for i in bow["threats"] + bow["consequences"]} == {cause["id"]: True, loss["id"]: False}


def test_raising_an_action_for_a_gap_adds_one_action_on_the_risk(db):
    http = client(db)
    loss = http.post("/erm/analytics/bowtie/1/items", json={"side": "consequence", "title": "Funds lost"}).json()
    raised = http.post(f"/erm/analytics/bowtie/1/items/{loss['id']}/raise-action")
    assert raised.status_code == 201, raised.text
    actions = risk_actions_query(db, [1]).filter(m.Issue.source_id == 1).all()
    assert len(actions) == 1 and actions[0].id == raised.json()["action_id"]
    assert actions[0].title == "Add a mitigating control for: Funds lost" and actions[0].status == "planned"
    again = http.post(f"/erm/analytics/bowtie/1/items/{loss['id']}/raise-action")
    assert again.json()["action_id"] == actions[0].id and risk_actions_query(db, [1]).count() == 1
    item = next(i for i in http.get("/erm/analytics/bowtie/1").json()["consequences"] if i["id"] == loss["id"])
    assert item["gap_action_id"] == actions[0].id

    http.post("/erm/internal-controls/21/risks", json={"risk_id": 1})
    cause = http.post("/erm/analytics/bowtie/1/items", json={"side": "cause", "title": "Manual keying"}).json()
    assert http.post(f"/erm/analytics/bowtie/1/items/{cause['id']}/raise-action").status_code == 409     # no gap


# ── effectiveness → residual: proposed, never written ────────────────────────

def test_a_signed_off_control_test_proposes_the_residual_through_a_risk_review(db):
    http = client(db)
    assert http.post("/erm/internal-controls/21/risks", json={"risk_id": 1}).status_code == 201
    db.add(m.ControlWorkItem(id=61, tenant_id=1, source_type="internal", source_id=21, name="Call-back on new payees",
                             operating_effectiveness="effective", last_tested_at=TESTED))
    db.add(m.ControlWorkTest(id=1, work_item_id=61, tenant_id=1, test_type="operating", result="effective",
                             status="completed", tester_id=8))
    db.commit()
    signed = http.post("/workbench/tests/1/review", json={"action": "reviewed"})
    assert signed.status_code == 200, signed.text
    review = db.query(m.RiskReview).filter_by(risk_id=1).one()
    assert (review.status, review.proposed_residual_likelihood, review.proposed_residual_impact) == ("submitted", 2, 4)
    assert review.submitted_by == OFFICER and db.get(m.Risk, 1).residual_likelihood is None        # not written
    http.post("/workbench/tests/1/review", json={"action": "reopen"})
    http.post("/workbench/tests/1/review", json={"action": "reviewed"})
    assert db.query(m.RiskReview).filter_by(risk_id=1).count() == 1                                  # not twice
