"""UAE Information Assurance Standard v2.1, Annex E: the three national technology security policies as extra rows of the UAE IA library.

The staging file (seed_data/uae_ia_annex_e_rows.json, built from the standard's PDF by grc/tools/build_uae_ia_annex_e_rows.py)
holds one row per numbered policy control, in the shape of the library's own rows: E1 = Table 10 National Cloud Security Policy,
E2 = Table 11 National Cyber Security Policy for Artificial Intelligence, E3 = Table 12 National IoT Security Policy. The
annex states no totals: the literals below are what the build's two independent passes over the PDF agreed on (layout parse and
flat-text pass, control by control) and what was re-read against the PDF. The seeder does not read the staging file, and the
annex is deliberately not a framework of its own. The PDF is not needed here. On in-memory SQLite.
"""
import json
import os
import re
from collections import Counter
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
CORE = FRAMEWORKS / "uae_ia.json"

DOMAINS = {"E1": "E1 National Cloud Security Policy (Annex E)",
           "E2": "E2 National Cyber Security Policy for Artificial Intelligence (Annex E)",
           "E3": "E3 National IoT Security Policy (Annex E)"}
# annex: (controls, Policy Domain cells, statements, obligations)
TOTALS = {"E1": (26, 9, 39, 64), "E2": (6, 1, 6, 24), "E3": (18, 8, 27, 84)}
# per control, in print order
STATEMENTS = {"E1": [1, 1, 1, 1, 1, 2, 1, 2, 3, 3, 1, 1, 1, 1, 1, 1, 1, 3, 3, 1, 1, 1, 1, 2, 1, 3],
              "E2": [1, 1, 1, 1, 1, 1],
              "E3": [1, 1, 1, 3, 1, 3, 2, 2, 1, 1, 2, 1, 1, 1, 3, 1, 1, 1]}
OBLIGATIONS = {"E1": [7, 1, 5, 1, 1, 2, 13, 2, 3, 3, 1, 2, 1, 1, 1, 3, 1, 3, 3, 1, 1, 1, 1, 2, 1, 3],
               "E2": [4, 6, 5, 4, 2, 3],
               "E3": [4, 1, 1, 7, 1, 16, 2, 5, 5, 1, 7, 1, 1, 4, 3, 6, 7, 12]}
CRITERIA = {"E1": [0, 0, 5, 0, 0, 2, 13, 2, 3, 3, 0, 2, 0, 0, 0, 3, 0, 3, 3, 0, 0, 0, 0, 2, 0, 3],
            "E2": [4, 6, 5, 4, 2, 3],
            "E3": [0, 0, 0, 7, 0, 16, 2, 5, 5, 0, 7, 0, 0, 4, 3, 6, 7, 12]}
PER_DOMAIN = {"E1": [("2.1 Cloud Governance", 5), ("2.2 Contractual Agreements", 2), ("2.3 Data Security and Lifecycle Management", 2),
                     ("2.4 Data Location and Sovereignty", 1), ("2.5 Interoperability and Portability", 2),
                     ("2.6 Cloud Architecture, Infrastructure & Virtualization", 5), ("2.7 Identity and Access Management", 3),
                     ("2.8 Security Incident Management, E-Discovery, and Cloud Forensics", 4), ("2.9 Cloud Resilience", 2)],
              "E2": [("2. Cyber Security Policy for Artificial Intelligence", 6)],
              "E3": [("2.1 IoT Governance", 5), ("2.2 Data Security", 3), ("2.3 Identity and Access Management", 2),
                     ("2.4 Incident Management", 1), ("2.5 IoT Resilience", 2), ("2.6 Device Management", 3),
                     ("2.7 Network Security", 1), ("2.8 Security Logging and Monitoring", 1)]}
# UAE IA v2.1 controls the policy controls map to: (distinct, references) per annex, references = sum over controls
MAPPED = {"E1": (66, 82), "E2": (62, 66), "E3": (69, 73)}
CLOUD_APPLICABILITY = {"Applicable to IaaS, PaaS and SaaS", "Applicable to IaaS and PaaS", "Applicable to PaaS and SaaS"}


@pytest.fixture(scope="module")
def rows():
    return json.loads(ROWS.read_text(encoding="utf-8"))["controls"]


@pytest.fixture(scope="module")
def core():
    return json.loads(CORE.read_text(encoding="utf-8"))


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    m.Base.metadata.create_all(engine)
    session = Session(engine)
    yield session
    session.close()


def of(rows, annex):
    return [r for r in rows if r["annex"] == annex]


def test_the_staging_file_has_the_totals_the_parse_found(rows):
    assert len(rows) == 50 == len({r["control_id"] for r in rows})
    for annex, (controls, domains, statements, obligations) in TOTALS.items():
        mine = of(rows, annex)
        assert (len(mine), len({r["category"] for r in mine}), sum(len(r["statements"]) for r in mine),
                sum(len(r["obligations"]) for r in mine)) == (controls, domains, statements, obligations), annex
        assert [len(r["statements"]) for r in mine] == STATEMENTS[annex], annex
        assert [len(r["obligations"]) for r in mine] == OBLIGATIONS[annex], annex
        assert [len(r["assessment_criteria"]) for r in mine] == CRITERIA[annex], annex
        assert list(Counter(r["category"] for r in mine).items()) == PER_DOMAIN[annex], annex       # in document order
    assert [r["annex"] for r in rows] == ["E1"] * 26 + ["E2"] * 6 + ["E3"] * 18                        # Table 10, 11, 12


def test_ids_follow_the_scheme_and_do_not_meet_the_core_ids(rows, core):
    core_ids = {c["control_id"] for c in core["controls"] if not re.match(r"[EF]\d-", c["control_id"])}      # the catalog holds the F rows too
    assert len(core_ids) == 134
    for r in rows:
        number = r["original_reference"]
        assert r["control_id"] == f"{r['annex']}-{number}" and re.fullmatch(r"E[123]-2(\.\d+){1,2}", r["control_id"]), r["control_id"]
        assert r["control_id"] not in core_ids
        # the framework page groups by the leading integer of a code: a letter first keeps these out of one big section "2"
        assert not re.match(r"\s*\d", r["control_id"])
        assert r["section_number"] == r["control_id"]
        assert r["domain"] == DOMAINS[r["annex"]] and r["category"].startswith(number.rsplit(".", 1)[0] if r["annex"] != "E2" else "2.")
        assert r["parent_section"] == f"{r['annex']}-{r['category'].split()[0].rstrip('.')}"
    # the policies' own numbering is consecutive within a domain: a control the parse lost would leave a gap
    for annex, per_domain in PER_DOMAIN.items():
        want = ([f"2.{k}" for k in range(1, 7)] if annex == "E2" else
                [f"2.{d}.{k}" for d, (_, n) in enumerate(per_domain, start=1) for k in range(1, n + 1)])
        assert [r["original_reference"] for r in of(rows, annex)] == want, annex
    assert [r["title"] for r in of(rows, "E2")] == [
        "AI Cyber Security Governance", "Infrastructure & Application Security", "Algorithm Security", "Operational Security",
        "Adversarial AI Attacks", "AI Monitoring & Response"]
    assert rows[0]["title"] == "Governance Framework" and rows[0]["category"] == "2.1 Cloud Governance"


def test_every_row_has_the_librarys_shape_and_fits_the_seeder_columns(rows):
    for r in rows:
        cid = r["control_id"]
        assert r["title"] and r["description"] and r["full_text"], cid
        assert len(cid) <= 100 and len(r["title"]) <= 500 and len(r["domain"]) <= 100 and len(r["category"]) <= 100, cid
        assert len(r["section_number"]) <= 50 and len(r["priority"]) <= 20 and len(r["parent_section"]) <= 255, cid
        # applies when the entity uses the technology, like the library's "Based on risk assessment"; the annex carries no priority
        assert r["is_mandatory"] is False and r["priority"] == "medium" and r["priority_tier"] is None, cid
        assert "priority_level" not in r                        # would switch the framework page into NDMO's "3-year roadmap" view
        assert 3 <= len(r["evidence_requirements"]) <= 5, cid
        assert r["pdf_page"] in range(207, 218) and all(p in range(207, 218) for s in r["statements"] for p in s["pdf_pages"]), cid
        want = {"E2": "When the entity uses AI/ML systems", "E3": "When the entity uses IoT devices and services"}.get(r["annex"])
        assert r["applicability"] == want if want else r["applicability"] in CLOUD_APPLICABILITY, cid
        assert r["ai_notes"].startswith(f"Applicability: {r['applicability']}. Source: UAE IA v2.1 (November 2025), Annex E, Table ")
        ids = r["uae_ia_controls"]
        assert r["ai_notes"].endswith("Maps to UAE IA v2.1 controls: " + (", ".join(ids) if ids else "none (the annex prints "
                                                                           + next(s["printed_as"] for s in r["statements"] if s.get("printed_as")) + ")") + ".")
        assert "scf" not in r["ai_notes"].lower()
    # Table 10 has an Applicability column, so each cloud statement carries its own; Tables 11 and 12 have none
    assert all("applicability" in s for r in of(rows, "E1") for s in r["statements"])
    assert not any("applicability" in s for r in rows if r["annex"] != "E1" for s in r["statements"])
    assert Counter(r["applicability"] for r in of(rows, "E1")) == {"Applicable to IaaS, PaaS and SaaS": 23, "Applicable to IaaS and PaaS": 2,
                                                                  "Applicable to PaaS and SaaS": 1}
    assert Counter(s["applicability"] for r in of(rows, "E1") for s in r["statements"]) == {
        "Applicable to IaaS, PaaS and SaaS": 34, "Applicable to IaaS and PaaS": 4, "Applicable to PaaS and SaaS": 1}


def test_mapped_controls_are_real_core_controls_in_print_order(rows, core):
    core_ids = {c["control_id"] for c in core["controls"] if not re.match(r"[EF]\d-", c["control_id"])}      # the catalog holds the F rows too
    for r in rows:
        ids = r["uae_ia_controls"]
        assert len(set(ids)) == len(ids) and set(ids) <= core_ids, (r["control_id"], sorted(set(ids) - core_ids))
        assert ids == list(dict.fromkeys(i for s in r["statements"] for i in s["uae_ia_controls"])), r["control_id"]
        for s in r["statements"]:
            assert bool(s["uae_ia_controls"]) != bool(s.get("printed_as")), (r["control_id"], s)      # mapped, or printed NA / N/A
            assert s.get("printed_as", "NA") in ("NA", "N/A")
    for annex, (distinct, references) in MAPPED.items():
        ids = [i for r in of(rows, annex) for i in r["uae_ia_controls"]]
        assert (len(set(ids)), len(ids)) == (distinct, references), annex
    assert sum(1 for r in of(rows, "E1") for s in r["statements"] if not s["uae_ia_controls"]) == 7
    assert sum(1 for r in of(rows, "E2") for s in r["statements"] if not s["uae_ia_controls"]) == 0
    assert sum(1 for r in of(rows, "E3") for s in r["statements"] if not s["uae_ia_controls"]) == 2


def test_printed_typos_in_the_mapping_cells_are_read_not_copied(rows):
    by_id = {r["control_id"]: r for r in rows}
    # 'T3.4.3.' is printed with a full stop twice in 2.3.2; 'T2.3.1' is printed twice in one cell of IoT 2.6.3
    assert by_id["E1-2.3.2"]["uae_ia_controls"] == ["T3.4.1", "T3.4.2", "T3.4.3"]
    assert all(s["uae_ia_controls"] == ["T3.4.1", "T3.4.2", "T3.4.3"] for s in by_id["E1-2.3.2"]["statements"])
    assert by_id["E3-2.6.3"]["uae_ia_controls"] == ["T2.3.1", "T3.1.8", "T5.3.3", "T3.3.2", "T7.4.3"]
    assert not any(i.endswith(".") or i != i.strip() for r in rows for i in r["uae_ia_controls"])
    # a row can map to some controls and print NA for another statement; NA is not a control
    assert [s.get("printed_as") for s in by_id["E3-2.6.2"]["statements"]] == [None, "N/A", "N/A"]
    assert by_id["E3-2.6.2"]["uae_ia_controls"] == ["T7.2.1", "T5.3.2"]
    assert [s.get("printed_as") for s in by_id["E1-2.4.1"]["statements"]] == ["NA", "NA", "NA"] and by_id["E1-2.4.1"]["uae_ia_controls"] == []
    assert by_id["E1-2.4.1"]["ai_notes"].endswith("Maps to UAE IA v2.1 controls: none (the annex prints NA).")
    assert by_id["E3-2.1.1"]["ai_notes"].endswith("Maps to UAE IA v2.1 controls: M1.1.3, M1.2.1, M1.2.3.")


def test_the_text_is_verbatim_with_its_bullets_and_headings(rows):
    by_id = {r["control_id"]: r for r in rows}
    t = by_id["E1-2.1.1"]["full_text"]
    assert t.startswith("The entity shall establish, implement, and regularly review a cloud security policy that addresses key aspects of "
                        "cloud security. When defining the information security policy for cloud computing, the cloud service customer "
                        "shall take the following into account:\n• information stored in the cloud computing environment can be subject")
    assert t.count("\n• ") == 6 and t.endswith("provider can store the cloud service customer data (even temporarily).")
    # statements of one sub-domain are separated by a blank line; a bold heading stays above its paragraph
    assert by_id["E1-2.3.2"]["full_text"].split("\n\n")[2].startswith("Partial Sovereign Cloud Requirements\nConsumers shall conduct a risk assessment")
    assert [len(r["full_text"].split("\n\n")) for r in rows] == [len(r["statements"]) for r in rows]
    # a nested '-' list sits under its bullet
    assert by_id["E1-2.5.2"]["full_text"].endswith("• Demonstrated commitment to data portability, covering:\n   - Duration of data storage"
                                                   "\n   - Data protection controls\n   - Data deletion processes")
    # hyphenated line breaks are repaired, the annex's own typos are kept
    assert "independent third-party testing" in by_id["E1-2.1.5"]["full_text"]
    assert "avoid retrofitting controls post-deployment" in by_id["E2-2.3"]["full_text"]
    assert "implemented with end-to-end security controls" in by_id["E3-2.6.2"]["full_text"]
    assert "devices at end-of-life" in by_id["E3-2.6.3"]["full_text"]
    assert "E-Discovery" in by_id["E1-2.8.1"]["category"]
    assert "throughout its’ lifecycle" in by_id["E1-2.3.1"]["full_text"] and "CSP’s include:" in by_id["E1-2.1.3"]["full_text"]
    assert by_id["E3-2.3.1"]["description"] == "Entity shall implement identity and access management controls to :"
    # no running header or footer, table caption, column heading or neighbouring cell leaked into a statement
    for r in rows:
        for text in (r["full_text"], r["description"], *r["obligations"]):
            assert not re.search(r"Document Classification|Table 1[0-2]\b|Policy (Sub-)?Domain|Applicable to|UAE IA Control|Annex E", text), r["control_id"]
            assert not re.search(r"\b[MT]\d+\.\d+\.\d+\b", text), r["control_id"]                    # a mapped id
        assert not any(re.fullmatch(r"\s*\d{1,3}\s*", line) for line in r["full_text"].split("\n")), r["control_id"]      # a page number
        assert r["full_text"].count("•") == sum(1 for line in r["full_text"].split("\n") if line.startswith("• ")), r["control_id"]
        assert r["full_text"] == r["full_text"].strip() and "  " not in r["full_text"].replace("\n   - ", "\n"), r["control_id"]


def test_description_is_the_first_sentence_of_the_first_statement(rows):
    for r in rows:
        flat = re.sub(r"\s+", " ", r["full_text"].replace("•", " ")).strip()
        assert flat.startswith(re.sub(r"\s+", " ", r["description"])), r["control_id"]
    # a lead-in too short to say anything takes its first bullet
    by_id = {r["control_id"]: r for r in rows}
    assert by_id["E3-2.2.1"]["description"] == "The entity shall: identify and classify data collected throughout the IoT ecosystem."
    assert by_id["E3-2.6.3"]["description"].startswith("Entity shall ensure that: IoT devices and sensors are securely installed")
    assert by_id["E2-2.1"]["description"].endswith("including:") and by_id["E1-2.2.1"]["description"].endswith("relevant requirements.")


def test_obligations_and_criteria_follow_the_rule(rows):
    for r in rows:
        considerations = [o for o in r["obligations"] if "take the following into account" in o]
        enumerated = [o for o in r["obligations"] if o not in considerations]
        assert r["assessment_criteria"] == (enumerated if len(enumerated) >= 2 else []), r["control_id"]
        assert all(o.strip() and o == o.strip() for o in r["obligations"])
    by_id = {r["control_id"]: r for r in rows}
    # 'take the following into account' bullets are considerations: 1 + 6 obligations, none of them criteria
    assert len(by_id["E1-2.1.1"]["obligations"]) == 7 and by_id["E1-2.1.1"]["assessment_criteria"] == []
    assert len(by_id["E3-2.1.1"]["obligations"]) == 4 and by_id["E3-2.1.1"]["assessment_criteria"] == []
    # a lead-in travels with each bullet; separate 'The entity shall ...' statements are separate obligations
    assert by_id["E1-2.1.3"]["assessment_criteria"][0] == ("The entity shall ensure contractual clauses with CSP’s include: "
                                                           "background screening of CSP personnel.")
    assert by_id["E1-2.2.1"]["assessment_criteria"][1] == "The entity shall ensure that a Non-Disclosure agreement is drafted and acknowledged by the CSP."
    assert by_id["E1-2.5.2"]["assessment_criteria"][1].endswith("covering: - Duration of data storage - Data protection controls - Data deletion processes")
    assert by_id["E1-2.3.2"]["assessment_criteria"][2].startswith("Consumers shall conduct a risk assessment")      # a whole three-sentence statement
    assert by_id["E3-2.1.4"]["obligations"][1] == "The entity shall include in the contracts: Non-disclosure agreements."
    # one sentence only, or nothing enumerated: no criteria
    assert by_id["E1-2.1.2"]["assessment_criteria"] == [] and by_id["E3-2.1.5"]["assessment_criteria"] == []
    assert sum(1 for r in rows if r["assessment_criteria"]) == 12 + 6 + 11 and sum(len(r["assessment_criteria"]) for r in rows) == 44 + 24 + 74


def test_the_rows_load_through_the_real_seeder_as_a_framework_of_their_own(rows, db, capsys):
    """Wrapped in a tiny framework JSON, as the loader reads every library."""
    from grc.seed_frameworks import seed_framework_from_json

    data = {"metadata": {"name": "UAE IA Annex E rows (test)", "version": "2.1", "classification": "regulatory", "framework_type": "regulatory",
                         "source_organization": "UAE Cyber Security Council (CSC)"}, "controls": rows}
    fw = seed_framework_from_json(db, data, tenant_id=1)
    db.commit()
    out = capsys.readouterr().out.lower()
    assert "truncat" not in out and "non-unique" not in out
    loaded = db.query(m.ParsedFrameworkControl).filter_by(uploaded_framework_id=fw.id).order_by(m.ParsedFrameworkControl.id).all()
    assert [r.control_id for r in loaded] == [r["control_id"] for r in rows]                       # document order kept
    for got, want in zip(loaded, rows):
        assert (got.original_reference, got.title, got.description, got.full_text) == (
            want["original_reference"], want["title"], want["description"], want["full_text"])
        assert (got.domain, got.category, got.section_number, got.parent_section) == (
            want["domain"], want["category"], want["section_number"], want["parent_section"])
        assert (got.is_mandatory, got.priority, got.priority_level) == (False, "medium", None)
        assert got.assessment_criteria == want["assessment_criteria"] and got.ai_notes == want["ai_notes"]
    first = loaded[0]
    assert (first.control_id, first.domain, first.category, first.parent_section) == (
        "E1-2.1.1", "E1 National Cloud Security Policy (Annex E)", "2.1 Cloud Governance", "E1-2.1")
    assert sum(len(r.assessment_criteria) for r in loaded) == 44 + 24 + 74


def test_the_rows_sit_beside_the_core_controls_in_one_framework(rows, core, db, capsys):
    """What the merge will be: the library's own controls and these rows in one controls list, through the same loader."""
    from grc.seed_frameworks import seed_framework_from_json

    own = [c for c in core["controls"] if re.fullmatch(r"[MT]\d\.\d\.\d+", c["control_id"])]       # the library's own 134, merged or not
    assert len(own) == 134
    fw = seed_framework_from_json(db, {"metadata": core["metadata"], "controls": own + rows}, tenant_id=1)
    db.commit()
    out = capsys.readouterr().out.lower()
    assert "truncat" not in out and "non-unique" not in out
    loaded = db.query(m.ParsedFrameworkControl).filter_by(uploaded_framework_id=fw.id).all()
    assert len(loaded) == 134 + 50 and len({r.control_id for r in loaded}) == 184
    assert {r.domain for r in loaded if r.control_id.startswith("E")} == set(DOMAINS.values())
    assert db.query(m.ControlEvidenceRequirement).filter_by(framework_id=fw.id).count() == sum(
        len(c["evidence_requirements"]) for c in own + rows)


def test_the_annex_is_not_a_framework_of_its_own():
    """Decision 2026-10-27: one framework. No slug, label, registry entry or catalog file for any of the three policies."""
    from grc import startup_seed
    from grc.modules.automation.router import _FW_LABELS as automation_labels
    from grc.modules.scf import registry

    slugs = {e["slug"] for e in registry._entries()}
    for slug in ("uae_cloud", "uae_ai", "uae_iot", "uae_national_cloud", "uae_national_ai", "uae_national_iot"):
        assert slug not in slugs and slug not in registry._FW_LABELS and slug not in automation_labels
    for name in ("UAE National Cloud Security Policy", "UAE National Cyber Security Policy for Artificial Intelligence",
                 "UAE National IoT Security Policy", "UAE IA Annex E"):
        assert registry.slug_for_framework(name) is None
    assert registry.slug_for_framework("UAE Information Assurance Standard") == "uae_ia"
    assert not list(FRAMEWORKS.glob("uae_national_*")) and [p.name for p in FRAMEWORKS.glob("uae*.json")] == ["uae_ia.json"]
    assert ROWS.parent == SEED and not (FRAMEWORKS / ROWS.name).exists()           # the loader globs frameworks/*.json, not seed_data/
    assert not any(name.startswith("UAE National") or "Annex E" in name for name in startup_seed._seed_framework_catalog())


def test_the_builder_repairs_wrapped_lines_and_the_annexs_printed_typos():
    from grc.tools import build_uae_ia_annex_e_rows as b

    def line(raw, ind=5.6, base=0.0, marker=None, bold=False, page=1):
        e = b.Entry(page, 200 + ind, 300.0, base - 9, base + 2, base, 9.0, bold, False, marker, raw)
        e.ind = ind
        return e

    assert b.join([line("validating independent third-"), line("party testing")]) == "validating independent third-party testing"
    assert b.join([line("low likelihood- "), line("risks).")]) == "low likelihood- risks)."      # a hyphen and a space in the print stay
    repairs: list = []
    known = {"T3.4.1", "T3.4.3", "T2.3.1", "M5.1.4"}
    assert b.clean_ids(["T3.4.1", "T3.4.3."], "x", known, repairs) == (["T3.4.1", "T3.4.3"], "")
    assert b.clean_ids(["T2.3.1", "T2.3.1", "M5.1.4"], "y", known, repairs) == (["T2.3.1", "M5.1.4"], "")
    assert b.clean_ids(["N/A"], "z", known, repairs) == ([], "N/A") and b.clean_ids(["NA"], "z", known, repairs) == ([], "NA")
    assert [r.split(":")[1].strip() for r in repairs] == ["printed 'T3.4.3.', read as 'T3.4.3'", "T2.3.1 is printed twice in one cell, kept once"]
    with pytest.raises(SystemExit):                                                    # an id that is not a control of the standard
        b.clean_ids(["T9.9.9"], "w", known, [])
    # a flush-left line continues its paragraph; a bullet takes its indented lines; a bold line is a heading
    blocks = b.blocks_of([line("Partial Sovereign Cloud Requirements", bold=True, base=0), line("Consumers shall:", base=12),
                          line("", marker="bullet", base=24), line("do a thing", ind=23.6, base=24), line("on two lines", ind=23.6, base=36),
                          line("", marker="bullet", base=48), line("do b", ind=23.6, base=48),
                          line("", marker="dash", ind=23.6, base=60), line("part", ind=40.9, base=60)])
    assert [(x["kind"], x["text"], x["sub_texts"]) for x in blocks] == [
        ("heading", "Partial Sovereign Cloud Requirements", []), ("para", "Consumers shall:", []),
        ("bullet", "do a thing on two lines", []), ("bullet", "do b", ["part"])]
    assert b.statement_text(blocks) == ("Partial Sovereign Cloud Requirements\nConsumers shall:\n• do a thing on two lines\n• do b\n   - part")
    assert b.obligations_of(blocks) == [("Consumers shall: do a thing on two lines", False), ("Consumers shall: do b - part", False)]
    assert b.first_sentence(blocks) == "Consumers shall: do a thing on two lines"                  # a lead-in under 40 characters takes its first bullet
    # whole sentences before a lead-in are obligations of their own; 'take the following into account' bullets are considerations
    blocks = b.blocks_of([line("The entity shall keep a policy. When defining it, the entity shall take the following into account:"),
                          line("", marker="bullet", base=12), line("size", ind=23.6, base=12)])
    assert b.obligations_of(blocks) == [("The entity shall keep a policy.", False),
                                        ("When defining it, the entity shall take the following into account: size", True)]
    assert b.criteria_of({"obligations": b.obligations_of(blocks)}) == []                       # one enumerated obligation is not an enumeration
    assert b.criteria_of({"obligations": [("a", False), ("b", False), ("c", True)]}) == ["a", "b"]
    with pytest.raises(SystemExit):                                                    # a lead-in that does not end with a colon
        b.obligations_of(b.blocks_of([line("The entity shall do these"), line("", marker="bullet", base=12), line("one", ind=23.6, base=12)]))
    with pytest.raises(SystemExit):                                                    # a bullet with no lead-in above it
        b.obligations_of(b.blocks_of([line("", marker="bullet", base=12), line("one", ind=23.6, base=12)]))


def test_the_builder_stops_when_the_parse_shows_a_gap_or_the_two_passes_disagree():
    from grc.tools import build_uae_ia_annex_e_rows as b

    cloud, ai = b.POLICIES[0], b.POLICIES[1]
    control = lambda number, domain="2.1": {"number": number, "domain": (domain, "x"), "statements": []}      # noqa: E731
    b.check_numbering(cloud, [control("2.1.1"), control("2.1.2"), control("2.2.1", "2.2")])
    b.check_numbering(ai, [control("2.1", "2."), control("2.2", "2.")])
    for bad in ([control("2.1.1"), control("2.1.3")],                          # a lost control
                [control("2.1.2")],                                            # does not start at 1
                [control("2.1.1"), control("2.3.1", "2.3")],                   # a lost domain
                [control("2.1.1", "2.2")]):                                    # under the wrong domain
        with pytest.raises(SystemExit):
            b.check_numbering(cloud, bad)
    st = lambda *tokens: {"mapped": list(tokens), "pages": [1], "entries": [], "applic": "Applicable to X"}  # noqa: E731
    raw = [{"number": "2.1.1", "statements": [st("M1.1.1", "T3.4.3.")]}, {"number": "2.1.2", "statements": [st("NA"), st("NA")]}]
    flat = [{"number": "2.1.1", "mapped": ["M1.1.1", "T3.4.3."], "applic": 1}, {"number": "2.1.2", "mapped": ["NA", "NA"], "applic": 2}]
    b.cross_check(cloud, raw, flat)
    for bad in ([{**flat[0], "mapped": ["M1.1.1"]}, flat[1]],                  # the text pass finds fewer ids
                [flat[0], {**flat[1], "applic": 1}],                           # a statement the text pass does not see
                [flat[0]]):                                                    # a control the text pass does not see
        with pytest.raises(SystemExit):
            b.cross_check(cloud, raw, bad)
