"""Sub-controls inside a control on the journey (UAE IA, round 5): an owner per sub-control, a file attached to one of them, and what
the control list says about both.

Owners live in `ControlImplementation.sub_control_state` ({code: {"assigned_user_ids": [...]}}), a file's sub-control in
`ImplementationEvidence.sub_control_code` (NULL = the control itself). `PATCH .../sub-controls/{code}/assign` follows the rules of the
control's own assign; `POST .../evidence` takes an optional `sub_control_code`; `GET .../controls` carries both. Control counts, review
and unlink are the control's, as before.

Every fixture is small and made here; the last test reads the real catalog and skips until it carries the data. In-memory SQLite, the
router mounted on a bare app, the AI review replaced by a recorder and the upload folder by a temporary one: nothing leaves the process.
"""
import copy
import importlib
import json
import os
import re
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import JSON, String, create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy.pool import StaticPool

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

import grc.models as m  # noqa: E402
from grc.modules.compliance.schema_migrations import _COLUMN_ADDS, _ensure_column  # noqa: E402
from grc.seed_frameworks import seed_framework_from_json  # noqa: E402
from grc.services.evidence_quality import QualityTarget  # noqa: E402

certs = importlib.import_module("grc.routers.certification_router")      # the module, not the APIRouter the package exports
auth = importlib.import_module("grc.routers.auth_router")

SEED = Path(__file__).resolve().parents[1] / "grc" / "seed_data"

OWNER, ANNA, BEN, GONE, IMPORTED, PLAINNAME = 7, 8, 9, 10, 11, 12
PEOPLE = {
    ANNA: {"id": ANNA, "display_name": "Anna Analyst", "email": "anna@bank.example"},
    BEN: {"id": BEN, "display_name": "Ben Builder", "email": "ben@bank.example"},
    PLAINNAME: {"id": PLAINNAME, "display_name": "dana", "email": "dana@bank.example"},          # no display name: the username
}

HIER, PLAIN = "Test Tracking Standard", "Test Plain Standard"          # no "iso" / "pci" in a name: the page would call it a certification

EVIDENCE = [
    {"name": "Register", "description": "The register itself.", "filetype": "XLSX"},
    {"name": "Review minutes", "description": "Minutes of the yearly review.", "filetype": "PDF"},
    {"name": "Top management approval", "description": "Signed approval of the policy.", "filetype": "PDF"},
]
CRITERIA = ["The entity shall: keep a register of assets.", "The entity shall: review it yearly."]
LONG_TEXT = "retain every record of the review for five years. " * 6                        # 300 characters: the label is cut at 120
SUB_ONE = {"code": "T1.1.1.1", "number": 1, "text": "keep a register of assets.", "lead_in": "The entity shall:", "criterion_index": 0,
           "consideration": False,
           "points": [{"label": "a.", "text": "the owner", "points": [{"label": "•", "text": "by name"}]}, {"label": "b.", "text": "the date"}],
           "evidence": ["Register"]}
NATIVE = {
    "priority_tier": "P1", "applicability": "Always applicable", "control_types": ["Preventive"],
    "implementation_guidance": "Keep it current.", "control_evidence": [],
    "sub_controls": [
        SUB_ONE,
        {"code": "T1.1.1.2", "number": 2, "text": "review it yearly.", "lead_in": "The entity shall:", "criterion_index": 1,
         "consideration": False, "points": [], "evidence": ["Review minutes", "Register"]},
        {"code": "T1.1.1.3", "number": 3, "text": "When defining it, the entity shall take the following into account: its size.",
         "lead_in": None, "criterion_index": None, "consideration": True, "points": [], "evidence": ["Review minutes"]},
    ],
}
NATIVE_B = {
    "priority_tier": "P2", "applicability": "Based on risk assessment", "control_types": [], "implementation_guidance": None,
    "control_evidence": [],
    "sub_controls": [
        {"code": "T1.1.4.1", "number": 1, "text": "name an owner.", "lead_in": None, "criterion_index": 0, "consideration": False,
         "points": [], "evidence": ["Register"]},
        {"code": "T1.1.4.2", "number": 2, "text": LONG_TEXT, "lead_in": None, "criterion_index": 1, "consideration": False,
         "points": [], "evidence": ["Review minutes"]},
    ],
}


def _control(cid, parent="T1.1", native=None, criteria=(), evidence=(), **extra):
    row = {"control_id": cid, "original_reference": cid, "title": f"Control {cid}", "description": f"The entity shall {cid}.",
           "full_text": f"The entity shall {cid}.", "domain": "T1 Technical", "category": "T1.1 Assets", "parent_section": parent,
           "is_mandatory": True, "priority": "high", "assessment_criteria": list(criteria), "evidence_requirements": list(evidence)}
    if native is not None:
        row["native_attributes"] = native
    return {**row, **extra}


def _library(name, controls):
    return {"metadata": {"name": name, "version": "1", "classification": "regulatory", "framework_type": "regulatory"}, "controls": controls}


HIER_DATA = _library(HIER, [
    _control("T1.1.1", native=NATIVE, criteria=CRITERIA, evidence=EVIDENCE),
    _control("T1.1.4", native=NATIVE_B, criteria=CRITERIA, evidence=EVIDENCE),
    # attributes but no sub-controls (an Annex F mapping row), then odd values of every kind
    _control("T1.1.2", native={"priority_tier": None, "applicability": "Based on risk assessment", "control_types": [],
                               "implementation_guidance": None, "control_evidence": [], "sub_controls": []}, evidence=EVIDENCE[:1]),
    _control("T1.1.3", native={"sub_controls": "oops"}, evidence=EVIDENCE[:1]),
    _control("T1.2.1", parent="T1.2", native=["not", "a", "dict"], evidence=EVIDENCE[:1]),
    _control("T1.2.2", parent="T1.2", evidence=EVIDENCE[:1]),                       # a control of that framework without any
])
PLAIN_DATA = _library(PLAIN, [_control("A.1", parent=None, evidence=EVIDENCE[:2])])

# what an evidence entry of the control list carried before this round, and what it gained
ATTACHED_KEYS = {"id", "file_name", "file_size", "uploaded_at", "ai_confidence_score", "review_status", "linked_evidence_id",
                 "ai_assessment_status", "ai_assessment_summary", "maturity"}
MAPPED_KEYS = {"id", "item_type", "file_name", "file_size", "uploaded_at", "ai_confidence_score", "review_status", "linked_evidence_id",
               "ai_assessment_status", "ai_assessment_summary"}
# a control of the list has these keys, with or without sub-controls: this round adds none to the control, only to its nodes and files
CONTROL_KEYS = {
    "id", "journey_id", "framework_control_id", "parsed_control_id", "control_code", "original_control_code", "system_control_code",
    "control_name", "control_statement", "control_statement_full", "domain_id", "domain_code", "domain_name", "objective_code",
    "objective_name", "status", "implementation_notes", "implementation_date", "verified_date", "is_applicable", "priority",
    "is_critical", "criticality_reason", "priority_level", "dependencies", "version_history", "control_description",
    "assessment_criteria", "criteria_status", "assigned_to_user_id", "assignee_name", "assignee_email", "assigned_user_ids",
    "assignees", "sub_controls", "evidence_requirements", "evidence_recommendations", "evidence", "evidence_count",
    "required_evidence_count", "approved_evidence_count", "evidence_coverage", "status_source", "open_issues_count",
    "parent_section", "priority_tier", "applicability", "control_types", "implementation_guidance", "control_evidence",
    "sub_control_tree",
}


@pytest.fixture(scope="module")
def engine():
    """The schema is made once (it takes seconds); each test starts from empty tables."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    return engine


@pytest.fixture
def world(engine, tmp_path, monkeypatch):
    db = sessionmaker(bind=engine, autoflush=False)()                                       # the tenant sessions do not autoflush either
    db.info["tenant_slug"] = "demo"
    db.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
    for uid, name, extra in [
        (OWNER, "Olive Owner", {}),
        (ANNA, "Anna Analyst", {}),
        (BEN, "Ben Builder", {}),
        (GONE, "Gina Gone", {"is_active": False}),
        (IMPORTED, "Ivan Imported", {"external_provider": "okta", "external_id": "okta:1", "access_synced_at": datetime.utcnow()}),
        (PLAINNAME, None, {}),
    ]:
        first = (name or "dana").split()[0].lower()
        db.add(m.GRCUser(id=uid, username=first, email=f"{first}@bank.example", display_name=name, **extra))
    db.commit()
    me = db.get(m.GRCUser, OWNER)

    reviews, uploads = [], tmp_path / "uploads"

    def record(_db, evidence, slug, **kwargs):                                              # the AI review: asked, never run
        reviews.append(SimpleNamespace(evidence_id=evidence.id, slug=slug, **kwargs))
        return True

    monkeypatch.setattr(certs.evidence_review, "start", record)
    monkeypatch.setattr(certs, "EVIDENCE_LIBRARY_UPLOAD_DIR", str(uploads))

    app = FastAPI()
    app.include_router(certs.router)
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[auth.require_auth] = lambda: me
    http = TestClient(app)

    def start(data):
        fw = seed_framework_from_json(db, copy.deepcopy(data), tenant_id=1)
        db.commit()
        journey = http.post("/certifications", json={"framework_id": fw.id, "name": f"{fw.name} journey"})
        assert journey.status_code == 201, journey.text
        return journey.json()["id"]

    def controls(journey_id):
        got = http.get(f"/certifications/{journey_id}/controls")
        assert got.status_code == 200, got.text
        return {c["control_code"]: c for c in got.json()}

    def assign(journey_id, impl_id, code, ids):
        return http.patch(f"/certifications/{journey_id}/controls/{impl_id}/sub-controls/{code}/assign", json={"assigned_user_ids": ids})

    def upload(journey_id, impl_id, name="plan.txt", content=b"The asset register.", code=None, mime="text/plain"):
        data = {} if code is None else {"sub_control_code": code}
        return http.post(f"/certifications/{journey_id}/controls/{impl_id}/evidence", files={"file": (name, content, mime)}, data=data)

    def link(journey_id, impl_id, evidence_id, code=None):
        data = {"evidence_id": str(evidence_id), **({} if code is None else {"sub_control_code": code})}
        return http.post(f"/certifications/{journey_id}/controls/{impl_id}/evidence", data=data)

    def row(model, pk):
        db.expire_all()
        return db.get(model, pk)

    yield SimpleNamespace(db=db, engine=engine, http=http, start=start, controls=controls, assign=assign, upload=upload, link=link,
                          row=row, impl=lambda journey_id, code: controls(journey_id)[code]["id"], reviews=reviews,
                          files=lambda: sorted(p.relative_to(uploads) for p in uploads.rglob("*") if p.is_file()))
    db.close()
    with engine.begin() as conn:                                                            # SQLite does not enforce the foreign keys: any order
        for table in m.Base.metadata.tables.values():
            conn.execute(table.delete())


# ── the two columns ──────────────────────────────────────────────────────────────────────────────

def test_the_columns_are_in_the_models_and_in_column_adds_and_an_old_tenant_gets_them():
    state = m.ControlImplementation.__table__.c.sub_control_state
    code = m.ImplementationEvidence.__table__.c.sub_control_code
    assert isinstance(state.type, JSON) and state.nullable
    assert isinstance(code.type, String) and code.type.length == 64 and code.nullable
    wanted = [("grc_control_implementations", "sub_control_state", "JSON", None),
              ("grc_implementation_evidence", "sub_control_code", "VARCHAR(64)", None)]
    for entry in wanted:
        assert _COLUMN_ADDS.count(entry) == 1, entry
    # a tenant database made before the columns existed gets them from those entries, and keeps its rows as they were
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE grc_control_implementations (id INTEGER PRIMARY KEY, journey_id INTEGER)"))
        conn.execute(text("CREATE TABLE grc_implementation_evidence (id INTEGER PRIMARY KEY, implementation_id INTEGER, file_name VARCHAR(255))"))
        conn.execute(text("INSERT INTO grc_control_implementations (id, journey_id) VALUES (1, 5)"))
        conn.execute(text("INSERT INTO grc_implementation_evidence (id, implementation_id, file_name) VALUES (1, 1, 'plan.pdf')"))
    for table, column, ddl, _index in wanted:
        assert _ensure_column(engine, table, column, ddl) is True
        assert _ensure_column(engine, table, column, ddl) is True                       # again: nothing left to add
    with engine.begin() as conn:
        assert conn.execute(text("SELECT id, journey_id, sub_control_state FROM grc_control_implementations")).one() == (1, 5, None)
        assert conn.execute(text("SELECT id, file_name, sub_control_code FROM grc_implementation_evidence")).one() == (1, "plan.pdf", None)
        conn.execute(text("UPDATE grc_control_implementations SET sub_control_state = :v"),
                     {"v": json.dumps({"M1.1.1.1": {"assigned_user_ids": [3]}})})
        conn.execute(text("UPDATE grc_implementation_evidence SET sub_control_code = 'M1.1.1.1'"))
        stored = conn.execute(text("SELECT sub_control_state FROM grc_control_implementations")).scalar()
        assert json.loads(stored) == {"M1.1.1.1": {"assigned_user_ids": [3]}}
        assert conn.execute(text("SELECT sub_control_code FROM grc_implementation_evidence")).scalar() == "M1.1.1.1"


# ── the small readers ────────────────────────────────────────────────────────────────────────────

def test_the_nodes_and_the_owners_are_read_from_odd_values_without_raising():
    assert certs._sub_control_nodes(NATIVE) == NATIVE["sub_controls"]
    for odd in (None, [], "x", 5, {}, {"sub_controls": None}, {"sub_controls": "oops"}, {"sub_controls": {}},
                {"sub_controls": [None, "x", 4, {"no": "code"}, {"code": 7}, {"code": ["x"]}]}):
        assert certs._sub_control_nodes(odd) == [], odd
    assert [n["code"] for n in certs._sub_control_nodes({"sub_controls": ["junk", {"code": "Z.1"}, {"code": "Z.2", "x": 1}]})] == ["Z.1", "Z.2"]

    owners = certs._sub_control_owners
    assert owners({"A": {"assigned_user_ids": [3, 5]}, "B": {"assigned_user_ids": []}, "C": {"assigned_user_ids": [8]}}) == {"A": [3, 5], "C": [8]}
    for odd in (None, [], "x", 5, {"A": None}, {"A": "x"}, {"A": {}}, {"A": []}, {"A": {"assigned_user_ids": "3"}},
                {"A": {"assigned_user_ids": None}}, {"A": {"assigned_user_ids": [None, "3"]}}):
        assert owners(odd) == {}, odd
    assert owners({"A": {"assigned_user_ids": [True, "3", None, 4.5, 8, {}]}}) == {"A": [8]}            # only whole numbers are ids


def test_the_ask_a_file_is_rated_against_is_the_sub_controls_own_words():
    assert certs._sub_control_requirement(SUB_ONE) == "The entity shall: keep a register of assets.\na. the owner\n  • by name\nb. the date"
    assert certs._sub_control_requirement({"text": "Do it."}) == "Do it."
    assert certs._sub_control_requirement({"lead_in": "The entity shall:", "text": "Do it.", "points": []}) == "The entity shall: Do it."
    # odd values are skipped, a point without a label keeps its text
    assert certs._sub_control_requirement({"lead_in": 3, "text": None, "points": "x"}) == ""
    odd = {"text": "T", "points": [None, "x", {"label": 5, "text": "kept"}, {"text": 7}, {"label": "a.", "text": "p", "points": {"x": 1}}]}
    assert certs._sub_control_requirement(odd) == "T\nkept\na. p"


def test_the_tree_carries_each_nodes_owners_and_never_changes_what_was_stored():
    native = copy.deepcopy(NATIVE)
    owners = {"T1.1.1.1": [PEOPLE[ANNA], PEOPLE[BEN]]}
    tree = certs._sub_control_tree(native, {"0": True}, owners)
    assert [(n["code"], n["met"], n["assigned_user_ids"]) for n in tree] == [
        ("T1.1.1.1", True, [ANNA, BEN]), ("T1.1.1.2", False, []), ("T1.1.1.3", None, [])]
    assert tree[0]["assignees"] == owners["T1.1.1.1"] and tree[0]["assignees"] is not owners["T1.1.1.1"]
    assert tree[1]["assignees"] == [] and tree[1]["assignees"] is not tree[2]["assignees"]
    assert native == NATIVE and owners == {"T1.1.1.1": [PEOPLE[ANNA], PEOPLE[BEN]]}            # nothing added to the stored nodes
    # a node whose code is missing or is not text has no owners and raises nothing
    odd = {"sub_controls": [{"code": ["x"]}, {"code": None}, {}, "junk"]}
    assert [(n["assigned_user_ids"], n["assignees"]) for n in certs._sub_control_tree(odd, {}, owners)] == [([], [])] * 3
    # asked as in round 4 (no owners): the same nodes, with nobody on them
    assert certs._sub_control_tree(native, {}) == [
        {**s, "met": met, "assigned_user_ids": [], "assignees": []} for s, met in zip(NATIVE["sub_controls"], [False, False, None])]


# ── PATCH .../sub-controls/{code}/assign ─────────────────────────────────────────────────────────

def test_owners_are_set_per_sub_control_and_leave_the_control_alone(world):
    journey = world.start(HIER_DATA)
    impl = world.impl(journey, "T1.1.1")
    got = world.assign(journey, impl, "T1.1.1.1", [ANNA, BEN, ANNA])                         # a duplicate is dropped, the order is kept
    assert got.status_code == 200, got.text
    assert got.json() == {"control_id": impl, "code": "T1.1.1.1", "assigned_user_ids": [ANNA, BEN],
                          "assignees": [PEOPLE[ANNA], PEOPLE[BEN]]}
    assert world.row(m.ControlImplementation, impl).sub_control_state == {"T1.1.1.1": {"assigned_user_ids": [ANNA, BEN]}}

    one = world.controls(journey)["T1.1.1"]
    tree = {n["code"]: n for n in one["sub_control_tree"]}
    assert (tree["T1.1.1.1"]["assigned_user_ids"], tree["T1.1.1.1"]["assignees"]) == ([ANNA, BEN], [PEOPLE[ANNA], PEOPLE[BEN]])
    assert all((tree[c]["assigned_user_ids"], tree[c]["assignees"]) == ([], []) for c in ("T1.1.1.2", "T1.1.1.3"))
    # the control's own owners, status, ticks and files are as they were, and so is every tick on the nodes
    assert (one["assigned_user_ids"], one["assignees"], one["assigned_to_user_id"]) == ([], [], None)
    assert (one["status"], one["criteria_status"], one["evidence_count"]) == ("not_started", {}, 0)
    assert [n["met"] for n in one["sub_control_tree"]] == [False, False, None]
    assert world.controls(journey)["T1.1.4"]["sub_control_tree"][0]["assigned_user_ids"] == []              # another control: nobody

    # a second sub-control, and a sub-control of another control, are their own
    assert world.assign(journey, impl, "T1.1.1.2", [PLAINNAME]).json()["assignees"] == [PEOPLE[PLAINNAME]]   # no display name: the username
    other = world.impl(journey, "T1.1.4")
    assert world.assign(journey, other, "T1.1.4.1", [ANNA]).status_code == 200
    state = lambda control: world.row(m.ControlImplementation, control).sub_control_state                      # noqa: E731
    assert state(impl) == {"T1.1.1.1": {"assigned_user_ids": [ANNA, BEN]}, "T1.1.1.2": {"assigned_user_ids": [PLAINNAME]}}
    assert state(other) == {"T1.1.4.1": {"assigned_user_ids": [ANNA]}}

    # a new list replaces the old one; an empty list removes the key (the other sub-control keeps its owner), the last one leaves {}
    assert world.assign(journey, impl, "T1.1.1.1", [BEN]).json()["assigned_user_ids"] == [BEN]
    assert state(impl)["T1.1.1.1"] == {"assigned_user_ids": [BEN]}
    gone = world.assign(journey, impl, "T1.1.1.1", [])
    assert gone.json() == {"control_id": impl, "code": "T1.1.1.1", "assigned_user_ids": [], "assignees": []}
    assert state(impl) == {"T1.1.1.2": {"assigned_user_ids": [PLAINNAME]}}
    assert world.assign(journey, impl, "T1.1.1.2", []).status_code == 200 and state(impl) == {}
    assert world.assign(journey, impl, "T1.1.1.3", []).status_code == 200 and state(impl) == {}              # nothing set, nothing added
    assert all(n["assigned_user_ids"] == [] for n in world.controls(journey)["T1.1.1"]["sub_control_tree"])


def test_a_reassignment_changes_a_copy_never_the_stored_value(world):
    journey = world.start(HIER_DATA)
    impl = world.impl(journey, "T1.1.1")
    world.assign(journey, impl, "T1.1.1.1", [ANNA])
    stored = world.row(m.ControlImplementation, impl)         # kept: the session holds its objects weakly, and the endpoint must be handed this one
    before = stored.sub_control_state                         # the very dict the next assignment reads
    assert before == {"T1.1.1.1": {"assigned_user_ids": [ANNA]}}
    held = copy.deepcopy(before)
    world.assign(journey, impl, "T1.1.1.1", [BEN])
    world.assign(journey, impl, "T1.1.1.2", [ANNA])
    assert before == held                                                                    # not changed in place
    assert stored.sub_control_state == {"T1.1.1.1": {"assigned_user_ids": [BEN]}, "T1.1.1.2": {"assigned_user_ids": [ANNA]}}


def _owners_at(world, impl, path):
    row = world.row(m.ControlImplementation, impl)
    return row.assigned_user_ids if path == "assign" else ((row.sub_control_state or {}).get("T1.1.1.1") or {}).get("assigned_user_ids", [])


BOTH_LEVELS = ["assign", "sub-controls/T1.1.1.1/assign"]          # the requirement's own owners, and one sub-control's


@pytest.mark.parametrize("path", BOTH_LEVELS)
def test_both_levels_take_the_same_people_under_the_same_rules(world, path):
    journey = world.start(HIER_DATA)
    impl = world.impl(journey, "T1.1.1")
    url = f"/certifications/{journey}/controls/{impl}/{path}"
    body = world.http.patch(url, json={"assigned_user_ids": [BEN, ANNA, BEN]})                 # in the order given, once each
    assert body.status_code == 200, body.text
    assert body.json()["assigned_user_ids"] == [BEN, ANNA] and body.json()["assignees"] == [PEOPLE[BEN], PEOPLE[ANNA]]
    assert _owners_at(world, impl, path) == [BEN, ANNA]
    # not a user of this tenant, a deactivated user, an account an access review imported: the request fails whole, nothing changes
    for ids, detail in [([999], "User 999 is not an active member of this tenant"),
                        ([ANNA, GONE], "User 10 is not an active member of this tenant"),
                        ([BEN, IMPORTED], "Ivan Imported is an account an access review imported")]:
        bad = world.http.patch(url, json={"assigned_user_ids": ids})
        assert bad.status_code == 400 and detail in bad.json()["detail"], (ids, bad.text)
        assert _owners_at(world, impl, path) == [BEN, ANNA]
    # an empty list withdraws everybody
    assert world.http.patch(url, json={"assigned_user_ids": []}).json()["assigned_user_ids"] == []
    assert _owners_at(world, impl, path) == []


@pytest.mark.parametrize("path", BOTH_LEVELS)
def test_both_levels_let_an_owner_already_named_stay_but_name_nobody_new_from_an_import(world, path):
    journey = world.start(HIER_DATA)
    impl = world.impl(journey, "T1.1.1")
    row = world.row(m.ControlImplementation, impl)
    if path == "assign":
        row.assigned_user_ids, row.assigned_to_user_id = [IMPORTED], None                      # named before the account was imported
    else:
        row.sub_control_state = {"T1.1.1.1": {"assigned_user_ids": [IMPORTED]}}
    world.db.commit()
    url = f"/certifications/{journey}/controls/{impl}/{path}"
    assert world.http.patch(url, json={"assigned_user_ids": [IMPORTED, ANNA]}).status_code == 200      # sent back as it is
    assert _owners_at(world, impl, path) == [IMPORTED, ANNA]
    elsewhere = (f"/certifications/{journey}/controls/{world.impl(journey, 'T1.1.4')}/assign" if path == "assign"
                 else f"/certifications/{journey}/controls/{impl}/sub-controls/T1.1.1.2/assign")
    assert world.http.patch(elsewhere, json={"assigned_user_ids": [IMPORTED]}).status_code == 400    # not named there: refused


def test_the_control_level_assign_is_what_it_was(world):
    """The requirement's own assign shares its people rules with the sub-control's: its answer and its legacy shape stay."""
    journey = world.start(HIER_DATA)
    impl = world.impl(journey, "T1.1.1")
    url = f"/certifications/{journey}/controls/{impl}/assign"
    got = world.http.patch(url, json={"assigned_user_ids": [ANNA, BEN]}).json()
    assert got == {"message": "Requirement assignees updated", "control_id": impl, "journey_id": journey,
                   "assigned_user_ids": [ANNA, BEN], "assignees": [PEOPLE[ANNA], PEOPLE[BEN]],
                   "assigned_to_user_id": ANNA, "assignee_name": "Anna Analyst", "assignee_email": "anna@bank.example"}
    row = world.row(m.ControlImplementation, impl)
    assert (row.assigned_user_ids, row.assigned_to_user_id, row.sub_control_state) == ([ANNA, BEN], ANNA, None)
    one = world.controls(journey)["T1.1.1"]
    assert (one["assigned_user_ids"], one["assignee_name"]) == ([ANNA, BEN], "Anna Analyst")
    assert [n["assigned_user_ids"] for n in one["sub_control_tree"]] == [[], [], []]            # the control's owners are not the sub-controls'
    # the old single-id shape is one owner; no list and no id clears
    assert world.http.patch(url, json={"assigned_to_user_id": BEN}).json()["assigned_user_ids"] == [BEN]
    assert world.http.patch(url, json={}).json()["assigned_user_ids"] == []
    assert world.row(m.ControlImplementation, impl).assigned_to_user_id is None
    assert world.http.patch(f"/certifications/{journey}/controls/9999/assign", json={"assigned_user_ids": []}).status_code == 404


def test_a_sub_control_the_control_does_not_have_is_not_found_and_nothing_is_stored(world):
    journey = world.start(HIER_DATA)
    impl = world.impl(journey, "T1.1.1")
    # unknown, another case, another shape, the control's own id, another control's sub-control
    for code in ("T9.9.9.9", "t1.1.1.1", " T1.1.1.1", "T1.1.1.1.", "T1.1.1", "T1.1.4.1"):
        got = world.assign(journey, impl, code, [ANNA])
        assert got.status_code == 404 and got.json()["detail"] == "Sub-control not found", code
    assert world.assign(journey, impl, "T9.9.9.9", [999]).status_code == 404                  # the code is asked before the people
    # a control with no sub-controls at all: an empty list, an odd value, a list instead of a dict, no attributes
    for code in ("T1.1.2", "T1.1.3", "T1.2.1", "T1.2.2"):
        got = world.assign(journey, world.impl(journey, code), "T1.1.1.1", [ANNA])
        assert got.status_code == 404 and got.json()["detail"] == "Sub-control not found", code
    # an unknown control, an unknown journey, a body without the list
    base = f"/certifications/{journey}/controls"
    assert world.assign(journey, 9999, "T1.1.1.1", [ANNA]).json()["detail"] == "Control implementation not found"
    assert world.assign(9999, impl, "T1.1.1.1", [ANNA]).json()["detail"] == "Certification journey not found"
    for body in ({}, {"assigned_user_ids": "x"}, {"assigned_user_ids": [ANNA, "x"]}):
        assert world.http.patch(f"{base}/{impl}/sub-controls/T1.1.1.1/assign", json=body).status_code == 422, body
    world.db.expire_all()
    assert all(r.sub_control_state is None for r in world.db.query(m.ControlImplementation))


def test_a_state_of_an_odd_shape_never_breaks_the_list_or_the_next_assignment(world):
    journey = world.start(HIER_DATA)
    impl = world.impl(journey, "T1.1.1")
    first = ("T1.1.1.1", "T1.1.1.2")
    for junk in (["x"], "oops", 7, {}, {"T1.1.1.1": "oops"}, {"T1.1.1.1": {}}, {"T1.1.1.1": {"assigned_user_ids": "x"}},
                 {"T1.1.1.1": {"assigned_user_ids": [True, "8", None, 999]}}, {"T9.9.9.9": {"assigned_user_ids": [ANNA]}}):
        row = world.row(m.ControlImplementation, impl)
        row.sub_control_state = junk
        flag_modified(row, "sub_control_state")
        world.db.commit()
        tree = world.controls(journey)["T1.1.1"]["sub_control_tree"]
        assert [(n["assigned_user_ids"], n["assignees"]) for n in tree] == [([], [])] * 3, junk       # an id nobody has is not shown
        assert world.assign(journey, impl, first[0], [ANNA]).status_code == 200, junk
        assert world.row(m.ControlImplementation, impl).sub_control_state[first[0]] == {"assigned_user_ids": [ANNA]}
    # good ids among bad ones are shown; what is stored for other codes is left alone by an assignment
    row = world.row(m.ControlImplementation, impl)
    row.sub_control_state = {"T1.1.1.1": {"assigned_user_ids": [True, "8", None, 999, BEN]}, "T1.1.1.2": "oops"}
    flag_modified(row, "sub_control_state")
    world.db.commit()
    tree = world.controls(journey)["T1.1.1"]["sub_control_tree"]
    assert (tree[0]["assigned_user_ids"], tree[0]["assignees"]) == ([BEN], [PEOPLE[BEN]]) and tree[1]["assigned_user_ids"] == []
    world.assign(journey, impl, "T1.1.1.1", [ANNA])
    assert world.row(m.ControlImplementation, impl).sub_control_state == {"T1.1.1.1": {"assigned_user_ids": [ANNA]}, "T1.1.1.2": "oops"}


# ── POST .../evidence with a sub_control_code ────────────────────────────────────────────────────

def test_a_file_uploaded_to_a_sub_control_is_tagged_and_rated_against_that_sub_control(world):
    journey = world.start(HIER_DATA)
    impl = world.impl(journey, "T1.1.1")
    row = world.row(m.ControlImplementation, impl)
    row.implementation_notes = "Our notes."
    world.db.commit()
    got = world.upload(journey, impl, "register.txt", b"The asset register.", code="T1.1.1.1")
    assert got.status_code == 201, got.text
    body = got.json()
    assert (body["sub_control_code"], body["implementation_id"], body["file_name"], body["review_status"]) == (
        "T1.1.1.1", impl, "register.txt", "pending")
    saved = world.row(m.ImplementationEvidence, body["id"])
    assert saved.sub_control_code == "T1.1.1.1" and saved.uploaded_by == OWNER
    library = world.row(m.Evidence, saved.evidence_id)
    assert library.file_name == "register.txt"
    # the AI review was asked once, for the library file, with the sub-control as its target (the control's notes stay)
    assert len(world.reviews) == 1
    review = world.reviews[0]
    assert (review.evidence_id, review.slug, review.user_id) == (library.id, "demo", OWNER)
    assert review.target == QualityTarget(
        kind="framework_requirement", ref="T1.1.1.1", label="keep a register of assets.",
        requirement="The entity shall: keep a register of assets.\na. the owner\n  • by name\nb. the date", guidance="Our notes.")
    # the file went to the (test) upload folder, under the tenant
    [written] = world.files()
    assert written.parts[0] == "1" and written.suffix == ".txt"


def test_a_long_sub_control_text_is_cut_at_120_characters_for_the_label_only(world):
    journey = world.start(HIER_DATA)
    impl = world.impl(journey, "T1.1.4")
    assert world.upload(journey, impl, code="T1.1.4.2").status_code == 201
    target = world.reviews[0].target
    assert target.ref == "T1.1.4.2" and target.label == LONG_TEXT[:120] and len(target.label) == 120
    assert target.requirement == LONG_TEXT.strip()


def test_a_file_uploaded_to_the_control_is_rated_against_the_control_as_it_always_was(world):
    journey = world.start(HIER_DATA)
    impl = world.impl(journey, "T1.1.1")
    row = world.row(m.ControlImplementation, impl)
    row.implementation_notes = "Our notes."
    world.db.commit()
    for code in (None, "", "   "):                                              # no code, an empty field, a blank one: the control itself
        world.reviews.clear()
        got = world.upload(journey, impl, code=code)
        assert got.status_code == 201 and got.json()["sub_control_code"] is None, code
        assert world.row(m.ImplementationEvidence, got.json()["id"]).sub_control_code is None
        assert [r.target for r in world.reviews] == [QualityTarget(
            kind="framework_requirement", ref="T1.1.1", label="Control T1.1.1", requirement="The entity shall T1.1.1.", guidance="Our notes.")]


def test_a_file_the_library_does_not_read_is_tagged_and_starts_no_review(world):
    journey = world.start(HIER_DATA)
    impl = world.impl(journey, "T1.1.1")
    got = world.upload(journey, impl, "sample.bin", b"\x00\x01\x02", code="T1.1.1.2", mime="application/octet-stream")
    assert got.status_code == 201 and got.json()["sub_control_code"] == "T1.1.1.2"
    assert world.reviews == [] and len(world.files()) == 1


def test_a_library_file_can_be_linked_to_a_sub_control_the_control_or_both(world):
    journey = world.start(HIER_DATA)
    impl = world.impl(journey, "T1.1.1")
    world.db.add(m.Evidence(id=50, tenant_id=1, name="Existing", file_name="existing.pdf", file_path="/nowhere/existing.pdf", uploaded_by=OWNER))
    world.db.commit()
    tagged = world.link(journey, impl, 50, code="T1.1.1.2")
    assert tagged.status_code == 201, tagged.text
    assert (tagged.json()["sub_control_code"], tagged.json()["evidence_id"], tagged.json()["file_name"]) == ("T1.1.1.2", 50, "existing.pdf")
    assert world.link(journey, impl, 50).json()["sub_control_code"] is None                  # the same file on the control as a whole
    assert world.link(journey, impl, 50, code=" T1.1.1.1 ").json()["sub_control_code"] == "T1.1.1.1"       # the code as the control spells it
    got = world.controls(journey)["T1.1.1"]
    assert sorted((e["file_name"], e["sub_control_code"] or "") for e in got["evidence"]) == [
        ("existing.pdf", ""), ("existing.pdf", "T1.1.1.1"), ("existing.pdf", "T1.1.1.2")]
    assert world.reviews == [] and world.files() == []                                         # a link reads nothing and writes nothing
    assert world.link(journey, impl, 51, code="T1.1.1.1").status_code == 404                  # a file the library does not have, as before


def test_an_unknown_sub_control_is_refused_before_anything_is_written(world):
    journey = world.start(HIER_DATA)
    impl = world.impl(journey, "T1.1.1")
    world.db.add(m.Evidence(id=50, tenant_id=1, name="Existing", file_name="existing.pdf", uploaded_by=OWNER))
    world.db.commit()
    for code in ("T9.9.9.9", "t1.1.1.1", "T1.1.1", "T1.1.4.1"):                            # unknown, another case, the control's id, another control's
        for got in (world.upload(journey, impl, code=code), world.link(journey, impl, 50, code=code)):
            assert got.status_code == 400 and got.json()["detail"] == "Unknown sub-control for this control", code
    assert world.db.query(m.ImplementationEvidence).count() == 0
    assert [e.id for e in world.db.query(m.Evidence)] == [50]
    assert world.reviews == [] and world.files() == []


def test_a_control_without_sub_controls_ignores_the_field(world):
    journey = world.start(HIER_DATA)
    for control in ("T1.1.2", "T1.1.3", "T1.2.1", "T1.2.2"):       # an empty list, an odd value, a list instead of a dict, no attributes
        world.reviews.clear()
        impl = world.impl(journey, control)
        got = world.upload(journey, impl, code="T1.1.1.1")
        assert got.status_code == 201 and got.json()["sub_control_code"] is None, control
        assert world.reviews[0].target.ref == control and world.reviews[0].target.label == f"Control {control}"
    plain = world.start(PLAIN_DATA)
    got = world.upload(plain, world.impl(plain, "A.1"), code="A.1.1")
    assert got.status_code == 201 and got.json()["sub_control_code"] is None
    assert [r.sub_control_code for r in world.db.query(m.ImplementationEvidence)] == [None] * 5


# ── GET .../controls and .../controls/{id} ───────────────────────────────────────────────────────

def test_every_evidence_entry_says_which_sub_control_it_belongs_to(world):
    journey = world.start(HIER_DATA)
    impl = world.impl(journey, "T1.1.1")
    for name, code in (("control.txt", None), ("first.txt", "T1.1.1.1"), ("second.txt", "T1.1.1.2")):
        assert world.upload(journey, impl, name, code=code).status_code == 201
    # a library file the AI mapped to the control: not attached, so it belongs to no sub-control
    parsed = world.controls(journey)["T1.1.1"]["parsed_control_id"]
    world.db.add(m.Evidence(id=60, tenant_id=1, name="Mapped", file_name="mapped.pdf", uploaded_by=OWNER))
    world.db.add(m.EvidenceControlMapping(evidence_id=60, parsed_control_id=parsed, confidence_score=80.0))
    world.db.commit()
    entries = world.controls(journey)["T1.1.1"]["evidence"]
    assert sorted((e["file_name"], e["sub_control_code"]) for e in entries) == [
        ("control.txt", None), ("first.txt", "T1.1.1.1"), ("mapped.pdf", None), ("second.txt", "T1.1.1.2")]
    for entry in entries:
        assert set(entry) == (MAPPED_KEYS if entry.get("item_type") == "ecm" else ATTACHED_KEYS) | {"sub_control_code"}, entry["file_name"]
    # the control's page of details lists the same files with the same tags
    details = world.http.get(f"/certifications/{journey}/controls/{impl}")
    assert details.status_code == 200
    assert sorted((e["file_name"], e["sub_control_code"]) for e in details.json()["evidence"]) == [
        ("control.txt", None), ("first.txt", "T1.1.1.1"), ("second.txt", "T1.1.1.2")]


def test_a_file_on_a_sub_control_counts_for_the_control_exactly_like_a_file_on_the_control(world):
    journey = world.start(HIER_DATA)
    by_sub, by_control = world.impl(journey, "T1.1.1"), world.impl(journey, "T1.1.4")           # the same three items asked of both
    sub_file = world.upload(journey, by_sub, "a.txt", code="T1.1.1.1").json()["id"]
    control_file = world.upload(journey, by_control, "a.txt").json()["id"]

    def counts():
        got = world.controls(journey)
        return {c: tuple(got[c][k] for k in ("evidence_count", "approved_evidence_count", "required_evidence_count", "evidence_coverage",
                                             "status", "status_source")) for c in ("T1.1.1", "T1.1.4")}

    assert counts()["T1.1.1"] == counts()["T1.1.4"] == (1, 0, 3, 1 / 3, "in_progress", "not_started")
    for file_id in (sub_file, control_file):                                                  # the review of a file is the same call
        assert world.http.put(f"/certifications/evidence/{file_id}/review", json={"action": "approve"}).status_code == 200
    assert counts()["T1.1.1"] == counts()["T1.1.4"] == (1, 1, 3, 1 / 3, "in_progress", "not_started")
    entry = world.controls(journey)["T1.1.1"]["evidence"][0]
    assert (entry["review_status"], entry["sub_control_code"]) == ("approved", "T1.1.1.1")
    rejected = world.http.post(f"/certifications/{journey}/controls/{by_sub}/evidence/{sub_file}/review",
                               json={"action": "rejected", "notes": "Old."})
    assert rejected.status_code == 200 and rejected.json()["review_status"] == "rejected"
    assert counts()["T1.1.1"][:2] == (1, 0)


def test_unlinking_a_file_removes_its_entry_and_keeps_the_library_file_and_the_other_sub_controls_files(world):
    journey = world.start(HIER_DATA)
    impl = world.impl(journey, "T1.1.1")
    first = world.upload(journey, impl, "first.txt", code="T1.1.1.1").json()
    second = world.upload(journey, impl, "second.txt", code="T1.1.1.2").json()
    assert world.http.delete(f"/certifications/evidence/{first['id']}").status_code == 204
    assert [(e["file_name"], e["sub_control_code"]) for e in world.controls(journey)["T1.1.1"]["evidence"]] == [("second.txt", "T1.1.1.2")]
    assert world.row(m.Evidence, first["evidence_id"]) is not None                          # only the library deletes a file
    assert world.row(m.ImplementationEvidence, second["id"]).sub_control_code == "T1.1.1.2"


def test_another_framework_gains_only_empty_keys(world):
    journey = world.start(PLAIN_DATA)
    impl = world.impl(journey, "A.1")
    world.upload(journey, impl, "register.txt")
    control = world.controls(journey)["A.1"]
    assert set(control) == CONTROL_KEYS and control["sub_control_tree"] is None
    assert [set(e) for e in control["evidence"]] == [ATTACHED_KEYS | {"sub_control_code"}]
    assert control["evidence"][0]["sub_control_code"] is None
    assert (control["assigned_user_ids"], control["assignees"], control["evidence_count"]) == ([], [], 1)
    # and a control of the hierarchy framework that has no sub-controls shows none, with the same keys
    other = world.controls(world.start(HIER_DATA))
    assert set(other["T1.1.2"]) == set(other["T1.2.2"]) == set(other["T1.1.1"]) == CONTROL_KEYS
    assert other["T1.1.2"]["sub_control_tree"] is None and other["T1.2.2"]["sub_control_tree"] is None


def test_the_owners_of_every_sub_control_cost_one_lookup_for_the_whole_journey(world):
    journey = world.start(HIER_DATA)
    seen = []

    def watch(conn, cursor, statement, *rest):
        seen.append(statement)

    def read():                                                                            # from an empty session, so that two reads compare
        world.db.expire_all()
        seen.clear()
        world.controls(journey)
        return len(seen), sum(1 for s in seen if "FROM grc_users" in s)

    event.listen(world.engine, "before_cursor_execute", watch)
    try:
        nobody = read()
        assert nobody[1] == 0                                                              # nobody named: no lookup of people at all
        one, two = world.impl(journey, "T1.1.1"), world.impl(journey, "T1.1.4")
        for control, code, ids in ((one, "T1.1.1.1", [ANNA, BEN]), (one, "T1.1.1.2", [BEN]), (two, "T1.1.4.1", [ANNA]), (two, "T1.1.4.2", [PLAINNAME])):
            assert world.assign(journey, control, code, ids).status_code == 200
        named = read()
        assert named[1] == 1 and named[0] == nobody[0] + 1                                 # four sub-controls, two controls: one more query
    finally:
        event.remove(world.engine, "before_cursor_execute", watch)
    people = {n["code"]: n["assigned_user_ids"] for c in world.controls(journey).values() for n in (c["sub_control_tree"] or [])}
    assert people == {"T1.1.1.1": [ANNA, BEN], "T1.1.1.2": [BEN], "T1.1.1.3": [], "T1.1.4.1": [ANNA], "T1.1.4.2": [PLAINNAME]}


def test_a_read_changes_nothing_that_is_stored(world):
    journey = world.start(HIER_DATA)
    impl = world.impl(journey, "T1.1.1")
    world.assign(journey, impl, "T1.1.1.1", [ANNA])
    native = copy.deepcopy(world.row(m.ParsedFrameworkControl, world.controls(journey)["T1.1.1"]["parsed_control_id"]).native_attributes)
    state = copy.deepcopy(world.row(m.ControlImplementation, impl).sub_control_state)
    for _ in range(2):
        world.controls(journey)
        world.http.get(f"/certifications/{journey}/controls/{impl}")
    assert world.row(m.ParsedFrameworkControl, world.controls(journey)["T1.1.1"]["parsed_control_id"]).native_attributes == native == NATIVE
    assert world.row(m.ControlImplementation, impl).sub_control_state == state


# ── the real catalog, once it carries the data ───────────────────────────────────────────────────

def test_in_the_real_catalog_any_sub_control_can_be_owned_and_given_a_file(world):
    data = json.loads((SEED / "frameworks" / "uae_ia.json").read_text(encoding="utf-8"))
    if not any(isinstance(c.get("native_attributes"), dict) for c in data["controls"]):
        pytest.skip("seed_data/frameworks/uae_ia.json does not carry native_attributes yet")
    journey = world.start(data)
    stored = {c["control_id"]: c["native_attributes"]["sub_controls"] for c in data["controls"] if isinstance(c.get("native_attributes"), dict)}
    owner_of = {s["code"]: cid for cid, subs in stored.items() for s in subs}
    codes = [s["code"] for subs in stored.values() for s in subs]
    assert codes and len(codes) == len(owner_of)
    assert all(re.fullmatch(r"[A-Za-z0-9.-]{1,64}", code) for code in codes)             # one path segment, and the column's size
    got = world.controls(journey)
    shown = [n for c in got.values() for n in (c["sub_control_tree"] or [])]
    assert len(shown) == len(codes) and {n["code"] for n in shown} == set(codes)
    assert all(n["assigned_user_ids"] == [] and n["assignees"] == [] for n in shown)
    assert all(e["sub_control_code"] is None for c in got.values() for e in c["evidence"])

    # the first sub-control, one in the middle and the last (an Annex E one, its code has a dash)
    pick = [codes[0], codes[len(codes) // 2], codes[-1]]
    assert "-" in pick[-1]
    for n, code in enumerate(pick):
        impl = got[owner_of[code]]["id"]
        assert world.assign(journey, impl, code, [ANNA, BEN] if n else [ANNA]).status_code == 200, code
        assert world.upload(journey, impl, "evidence.txt", b"x", code=code).status_code == 201, code
    got = world.controls(journey)
    for n, code in enumerate(pick):
        control = got[owner_of[code]]
        mine = {x["code"]: x for x in control["sub_control_tree"]}
        assert mine[code]["assigned_user_ids"] == ([ANNA, BEN] if n else [ANNA]), code
        assert [x["assigned_user_ids"] for c, x in mine.items() if c != code] == [[]] * (len(mine) - 1)
        assert [e["sub_control_code"] for e in control["evidence"]] == [code]
    assert sum(1 for c in got.values() for n in (c["sub_control_tree"] or []) if n["assigned_user_ids"]) == 3
    assert sum(len(c["evidence"]) for c in got.values()) == 3
