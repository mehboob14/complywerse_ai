#!python
# -*- coding: utf-8 -*-
"""Curated artifact catalog for the NDMO framework (ksa_ndmo).

NDMO had no entry in artifact_catalog.json, so the Artifacts tab fell back to a
degraded virtual catalog derived from raw evidence_requirements. This gives NDMO
a real, curated catalog (same schema/8-stage lifecycle as ISO/PCI/PDPL) mapped to
the document's actual deliverables and control IDs, so the existing Artifacts UI
renders it properly. Writes the seed JSON AND inserts rows into the live
grc_artifact_catalog_items table (idempotent — replaces existing ksa_ndmo rows).
"""
from __future__ import annotations
import os, sys, json
from dotenv import load_dotenv
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))
sys.path.insert(0, HERE)

from sqlalchemy import text
from grc.db import open_tenant_session
from grc.models import ArtifactCatalogItem

JSON_PATH = os.path.join(HERE, "grc", "seed_data", "artifact_catalog.json")
FW_KEY = "ksa_ndmo"
FW_NAME = "KSA National Data Management and Personal Data Protection Standards"

# (artifact_id, stage, name, type, control_ref, mandatory, format, owner)
ROWS = [
    # Stage 1 — Initiation & Scoping
    ("NDMO-001", "Stage 1: Initiation & Scoping", "Data Management & Personal Data Protection Strategy", "Strategy", "DG.1.1", True, "DOCX", "Chief Data Officer"),
    ("NDMO-002", "Stage 1: Initiation & Scoping", "Guiding Principles Adoption", "Policy", "DG.1.2", True, "DOCX", "Chief Data Officer"),
    ("NDMO-003", "Stage 1: Initiation & Scoping", "Data Management & Personal Data Protection Plan (3-Year Roadmap)", "Plan", "DG.1.3", True, "DOCX", "Chief Data Officer"),
    ("NDMO-004", "Stage 1: Initiation & Scoping", "Strategy Approval & Socialization Record", "Record", "DG.1.4", True, "DOCX", "Data Management Committee"),
    ("NDMO-005", "Stage 1: Initiation & Scoping", "Data Management Office Charter", "Charter", "DG.4.1", True, "DOCX", "Chief Data Officer"),
    ("NDMO-006", "Stage 1: Initiation & Scoping", "Data Management Committee Charter & Minutes", "Charter", "DG.4.2", True, "DOCX", "Data Management Committee"),
    ("NDMO-007", "Stage 1: Initiation & Scoping", "Data Governance Roles & Responsibilities (RACI / Job Descriptions)", "Register", "DG.4.3-DG.4.11", True, "XLSX", "Chief Data Officer"),
    # Stage 2 — Gap Assessment
    ("NDMO-008", "Stage 2: Gap Assessment", "Policy & Guidelines Gap Analysis", "Report", "DG.2.1", True, "DOCX", "Data Governance Officer"),
    ("NDMO-009", "Stage 2: Gap Assessment", "Initial Data Quality Assessment", "Report", "DQ.1.3", True, "DOCX", "Data Governance Officer"),
    ("NDMO-010", "Stage 2: Gap Assessment", "Initial Data Integration Assessment", "Report", "DSI.1.1", True, "DOCX", "IT Data Steward"),
    ("NDMO-011", "Stage 2: Gap Assessment", "Current State Data Architecture", "Report", "DAM.3.1", True, "DOCX", "IT Data Steward"),
    ("NDMO-012", "Stage 2: Gap Assessment", "Initial Personal Data Protection Assessment", "Report", "PDP.1.1", True, "DOCX", "Personal Data Protection Officer"),
    # Stage 3 — Risk Assessment
    ("NDMO-013", "Stage 3: Risk Assessment", "Data Classification Plan", "Plan", "DC.1.1", True, "DOCX", "Data Governance Officer"),
    ("NDMO-014", "Stage 3: Risk Assessment", "Data Classification Impact Assessment", "Register", "DC.3.2", True, "XLSX", "Business Data Steward"),
    ("NDMO-015", "Stage 3: Risk Assessment", "Personal Data Protection Risk Assessment", "Register", "PDP.4.3", True, "XLSX", "Personal Data Protection Officer"),
    ("NDMO-016", "Stage 3: Risk Assessment", "Data Architecture Future-State Gap Assessment", "Report", "DAM.3.3", False, "DOCX", "IT Data Steward"),
    # Stage 4 — Policy & Documentation
    ("NDMO-017", "Stage 4: Policy & Documentation", "Data Management & Personal Data Protection Policy & Guidelines", "Policy", "DG.2.2", True, "DOCX", "Data Governance Officer"),
    ("NDMO-018", "Stage 4: Policy & Documentation", "Storage & Retention Policy", "Policy", "DO.2.1", True, "DOCX", "IT Data Steward"),
    ("NDMO-019", "Stage 4: Policy & Documentation", "Document & Content Management Policy", "Policy", "DCM.2.1", True, "DOCX", "Data Governance Officer"),
    ("NDMO-020", "Stage 4: Policy & Documentation", "Data Architecture & Modeling Policy", "Policy", "DAM.2.1", True, "DOCX", "IT Data Steward"),
    ("NDMO-021", "Stage 4: Policy & Documentation", "Data Catalog Policy & Access Guidelines", "Policy", "MCM.2.1-MCM.2.2", True, "DOCX", "Data Governance Officer"),
    ("NDMO-022", "Stage 4: Policy & Documentation", "Privacy Notice & Consent Management Framework", "Policy", "PDP.4.1", True, "DOCX", "Personal Data Protection Officer"),
    ("NDMO-023", "Stage 4: Policy & Documentation", "Data Subject Rights Procedure", "Procedure", "PDP.4.2", True, "DOCX", "Personal Data Protection Officer"),
    ("NDMO-024", "Stage 4: Policy & Documentation", "Open Data Plan", "Plan", "OD.1.1", True, "DOCX", "Open Data & Information Access Officer"),
    ("NDMO-025", "Stage 4: Policy & Documentation", "Freedom of Information Plan", "Plan", "FOI.1.1", True, "DOCX", "Open Data & Information Access Officer"),
    # Stage 5 — Control Implementation
    ("NDMO-026", "Stage 5: Control Implementation", "Data Catalog Plan & Metadata Architecture", "Plan", "MCM.1.1 / MCM.1.3", True, "DOCX", "Data Governance Officer"),
    ("NDMO-027", "Stage 5: Control Implementation", "Data Quality Plan & Rules", "Plan", "DQ.1.2 / DQ.2.1", True, "DOCX", "Business Data Steward"),
    ("NDMO-028", "Stage 5: Control Implementation", "Data Operations Plan", "Plan", "DO.1.1", True, "DOCX", "IT Data Steward"),
    ("NDMO-029", "Stage 5: Control Implementation", "Document & Content Management Plan", "Plan", "DCM.1.1", True, "DOCX", "Data Governance Officer"),
    ("NDMO-030", "Stage 5: Control Implementation", "Target State Data Architecture", "Report", "DAM.3.2", True, "DOCX", "IT Data Steward"),
    ("NDMO-031", "Stage 5: Control Implementation", "Reference & Master Data Plan", "Plan", "RMD.1.1", True, "DOCX", "IT Data Steward"),
    ("NDMO-032", "Stage 5: Control Implementation", "Business Intelligence & Analytics Plan", "Plan", "BIA.1.1", True, "DOCX", "Business Data Executive"),
    ("NDMO-033", "Stage 5: Control Implementation", "Data Value Realization Plan", "Plan", "DVR.1.2", False, "DOCX", "Business Data Executive"),
    ("NDMO-034", "Stage 5: Control Implementation", "Data Integration Plan", "Plan", "DSI.1.3", True, "DOCX", "IT Data Steward"),
    ("NDMO-035", "Stage 5: Control Implementation", "Data Sharing Agreement (Internal & External Templates)", "Template", "DSI.7.1 / DSI.7.2", True, "DOCX", "Business Data Executive"),
    ("NDMO-036", "Stage 5: Control Implementation", "Data Management & Privacy Training Material", "Training", "DG.3.1", True, "PPTX", "Data Governance Officer"),
    # Stage 6 — Internal Audit & Review
    ("NDMO-037", "Stage 6: Internal Audit & Review", "Compliance Audit Framework", "Procedure", "DG.5.1", True, "DOCX", "Compliance Officer"),
    ("NDMO-038", "Stage 6: Internal Audit & Review", "Compliance Audit Results Report", "Report", "DG.5.2", True, "DOCX", "Compliance Officer"),
    ("NDMO-039", "Stage 6: Internal Audit & Review", "Personal Data Protection Compliance Audit", "Report", "PDP.4.4", True, "DOCX", "Personal Data Protection Officer"),
    ("NDMO-040", "Stage 6: Internal Audit & Review", "Data Breach Management Process & Log", "Procedure", "PDP.3.1 / PDP.3.2", True, "DOCX", "Personal Data Protection Officer"),
    # Stage 7 — Compliance Submission
    ("NDMO-041", "Stage 7: Compliance Submission", "Annual NDMO Compliance Report", "Report", "Sec. 4 / DG.5", True, "DOCX", "Chief Data Officer"),
    ("NDMO-042", "Stage 7: Compliance Submission", "Specification Evidence Package", "Evidence", "All specifications", True, "XLSX", "Compliance Officer"),
    # Stage 8 — Continuous Monitoring
    ("NDMO-043", "Stage 8: Continuous Monitoring", "Data Governance KPIs Dashboard", "Report", "DG.7.1", True, "XLSX", "Data Governance Officer"),
    ("NDMO-044", "Stage 8: Continuous Monitoring", "Periodic Plan Review Record", "Record", "DG.6.1", True, "DOCX", "Chief Data Officer"),
    ("NDMO-045", "Stage 8: Continuous Monitoring", "Data Governance Registers (Approvals / Issues / Version Control)", "Register", "DG.8.1-DG.8.3", True, "XLSX", "Data Governance Officer"),
    ("NDMO-046", "Stage 8: Continuous Monitoring", "Domain Registers (RMD / Open Data / FOI / Classification / BI&A / PDP)", "Register", "RMD.6 / OD.5 / FOI.4 / DC.5 / BIA.5 / PDP.5", True, "XLSX", "Business Data Steward"),
]


def to_artifacts():
    out = []
    for aid, stage, name, typ, ref, mand, fmt, owner in ROWS:
        out.append({
            "artifact_id": aid, "stage": stage, "name": name, "type": typ,
            "control_ref": ref, "mandatory": mand, "format": fmt, "owner": owner,
            "description": f"{typ} deliverable required by NDMO control {ref}.",
        })
    return out


def stage_num(stage: str):
    if stage.startswith("Stage "):
        try:
            return int(stage.split(" ")[1].rstrip(":"))
        except (IndexError, ValueError):
            return None
    return None


def main():
    artifacts = to_artifacts()

    # 1) Patch the seed JSON.
    with open(JSON_PATH, encoding="utf-8") as fh:
        cat = json.load(fh)
    cat[FW_KEY] = {"name": FW_NAME, "artifacts": artifacts}
    with open(JSON_PATH, "w", encoding="utf-8") as fh:
        json.dump(cat, fh, ensure_ascii=False, indent=2)
    print(f"JSON: wrote {len(artifacts)} artifacts under '{FW_KEY}'")

    # 2) Insert into the live catalog table (idempotent: clear then insert).
    db = open_tenant_session("complyverse")
    try:
        db.execute(text("DELETE FROM grc_artifact_catalog_items WHERE framework_key = :k"), {"k": FW_KEY})
        objs = []
        for a in artifacts:
            objs.append(ArtifactCatalogItem(
                framework_key=FW_KEY, framework_name=FW_NAME,
                artifact_id=a["artifact_id"], stage=a["stage"], stage_number=stage_num(a["stage"]),
                name=a["name"], artifact_type=a["type"], control_ref=a["control_ref"],
                mandatory=a["mandatory"], description=a["description"], format=a["format"],
                owner=a["owner"], is_platform_native=False, platform_data_type=None,
            ))
        db.bulk_save_objects(objs)
        db.commit()
        n = db.execute(text("SELECT count(*) FROM grc_artifact_catalog_items WHERE framework_key=:k"), {"k": FW_KEY}).scalar()
        stages = db.execute(text("SELECT DISTINCT stage FROM grc_artifact_catalog_items WHERE framework_key=:k ORDER BY stage"), {"k": FW_KEY}).fetchall()
        print(f"DB: {n} ksa_ndmo catalog rows across {len(stages)} stages")
    finally:
        db.close()


if __name__ == "__main__":
    main()
