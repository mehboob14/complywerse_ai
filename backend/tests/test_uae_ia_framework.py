"""UAE Information Assurance Standard v2.1 as a framework library.

The committed catalog (seed_data/frameworks/uae_ia.json, built from the standard's PDF by
grc/tools/build_uae_ia_catalog.py) agrees with the standard's own published totals and lists (Annex A, B, C),
loads through both real seeding paths (new tenant, startup backfill) and is registered where ADHICS and PISF are.
Its first 134 rows are the standard's controls (the `core` fixture: the rows without an `annex` key, which every oracle
of Annex A-C is held to); the 128 rows after them are the national policies of Annex E and F, copied in from the staging files
of their own builders. Most of this runs without the PDF (on in-memory SQLite); the round trip that rebuilds the catalog from
it runs when the PDF is found (UAE_IA_PDF, or ~/Downloads/UAE INFORMATION ASSURANCE STANDARD.pdf) and is the edition the
catalog was built from, and is skipped otherwise.
"""
import copy
import hashlib
import json
import os
import re
import shutil
from collections import Counter
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

os.environ.setdefault("SESSION_SECRET", "unit-test-secret")

import grc.models as m  # noqa: E402

CATALOG = Path(__file__).resolve().parents[1] / "grc" / "seed_data" / "frameworks" / "uae_ia.json"
SEED = CATALOG.parents[1]
NAME = "UAE Information Assurance Standard"
PDF_NAME = "UAE INFORMATION ASSURANCE STANDARD.pdf"
FAMILIES = [f"M{i}" for i in range(1, 7)] + [f"T{i}" for i in range(1, 10)]
# the annex builders' oracles (rows per annex section), in the order the rows follow the 134 controls
ANNEXES = [("E1", 26), ("E2", 6), ("E3", 18), ("F1", 21), ("F2", 12), ("F3", 24), ("F4", 21)]

# Annex B (Table 6): the 70 "Always Applicable" controls, and Annex C (Table 8): the controls of each priority,
# copied from the standard's printed lists (P1 39, P2 60, P3 24, P4 11).
ANNEX_B = """
M1.1.1 M1.1.2 M1.1.3 M1.2.1 M1.2.2 M1.2.3 M1.3.1 M1.3.2 M1.3.3 M2.1.1 M2.2.1 M2.2.2 M2.2.3 M2.3.1 M2.3.2
M2.3.3 M2.3.4 M2.4.1 M2.4.2 M3.2.1 M3.3.2 M3.3.3 M4.1.1 M4.1.2 M4.2.1 M4.3.2 M5.2.1 M6.2.1 M6.2.2 M6.2.3
M6.3.1 M6.3.2 T1.2.1 T1.3.1 T1.3.2 T1.3.3 T1.3.6 T1.5.1 T2.1.1 T3.1.1 T3.1.3 T3.1.6 T3.1.7 T3.2.2 T3.2.3
T3.3.2 T3.4.1 T3.4.2 T3.4.3 T4.1.1 T5.2.1 T5.2.2 T5.2.3 T5.2.4 T5.3.1 T5.3.3 T5.4.3 T6.2.1 T6.2.2 T6.2.3
T6.2.4 T6.2.5 T7.2.1 T8.1.2 T8.2.1 T8.2.2 T8.2.3 T8.2.4 T8.2.5 T9.1.1
"""
ANNEX_C = {
    "P1": """
    M1.1.1 M1.1.2 M1.1.3 M1.2.1 M1.2.2 M1.3.1 M2.1.1 M2.2.1 M2.2.2 M2.2.3 M2.3.1 M2.3.2 M2.3.3 M2.3.4 M2.4.1
    M2.4.2 T1.2.1 T1.3.1 T1.5.1 T3.1.1 T3.1.6 T3.1.7 T3.2.2 T3.2.3 T3.3.2 T3.4.2 T3.4.3 T4.1.1 T5.2.1 T5.2.2
    T5.2.3 T5.2.4 T5.3.1 T5.3.3 T5.4.3 T6.2.1 T7.2.1 T8.1.2 T8.2.1
    """,
    "P2": """
    M1.2.3 M1.3.2 M1.3.3 M1.3.4 M3.1.1 M3.2.1 M3.3.1 M3.3.2 M3.3.3 M3.4.1 M4.1.1 M4.1.2 M4.2.1 M4.3.2 M5.1.1
    M5.1.3 M5.2.1 M6.2.1 M6.2.2 M6.2.3 M6.3.1 M6.3.2 T1.1.1 T1.2.2 T1.3.2 T1.3.3 T1.3.4 T1.3.5 T1.3.6 T1.4.1
    T2.1.1 T2.2.1 T2.2.2 T2.2.5 T2.3.1 T2.3.7 T3.1.3 T3.1.4 T3.4.1 T3.4.4 T4.1.2 T4.1.3 T4.1.4 T5.1.1 T5.3.2
    T5.4.1 T6.1.1 T6.2.2 T6.2.3 T6.2.4 T6.2.5 T7.3.1 T7.4.1 T7.4.3 T8.1.1 T8.2.2 T8.2.3 T8.2.4 T8.2.5 T9.1.1
    """,
    "P3": """
    M3.3.4 M3.3.5 M4.2.2 M4.3.1 M5.1.4 M6.1.1 T1.4.2 T2.2.3 T2.3.4 T2.3.5 T2.3.6 T3.1.8 T3.2.1 T3.2.4 T3.3.1
    T4.1.5 T5.4.2 T7.1.1 T7.3.2 T7.3.3 T7.4.2 T8.2.7 T9.1.2 T9.2.1
    """,
    "P4": """
    M1.3.5 M5.1.2 M5.3.1 T2.2.4 T2.3.2 T2.3.3 T3.1.2 T3.1.5 T5.3.4 T7.2.2 T8.2.6
    """,
}


@pytest.fixture(scope="module")
def catalog():
    return json.loads(CATALOG.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def core(catalog):
    """The standard's own 134 controls: the rows that are not an annex row."""
    return [x for x in catalog["controls"] if "annex" not in x]


@pytest.fixture(scope="module")
def pdf(catalog):
    """The standard's PDF, when it is on this machine and is the edition the catalog was built from."""
    pytest.importorskip("fitz")
    path = Path(os.environ.get("UAE_IA_PDF") or Path.home() / "Downloads" / PDF_NAME)
    if not path.is_file():
        pytest.skip(f"the standard's PDF is not at {path} (set UAE_IA_PDF)")
    if hashlib.sha256(path.read_bytes()).hexdigest() != catalog["metadata"]["source_pdf_sha256"]:
        pytest.skip(f"{path} is not the edition the catalog was built from")
    return path


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    session = Session(engine)
    yield session
    session.close()


def test_the_catalog_has_the_standards_own_totals(catalog, core):
    c = core
    assert len(c) == 134
    assert len({x["control_id"] for x in c}) == 134
    assert len({x["domain"] for x in c}) == 15                       # Annex A table 4: families
    assert len({x["category"] for x in c}) == 47                     # sub-families
    assert sum(x["sub_control_count"] for x in c) == 449             # sub-controls
    assert Counter(x["is_mandatory"] for x in c) == {True: 70, False: 64}                 # table 5
    assert Counter(x["priority_tier"] for x in c) == {"P1": 39, "P2": 60, "P3": 24, "P4": 11}   # table 7
    assert len([s for s in catalog["metadata"]["document_structure"]["sections"] if re.fullmatch(r"[MT]\d", s["number"])]) == 15


def test_always_applicable_and_priority_follow_annex_b_and_c(core):
    by_id = {x["control_id"]: x for x in core}
    assert {i for i, x in by_id.items() if x["is_mandatory"]} == set(ANNEX_B.split())
    for level, ids in ANNEX_C.items():
        assert {i for i, x in by_id.items() if x["priority_tier"] == level} == set(ids.split()), level
    for x in core:
        assert x["applicability"] == ("Always applicable" if x["is_mandatory"] else "Based on risk assessment")
        # chapter 3.5: priority sets the order of implementation; severity is P1 high, P2 medium, P3/P4 low
        assert x["priority"] == {"P1": "high", "P2": "medium", "P3": "low", "P4": "low"}[x["priority_tier"]]
        assert "priority_level" not in x       # would switch the framework page into NDMO's "3-year roadmap" view


def test_every_control_is_complete_and_fits_the_seeder_columns(core):
    for x in core:
        cid = x["control_id"]
        family, sub = cid.split(".")[0], ".".join(cid.split(".")[:2])
        assert re.fullmatch(r"[MT]\d\.\d\.\d+", cid)
        assert x["original_reference"] == x["section_number"] == cid
        assert x["domain"].startswith(family + " ") and x["category"].startswith(sub + " ")
        assert x["parent_section"] == sub
        assert x["title"] and x["description"] and x["full_text"].startswith(x["description"])
        assert len(cid) <= 100 and len(x["title"]) <= 500 and len(x["domain"]) <= 100 and len(x["category"]) <= 100
        assert len(x["section_number"]) <= 50 and len(x["priority"]) <= 20
        assert (2 if x["sub_control_count"] <= 2 else 3) <= len(x["evidence_requirements"]) <= 6      # the standard names no evidence: an authored layer, see test_uae_ia_evidence.py
        assert set(x["mappings"]) == {"iso_27001_2022", "iso_27002_2022", "nist_800_53_r5", "isr_v3"}


def test_sub_controls_are_the_requirement_text_and_the_assessment_criteria(core):
    for x in core:
        items = re.findall(r"^(\d+)\) ", x["full_text"], re.M)
        assert items == [str(i) for i in range(1, len(items) + 1)] and items, x["control_id"]
        assert len(items) == len(x["assessment_criteria"]) == x["sub_control_count"], x["control_id"]
        assert all(c.strip() for c in x["assessment_criteria"])
    # a lead-in such as "The entity shall:" travels with each item it governs, and a mid-list one only with the items after it
    by_id = {x["control_id"]: x for x in core}
    assert by_id["M1.1.1"]["assessment_criteria"][1] == "The entity shall determine: the requirements of these interested parties."
    assert by_id["M3.2.1"]["assessment_criteria"][0].endswith("information security requirements.")
    assert by_id["M3.2.1"]["assessment_criteria"][1].startswith("The entity shall: provide training")


def test_guidance_is_kept_apart_from_the_requirement_text(core):
    for x in core:
        assert "Implementation Guidance" not in x["full_text"] and "Implementation Guidance" in x["ai_notes"], x["control_id"]
        assert x["ai_notes"].startswith(f"Applicability: {x['applicability']}. Implementation priority: {x['priority_tier']}.")


def test_the_seeder_loads_all_262_controls_without_truncation(catalog, db, capsys):
    from grc.seed_frameworks import seed_framework_from_json

    fw = seed_framework_from_json(db, catalog, tenant_id=1)
    db.commit()
    assert "truncat" not in capsys.readouterr().out.lower()
    assert (fw.name, fw.version, fw.classification, fw.is_shared, fw.is_active) == (NAME, "2.1", "regulatory", True, True)
    assert fw.effective_date.date().isoformat() == "2025-11-01" and fw.source_organization == "UAE Cyber Security Council (CSC)"
    rows = db.query(m.ParsedFrameworkControl).filter_by(uploaded_framework_id=fw.id).order_by(m.ParsedFrameworkControl.id).all()
    assert [r.control_id for r in rows] == [x["control_id"] for x in catalog["controls"]]          # document order kept
    assert len(rows) == 262
    first = rows[0]
    assert first.title == "Understanding the Entity and its Context" and first.is_mandatory is True and first.priority == "high"
    assert first.priority_level is None and len(first.assessment_criteria) == 5 and "Implementation Guidance" in first.ai_notes
    assert (first.domain, first.category, first.parent_section) == ("M1 Strategy and Planning", "M1.1 Entity Context and Leadership", "M1.1")
    assert sum(len(r.assessment_criteria) for r in rows[:134]) == 449             # the standard's sub-controls: its 134 controls come first
    assert len(fw.document_structure["sections"]) == 15 + 7                        # the 15 families, then one section per annex policy
    # an annex row lands like the others: not mandatory, medium, no priority_level, in its own domain
    annex = rows[134:]
    assert (annex[0].control_id, annex[0].domain, annex[0].category, annex[0].parent_section) == (
        "E1-2.1.1", "E1 National Cloud Security Policy (Annex E)", "2.1 Cloud Governance", "E1-2.1")
    assert [(r.is_mandatory, r.priority, r.priority_level) for r in annex] == [(False, "medium", None)] * 128
    assert [r.control_id for r in annex][-1] == "F4-7.2" and len({r.domain for r in annex}) == 7
    # idempotent by name, which is how a tenant that already has it is left alone
    assert seed_framework_from_json(db, catalog, tenant_id=1) is None


def test_startup_backfill_adds_it_once(catalog, db, tmp_path, monkeypatch):
    """Existing tenants get it at backend startup: ensure_local_framework_catalog seeds every library whose name is missing."""
    from grc import startup_seed

    shutil.copy(CATALOG, tmp_path / "uae_ia.json")
    monkeypatch.setattr(startup_seed, "_FRAMEWORK_SEED_DIR", tmp_path)
    first = startup_seed.ensure_local_framework_catalog(db)
    db.commit()
    assert (first["seeded"], first["created_frameworks"], first["created_controls"]) == (True, 1, 262)
    assert [n for (n,) in db.query(m.UploadedFramework.name)] == [NAME]
    assert startup_seed.ensure_local_framework_catalog(db) == {"seeded": False, "missing": 0}


def test_it_is_registered_in_the_crosswalk_registry_and_the_labels():
    from grc.modules.automation.router import _FW_LABELS
    from grc.modules.scf import registry

    assert registry.slug_for_framework(NAME) == "uae_ia"
    assert registry.join_field_for_slug("uae_ia") == "control_id"
    assert registry.label_for_slug("uae_ia") == "UAE IA" == _FW_LABELS["uae_ia"]
    # no SCF rows by the owner's decision: hidden from the SCF framework list (the Controls Automation scope), still resolvable by name
    assert "uae_ia" not in [e["slug"] for e in registry.framework_catalog()]
    entry = next(e for e in registry._entries() if e["slug"] == "uae_ia")
    assert entry["file"] == CATALOG.name and entry["scf_keys"] == [] and entry["emit"] is False
    # SCF's "EMEA UAE NIAF 2023" is a different document (codes 3.1.1-3.4.3): it must not be bound by name
    assert registry.expand_source_slugs(["uae_ia"]) == {"uae_ia"}


def test_the_builder_repairs_wrapped_lines_and_the_standards_printed_typos():
    from grc.tools import build_uae_ia_catalog as b

    def line(raw, x=175.0, y=0.0):
        return b.Line(1, x, x + 100, y, y + 11, 10.0, False, raw)

    assert b.join([line("provide cross-"), line("functional support ")]) == "provide cross-functional support"
    assert b.join([line("low likelihood- "), line("risks).")]) == "low likelihood- risks)."     # printed with a space
    # Annex D: one ISO column holds both standards; "PE- 20" and "5.5 6.1.4" are typos in the printed table
    assert b.annex_d_mapping(["Clause 4.1, 5.11", "PM-1, PE- 20, All XX-1 controls", "5.5 6.1.4, All Domains"]) == {
        "iso_27001_2022": ["Clause 4.1"], "iso_27002_2022": ["5.11"],
        "nist_800_53_r5": ["PM-1", "PE-20", "All XX-1 controls"], "isr_v3": ["5.5", "6.1.4", "All Domains"]}
    # an unnumbered line at the item indent starts a lead-in for the items after it; hanging lines belong to their item
    entries = b.parse_subcontrols([line("1) first item", 174.9, 10), line("wrapped here", 191.8, 23),
                                   line("The entity shall:", 174.9, 36), line("2) second item", 174.9, 49)])
    assert [("lead" in e) for e in entries] == [False, True, False]
    assert b.criteria({"sub_controls": entries}) == ["first item wrapped here", "The entity shall: second item"]


# ── the Annex E and F rows after the 134 controls ────────────────────────────────────────────────

def _staging():
    """The two staging files the annex builders write (Annex E, then Annex F), as loaded JSON."""
    return [json.loads((SEED / f"uae_ia_annex_{a}_rows.json").read_text(encoding="utf-8")) for a in "ef"]


def test_the_annex_rows_follow_the_134_controls_in_the_builders_order(catalog, core):
    rows = catalog["controls"]
    assert len(rows) == 262 == catalog["metadata"]["total_controls"] == len({x["control_id"] for x in rows})
    assert rows[:134] == core                                                           # the standard's controls, then the annexes
    assert [x["annex"] for x in rows[134:]] == [a for a, n in ANNEXES for _ in range(n)]       # E1 E2 E3 F1 F2 F3 F4: 26 6 18 21 12 24 21
    assert [x["control_id"] for x in rows[134:136]] == ["E1-2.1.1", "E1-2.1.2"] and rows[-1]["control_id"] == "F4-7.2"
    assert not {x["control_id"] for x in rows[134:]} & {x["control_id"] for x in core}
    ids = {x["control_id"] for x in core}
    assert all(x["uae_ia_controls"] and set(x["uae_ia_controls"]) <= ids for x in rows[134:] if x["annex"][0] == "F")      # mapped to real controls
    assert all(set(x["uae_ia_controls"]) <= ids for x in rows[134:])


def test_the_annex_rows_are_the_staging_rows_but_for_their_evidence_entries(catalog):
    staging = _staging()
    assert {s["source_pdf_sha256"] for s in staging} == {catalog["metadata"]["source_pdf_sha256"]}          # one PDF, one edition
    staged = [r for s in staging for r in s["controls"]]
    got = catalog["controls"][134:]
    assert len(got) == len(staged) == 128
    for g, s in zip(got, staged):
        assert list(g) == list(s), g["control_id"]                                       # every key, in the staged order
        assert {k: v for k, v in g.items() if k != "evidence_requirements"} == {k: v for k, v in s.items() if k != "evidence_requirements"}
        assert len(g["evidence_requirements"]) == len(s["evidence_requirements"]) >= 1, g["control_id"]
        for e, entry in zip(g["evidence_requirements"], s["evidence_requirements"]):
            # the staged entry as it was, then the keys the core entries carry (see test_uae_ia_evidence.py)
            assert list(e)[:len(entry)] == list(entry) and all(e[k] == entry[k] for k in entry), (g["control_id"], e["name"])
            assert list(e)[len(entry):] == ["is_mandatory", "retention_period", "ai_confidence", "ai_reasoning"], (g["control_id"], e["name"])


def test_the_metadata_describes_the_annex_rows(catalog):
    md = catalog["metadata"]
    # the numbers about the standard's own controls are unchanged; one sentence says what else the library carries
    assert "It organizes 134 controls and 449 sub-controls into 15 families (47 sub-families)" in md["description"]
    assert md["description"].endswith(
        "The library also carries the standard's national technology policies (Annex E: cloud, artificial intelligence and IoT) "
        "and the mapping of four national security policies (Annex F) as extra sections.")
    sections = md["document_structure"]["sections"]
    assert [s["number"] for s in sections] == FAMILIES + [a for a, _ in ANNEXES]       # the 15 families, then one section per annex policy
    for s in sections[15:]:
        rows = [x for x in catalog["controls"] if x.get("annex") == s["number"]]
        assert list(s) == ["number", "name", "description", "sub_families"]            # the annexes state no objective or performance indicator
        assert {x["domain"] for x in rows} == {s["name"]} and re.match(rf"{s['number']} National ", s["name"])
        assert re.fullmatch(rf"Annex {s['number'][0]}, the National .+: its (policy controls|sections) and the UAE IA controls .+\.", s["description"])
        assert [(p["id"], p["name"]) for p in s["sub_families"]] == [
            (part, category.split(" ", 1)[1]) for part, category in dict.fromkeys((x["parent_section"], x["category"]) for x in rows)]
    parts = {s["number"]: [p["name"] for p in s["sub_families"]] for s in sections[15:]}
    assert [len(v) for v in parts.values()] == [9, 1, 8, 5, 4, 7, 6]
    assert parts["E1"][0] == "Cloud Governance" and parts["E1"][-1] == "Cloud Resilience"
    assert sections[16]["sub_families"] == [{"id": "E2-2", "name": "Cyber Security Policy for Artificial Intelligence"}]
    assert parts["F1"] == ["Governance", "Data at Rest", "Data in Motion", "Key Management", "Post Quantum Cryptography"]
    assert sections[15]["name"] == "E1 National Cloud Security Policy (Annex E)" and sections[-1]["name"] == "F4 National Data Exchange Security Policy mapping (Annex F)"
    pattern = md["hierarchy_structure"]["numbering_pattern"]
    assert pattern.startswith("M1.1.1 = management family M1") and "E1-2.1.1 = Annex E policy control" in pattern and "F1-2.1 = Annex F mapping row" in pattern
    assert md["hierarchy_structure"]["levels"] == ["Family", "Sub-family", "Control", "Sub-control"]
    note = [a for a in md["adoption_approach"] if a.startswith("The Annex E and F rows")]
    assert len(md["adoption_approach"]) == 6 and len(note) == 1
    assert "not mandatory" in note[0] and "states no obligation of its own for Annex F" in note[0]
    assert "not part of this library" not in md["source_note"]
    assert "uae_ia_annex_e_rows.json" in md["source_note"] and "uae_ia_annex_f_rows.json" in md["source_note"]
    assert "uae_ia_annex_e_evidence.json" in md["source_note"] and "uae_ia_annex_f_evidence.json" in md["source_note"]


def test_an_item_is_required_when_it_evidences_a_shall_and_not_when_it_evidences_a_consideration():
    from grc.tools import build_uae_ia_annex_e_rows as annex_e
    from grc.tools import build_uae_ia_catalog as b

    assert (b.CONSIDERATION.pattern, b.CONSIDERATION.flags) == (annex_e.CONSIDERATION.pattern, annex_e.CONSIDERATION.flags)      # one definition
    row = {"control_id": "E9-9.9", "obligations": [
        "The entity shall keep a policy.", "When defining it, the entity shall take the following into account: size",
        "When defining it, the entity shall Take the following into account: owner"]}
    item = lambda *covers: {"name": "Register", "covers": list(covers)}               # noqa: E731
    assert b.evidences_a_shall("E", row, item(1)) is True
    assert b.evidences_a_shall("E", row, item(2)) is False and b.evidences_a_shall("E", row, item(2, 3)) is False
    assert b.evidences_a_shall("E", row, item(3, 1)) is True                           # one shall among the considerations is enough
    assert b.evidences_a_shall("F", row, item(1)) is False and b.evidences_a_shall("F", row, {"name": "Register"}) is False
    for bad in ([], [0], [4], [1, 99]):                                                # an item that covers nothing, or an obligation the row lacks
        with pytest.raises(SystemExit, match="covers"):
            b.evidences_a_shall("E", row, item(*bad))


def test_the_builder_copies_the_annex_files_in_and_stops_when_they_do_not_fit(core):
    from grc.tools import build_uae_ia_catalog as b

    annexes = b.read_annexes()
    sha = annexes["E"][0]["source_pdf_sha256"]
    got = b.annex_controls(annexes, sha, core)                                          # the committed files fit
    assert [x["control_id"] for x in got] == [r["control_id"] for a in "EF" for r in annexes[a][0]["controls"]] and len(got) == 128

    def stops(match, change=lambda a: None, sha=sha, core=core):
        broken = copy.deepcopy(annexes)
        change(broken)
        with pytest.raises(SystemExit, match=match):
            b.annex_controls(broken, sha, core)

    first_e = lambda a: a["E"][0]["controls"][0]                                        # noqa: E731
    stops("another PDF", sha="0" * 64)
    stops("list different rows", lambda a: a["E"][1]["controls"].pop("E1-2.1.1"))        # the layer lacks a row the staging file has
    stops("annex builders found", lambda a: (a["F"][0]["controls"].pop(), a["F"][1]["controls"].popitem()))       # F4 loses its last row
    stops("control ids repeat", core=core + [{"control_id": "F4-7.2", "evidence_requirements": []}])           # an id the library already has
    stops("not controls of the standard", lambda a: first_e(a).update(uae_ia_controls=["M9.9.9"]))
    stops("has no evidence item", lambda a: (first_e(a).update(evidence_requirements=[]), a["E"][1]["controls"].update({"E1-2.1.1": []})))
    stops("are not those of", lambda a: first_e(a)["evidence_requirements"][0].update(name="Something else entirely"))

    def reuse_a_core_name(a):                                                            # the same name as a core item, in other letters
        name = core[0]["evidence_requirements"][0]["name"].upper()
        first_e(a)["evidence_requirements"][0]["name"] = name
        a["E"][1]["controls"]["E1-2.1.1"][0]["name"] = name

    stops("evidence names repeat", reuse_a_core_name)
    stops("covers", lambda a: a["E"][1]["controls"]["E1-2.1.1"][0].update(covers=[99]))


def test_the_catalog_is_what_the_builder_makes_of_the_pdf_and_the_layers(pdf, tmp_path):
    """Round trip: the PDF, the three evidence layers and the two staging files build the committed catalog, byte for byte."""
    from grc.tools import build_uae_ia_catalog as b

    out = tmp_path / "uae_ia.json"
    assert b.main([str(pdf), str(out)]) == 0
    # git keeps the file with LF line ends and a Windows checkout may hand it back with CRLF: it is the text that has to match
    assert out.read_bytes() == CATALOG.read_bytes().replace(b"\r\n", b"\n")
