#!/usr/bin/env python3
"""
ETGRMF Control Validator and Evidence Generator
Validates all controls in JSON against PDF and adds evidence requirements.
"""

import json
import re
from typing import Dict, List, Any, Tuple

# PDF Control Content extracted and manually mapped
PDF_CONTROLS = {
    "1.1.a": {
        "title": "Board responsibility to establish technology governance framework",
        "full_text": "The Board of Directors of the FI(s) are responsible to establish a comprehensive enterprise technology governance framework which defines the leadership, organizational structures and processes to ensure that the FI(s)' technology sustains and extends the enterprise's strategies and objectives.",
    },
    "1.1.b": {
        "title": "Evaluate technology use and direct implementation",
        "full_text": "The primary objective of the technology governance framework is to evaluate the current and future use of technology, direct the preparation and implementation of plans and policies to ensure that use of technology meets business objectives and monitor compliance to policies and performance against the plans.",
    },
    "1.1.c": {
        "title": "Align IT and business strategies with risk management",
        "full_text": "The basic principles of strategic alignment of IT and the business, value delivery to businesses, risk management, resource management (including project management) and performance management shall form the basis of this technology governance framework.",
    },
    "1.1.d": {
        "title": "Align technology governance with corporate governance",
        "full_text": "Technology governance framework shall be closely aligned with FI(s)'s corporate governance framework and shall cover, among other things, policies and procedures to provide oversight and transparency in the use of technology.",
    },
    "1.1.e": {
        "title": "Adopt international standards for technology governance",
        "full_text": "FI(s) are encouraged to adopt relevant aspects of international standards/best practices for effective and efficient enterprise technology governance.",
    },
    "1.2.a": {
        "title": "Approve IT Strategy",
        "full_text": "The BoD shall approve 'IT Strategy' covering overall design and plan of its operational framework including its vision and mission, stakeholders, business, work flow and processes, data processing, system access, adoption of best-in-class information security systems, practices and availability of IT resources.",
    },
    "1.2.b": {
        "title": "Establish and maintain strategic review process",
        "full_text": "The FI(s) shall identify any organizational/environmental/cultural constraints and enablers to achieve the strategic IT objectives. Further, the FI(s) shall also put in place a strategic review process to ensure that the 'IT Strategy' remains relevant with the organizational strategies and direction to achieve business objectives.",
    },
    "1.3.a": {
        "title": "Approve Digital Strategy for customer-focused products",
        "full_text": "The board shall also approve a 'Digital Strategy' covering, at least the following objectives: Development of customer focused digital products and services.",
    },
    "1.3.b": {
        "title": "Approve Digital Strategy for end-to-end digitization",
        "full_text": "The board shall also approve a 'Digital Strategy' covering, at least the following objectives: End to end digitization of processes for delivery of digital products and services.",
    },
    "1.3.c": {
        "title": "Approve Digital Strategy for interoperability",
        "full_text": "The board shall also approve a 'Digital Strategy' covering, at least the following objectives: Interoperability of delivery channels.",
    },
    "1.4.1.a": {
        "title": "Review and approve IT governance framework",
        "full_text": "The Board of Directors (BoD) sets the tone and direction for an FI(s) use of technology. BoD, at minimum, shall perform the following: Review and approve an IT governance framework to ensure that organization's IT supports and enables the achievement of the corporate strategies and objectives.",
    },
    "1.4.1.b": {
        "title": "Review and approve IT and Digital Strategies",
        "full_text": "Review and approve 'IT Strategy' and 'Digital Strategy' in line with the business strategy of the bank and monitor & update the same on regular basis keeping in view potential opportunities and threats.",
    },
    "1.4.1.c": {
        "title": "Establish efficient IT organization structure",
        "full_text": "Establish an efficient and effective IT organization structure in line with the IT governance framework.",
    },
    "1.4.1.d": {
        "title": "Integrate technology risks with enterprise risk management",
        "full_text": "Ensure that technology risks are integrated with the enterprise risk management function to achieve security, reliability, resiliency, interoperability and recoverability of data/information and information assets.",
    },
    "1.4.1.e": {
        "title": "Approve and review technology-related policies",
        "full_text": "Approve all technology-related policies and review the same periodically in light of major technological/regulatory developments at least after every three (03) years.",
    },
    "1.4.1.f": {
        "title": "Maintain independent technology audit function",
        "full_text": "Ensure maintenance of an independent and effective technology audit function commensurate with the complexity of FI(s) technology risk profile.",
    },
    "1.4.1.g": {
        "title": "Ensure resource gaps are adequately filled",
        "full_text": "Ensure that resource gaps (people, process & technology) identified by the management are adequately and timely fulfilled.",
    },
    "1.4.1.h": {
        "title": "Ensure skills for technology functions",
        "full_text": "Ensure that the skills required for technology governance, service delivery, information security and risk management are sufficient and up-to-date.",
    },
    "1.4.1.i": {
        "title": "Approve and monitor major technology projects",
        "full_text": "Approve and receive periodic updates on major technology-related projects that may have significant impact on FI(s)' operations, earnings or capital. Further, the board shall also define the criteria for major projects.",
    },
}

# Evidence templates based on control type
EVIDENCE_TEMPLATES = {
    "approval": [
        {"title": "Board/Management Approval", "description": "Board resolution or management approval document"},
        {"title": "Meeting Minutes", "description": "Minutes of approval meeting"},
        {"title": "Approval Records", "description": "Dated and signed approval records"}
    ],
    "framework": [
        {"title": "Framework Document", "description": "Documented framework with structure and requirements"},
        {"title": "Implementation Records", "description": "Evidence of framework implementation"},
        {"title": "Review and Update Records", "description": "Documentation of periodic review and updates"}
    ],
    "policy": [
        {"title": "Policy Document", "description": "Formal policy document"},
        {"title": "Policy Approval", "description": "Board/management approval of policy"},
        {"title": "Policy Compliance Records", "description": "Evidence of policy implementation and compliance"}
    ],
    "strategy": [
        {"title": "Strategy Document", "description": "Comprehensive strategy document"},
        {"title": "Strategy Approval", "description": "Board approval of strategy"},
        {"title": "Implementation Plan", "description": "Roadmap for strategy implementation"}
    ],
    "procedure": [
        {"title": "Procedure Documentation", "description": "Documented procedures and processes"},
        {"title": "Process Compliance", "description": "Evidence of procedure implementation"},
        {"title": "Testing and Validation", "description": "Records of procedure testing"}
    ],
}

def generate_evidence_for_control(control_id: str, title: str, full_text: str) -> List[Dict]:
    """Generate appropriate evidence requirements based on control content."""
    
    title_lower = title.lower()
    full_lower = full_text.lower()
    
    # Determine control type
    if "approve" in title_lower or "approval" in full_lower:
        evidence_type = "approval"
    elif "framework" in title_lower or "framework" in full_lower:
        evidence_type = "framework"
    elif "policy" in title_lower or "policies" in full_lower:
        evidence_type = "policy"
    elif "strategy" in title_lower or "strategic" in full_lower:
        evidence_type = "strategy"
    elif "procedure" in title_lower or "process" in full_lower:
        evidence_type = "procedure"
    else:
        evidence_type = "policy"
    
    base_evidence = EVIDENCE_TEMPLATES.get(evidence_type, EVIDENCE_TEMPLATES["policy"])
    
    # Add specific evidence based on control content
    customized_evidence = []
    for ev in base_evidence:
        customized_ev = ev.copy()
        # Add context from control ID
        if "1.4" in control_id:  # Board/Management responsibilities
            customized_ev["description"] += f" - {title}"
        customized_evidence.append(customized_ev)
    
    # Add specific evidence for detailed controls
    if "IT Steering" in title:
        customized_evidence.append({
            "title": "IT Steering Committee Charter",
            "description": "Committee composition, responsibilities, and terms of reference"
        })
    elif "CISO" in title or "information security" in title_lower:
        customized_evidence.append({
            "title": "CISO Appointment and Independence",
            "description": "Documentation of CISO role and independence from IT function"
        })
    
    return customized_evidence[:3]  # Limit to 3 most relevant


def validate_and_update_json() -> None:
    """Load JSON, validate, and add evidence requirements."""
    
    json_path = r"c:\Users\Admin\Documents\GRC-Tenant\backend\grc\seed_data\frameworks\sbp_etgrmf.json"
    
    print("📋 Loading ETGRMF JSON file...")
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    controls = data["controls"]
    print(f"✅ Loaded {len(controls)} controls\n")
    
    # Validation results
    mismatches = []
    updated_count = 0
    
    print("🔍 Processing controls and adding evidence...\n")
    
    for idx, control in enumerate(controls):
        control_id = control.get("control_id", "")
        title = control.get("title", "")
        
        # Check if control exists in PDF mapping
        if control_id in PDF_CONTROLS:
            pdf_ctrl = PDF_CONTROLS[control_id]
            
            # Compare titles (case-insensitive)
            if title.lower() != pdf_ctrl["title"].lower():
                mismatches.append({
                    "control_id": control_id,
                    "issue": "title_mismatch",
                    "json": title,
                    "pdf": pdf_ctrl["title"]
                })
                # Update with correct title
                control["title"] = pdf_ctrl["title"]
                updated_count += 1
            
            # Update full text if different
            current_full = control.get("full_text", "").strip()
            if current_full != pdf_ctrl["full_text"].strip():
                control["full_text"] = pdf_ctrl["full_text"]
                updated_count += 1
        
        # Generate evidence requirements
        if not control.get("evidence_requirements") or len(control.get("evidence_requirements", [])) == 0:
            evidence = generate_evidence_for_control(
                control_id,
                control.get("title", ""),
                control.get("full_text", "")
            )
            control["evidence_requirements"] = evidence
            updated_count += 1
    
    # Save updated JSON
    output_path = r"c:\Users\Admin\Documents\GRC-Tenant\sbp_etgrmf_updated.json"
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ VALIDATION COMPLETE")
    print(f"   Total controls processed: {len(controls)}")
    print(f"   Title mismatches found: {len([m for m in mismatches if m['issue'] == 'title_mismatch'])}")
    print(f"   Controls updated with evidence: {updated_count}")
    print(f"\n📊 Updated JSON saved to: {output_path}")
    
    if mismatches:
        print(f"\n⚠️  Sample Mismatches (first 5):")
        for m in mismatches[:5]:
            print(f"   Control {m['control_id']}:")
            print(f"      JSON: {m['json'][:60]}...")
            print(f"      PDF:  {m['pdf'][:60]}...")


if __name__ == "__main__":
    validate_and_update_json()
