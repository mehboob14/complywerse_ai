"""UAE Information Assurance Standard v2.1, Annex F: the four national security policies as extra rows of the UAE IA library.

The staging file (seed_data/uae_ia_annex_f_rows.json, built from the standard's PDF by grc/tools/build_uae_ia_annex_f_rows.py)
holds one row per numbered section (sub-domain) of a policy, in the shape of the library's own rows and of the Annex E rows:
F1 = Table 13 National Encryption Policy, F2 = Table 14 National Secure Remote Work Policy, F3 = Table 15 National Third Party
Security Policy, F4 = Table 16 National Data Exchange Security Policy. The annex prints no totals; the oracle is the number of
sub-domains per section (21, 12, 24 and 21 rows, 78 in all), the literals below were typed from the PDF and are what the build's
layout parse and its independent flat-text pass agreed on. The seeder does not read the staging file, and the annex is deliberately
not a framework of its own. Most of this runs without the PDF (on in-memory SQLite); the tests that rebuild the rows from the PDF,
or read its text, run when the PDF is found (UAE_IA_PDF, or ~/Downloads/UAE INFORMATION ASSURANCE STANDARD.pdf) and is the edition
the rows were built from, and are skipped otherwise.
"""
import hashlib
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
ROWS = SEED / "uae_ia_annex_f_rows.json"
LAYER = SEED / "uae_ia_annex_f_evidence.json"
E_ROWS = SEED / "uae_ia_annex_e_rows.json"
CORE = FRAMEWORKS / "uae_ia.json"
PDF_NAME = "UAE INFORMATION ASSURANCE STANDARD.pdf"

DOMAINS = {"F1": "F1 National Encryption Policy mapping (Annex F)",
           "F2": "F2 National Secure Remote Work Policy mapping (Annex F)",
           "F3": "F3 National Third Party Security Policy mapping (Annex F)",
           "F4": "F4 National Data Exchange Security Policy mapping (Annex F)"}
HEADINGS = {"F1": "National Encryption Policy", "F2": "National Secure Remote Work Policy",
            "F3": "National Third Party Security Policy", "F4": "National Data Exchange Security Policy"}
TABLES = {"F1": 13, "F2": 14, "F3": 15, "F4": 16}
# the oracle: rows per annex = sub-domains per section, in print order
PER_SECTION = {"F1": [("2. Governance", 4), ("3. Data at Rest", 6), ("4. Data in Motion", 3), ("5. Key Management", 7),
                      ("6. Post Quantum Cryptography", 1)],
               "F2": [("2. Governance", 3), ("3. Organization Remote Access security", 3), ("4. Client Device Security", 3),
                      ("5. Data Security during Remote work", 3)],
               "F3": [("2. Governance", 2), ("3. Risk Management", 4), ("4. Supplier Assessment", 2),
                      ("5. Software and Hardware Supply chain", 6), ("6. Contracts and Legal", 3), ("7. Monitoring and Audit", 3),
                      ("8. Supply Chain Resilience", 4)],
               "F4": [("2. Governance", 5), ("3. Identity and Access Management", 3), ("4. Cryptographic Controls", 1),
                      ("5. Network Security", 7), ("6. System Hardening and Security Assessment", 3), ("7. Logging and Monitoring", 2)]}
TOTALS = {"F1": 21, "F2": 12, "F3": 24, "F4": 21}
# sub-domain names as printed (typed from the PDF, line wraps closed), in print order
TITLES = {
    "F1": ["General Requirements", "Risk Management", "Compliance", "Data Classification and Handling",
           "General Requirements", "Laptop and Desktop computers", "Mobile Devices", "Portable Storage Media", "Database",
           "System / User credentials", "General Requirements", "Email Encryption", "Network Encryption",
           "General Requirements", "Key generation", "Key Distribution", "Key Storage", "Key Recovery", "Key Disposal",
           "Key Archival", "General Requirements"],
    "F2": ["Policies & Procedures", "Risk Management", "Training and Awareness", "Secure Remote Access Methods",
           "Authentication and Authorization", "Remote Access Lifecycle", "Organization device security", "Mobile Device Security",
           "Third Party & BYOD Devices", "Data Residency & Sovereignty", "Secure Data transfer methods", "Regulatory Compliance"],
    "F3": ["General Requirements", "Training and Awareness", "Identification of Suppliers", "Classification of Suppliers",
           "Risk Identification", "Risk Mitigation and Monitoring", "Supplier Evaluation and Selection Criteria",
           "Supplier Cyber Security Posture Due Diligence and Verification", "Requirements Definition", "Product Evaluation",
           "Acceptance and Testing", "Upgrades & Maintenance", "End of Life", "Considerations for Internally Developed Software",
           "Supplier Cyber-Posture Requirements", "Contracts & Agreements", "Compliance Requirements", "Continuous Monitoring",
           "Logging, Auditing and Accountability", "High Risk Supplier Considerations", "Incident Response", "Alternate Suppliers",
           "Business Continuity Management & Disaster Recovery", "IR/BCM/DR Collaboration"],
    "F4": ["General Requirements", "Risk Management", "Compliance", "Data Classification and Handling",
           "Data Privacy Considerations for Data Exchange", "Authentication", "Authorization", "Accounting", "Encryption",
           "Redundant Network Infrastructure", "Firewall Protection", "VPN Access", "DMZ Configurations",
           "Secure Communication Protocols", "Intrusion Detection and Prevention", "Data Loss Prevention", "System Hardening",
           "Secure Configuration Reviews", "Security Assessments", "Audit Logging", "Monitoring and Analysis"]}
# PDF page of the first line of each row, per annex, as (first row number, page): the table breaks pages where the print does
PAGE_FROM = {"F1": [("2.1", 218), ("5.2", 219)], "F2": [("2.1", 220), ("4.1", 221)], "F3": [("2.1", 222), ("5.6", 223)],
             "F4": [("2.1", 224), ("5.2", 225)]}
TABLE_PAGES = {"F1": (218, 219), "F2": (220, 221), "F3": (222, 223), "F4": (224, 225)}
# UAE IA v2.1 controls the sub-domains map to: (distinct, references) per annex, references = sum over rows (a repeat inside a row counts once)
MAPPED = {"F1": (20, 35), "F2": (42, 53), "F3": (31, 47), "F4": (36, 43)}
# the keys of an Annex E row, in order: Annex F rows are treated alike by the merge
E_KEYS = ["control_id", "original_reference", "title", "description", "full_text", "domain", "category", "section_number",
          "parent_section", "is_mandatory", "priority", "assessment_criteria", "ai_notes", "evidence_requirements", "priority_tier",
          "applicability", "annex", "uae_ia_controls", "statements", "obligations", "pdf_page"]
# what the build reports as printed typos (and the one hyphenated line break) it kept out of the data, in print order
REPAIRS = (
    [f"F1 5.{k}: printed 'T.3.4.3', read as 'T3.4.3'" for k in range(1, 8)]
    + ["F2 3.3: T5.2.2 is printed twice in one cell, kept once",
       "F3 2.2: the Objective breaks 'third-party' over two lines, joined",
       "F3 8.1: printed 'T.8.2.1', read as 'T8.2.1'", "F3 8.1: printed 'T.8.2.3', read as 'T8.2.3'",
       "F3 8.1: printed 'T.8.2.6', read as 'T8.2.6'",
       "F3 8.3: 'T9.1.1 T9.1.2' is printed on one line, read as 2 ids", "F3 8.4: 'T9.1.1 T9.1.2' is printed on one line, read as 2 ids",
       "F4 5.1: printed 'T.4.1.1', read as 'T4.1.1'", "F4 5.2: printed 'T.4.1.1', read as 'T4.1.1'",
       "F4 5.3: printed 'T.5.3.3', read as 'T5.3.3'", "F4 5.5: printed 'T.4.1.1', read as 'T4.1.1'",
       "F4 5.6: printed 'T.4.1.1', read as 'T4.1.1'", "F4 5.7: printed 'T.1.3.4', read as 'T1.3.4'"])


@pytest.fixture(scope="module")
def rows():
    return json.loads(ROWS.read_text(encoding="utf-8"))["controls"]


@pytest.fixture(scope="module")
def payload():
    return json.loads(ROWS.read_text(encoding="utf-8"))


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


@pytest.fixture(scope="module")
def pdf(payload):
    """The standard's PDF, when it is on this machine and is the edition the rows were built from."""
    pytest.importorskip("fitz")
    path = Path(os.environ.get("UAE_IA_PDF") or Path.home() / "Downloads" / PDF_NAME)
    if not path.is_file():
        pytest.skip(f"the standard's PDF is not at {path} (set UAE_IA_PDF)")
    if hashlib.sha256(path.read_bytes()).hexdigest() != payload["source_pdf_sha256"]:
        pytest.skip(f"{path} is not the edition the rows were built from")
    return path


@pytest.fixture(scope="module")
def built(pdf):
    """What the builder makes of the PDF and the evidence layer: (payload, repairs)."""
    from grc.tools import build_uae_ia_annex_f_rows as b
    return b.build(pdf, LAYER)


def of(rows, annex):
    return [r for r in rows if r["annex"] == annex]


def core_ids(core):
    return {c["control_id"] for c in core["controls"] if not re.match(r"[EF]\d-", c["control_id"])}


def test_the_staging_file_has_the_oracle_totals(rows, payload):
    assert len(rows) == 78 == len({r["control_id"] for r in rows}) == sum(TOTALS.values())
    for annex, total in TOTALS.items():
        mine = of(rows, annex)
        assert len(mine) == total == sum(n for _, n in PER_SECTION[annex]), annex
        assert list(Counter(r["category"] for r in mine).items()) == PER_SECTION[annex], annex        # in document order
        assert [r["title"] for r in mine] == TITLES[annex], annex
        assert all(len(r["statements"]) == 1 and len(r["obligations"]) == 1 for r in mine), annex
        assert all(r["assessment_criteria"] == [] for r in mine), annex
    assert [r["annex"] for r in rows] == ["F1"] * 21 + ["F2"] * 12 + ["F3"] * 24 + ["F4"] * 21        # Table 13, 14, 15, 16
    assert list(payload) == ["about", "standard", "version", "source", "source_pdf_sha256", "controls"]
    assert payload["version"] == "2.1" and re.fullmatch(r"[0-9a-f]{64}", payload["source_pdf_sha256"])


def test_ids_follow_the_scheme_and_do_not_meet_the_core_ids_or_annex_e(rows, core):
    ids = core_ids(core)
    assert len(ids) == 134
    e_ids = {r["control_id"] for r in json.loads(E_ROWS.read_text(encoding="utf-8"))["controls"]} if E_ROWS.exists() else set()
    for r in rows:
        number = r["original_reference"]
        assert r["control_id"] == f"{r['annex']}-{number}" and re.fullmatch(r"F[1-4]-[2-8]\.[1-7]", r["control_id"]), r["control_id"]
        assert r["control_id"] not in ids and r["control_id"] not in e_ids
        # the framework page groups by the leading integer of a code: a letter first keeps these out of one big section "2"
        assert not re.match(r"\s*\d", r["control_id"])
        assert r["section_number"] == r["control_id"]
        assert r["domain"] == DOMAINS[r["annex"]] and len(r["domain"]) <= 100
        section = r["category"].split()[0]
        assert number.split(".")[0] == section.rstrip(".") and r["parent_section"] == f"{r['annex']}-{section.rstrip('.')}"
    # the policies' own numbering: 2.1 ... 2.n, 3.1 ... in order, no gap
    for annex, sections in PER_SECTION.items():
        want = [f"{s}.{k}" for s, (_, n) in enumerate(sections, start=2) for k in range(1, n + 1)]
        assert [r["original_reference"] for r in of(rows, annex)] == want, annex
    assert rows[0]["control_id"] == "F1-2.1" and rows[-1]["control_id"] == "F4-7.2"


def test_every_row_has_the_librarys_shape_and_fits_the_seeder_columns(rows, payload):
    if E_ROWS.exists():
        e = json.loads(E_ROWS.read_text(encoding="utf-8"))
        assert list(e["controls"][0]) == E_KEYS and list(e) == list(payload)      # the Annex E file still has the keys this test copies
    for r in rows:
        cid = r["control_id"]
        assert list(r) == E_KEYS, cid                # the same keys as an Annex E row, so the merge treats both alike
        assert r["title"] and r["description"] and r["full_text"], cid
        assert len(cid) <= 100 and len(r["title"]) <= 500 and len(r["domain"]) <= 100 and len(r["category"]) <= 100, cid
        assert len(r["section_number"]) <= 50 and len(r["priority"]) <= 20 and len(r["parent_section"]) <= 255, cid
        # the annex states no duty and no priority
        assert r["is_mandatory"] is False and r["priority"] == "medium" and r["priority_tier"] is None, cid
        assert "priority_level" not in r                        # would switch the framework page into NDMO's "3-year roadmap" view
        assert 1 <= len(r["evidence_requirements"]) <= 3, cid
        assert r["applicability"] == f"Mapping of the {HEADINGS[r['annex']]} to UAE IA v2.1 controls", cid
        ids = r["uae_ia_controls"]
        page = r["pdf_page"]
        assert page in range(218, 226) and r["statements"][0]["pdf_pages"][0] == page, cid
        assert r["statements"] == [{"pdf_pages": r["statements"][0]["pdf_pages"], "uae_ia_controls": ids}], cid
        assert r["ai_notes"] == (f"Source: UAE IA v2.1 (November 2025), Annex F, Table {TABLES[r['annex']]} ({HEADINGS[r['annex']]}), "
                                 f"printed page {page - 4}. Maps to UAE IA v2.1 controls: {', '.join(ids)}."), cid
        assert r["full_text"] == f"{r['description']}\nMapped UAE IA v2.1 controls: {', '.join(ids)}", cid
        assert r["obligations"] == [r["description"]] and r["assessment_criteria"] == [], cid
        assert "scf" not in r["ai_notes"].lower() and "applicab" not in r["ai_notes"].lower(), cid
    # the page each row starts on follows the print; only 3.3 of Table 14 runs over a page break
    for annex, breaks in PAGE_FROM.items():
        mine = of(rows, annex)
        for k, (number, page) in enumerate(breaks):
            end = next((n for n, _ in breaks[k + 1:]), None)
            span = [r for r in mine if r["original_reference"] >= number and (end is None or r["original_reference"] < end)]
            assert span and {r["pdf_page"] for r in span} == {page}, (annex, number)
    assert [(r["control_id"], r["statements"][0]["pdf_pages"]) for r in rows if len(r["statements"][0]["pdf_pages"]) > 1] == [
        ("F2-3.3", [220, 221])]


def test_mapped_controls_are_real_core_controls_in_print_order(rows, core):
    ids_in_core = core_ids(core)
    for r in rows:
        ids = r["uae_ia_controls"]
        assert ids and len(set(ids)) == len(ids) and set(ids) <= ids_in_core, (r["control_id"], sorted(set(ids) - ids_in_core))
        assert ids == r["statements"][0]["uae_ia_controls"], r["control_id"]
    for annex, (distinct, references) in MAPPED.items():
        ids = [i for r in of(rows, annex) for i in r["uae_ia_controls"]]
        assert (len(set(ids)), len(ids)) == (distinct, references), annex
    assert sum(len(r["uae_ia_controls"]) for r in rows) == 178
    assert len({i for r in rows for i in r["uae_ia_controls"]}) == 78


def test_printed_typos_in_the_mapping_cells_are_read_not_copied(rows):
    by_id = {r["control_id"]: r for r in rows}
    ids = lambda cid: by_id[cid]["uae_ia_controls"]                       # noqa: E731
    # 'T.3.4.3' is printed with a full stop after the letter in every row of the key management section
    assert [ids(f"F1-5.{k}") for k in range(1, 8)] == [["T3.4.3"]] * 7
    # 'T.8.2.1', 'T.8.2.3', 'T.8.2.6' in 8.1; 'T9.1.1 T9.1.2' printed on one line in 8.3 and 8.4
    assert ids("F3-8.1") == ["T8.1.1", "T8.1.2", "T8.2.1", "T8.2.2", "T8.2.3", "T8.2.4", "T8.2.5", "T8.2.6"]
    assert ids("F3-8.3") == ids("F3-8.4") == ["T9.1.1", "T9.1.2", "T9.2.1"]
    assert (ids("F4-5.1"), ids("F4-5.2"), ids("F4-5.3"), ids("F4-5.5"), ids("F4-5.6"), ids("F4-5.7")) == (
        ["T4.1.1", "T4.1.2"], ["T4.1.1", "T4.1.2"], ["T5.3.3"], ["T1.3.4", "T4.1.1"], ["T4.1.1"], ["T1.3.4"])
    # a mapping cell the page break cut goes on at the top of the next page, and T5.2.2 is printed in it twice
    assert ids("F2-3.3") == ["M4.1.1", "T1.2.2", "T5.2.4", "T5.2.2", "M4.3.2", "T1.3.6", "T1.2.1"]
    assert by_id["F2-3.3"]["ai_notes"].endswith("Maps to UAE IA v2.1 controls: M4.1.1, T1.2.2, T5.2.4, T5.2.2, M4.3.2, T1.3.6, T1.2.1.")
    assert not any(i.endswith(".") or i != i.strip() or not re.fullmatch(r"[MT]\d\.\d\.\d+", i) for r in rows for i in r["uae_ia_controls"])
    # ids kept in print order: the order of the standard's own cell, not sorted
    assert ids("F2-3.1") == ["T3.1.1", "T7.2.2", "T4.1.1", "T5.3.3", "T3.2.2", "T3.3.2"] and ids("F1-3.1") == ["T3.4.2", "T3.3.2"]


def test_the_text_is_the_objective_verbatim_with_the_mapped_controls_on_the_next_line(rows):
    by_id = {r["control_id"]: r for r in rows}
    # line wraps are closed; a hyphenated word broken over two lines is closed without a space; the annex's own wording is kept
    assert by_id["F3-2.2"]["description"] == ("To ensure all relevant employees are sufficiently aware of third-party cyber security risks "
                                              "and how to mitigate them.")
    assert by_id["F1-2.1"]["description"] == ("To establish the necessary policies and governance to initiate and support the "
                                              "implementation of encryption requirements.")
    assert by_id["F1-6.1"]["description"] == ("To ensure that entities are prepared to protect their non-open information against "
                                              "future threat posed by quantum computers.")
    assert by_id["F2-3.1"]["description"].startswith("To ensure a secure remote access environment by adopting a Zero Trust approach, ")
    assert by_id["F2-3.1"]["description"].endswith("establishing effective monitoring and auditing mechanisms.")
    assert by_id["F3-4.2"]["title"] == "Supplier Cyber Security Posture Due Diligence and Verification"          # five printed lines
    assert by_id["F2-3.2"]["title"] == "Authentication and Authorization"                  # the number alone on the first printed line
    assert by_id["F4-3.1"]["title"] == "Authentication" and by_id["F3-5.6"]["title"] == "Considerations for Internally Developed Software"
    # the apostrophe is the one the print has, per row; no full stop is added where the print has none
    assert "entity’s overall risk management program." in by_id["F2-2.2"]["description"]
    assert "organization's security requirements." in by_id["F3-5.3"]["description"]
    assert not by_id["F1-3.1"]["description"].endswith(".") and not by_id["F4-2.3"]["description"].endswith(".")
    assert by_id["F4-6.1"]["description"] == by_id["F4-6.2"]["description"]            # two rows share one printed Objective
    assert "Zero Trust" in by_id["F2-3.1"]["description"] and by_id["F2-5.2"]["description"].endswith("during transfer.")
    # the section cell can wrap over several lines and goes on, empty, on the next page
    assert by_id["F1-6.1"]["category"] == "6. Post Quantum Cryptography" and by_id["F1-5.7"]["category"] == "5. Key Management"
    assert by_id["F2-3.3"]["category"] == "3. Organization Remote Access security"
    assert by_id["F3-5.6"]["category"] == "5. Software and Hardware Supply chain"           # started on the page before
    assert by_id["F4-5.2"]["category"] == "5. Network Security"
    # no running header or footer, table caption, column heading or neighbouring cell leaked into a field
    for r in rows:
        for text in (r["description"], r["title"], r["category"], r["full_text"].split("\n")[0]):
            assert not re.search(r"Document Classification|Table 1[3-6]\b|Policy (Sub[- ])?Domain|Sub section|UAE IA|Annex F|control mapping", text), r["control_id"]
            assert not re.search(r"\b[MT]\d+\.\d+\.\d+\b", text), r["control_id"]               # a mapped id
            assert text == text.strip() and "  " not in text and "\n" not in text, r["control_id"]
        assert not re.fullmatch(r"\s*\d{1,3}\s*", r["description"]) and r["description"][0] == "T", r["control_id"]   # every Objective starts "To ..."
        assert r["full_text"].count("\n") == 1


def test_printed_typos_are_not_in_any_field(rows):
    for r in rows:
        blob = json.dumps(r, ensure_ascii=False)
        assert not re.search(r"\b[MT]\.\d", blob), r["control_id"]                         # "T.3.4.3"
        assert "  " not in blob.replace("\\n", " "), r["control_id"]                        # a double blank is a wrap or a trailing space kept


def test_the_rows_load_through_the_real_seeder_as_a_framework_of_their_own(rows, db, capsys):
    """Wrapped in a tiny framework JSON, as the loader reads every library."""
    from grc.seed_frameworks import seed_framework_from_json

    data = {"metadata": {"name": "UAE IA Annex F rows (test)", "version": "2.1", "classification": "regulatory", "framework_type": "regulatory",
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
        assert got.assessment_criteria == [] and got.ai_notes == want["ai_notes"]
    first = loaded[0]
    assert (first.control_id, first.domain, first.category, first.parent_section) == (
        "F1-2.1", "F1 National Encryption Policy mapping (Annex F)", "2. Governance", "F1-2")


def test_the_rows_sit_beside_the_core_controls_in_one_framework(rows, core, db, capsys):
    """What the merge will be: the library's own controls, the Annex E rows when they are there, and these rows in one controls
    list, through the same loader."""
    from grc.seed_frameworks import seed_framework_from_json

    own = [c for c in core["controls"] if re.fullmatch(r"[MT]\d\.\d\.\d+", c["control_id"])]       # the library's own 134, merged or not
    e_rows = json.loads(E_ROWS.read_text(encoding="utf-8"))["controls"] if E_ROWS.exists() else []
    assert len(own) == 134
    fw = seed_framework_from_json(db, {"metadata": core["metadata"], "controls": own + e_rows + rows}, tenant_id=1)
    db.commit()
    out = capsys.readouterr().out.lower()
    assert "truncat" not in out and "non-unique" not in out                  # the control ids of the three groups never meet
    loaded = db.query(m.ParsedFrameworkControl).filter_by(uploaded_framework_id=fw.id).all()
    assert len(loaded) == 134 + len(e_rows) + 78 and len({r.control_id for r in loaded}) == len(loaded)
    assert {r.domain for r in loaded if r.control_id.startswith("F")} == set(DOMAINS.values())
    assert db.query(m.ControlEvidenceRequirement).filter_by(framework_id=fw.id).count() == sum(
        len(c["evidence_requirements"]) for c in own + e_rows + rows)


def test_the_annex_is_not_a_framework_of_its_own():
    """Decision 2026-10-27: one framework. No slug, label, registry entry or catalog file for any of the four policies."""
    from grc import startup_seed
    from grc.modules.automation.router import _FW_LABELS as automation_labels
    from grc.modules.scf import registry

    slugs = {e["slug"] for e in registry._entries()}
    for slug in ("uae_encryption", "uae_remote_work", "uae_third_party", "uae_data_exchange", "uae_national_encryption",
                 "uae_national_remote_work", "uae_national_third_party", "uae_national_data_exchange"):
        assert slug not in slugs and slug not in registry._FW_LABELS and slug not in automation_labels
    for name in ("UAE National Encryption Policy", "UAE National Secure Remote Work Policy", "UAE National Third Party Security Policy",
                 "UAE National Data Exchange Security Policy", "UAE IA Annex F"):
        assert registry.slug_for_framework(name) is None
    assert registry.slug_for_framework("UAE Information Assurance Standard") == "uae_ia"
    assert not list(FRAMEWORKS.glob("uae_national_*")) and [p.name for p in FRAMEWORKS.glob("uae*.json")] == ["uae_ia.json"]
    assert ROWS.parent == SEED and not (FRAMEWORKS / ROWS.name).exists()           # the loader globs frameworks/*.json, not seed_data/
    assert not any(name.startswith("UAE National") or "Annex F" in name for name in startup_seed._seed_framework_catalog())


# ── the builder ──────────────────────────────────────────────────────────────────────────────────

def line(raw, base=0.0, page=1, x=200.0, white=False, bold=False):
    from grc.tools import build_uae_ia_annex_f_rows as b
    return b.Entry(page, x, base - 9, base + 2, base, 9.0, bold, white, raw)


def test_the_builder_repairs_wrapped_lines_and_the_annexs_printed_typos():
    from grc.tools import build_uae_ia_annex_f_rows as b

    joined: list = []
    assert b.join([line("sufficiently aware of third-"), line("party cyber security risks", 12)], joined) == (
        "sufficiently aware of third-party cyber security risks")
    assert joined == ["third-party"]
    assert b.join([line("low likelihood- "), line("risks).", 12)]) == "low likelihood- risks)."      # a hyphen and a space in the print stay
    assert b.join([line("3.2"), line("Authentication ", 12), line("and", 24)]) == "3.2 Authentication and"
    assert b.split_number("2. Governance") == ("2.", "Governance") and b.split_number("5.1 Key Storage") == ("5.1", "Key Storage")
    with pytest.raises(SystemExit):
        b.split_number("Governance")
    assert b.normalized("a third-\nparty  risk\nand more ") == "a third-party risk and more"
    repairs: list = []
    known = {"T3.4.1", "T3.4.3", "T2.3.1", "M5.1.4", "T9.1.1", "T9.1.2"}
    assert b.clean_ids(["T3.4.1", "T.3.4.3"], "x", known, repairs) == ["T3.4.1", "T3.4.3"]                # a full stop after the letter
    assert b.clean_ids(["T3.4.3."], "x", known, repairs) == ["T3.4.3"]                                     # or at the end
    assert b.clean_ids(["T2.3.1", "T2.3.1", "M5.1.4"], "y", known, repairs) == ["T2.3.1", "M5.1.4"]       # printed twice in one cell
    assert b.clean_ids(["T9.1.1 ", " T9.1.2"], "z", known, repairs) == ["T9.1.1", "T9.1.2"]                # trailing spaces
    assert [r.split(": ", 1)[1] for r in repairs] == ["printed 'T.3.4.3', read as 'T3.4.3'", "printed 'T3.4.3.', read as 'T3.4.3'",
                                                      "T2.3.1 is printed twice in one cell, kept once"]
    with pytest.raises(SystemExit):                                                    # an id that is not a control of the standard
        b.clean_ids(["T9.9.9"], "w", known, [])
    with pytest.raises(SystemExit):                                                    # a typo it does not know how to read
        b.clean_ids(["T3,4.3"], "w", known, [])


def test_the_builder_stops_when_the_parse_shows_a_gap_or_the_two_passes_disagree():
    from grc.tools import build_uae_ia_annex_f_rows as b

    policy = {"annex": "FX", "sections": {2: 2, 3: 1}}
    row = lambda number, section="2.": {"number": number, "section": (section, "x"), "ids": [], "obj": [], "name": "n", "page": 1}      # noqa: E731
    good = [row("2.1"), row("2.2"), row("3.1", "3.")]
    b.check_numbering(policy, good)
    for bad in (good[:1] + good[2:],                                # a lost row
                good + [row("3.2", "3.")],                          # a row made up
                [good[1], good[0], good[2]],                        # out of order
                [row("2.1"), row("2.2"), row("3.1", "2.")],         # under the wrong section
                good[:2]):                                          # a lost section
        with pytest.raises(SystemExit):
            b.check_numbering(policy, bad)
    id_line = lambda text: line(text)                                # noqa: E731
    raw = [{"number": "2.1", "name": "General Requirements", "page": 1, "section": ("2.", "Governance"), "obj": [id_line("To do it.")],
            "ids": [id_line("T3.4.1"), id_line("T.3.4.3")]},
           {"number": "2.2", "name": "Key", "page": 1, "section": ("2.", "Governance"), "obj": [id_line("To keep it")],
            "ids": [id_line("T9.1.1 T9.1.2")]}]
    page = b.normalized("2. Governance\n2.1 General \nRequirements\nTo do it.\nT3.4.1\nT.3.4.3\n2.2 Key\nTo keep it\nT9.1.1 T9.1.2\n")
    flat = (["2"], [{"number": "2.1", "tokens": ["T3.4.1", "T.3.4.3"]}, {"number": "2.2", "tokens": ["T9.1.1", "T9.1.2"]}])
    b.cross_check(policy, raw, flat, {1: page})
    for bad in ((["2"], [flat[1][0], {**flat[1][1], "tokens": ["T9.1.1"]}]),                      # the text pass finds fewer ids
                (["2"], [{**flat[1][0], "tokens": ["T3.4.1"]}, flat[1][1]]),                      # ... or another token
                (["2"], flat[1][:1]),                                                             # a row the text pass does not see
                (["2", "3"], flat[1]),                                                            # a section it sees and the layout does not
                (["2"], [{**flat[1][0], "number": "2.9"}, flat[1][1]])):                          # a different number
        with pytest.raises(SystemExit):
            b.cross_check(policy, raw, bad, {1: page})
    with pytest.raises(SystemExit):                                                               # an Objective the page text does not hold
        b.cross_check(policy, raw, flat, {1: b.normalized("2.1 General Requirements\nTo do something else.\n")})


def test_the_builder_cli_shape(tmp_path):
    from grc.tools import build_uae_ia_annex_f_rows as b

    with pytest.raises(SystemExit):                                  # the PDF and the output file are required
        b.main([])
    assert b.POLICIES[0]["domain"] == DOMAINS["F1"] and [p["annex"] for p in b.POLICIES] == ["F1", "F2", "F3", "F4"]
    assert sum(sum(p["sections"].values()) for p in b.POLICIES) == b.EXPECT_TOTAL == 78
    assert (b.SEED / "uae_ia_annex_f_evidence.json") == LAYER and ROWS.name == "uae_ia_annex_f_rows.json"


# ── against the standard's PDF (skipped without it) ──────────────────────────────────────────────

def test_the_rows_are_what_the_builder_makes_of_the_pdf_and_the_layer(pdf, built, tmp_path):
    """Round trip: the committed staging file is byte for byte what the PDF and the evidence layer build, and --check says so."""
    from grc.tools import build_uae_ia_annex_f_rows as b

    payload, _ = built
    assert b.render(payload) == ROWS.read_bytes()
    out = tmp_path / "rows.json"
    assert b.main([str(pdf), str(out), "--evidence", str(LAYER)]) == 0
    assert out.read_bytes() == ROWS.read_bytes()
    assert b.main([str(pdf), str(ROWS), "--check"]) == 0
    out.write_bytes(out.read_bytes().replace(b"Key Storage", b"Key Store"))
    assert b.main([str(pdf), str(out), "--check"]) == 1               # a changed file is reported and not written over
    assert b"Key Store" in out.read_bytes()


def test_the_build_reports_each_printed_typo_it_kept_out_of_the_data(built):
    _, repairs = built
    assert repairs == REPAIRS
    assert sum("printed 'T." in r for r in repairs) == 16 and sum("is printed on one line" in r for r in repairs) == 2


def test_objectives_names_sections_and_mapped_ids_are_in_the_pdf_text_as_printed(pdf, rows):
    """A second reading of the PDF, written without the builder, from the flat text of the table's pages (line wraps and hyphenated
    line breaks closed): every Objective, number and name is on the page its row starts on, the section name is on a page of the
    table, and the ids printed between one row's "number name" and the next row's are the row's ids (a stray full stop after the
    letter read away, a repeat kept once)."""
    import fitz

    doc = fitz.open(str(pdf))

    def flat(pno):
        return re.sub(r"\s+", " ", re.sub(r"(?<=[A-Za-z0-9])-\n", "-", doc[pno - 1].get_text("text"))).strip()

    text = {p: flat(p) for p in range(218, 226)}
    for annex, pages in TABLE_PAGES.items():
        table = " ".join(text[p] for p in pages)
        mine, at = of(rows, annex), 0
        starts = []
        for r in mine:
            marker = f"{r['original_reference']} {r['title']}"
            at = table.find(marker, at)
            assert at >= 0, (r["control_id"], marker)
            starts.append(at)
            at += len(marker)
        for r, start, end in zip(mine, starts, starts[1:] + [len(table)]):
            printed = [re.sub(r"^([MT])\.", r"\1", t) for t in re.findall(r"[MT]\.?\d+\.\d+\.\d+", table[start:end])]
            assert list(dict.fromkeys(printed)) == r["uae_ia_controls"], r["control_id"]
            assert table[start:end].count(r["description"]) == 1, r["control_id"]
            page = r["pdf_page"]
            assert r["description"] in text[page] and f"{r['original_reference']} {r['title']}" in text[page], r["control_id"]
            assert any(r["category"] in text[p] for p in pages if p <= page), r["control_id"]
            assert f"printed page {page - 4}." in r["ai_notes"]
        assert sum(len(re.findall(r"[MT]\.?\d+\.\d+\.\d+", table[s:e])) for s, e in zip(starts, starts[1:] + [len(table)])) == sum(
            len(re.findall(r"[MT]\.?\d+\.\d+\.\d+", text[p])) for p in pages)      # no printed id falls outside every row
    assert re.search(r"\b214\b", doc[217].get_text("text")) and re.search(r"\b221\b", doc[224].get_text("text"))      # the footers
