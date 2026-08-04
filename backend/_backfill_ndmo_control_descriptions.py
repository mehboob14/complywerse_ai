#!python
# -*- coding: utf-8 -*-
"""Backfill NDMO control-level descriptions (Figure-2 "Control Description").

The exported JSON flattened Specifications and dropped the per-Control
description sentence. This script transcribes all 77 control descriptions
verbatim from the NDMO v1.5 PDF (each control table's "Control Description"
row), denormalises them onto every specification under the control (keyed by
parent_section), backfills the live shared framework (id=14), and writes them
into the seed JSON so future re-seeds keep them. Idempotent.
"""
from __future__ import annotations
import os, sys, json
from dotenv import load_dotenv
HERE = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(HERE, ".env"))
sys.path.insert(0, HERE)

from sqlalchemy import text, inspect
from grc.db import open_tenant_session
from grc.models import Tenant  # noqa: F401

JSON_PATH = os.path.join(HERE, "grc", "seed_data", "frameworks",
                         "NDMO_Data_Management_Standardsv1.5.json")

# Control ID (parent_section) -> verbatim Control Description from the PDF.
CONTROL_DESCRIPTIONS: dict[str, str] = {
    # Data Governance
    "DG.1": "As part of the Strategy and Plan control, the Entity shall establish a Data Management and Personal Data Protection Strategy and develop a Data Management and Personal Data Protection Plan",
    "DG.2": "As part of the Policy and Guidelines control, the Entity shall conduct a Data Management and Personal Data Protection Policy and Guidelines gap analysis, and develop the Entity specific Data Management and Personal Data Protection Policy and Guidelines",
    "DG.3": "As part of the Training and Awareness control, the Entity shall conduct a Data Management and Personal Data Protection training to promote the agenda and enable a data-centric culture",
    "DG.4": "As part of the Data Management Organization control, the Entity shall establish a Data Management Office and a Data Management Committee, and identify and appoint the relevant Data Governance roles",
    "DG.5": "As part of the Compliance Audit Framework control, the Entity shall establish Data Management and Personal Data Protection Compliance Management practices and document audit results and findings",
    "DG.6": "As part of the Data Lifecycle Governance control, the Entity shall conduct periodic reviews for the Data Management and Personal Data Protection Plan and implement a communications capability to communicate updates on Data Management and Personal Data Protection activities and its effectiveness",
    "DG.7": "As part of the Performance Management control, the Entity shall establish key performance indicators (KPIs) to gather statistics on Data Governance and define, implement and monitor continuous improvement mechanisms for all Data Management domains",
    "DG.8": "As part of the Artifacts control, the Entity shall document in a register all data governance decisions, tracking logs and implement a version control for data management documents and artifacts",
    # Data Catalog and Metadata
    "MCM.1": "As part of the Plan control, the Entity shall develop a Data Catalog Plan and the target metadata architecture",
    "MCM.2": "As part of the Policy and Guidelines control, the Entity shall establish and follow clear processes for an approval of connecting the Data Catalog to the Entity's data sources and for providing the Entity's employees an access to the Data Catalog",
    "MCM.3": "As part of the Training and Awareness control, the Entity shall conduct the Data Catalog trainings, accelerate adoption and increase usage of its Data Catalog",
    "MCM.4": "As part of the Data Lifecycle Management control, the Entity shall develop the Metadata structure and establish and follow processes for populating the metadata and managing of metadata quality issues",
    "MCM.5": "As part of the Data Catalog Automation control, the Entity shall implement Data Catalog automated tool, monitor changes to its Metadata and activity of users within the tool",
    "MCM.6": "As part of the Performance Management control, the Entity shall establish key performance indicators (KPIs) to gather statistics on the adoption of Data Catalog by users and to measure quality of its Metadata",
    # Data Quality
    "DQ.1": "As part of the Plan control, the Entity shall prioritize its data from the perspective of its importance for Data Quality Management, develop a Data Quality Plan and perform an Initial Data Quality Assessment",
    "DQ.2": "As part of the Data Quality Operations control, the Entity shall develop Data Quality Rules, monitor its Data Quality, establish and follow a clear process for resolving the identified Data Quality issues and implement the Data Quality tools",
    "DQ.3": "As part of the Performance Management control, the Entity shall establish key performance indicators (KPIs) to measure and report on the Entity's Data Quality trends and on a performance of the Entity's Data Quality issues resolution process",
    "DQ.4": "As part of the Data Lifecycle Management control, the Entity shall publish Data Quality Rules, results of Data Quality monitoring and establish a process for reporting Data Quality issues",
    # Data Operations
    "DO.1": "As part of the Plan control, the Entity shall create a Data Operation Plan, conduct Data Storage forecasts, prioritize its information systems based on their business criticality and establish and follow a process for evaluation and selection of the Database Management System Software",
    "DO.2": "As part of the Policy and Guidelines control, the Entity shall create a storage and retention policy for the Data Lifecycle Management of all stored data",
    "DO.3": "As part of the Database Operations control, the Entity shall monitor and report database performance and establish and follow processes for providing the Entity's employees an access to databases and for managing the Entity's Storage Configuration",
    "DO.4": "As part of the Business Continuity control, the Entity shall establish and follow a disaster recovery plan and processes for the data backup and recovery and the implementation of database changes to Production Environments",
    "DO.5": "As part of the Performance Management control, the Entity shall establish key performance indicators (KPIs) to gather statistics on usage of its data storage",
    # Document and Content Management
    "DCM.1": "As part of the Plan control, the Entity shall create a Document and Content Management Plan and a Documents Digitization Plan as well as prioritize its documents and documents workflows",
    "DCM.2": "As part of the Policy and Guidelines control, the Entity shall create a Document and Content Management policy/policies on managing the data lifecycle for documents and content",
    "DCM.3": "As part of the Training and Awareness control, the Entity shall conduct document and content management training for the Entity's employees",
    "DCM.4": "As part of the Document and Content Operations control, the Entity shall implement Documents and Content Management Tools, establish and follow processes for retention and disposal of documents and providing employees access to documents and content in the Entity's DMS and CMS",
    "DCM.5": "As part of the Performance Management control, the Entity shall define key performance indicators (KPIs) to measure its documents management efficiency",
    # Data Architecture and Modeling
    "DAM.1": "As part of the Plan control, the Entity shall create a Data Architecture and Modeling Plan to manage the implementation of the target state Data Architecture",
    "DAM.2": "As part of Policy and Guidelines control, the Entity shall document and publish a Data Architecture and Modeling Policy",
    "DAM.3": "As part of the Data Architecture Framework Definition control, the Entity shall define its current and target state Data Architecture and conduct a gap analysis between them, identify and document its requirements for developing a Data Lake environment and define the partitioning strategy for its target state Data Architecture",
    "DAM.4": "As part of the Data Modeling Definition control, the Entity shall select diagramming method for documenting the structure, relationships and notations of business entities and select a toolset of technologies for the implementation of Data Architecture and Modeling initiatives within the Entity",
    "DAM.5": "As part of the Data Lifecycle Management control, the Entity shall establish an architecture change management process and follow Data Architecture checkpoints incorporated into its SDLC process",
    "DAM.6": "As part of the Performance Management control, the Entity shall develop key metrics to regularly measure the Entity's Data Architecture and Modeling capabilities",
    "DAM.7": "As part of the Artifacts control, the Entity shall store and maintain its Data Architecture documentation materials",
    # Data Sharing and Interoperability
    "DSI.1": "As part of the Plan control, the Entity shall perform an Initial Data Integration Assessment and create a Target Data Integration Architecture and a Data Integration Plan",
    "DSI.2": "As part of the Training and Awareness control, the Entity conduct training on the Data Sharing to ensure employees involved in the Data Sharing initiatives understand their responsibilities and the consequences of an unauthorized disclosure or mishandling of data",
    "DSI.3": "As part of the Integration Solution Development Lifecycle control, the Entity shall for each data integration initiative produce an Integration Requirements Document, Solution Design Document and test the developed Integration Solution prior to deployment in the Production Environment",
    "DSI.4": "As part of the Data Processes control, the Entity shall design, document and follow ETL and ELT processes",
    "DSI.5": "As part of the Data Sharing Process control, the Entity shall adopt the Data Sharing Process as defined in the Data Sharing Regulation published by the National Data Management Office",
    "DSI.6": "As part of the Data Sharing Requests control, the Entity shall establish a request submission channel on its official Government website to manage the reception of Data Sharing requests",
    "DSI.7": "As part of the Data Sharing Agreements control, the Entity shall design, implement and review Data Sharing Agreements",
    "DSI.8": "As part of Performance Management control, the Entity shall define and implement KPIs to measure the progress and benefits from implementing Data Integration solutions and the effectiveness of Data Sharing activities",
    # Reference and Master Data Management
    "RMD.1": "As part of the Plan control, the Entity shall develop a Reference and Master Data Plan to manage the implementation of the target RMD Information Architecture, identify, document and prioritize Reference and Master data objects owned by the Entity and categorize them as either internal or external datasets",
    "RMD.2": "As part of the Architecture control, the Entity shall develop and document its requirements for effectively managing its Reference and Master Data, evaluate and select a Reference and Master Data Hub architecture design, develop a conceptual and an information architectures for its target Reference and Master Data environment, and document the technical requirements for its Reference and Master Data Hub platform",
    "RMD.3": "As part of the Training and Awareness control, the Entity shall conduct Reference and Master Data training for employees responsible for managing reference and master data",
    "RMD.4": "As part of the Data Lifecycle Management control, the Entity shall assign Data Stewards to all identified RMD Data Objects, establish and follow Data Lifecycle Management process for RMD Data Objects, implement the Reference and Master Data Hub as the Entity's Trusted Source as well as document and maintain its Reference and Master Data Integration Mappings",
    "RMD.5": "As part of the Performance Management control, the Entity shall establish Service Level Agreements for its Reference and Master Data requests and establish Key Performance Indicators (KPIs) to measure the effectiveness of development of its Reference and Master Data capabilities",
    "RMD.6": "As part of the Artifacts control, the Entity document in a register a historical record of its change request logs and Reference and Master Data initiative plans",
    # Business Intelligence and Analytics
    "BIA.1": "As part of the Plan control, the Entity shall create a Business Intelligence and Analytics Plan, prioritize the list of Analytics and AI use cases and develop an implementation plan for the Analytics and AI Use Cases defined in the use case portfolio",
    "BIA.2": "As part of the Training and Awareness control, the Entity shall conduct Business Intelligence and Analytics training and create Business Intelligence and Analytics awareness campaigns",
    "BIA.3": "As part of the Data Lifecycle Management control, the Entity shall define and conduct a validation process to validate use cases outcomes and shall leverage a data science team to implement them",
    "BIA.4": "As part of the Performance Management control, the Entity shall establish key performance indicators (KPIs) to measure performance and effectiveness of its Analytics and AI portfolio",
    "BIA.5": "As part of the Artifacts control, the Entity shall document in a register its BI and Analytics Use Cases",
    # Data Value Realization
    "DVR.1": "As part of the Plan control, the Entity shall identify and document Data Value Realization Use Cases and create a Data Value Realization Plan",
    "DVR.2": "As part of the Data Revenue Generation Process, the Entity shall for each Data or Data product expecting to generate revenue from select an appropriate Pricing Scheme Model, calculate and document the Total Cost, define and document the adopted Charging Model after reviewing it from Chief Data Office, and submit a revenue generation request",
    "DVR.3": "As part of the Monitoring and Maintenance control, the Entity shall actively monitor and maintain implemented Data Value Realization Use Cases",
    "DVR.4": "As part of the Performance Management control, the Entity establish key performance indicators (KPIs) to measure the Entity's Data Value Realization activities",
    # Open Data
    "OD.1": "As part of the Plan control, the Entity shall develop an Open Data Plan",
    "OD.2": "As part of the Training and Awareness control, the Entity shall plan awareness campaigns to promote the usage and benefits of Open Data",
    "OD.3": "As part of the Data Lifecycle Management control, the Entity shall identify, publish and maintain its Open Datasets",
    "OD.4": "As part of the Performance Management control, the Entity shall establish Key Performance indicators (KPIs) to measure the progress of the Open Data Plan",
    "OD.5": "As part of the Artifacts control, the Entity document in a register the list of all Open Datasets",
    # Freedom of Information
    "FOI.1": "As part of the Plan control, the Entity shall develop a Freedom of Information Plan to address both strategic and operational requirements of the National Data Management Office's Freedom of Information Regulations",
    "FOI.2": "As part of the Training and Awareness control, the Entity shall launch awareness campaigns to promote and enhance the culture of transparency and raise awareness of the National Data Management Office's Freedom of Information Regulations",
    "FOI.3": "As part of the Data Lifecycle Management control, the Entity shall design and implement a request process, publish Public Entity Publication, prepare request forms, determine request fees, and monitor compliance",
    "FOI.4": "As part of the Artifacts control, the Entity document in a register compliance records required by the National Data Management Office's Freedom of Information Regulations",
    # Data Classification
    "DC.1": "As part of the Plan control, the Entity shall develop a Data Classification Plan and prioritize its datasets and artifacts",
    "DC.2": "As part of the Classification Controls, the Entity shall assign data handling and protection controls to datasets and artifacts",
    "DC.3": "As part of the Classification Process control, the Entity shall identify all datasets and artifacts owned by the Entity, conduct for them impact assessment of the potential damages and review assigned data classification levels",
    "DC.4": "As part of the Performance Management control, the Entity shall establish key performance indicators (KPIs) to measure the progress on the classification plan and implementation of the Entity's Data Classification process",
    "DC.5": "As part of the Artifacts control, the Entity document in a register the list of all its identified datasets and artifacts combined with log of Data Classification activities",
    # Personal Data Protection
    "PDP.1": "As part of the Plan control, the Entity shall conduct an Initial Personal Data Protection Assessment and establish a Personal Data Protection Plan to address privacy strategic and operational requirements",
    "PDP.2": "As part of the Training and Awareness control, the Entity shall conduct a Personal Data Protection training to promote a Personal Data Protection-centric culture",
    "PDP.3": "As part of the Data Breach control, the Entity shall establish a Data Breach Process",
    "PDP.4": "As part of the Data Lifecycle Management control, the Entity shall establish a Privacy Notice, Consent Management framework, its Data Subject Rights Processes, and conduct internal audits",
    "PDP.5": "As part of the Artefacts control, the Entity shall document in a register its compliance records",
}


def main():
    # 1) Patch the seed JSON (keyed by parent_section).
    with open(JSON_PATH, encoding="utf-8") as fh:
        data = json.load(fh)
    patched = 0
    for c in data.get("controls", []):
        desc = CONTROL_DESCRIPTIONS.get(c.get("parent_section"))
        if desc:
            c["control_description"] = desc
            patched += 1
    with open(JSON_PATH, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
    print(f"JSON: set control_description on {patched} specs")

    # 2) Backfill the live shared framework (id=14).
    db = open_tenant_session("complyverse")
    try:
        eng = db.get_bind()
        insp = inspect(eng)
        cols = {c["name"] for c in insp.get_columns("grc_parsed_framework_controls")}
        if "control_description" not in cols:
            with eng.begin() as conn:
                conn.execute(text("ALTER TABLE grc_parsed_framework_controls ADD COLUMN control_description TEXT"))
            print("added column control_description")
        total = 0
        for code, desc in CONTROL_DESCRIPTIONS.items():
            r = db.execute(text("""
                UPDATE grc_parsed_framework_controls
                SET control_description = :d
                WHERE uploaded_framework_id = 14 AND parent_section = :p
            """), {"d": desc, "p": code})
            total += r.rowcount
        db.commit()
        print(f"DB: backfilled control_description on {total} specs (fw id=14)")
        miss = db.execute(text("""
            SELECT DISTINCT parent_section FROM grc_parsed_framework_controls
            WHERE uploaded_framework_id = 14 AND control_description IS NULL
        """)).fetchall()
        print("controls still without a description:", [m[0] for m in miss])
    finally:
        db.close()


if __name__ == "__main__":
    main()
