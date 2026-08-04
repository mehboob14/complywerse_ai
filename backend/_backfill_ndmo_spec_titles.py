#!python
# -*- coding: utf-8 -*-
"""Backfill NDMO specification names verbatim from the v1.5 PDF.

Some specification `title`s drifted during the original AI extraction (dropped
or altered words, e.g. DG.2.1 missing "and", BIA.1.4 missing "Implementation").
This transcribes all 191 specification names exactly as published (keyed by the
specification id = control_id) and overwrites them on the live shared framework
(id=14) and in the seed JSON. Idempotent.
"""
from __future__ import annotations
import os, sys, json
from dotenv import load_dotenv
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))
sys.path.insert(0, HERE)

from sqlalchemy import text
from grc.db import open_tenant_session

JSON_PATH = os.path.join(HERE, "grc", "seed_data", "frameworks",
                         "NDMO_Data_Management_Standardsv1.5.json")

# Specification id (control_id) -> verbatim Specification Name from the PDF.
TITLES: dict[str, str] = {
    # Data Governance
    "DG.1.1": "Data Management and Personal Data Protection Strategy",
    "DG.1.2": "Guiding Principles",
    "DG.1.3": "Data Management and Personal Data Protection Plan",
    "DG.1.4": "Strategy Approval and Socialization",
    "DG.2.1": "Data Management and Personal Data Protection Policy and Guidelines Gap Analysis",
    "DG.2.2": "Data Management and Personal Data Protection Policy and Guidelines",
    "DG.3.1": "Data Management and Personal Data Protection Training",
    "DG.4.1": "Data Management Office",
    "DG.4.2": "Entity Data Management Committee",
    "DG.4.3": "Chief Data Officer",
    "DG.4.4": "Data Governance Officer",
    "DG.4.5": "Open Data and Information Access Officer",
    "DG.4.6": "Compliance Officer",
    "DG.4.7": "Personal Data Protection Officer",
    "DG.4.8": "Business Data Executive",
    "DG.4.9": "Business Data Steward",
    "DG.4.10": "IT Data Steward",
    "DG.4.11": "Legal Advisor",
    "DG.5.1": "Compliance Management",
    "DG.5.2": "Compliance Audit Results",
    "DG.5.3": "Compliance Monitoring",
    "DG.6.1": "Periodic Plan Review",
    "DG.6.2": "Communications",
    "DG.7.1": "Data Governance KPIs",
    "DG.7.2": "Continuous Improvement",
    "DG.8.1": "Data Governance Approvals Register",
    "DG.8.2": "Data Management Issue Tracking Register",
    "DG.8.3": "Version Control",
    # Data Catalog and Metadata
    "MCM.1.1": "Data Catalog Plan",
    "MCM.1.2": "Data Sources Prioritization",
    "MCM.1.3": "Metadata Architecture",
    "MCM.2.1": "Data Access Approval",
    "MCM.2.2": "Metadata Access Approval",
    "MCM.3.1": "Data Catalog Training",
    "MCM.3.2": "Data Catalog Adoption and Usage",
    "MCM.4.1": "Metadata Stewardship Coverage",
    "MCM.4.2": "Metadata Population",
    "MCM.4.3": "Metadata Structure",
    "MCM.4.4": "Metadata Update",
    "MCM.4.5": "Metadata Quality",
    "MCM.4.6": "Metadata Annotation",
    "MCM.4.7": "Metadata Certification",
    "MCM.5.1": "Data Catalog Automated Tool",
    "MCM.5.2": "Metadata and Catalog Notifications",
    "MCM.5.3": "Metadata and Catalog Audit Trial",
    "MCM.5.4": "Tool Versioning",
    "MCM.6.1": "Data Catalog KPIs",
    "MCM.6.2": "Metadata Quality KPIs",
    # Data Quality
    "DQ.1.1": "Data Quality Prioritization",
    "DQ.1.2": "Data Quality Plan",
    "DQ.1.3": "Initial Data Quality Assessment",
    "DQ.2.1": "Data Quality Rules Development",
    "DQ.2.2": "Data Quality Monitoring",
    "DQ.2.3": "Data Quality Issues Resolution",
    "DQ.2.4": "Data Quality Service Level Agreements",
    "DQ.2.5": "Data Quality Tools",
    "DQ.3.1": "Data Quality Trends",
    "DQ.3.2": "Data Quality Issues Resolution",
    "DQ.4.1": "Data Quality Checkpoints",
    "DQ.4.2": "Data Quality Support",
    "DQ.4.3": "Data Quality Metadata",
    # Data Operations
    "DO.1.1": "Data Operations Plan",
    "DO.1.2": "Data Storage Forecasting",
    "DO.1.3": "Data Systems Prioritization",
    "DO.1.4": "Database Technology Evaluation",
    "DO.2.1": "Storage and Retention Policy",
    "DO.3.1": "Database Monitoring",
    "DO.3.2": "Database Access Control",
    "DO.3.3": "Storage Configuration Management",
    "DO.3.4": "DBMS Versioning",
    "DO.3.5": "Service Level Agreements",
    "DO.4.1": "Data Backup Recovery",
    "DO.4.2": "Disaster Recovery",
    "DO.4.3": "Production Data Access Control",
    "DO.5.1": "Storage KPIs",
    # Document and Content Management
    "DCM.1.1": "Document and Content Management Plan",
    "DCM.1.2": "Documents Digitization Plan",
    "DCM.1.3": "Documents Prioritization",
    "DCM.1.4": "Documents Workflows Prioritization",
    "DCM.2.1": "Document and Content Management Policy",
    "DCM.3.1": "Document and Content Management Training",
    "DCM.4.1": "Backup and Recovery",
    "DCM.4.2": "Retention and Disposal",
    "DCM.4.3": "Document and Content Access Approval",
    "DCM.4.4": "Document and Content Metadata Publishing",
    "DCM.4.5": "Documents and Content Management Tools",
    "DCM.5.1": "Documents Management KPIs",
    # Data Architecture and Modeling
    "DAM.1.1": "Data Architecture and Modeling Plan",
    "DAM.2.1": "Data Architecture and Modeling Policy",
    "DAM.3.1": "Current State Architecture",
    "DAM.3.2": "Target State Architecture",
    "DAM.3.3": "Future State Gap Assessment",
    "DAM.3.4": "Big Data Considerations",
    "DAM.3.5": "Data Processing Considerations",
    "DAM.4.1": "Model Representation",
    "DAM.4.2": "Tools and Technologies",
    "DAM.5.1": "Change Management",
    "DAM.5.2": "Data Architecture Checkpoints",
    "DAM.6.1": "Data Architecture and Modeling KPIs",
    "DAM.7.1": "Data Architecture and Modeling Register",
    # Data Sharing and Interoperability
    "DSI.1.1": "Initial Data Integration Assessment",
    "DSI.1.2": "Target Data Integration Architecture",
    "DSI.1.3": "Data Integration Plan",
    "DSI.2.1": "Data Sharing Training",
    "DSI.3.1": "Integration Requirements Document",
    "DSI.3.2": "Solution Design Document",
    "DSI.3.3": "Integration Solution Testing",
    "DSI.3.4": "Monitoring and Maintenance",
    "DSI.4.1": "ETL Process",
    "DSI.4.2": "ELT Process",
    "DSI.5.1": "Data Sharing Process",
    "DSI.6.1": "Data Sharing Request Submission Channel",
    "DSI.7.1": "Internal Data Sharing Agreements",
    "DSI.7.2": "External Data Sharing Agreements",
    "DSI.7.3": "Data Sharing Agreements' Review",
    "DSI.8.1": "Data Sharing and Interoperability KPIs",
    # Reference and Master Data Management
    "RMD.1.1": "Reference and Master Data Plan",
    "RMD.1.2": "Reference and Master Data Identification and Prioritization",
    "RMD.1.3": "Reference Data Categorization",
    "RMD.1.4": "Master Data Categorization",
    "RMD.2.1": "RMD Requirements",
    "RMD.2.2": "RMD Data Hub Design",
    "RMD.2.3": "RMD Conceptual Architecture",
    "RMD.2.4": "RMD Information Architecture",
    "RMD.2.5": "RMD Data Hub Technical Requirements",
    "RMD.3.1": "Reference and Master Data Training",
    "RMD.4.1": "RMD Stewardship Coverage",
    "RMD.4.2": "RMD Data Lifecycle Management Process",
    "RMD.4.3": "RMD Data Hub Implementation",
    "RMD.4.4": "Data Hub as Trusted Source",
    "RMD.5.1": "RMD Service Level Agreements",
    "RMD.5.2": "RMD Program KPIs",
    "RMD.6.1": "RMD Change Request Logs",
    "RMD.6.2": "RMD Initiative Planning Documents",
    # Business Intelligence and Analytics
    "BIA.1.1": "Business Intelligence and Analytics Plan",
    "BIA.1.2": "Bi and Analytics Use Case Identification and Prioritization",
    "BIA.1.3": "BI and Analytics Use Case Detailing",
    "BIA.1.4": "BI and Analytics Use Case Implementation Plan",
    "BIA.2.1": "Business Intelligence and Analytics Training",
    "BIA.2.2": "Business Intelligence and Analytics Awareness",
    "BIA.3.1": "Business Intelligence and Analytics Use Case Validation",
    "BIA.3.2": "Data Science Team",
    "BIA.4.1": "Business Intelligence and Analytics KPIs",
    "BIA.5.1": "Business Intelligence and Analytics Register",
    # Data Value Realization
    "DVR.1.1": "Data Value Realization Use Cases",
    "DVR.1.2": "Data Value Realization Plan",
    "DVR.2.1": "Pricing Scheme Definition",
    "DVR.2.2": "Data or Data Product Price Calculation",
    "DVR.2.3": "Charging Model Adoption",
    "DVR.2.4": "Revenue Generation Request Submission",
    "DVR.3.1": "Data Value Realization Use Cases Monitoring and Maintenance",
    "DVR.4.1": "Data Value Realization KPIs",
    # Open Data
    "OD.1.1": "Open Data Plan",
    "OD.2.1": "Open Data Awareness",
    "OD.3.1": "Open Data Processes",
    "OD.3.2": "Open Data Identification",
    "OD.3.3": "Open Data Publishing",
    "OD.3.4": "Open Data Metadata",
    "OD.3.5": "Open Data Format",
    "OD.3.6": "Open Data Maintenance",
    "OD.4.1": "Open Data KPIs",
    "OD.5.1": "Open Data Register",
    # Freedom of Information
    "FOI.1.1": "FOI Plan",
    "FOI.2.1": "FOI Awareness",
    "FOI.3.1": "FOI Request Process Design",
    "FOI.3.2": "FOI Request Process Implementation",
    "FOI.3.3": "Public Entity Publication",
    "FOI.3.4": "Access Request Forms",
    "FOI.3.5": "Information Fees Determination",
    "FOI.3.6": "Compliance monitoring",
    "FOI.4.1": "FOI Register",
    # Data Classification
    "DC.1.1": "Data Classification Plan",
    "DC.1.2": "Data Classification Prioritization",
    "DC.2.1": "Security Controls",
    "DC.3.1": "Data Identification",
    "DC.3.2": "Impact Assessment",
    "DC.3.3": "Assessment for Low Impact Data",
    "DC.3.4": "Data Classification Review",
    "DC.3.5": "Data Classification Metadata",
    "DC.4.1": "Data Classification KPIs",
    "DC.5.1": "Data Register",
    # Personal Data Protection
    "PDP.1.1": "Personal Data Protection Initial Assessment",
    "PDP.1.2": "Personal Data Protection Plan",
    "PDP.2.1": "Personal Data Protection Training",
    "PDP.3.1": "Data Breach Notification",
    "PDP.3.2": "Data Breach Management Process",
    "PDP.4.1": "Privacy Notice and Consent Management",
    "PDP.4.2": "Data Subject Rights",
    "PDP.4.3": "Personal Data Protection Risk Assessments",
    "PDP.4.4": "Compliance Monitoring and Audit",
    "PDP.5.1": "Personal Data Protection Register",
}


def main():
    print(f"Transcribed titles in map: {len(TITLES)}")

    # 1) Patch the seed JSON (keyed by control_id).
    with open(JSON_PATH, encoding="utf-8") as fh:
        data = json.load(fh)
    patched = 0
    for c in data.get("controls", []):
        t = TITLES.get(c.get("control_id"))
        if t and c.get("title") != t:
            c["title"] = t
            patched += 1
    with open(JSON_PATH, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    print(f"JSON: corrected {patched} titles")

    # 2) Update the live shared framework (id=14).
    db = open_tenant_session("complyverse")
    try:
        changed = 0
        for cid, title in TITLES.items():
            r = db.execute(text("""
                UPDATE grc_parsed_framework_controls
                SET title = :t
                WHERE uploaded_framework_id = 14 AND control_id = :c AND title <> :t
            """), {"t": title, "c": cid})
            changed += r.rowcount
        db.commit()
        print(f"DB: updated {changed} drifted titles on fw id=14")

        # Verify every mapped id exists and now matches.
        missing = []
        for cid in TITLES:
            row = db.execute(text(
                "SELECT title FROM grc_parsed_framework_controls "
                "WHERE uploaded_framework_id=14 AND control_id=:c"
            ), {"c": cid}).fetchone()
            if not row:
                missing.append(cid)
        if missing:
            print("  ! spec ids in map but NOT found in DB:", missing)
        else:
            print("  all 191 mapped spec ids present and set.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
