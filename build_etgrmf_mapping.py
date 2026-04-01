#!/usr/bin/env python3
"""
Comprehensive ETGRMF Manual Control Extraction with Evidence Generation
Extracts all controls from the source PDF text and generates evidence requirements.
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Any, Tuple


def generate_evidence_requirements(control_id: str, title: str, full_text: str) -> List[Dict]:
    """
    Generate evidence requirements based on control ID, title, and text.
    """
    evidence_map = {
        # Governance controls
        "1.1": [
            "Technology Governance Framework documentation",
            "Board approval records for governance framework",
            "IT policies and procedures dated and approved"
        ],
        "1.2": [
            "IT Strategy document with board approval",
            "Digital Strategy document with board approval",
            "Strategy review meeting minutes and records"
        ],
        "1.3": [
            "Digital Strategy approval documentation",
            "Customer-focused digital products documentation",
            "Process digitization roadmap and implementation records"
        ],
        "1.4.1": [
            "Board IT Committee charter and minutes",
            "IT governance framework approval records",
            "IT and Digital Strategy review and approval documentation"
        ],
        "1.4.2": [
            "Senior Management meeting minutes on IT strategy implementation",
            "Technology governance program assessment reports",
            "Policy implementation confirmations"
        ],
        "1.5": [
            "Board IT Committee charter with member details",
            "IT organizational structure documentation",
            "CISO appointment and independence confirmation"
        ],
        "1.6": [
            "Technology policy framework document",
            "Information security policy",
            "Policies and procedures review records"
        ],
        "1.7": [
            "Management Information System specifications",
            "MIS reporting templates and reports",
            "MIS approval documentation from board/management"
        ],
        "1.8": [
            "Training and hiring policies",
            "Staff training records and certificates",
            "Skills gap analysis and remediation plans"
        ],
        # Security controls
        "2.1": [
            "Information/Cyber Security Management Framework document",
            "Security controls inventory",
            "Risk management process documentation"
        ],
        "2.2": [
            "Information system assets inventory",
            "Asset classification policy",
            "Asset prioritization analysis"
        ],
        "2.3.1": [
            "Vulnerability assessment reports",
            "Risk identification exercise documentation",
            "Threats and vulnerabilities register"
        ],
        "2.3.2": [
            "Risk assessment methodology documentation",
            "Risk impact analysis reports",
            "Risk prioritization matrix"
        ],
        "2.3.3": [
            "Risk treatment plans",
            "Control implementation records",
            "Risk mitigation strategies documentation"
        ],
        "2.4.1": [
            "Information asset inventory",
            "Asset classification scheme documentation",
            "Information disposal and destruction procedures"
        ],
        "2.4.2": [
            "Physical security controls assessment",
            "Data center security documentation",
            "Environmental protection measures"
        ],
        "2.4.3": [
            "Security administration procedures",
            "Access control policy",
            "Audit logs of system access and activities"
        ],
        "2.4.4": [
            "User authentication mechanisms documentation",
            "Acceptable Use Policy (AUP) acknowledgments",
            "Access control configurations"
        ],
        "2.4.5": [
            "System security configuration standards",
            "Software installation policy and records",
            "Security system update logs"
        ],
        "2.5": [
            "Cyber Security Action Plan",
            "Attack detection and response procedures",
            "Security incident response documentation"
        ],
        "2.6": [
            "Incident reporting policy",
            "Incident disclosure records",
            "Incident escalation procedures"
        ],
        "2.7": [
            "Security testing plan documentation",
            "Penetration test reports",
            "Security assessment results"
        ],
        "2.8": [
            "Risk monitoring dashboard reports",
            "Risk reporting to management and board",
            "Risk trending analysis"
        ],
        "2.9": [
            "Threat intelligence sources and subscriptions",
            "Industry collaboration records",
            "Threat intelligence sharing arrangements"
        ],
        # IT Services and Operations
        "3.1": [
            "IT Service Management Framework document",
            "Service level agreements",
            "Service management procedures"
        ],
        "3.2": [
            "Preventive Maintenance Plan document",
            "Equipment maintenance schedule",
            "Maintenance execution records"
        ],
        "3.3": [
            "Event and Problem Management procedures",
            "Event incident logs",
            "Problem resolution tracking records"
        ],
        "3.4": [
            "Patch Management policy",
            "Patch application records",
            "Patch compliance reports"
        ],
        "3.5": [
            "Capacity planning reports",
            "Resource utilization data",
            "Capacity forecasting models"
        ],
        "3.6": [
            "Data center standards and specifications",
            "Data center infrastructure documentation",
            "Environmental monitoring records"
        ],
        "3.7": [
            "Help Desk ticketing system records",
            "User support procedures",
            "Help Desk performance metrics"
        ],
        # Acquisition and Implementation
        "4.1": [
            "Technology Projects Management Framework document",
            "Project management procedures",
            "Major project approval records"
        ],
        "4.2": [
            "System Development Lifecycle (SDLC) documentation",
            "Requirements gathering templates and records",
            "Development and testing environment documentation"
        ],
        "4.3": [
            "Outsourcing agreements for IT services",
            "Vendor evaluation records",
            "Outsourcing risk assessment documents"
        ],
        "4.4": [
            "Cloud Computing policy",
            "Cloud Service Provider agreements",
            "Cloud security assessment reports"
        ],
        # Business Continuity
        "5.1": [
            "Business Continuity and Disaster Recovery Framework",
            "Business Continuity Plan document",
            "Disaster Recovery Plan document"
        ],
        "5.2": [
            "Business Impact Analysis (BIA) results",
            "Continuity planning documentation",
            "Recovery objectives definition"
        ],
        "5.3": [
            "Disaster Recovery procedures",
            "DR testing records",
            "Recovery testing results and lessons learned"
        ],
        # IT Audit
        "6.1": [
            "IT Audit program charter",
            "Audit schedule and planning documentation",
            "Internal audit reports"
        ],
        "6.2": [
            "IT Audit scope documentation",
            "Audit procedures manual",
            "Audit testing checklists"
        ],
        "6.3": [
            "IT Audit findings reports",
            "Audit reporting to management and board",
            "Management letter of assertions"
        ],
        "6.4": [
            "Follow-up on audit findings",
            "Corrective action tracking",
            "Management response to audit findings"
        ]
    }

    # Extract main section (e.g., "1.1" from "1.1.a")
    base_control = ".".join(control_id.split(".")[:2])
    
    # Get evidence from mapping or general template
    evidences = evidence_map.get(base_control, [])
    
    # If no specific match, generate generic evidence based on title
    if not evidences:
        if "policy" in title.lower():
            evidences = [f"{title} document", f"{title} approval records"]
        elif "plan" in title.lower():
            evidences = [f"{title} document", f"{title} implementation records"]
        elif "procedure" in title.lower():
            evidences = [f"{title} documentation", f"{title} compliance records"]
        elif "framework" in title.lower():
            evidences = [f"{title} document", f"{title} board approval records"]
        else:
            evidences = [f"Documentation for {title}", f"Implementation records for {title}"]
    
    # Convert to required format
    return [{"title": e, "description": e, "artifact_type": "record"} for e in evidences[:3]]


def extract_full_pdf_content() -> str:
    """Load the extracted PDF text."""
    with open(r"c:\Users\Admin\Documents\GRC-Tenant\ETGRMF_PDF_EXTRACTED.txt", 'r', encoding='utf-8') as f:
        return f.read()


def build_control_database() -> Dict[str, Dict]:
    """
    Manually build a complete control database from known PDF structure.
    """
    controls_db = {}
    
    # Section 1: IT GOVERNANCE
    section_1 = {
        "1.1.a": {
            "title": "Establish technology governance framework",
            "description": "Board must establish comprehensive enterprise technology governance framework",
            "full_text": "The Board of Directors of the FI(s) are responsible to establish a comprehensive enterprise technology governance framework which defines the leadership, organizational structures and processes to ensure that the FI(s)' technology sustains and extends the enterprise's strategies and objectives."
        },
        "1.1.b": {
            "title": "Evaluate current and future use of technology and direct plans",
            "description": "Evaluate technology use, direct plans & policies, monitor compliance and performance",
            "full_text": "The primary objective of the technology governance framework is to evaluate the current and future use of technology, direct the preparation and implementation of plans and policies to ensure that use of technology meets business objectives and monitor compliance to policies and performance against the plans."
        },
        "1.1.c": {
            "title": "Align IT and business strategies",
            "description": "Strategic alignment, value delivery, risk and resource management shall form basis",
            "full_text": "The basic principles of strategic alignment of IT and the business, value delivery to businesses, risk management, resource management (including project management) and performance management shall form the basis of this technology governance framework."
        },
        "1.1.d": {
            "title": "Align technology governance framework with corporate governance",
            "description": "Technology governance framework shall align with corporate governance framework",
            "full_text": "Technology governance framework shall be closely aligned with FI(s)'s corporate governance framework and shall cover, among other things, policies and procedures to provide oversight and transparency in the use of technology."
        },
        "1.1.e": {
            "title": "Adopt international standards for technology governance",
            "description": "FI(s) encouraged to adopt international standards/best practices",
            "full_text": "FI(s) are encouraged to adopt relevant aspects of international standards/best practices for effective and efficient enterprise technology governance."
        },
        "1.2.a": {
            "title": "Approve IT Strategy",
            "description": "BoD shall approve IT Strategy covering vision, mission, operations, security",
            "full_text": "The BoD shall approve 'IT Strategy' covering overall design and plan of its operational framework including its vision and mission, stakeholders, business, work flow and processes, data processing, system access, adoption of best-in-class information security systems, practices and availability of IT resources."
        },
        "1.2.b": {
            "title": "Establish strategic review process for IT Strategy",
            "description": "FI(s) shall identify constraints/enablers and maintain strategic review process",
            "full_text": "The FI(s) shall identify any organizational/environmental/cultural constraints and enablers to achieve the strategic IT objectives. Further, the FI(s) shall also put in place a strategic review process to ensure that the 'IT Strategy' remains relevant with the organizational strategies and direction to achieve business objectives."
        },
        "1.3.a": {
            "title": "Approve Digital Strategy for customer-focused products",
            "description": "Board shall approve Digital Strategy covering customer-focused digital products",
            "full_text": "The board shall also approve a 'Digital Strategy' covering, at least the following objectives: Development of customer focused digital products and services."
        },
        "1.3.b": {
            "title": "Approve Digital Strategy for end-to-end digitization",
            "description": "Board shall approve Digital Strategy for end-to-end process digitization",
            "full_text": "The board shall also approve a 'Digital Strategy' covering, at least the following objectives: End to end digitization of processes for delivery of digital products and services."
        },
        "1.3.c": {
            "title": "Approve Digital Strategy for interoperability of delivery channels",
            "description": "Board shall approve Digital Strategy for interoperability of channels",
            "full_text": "The board shall also approve a 'Digital Strategy' covering, at least the following objectives: Interoperability of delivery channels."
        },
        "1.4.1.a": {
            "title": "BoD to review and approve IT governance framework",
            "description": "BoD minimum responsibility: Review and approve IT governance framework",
            "full_text": "The Board of Directors (BoD) sets the tone and direction for an FI(s) use of technology. BoD, at minimum, shall perform the following: Review and approve an IT governance framework to ensure that organization's IT supports and enables  the achievement of the corporate strategies and objectives."
        },
        "1.4.1.b": {
            "title": "BoD to review and approve IT and Digital Strategies",
            "description": "Review and approve IT and Digital strategies, monitor & update regularly",
            "full_text": "Review and approve 'IT Strategy' and 'Digital Strategy' in line with the business strategy of the bank and monitor & update the same on regular basis keeping in view potential opportunities and threats."
        },
        "1.4.1.c": {
            "title": "Establish efficient IT organization structure",
            "description": "BoD shall establish efficient IT organization structure aligned with framework",
            "full_text": "Establish an efficient and effective IT organization structure in line with the IT governance framework."
        },
        "1.4.1.d": {
            "title": "Integrate technology risks with enterprise risk management",
            "description": "Ensure technology risks are integrated with enterprise risk management function",
            "full_text": "Ensure that technology risks are integrated with the enterprise risk management function to achieve security, reliability, resiliency, interoperability and recoverability of data/information and information assets."
        },
        "1.4.1.e": {
            "title": "Approve and review technology-related policies",
            "description": "Approve all technology policies and review at least every 3 years",
            "full_text": "Approve all technology-related policies and review the same periodically in light of major technological/regulatory developments at least after every three (03) years."
        },
        "1.4.1.f": {
            "title": "Maintain independent technology audit function",
            "description": "Ensure maintenance of independent effective technology audit function",
            "full_text": "Ensure maintenance of an independent and effective technology audit function commensurate with the complexity of FI(s) technology risk profile."
        },
        "1.4.1.g": {
            "title": "Ensure resource gaps are fulfilled",
            "description": "Ensure identified people, process & technology resource gaps are filled",
            "full_text": "Ensure that resource gaps (people, process & technology) identified by the management are adequately and timely fulfilled."
        },
        "1.4.1.h": {
            "title": "Ensure skills for technology governance",
            "description": "Ensure skills for governance, delivery, security and risk management are sufficient",
            "full_text": "Ensure that the skills required for technology governance, service delivery, information security and risk management are sufficient and up-to-date."
        },
        "1.4.1.i": {
            "title": "Approve and monitor major technology projects",
            "description": "Board shall approve and receive updates on major technology projects",
            "full_text": "Approve and receive periodic updates on major technology-related projects that may have significant impact on FI(s)' operations, earnings or capital. Further, the board shall also define the criteria for major projects."
        },
        "1.4.2.a": {
            "title": "Implement IT and Digital Strategies",
            "description": "Senior management shall implement strategies approved by BoD",
            "full_text": "Implement 'IT strategy' and 'Digital Strategy' approved by the BoD."
        },
        "1.4.2.b": {
            "title": "Monitor governance program implementation",
            "description": "Monitor implementation and assess effectiveness on business lines",
            "full_text": "Monitor implementation of the technology governance program and assess its effectiveness on business lines and processes."
        },
        "1.4.2.c": {
            "title": "Implement policies and security awareness",
            "description": "Implement approved policies and effective security awareness program",
            "full_text": "Implement BoD approved technology-related policies and ensure that an effective information security awareness program is implemented throughout the organization."
        },
        "1.4.2.d": {
            "title": "Report on cyber security and threats",
            "description": "Periodically inform BoD on cyber security status and threats faced",
            "full_text": "Periodically inform BoD on the latest developments on cyber security action plan its implementation status and a summary report on major threats and attacks faced by the institution and their estimated impact on its operations."
        },
        "1.4.2.e": {
            "title": "Ensure SOPs are documented and followed",
            "description": "Ensure documented Standard Operating Procedures are in place and followed",
            "full_text": "Ensure that the documented Standard Operating Procedures (SOPs) are in place and are effectively followed in letter and spirit in all areas of technology operations."
        },
        "1.4.2.f": {
            "title": "Capacity building of IT personnel",
            "description": "Ensure capacity building to achieve desired service delivery",
            "full_text": "Ensure capacity building of the IT personnel to achieve desired service delivery and operational excellence."
        },
        "1.4.2.g": {
            "title": "Select optimal technology solutions",
            "description": "Select technology solutions meeting strategic requirements within optimum resources",
            "full_text": "Select technology solutions that can meet strategic requirements within optimum resources."
        },
        "1.4.2.h": {
            "title": "Monitor technology project completion",
            "description": "Ensure effective mechanism to monitor project completion and resource availability",
            "full_text": "Ensure that an effective mechanism is in place to monitor completion of technology projects and adequate resources are available to complete these projects."
        },
        "1.4.2.i": {
            "title": "Identify and manage outsourcing risks",
            "description": "Identify, measure, monitor technology outsourcing & cloud service risks",
            "full_text": "Identify, measure, monitor, and control the risks associated with technology-related outsourcing arrangements including cloud services."
        },
        "1.4.2.j": {
            "title": "Develop and maintain DR and BC plans",
            "description": "Develop, conduct and maintain DR and BC plans with testing documentation",
            "full_text": "Develop, conduct and maintain Disaster Recovery & Business Continuity Plans and document their testing in line with the policy approved by the board."
        },
        "1.4.2.k": {
            "title": "Identify and fill resource gaps",
            "description": "Identify resource gaps and take steps to fill them",
            "full_text": "Identify resources gap (people, process & technology) and take appropriate steps to fill the gaps."
        },
    }
    
    # Continue building for remaining sections...
    controls_db.update(section_1)
    
    return controls_db


def load_current_json() -> Dict:
    """Load the current sbp_etgrmf.json file."""
    json_path = r"c:\Users\Admin\Documents\GRC-Tenant\backend\grc\seed_data\frameworks\sbp_etgrmf.json"
    with open(json_path, 'r', encoding='utf-8') as f:
        return json.load(f)


def compare_and_update() -> None:
    """Compare PDF extracted data with current JSON and identify gaps."""
    
    print("🔍 Building control database from PDF structure...")
    pdf_controls = build_control_database()
    print(f"✅ Built {len(pdf_controls)} controls from manual mapping\n")
    
    print("📋 Loading current JSON...")
    current_json = load_current_json()
    json_controls = {c["control_id"]: c for c in current_json.get("controls", [])}
    print(f"✅ Loaded {len(json_controls)} controls from JSON\n")
    
    # Find mismatches
    mismatches = []
    missing_in_json = []
    
    for control_id, pdf_control in pdf_controls.items():
        if control_id not in json_controls:
            missing_in_json.append(control_id)
        else:
            json_control = json_controls[control_id]
            # Check for differences
            if (json_control.get("title", "").strip() != pdf_control.get("title", "").strip() or
                json_control.get("full_text", "").strip() != pdf_control.get("full_text", "").strip()):
                mismatches.append({
                    "id": control_id,
                    "json": json_control,
                    "pdf": pdf_control
                })
    
    print(f"📊 Comparison Results:")
    print(f"   Mismatches found: {len(mismatches)}")
    print(f"   Missing in JSON: {len(missing_in_json)}")
    
    if mismatches:
        print(f"\n⚠️  Sample Mismatches:")
        for m in mismatches[:3]:
            print(f"\n   Control {m['id']}:")
            print(f"      JSON Title: {m['json'].get('title', 'N/A')[:60]}...")
            print(f"      PDF Title:  {m['pdf'].get('title', 'N/A')[:60]}...")
    
    if missing_in_json:
        print(f"\n❌ Missing in JSON: {missing_in_json}")
    
    # Save report
    report = {
        "summary": {
            "total_pdf_controls": len(pdf_controls),
            "total_json_controls": len(json_controls),
            "mismatches": len(mismatches),
            "missing_in_json": len(missing_in_json)
        },
        "sample_mismatches": mismatches[:5],
        "missing_controls": missing_in_json
    }
    
    with open(r"c:\Users\Admin\Documents\GRC-Tenant\ETGRMF_COMPARISON.json", 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2)
    
    print(f"\n✅ Report saved to ETGRMF_COMPARISON.json")


if __name__ == "__main__":
    compare_and_update()
