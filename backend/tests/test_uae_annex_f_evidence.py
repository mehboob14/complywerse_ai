"""UAE Information Assurance Standard v2.1, Annex F rows: the evidence recommendations.

The annex names no evidence, so the rows' evidence_requirements are an authored layer (seed_data/uae_ia_annex_f_evidence.json, keyed
by the row ids F1-2.1 ... F4-7.2) that grc/tools/build_uae_ia_annex_f_rows.py merges into the PDF-derived staging rows
(seed_data/uae_ia_annex_f_rows.json). The annex has one Objective per row, so there is nothing to trace: the items carry no `covers`.
These tests hold the layer to what makes it trustworthy, without the PDF: 1-3 well-formed items per row, nothing repeated across
rows or with the library's own layer or the Annex E layer (so the merge into one framework stays clean), nothing that restates what
the mapped core controls already ask for, no vendor names, other frameworks' ids or clause numbers, a type the seeder infers from
real words, the staging rows exactly the layer merged in, and the real seeder turning each entry into one ControlEvidenceRequirement
row. On in-memory SQLite.
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
ROWS = SEED / "uae_ia_annex_f_rows.json"
LAYER = SEED / "uae_ia_annex_f_evidence.json"
MAIN_LAYER = SEED / "uae_ia_evidence.json"
E_LAYER = SEED / "uae_ia_annex_e_evidence.json"
CORE = FRAMEWORKS / "uae_ia.json"

ENTRY_KEYS = {"name", "description", "filetype", "collection_frequency"}      # what the seeder reads from a dict entry
FREQUENCIES = {"annually", "on-change", "continuous"}      # the seeder's default, plus the two the layer sets
STOP = {"the", "a", "an", "of", "and", "or", "for", "to", "in", "on", "with", "by", "that", "is", "are", "as", "at", "be",
        "from", "its", "their", "each", "all"}
# items per annex, and rows with 1, 2 and 3 items: 129 items on 78 rows
PER_ANNEX = {"F1": (31, {1: 12, 2: 8, 3: 1}), "F2": (25, {1: 2, 2: 7, 3: 3}), "F3": (37, {1: 12, 2: 11, 3: 1}), "F4": (36, {1: 7, 2: 13, 3: 1})}
EVENT_DRIVEN = {"on-change": {"Key generation ceremony record", "Key distribution and receipt records", "Key destruction records",
                              "Lost and stolen mobile device records", "Remote work abroad approvals",
                              "Hardware receipt inspection records", "Supplier maintenance session records",
                              "Retired hardware data erasure records"},
                "continuous": {"Remote access session logs", "Data exchange user activity logs", "Intrusion alert handling records",
                               "Data loss prevention alert records", "Data exchange configuration drift report"}}

# Wording the UI and the licences rule out: a model or vendor name, SCF text or ids, other frameworks' names and ids, this
# standard's own control ids and clause numbers.
FORBIDDEN = [r"\bgpt", r"openai", r"anthropic", r"claude", r"gemini", r"copilot",
             r"microsoft", r"azure", r"\baws\b", r"amazon", r"google", r"oracle", r"\bsap\b", r"cisco", r"fortinet", r"palo alto",
             r"splunk", r"crowdstrike", r"okta", r"vmware", r"red hat", r"symantec", r"mcafee", r"sophos", r"servicenow",
             r"jira", r"sharepoint", r"windows", r"linux", r"active directory",
             r"\bscf\b", r"secure controls framework", r"\b[A-Z]{2,5}-\d{1,2}(\.\d+)?\b", r"\b[EFMT]\d(-|\.)\d",
             r"\biso\b", r"27001", r"27002", r"\bnist\b", r"\bpci\b", r"soc ?2", r"hipaa", r"gdpr", r"cobit", r"adhics", r"pisf",
             r"\bnca\b", r"\bsama\b", r"\bcis\b", r"hitrust", r"swift", r"isrv3", r"\buae ia\b",
             r"\bclauses?\s+\d", r"\bsections?\s+\d", r"\bannex\b", r"\btable\s+\d", r"\b\d+\.\d+(\.\d+)?\b"]
CASE_SENSITIVE = (r"\b[A-Z]{2,5}-\d{1,2}(\.\d+)?\b", r"\b[EFMT]\d(-|\.)\d")
BRITISH = [r"organis", r"authoris", r"minimis", r"analyse", r"centre", r"defence", r"programme", r"labelling", r"behaviour",
           r"categoris", r"prioritis", r"recognis", r"standardis", r"utilis", r"colour", r"licence",
           r"catalogue", r"judgement", r"\bfulfil\b", r"\benrol\b", r"\bgrey\b", r"whilst", r"amongst", r"sanitis", r"customis",
           r"initialis", r"summaris", r"optimis", r"emphasis(e|ed|es|ing)\b", r"specialis", r"centralis", r"normalis", r"virtualis",
           r"digitis", r"pseudonymis", r"anonymis", r"synchronis", r"harmonis", r"favour", r"honour", r"labour", r"neighbour",
           r"offence", r"pretence", r"\bageing\b", r"\w+isation\b"]
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


@pytest.fixture(scope="module")
def others(layer):
    """Every item of the framework this layer joins, except its own, as (control id, item): the library's own layer (which holds
    the Annex E rows once they are merged into it) and, while that file is there, the Annex E layer."""
    main = json.loads(MAIN_LAYER.read_text(encoding="utf-8"))["controls"]
    e = json.loads(E_LAYER.read_text(encoding="utf-8"))["controls"] if E_LAYER.exists() else {}
    merged = {cid: items for cid, items in main.items() if cid not in layer}
    for cid, items in e.items():
        merged.setdefault(cid, items)
    return [(cid, i) for cid, items in merged.items() for i in items]


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    session = Session(engine)
    yield session
    session.close()


def words(text):
    return {w for w in re.sub(r"[^a-z0-9 ]+", " ", text.lower()).split() if w not in STOP}


def jaccard(a, b):
    return len(a & b) / len(a | b)


def test_the_layer_lists_exactly_the_rows_in_order(rows, layer):
    assert list(layer) == [r["control_id"] for r in rows] and len(layer) == 78
    assert not [k for k in layer if not re.fullmatch(r"F[1-4]-[2-8]\.[1-7]", k)]


def test_every_row_has_one_to_three_well_formed_items(rows, layer):
    for r in rows:
        cid = r["control_id"]
        items = layer[cid]
        assert 1 <= len(items) <= 3, (cid, len(items))
        names = [i["name"].lower() for i in items]
        assert len(set(names)) == len(names), cid
        for i in items:
            assert set(i) <= ENTRY_KEYS and {"name", "description", "filetype"} <= set(i), (cid, sorted(i))      # and no `covers`
            assert 10 <= len(i["name"]) <= 80 and i["name"][0].isupper() and not i["name"].endswith("."), (cid, i["name"])
            assert i["name"] == i["name"].strip() and "  " not in i["name"] + i["description"], (cid, i["name"])
            sentences = re.split(r"(?<=[.!?])\s+", i["description"].strip())
            assert 40 <= len(i["description"]) <= 350 and i["description"].endswith(".") and len(sentences) <= 2, (cid, i["name"])
            assert i["description"][0].isupper(), (cid, i["name"])
            assert i.get("collection_frequency", "on-change") in ("on-change", "continuous"), (cid, i["name"])


def test_the_item_counts_per_annex_and_per_row(rows, layer):
    total = 0
    for annex, (items, per_row) in PER_ANNEX.items():
        mine = [layer[r["control_id"]] for r in rows if r["annex"] == annex]
        assert sum(len(v) for v in mine) == items, annex
        assert {n: sum(1 for v in mine if len(v) == n) for n in (1, 2, 3) if any(len(v) == n for v in mine)} == per_row, annex
        total += items
    assert total == 129 == sum(len(v) for v in layer.values())
    assert 120 <= total <= 170                              # roughly 1.5 to 2.2 per row: one item where a mapped control covers the objective


def test_event_driven_and_continuous_items_are_the_ones_that_say_so(layer):
    got = {f: {i["name"] for v in layer.values() for i in v if i.get("collection_frequency") == f} for f in ("on-change", "continuous")}
    assert got == EVENT_DRIVEN
    assert sum(1 for v in layer.values() for i in v if "collection_frequency" not in i) == 129 - 13


def test_filetypes_use_the_vocabulary_of_the_other_catalogs(layer):
    vocabulary = set()
    for p in FRAMEWORKS.glob("*.json"):
        if p.name != CORE.name:
            for c in json.loads(p.read_text(encoding="utf-8")).get("controls", []):
                vocabulary |= {e["filetype"] for e in c.get("evidence_requirements") or [] if isinstance(e, dict) and e.get("filetype")}
    assert {"PDF", "XLSX", "DOCX", "PNG", "JSON", "LOG", "CSV", "EML"} <= vocabulary       # the other catalogs were read
    used = {i["filetype"] for items in layer.values() for i in items}
    assert used <= vocabulary
    if E_LAYER.exists():                                      # and the values the Annex E layer uses
        assert used <= {i["filetype"] for v in json.loads(E_LAYER.read_text(encoding="utf-8"))["controls"].values() for i in v}
    # a log is a log, a screenshot is a picture, a register is a sheet
    by_name = {i["name"]: i["filetype"] for v in layer.values() for i in v}
    assert by_name["Remote access session logs"] == by_name["Data exchange user activity logs"] == "LOG"
    assert by_name["Remote device posture check settings"] == by_name["DMZ architecture diagram"] == "PNG"
    assert by_name["Cryptographic key inventory"] == by_name["Alternate supplier register"] == "XLSX"


def test_wording_has_no_vendor_names_other_frameworks_ids_clause_numbers_or_stray_ai(rows, layer):
    for r in rows:
        for i in layer[r["control_id"]]:
            text = f"{i['name']} {i['description']}"
            for pattern in FORBIDDEN:
                flags = 0 if pattern in CASE_SENSITIVE else re.I
                assert not re.search(pattern, text, flags), (r["control_id"], i["name"], pattern)
            for pattern in BRITISH:
                assert not re.search(pattern, text, re.I), (r["control_id"], i["name"], pattern)
            assert not re.search(r"artificial intelligence|\bcontractors?\b", text, re.I) and not re.search(r"\bAI\b", text), (r["control_id"], i["name"])
            assert "’" not in text and '"' not in text, (r["control_id"], i["name"])      # plain apostrophes, no quotation marks
            # an item is a thing a person can upload, not advice: no "should", "must be done", "ensure ..." instructions
            assert not re.search(r"\b(should|ensure|make sure|we recommend|consider)\b", text, re.I), (r["control_id"], i["name"])


def test_no_scf_wording_in_the_layer(layer):
    """The layer is written from the annex (a licence rule: no SCF text anywhere); the SCF fingerprint finds none."""
    from grc.services import licence_guard as guard

    refused = [(cid, i["name"]) for cid, items in layer.items() for i in items
               if guard.find_restricted(f"- {i['name']}: {i['description']}")]
    assert not refused, refused[:5]


def test_nothing_is_repeated_across_rows_or_with_the_core_and_annex_e_layers(layer, others):
    """So the merge into one framework keeps the library's own 'nothing repeated' test green."""
    mine = [(cid, i) for cid, items in layer.items() for i in items]
    everything = mine + others
    assert len({i["name"].lower() for _, i in everything}) == len(everything)          # no two items share a name, in any control
    assert len({i["description"].lower() for _, i in everything}) == len(everything)
    assert len(others) >= 527                                                          # the library's own layer was read
    ws = [words(i["description"]) for _, i in everything]
    closest = max((jaccard(ws[a], ws[b]), a, b) for a, b in itertools.product(range(len(mine)), range(len(everything)))
                  if a < b and everything[a][0] != everything[b][0])
    assert closest[0] < 0.7, (closest[0], everything[closest[1]][1]["name"], everything[closest[2]][1]["name"])
    names = [words(i["name"]) for _, i in everything]
    closest = max((jaccard(names[a], names[b]), a, b) for a, b in itertools.product(range(len(mine)), range(len(everything)))
                  if a < b and everything[a][0] != everything[b][0])
    assert closest[0] < 0.7, (closest[0], everything[closest[1]][1]["name"], everything[closest[2]][1]["name"])


def test_items_do_not_restate_what_the_mapped_core_controls_already_ask_for(rows, layer):
    """An item adds to, and does not repeat, the evidence of the controls its row maps to (the library's own layer)."""
    core = json.loads(MAIN_LAYER.read_text(encoding="utf-8"))["controls"]
    worst = []
    for r in rows:
        theirs = [i for c in r["uae_ia_controls"] for i in core[c]]
        for i in layer[r["control_id"]]:
            worst.append((max(jaccard(words(i["description"]), words(t["description"])) for t in theirs),
                          max(jaccard(words(i["name"]), words(t["name"])) for t in theirs), r["control_id"], i["name"]))
    assert max(w[0] for w in worst) < 0.5, max(worst)
    assert max(w[1] for w in worst) < 0.6, max(worst, key=lambda w: w[1])


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
    assert {"policy", "procedure", "log", "configuration", "report", "contract", "attestation", "certificate", "training",
            "document"} == set(types.values())
    # the types people filter by come out sensibly
    assert types["F2-2.1", "Remote work security policy"] == "policy"
    assert types["F2-2.1", "Remote work security procedures"] == "procedure"
    assert types["F2-3.1", "Remote access session logs"] == "log"
    assert types["F2-3.1", "Remote device posture check settings"] == "configuration"
    assert types["F1-2.2", "Encryption risk assessment"] == "report"
    assert types["F2-4.3", "Signed BYOD agreements"] == "contract"
    assert types["F1-5.1", "Key custodian appointments"] == "attestation"
    assert types["F4-5.5", "Exchange endpoint certificate inventory"] == "certificate"
    assert types["F2-2.3", "Remote worker awareness material"] == "training"
    assert types["F1-5.7", "Key archive register"] == "document"


def test_the_staging_rows_are_the_layer_merged_in(rows, layer):
    """What build_uae_ia_annex_f_rows.py writes: {name, description, filetype} like ADHICS and PISF, plus collection_frequency
    where the layer sets one."""
    for r in rows:
        want = [{k: i[k] for k in ("name", "description", "filetype", "collection_frequency") if k in i} for i in layer[r["control_id"]]]
        assert r["evidence_requirements"] == want, r["control_id"]
        assert all(set(e) <= ENTRY_KEYS and "covers" not in e for e in r["evidence_requirements"])
    assert sum(len(r["evidence_requirements"]) for r in rows) == sum(len(v) for v in layer.values()) == 129


def test_the_seeder_creates_one_requirement_per_entry_with_a_type_and_a_frequency(rows, db):
    from grc.seed_frameworks import _infer_evidence_type, seed_framework_from_json

    data = {"metadata": {"name": "UAE IA Annex F rows (test)", "version": "2.1", "classification": "regulatory",
                         "framework_type": "regulatory"}, "controls": rows}
    fw = seed_framework_from_json(db, data, tenant_id=1)
    db.commit()
    controls = {c.id: c for c in db.query(m.ParsedFrameworkControl).filter_by(uploaded_framework_id=fw.id)}
    got = db.query(m.ControlEvidenceRequirement).filter_by(framework_id=fw.id).order_by(
        m.ControlEvidenceRequirement.parsed_control_id, m.ControlEvidenceRequirement.display_order).all()
    assert len(got) == sum(len(r["evidence_requirements"]) for r in rows) == 129
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
    assert row["F1-5.6", "Key destruction records"].collection_frequency == "on-change"
    assert row["F2-3.1", "Remote access session logs"].collection_frequency == "continuous"
    assert row["F2-2.1", "Remote work security policy"].collection_frequency == "annually"
    assert row["F2-4.3", "Signed BYOD agreements"].evidence_type == "contract"


def test_the_builder_stops_on_a_layer_that_does_not_fit_the_rows():
    from grc.tools import build_uae_ia_annex_f_rows as b

    rows = [{"id": "F9-9.1"}, {"id": "F9-9.2"}]
    item = {"name": "Register", "description": "A register.", "filetype": "XLSX"}
    ok = {"controls": {"F9-9.1": [item], "F9-9.2": [item, {**item, "name": "Log", "collection_frequency": "continuous"}]}}
    b.check_layer(ok, rows)
    assert b.evidence_items(ok["controls"]["F9-9.2"]) == [item, {**item, "name": "Log", "collection_frequency": "continuous"}]
    for bad in ({"controls": {"F9-9.1": [item]}},                                                       # a row the layer does not know
                {"controls": {**ok["controls"], "F9-9.3": [item]}},                                     # a row the annex does not have
                {"controls": {"F9-9.2": ok["controls"]["F9-9.2"], "F9-9.1": [item]}},                   # rows out of order
                {"controls": {"F9-9.1": [], "F9-9.2": [item]}},                                         # no item
                {"controls": {"F9-9.1": [item] * 4, "F9-9.2": [item]}},                                 # too many items
                {"controls": {"F9-9.1": [{**item, "covers": [1]}], "F9-9.2": [item]}},                  # `covers` is not shipped
                {"controls": {"F9-9.1": [{**item, "note": "x"}], "F9-9.2": [item]}},                    # a key the seeder does not read
                {"controls": {"F9-9.1": [{"name": "Register", "filetype": "XLSX"}], "F9-9.2": [item]}},     # no description
                {"controls": {"F9-9.1": [{**item, "filetype": " "}], "F9-9.2": [item]}}):                 # an empty value
        with pytest.raises(SystemExit):
            b.check_layer(bad, rows)
    with pytest.raises(SystemExit):                                                     # two rows with one id
        b.check_layer(ok, [{"id": "F9-9.1"}, {"id": "F9-9.1"}])
