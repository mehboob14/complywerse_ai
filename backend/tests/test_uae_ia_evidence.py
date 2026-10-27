"""UAE Information Assurance Standard v2.1: the evidence recommendations.

The standard names no evidence, so the catalog's evidence_requirements are an authored layer
(seed_data/uae_ia_evidence.json) that grc/tools/build_uae_ia_catalog.py merges into the PDF-derived catalog
(seed_data/frameworks/uae_ia.json). These tests hold the layer to what makes it trustworthy, without the PDF:
3-6 well-formed items per control (2-6 where it has at most two sub-controls), every one of the 449 sub-controls
covered by at least one item (`covers` is review traceability and is not shipped; an empty `covers` marks evidence of the
statement itself), nothing repeated across controls, no vendor names or other frameworks' ids, the committed catalog is
exactly the layer merged in, and the real seeder turns each entry into one ControlEvidenceRequirement row with its own or an
inferred type, a collection frequency and the layer's flags (required or not, no retention period or confidence claimed,
who wrote it). On in-memory SQLite.
"""
import itertools
import json
import math
import os
import re
import shutil
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

import grc.models as m  # noqa: E402

SEED = Path(__file__).resolve().parents[1] / "grc" / "seed_data"
FRAMEWORKS = SEED / "frameworks"
CATALOG = FRAMEWORKS / "uae_ia.json"
LAYER = SEED / "uae_ia_evidence.json"
NAME = "UAE Information Assurance Standard"

ENTRY_KEYS = {"name", "description", "filetype", "collection_frequency", "is_mandatory", "retention_period", "ai_confidence",
              "ai_reasoning", "type"}      # what the seeder reads from a dict entry
LAYER_KEYS = ENTRY_KEYS | {"covers"}
FREQUENCIES = {"annually", "on-change", "continuous"}      # the seeder's default, plus the two the layer sets
STOP = {"the", "a", "an", "of", "and", "or", "for", "to", "in", "on", "with", "by", "that", "is", "are", "as", "at", "be",
        "from", "its", "their", "each", "all"}

# Wording the UI and the licences rule out: a model or vendor name, "AI", SCF text or ids, other frameworks' names and ids.
FORBIDDEN = [r"\bAI\b", r"artificial intelligence", r"\bgpt", r"openai", r"anthropic", r"claude", r"gemini", r"copilot",
             r"microsoft", r"azure", r"\baws\b", r"amazon", r"google", r"oracle", r"\bsap\b", r"cisco", r"fortinet", r"palo alto",
             r"splunk", r"crowdstrike", r"okta", r"vmware", r"red hat", r"symantec", r"mcafee", r"sophos", r"servicenow",
             r"jira", r"sharepoint", r"windows", r"linux", r"active directory",
             r"\bscf\b", r"secure controls framework", r"\b[A-Z]{2,5}-\d{1,2}(\.\d+)?\b",
             r"\biso\b", r"27001", r"27002", r"\bnist\b", r"\bpci\b", r"soc ?2", r"hipaa", r"gdpr", r"cobit", r"adhics", r"pisf",
             r"\bnca\b", r"\bsama\b", r"\bcis\b", r"hitrust", r"swift", r"isrv3"]


@pytest.fixture(scope="module")
def catalog():
    return json.loads(CATALOG.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def layer():
    return json.loads(LAYER.read_text(encoding="utf-8"))["controls"]


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    session = Session(engine)
    yield session
    session.close()


def test_the_layer_lists_exactly_the_catalogs_controls(catalog, layer):
    assert list(layer) == [x["control_id"] for x in catalog["controls"]]       # 134 controls, in the standard's order


def test_every_control_has_three_to_six_well_formed_items(catalog, layer):
    for x in catalog["controls"]:
        cid, n = x["control_id"], x["sub_control_count"]
        items = layer[cid]
        assert max(2 if n <= 2 else 3, min(6, math.ceil(n / 2))) <= len(items) <= 6, (cid, len(items), n)       # grows with the sub-controls
        names = [i["name"].lower() for i in items]
        assert len(set(names)) == len(names), cid
        for i in items:
            assert set(i) <= LAYER_KEYS and {"name", "description", "filetype", "covers"} <= set(i), (cid, sorted(i))
            assert 10 <= len(i["name"]) <= 80 and i["name"][0].isupper() and not i["name"].endswith("."), (cid, i["name"])
            sentences = re.split(r"(?<=[.!?])\s+", i["description"].strip())
            assert 40 <= len(i["description"]) <= 350 and i["description"].endswith(".") and len(sentences) <= 2, (cid, i["name"])
            assert i.get("collection_frequency", "on-change") in ("on-change", "continuous"), (cid, i["name"])


def test_every_sub_control_is_covered_by_at_least_one_item(catalog, layer):
    covered_total = 0
    for x in catalog["controls"]:
        cid, n = x["control_id"], x["sub_control_count"]
        for i in layer[cid]:
            assert i["covers"] == sorted(set(i["covers"])), (cid, i["name"])       # [] is valid: evidence of the statement itself
            assert all(isinstance(k, int) and 1 <= k <= n for k in i["covers"]), (cid, i["name"], i["covers"], n)
        covered = {k for i in layer[cid] for k in i["covers"]}
        assert covered == set(range(1, n + 1)), (cid, sorted(set(range(1, n + 1)) - covered))
        covered_total += len(covered)
    assert covered_total == 449 == sum(x["sub_control_count"] for x in catalog["controls"])       # the standard's own total


def test_filetypes_use_the_vocabulary_of_the_other_catalogs(layer):
    vocabulary = set()
    for p in FRAMEWORKS.glob("*.json"):
        if p.name != CATALOG.name:
            for c in json.loads(p.read_text(encoding="utf-8")).get("controls", []):
                vocabulary |= {e["filetype"] for e in c.get("evidence_requirements") or [] if isinstance(e, dict) and e.get("filetype")}
    assert {"PDF", "XLSX", "DOCX", "PNG", "JSON", "LOG", "CSV", "EML"} <= vocabulary       # the other catalogs were read
    assert {i["filetype"] for items in layer.values() for i in items} <= vocabulary


def test_wording_has_no_vendor_names_ai_or_other_frameworks_ids(layer):
    for cid, items in layer.items():
        for i in items:
            text = f"{i['name']} {i['description']}"
            for pattern in FORBIDDEN:
                flags = 0 if pattern in (r"\bAI\b", r"\b[A-Z]{2,5}-\d{1,2}(\.\d+)?\b") else re.I      # these two are case-sensitive
                assert not re.search(pattern, text, flags), (cid, i["name"], pattern)


def test_no_scf_wording_in_the_layer(layer):
    """The layer is written from the standard (a licence rule: no SCF text anywhere); the SCF fingerprint finds none."""
    from grc.services import licence_guard as guard

    refused = [(cid, i["name"]) for cid, items in layer.items() for i in items
               if guard.find_restricted(f"- {i['name']}: {i['description']}")]
    assert not refused, refused[:5]


def test_nothing_is_repeated_across_controls(layer):
    flat = [(cid, i) for cid, items in layer.items() for i in items]
    assert len({i["name"].lower() for _, i in flat}) == len(flat)       # no two items share a name, in any control
    assert len({i["description"].lower() for _, i in flat}) == len(flat)
    words = [{w for w in re.sub(r"[^a-z0-9 ]+", " ", i["description"].lower()).split() if w not in STOP} for _, i in flat]
    closest = max((len(words[a] & words[b]) / len(words[a] | words[b]), a, b)
                  for a, b in itertools.combinations(range(len(words)), 2) if flat[a][0] != flat[b][0])
    assert closest[0] < 0.7, (closest[0], flat[closest[1]][1]["name"], flat[closest[2]][1]["name"])


def test_the_committed_catalog_is_the_layer_merged_in(catalog, layer):
    """What build_uae_ia_catalog.py writes: {name, description, filetype} like ADHICS and PISF, plus the other keys of ENTRY_KEYS
    where the layer sets them (a null included); `covers` stays in the layer."""
    for x in catalog["controls"]:
        want = [{k: i[k] for k in ENTRY_KEYS if k in i} for i in layer[x["control_id"]]]
        assert x["evidence_requirements"] == want, x["control_id"]
        assert all(set(e) <= ENTRY_KEYS and "covers" not in e for e in x["evidence_requirements"])
    assert "uae_ia_evidence.json" in catalog["metadata"]["source_note"]
    assert sum(len(x["evidence_requirements"]) for x in catalog["controls"]) == sum(len(v) for v in layer.values())


def test_the_seeder_creates_one_requirement_per_entry_with_a_type_and_a_frequency(catalog, db):
    from grc.seed_frameworks import _infer_evidence_type, seed_framework_from_json

    fw = seed_framework_from_json(db, catalog, tenant_id=1)
    db.commit()
    controls = {c.id: c for c in db.query(m.ParsedFrameworkControl).filter_by(uploaded_framework_id=fw.id)}
    rows = db.query(m.ControlEvidenceRequirement).filter_by(framework_id=fw.id).order_by(
        m.ControlEvidenceRequirement.parsed_control_id, m.ControlEvidenceRequirement.display_order).all()
    assert len(rows) == sum(len(x["evidence_requirements"]) for x in catalog["controls"])
    by_control = {}
    for r in rows:
        by_control.setdefault(controls[r.parsed_control_id].control_id, []).append(r)
    allowed_types = {"policy", "procedure", "log", "screenshot", "configuration", "report", "contract", "attestation",
                     "certificate", "training", "document"}
    for x in catalog["controls"]:
        got = by_control[x["control_id"]]
        assert len(got) == len(x["evidence_requirements"]), x["control_id"]
        for idx, (r, e) in enumerate(zip(got, x["evidence_requirements"]), start=1):
            assert (r.evidence_title, r.evidence_description, r.evidence_format) == (e["name"], e["description"], e["filetype"])
            assert r.display_order == idx and r.is_mandatory == e.get("is_mandatory", True) and r.is_active is True and r.status == "draft"
            # nothing was generated by a model: no retention period or confidence is claimed, and the reasoning says who wrote it
            assert r.retention_period is None and r.ai_confidence is None and r.ai_reasoning == e["ai_reasoning"]
            assert r.evidence_type == (e.get("type") or _infer_evidence_type(f"{e['name']} {e['description']}")) and r.evidence_type in allowed_types
            assert r.priority == x["priority"]
            assert r.collection_frequency == e.get("collection_frequency", "annually")      # a dict entry is not inferred from its text
    assert {r.collection_frequency for r in rows} == FREQUENCIES
    # the loader's keyword match is a substring match ("technology" and "methodology" contain "log"): none is typed log by accident
    # (an entry with an explicit type is typed by the layer, not by the match)
    explicit = {(x["control_id"], e["name"]) for x in catalog["controls"] for e in x["evidence_requirements"] if e.get("type")}
    assert all(re.search(r"\blog(s|ging|ged)?\b|audit trail|\blog-(on|off)\b", f"{r.evidence_title} {r.evidence_description}", re.I)
               for r in rows if r.evidence_type == "log" and (controls[r.parsed_control_id].control_id, r.evidence_title) not in explicit)
    # the types people filter by come out sensibly, and event-driven or continuous items carry their own frequency
    row = {(controls[r.parsed_control_id].control_id, r.evidence_title): r for r in rows}
    assert row["M1.3.3", "Document control procedure"].evidence_type == "procedure"
    assert row["M1.2.1", "Approved information security policy"].evidence_type == "policy"
    assert row["T1.4.2", "Media disposal log"].evidence_type == "log"
    assert row["T3.1.6", "Malware scanning configuration"].evidence_type == "configuration"
    assert row["T6.2.4", "Executed supplier contracts"].evidence_type == "contract"
    assert row["M6.2.2", "Internal audit reports"].evidence_type == "report"
    assert row["T3.1.3", "Change log"].collection_frequency == "on-change"
    assert row["T3.1.6", "Malware detection events and notifications"].collection_frequency == "continuous"
    assert row["T1.2.1", "Information asset inventory"].collection_frequency == "annually"


def test_the_startup_backfill_seeds_the_requirements_too(catalog, db, tmp_path, monkeypatch):
    from grc import startup_seed

    shutil.copy(CATALOG, tmp_path / CATALOG.name)
    monkeypatch.setattr(startup_seed, "_FRAMEWORK_SEED_DIR", tmp_path)
    startup_seed.ensure_local_framework_catalog(db)
    db.commit()
    assert db.query(m.ControlEvidenceRequirement).count() == sum(len(x["evidence_requirements"]) for x in catalog["controls"])


def test_the_builder_stops_on_an_uncovered_sub_control_and_ships_no_covers():
    from grc.tools import build_uae_ia_catalog as b

    control = {"id": "M9.9.9", "sub_controls": [{"n": 1, "text": "a", "nested": []}, {"lead": "The entity shall:"},
                                                {"n": 2, "text": "b", "nested": []}]}
    item = {"name": "Register", "description": "A register.", "filetype": "XLSX", "covers": [1]}
    with pytest.raises(SystemExit):                                     # sub-control 2 has no item
        b.check_evidence_layer({"controls": {"M9.9.9": [item]}}, [control])
    with pytest.raises(SystemExit):                                     # a sub-control the control does not have
        b.check_evidence_layer({"controls": {"M9.9.9": [{**item, "covers": [1, 2, 3]}]}}, [control])
    with pytest.raises(SystemExit):                                     # a control the layer does not know
        b.check_evidence_layer({"controls": {}}, [control])
    layer = {"controls": {"M9.9.9": [item, {**item, "name": "Log", "covers": [2], "collection_frequency": "continuous"}]}}
    b.check_evidence_layer(layer, [control])
    assert b.evidence_items(layer, control) == [{"name": "Register", "description": "A register.", "filetype": "XLSX"},
                                                {"name": "Log", "description": "A register.", "filetype": "XLSX",
                                                 "collection_frequency": "continuous"}]
    # statement-level evidence (covers=[]) is accepted, and the flags the layer sets go on in a fixed order, a null included
    layer["controls"]["M9.9.9"].append({**item, "name": "Approval", "covers": [], "ai_reasoning": "Written.", "retention_period": None,
                                        "ai_confidence": None, "type": "attestation", "is_mandatory": False})
    b.check_evidence_layer(layer, [control])
    assert list(b.evidence_items(layer, control)[2].items()) == [
        ("name", "Approval"), ("description", "A register."), ("filetype", "XLSX"), ("is_mandatory", False), ("type", "attestation"),
        ("retention_period", None), ("ai_confidence", None), ("ai_reasoning", "Written.")]
