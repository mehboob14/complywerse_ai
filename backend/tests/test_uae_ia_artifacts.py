"""UAE Information Assurance Standard v2.1: the artifacts and the other per-framework wiring its regional peers have.

The artifact catalogue entry `uae_ia` (seed_data/artifact_catalog.json) is held to the shape of its peers (ADHICS, SAMA CSF,
QCB ...), every artifact hangs on a real control of the library with the control's own applicability, the resolution rows
(seed_data/artifact_resolution.json) are what artifact_resolver produces, the standard's name reaches the catalogue key through
the function the API uses, and the journey flow in the framework page's data file matches the library's name and no other.
The PDF is not needed here. On in-memory SQLite.

The artifacts follow the evidence recommendations the library ships (seed_data/frameworks/uae_ia.json: 527 items on the standard's
134 controls and 333 on its 128 annex rows, E1-E3 and F1-F4). Every item is classified once, in CLASSIFICATION at the end of this file:
  class A, an authored document: a policy, standard, procedure, plan, register, matrix, schedule, template, report, or a section
          of one, that the entity writes and maintains. The value is the id of the artifact that provides it, and that artifact
          lists the item's name in its `evidence`.
  class B, a record or an output of operating the control or of a system. The value is one reason code (REASONS). No artifact
          lists it: it is uploaded or generated, not authored.
An artifact's `control_ref` is its primary control; `also_controls` are the other controls whose items it provides.
"""
import collections
import json
import os
import re
import subprocess
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
ANNEXES = ["E1", "E2", "E3", "F1", "F2", "F3", "F4"]          # the national policies the annex rows belong to
# the artifact types the content generator builds a document skeleton from (scripts/generate_artifact_content.py)
TYPE_WORDS = {"policy", "standard", "guideline", "procedure", "process", "charter", "register", "plan", "report", "record",
              "log", "assessment", "form", "template", "matrix", "attestation", "strategy", "agreement", "training", "evidence"}
STAGES = {"Stage 1: Governance & Scoping", "Stage 2: Risk Assessment", "Stage 3: Policy & Control Design",
          "Stage 4: Implementation", "Stage 5: Operation & Monitoring", "Stage 6: Audit & Regulatory Reporting"}
REASONS = {
    "approval": "approval, sign-off, appointment, authorization or decision record; the approval or review history of a document",
    "minutes": "minutes of a meeting",
    "notice": "notification, circulation, awareness or availability evidence (a message, notice or publication)",
    "export": "screenshot, configuration or settings export, or a report from a system or tool",
    "log": "system log, monitoring or event extract",
    "test": "test, scan, inspection, check, review, reconciliation, survey or evaluation result",
    "signed": "signed acknowledgement or acceptance, executed contract or agreement",
    "sample": "sample of events, records, documents or extracts produced by operating the control",
    "record": "operating record kept while running the control (return, disposal, deletion, custody, access, change, training)",
}


def _natural(cid):
    """M1.2.10 sorts after M1.2.9."""
    return [int(p) if p.isdigit() else p for p in re.findall(r"\d+|\D+", cid)]


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


@pytest.fixture(scope="module")
def layer(controls):
    """control id -> the names of its evidence items as the library ships them: the 134 controls and the 128 annex rows."""
    return {cid: [e["name"] for e in c["evidence_requirements"]] for cid, c in controls.items()}


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

    arts = entry["artifacts"]
    assert len(arts) >= 100                                  # one artifact per authored document the evidence asks for
    for a in arts:
        # the peers' nine keys in the peers' order, then the two this entry adds: also_controls (optional) and evidence
        assert tuple(a)[:len(keys)] == keys, a["artifact_id"]
        assert list(a)[len(keys):] in (["evidence"], ["also_controls", "evidence"]), a["artifact_id"]
        assert {w.lower() for w in a["type"].split("/")} <= TYPE_WORDS, a["artifact_id"]
        assert a["format"] in {"DOCX", "XLSX", "PDF"} and a["stage"] in STAGES, a["artifact_id"]
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
    assert set(numbers) == {1, 2, 3, 4, 5, 6}                                   # (new ones are numbered in control order, so the list is not stage-sorted)

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
        # a document that serves several controls hangs on its primary one and names the others, in control order
        also = a.get("also_controls", [])
        assert all(c in controls and c != ref for c in also) and also == sorted(set(also), key=_natural), a["artifact_id"]
        # a document never spans two policies: it serves the standard's own controls (no `annex` key) or the rows of one annex policy
        assert len({controls[c].get("annex") for c in [ref, *also]}) == 1, a["artifact_id"]


def test_every_control_family_has_a_document_and_the_foundation_documents_are_there(entry, controls):
    core = [a["control_ref"] for a in entry["artifacts"] if "annex" not in controls[a["control_ref"]]]
    # all 15 families (M1-M6, T1-T9) each hold Always Applicable controls, and each has at least one artifact
    assert {r.split(".")[0] for r in core} == set(FAMILIES)
    # each of the seven annex policies (E1-E3 national technology policies, F1-F4 national policy mappings) has documents as well
    assert {controls[a["control_ref"]]["annex"] for a in entry["artifacts"] if "annex" in controls[a["control_ref"]]} == set(ANNEXES)
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


# -- the evidence the artifacts follow ---------------------------------------------------------------------------------------

def test_each_artifacts_evidence_comes_from_the_evidence_layer(entry, layer):
    seen = {}
    for a in entry["artifacts"]:
        names = a["evidence"]
        assert names and len(set(names)) == len(names) and all(isinstance(n, str) and n for n in names), a["artifact_id"]
        controls = [a["control_ref"]] + a.get("also_controls", [])
        carried = set()
        for name in names:
            owners = [c for c in controls if name in layer[c]]                     # exact names, under the artifact's controls
            assert len(owners) == 1, (a["artifact_id"], name)
            carried.add(owners[0])
            assert name not in seen, (name, seen.get(name), a["artifact_id"])      # an item is provided by one artifact only
            seen[name] = a["artifact_id"]
        assert carried == set(controls), a["artifact_id"]                          # the primary control and every other one carry an item


def test_every_evidence_item_is_classified_and_every_authored_one_has_an_artifact(entry, layer):
    assert set(CLASSIFICATION) == set(layer)
    by_id = {a["artifact_id"]: a for a in entry["artifacts"]}
    provided = {n: a["artifact_id"] for a in entry["artifacts"] for n in a["evidence"]}
    authored, records = 0, collections.Counter()
    for control, row in CLASSIFICATION.items():
        assert list(row) == layer[control], control                                # the same items in the same order, none missing
        for name, value in row.items():
            if value in REASONS:                                                   # class B: a record or an output
                records[value] += 1
                assert name not in provided, name
            else:                                                                  # class A: an authored document
                authored += 1
                a = by_id[value]
                assert provided.get(name) == value, (control, name)
                assert control == a["control_ref"] or control in a.get("also_controls", []), (control, name)
    assert authored + sum(records.values()) == sum(len(v) for v in layer.values())
    assert authored == len(provided)                                               # nothing is provided that is not authored
    assert set(records) == set(REASONS)                                            # every reason code is used


def test_the_other_frameworks_entries_are_untouched(catalog):
    """A guard for the commit that adds the evidence: no entry other than uae_ia differs from the committed catalogue."""
    try:
        out = subprocess.run(["git", "show", "HEAD:backend/grc/seed_data/artifact_catalog.json"], cwd=ROOT.parent,
                             capture_output=True, check=True, timeout=60).stdout
    except (OSError, subprocess.SubprocessError):
        pytest.skip("no git history to compare with")
    head = json.loads(out.decode("utf-8"))
    assert [k for k in head if k != KEY and catalog.get(k) != head[k]] == []


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
    # the API lists the stages in order and each stage by artifact id (new artifacts are numbered in control order, not stage order)
    in_api_order = sorted(entry["artifacts"], key=lambda a: (int(a["stage"].split()[1].rstrip(":")), a["artifact_id"]))
    assert [i["artifact_id"] for i in got["items"]] == [a["artifact_id"] for a in in_api_order]
    assert got["stages"] == sorted({a["stage"] for a in entry["artifacts"]})
    by_slug = get_catalog(framework_key=None, assessment_type="uae_ia", db=db, current_user=None)
    assert by_slug["framework_key"] == KEY and len(by_slug["items"]) == len(entry["artifacts"])

    # the per-requirement section: a requirement shows the artifacts of that control AND the documents that serve it as one of their
    # `also_controls` (stored as "T2.3.1, T2.3.2": the router reads a comma list as several references)
    def names_for(code):
        out = list_artifacts_by_control(framework_key=None, assessment_type=NAME, control_ref=code, db=db, current_user=None)
        return {i["name"] for i in out["catalog"]}

    def expected_for(code):
        return {a["name"] for a in entry["artifacts"] if code in [a["control_ref"], *(a.get("also_controls") or [])]}

    for code in ("M2.3.4", "m2.3.4", "M1.1.3", "M1.3.3", "T2.3.5", "T2.3.2", "E1-2.1.1", "e1-2.4.1", "E1-2.6.2", "E3-2.1.4", "F1-5.7",
                 "F2-5.2", "F4-5.4"):
        assert names_for(code) == expected_for(code.upper()) and names_for(code), code
    assert "Statement of Applicability" in names_for("M2.3.4")
    assert "Information Security Governance Charter" in names_for("M1.1.3")
    assert {"Document Control Procedure", "Controlled Document Register"} <= names_for("M1.3.3")
    assert "Equipment Security Procedure" in names_for("T2.3.5")                  # its control_ref is T2.3.1; T2.3.5 is an also_control
    assert "Cloud Data Classification Mapping Matrix" in names_for("E1-2.6.2")   # its control_ref is E1-2.3.1; E1-2.6.2 is an also_control
    assert names_for("M2.3") == set() and names_for("M2.3.40") == set()          # token-equal, not a prefix
    assert names_for("E1-2") == set() and names_for("E1-2.4") == set() and names_for("F1-5") == set()
    stored = {r.artifact_id: r.control_ref for r in db.query(m.ArtifactCatalogItem).filter_by(framework_key=KEY)}
    assert all(stored[a["artifact_id"]] == ", ".join([a["control_ref"], *(a.get("also_controls") or [])]) for a in entry["artifacts"])


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
    assert flow["controls"] == len(controls) == 262 and flow["version"] == library["metadata"]["version"] == "2.1"
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


# -- the classification of the evidence layer ---------------------------------------------------------------------------------
# control id -> {evidence item name: id of the artifact that provides it (class A) | reason code (class B, see REASONS)}
CLASSIFICATION = {
    "M1.1.1": {
        "Interested parties register": "UAEIA-034",
        "Requirements of interested parties": "UAEIA-034",
        "External context analysis": "UAEIA-035",
        "Internal capabilities assessment": "UAEIA-035",
        "Organization chart": "UAEIA-035",
    },
    "M1.1.2": {
        "Top management approval of security direction": "approval",
        "Security requirements built into business processes": "sample",
        "Resource commitment approvals": "approval",
        "Top management communications on information security": "notice",
        "Top management review of information security": "UAEIA-032",
        "Continual improvement and management support record": "record",
    },
    "M1.1.3": {
        "Assignment of responsibility and authority": "UAEIA-003",
        "Information security performance report": "UAEIA-068",
        "Appointment of the information security lead": "approval",
        "Information Security Committee charter": "UAEIA-003",
        "Information Security Committee minutes": "minutes",
    },
    "M1.2.1": {
        "Approved information security policy": "UAEIA-001",
        "Top management approval of the policy": "approval",
        "Policy review and revision record": "approval",
        "Policy communication to staff": "notice",
        "Policy availability to interested parties": "notice",
    },
    "M1.2.2": {
        "Documented information security objectives": "UAEIA-002",
        "Objectives basis record": "UAEIA-002",
        "Approval of the objectives": "approval",
        "Objectives communication record": "notice",
        "Objectives update record": "approval",
    },
    "M1.2.3": {
        "Approved supporting policy set": "UAEIA-012",
        "Policy coverage matrix": "UAEIA-036",
        "Policy-to-practice consistency review": "test",
        "Policy publication and communication record": "notice",
        "Personnel acknowledgement records": "signed",
        "Supporting policy review log": "approval",
    },
    "M1.3.1": {
        "Information security budget and staffing plan": "UAEIA-037",
        "Competence requirements for security roles": "UAEIA-038",
        "Staff competence records": "UAEIA-018",
        "Competence gap actions and effectiveness evaluation": "record",
    },
    "M1.3.2": {
        "Communication plan": "UAEIA-004",
        "Authority and lead entity contact list": "UAEIA-039",
        "Correspondence with authorities": "sample",
        "Compliance progress report to the lead entity": "UAEIA-132",
    },
    "M1.3.3": {
        "Document control procedure": "UAEIA-040",
        "Controlled document register": "UAEIA-041",
        "Document approval records": "approval",
        "Repository access and distribution settings": "export",
        "Document disposal records": "record",
        "Mandatory controls compliance record": "UAEIA-042",
    },
    "M1.3.4": {
        "Project management procedure with security requirements": "UAEIA-043",
        "Project information security risk assessments": "sample",
        "Project security requirements": "sample",
        "Risk treatment progress and effectiveness review": "test",
    },
    "M1.3.5": {
        "Special interest groups register": "UAEIA-044",
        "Rules on what participants may share": "UAEIA-045",
        "Circulated interest group information": "notice",
    },
    "M2.1.1": {
        "Approved risk management policy": "UAEIA-006",
        "Risk criteria definitions": "UAEIA-006",
        "Risk treatment and monitoring strategy": "UAEIA-006",
        "Risk assessment approach": "UAEIA-006",
        "Risk assessment consistency check": "test",
        "Risk management policy approval and version history": "approval",
    },
    "M2.2.1": {
        "Risk identification results": "UAEIA-008",
        "Risk owner assignments": "UAEIA-008",
        "Level of detail decision": "UAEIA-006",
    },
    "M2.2.2": {
        "Consequence assessment": "UAEIA-009",
        "Likelihood assessment": "UAEIA-009",
        "Threat and vulnerability inputs": "sample",
        "Risk analysis results": "UAEIA-009",
    },
    "M2.2.3": {
        "Risk evaluation results": "UAEIA-009",
        "Treatment priorities": "UAEIA-009",
        "Evaluation results shared with lead entities": "notice",
    },
    "M2.3.1": {
        "Treatment option decisions": "UAEIA-046",
        "Risk acceptance approvals": "approval",
        "Residual risk and treatment effectiveness review": "test",
    },
    "M2.3.2": {
        "Control selection record": "UAEIA-046",
        "Control coverage in the Statement of Applicability": "UAEIA-011",
        "Entity-specific additional controls": "UAEIA-011",
        "Control selection criteria review": "test",
    },
    "M2.3.3": {
        "Risk treatment plan": "UAEIA-010",
        "Treatment implementation schedule": "UAEIA-010",
        "Treatment plan approval": "approval",
    },
    "M2.3.4": {
        "Statement of Applicability": "UAEIA-011",
        "Risk-to-control traceability": "UAEIA-046",
        "Implementation status evidence": "test",
        "Control exclusion justifications": "UAEIA-011",
    },
    "M2.4.1": {
        "Risk review and update procedure": "UAEIA-130",
        "Risk factor monitoring records": "record",
        "Risk review records": "record",
        "Risk management improvement record": "record",
    },
    "M2.4.2": {
        "Risk communication plan": "UAEIA-047",
        "Risk communication records": "notice",
    },
    "M3.1.1": {
        "Approved awareness and training policy": "UAEIA-048",
        "Awareness and training objectives": "UAEIA-048",
        "Provider and recipient role assignments": "UAEIA-048",
        "Awareness and training policy approval and review history": "approval",
    },
    "M3.2.1": {
        "Approved awareness and training program": "UAEIA-017",
        "Awareness delivery records": "UAEIA-018",
        "Training and other actions delivered": "UAEIA-018",
        "Effectiveness evaluation of actions taken": "test",
        "Education, skills and qualification records": "UAEIA-018",
    },
    "M3.3.1": {
        "Required information security skills": "UAEIA-049",
        "Current skills assessment": "UAEIA-049",
        "Skills gap analysis": "UAEIA-049",
    },
    "M3.3.2": {
        "Training solution per need": "UAEIA-050",
        "Training implementation plan": "UAEIA-050",
        "Training resource allocation": "approval",
    },
    "M3.3.3": {
        "Training delivery records": "UAEIA-018",
        "Plan variance and alternative solutions record": "record",
        "Updated training implementation plan": "UAEIA-050",
    },
    "M3.3.4": {
        "Before and after knowledge measurements": "test",
        "Training outcome evaluation": "test",
        "Training corrective actions": "record",
    },
    "M3.3.5": {
        "Individual training records": "UAEIA-018",
        "Training records periodic check": "test",
        "Training record retention evidence": "test",
    },
    "M3.4.1": {
        "Awareness campaign scope": "UAEIA-051",
        "Awareness campaign timeline": "UAEIA-051",
        "Campaign delivery evidence": "sample",
        "Campaign adjustment record": "record",
        "Awareness campaign records": "UAEIA-051",
    },
    "M4.1.1": {
        "Background verification procedure": "UAEIA-052",
        "Verification check completion records": "sample",
        "Verification coverage review": "test",
        "Verification document handling": "export",
    },
    "M4.1.2": {
        "Standard information security terms and conditions": "UAEIA-019",
        "Contracts containing information security terms": "signed",
        "Understanding and acceptance records": "signed",
        "Contract review and amendment record": "record",
    },
    "M4.2.1": {
        "Security policy notification records": "notice",
        "First-access acceptance screen": "export",
        "User acceptance records": "signed",
    },
    "M4.2.2": {
        "Formal disciplinary process": "UAEIA-053",
        "Disciplinary process awareness evidence": "notice",
        "Disciplinary action records": "record",
        "Security breach register": "UAEIA-054",
    },
    "M4.3.1": {
        "Termination and change of employment procedure": "UAEIA-055",
        "Continuing duties in contracts": "signed",
        "Communication of continuing responsibilities": "notice",
    },
    "M4.3.2": {
        "Asset return procedure": "UAEIA-055",
        "Asset return records": "record",
        "Leaver asset reconciliation": "test",
    },
    "M5.1.1": {
        "Compliance requirements identification procedure": "UAEIA-056",
        "Legal, regulatory and contractual requirements register": "UAEIA-005",
        "System requirements from compliance obligations": "UAEIA-005",
        "Compliance requirement to control mapping": "UAEIA-005",
        "Periodic review of compliance requirements": "test",
    },
    "M5.1.2": {
        "Intellectual property rights policy": "UAEIA-057",
        "Intellectual property requirements identification": "UAEIA-056",
        "Intellectual property system requirements": "UAEIA-058",
        "License and ownership register": "UAEIA-058",
        "Intellectual property controls review": "test",
    },
    "M5.1.3": {
        "Record identification procedure": "UAEIA-059",
        "Records inventory and retention schedule": "UAEIA-060",
        "Record protection controls": "export",
        "Record protection requirements review": "test",
    },
    "M5.1.4": {
        "Data privacy and protection policy": "UAEIA-061",
        "Applicable data protection laws register": "UAEIA-005",
        "Personal data handling inventory": "UAEIA-062",
        "Privacy risk assessments": "UAEIA-063",
        "Data protection control implementation record": "UAEIA-005",
        "Data breach detection and response procedure": "UAEIA-064",
    },
    "M5.2.1": {
        "Compliance checking procedure": "UAEIA-065",
        "Compliance check results": "UAEIA-030",
        "Checker and reviewer authorization": "approval",
        "Non-compliance tracking": "UAEIA-033",
    },
    "M5.3.1": {
        "Approved audit access requests": "approval",
        "Technical audit test scope agreement": "approval",
        "Audit access restrictions and clean-up": "record",
    },
    "M6.1.1": {
        "Approved performance evaluation policy": "UAEIA-066",
        "Performance results reporting methods": "UAEIA-066",
        "Measurement integration model": "UAEIA-066",
        "Performance evaluation output sample": "sample",
    },
    "M6.2.1": {
        "Monitoring and measurement plan": "UAEIA-067",
        "Monitoring and measurement methods": "UAEIA-067",
        "Monitoring and measurement results": "UAEIA-067",
        "Performance and effectiveness evaluation": "UAEIA-068",
    },
    "M6.2.2": {
        "Internal audit program": "UAEIA-031",
        "Audit plan, criteria and scope": "UAEIA-031",
        "Auditor selection and impartiality record": "approval",
        "Internal audit reports": "UAEIA-031",
        "Audit results reported to management": "notice",
    },
    "M6.2.3": {
        "Management review schedule": "UAEIA-069",
        "Management review inputs": "UAEIA-032",
        "Management review minutes": "UAEIA-032",
        "Management review action tracker": "UAEIA-069",
    },
    "M6.3.1": {
        "Nonconformity and corrective action procedure": "UAEIA-070",
        "Nonconformity register": "UAEIA-033",
        "Root cause analyses": "sample",
        "Corrective action implementation records": "UAEIA-033",
        "Corrective action effectiveness reviews": "test",
    },
    "M6.3.2": {
        "Improvement plan": "UAEIA-071",
        "Improvement decisions from monitoring and review": "UAEIA-071",
        "Improvement implementation evidence": "sample",
    },
    "T1.1.1": {
        "Approved information asset management policy": "UAEIA-072",
        "Bring-your-own-device arrangements": "UAEIA-072",
        "Asset management policy approval and version record": "approval",
    },
    "T1.2.1": {
        "Information asset inventory": "UAEIA-007",
        "Inventory reconciliation with other inventories": "test",
        "Asset ownership listing": "UAEIA-007",
        "Inventory update records": "record",
    },
    "T1.2.2": {
        "Acceptable use rules": "UAEIA-073",
        "Acceptable use rules circulation record": "notice",
        "Acceptance records for the rules": "signed",
        "Acceptable use compliance checks": "test",
    },
    "T1.3.1": {
        "Information classification scheme": "UAEIA-013",
        "Classified information sample": "sample",
        "Classification scheme communication": "notice",
        "Classification review records": "record",
    },
    "T1.3.2": {
        "Information labeling procedure": "UAEIA-074",
        "Labeled information samples": "sample",
        "Labeling exceptions": "record",
    },
    "T1.3.3": {
        "Information handling procedures": "UAEIA-074",
        "Access restrictions by classification": "export",
        "Authorized recipients record": "UAEIA-107",
    },
    "T1.3.4": {
        "Information transfer rules": "UAEIA-075",
        "Information transfer agreements": "signed",
        "Public platform sharing controls": "export",
    },
    "T1.3.5": {
        "Data leak prevention configuration": "export",
        "Leakage monitoring and detection records": "log",
        "Blocked transmission records": "log",
    },
    "T1.3.6": {
        "Information deletion procedure": "UAEIA-076",
        "Deletion records": "record",
        "Third-party deletion requirements": "UAEIA-115",
        "Deletion process review": "test",
    },
    "T1.4.1": {
        "Removable media management procedure": "UAEIA-077",
        "Removable media protection levels": "UAEIA-077",
        "Removable media register": "UAEIA-078",
        "Removable media restriction settings": "export",
        "Removable media usage monitoring": "log",
    },
    "T1.4.2": {
        "Media reuse and disposal procedure": "UAEIA-076",
        "Media sanitization and destruction records": "record",
        "Media disposal log": "UAEIA-079",
    },
    "T1.5.1": {
        "Endpoint device security requirements": "UAEIA-080",
        "Endpoint compliance report": "export",
        "Automatic lockout configuration": "export",
        "Mobile device management enrollment": "export",
        "Work data separation settings": "export",
        "Endpoint logging and monitoring settings": "export",
    },
    "T2.1.1": {
        "Approved physical and environmental security policy": "UAEIA-016",
        "Physical and environmental security procedures": "UAEIA-081",
        "Physical and environmental security policy approval and review history": "approval",
    },
    "T2.2.1": {
        "Security area classification": "UAEIA-082",
        "Security perimeter definitions": "UAEIA-082",
        "Perimeter risk assessment": "UAEIA-083",
        "Perimeter protection inspection records": "test",
    },
    "T2.2.2": {
        "Secure area entry authentication settings": "export",
        "Secure area access records": "log",
        "Visible identification requirement": "UAEIA-081",
        "Physical access log review records": "log",
        "Contractor and third-party escort records": "UAEIA-081",
        "Delivery and loading area access control": "UAEIA-081",
    },
    "T2.2.3": {
        "Public access restriction rules": "UAEIA-081",
        "Facility signage review": "test",
        "Offices and facilities inspection records": "test",
    },
    "T2.2.4": {
        "Physical site risk assessments": "UAEIA-083",
        "Physical protection countermeasures": "UAEIA-083",
        "Physical and environmental threat monitoring record": "record",
    },
    "T2.2.5": {
        "Secure area working guidelines": "UAEIA-081",
        "Secure area supervision records": "record",
        "Recording equipment and device authorization": "UAEIA-081",
        "Surveillance coverage and test records": "test",
    },
    "T2.3.1": {
        "Equipment siting and protection guidelines": "UAEIA-084",
        "Equipment location inspection records": "test",
        "Environmental monitoring configuration": "export",
        "Environmental alert records": "log",
    },
    "T2.3.2": {
        "Power protection description": "UAEIA-084",
        "Supporting utilities inspection and test records": "test",
        "Emergency lighting test records": "test",
    },
    "T2.3.3": {
        "Cable tamper protection evidence": "test",
        "Cable segregation layout": "test",
        "Cable labeling and inspection records": "test",
    },
    "T2.3.4": {
        "Supplier maintenance recommendations": "sample",
        "Equipment commissioning and decommissioning procedure": "UAEIA-084",
        "Equipment maintenance log": "UAEIA-085",
        "Maintenance personnel authorization and data clearing": "record",
    },
    "T2.3.5": {
        "Off-site equipment protection rules": "UAEIA-084",
        "Off-site equipment authorization and custody records": "UAEIA-133",
        "Off-premise location risk assessment": "UAEIA-083",
    },
    "T2.3.6": {
        "Equipment disposal and re-use procedure": "UAEIA-076",
        "Data removal and destruction evidence": "record",
        "Disposed equipment register": "UAEIA-079",
    },
    "T2.3.7": {
        "Clear desk and clear screen policy": "UAEIA-086",
        "Policy availability to users": "notice",
        "Screen lock configuration": "export",
        "Clear desk inspection results": "test",
    },
    "T3.1.1": {
        "Minimum security configuration standards": "UAEIA-020",
        "Applied configuration evidence": "export",
        "Configuration compliance monitoring report": "export",
        "Security configuration review records": "test",
    },
    "T3.1.2": {
        "Approved operating procedures": "UAEIA-087",
        "Operating procedure review records": "approval",
        "Operating procedure access and awareness": "notice",
    },
    "T3.1.3": {
        "Change management procedure": "UAEIA-088",
        "Change management scope": "UAEIA-088",
        "Change log": "UAEIA-089",
        "Rollback and communication plans": "sample",
    },
    "T3.1.4": {
        "Environment separation description": "UAEIA-090",
        "Environment separation settings": "export",
        "Environment transfer rules": "UAEIA-090",
        "Software promotion records": "sample",
    },
    "T3.1.5": {
        "Capacity measurements": "export",
        "Capacity requirements forecast": "UAEIA-091",
        "Capacity adjustment and stress test records": "test",
    },
    "T3.1.6": {
        "Anti-malware coverage report": "export",
        "Anti-malware update status": "export",
        "Malware scanning configuration": "export",
        "Auto-run disabled configuration": "export",
        "Malware detection events and notifications": "log",
        "Malware awareness records": "notice",
    },
    "T3.1.7": {
        "Backup requirements": "UAEIA-021",
        "Backup procedures": "UAEIA-021",
        "Backup job records": "log",
        "Backup restoration test results": "test",
    },
    "T3.1.8": {
        "Software installation restrictions": "export",
        "Software original copy repository": "UAEIA-092",
        "Unauthorized software review records": "test",
        "Software installation audit log": "log",
    },
    "T3.2.1": {
        "Approved monitoring policy and procedures": "UAEIA-093",
        "Monitoring to incident response procedure": "UAEIA-093",
        "Logging requirements": "UAEIA-093",
        "Clock synchronization requirements": "UAEIA-093",
        "External information sharing requirements": "UAEIA-005",
        "Monitoring policy approval and review record": "approval",
    },
    "T3.2.2": {
        "Auditable events list": "UAEIA-094",
        "Audit log samples": "sample",
        "Log review schedule and records": "UAEIA-094",
        "Log reviewer training and skills": "UAEIA-018",
        "Log retention requirements": "UAEIA-094",
        "Critical log protection": "UAEIA-094",
    },
    "T3.2.3": {
        "Monitored system usage list": "UAEIA-094",
        "Monitoring review frequency and records": "UAEIA-094",
        "Monitoring reviewer qualifications": "UAEIA-018",
        "Monitoring information retention requirements": "UAEIA-094",
        "Anomaly alerts and evaluation records": "log",
        "National, Emirate and sector monitoring capability check": "test",
    },
    "T3.2.4": {
        "Date and time standard": "UAEIA-093",
        "Time synchronization configuration": "export",
        "Clock synchronization check results": "test",
    },
    "T3.3.1": {
        "Threat information sources": "UAEIA-095",
        "Collected threat information": "sample",
        "Threat analysis reports": "test",
        "Actions taken on threat intelligence": "UAEIA-095",
    },
    "T3.3.2": {
        "Vulnerability management procedure": "UAEIA-096",
        "Pre-production vulnerability assessment": "UAEIA-025",
        "Production vulnerability scan results": "UAEIA-025",
        "Vulnerability remediation tracker": "UAEIA-097",
    },
    "T3.4.1": {
        "Approved cryptographic policy": "UAEIA-014",
        "Encryption requirements register": "UAEIA-098",
        "Cryptographic compliance monitoring": "test",
        "Weak cipher and algorithm replacement": "UAEIA-098",
    },
    "T3.4.2": {
        "Encryption at rest settings": "export",
        "End-user device encryption status": "export",
        "Database and portable media encryption settings": "export",
        "Encryption in motion configuration": "export",
        "Transmission encryption test results": "test",
    },
    "T3.4.3": {
        "Key management procedure": "UAEIA-099",
        "Key storage settings": "export",
        "Key recovery test records": "test",
        "Key management activity records": "log",
    },
    "T3.4.4": {
        "Public key cryptography inventory": "UAEIA-098",
        "Post-quantum transition plan": "UAEIA-100",
        "Post-quantum laboratory test results": "test",
        "Post-quantum workforce training records": "UAEIA-018",
    },
    "T4.1.1": {
        "Approved network security policy": "UAEIA-015",
        "Network diagram": "UAEIA-131",
        "Network access control configuration": "export",
        "Network risk assessment": "UAEIA-101",
        "Network control implementation record": "UAEIA-101",
        "Traffic control and monitoring configuration": "export",
    },
    "T4.1.2": {
        "Network services security requirements": "UAEIA-102",
        "Network service level agreements": "signed",
        "Network provider assurance records": "test",
    },
    "T4.1.3": {
        "Network segregation criteria": "UAEIA-103",
        "Network segregation configuration": "export",
        "Segregation requirements in the development life cycle": "sample",
        "Segregation effectiveness evaluation": "test",
    },
    "T4.1.4": {
        "Wireless site survey": "test",
        "Wireless segregation configuration": "export",
        "Wireless security controls by network": "UAEIA-103",
        "Wireless usage and configuration standard": "UAEIA-103",
    },
    "T4.1.5": {
        "Website access categories": "UAEIA-103",
        "Web filter configuration": "export",
        "Web filter block records": "log",
    },
    "T5.1.1": {
        "Approved identity and access management policy": "UAEIA-104",
        "Access requirements set by owners": "UAEIA-106",
        "Access policy communication": "notice",
    },
    "T5.2.1": {
        "User identity list": "export",
        "Identity life cycle procedure": "UAEIA-105",
        "Disabled and removed identity records": "record",
        "Restricted identity activity records": "log",
    },
    "T5.2.2": {
        "Access provisioning and de-provisioning procedure": "UAEIA-022",
        "Segregation of duties matrix": "UAEIA-106",
        "Access rights records": "UAEIA-107",
        "Role change and leaver revocation records": "record",
        "Temporary and inactive account review": "test",
    },
    "T5.2.3": {
        "Privileged access register": "UAEIA-026",
        "Administrative group membership export": "export",
        "Administrator account usage controls": "export",
        "Administrative multi-factor authentication settings": "export",
        "Local administrator password controls": "export",
        "Administrative activity logs and reviews": "log",
    },
    "T5.2.4": {
        "Access rights review procedure": "UAEIA-108",
        "Completed access rights reviews": "record",
        "Special access validity checks": "test",
    },
    "T5.3.1": {
        "Information system authentication configuration": "export",
        "Secure log-on and log-off settings": "export",
        "Maximum session time settings": "export",
        "Inactivity timeout settings": "export",
    },
    "T5.3.2": {
        "Access restriction model": "UAEIA-104",
        "Role-based access matrix": "UAEIA-106",
        "System access control settings": "export",
        "Business-need access adjustments": "record",
    },
    "T5.3.3": {
        "Secure remote access configuration": "export",
        "Remote authentication method settings": "export",
        "Remote administrator access approvals": "approval",
        "Remote administrator access monitoring": "log",
    },
    "T5.3.4": {
        "Utility program authorization list": "UAEIA-109",
        "Utility access restriction settings": "export",
        "Utility program usage records": "log",
    },
    "T5.4.1": {
        "Credential issuance procedure": "UAEIA-110",
        "Credential issuance records": "record",
        "Initial credential generation and delivery settings": "export",
    },
    "T5.4.2": {
        "Credential use good practices": "UAEIA-110",
        "Good practice communication records": "notice",
        "Approved credential storage method": "UAEIA-110",
    },
    "T5.4.3": {
        "Credential change automation": "export",
        "Credential strength settings": "export",
        "Credential lifetime and reuse settings": "export",
        "First access password change enforcement": "export",
        "Credential storage protection": "export",
    },
    "T6.1.1": {
        "Approved third-party security policy": "UAEIA-111",
        "Third-party security governance arrangements": "UAEIA-111",
    },
    "T6.2.1": {
        "Third-party risk management procedure": "UAEIA-023",
        "Supplier risk classification register": "UAEIA-112",
        "Third-party cyber security risk assessments": "sample",
        "Supplier risk mitigation plans": "UAEIA-112",
    },
    "T6.2.2": {
        "Supplier security assessment criteria": "UAEIA-113",
        "Completed supplier security assessments": "sample",
        "Supplier due diligence records": "record",
    },
    "T6.2.3": {
        "ICT supply chain security procedure": "UAEIA-023",
        "Procurement security requirements": "UAEIA-114",
        "Pre-procurement product evaluations": "sample",
        "System acceptance test results": "test",
        "Supply chain upgrade and maintenance records": "record",
    },
    "T6.2.4": {
        "Supplier contract security clause templates": "UAEIA-115",
        "Executed supplier contracts": "signed",
        "Legal and regulatory compliance clauses": "UAEIA-115",
    },
    "T6.2.5": {
        "Supplier monitoring program": "UAEIA-116",
        "Supplier access monitoring records": "log",
        "Supplier assessments and audit reports": "test",
        "Supplier change management records": "record",
    },
    "T7.1.1": {
        "Approved acquisition, development and maintenance policy": "UAEIA-117",
        "Policy framework for security in the life cycle": "UAEIA-117",
        "Policy communication to internal and external parties": "notice",
    },
    "T7.2.1": {
        "Application security requirements specification": "UAEIA-024",
        "Requirements by application purpose": "UAEIA-024",
        "Application requirements implementation evidence": "test",
    },
    "T7.2.2": {
        "Secure engineering principles": "UAEIA-118",
        "Principles applied across architecture layers": "sample",
        "Security design reviews": "test",
    },
    "T7.3.1": {
        "Secure coding guidelines": "UAEIA-118",
        "Secure coding use evidence": "sample",
        "Automated security testing results": "test",
        "Developer security training records": "UAEIA-018",
    },
    "T7.3.2": {
        "Quality assurance process": "UAEIA-119",
        "Secure coding and QA contract clauses": "UAEIA-115",
        "Contractual security requirements": "UAEIA-115",
        "Delivered code checks": "test",
        "Outsourced development review records": "record",
    },
    "T7.3.3": {
        "Source code access permissions": "export",
        "Source code permission reviews": "test",
        "Source code access audit log": "log",
    },
    "T7.4.1": {
        "Change control procedure for systems and software": "UAEIA-088",
        "Change track record": "UAEIA-089",
        "Software version archive": "UAEIA-092",
        "Change rollback procedures": "sample",
        "Pre-production change test results": "test",
        "Change implementation planning": "sample",
    },
    "T7.4.2": {
        "Test data selection rules": "UAEIA-090",
        "Production data copy authorizations": "approval",
        "Test environment access settings": "export",
        "Test data erasure records": "record",
        "Test data movement log": "log",
    },
    "T7.4.3": {
        "Security testing requirements": "UAEIA-120",
        "Acceptance parameters for security tests": "UAEIA-120",
        "Security test results": "test",
        "Test completion responsibility assignment": "approval",
    },
    "T8.1.1": {
        "Approved incident management policy": "UAEIA-121",
        "Incident handling and reporting requirements": "UAEIA-005",
        "Incident management policy approval record": "approval",
    },
    "T8.1.2": {
        "Event reporting procedure": "UAEIA-122",
        "Event reporting awareness records": "notice",
        "Reporting channel evidence": "export",
        "Reported event records": "sample",
    },
    "T8.2.1": {
        "Incident response plan": "UAEIA-027",
        "Incident communication plan": "UAEIA-027",
        "Senior management approval of response plans": "approval",
        "Incident response resources and capabilities": "UAEIA-027",
        "Incident Response Team establishment": "UAEIA-027",
    },
    "T8.2.2": {
        "Incident classification and prioritization scheme": "UAEIA-123",
        "National agency reporting criteria": "UAEIA-123",
        "Classified incident records": "sample",
    },
    "T8.2.3": {
        "Incident response training needs analysis": "UAEIA-124",
        "Incident response training program": "UAEIA-124",
        "Incident response training records": "UAEIA-018",
    },
    "T8.2.4": {
        "Incident response test procedures and cases": "UAEIA-125",
        "Incident response test reports": "test",
        "Test findings remediation tracker": "UAEIA-033",
    },
    "T8.2.5": {
        "Incident data collection requirements": "UAEIA-028",
        "Incident documentation records": "UAEIA-028",
        "Incident documentation protection": "export",
    },
    "T8.2.6": {
        "Post-incident reports": "record",
        "Lessons learned records": "UAEIA-126",
        "Incident trend analysis": "test",
    },
    "T8.2.7": {
        "Jurisdictional evidence requirements": "UAEIA-005",
        "Evidence collection procedure": "UAEIA-127",
        "Chain of custody records": "record",
        "Evidence handler competence records": "UAEIA-018",
    },
    "T9.1.1": {
        "Continuity objectives and ICT requirements": "UAEIA-029",
        "ICT continuity organizational structure": "UAEIA-029",
        "Continuity roles and competence records": "record",
        "ICT continuity plans": "UAEIA-029",
        "ICT continuity test and review results": "test",
    },
    "T9.1.2": {
        "Security controls in continuity plans": "UAEIA-128",
        "Disruption security maintenance procedures": "UAEIA-128",
        "Compensating controls register": "UAEIA-128",
    },
    "T9.2.1": {
        "Continuity plan test schedule": "UAEIA-129",
        "Continuity plan test reports": "test",
        "Continuity lessons learned and plan updates": "UAEIA-129",
    },
    # -- the annex rows (Annex E: national technology policies, Annex F: national policy mappings) --
    "E1-2.1.1": {
        "Approved cloud security policy": "UAEIA-134",
        "Cloud security policy review record": "approval",
        "Cloud usage analysis": "UAEIA-135",
        "Provider access and data location analysis": "UAEIA-148",
    },
    "E1-2.1.2": {
        "Cloud risk register": "UAEIA-137",
        "Cloud risk assessment": "UAEIA-136",
        "Cloud risk treatment plan": "UAEIA-137",
        "Cloud risk communication record": "notice",
    },
    "E1-2.1.3": {
        "Cloud provider contract personnel clauses": "signed",
        "Shared responsibility matrix": "UAEIA-138",
        "CSP contract clause checklist": "test",
    },
    "E1-2.1.4": {
        "CSP onboarding risk assessment": "sample",
        "Subcontracting risk assessment": "sample",
        "CSP risk treatment record": "UAEIA-139",
        "Approved CSP register": "UAEIA-140",
    },
    "E1-2.1.5": {
        "Independent assurance reports from the CSP": "test",
        "Review of CSP assurance reports": "test",
        "CSP security certifications": "test",
        "CSP independent assessment register": "UAEIA-139",
    },
    "E1-2.2.1": {
        "CSP due diligence questionnaire": "sample",
        "CSP due diligence assessment report": "sample",
        "Onboarding approval record": "approval",
        "Non-disclosure agreement with the CSP": "signed",
    },
    "E1-2.2.2": {
        "Executed CSP contract": "signed",
        "Service level agreement with availability terms": "signed",
        "Sovereignty, data ownership and location clauses": "signed",
        "Incident, change and audit rights clauses": "signed",
        "Exit, vendor lock-in and dispute clauses": "signed",
    },
    "E1-2.3.1": {
        "Data classification policy": "UAEIA-142",
        "Cloud data handling procedure": "UAEIA-143",
        "Cloud data obligations analysis": "UAEIA-141",
        "Pre-migration data classification record": "record",
        "National cloud classification level mapping": "UAEIA-144",
    },
    "E1-2.3.2": {
        "Encryption policy": "UAEIA-145",
        "Encryption configuration evidence": "export",
        "Cloud encryption key management procedure": "UAEIA-146",
        "Hold your own key risk assessment": "UAEIA-147",
        "Key custody and CSP independence records": "record",
    },
    "E1-2.4.1": {
        "CSP jurisdiction and data location assessment": "UAEIA-148",
        "Cloud data location register": "UAEIA-149",
        "Classified data hosting matrix": "UAEIA-144",
        "Sovereign cloud hosting confirmation": "export",
    },
    "E1-2.5.1": {
        "Interoperability needs evaluation": "UAEIA-150",
        "Cloud integration architecture diagram": "UAEIA-151",
        "Integration standards and API register": "UAEIA-152",
    },
    "E1-2.5.2": {
        "CSP contract data portability clauses": "signed",
        "CSP data portability commitment": "signed",
        "Data export test result": "test",
        "Data deletion terms and confirmation": "signed",
    },
    "E1-2.6.1": {
        "CSP change management documentation": "sample",
        "Procurement check of CSP change controls": "test",
        "Service component tracking sample": "sample",
    },
    "E1-2.6.2": {
        "CSP data center physical security assessment": "test",
        "Independent data center security reports": "test",
        "Data classification to physical security mapping": "UAEIA-144",
    },
    "E1-2.6.3": {
        "Cloud asset inventory": "UAEIA-153",
        "Asset to cloud service mapping": "UAEIA-153",
        "Inventory reconciliation record": "test",
    },
    "E1-2.6.4": {
        "CSP application security assurance": "test",
        "CSP secure coding documentation": "sample",
        "CSP security testing results": "test",
        "Procurement check of application security": "test",
    },
    "E1-2.6.5": {
        "Cloud system hardening guidelines": "UAEIA-154",
        "Hardening implementation samples": "export",
        "Hardening compliance results": "test",
    },
    "E1-2.7.1": {
        "Cloud identity lifecycle procedure": "UAEIA-155",
        "Identity lifecycle sample records": "sample",
        "Privileged account creation procedure": "UAEIA-155",
        "Privileged account restrictions": "export",
        "Privileged access MFA settings": "export",
    },
    "E1-2.7.2": {
        "Cloud access control policy": "UAEIA-156",
        "Cloud resource permissions export": "export",
        "Cloud authentication settings": "export",
        "Authentication methods and procedures": "UAEIA-157",
        "Privileged access MFA enforcement test": "test",
    },
    "E1-2.7.3": {
        "Cloud access control procedure": "UAEIA-158",
        "Access request and approval records": "sample",
        "Cloud access review results": "test",
        "Access removal records": "record",
    },
    "E1-2.8.1": {
        "Cloud incident management procedure": "UAEIA-159",
        "Incident management test results": "test",
        "Cloud incident records": "record",
    },
    "E1-2.8.2": {
        "External incident notification procedure": "UAEIA-159",
        "Incident notification contact list": "UAEIA-160",
        "External incident notification records": "record",
    },
    "E1-2.8.3": {
        "Cloud incident response plan": "UAEIA-161",
        "Alignment to the national incident response plan": "UAEIA-162",
        "Incident response test report": "test",
    },
    "E1-2.8.4": {
        "E-discovery and forensics personnel appointment": "approval",
        "Forensic capability metrics": "UAEIA-163",
        "E-forensic protocols": "UAEIA-164",
        "CSP forensic protocol compliance confirmations": "signed",
    },
    "E1-2.9.1": {
        "Cloud backup requirements": "UAEIA-165",
        "Backup restoration testing schedule": "UAEIA-166",
        "Cloud backup restoration test results": "test",
    },
    "E1-2.9.2": {
        "Continuity requirements in CSP contracts": "signed",
        "Continuity requirements test results": "test",
        "Business continuity and disaster recovery plans": "UAEIA-167",
        "Plan communication records": "notice",
        "Recovery objectives and responsibilities": "UAEIA-167",
    },
    "E2-2.1": {
        "AI/ML security policy": "UAEIA-168",
        "AI/ML secure development and operation procedures": "UAEIA-169",
        "AI/ML cyber security risk register": "UAEIA-170",
        "AI/ML supply chain risk assessment": "UAEIA-171",
        "AI/ML change management records": "record",
    },
    "E2-2.2": {
        "AI/ML asset inventory": "UAEIA-172",
        "AI/ML security baselines and compliance results": "UAEIA-173",
        "AI/ML patch and vulnerability management records": "record",
        "AI/ML secure development and testing records": "sample",
        "AI/ML environment network security settings": "export",
    },
    "E2-2.3": {
        "AI/ML model security requirements": "sample",
        "AI/ML model protection measures": "export",
        "Inference data safeguards": "export",
        "Model data access controls": "export",
        "AI/ML data protection settings": "export",
    },
    "E2-2.4": {
        "AI/ML application domain security analysis": "UAEIA-174",
        "AI/ML availability architecture": "UAEIA-175",
        "AI/ML continuity and recovery plans": "UAEIA-176",
        "AI/ML restoration and continuity test results": "test",
        "AI/ML security testing and validation report": "test",
    },
    "E2-2.5": {
        "AI/ML attack awareness material": "UAEIA-177",
        "AI/ML attack awareness attendance records": "record",
        "AI/ML defense strategy": "UAEIA-178",
        "Adversarial attack testing results": "test",
    },
    "E2-2.6": {
        "AI/ML security analytics framework": "UAEIA-179",
        "AI/ML detection and alert samples": "sample",
        "AI/ML incident reporting and management procedure": "UAEIA-180",
        "AI/ML incident records": "record",
        "AI/ML digital forensics framework": "UAEIA-181",
    },
    "E3-2.1.1": {
        "Approved IoT security policy": "UAEIA-182",
        "IoT security policy review record": "approval",
        "IoT governance model": "UAEIA-183",
        "IoT roles and responsibilities matrix": "UAEIA-183",
        "IoT device security requirements": "UAEIA-184",
    },
    "E3-2.1.2": {
        "IoT risk assessment": "UAEIA-185",
        "IoT risk register": "UAEIA-186",
        "IoT risk treatment plan": "UAEIA-186",
    },
    "E3-2.1.3": {
        "IoT security training plan": "UAEIA-187",
        "IoT security training content": "UAEIA-188",
        "IoT training completion records": "record",
    },
    "E3-2.1.4": {
        "IoT third-party security policy": "UAEIA-189",
        "Third-party adherence acknowledgements": "signed",
        "IoT supplier contract terms": "signed",
        "Third-party IoT access rights": "UAEIA-196",
        "Third-party IoT access review results": "test",
    },
    "E3-2.1.5": {
        "IoT compliance policy and program": "UAEIA-190",
        "IoT legal and regulatory requirements register": "UAEIA-191",
        "IoT compliance assessment results": "test",
    },
    "E3-2.2.1": {
        "IoT data inventory and classification": "UAEIA-192",
        "IoT data use and rights contract terms": "signed",
        "IoT data protection and location access controls": "export",
        "CSP contract clauses for IoT data": "signed",
        "Data collection justifications and retention limits": "sample",
    },
    "E3-2.2.2": {
        "IoT encryption policy and procedures": "UAEIA-193",
        "IoT encryption settings": "export",
        "Key hierarchy certificate chain": "export",
        "Root key issuing records": "record",
    },
    "E3-2.2.3": {
        "Session management settings": "export",
        "Session token strength test result": "test",
        "IoT communication protocol specification": "UAEIA-194",
        "Encrypted channel verification results": "test",
        "Approved encryption techniques list": "UAEIA-195",
    },
    "E3-2.3.1": {
        "IoT access rights listing": "UAEIA-196",
        "IoT authentication and MFA settings": "export",
        "IoT credential storage and hard-coding checks": "test",
        "IoT access review results": "test",
        "IoT password rules configuration": "export",
    },
    "E3-2.3.2": {
        "IoT location access control list": "UAEIA-197",
        "Physical access control photographs and settings": "export",
        "Physical access monitoring records": "log",
    },
    "E3-2.4.1": {
        "IoT incident response procedure": "UAEIA-198",
        "IoT incident records": "record",
        "Post-incident analysis report": "record",
        "Incident evidence collection records": "record",
        "Threat intelligence resourcing and outputs": "sample",
    },
    "E3-2.5.1": {
        "IoT backup schedule and settings": "UAEIA-199",
        "IoT backup job logs": "log",
        "IoT backup restoration test results": "test",
    },
    "E3-2.5.2": {
        "IoT continuity plan": "UAEIA-200",
        "IoT response and recovery procedures": "UAEIA-200",
        "IoT continuity test results": "test",
    },
    "E3-2.6.1": {
        "IoT asset inventory": "UAEIA-201",
        "IoT device handling procedure": "UAEIA-202",
        "IoT device maintenance records": "record",
        "IoT device disposal records": "record",
    },
    "E3-2.6.2": {
        "IoT component authentication and encryption settings": "export",
        "IoT application security architecture": "UAEIA-203",
        "Trusted service layer access control rules": "export",
        "Dedicated IoT gateway placement and settings": "export",
    },
    "E3-2.6.3": {
        "IoT device installation and setup baseline": "UAEIA-204",
        "Remote management settings": "export",
        "IoT device management strategy": "UAEIA-205",
        "IoT patch and update records": "record",
        "End-of-life device compensating measures": "UAEIA-206",
    },
    "E3-2.7.1": {
        "IoT network architecture diagram": "UAEIA-207",
        "Segmentation and traffic restriction rules": "export",
        "Secure ports and protocols settings": "export",
        "Unused and default service scan results": "test",
        "Consumer IoT device cryptography documentation": "sample",
    },
    "E3-2.8.1": {
        "IoT event recording settings": "export",
        "Authentication and access event log extracts": "log",
        "Data and operation event log extracts": "log",
        "Update failure and physical access event logs": "log",
        "Log storage, protection and analysis records": "export",
    },
    "F1-2.1": {
        "National encryption conformance review": "test",
        "Approved cryptographic algorithms and key lengths": "UAEIA-208",
    },
    "F1-2.2": {
        "Encryption risk assessment": "UAEIA-209",
        "Encryption risk remediation tracker": "UAEIA-210",
    },
    "F1-2.3": {
        "Encryption legal and regulatory requirements map": "UAEIA-211",
    },
    "F1-2.4": {
        "Encryption requirements by classification level": "UAEIA-212",
    },
    "F1-3.1": {
        "Data at rest encryption coverage register": "UAEIA-213",
        "Encryption exceptions register": "UAEIA-214",
        "Encryption software patch status report": "export",
    },
    "F1-3.2": {
        "Laptop and desktop encryption spot checks": "test",
    },
    "F1-3.3": {
        "Lost and stolen mobile device records": "record",
    },
    "F1-3.4": {
        "Unencrypted portable media block test": "test",
    },
    "F1-3.5": {
        "Database encryption inventory": "UAEIA-213",
    },
    "F1-3.6": {
        "System secrets protection register": "UAEIA-215",
        "Clear-text credential scan results": "test",
    },
    "F1-4.1": {
        "Approved secure transport protocols": "UAEIA-208",
    },
    "F1-4.2": {
        "Mail transport encryption settings": "export",
        "Email encryption rule settings": "export",
    },
    "F1-4.3": {
        "Network path encryption review": "test",
    },
    "F1-5.1": {
        "Cryptographic key inventory": "UAEIA-216",
        "Key custodian appointments": "approval",
    },
    "F1-5.2": {
        "Key generation settings": "export",
        "Key generation ceremony record": "record",
    },
    "F1-5.3": {
        "Key distribution and receipt records": "record",
        "Key transport protection settings": "export",
    },
    "F1-5.4": {
        "Key store access review results": "test",
    },
    "F1-5.5": {
        "Key backup and escrow arrangements": "UAEIA-217",
    },
    "F1-5.6": {
        "Key destruction records": "record",
    },
    "F1-5.7": {
        "Key archive register": "UAEIA-216",
    },
    "F1-6.1": {
        "Long-term data exposure assessment": "UAEIA-218",
        "Cryptographic agility assessment": "UAEIA-218",
    },
    "F2-2.1": {
        "Remote work security policy": "UAEIA-219",
        "Remote work security procedures": "UAEIA-220",
        "National remote work conformance review": "test",
    },
    "F2-2.2": {
        "Remote work risk assessment": "UAEIA-221",
        "Remote work risk monitoring report": "record",
    },
    "F2-2.3": {
        "Remote worker awareness material": "UAEIA-222",
        "Remote worker baseline completion report": "record",
    },
    "F2-3.1": {
        "Zero Trust remote access model": "UAEIA-223",
        "Remote device posture check settings": "export",
        "Remote access session logs": "log",
    },
    "F2-3.2": {
        "Remote access entitlement list": "export",
        "Remote multi-factor enforcement test": "test",
    },
    "F2-3.3": {
        "Remote worker onboarding checklists": "sample",
        "Remote worker offboarding checklists": "sample",
    },
    "F2-4.1": {
        "Off-network device compliance report": "export",
    },
    "F2-4.2": {
        "Mobile device compliance rule settings": "export",
        "Approved mobile application list": "UAEIA-224",
    },
    "F2-4.3": {
        "Signed BYOD agreements": "signed",
        "Third-party device access restrictions": "export",
    },
    "F2-5.1": {
        "Remote work data location rules": "UAEIA-225",
        "Remote access country restriction settings": "export",
        "Remote work abroad approvals": "approval",
    },
    "F2-5.2": {
        "Approved remote data transfer methods": "UAEIA-225",
        "Remote upload restriction settings": "export",
    },
    "F2-5.3": {
        "Remote work obligations register": "UAEIA-226",
    },
    "F3-2.1": {
        "National third-party security conformance review": "test",
    },
    "F3-2.2": {
        "Third-party risk awareness material": "UAEIA-227",
        "Supplier-facing staff training completion report": "record",
    },
    "F3-3.1": {
        "Supplier criticality criteria": "UAEIA-228",
        "Supplier register completeness check": "test",
    },
    "F3-3.2": {
        "Supplier classification worksheets": "sample",
    },
    "F3-3.3": {
        "Supply chain dependency map": "UAEIA-229",
        "Third-party risk register": "UAEIA-230",
    },
    "F3-3.4": {
        "Supplier risk status report": "record",
    },
    "F3-4.1": {
        "Supplier selection scoring sheet": "UAEIA-231",
    },
    "F3-4.2": {
        "Supplier response verification records": "record",
    },
    "F3-5.1": {
        "Tender security requirement extracts": "sample",
    },
    "F3-5.2": {
        "Vendor product security documentation": "sample",
    },
    "F3-5.3": {
        "Delivery acceptance check records": "test",
    },
    "F3-5.4": {
        "Supplier maintenance and support terms": "signed",
        "Supplier maintenance session records": "record",
    },
    "F3-5.5": {
        "End-of-support register": "UAEIA-232",
        "Retired hardware data erasure records": "record",
    },
    "F3-5.6": {
        "Software component inventory": "UAEIA-233",
        "Build and release pipeline controls": "export",
    },
    "F3-6.1": {
        "Minimum supplier security requirements": "UAEIA-234",
    },
    "F3-6.2": {
        "Supplier contract clause coverage review": "test",
    },
    "F3-6.3": {
        "Supplier legal compliance statements": "signed",
    },
    "F3-7.1": {
        "Supplier performance review minutes": "minutes",
        "Supplier non-compliance tracker": "UAEIA-235",
    },
    "F3-7.2": {
        "Supplier activity record tamper protection settings": "export",
    },
    "F3-7.3": {
        "Enhanced controls for high-risk suppliers": "UAEIA-236",
        "High-risk supplier assurance schedule": "UAEIA-237",
    },
    "F3-8.1": {
        "Supplier incident notification requirements": "signed",
        "Supplier incident contact list": "UAEIA-238",
        "Supplier incident response playbook": "UAEIA-239",
    },
    "F3-8.2": {
        "Alternate supplier register": "UAEIA-240",
        "Supplier exit and substitution plans": "UAEIA-241",
    },
    "F3-8.3": {
        "Critical supplier failure impact analysis": "UAEIA-242",
        "Supplier continuity assurance records": "sample",
    },
    "F3-8.4": {
        "Supplier collaboration requirements": "sample",
        "Joint exercise report": "test",
    },
    "F4-2.1": {
        "Data exchange security policy": "UAEIA-243",
        "Data exchange roles and owners": "UAEIA-244",
        "National data exchange conformance review": "test",
    },
    "F4-2.2": {
        "Data exchange risk assessment": "UAEIA-245",
        "Data exchange risk treatment tracker": "UAEIA-246",
    },
    "F4-2.3": {
        "Data exchange obligations register": "UAEIA-247",
    },
    "F4-2.4": {
        "Data exchange handling rules by classification": "UAEIA-248",
        "Exchange integrity protection settings": "export",
    },
    "F4-2.5": {
        "Personal data exchange register": "UAEIA-249",
        "Data minimization check results": "test",
    },
    "F4-3.1": {
        "Data exchange authentication settings": "export",
        "Partner and service account register": "UAEIA-250",
    },
    "F4-3.2": {
        "Data exchange access approval records": "approval",
        "Data exchange access review results": "test",
    },
    "F4-3.3": {
        "Data exchange user activity logs": "log",
    },
    "F4-4.1": {
        "Data exchange channel encryption register": "UAEIA-251",
        "Partner connection encryption test results": "test",
    },
    "F4-5.1": {
        "Data exchange network redundancy diagram": "UAEIA-252",
        "Network failover test results": "test",
    },
    "F4-5.2": {
        "Firewall rule review results": "test",
    },
    "F4-5.3": {
        "VPN connection register": "UAEIA-253",
    },
    "F4-5.4": {
        "DMZ architecture diagram": "UAEIA-252",
        "DMZ stored data check": "test",
    },
    "F4-5.5": {
        "Exchange endpoint certificate inventory": "UAEIA-254",
    },
    "F4-5.6": {
        "Intrusion prevention sensor settings": "export",
        "Intrusion alert handling records": "sample",
    },
    "F4-5.7": {
        "Data loss prevention rule settings": "export",
        "Data loss prevention alert records": "sample",
    },
    "F4-6.1": {
        "Data exchange system inventory": "UAEIA-255",
        "Completed hardening checklists": "sample",
    },
    "F4-6.2": {
        "Data exchange configuration drift report": "export",
    },
    "F4-6.3": {
        "Data exchange penetration test report": "test",
    },
    "F4-7.1": {
        "Data exchange event recording coverage matrix": "UAEIA-256",
        "Event forwarding and retention settings": "export",
    },
    "F4-7.2": {
        "Data exchange anomaly detection rules": "export",
        "Inappropriate use case records": "record",
    },
}
