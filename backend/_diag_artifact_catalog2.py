#!python
# -*- coding: utf-8 -*-
"""Where are the user's frameworks actually living + which ones miss
artifact-catalog coverage."""
import os, sys
from dotenv import load_dotenv
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))
sys.path.insert(0, HERE)

from sqlalchemy import text
from grc.db import open_tenant_session

SLUG = "liztek-1"
db = open_tenant_session(SLUG)
try:
    print("=== grc_framework_assessments columns ===")
    cols = db.execute(text("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'grc_framework_assessments' ORDER BY ordinal_position
    """)).all()
    print(f"  cols: {[c[0] for c in cols]}")
    print()
    print("=== grc_framework_assessments rows ===")
    rows = db.execute(text("""
        SELECT * FROM grc_framework_assessments LIMIT 20
    """)).all()
    if not rows:
        print("  None.")
    else:
        print(f"  count: {len(rows)}")
        print(f"  first row sample: {rows[0]}")

    print()
    print("=== grc_frameworks ===")
    rows = db.execute(text("""
        SELECT id, name, framework_code, status
        FROM grc_frameworks ORDER BY id LIMIT 50
    """)).all()
    if not rows:
        print("  None.")
    for r in rows:
        print(f"  id={r[0]} name={r[1]!r} code={r[2]!r} status={r[3]}")

    # Mapping seeded JSON framework names → catalog framework_key (slug used internally)
    print()
    print("=== Seed JSON name → catalog framework_key inference ===")
    import json, re
    fw_dir = os.path.join(HERE, "grc", "seed_data", "frameworks")
    catalog_keys = {r[0] for r in db.execute(text(
        "SELECT DISTINCT framework_key FROM grc_artifact_catalog_items"
    )).all()}
    name_to_key_guess = {
        "ARAMCO Cybersecurity Compliance Certification":         None,
        "Abu Dhabi Healthcare Information and Cyber Security Standard": None,
        "CIS Critical Security Controls v8":                     "cis_v8",
        "COBIT 2019":                                            "cobit_2019",
        "DOH Policy on the Abu Dhabi Health Information Exchange (ADHIE)": None,
        "Digital Operational Resilience Act (DORA)":             "dora",
        "General Data Protection Regulation":                    "gdpr",
        "HIPAA Security & Privacy Rule":                         "hipaa",
        "HITRUST Common Security Framework (CSF)":               None,
        "ISO 22301:2019 Business Continuity Management System":  "iso_22301_2019",
        "ISO/IEC 27001:2022":                                    "iso_27001_2022",
        "ISO/IEC 42001:2023 AI Management System":               "iso_41001_2018",  # *** mismatch — iso_41001 != iso_42001
        "KSA National Data Management and Personal Data Protection Standards": "pdpl_ksa",
        "MAS Technology Risk Management Guidelines":             None,
        "NIS2 Directive":                                        "nis2",
        "NIST Artificial Intelligence Risk Management Framework (AI RMF 1.0)": None,
        "NIST Cybersecurity Framework":                          "nist_csf_2",
        "NIST SP 800-53 Rev 5":                                  None,
        "PCI Data Security Standard":                            "pci_dss_v4",
        "Qatar Central Bank Technology Risks Circular":          None,
        "SABIC CyberTrust Guidelines":                           None,
        "SAMA Cyber Security Framework":                         None,
        "SBP Cloud Outsourcing Framework":                       None,
        "SBP ETGRMF":                                            None,
        "SBP Internet Banking Framework":                        None,
        "SOC 2 Type II":                                         "soc2",
        "SOX IT General Controls":                               "sox_itgc",
        "SWIFT Customer Security Controls Framework":            "swift_cscf",
        "Sri Lanka Baseline Security Standard (BSS)":            None,
    }
    print(f"  catalog_keys present: {sorted(catalog_keys)}")
    print()
    print("  Framework JSON name -> guessed catalog key -> covered?")
    for name, key in name_to_key_guess.items():
        covered = (key in catalog_keys) if key else False
        tag = "OK" if covered else ("NO MATCH" if key else "NO KEY MAPPED")
        print(f"    [{tag:<13}] {name[:60]:<60} -> {key}")

finally:
    db.close()
