"""UAE Information Assurance Standard v2.1, Annex E rows: the evidence recommendations.

The annex names no evidence, so the rows' evidence_requirements are an authored layer (seed_data/uae_ia_annex_e_evidence.json, keyed
by the row ids E1-2.1.1 ... E3-2.8.1) that grc/tools/build_uae_ia_annex_e_rows.py merges into the PDF-derived staging rows
(seed_data/uae_ia_annex_e_rows.json). These tests hold the layer to what makes it trustworthy, without the PDF: 3-5 well-formed
items per row, every one of the 172 obligations covered by at least one item (`covers` is review traceability and is not shipped),
nothing repeated across rows or with the library's own layer (so the merge into it stays clean), no vendor names or other
frameworks' ids, a type the seeder infers from real words, the staging rows exactly the layer merged in, and the real seeder
turning each entry into one ControlEvidenceRequirement row. On in-memory SQLite.
"""
import itertools
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

SEED = Path(__file__).resolve().parents[1] / "grc" / "seed_data"
FRAMEWORKS = SEED / "frameworks"
ROWS = SEED / "uae_ia_annex_e_rows.json"
LAYER = SEED / "uae_ia_annex_e_evidence.json"
MAIN_LAYER = SEED / "uae_ia_evidence.json"
CORE = FRAMEWORKS / "uae_ia.json"

ENTRY_KEYS = {"name", "description", "filetype", "collection_frequency"}      # what the seeder reads from a dict entry
LAYER_KEYS = ENTRY_KEYS | {"covers"}
FREQUENCIES = {"annually", "on-change", "continuous"}      # the seeder's default, plus the two the layer sets
STOP = {"the", "a", "an", "of", "and", "or", "for", "to", "in", "on", "with", "by", "that", "is", "are", "as", "at", "be",
        "from", "its", "their", "each", "all"}

# Wording the UI and the licences rule out: a model or vendor name, SCF text or ids, other frameworks' names and ids.
FORBIDDEN = [r"\bgpt", r"openai", r"anthropic", r"claude", r"gemini", r"copilot",
             r"microsoft", r"azure", r"\baws\b", r"amazon", r"google", r"oracle", r"\bsap\b", r"cisco", r"fortinet", r"palo alto",
             r"splunk", r"crowdstrike", r"okta", r"vmware", r"red hat", r"symantec", r"mcafee", r"sophos", r"servicenow",
             r"jira", r"sharepoint", r"windows", r"linux", r"active directory",
             r"\bscf\b", r"secure controls framework", r"\b[A-Z]{2,5}-\d{1,2}(\.\d+)?\b", r"\b[EMT]\d(-|\.)\d",
             r"\biso\b", r"27001", r"27002", r"\bnist\b", r"\bpci\b", r"soc ?2", r"hipaa", r"gdpr", r"cobit", r"adhics", r"pisf",
             r"\bnca\b", r"\bsama\b", r"\bcis\b", r"hitrust", r"swift", r"isrv3", r"\buae ia\b"]
BRITISH = [r"organis", r"authoris", r"minimis", r"analyse", r"centre", r"defence", r"programme", r"labelling", r"behaviour",
           r"categoris", r"prioritis", r"recognis", r"standardis", r"utilis", r"colour", r"licence"]
# The loader types an item by substring (first match: policy, procedure, log, screenshot, configuration, report, contract,
# attestation, certificate, training, else document): "technology" and "methodology" contain "log", "design" and "assign" contain
# "sign", "processing" is a process. A type other than document has to come from one of these real words.
WORD_FORMS = {
    "policy": r"\bpolic(y|ies)\b",
    "procedure": r"\b(procedures?|process(es)?|sops?)\b",
    "log": r"\blog(s|ging|ged)?\b|audit trail|\blog-(on|off)\b",
    "screenshot": r"\bscreenshots?\b|\bscreen captures?\b",
    "configuration": r"\bconfig\w*|\bsettings\b",
    "report": r"\b(reports?|reporting|reported|assessments?|reviews?|reviewed)\b",
    "contract": r"\b(contracts?|contractual|agreements?|slas?)\b",
    "attestation": r"\b(attest\w*|signed|signature|sign-off|acknowledg\w*)\b",
    "certificate": r"\bcertificat\w+",
    "training": r"\b(training|awareness)\b",
}
ALLOWED_TYPES = {"policy", "procedure", "log", "screenshot", "configuration", "report", "contract", "attestation", "certificate",
                 "training", "document"}


@pytest.fixture(scope="module")
def rows():
    return json.loads(ROWS.read_text(encoding="utf-8"))["controls"]


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


def test_the_layer_lists_exactly_the_rows_in_order(rows, layer):
    assert list(layer) == [r["control_id"] for r in rows] and len(layer) == 50


def test_every_row_has_three_to_five_well_formed_items(rows, layer):
    for r in rows:
        cid = r["control_id"]
        items = layer[cid]
        assert 3 <= len(items) <= 5, (cid, len(items))
        names = [i["name"].lower() for i in items]
        assert len(set(names)) == len(names), cid
        for i in items:
            assert set(i) <= LAYER_KEYS and {"name", "description", "filetype", "covers"} <= set(i), (cid, sorted(i))
            assert 10 <= len(i["name"]) <= 80 and i["name"][0].isupper() and not i["name"].endswith("."), (cid, i["name"])
            sentences = re.split(r"(?<=[.!?])\s+", i["description"].strip())
            assert 40 <= len(i["description"]) <= 350 and i["description"].endswith(".") and len(sentences) <= 2, (cid, i["name"])
            assert i.get("collection_frequency", "on-change") in ("on-change", "continuous"), (cid, i["name"])
    assert sum(len(v) for v in layer.values()) == 204 == 100 + 29 + 75                     # E1, E2, E3: 3-5 items each, median 4


def test_every_obligation_is_covered_by_at_least_one_item(rows, layer):
    covered_total = 0
    for r in rows:
        cid, n = r["control_id"], len(r["obligations"])
        for i in layer[cid]:
            assert i["covers"] == sorted(set(i["covers"])) and i["covers"], (cid, i["name"])
            assert all(isinstance(k, int) and 1 <= k <= n for k in i["covers"]), (cid, i["name"], i["covers"], n)
        covered = {k for i in layer[cid] for k in i["covers"]}
        assert covered == set(range(1, n + 1)), (cid, sorted(set(range(1, n + 1)) - covered))
        covered_total += len(covered)
    assert covered_total == 172 == 64 + 24 + 84 == sum(len(r["obligations"]) for r in rows)       # the parse's own total


def test_filetypes_use_the_vocabulary_of_the_other_catalogs(layer):
    vocabulary = set()
    for p in FRAMEWORKS.glob("*.json"):
        if p.name != CORE.name:
            for c in json.loads(p.read_text(encoding="utf-8")).get("controls", []):
                vocabulary |= {e["filetype"] for e in c.get("evidence_requirements") or [] if isinstance(e, dict) and e.get("filetype")}
    assert {"PDF", "XLSX", "DOCX", "PNG", "JSON", "LOG", "CSV", "EML"} <= vocabulary       # the other catalogs were read
    assert {i["filetype"] for items in layer.values() for i in items} <= vocabulary


def test_wording_has_no_vendor_names_other_frameworks_ids_or_stray_ai(rows, layer):
    for r in rows:
        for i in layer[r["control_id"]]:
            text = f"{i['name']} {i['description']}"
            for pattern in FORBIDDEN:
                flags = 0 if pattern in (r"\b[A-Z]{2,5}-\d{1,2}(\.\d+)?\b", r"\b[EMT]\d(-|\.)\d") else re.I      # these two are case-sensitive
                assert not re.search(pattern, text, flags), (r["control_id"], i["name"], pattern)
            for pattern in BRITISH:
                assert not re.search(pattern, text, re.I), (r["control_id"], i["name"], pattern)
            assert not re.search(r"artificial intelligence|\bcontractors?\b", text, re.I), (r["control_id"], i["name"])
            # the UI says "AI/ML" only where the AI policy's own subject matter needs it, and never a model or vendor name
            assert not re.search(r"\bAI\b" if r["annex"] != "E2" else r"\bAI\b(?!/ML)", text), (r["control_id"], i["name"])


def test_no_scf_wording_in_the_layer(layer):
    """The layer is written from the annex (a licence rule: no SCF text anywhere); the SCF fingerprint finds none."""
    from grc.services import licence_guard as guard

    refused = [(cid, i["name"]) for cid, items in layer.items() for i in items
               if guard.find_restricted(f"- {i['name']}: {i['description']}")]
    assert not refused, refused[:5]


def test_nothing_is_repeated_across_rows_or_with_the_librarys_own_layer(layer):
    """So the merge into uae_ia_evidence.json keeps its own 'nothing repeated' test green."""
    main = json.loads(MAIN_LAYER.read_text(encoding="utf-8"))["controls"]
    mine = [(cid, i) for cid, items in layer.items() for i in items]
    theirs = [(cid, i) for cid, items in main.items() if cid not in layer for i in items]
    everything = mine + theirs
    assert len({i["name"].lower() for _, i in everything}) == len(everything)          # no two items share a name, in any control
    assert len({i["description"].lower() for _, i in everything}) == len(everything)
    words = [{w for w in re.sub(r"[^a-z0-9 ]+", " ", i["description"].lower()).split() if w not in STOP} for _, i in everything]
    closest = max((len(words[a] & words[b]) / len(words[a] | words[b]), a, b)
                  for a, b in itertools.product(range(len(mine)), range(len(everything)))
                  if a < b and everything[a][0] != everything[b][0])
    assert closest[0] < 0.7, (closest[0], everything[closest[1]][1]["name"], everything[closest[2]][1]["name"])


def test_the_type_the_seeder_infers_comes_from_a_real_word(rows, layer):
    from grc.seed_frameworks import _infer_evidence_type

    types = {}
    for r in rows:
        for i in layer[r["control_id"]]:
            text = f"{i['name']} {i['description']}"
            t = types[(r["control_id"], i["name"])] = _infer_evidence_type(text)
            assert t in ALLOWED_TYPES, (r["control_id"], i["name"], t)
            assert t == "document" or re.search(WORD_FORMS[t], text, re.I), (r["control_id"], i["name"], t)
            if t == "log":                                       # the main library's rule: a log is a log, not "technology"
                assert re.search(r"\blog(s|ging|ged)?\b|audit trail|\blog-(on|off)\b", text, re.I)
    assert {"policy", "procedure", "log", "screenshot", "configuration", "report", "contract", "attestation", "certificate",
            "training", "document"} == set(types.values())
    # the types people filter by come out sensibly
    assert types["E1-2.1.1", "Approved cloud security policy"] == "policy"
    assert types["E1-2.2.2", "Executed CSP contract"] == "contract"
    assert types["E1-2.3.2", "Encryption configuration evidence"] == "screenshot"
    assert types["E1-2.1.5", "CSP security certifications"] == "certificate"
    assert types["E1-2.3.2", "Cloud encryption key management procedure"] == "procedure"
    assert types["E2-2.5", "AI/ML attack awareness attendance records"] == "training"
    assert types["E3-2.1.4", "Third-party adherence acknowledgements"] == "attestation"
    assert types["E3-2.3.1", "IoT access review results"] == "report"
    assert types["E3-2.8.1", "Authentication and access event log extracts"] == "log"
    assert types["E3-2.2.2", "Key hierarchy certificate chain"] == "certificate"


def test_the_staging_rows_are_the_layer_merged_in(rows, layer):
    """What build_uae_ia_annex_e_rows.py writes: {name, description, filetype} like ADHICS and PISF, plus collection_frequency
    where the layer sets one; `covers` stays in the layer."""
    for r in rows:
        want = [{k: i[k] for k in ("name", "description", "filetype", "collection_frequency") if k in i} for i in layer[r["control_id"]]]
        assert r["evidence_requirements"] == want, r["control_id"]
        assert all(set(e) <= ENTRY_KEYS and "covers" not in e for e in r["evidence_requirements"])
    assert sum(len(r["evidence_requirements"]) for r in rows) == sum(len(v) for v in layer.values())


def test_the_seeder_creates_one_requirement_per_entry_with_a_type_and_a_frequency(rows, db):
    from grc.seed_frameworks import _infer_evidence_type, seed_framework_from_json

    data = {"metadata": {"name": "UAE IA Annex E rows (test)", "version": "2.1", "classification": "regulatory",
                         "framework_type": "regulatory"}, "controls": rows}
    fw = seed_framework_from_json(db, data, tenant_id=1)
    db.commit()
    controls = {c.id: c for c in db.query(m.ParsedFrameworkControl).filter_by(uploaded_framework_id=fw.id)}
    got = db.query(m.ControlEvidenceRequirement).filter_by(framework_id=fw.id).order_by(
        m.ControlEvidenceRequirement.parsed_control_id, m.ControlEvidenceRequirement.display_order).all()
    assert len(got) == sum(len(r["evidence_requirements"]) for r in rows) == 204
    by_control = {}
    for q in got:
        by_control.setdefault(controls[q.parsed_control_id].control_id, []).append(q)
    for r in rows:
        mine = by_control[r["control_id"]]
        assert len(mine) == len(r["evidence_requirements"]), r["control_id"]
        for idx, (q, e) in enumerate(zip(mine, r["evidence_requirements"]), start=1):
            assert (q.evidence_title, q.evidence_description, q.evidence_format) == (e["name"], e["description"], e["filetype"])
            assert q.display_order == idx and q.is_mandatory is True and q.is_active is True and q.status == "draft"
            assert q.evidence_type == _infer_evidence_type(f"{e['name']} {e['description']}") and q.evidence_type in ALLOWED_TYPES
            assert q.priority == r["priority"]
            assert q.collection_frequency == e.get("collection_frequency", "annually")      # a dict entry is not inferred from its text
    assert {q.collection_frequency for q in got} == FREQUENCIES
    row = {(controls[q.parsed_control_id].control_id, q.evidence_title): q for q in got}
    assert row["E1-2.8.1", "Cloud incident records"].collection_frequency == "on-change"
    assert row["E3-2.8.1", "Authentication and access event log extracts"].collection_frequency == "continuous"
    assert row["E1-2.1.1", "Approved cloud security policy"].collection_frequency == "annually"
    assert row["E1-2.2.2", "Executed CSP contract"].evidence_type == "contract"


def test_the_builder_stops_on_an_uncovered_obligation_and_ships_no_covers():
    from grc.tools import build_uae_ia_annex_e_rows as b

    control = {"id": "E9-9.9", "obligations": [("a", False), ("b", False)]}
    item = {"name": "Register", "description": "A register.", "filetype": "XLSX", "covers": [1]}
    with pytest.raises(SystemExit):                                     # obligation 2 has no item
        b.check_layer({"controls": {"E9-9.9": [item] * 3}}, [control])
    with pytest.raises(SystemExit):                                     # an obligation the row does not have
        b.check_layer({"controls": {"E9-9.9": [{**item, "covers": [1, 2, 3]}] * 3}}, [control])
    with pytest.raises(SystemExit):                                     # a row the layer does not know
        b.check_layer({"controls": {}}, [control])
    with pytest.raises(SystemExit):                                     # a row the annex does not have
        b.check_layer({"controls": {"E9-9.9": [{**item, "covers": [1, 2]}] * 3, "E9-9.8": [item] * 3}}, [control])
    with pytest.raises(SystemExit):                                     # too few items
        b.check_layer({"controls": {"E9-9.9": [{**item, "covers": [1, 2]}] * 2}}, [control])
    with pytest.raises(SystemExit):                                     # an item with a key the seeder does not read
        b.check_layer({"controls": {"E9-9.9": [{**item, "covers": [1, 2], "note": "x"}] * 3}}, [control])
    layer = {"controls": {"E9-9.9": [item, {**item, "name": "Log", "covers": [2], "collection_frequency": "continuous"},
                                     {**item, "name": "Other", "covers": [1, 2]}]}}
    b.check_layer(layer, [control])
    assert b.evidence_items(layer["controls"]["E9-9.9"]) == [
        {"name": "Register", "description": "A register.", "filetype": "XLSX"},
        {"name": "Log", "description": "A register.", "filetype": "XLSX", "collection_frequency": "continuous"},
        {"name": "Other", "description": "A register.", "filetype": "XLSX"}]
