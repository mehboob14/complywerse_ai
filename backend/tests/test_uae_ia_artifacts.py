"""UAE Information Assurance Standard v2.1: the artifacts and the other per-framework wiring its regional peers have.

The artifact catalogue entry `uae_ia` (seed_data/artifact_catalog.json) is held to the shape of its peers (ADHICS, SAMA CSF,
QCB ...), every artifact hangs on a real control of the library with the control's own applicability, the resolution rows
(seed_data/artifact_resolution.json) are what artifact_resolver produces, the standard's name reaches the catalogue key through
the function the API uses, and the journey flow in the framework page's data file matches the library's name and no other.
The PDF is not needed here. On in-memory SQLite.
"""
import json
import os
import re
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

import grc.models as m  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "grc" / "seed_data"
FLOWS_TS = ROOT.parent / "grc-frontend" / "src" / "app" / "(dashboard)" / "frameworks" / "[id]" / "_data" / "frameworkFlows.ts"
KEY = "uae_ia"
NAME = "UAE Information Assurance Standard"
FAMILIES = [f"M{i}" for i in range(1, 7)] + [f"T{i}" for i in range(1, 10)]


def _json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def catalog():
    return _json(SEED / "artifact_catalog.json")


@pytest.fixture(scope="module")
def entry(catalog):
    return catalog[KEY]


@pytest.fixture(scope="module")
def library():
    return _json(SEED / "frameworks" / "uae_ia.json")


@pytest.fixture(scope="module")
def controls(library):
    return {c["control_id"]: c for c in library["controls"]}


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    session = Session(engine)
    yield session
    session.close()


# -- the catalogue entry ------------------------------------------------------------------------------------------------

def test_the_entry_has_the_shape_of_its_peers(catalog, entry, library):
    others = {k: v for k, v in catalog.items() if k != KEY}
    assert list(entry) == ["name", "artifacts"] and all(list(v) == ["name", "artifacts"] for v in others.values())
    # the library's own name: the Templates popup links a draft to the tenant's framework by this exact string
    assert entry["name"] == NAME == library["metadata"]["name"]

    keys = tuple(catalog["adhics"]["artifacts"][0])           # the key order of the regional peers
    assert {frozenset(a) for v in others.values() for a in v["artifacts"]} == {frozenset(keys)}      # every peer has these keys
    peer_types = {a["type"] for v in others.values() for a in v["artifacts"]}
    peer_formats = {a["format"] for v in others.values() for a in v["artifacts"]}
    peer_stages = {a["stage"] for v in others.values() for a in v["artifacts"]}

    arts = entry["artifacts"]
    assert len(arts) >= 16                                   # the shortest peer list
    for a in arts:
        assert tuple(a) == keys, a["artifact_id"]
        assert a["type"] in peer_types and a["format"] in peer_formats and a["stage"] in peer_stages, a["artifact_id"]
        assert isinstance(a["mandatory"], bool)
        assert all(isinstance(a[k], str) and a[k].strip() for k in keys if k != "mandatory"), a["artifact_id"]
        # one sentence, grounded in the control: the catalogue description is also the focus a Studio draft starts from
        assert a["description"].endswith(".") and "\n" not in a["description"] and ". " not in a["description"], a["artifact_id"]
    assert len({a["name"] for a in arts}) == len(arts)


def test_ids_stages_and_lengths_follow_the_catalogue_conventions(catalog, entry):
    arts = entry["artifacts"]
    ids = [a["artifact_id"] for a in arts]
    assert ids == [f"UAEIA-{i:03d}" for i in range(1, len(ids) + 1)]           # PREFIX-NNN, contiguous from 001
    # artifact_content lookups and the control page fall back across frameworks by id alone, so ids must not collide
    other_ids = {a["artifact_id"] for k, v in catalog.items() if k != KEY for a in v["artifacts"]}
    assert not set(ids) & other_ids

    numbers = [int(a["stage"].split()[1].rstrip(":")) for a in arts]            # how _ensure_catalog_seeded reads the stage
    assert numbers == sorted(numbers) and set(numbers) == {1, 2, 3, 4, 5, 6}

    table = m.ArtifactCatalogItem.__table__.c
    columns = {"artifact_id": "artifact_id", "stage": "stage", "name": "name", "type": "artifact_type",
               "control_ref": "control_ref", "format": "format", "owner": "owner"}
    for a in arts:
        for field, column in columns.items():
            assert len(a[field]) <= table[column].type.length, (a["artifact_id"], field)
    assert len(KEY) <= table.framework_key.type.length and len(entry["name"]) <= table.framework_name.type.length


def test_the_entry_is_plain_ascii_and_carries_no_scf_text(entry):
    text = json.dumps(entry, ensure_ascii=False)
    assert all(ord(ch) < 128 for ch in text)
    # SCF ids look like "GOV-01"; the standard has no SCF rows yet and SCF text must not be copied into the catalogue
    assert not re.search(r"\b[A-Z]{2,4}-\d{2}\b", text)


# -- traceability to the library's controls -------------------------------------------------------------------------------

def test_every_artifact_hangs_on_a_real_control_and_follows_its_applicability(entry, controls):
    from grc.routers.artifacts_router import _ref_matches_any

    for a in entry["artifacts"]:
        ref = a["control_ref"]
        assert ref in controls, (a["artifact_id"], ref)                          # one exact control id, no list or prose
        control = controls[ref]
        assert a["mandatory"] is control["is_mandatory"] is (control["applicability"] == "Always applicable"), a["artifact_id"]
        # the matcher the framework page's per-requirement "Compliance Artifacts" section uses
        assert _ref_matches_any(ref, [ref]) and not _ref_matches_any(ref, [ref.rsplit(".", 1)[0]])


def test_every_control_family_has_a_document_and_the_foundation_documents_are_there(entry, controls):
    refs = [a["control_ref"] for a in entry["artifacts"]]
    # all 15 families (M1-M6, T1-T9) each hold Always Applicable controls, and each has at least one artifact
    assert {r.split(".")[0] for r in refs} == set(FAMILIES)
    # the documents the standard names outright (policy, objectives, plan, statement, ...) are on the controls that name them
    must = {"M1.2.1": "Information Security Policy", "M1.2.2": "Information Security Objectives",
            "M2.3.3": "Information Security Risk Treatment Plan", "M2.3.4": "Statement of Applicability",
            "T1.2.1": "Information Asset Inventory", "T8.2.1": "Incident Response Plan", "T9.1.1": "ICT Continuity Plan",
            "M3.2.1": "Awareness and Training Program", "M6.2.3": "Management Review Record"}
    by_ref = {}
    for a in entry["artifacts"]:
        by_ref.setdefault(a["control_ref"], []).append(a["name"])
    for ref, name in must.items():
        assert name in by_ref.get(ref, []), (ref, name)
        assert controls[ref]["is_mandatory"] is True


# -- the resolution rows ---------------------------------------------------------------------------------------------------

def test_the_resolution_rows_are_exact_matches_and_what_the_resolver_produces(entry):
    from grc.tools import artifact_resolver

    rows = [r for r in _json(SEED / "artifact_resolution.json")["items"] if r["framework_key"] == KEY]
    assert [(r["artifact_id"], r["name"], r["control_ref"]) for r in rows] == \
        [(a["artifact_id"], a["name"], a["control_ref"]) for a in entry["artifacts"]]
    for r in rows:
        assert r["slug"] == KEY and r["codes"] == [r["control_ref"]] and r["match_mode"] == "exact", r["artifact_id"]
        assert (r["status"] == "resolved") is bool(r["scf_ids"]), r["artifact_id"]

    # the committed rows are the resolver's output (it runs offline on the seed files), so the file is not hand-drifted
    fresh = [r for r in artifact_resolver.resolve()["items"] if r["framework_key"] == KEY]
    assert fresh == rows
    # no SCF rows are authored for the standard yet, so no artifact can reach an SCF control; they upgrade on the next --emit
    if not (SEED / "scf" / "crosswalks" / "direct" / "uae_ia.json").exists():
        assert all(r["scf_ids"] == [] and r["status"] == "no_scf_mapping" for r in rows)


# -- the name -> catalogue key wiring ------------------------------------------------------------------------------------

def test_the_standards_name_and_slug_reach_the_catalogue_key_and_no_other_name_does(catalog):
    from grc.routers.artifacts_router import ASSESSMENT_TYPE_MAP, _resolve_framework_key

    for raw in (NAME, NAME.upper(), f"  {NAME} ", "UAE IA", "uae_ia", "UAE Information Assurance", "UAE IA Standard v2.1"):
        assert _resolve_framework_key(raw) == KEY, raw
    assert {v for k, v in ASSESSMENT_TYPE_MAP.items() if "uae" in k} == {KEY}
    assert KEY in catalog

    # the new aliases must not capture any other framework's name (library names, catalogue names, their own keys)
    names = {_json(p)["metadata"]["name"] for p in (SEED / "frameworks").glob("*.json")} - {NAME}
    names |= {v["name"] for k, v in catalog.items() if k != KEY} | {k for k in catalog if k != KEY}
    names |= {k for k, v in ASSESSMENT_TYPE_MAP.items() if v != KEY}
    assert len(names) > 80
    assert not [n for n in sorted(names) if _resolve_framework_key(n) == KEY]
    # and the peers still resolve as before
    assert _resolve_framework_key("Abu Dhabi Healthcare Information and Cyber Security Standard") == "adhics"
    assert _resolve_framework_key("SAMA Cyber Security Framework") == "sama_csf"
    assert _resolve_framework_key("Qatar Central Bank Technology Risks Circular") == "qatar_cb"


def test_seeding_and_the_api_serve_the_catalogue_by_the_standards_name(db, entry):
    from grc.routers.artifacts_router import _ensure_catalog_seeded, get_catalog, list_artifacts_by_control

    _ensure_catalog_seeded(db)
    _ensure_catalog_seeded(db)                                                   # idempotent: only missing keys are seeded
    rows = db.query(m.ArtifactCatalogItem).filter_by(framework_key=KEY).order_by(m.ArtifactCatalogItem.id).all()
    assert [r.artifact_id for r in rows] == [a["artifact_id"] for a in entry["artifacts"]]
    assert {r.framework_name for r in rows} == {NAME}
    assert sorted({r.stage_number for r in rows}) == [1, 2, 3, 4, 5, 6]
    # the platform's own asset inventory and risk register are linked by name (as in the peers' lists); nothing else is
    native = {(r.name, r.platform_data_type) for r in rows if r.is_platform_native}
    assert native == {("Information Asset Inventory", "asset_inventory"), ("Information Security Risk Register", "risk_register")}

    got = get_catalog(framework_key=None, assessment_type=NAME, db=db, current_user=None)
    assert got["framework_key"] == KEY and got["framework_name"] == NAME
    assert [i["artifact_id"] for i in got["items"]] == [a["artifact_id"] for a in entry["artifacts"]]
    assert got["stages"] == sorted({a["stage"] for a in entry["artifacts"]})
    by_slug = get_catalog(framework_key=None, assessment_type="uae_ia", db=db, current_user=None)
    assert by_slug["framework_key"] == KEY and len(by_slug["items"]) == len(entry["artifacts"])

    # the per-requirement section: a requirement shows the artifacts whose control_ref is exactly that requirement
    def names_for(code):
        out = list_artifacts_by_control(framework_key=None, assessment_type=NAME, control_ref=code, db=db, current_user=None)
        return {i["name"] for i in out["catalog"]}

    assert names_for("M2.3.4") == {"Statement of Applicability"}
    assert names_for("m2.3.4") == {"Statement of Applicability"}
    assert names_for("M1.1.3") == {"Information Security Governance Charter"}
    assert names_for("M2.3") == set() and names_for("M2.3.40") == set()          # token-equal, not a prefix


# -- the journey flow on the framework page -----------------------------------------------------------------------------

def _flows():
    src = FLOWS_TS.read_text(encoding="utf-8")
    head = "export const FRAMEWORK_FLOWS: FrameworkFlow[] = "
    start = src.index(head) + len(head)
    return json.loads(src[start:src.index("\n];", start) + 2])                  # the generated array is a JSON literal


def _match_flow(name, flows):
    """matchFrameworkFlow in frameworkFlows.ts: the longest flow token found in the name with everything but a-z0-9 removed."""
    norm = re.sub(r"[^a-z0-9]", "", (name or "").lower())
    best, best_len = None, 0
    for f in flows:
        for token in f["match"]:
            if token and token in norm and len(token) > best_len:
                best, best_len = f["id"], len(token)
    return best


@pytest.mark.skipif(not FLOWS_TS.exists(), reason="frontend not checked out")
def test_the_journey_flow_follows_the_pattern_and_matches_only_the_standard(library, controls):
    flows = _flows()
    ids = [f["id"] for f in flows]
    assert len(ids) == len(set(ids)) and ids.count("uaeia") == 1
    flow = next(f for f in flows if f["id"] == "uaeia")
    peer = next(f for f in flows if f["id"] == "adhics")

    assert list(flow) == list(peer)
    assert all(list(p) == list(peer["phases"][0]) for p in flow["phases"])
    assert flow["controls"] == len(controls) == 134 and flow["version"] == library["metadata"]["version"] == "2.1"
    assert (flow["group"], flow["region"]) == ("UAE & Qatar", "United Arab Emirates")
    assert [p["n"] for p in flow["phases"]] == list(range(1, len(flow["phases"]) + 1))
    for p in flow["phases"]:
        assert p["name"] and p["coverage"] and p["owner"] and isinstance(p["ext"], bool)
        assert p["deliverables"] and p["evidence"] and all(isinstance(x, str) and x for x in p["deliverables"] + p["evidence"])
    assert [p["n"] for p in flow["phases"] if p["ext"]] == [7]                  # the CSC / lead-entity reporting step is the external one
    assert 1 <= flow["loopback"]["to"] < flow["loopback"]["from"] <= len(flow["phases"])

    # the framework page picks the flow by the journey's framework name
    assert _match_flow(NAME, flows) == "uaeia" and _match_flow("UAE IA", flows) == "uaeia"
    others = {_json(p)["metadata"]["name"] for p in (SEED / "frameworks").glob("*.json")} - {NAME}
    assert [n for n in sorted(others) if _match_flow(n, flows) == "uaeia"] == []
    assert _match_flow("Abu Dhabi Healthcare Information and Cyber Security Standard", flows) == "adhics"
    assert _match_flow("SAMA Cyber Security Framework", flows) == "sama"
