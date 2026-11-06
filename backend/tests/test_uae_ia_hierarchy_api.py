"""A framework's own hierarchy on the journey (UAE IA): the standard's sub-controls, tier and applicability reach the Requirements view
through `ParsedFrameworkControl.native_attributes` (seeder -> `GET /certifications/{id}/controls`, each sub-control as stored plus its
tick; its evidence stays a list of titles that the page finds in the control's own `evidence_requirements`), its family tree through
`GET /certifications/{id}`, and the artifacts that serve a sub-control through `GET /artifacts/by-control`.

Every fixture is small and made here, so these pass whatever the shipped catalog holds; the last three tests read the real catalog and
skip until it carries the data. In-memory SQLite, the two routers mounted on a bare app.
"""
import copy
import importlib
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import JSON, create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

import grc.models as m  # noqa: E402
from grc.modules.compliance.schema_migrations import _COLUMN_ADDS, _ensure_column  # noqa: E402
from grc.seed_frameworks import seed_framework_from_json  # noqa: E402

certs = importlib.import_module("grc.routers.certification_router")      # the modules, not the APIRouters the package exports
arts = importlib.import_module("grc.routers.artifacts_router")
auth = importlib.import_module("grc.routers.auth_router")

SEED = Path(__file__).resolve().parents[1] / "grc" / "seed_data"

# what a control of any framework carried in the journey's control list before the hierarchy, and what it gained
OLD_KEYS = {
    "id", "journey_id", "framework_control_id", "parsed_control_id", "control_code", "original_control_code", "system_control_code",
    "control_name", "control_statement", "control_statement_full", "domain_id", "domain_code", "domain_name", "objective_code",
    "objective_name", "status", "implementation_notes", "implementation_date", "verified_date", "is_applicable", "priority",
    "is_critical", "criticality_reason", "priority_level", "dependencies", "version_history", "control_description",
    "assessment_criteria", "criteria_status", "assigned_to_user_id", "assignee_name", "assignee_email", "assigned_user_ids",
    "assignees", "sub_controls", "evidence_requirements", "evidence_recommendations", "evidence", "evidence_count",
    "required_evidence_count", "approved_evidence_count", "evidence_coverage", "status_source", "open_issues_count",
}
NEW_KEYS = {"parent_section", "priority_tier", "applicability", "control_types", "implementation_guidance", "control_evidence",
            "sub_control_tree"}

HIER, PLAIN = "Test Hierarchy Standard", "Test Plain Standard"          # no "iso" / "pci" in a name: the page would call it a certification

EVIDENCE = [
    {"name": "Register", "description": "The register itself.", "filetype": "XLSX"},
    {"name": "Review minutes", "description": "Minutes of the yearly review.", "filetype": "PDF"},
    {"name": "Top management approval", "description": "Signed approval of the policy.", "filetype": "PDF"},
]
CRITERIA = ["The entity shall: keep a register of assets.", "The entity shall: review it yearly."]
NATIVE = {
    "priority_tier": "P1",
    "applicability": "Always applicable",
    "control_types": ["Preventive", "Detective"],
    "implementation_guidance": "Keep it current.\n\na. Name an owner.\nb. Review it.",
    "control_evidence": ["Top management approval"],
    "sub_controls": [
        {"code": "T1.1.1.1", "number": 1, "text": "keep a register of assets.", "lead_in": "The entity shall:", "criterion_index": 0,
         "consideration": False,
         "points": [{"label": "a.", "text": "the owner", "points": [{"label": "•", "text": "by name"}]}, {"label": "b.", "text": "the date"}],
         "evidence": ["Register"]},
        {"code": "T1.1.1.2", "number": 2, "text": "review it yearly.", "lead_in": "The entity shall:", "criterion_index": 1,
         "consideration": False, "points": [], "evidence": ["Review minutes", "Register", "A name nobody wrote"]},
        {"code": "T1.1.1.3", "number": 3, "text": "When defining it, the entity shall take the following into account: its size.",
         "lead_in": None, "criterion_index": None, "consideration": True, "points": [], "evidence": ["Review minutes"]},
    ],
}
CONTROL_STRUCTURE = {
    "version": 1, "source": "Test standard, chapter 2",
    "families": [{"id": "T1", "name": "Technical", "kind": "Technical", "objective": "Protect what matters.",
                  "performance_indicators": ["Share of assets protected."]}],
    "subfamilies": [{"id": "T1.1", "family": "T1", "name": "Assets", "objective": "Know the assets.",
                     "performance_indicators": ["Share of assets known."], "automation_guidance": "Not applicable", "threats": ["Loss"]}],
}


def _control(cid, parent="T1.1", native=None, criteria=(), evidence=(), **extra):
    row = {"control_id": cid, "original_reference": cid, "title": f"Control {cid}", "description": f"The entity shall {cid}.",
           "full_text": f"The entity shall {cid}.", "domain": "T1 Technical", "category": "T1.1 Assets", "parent_section": parent,
           "is_mandatory": True, "priority": "high", "assessment_criteria": list(criteria), "evidence_requirements": list(evidence)}
    if native is not None:
        row["native_attributes"] = native
    return {**row, **extra}


def _library(name, controls, document_structure=None):
    return {"metadata": {"name": name, "version": "1", "classification": "regulatory", "framework_type": "regulatory",
                         "document_structure": document_structure}, "controls": controls}


HIER_DATA = _library(HIER, [
    _control("T1.1.1", native=NATIVE, criteria=CRITERIA, evidence=EVIDENCE),
    # attributes but no sub-controls (an Annex F mapping row): the tier is empty, the applicability is kept
    _control("T1.1.2", native={"priority_tier": None, "applicability": "Based on risk assessment", "control_types": [],
                               "implementation_guidance": None, "control_evidence": [], "sub_controls": []}, evidence=EVIDENCE[:1]),
    # odd values of every kind
    _control("T1.1.3", native={"priority_tier": 3, "applicability": ["x"], "control_types": "Preventive", "implementation_guidance": 5,
                               "control_evidence": [1, "Register"], "sub_controls": "oops"}, evidence=EVIDENCE[:1]),
    _control("T1.2.1", parent="T1.2", native=["not", "a", "dict"], evidence=EVIDENCE[:1]),
    _control("T1.2.2", parent="T1.2", evidence=EVIDENCE[:1]),                       # a control of that framework without any
], {"sections": [{"number": "T1", "name": "Technical"}], "control_structure": CONTROL_STRUCTURE})

PLAIN_DATA = _library(PLAIN, [
    _control("A.1", parent=None, evidence=EVIDENCE[:2]),
    _control("A.1.1", parent="A.1", evidence=EVIDENCE[2:]),                       # a row-based child: parent_section is its parent's id
])


@pytest.fixture(autouse=True)
def _fresh_catalog_caches():
    for cache in (arts._provides_cache, arts._sub_controls_cache):
        cache.update(mtime=None, data={})
    yield
    for cache in (arts._provides_cache, arts._sub_controls_cache):
        cache.update(mtime=None, data={})


@pytest.fixture(scope="module")
def engine():
    """The schema is made once (it takes seconds); each test starts from empty tables."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    return engine


@pytest.fixture
def world(engine):
    db = sessionmaker(bind=engine, autoflush=False)()                                       # the tenant sessions do not autoflush either
    db.add(m.Tenant(id=1, name="Demo Bank", slug="demo"))
    user = m.GRCUser(id=7, username="owner", email="owner@bank.example", display_name="Owner")
    db.add(user)
    db.commit()
    app = FastAPI()
    app.include_router(certs.router)
    app.include_router(arts.router)
    app.dependency_overrides[m.get_db] = lambda: db
    app.dependency_overrides[auth.require_auth] = lambda: user
    http = TestClient(app)

    def start(data):
        fw = seed_framework_from_json(db, copy.deepcopy(data), tenant_id=1)
        db.commit()
        journey = http.post("/certifications", json={"framework_id": fw.id, "name": f"{fw.name} journey"})
        assert journey.status_code == 201, journey.text
        return fw, journey.json()["id"]

    def controls(journey_id):
        got = http.get(f"/certifications/{journey_id}/controls")
        assert got.status_code == 200, got.text
        return {c["control_code"]: c for c in got.json()}

    yield SimpleNamespace(db=db, http=http, start=start, controls=controls)
    db.close()
    with engine.begin() as conn:                                                            # SQLite does not enforce the foreign keys: any order
        for table in m.Base.metadata.tables.values():
            conn.execute(table.delete())


# ── the column ───────────────────────────────────────────────────────────────────────────────────

def test_the_column_is_in_the_model_and_in_column_adds_and_an_old_tenant_gets_it():
    col = m.ParsedFrameworkControl.__table__.c.native_attributes
    assert isinstance(col.type, JSON) and col.nullable
    entry = [e for e in _COLUMN_ADDS if e[:2] == ("grc_parsed_framework_controls", "native_attributes")]
    assert entry == [("grc_parsed_framework_controls", "native_attributes", "JSON", None)]
    # a tenant database made before the column existed gets it from that entry, and keeps its rows
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE grc_parsed_framework_controls (id INTEGER PRIMARY KEY, control_id VARCHAR(100))"))
        conn.execute(text("INSERT INTO grc_parsed_framework_controls (id, control_id) VALUES (1, 'M1.1.1')"))
    table, column, ddl, _index = entry[0]
    assert _ensure_column(engine, table, column, ddl) is True
    assert _ensure_column(engine, table, column, ddl) is True                       # again: nothing left to add
    with engine.begin() as conn:
        conn.execute(text("UPDATE grc_parsed_framework_controls SET native_attributes = :v"), {"v": json.dumps({"priority_tier": "P1"})})
        stored, control_id = conn.execute(text("SELECT native_attributes, control_id FROM grc_parsed_framework_controls")).one()
    assert (json.loads(stored), control_id) == ({"priority_tier": "P1"}, "M1.1.1")


# ── the seeder ───────────────────────────────────────────────────────────────────────────────────

def test_the_seeder_stores_native_attributes_and_the_document_structure(world, capsys):
    hier = seed_framework_from_json(world.db, copy.deepcopy(HIER_DATA), tenant_id=1)
    plain = seed_framework_from_json(world.db, copy.deepcopy(PLAIN_DATA), tenant_id=1)
    world.db.commit()
    assert "truncat" not in capsys.readouterr().out.lower()
    rows = {r.control_id: r for r in world.db.query(m.ParsedFrameworkControl).filter_by(uploaded_framework_id=hier.id)}
    assert len(rows) == 5
    assert rows["T1.1.1"].native_attributes == NATIVE
    assert rows["T1.1.2"].native_attributes["sub_controls"] == [] and rows["T1.2.1"].native_attributes == ["not", "a", "dict"]
    assert rows["T1.2.2"].native_attributes is None                                 # none given: none stored
    assert [r.native_attributes for r in world.db.query(m.ParsedFrameworkControl).filter_by(uploaded_framework_id=plain.id)] == [None, None]
    # the generic columns are filled as before, and the tier did not go into the NDMO roadmap column
    first = rows["T1.1.1"]
    assert first.assessment_criteria == CRITERIA and first.priority_level is None and first.parent_section == "T1.1"
    assert first.evidence_requirements == EVIDENCE
    assert hier.document_structure == HIER_DATA["metadata"]["document_structure"]
    assert plain.document_structure is None


# ── GET /certifications/{id}/controls ────────────────────────────────────────────────────────────

def test_a_control_carries_its_sub_controls_as_stored_with_their_ticks(world):
    _, journey = world.start(HIER_DATA)
    one = world.controls(journey)["T1.1.1"]
    assert (one["parent_section"], one["priority_tier"], one["applicability"]) == ("T1.1", "P1", "Always applicable")
    assert one["control_types"] == ["Preventive", "Detective"] and one["control_evidence"] == ["Top management approval"]
    assert one["implementation_guidance"] == NATIVE["implementation_guidance"]
    assert one["priority_level"] is None and one["assessment_criteria"] == CRITERIA          # NDMO's column and the criteria are as before
    titles = {e["title"] for e in one["evidence_requirements"]}
    assert titles == {e["name"] for e in EVIDENCE}                                           # the items live here, once

    tree = one["sub_control_tree"]
    assert [n["code"] for n in tree] == ["T1.1.1.1", "T1.1.1.2", "T1.1.1.3"]
    # a node is the stored node, whether it is met (nothing ticked yet; a consideration is not tickable) and who owns it (round 5:
    # nobody yet): no resolved items on it
    assert tree == [{**stored, "met": met, "assigned_user_ids": [], "assignees": []}
                    for stored, met in zip(NATIVE["sub_controls"], [False, False, None])]
    assert not any("evidence_requirements" in n for n in tree)
    assert tree[0]["points"][0]["points"] == [{"label": "•", "text": "by name"}] and tree[0]["points"][1] == {"label": "b.", "text": "the date"}
    # the evidence stays the titles as stored, in the node's own order, a title the control does not list included: the page does the lookup
    assert [n["evidence"] for n in tree] == [["Register"], ["Review minutes", "Register", "A name nobody wrote"], ["Review minutes"]]
    assert {t for n in tree for t in n["evidence"]} - titles == {"A name nobody wrote"}


def test_a_tick_on_the_criteria_shows_on_its_sub_control_and_the_status_still_follows_the_ticks(world):
    _, journey = world.start(HIER_DATA)
    impl = world.controls(journey)["T1.1.1"]["id"]
    ticked = world.http.patch(f"/certifications/{journey}/controls/{impl}/criteria", json={"criteria_status": {"0": True}})
    assert ticked.status_code == 200 and ticked.json()["status"] == "in_progress"            # one of two criteria: as before
    one = world.controls(journey)["T1.1.1"]
    assert [n["met"] for n in one["sub_control_tree"]] == [True, False, None] and one["criteria_status"] == {"0": True}
    world.http.patch(f"/certifications/{journey}/controls/{impl}/criteria", json={"criteria_status": {"0": True, "1": True, "2": True}})
    one = world.controls(journey)["T1.1.1"]
    assert one["status"] == "implemented" and [n["met"] for n in one["sub_control_tree"]] == [True, True, None]
    world.http.patch(f"/certifications/{journey}/controls/{impl}/criteria", json={"criteria_status": {}})
    assert [n["met"] for n in world.controls(journey)["T1.1.1"]["sub_control_tree"]] == [False, False, None]


def test_the_stored_native_attributes_are_never_changed_by_a_read(world, monkeypatch):
    _, journey = world.start(HIER_DATA)
    handed, real = [], certs._sub_control_tree

    def watch(native, *rest):
        handed.append(native)                                       # the object the endpoint read from the row, not a copy
        return real(native, *rest)

    monkeypatch.setattr(certs, "_sub_control_tree", watch)
    first = world.controls(journey)["T1.1.1"]["sub_control_tree"]
    assert world.controls(journey)["T1.1.1"]["sub_control_tree"] == first                    # a second read says the same
    ours = [n for n in handed if isinstance(n, dict) and n.get("priority_tier") == "P1"]
    assert len(ours) == 2 and all(n == NATIVE for n in ours)                                 # as stored, after both requests
    assert all("met" not in s for n in ours for s in n["sub_controls"])


def test_a_control_without_native_attributes_keeps_its_payload_and_its_row_based_sub_controls(world):
    _, journey = world.start(PLAIN_DATA)
    got = world.controls(journey)
    parent, child = got["A.1"], got["A.1.1"]
    assert set(parent) == OLD_KEYS | NEW_KEYS and set(child) == OLD_KEYS | NEW_KEYS            # the old keys, and exactly these new ones
    for control in (parent, child):
        assert (control["priority_tier"], control["applicability"], control["implementation_guidance"], control["sub_control_tree"]) == (
            None, None, None, None)
        assert control["control_types"] == [] and control["control_evidence"] == []
    assert (parent["parent_section"], child["parent_section"]) == (None, "A.1")
    # the row-based hierarchy (a child control whose parent_section is its parent's id) is untouched
    assert [(s["code"], s["parent_section"]) for s in parent["sub_controls"]] == [("A.1.1", "A.1")] and child["sub_controls"] == []
    assert [e["title"] for e in parent["evidence_requirements"]] == ["Register", "Review minutes"]
    assert parent["evidence_recommendations"] == ["Register", "Review minutes"] and parent["required_evidence_count"] == 2
    assert parent["status"] == "not_started" and parent["criteria_status"] == {} and parent["assessment_criteria"] == []


def test_odd_native_attributes_never_break_the_list(world):
    _, journey = world.start(HIER_DATA)
    got = world.controls(journey)
    assert len(got) == 5
    # an Annex F style row: attributes, but no sub-controls to show
    row = got["T1.1.2"]
    assert (row["priority_tier"], row["applicability"], row["control_types"], row["control_evidence"]) == (
        None, "Based on risk assessment", [], [])
    assert row["sub_control_tree"] is None
    # wrong types are read as empty, not raised: only the strings of a list survive
    odd = got["T1.1.3"]
    assert (odd["priority_tier"], odd["applicability"], odd["control_types"], odd["implementation_guidance"]) == (None, None, [], None)
    assert odd["control_evidence"] == ["Register"] and odd["sub_control_tree"] is None
    # a list instead of a dict, and no attributes at all
    for code in ("T1.2.1", "T1.2.2"):
        assert got[code]["sub_control_tree"] is None and got[code]["control_types"] == [] and got[code]["parent_section"] == "T1.2"
        assert got[code]["priority_tier"] is None and got[code]["control_evidence"] == []


def test_a_sub_control_that_does_not_fit_is_skipped_never_raised():
    native = {"sub_controls": [
        "junk", None, {"code": "Z.1", "criterion_index": True}, {"code": "Z.2", "criterion_index": "1"}, {"code": "Z.3", "criterion_index": 7},
        {"code": "Z.4"},
    ]}
    before = copy.deepcopy(native)
    tree = certs._sub_control_tree(native, {"7": True, "1": True, "True": True})
    assert [n["code"] for n in tree] == ["Z.1", "Z.2", "Z.3", "Z.4"]
    assert [n["met"] for n in tree] == [None, None, True, None]            # a bool or a string is no index; "7" is ticked
    assert native == before                                                # nothing was added to the stored nodes
    # nothing to show: not a dict, no list, an empty list, or a list with no node in it
    for nothing in (None, [], "x", {}, {"sub_controls": None}, {"sub_controls": {}}, {"sub_controls": []}, {"sub_controls": ["junk", 4]}):
        assert certs._sub_control_tree(nothing, {}) is None
    # odd ticks are no ticks; what a node says about its evidence is passed on as stored, nothing is looked up or checked
    stored = {"code": "Z.1", "criterion_index": 0, "evidence": ["Register", "No such item"]}
    for ticks in (None, "x", [], {}, {"1": True}):
        assert certs._sub_control_tree({"sub_controls": [stored]}, ticks) == [{**stored, "met": False, "assigned_user_ids": [], "assignees": []}]
    assert certs._sub_control_tree({"sub_controls": [stored]}, {"0": 1}) == [{**stored, "met": True, "assigned_user_ids": [], "assignees": []}]
    assert certs._native_fields(None) == certs._native_fields("x") == certs._native_fields([]) == {
        "priority_tier": None, "applicability": None, "control_types": [], "implementation_guidance": None, "control_evidence": []}


# ── GET /certifications/{id} ─────────────────────────────────────────────────────────────────────

def test_the_journey_carries_the_frameworks_family_tree_or_nothing(world):
    hier, hier_journey = world.start(HIER_DATA)
    plain, plain_journey = world.start(PLAIN_DATA)
    got = world.http.get(f"/certifications/{hier_journey}")
    assert got.status_code == 200 and got.json()["control_structure"] == CONTROL_STRUCTURE
    assert got.json()["phases"] == []                                      # the NDMO-style phases still come from "sections" of a certification only
    other = world.http.get(f"/certifications/{plain_journey}").json()
    assert other["control_structure"] is None and other["framework_name"] == PLAIN
    # a document structure of another shape is not a family tree
    for shape in ({"sections": [{"number": "1", "name": "One"}]}, {"control_structure": "oops"}, {"control_structure": ["x"]}, ["x"], "x", None):
        plain.document_structure = shape
        world.db.commit()
        again = world.http.get(f"/certifications/{plain_journey}")
        assert again.status_code == 200 and again.json()["control_structure"] is None, shape
    # the keys the page read before are all still there
    assert {"id", "framework_id", "framework_name", "framework", "framework_classification", "phases", "stage_owners", "progress"} <= set(got.json())


# ── GET /artifacts/by-control ────────────────────────────────────────────────────────────────────

def _artifact(aid, name, ref, evidence, **extra):
    return {"artifact_id": aid, "stage": "Stage 1: Governance & Scoping", "name": name, "type": "Register", "control_ref": ref,
            "mandatory": True, "description": f"{name}.", "format": "XLSX", "owner": "CISO", "evidence": evidence, **extra}


CATALOG = {
    "hier_test": {"name": HIER, "artifacts": [
        _artifact("H-001", "Information Listing", "T1.1.1", ["Register"], also_controls=["T1.1.2"], sub_controls=["T1.1.1.1", "T1.1.2.1"]),
        _artifact("H-002", "Review Procedure", "T9.9.9", ["Review minutes"], sub_controls=["T1.1.1.2"]),
        _artifact("H-003", "Approval Letter", "T1.1.1", ["Top management approval"], sub_controls=[]),
    ]},
    "plain_test": {"name": PLAIN, "artifacts": [_artifact("P-001", "Plain Register", "A.1", ["Register"])]},
}


@pytest.fixture
def catalog(world, tmp_path, monkeypatch):
    path = tmp_path / "artifact_catalog.json"
    path.write_text(json.dumps(CATALOG), encoding="utf-8")
    monkeypatch.setattr(arts, "_CATALOG_PATH", path)
    arts._ensure_catalog_seeded(world.db)
    world.by_control = lambda code, key="hier_test": world.http.get("/artifacts/by-control", params={"framework_key": key, "control_ref": code}).json()
    world.ids = lambda code, key="hier_test": [i["artifact_id"] for i in world.by_control(code, key)["catalog"]]
    return world


def test_a_sub_control_code_finds_the_artifacts_that_serve_it(catalog):
    out = catalog.by_control("T1.1.1.2")
    assert [i["artifact_id"] for i in out["catalog"]] == ["H-002"]            # its control_ref (T9.9.9) is another control's: matched by the list
    item = out["catalog"][0]
    assert item["sub_controls"] == ["T1.1.1.2"] and item["provides"] == ["Review minutes"] and item["name"] == "Review Procedure"
    assert catalog.ids("T1.1.2.1") == ["H-001"]                               # H-001 also lists a sub-control of the control in its also_controls
    assert catalog.ids("t1.1.2.1") == ["H-001"] and catalog.ids(" T1.1.2.1 ") == ["H-001"]          # normalised like a control reference
    assert sorted(catalog.ids("T1.1.1.1,T1.1.1.2")) == ["H-001", "H-002"]


def test_the_match_is_token_for_token_and_an_item_comes_back_once(catalog):
    # the control matches its artifacts by control_ref, not the ones that only list one of its sub-controls
    assert sorted(catalog.ids("T1.1.1")) == ["H-001", "H-003"]
    assert catalog.ids("T1.1.2") == ["H-001"]                                 # an also_control, as before
    # a code that is only the start of a listed code, or one longer than it, finds nothing
    for code in ("T1.1.1.10", "T1.1.1.1.1", "T1.1", "T1.1.2.", "T1.1.1.", "1.1.1.2", "T1.1.1.2.1"):
        assert catalog.ids(code) == [], code
    # both ways at once is still one item
    assert sorted(catalog.ids("T1.1.1,T1.1.1.1,T1.1.2.1")) == ["H-001", "H-003"]
    assert sorted(catalog.ids("T1.1.1.2,T1.1.1")) == ["H-001", "H-002", "H-003"]


def test_every_item_says_which_sub_controls_it_serves_and_other_frameworks_gain_an_empty_list(catalog):
    by_id = {i["artifact_id"]: i for i in catalog.by_control("T1.1.1")["catalog"]}
    assert by_id["H-001"]["sub_controls"] == ["T1.1.1.1", "T1.1.2.1"] and by_id["H-003"]["sub_controls"] == []
    assert by_id["H-001"]["provides"] == ["Register"]                         # what was there is as it was
    plain = catalog.by_control("A.1", "plain_test")["catalog"]
    assert [(i["artifact_id"], i["sub_controls"], i["provides"]) for i in plain] == [("P-001", [], ["Register"])]
    # another framework's artifacts are not found by this framework's sub-control codes
    assert catalog.ids("T1.1.1.1", "plain_test") == [] and catalog.ids("A.1", "hier_test") == []
    assert set(catalog.by_control("A.1", "plain_test")["catalog"][0]) == {
        "id", "artifact_id", "stage", "stage_number", "name", "artifact_type", "control_ref", "mandatory", "description", "format",
        "owner", "is_platform_native", "platform_data_type", "provides", "sub_controls"}


def test_the_documents_already_made_from_an_item_come_with_it(catalog):
    items = {r.artifact_id: r.id for r in catalog.db.query(m.ArtifactCatalogItem).filter_by(framework_key="hier_test")}
    made = [m.TenantArtifact(tenant_id=1, catalog_item_id=items["H-001"], framework_key="hier_test", name="Our register",
                             artifact_type="Register", control_ref="T1.1.1, T1.1.2", status="draft"),
            m.TenantArtifact(tenant_id=1, catalog_item_id=items["H-003"], framework_key="hier_test", name="Our letter",
                             artifact_type="Register", control_ref="T1.1.1", status="draft"),
            m.TenantArtifact(tenant_id=1, catalog_item_id=None, framework_key="hier_test", name="By hand", artifact_type="Plan",
                             control_ref="T1.1.2.1", status="draft")]
    catalog.db.add_all(made)
    catalog.db.commit()
    out = catalog.by_control("T1.1.2.1")
    assert [i["artifact_id"] for i in out["catalog"]] == ["H-001"]
    # the page shows "View" for an item it finds a document for: the one made from H-001 (not from H-003) is there, though its control_ref
    # names no sub-control, and the one made by hand matches by its own reference as before
    assert sorted((a["name"], a["catalog_item_id"]) for a in out["artifacts"]) == [("By hand", None), ("Our register", items["H-001"])]
    # a control-level request is what it was: documents by control_ref only
    assert sorted(a["name"] for a in catalog.by_control("T1.1.1")["artifacts"]) == ["Our letter", "Our register"]
    assert catalog.by_control("T1.1.1.2")["artifacts"] == []


def test_an_unreadable_catalog_file_only_costs_the_sub_control_lists(catalog, tmp_path, monkeypatch):
    broken = tmp_path / "broken.json"
    broken.write_text("{ not json", encoding="utf-8")
    monkeypatch.setattr(arts, "_CATALOG_PATH", broken)
    assert arts._sub_controls_by_artifact("hier_test") == {} and arts._provides_by_artifact("hier_test") == {}
    monkeypatch.setattr(arts, "_CATALOG_PATH", tmp_path / "missing.json")
    assert arts._sub_controls_by_artifact("hier_test") == {}
    out = catalog.by_control("T1.1.1")                                       # the rows are in the database: matched by control_ref as ever
    assert sorted(i["artifact_id"] for i in out["catalog"]) == ["H-001", "H-003"] and all(i["sub_controls"] == [] for i in out["catalog"])
    assert catalog.ids("T1.1.1.2") == []


def test_the_sub_control_lists_are_read_again_when_the_file_changes(catalog):
    path = arts._CATALOG_PATH
    assert arts._sub_controls_by_artifact("hier_test") == {"H-001": ["T1.1.1.1", "T1.1.2.1"], "H-002": ["T1.1.1.2"]}   # H-003: none
    assert arts._sub_controls_by_artifact("plain_test") == {} and arts._sub_controls_by_artifact("nobody") == {}
    changed = copy.deepcopy(CATALOG)
    changed["hier_test"]["artifacts"][1]["sub_controls"] = ["T1.1.1.2", "T1.1.1.3"]
    path.write_text(json.dumps(changed), encoding="utf-8")
    os.utime(path, (1_900_000_000, 1_900_000_000))                           # a clock tick that cannot equal the first write's
    assert arts._sub_controls_by_artifact("hier_test")["H-002"] == ["T1.1.1.2", "T1.1.1.3"]
    assert catalog.ids("T1.1.1.3") == ["H-002"]


# ── the real catalog, once it carries the data ───────────────────────────────────────────────────

def _real_library():
    return json.loads((SEED / "frameworks" / "uae_ia.json").read_text(encoding="utf-8"))


def test_the_real_library_reaches_the_journey_whole(world):
    data = _real_library()
    if not any(isinstance(c.get("native_attributes"), dict) for c in data["controls"]):
        pytest.skip("seed_data/frameworks/uae_ia.json does not carry native_attributes yet")
    fw, journey = world.start(data)
    got = world.controls(journey)
    assert len(got) == len(data["controls"])
    nodes = shown = 0
    for src in data["controls"]:
        control, native = got[src["control_id"]], src["native_attributes"]
        assert control["parent_section"] == src["parent_section"], src["control_id"]
        assert (control["priority_tier"], control["applicability"], control["control_types"]) == (
            native["priority_tier"], native["applicability"], native["control_types"]), src["control_id"]
        assert control["implementation_guidance"] == native["implementation_guidance"] and control["control_evidence"] == native["control_evidence"]
        assert control["priority_level"] is None                             # the tier lives in native_attributes only
        tree = control["sub_control_tree"]
        if not native["sub_controls"]:
            assert tree is None, src["control_id"]
            continue
        assert [n["code"] for n in tree] == [s["code"] for s in native["sub_controls"]], src["control_id"]
        titles = {e["title"] for e in control["evidence_requirements"]}
        for node, stored in zip(tree, native["sub_controls"]):
            # the stored node plus whether it is met and who owns it (nobody), nothing resolved on it ...
            assert node == {**stored, "met": None if stored["criterion_index"] is None else False,
                            "assigned_user_ids": [], "assignees": []}, stored["code"]
            assert "evidence_requirements" not in node
            # ... and every title it lists is one of the control's own evidence items, which the page looks up there
            assert stored["evidence"] and set(node["evidence"]) <= titles, stored["code"]
        nodes += len(tree)
        shown += 1
    assert nodes and shown
    structure = world.http.get(f"/certifications/{journey}").json()["control_structure"]
    assert structure["version"] == 1
    subfamilies = {s["id"] for s in structure["subfamilies"]}
    assert {c["parent_section"] for c in data["controls"]} <= subfamilies         # every control sits in a sub-family the tree describes
    assert {s["family"] for s in structure["subfamilies"]} <= {f["id"] for f in structure["families"]}


def test_in_the_real_catalog_a_tick_lights_its_sub_control_and_never_one_that_has_no_criterion(world):
    """M1.3.2 (a core control, every sub-control tickable) and E1-2.1.1 (an Annex E row with "take the following into account" lines)."""
    data = _real_library()
    if not any(isinstance(c.get("native_attributes"), dict) for c in data["controls"]):
        pytest.skip("seed_data/frameworks/uae_ia.json does not carry native_attributes yet")
    _, journey = world.start(data)
    stored = {c["control_id"]: c["native_attributes"]["sub_controls"] for c in data["controls"]}

    def tick(code, ticks):
        impl = world.controls(journey)[code]["id"]
        done = world.http.patch(f"/certifications/{journey}/controls/{impl}/criteria", json={"criteria_status": ticks})
        assert done.status_code == 200, done.text
        return world.controls(journey)[code]

    core = stored["M1.3.2"]
    assert len(core) >= 2 and all(s["criterion_index"] is not None and not s["consideration"] for s in core)
    first = core[0]["criterion_index"]
    one = tick("M1.3.2", {str(first): True})
    assert one["status"] == "in_progress" and one["criteria_status"] == {str(first): True}
    assert [n["met"] for n in one["sub_control_tree"]] == [s["criterion_index"] == first for s in core]
    assert [n["met"] for n in tick("M1.3.2", {str(s["criterion_index"]): True for s in core})["sub_control_tree"]] == [True] * len(core)

    annex = stored["E1-2.1.1"]
    assert any(s["consideration"] for s in annex) and all(s["criterion_index"] is None for s in annex if s["consideration"])
    stray = tick("E1-2.1.1", {"0": True, "1": True, "2": True})                   # whatever is ticked, a line with no criterion stays unmarked
    assert [n["met"] is None for n in stray["sub_control_tree"]] == [s["criterion_index"] is None for s in annex]
    assert [n["consideration"] for n in stray["sub_control_tree"]] == [s["consideration"] for s in annex]


def test_the_real_artifact_catalog_serves_sub_controls(world):
    entry = json.loads((SEED / "artifact_catalog.json").read_text(encoding="utf-8"))["uae_ia"]["artifacts"]
    serving = [a for a in entry if a.get("sub_controls")]
    if not serving:
        pytest.skip("seed_data/artifact_catalog.json does not list sub_controls for uae_ia yet")
    arts._ensure_catalog_seeded(world.db)
    for artifact in (serving[0], serving[len(serving) // 2], serving[-1]):
        for code in (artifact["sub_controls"][0], artifact["sub_controls"][-1]):
            out = world.http.get("/artifacts/by-control", params={"framework_key": "uae_ia", "control_ref": code}).json()
            found = {i["artifact_id"]: i for i in out["catalog"]}
            assert found[artifact["artifact_id"]]["sub_controls"] == artifact["sub_controls"], (artifact["artifact_id"], code)
            for item in out["catalog"]:                                      # each one lists the code, or has it as a control reference
                refs = [r.strip().lower() for r in (item["control_ref"] or "").split(",")]
                assert code in item["sub_controls"] or code.lower() in refs, (item["artifact_id"], code)
