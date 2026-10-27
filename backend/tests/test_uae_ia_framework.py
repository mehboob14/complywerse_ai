"""UAE Information Assurance Standard v2.1 as a framework library.

The committed catalog (seed_data/frameworks/uae_ia.json, built from the standard's PDF by
grc/tools/build_uae_ia_catalog.py) agrees with the standard's own published totals and lists (Annex A, B, C),
loads through both real seeding paths (new tenant, startup backfill) and is registered where ADHICS and PISF are.
The PDF is not needed here. On in-memory SQLite.
"""
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
NAME = "UAE Information Assurance Standard"

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


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    session = Session(engine)
    yield session
    session.close()


def test_the_catalog_has_the_standards_own_totals(catalog):
    c = catalog["controls"]
    assert len(c) == 134 == catalog["metadata"]["total_controls"]
    assert len({x["control_id"] for x in c}) == 134
    assert len({x["domain"] for x in c}) == 15                       # Annex A table 4: families
    assert len({x["category"] for x in c}) == 47                     # sub-families
    assert sum(x["sub_control_count"] for x in c) == 449             # sub-controls
    assert Counter(x["is_mandatory"] for x in c) == {True: 70, False: 64}                 # table 5
    assert Counter(x["priority_tier"] for x in c) == {"P1": 39, "P2": 60, "P3": 24, "P4": 11}   # table 7
    assert len(catalog["metadata"]["document_structure"]["sections"]) == 15


def test_always_applicable_and_priority_follow_annex_b_and_c(catalog):
    by_id = {x["control_id"]: x for x in catalog["controls"]}
    assert {i for i, x in by_id.items() if x["is_mandatory"]} == set(ANNEX_B.split())
    for level, ids in ANNEX_C.items():
        assert {i for i, x in by_id.items() if x["priority_tier"] == level} == set(ids.split()), level
    for x in catalog["controls"]:
        assert x["applicability"] == ("Always applicable" if x["is_mandatory"] else "Based on risk assessment")
        # chapter 3.5: priority sets the order of implementation; severity is P1 high, P2 medium, P3/P4 low
        assert x["priority"] == {"P1": "high", "P2": "medium", "P3": "low", "P4": "low"}[x["priority_tier"]]
        assert "priority_level" not in x       # would switch the framework page into NDMO's "3-year roadmap" view


def test_every_control_is_complete_and_fits_the_seeder_columns(catalog):
    for x in catalog["controls"]:
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


def test_sub_controls_are_the_requirement_text_and_the_assessment_criteria(catalog):
    for x in catalog["controls"]:
        items = re.findall(r"^(\d+)\) ", x["full_text"], re.M)
        assert items == [str(i) for i in range(1, len(items) + 1)] and items, x["control_id"]
        assert len(items) == len(x["assessment_criteria"]) == x["sub_control_count"], x["control_id"]
        assert all(c.strip() for c in x["assessment_criteria"])
    # a lead-in such as "The entity shall:" travels with each item it governs, and a mid-list one only with the items after it
    by_id = {x["control_id"]: x for x in catalog["controls"]}
    assert by_id["M1.1.1"]["assessment_criteria"][1] == "The entity shall determine: the requirements of these interested parties."
    assert by_id["M3.2.1"]["assessment_criteria"][0].endswith("information security requirements.")
    assert by_id["M3.2.1"]["assessment_criteria"][1].startswith("The entity shall: provide training")


def test_guidance_is_kept_apart_from_the_requirement_text(catalog):
    for x in catalog["controls"]:
        assert "Implementation Guidance" not in x["full_text"] and "Implementation Guidance" in x["ai_notes"], x["control_id"]
        assert x["ai_notes"].startswith(f"Applicability: {x['applicability']}. Implementation priority: {x['priority_tier']}.")


def test_the_seeder_loads_all_134_controls_without_truncation(catalog, db, capsys):
    from grc.seed_frameworks import seed_framework_from_json

    fw = seed_framework_from_json(db, catalog, tenant_id=1)
    db.commit()
    assert "truncat" not in capsys.readouterr().out.lower()
    assert (fw.name, fw.version, fw.classification, fw.is_shared, fw.is_active) == (NAME, "2.1", "regulatory", True, True)
    assert fw.effective_date.date().isoformat() == "2025-11-01" and fw.source_organization == "UAE Cyber Security Council (CSC)"
    rows = db.query(m.ParsedFrameworkControl).filter_by(uploaded_framework_id=fw.id).order_by(m.ParsedFrameworkControl.id).all()
    assert [r.control_id for r in rows] == [x["control_id"] for x in catalog["controls"]]          # document order kept
    first = rows[0]
    assert first.title == "Understanding the Entity and its Context" and first.is_mandatory is True and first.priority == "high"
    assert first.priority_level is None and len(first.assessment_criteria) == 5 and "Implementation Guidance" in first.ai_notes
    assert (first.domain, first.category, first.parent_section) == ("M1 Strategy and Planning", "M1.1 Entity Context and Leadership", "M1.1")
    assert sum(len(r.assessment_criteria) for r in rows) == 449
    assert len(fw.document_structure["sections"]) == 15
    # idempotent by name, which is how a tenant that already has it is left alone
    assert seed_framework_from_json(db, catalog, tenant_id=1) is None


def test_startup_backfill_adds_it_once(catalog, db, tmp_path, monkeypatch):
    """Existing tenants get it at backend startup: ensure_local_framework_catalog seeds every library whose name is missing."""
    from grc import startup_seed

    shutil.copy(CATALOG, tmp_path / "uae_ia.json")
    monkeypatch.setattr(startup_seed, "_FRAMEWORK_SEED_DIR", tmp_path)
    first = startup_seed.ensure_local_framework_catalog(db)
    db.commit()
    assert (first["seeded"], first["created_frameworks"], first["created_controls"]) == (True, 1, 134)
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
