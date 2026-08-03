#!/usr/bin/env python3
"""
Batch Framework Parser Script

Parses multiple regulatory framework PDFs and pre-seeds them in the database.
Uses PyMuPDF for text extraction and existing AI parsing functions.

Usage:
    cd backend && python -m grc.scripts.batch_parse_frameworks
"""

import os
import sys
import json
import uuid
import shutil
import traceback
from datetime import datetime
from typing import Optional, List, Dict, Any

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import fitz
from openai import OpenAI

from grc.models import (
    SessionLocal, UploadedFramework, ParsedFrameworkControl, 
    ControlEvidenceMapping, Tenant, GRCUser
)
from grc.scripts.export_frameworks_to_json import export_framework_to_json

UPLOAD_DIR = "uploads/frameworks"
SEED_DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "seed_data", "frameworks"
)

FRAMEWORK_DEFINITIONS = [
    {
        "source_path": "/home/runner/workspace/attached_assets/CSCF_v2024_20231017_1769599586174.pdf",
        "name": "SWIFT CSCF v2024",
        "description": "SWIFT Customer Security Controls Framework - mandatory security controls for all SWIFT users",
        "version": "v2024",
        "source_organization": "SWIFT",
        "classification": "certification",
        "framework_type": "certification",
        "certification_body": "SWIFT (Society for Worldwide Interbank Financial Telecommunication)",
        "certification_validity_period": "Annual",
        "certification_levels": ["Mandatory", "Advisory"],
        "certification_lifecycle": {
            "phases": [
                {"name": "Self-Assessment", "description": "Complete self-assessment against all mandatory controls"},
                {"name": "External Assessment", "description": "Independent assessment for Architecture Types A1, A2, and A3"},
                {"name": "Attestation", "description": "Submit attestation via KYC-SA application"},
                {"name": "Maintenance", "description": "Continuous monitoring and annual re-attestation"}
            ]
        },
        "required_artifacts": [
            "Security architecture documentation",
            "Network segmentation evidence",
            "Access control policies and procedures",
            "Incident response plans",
            "Operator session management logs"
        ],
        "framework_purpose": "Establish baseline security requirements for all SWIFT network participants to protect the global financial messaging ecosystem.",
        "framework_scope": "All organizations connected to the SWIFT network including banks, financial institutions, and service bureaus.",
        "framework_objectives": [
            "Secure your environment",
            "Know and limit access",
            "Detect and respond to threats"
        ],
        "target_audience": "SWIFT network participants, IT security teams, compliance officers",
        "regulatory_authority": "SWIFT"
    },
    {
        "source_path": "/home/runner/workspace/attached_assets/PCI-DSS-v4_0_1_1769599586174.pdf",
        "name": "PCI-DSS v4.0.1",
        "description": "Payment Card Industry Data Security Standard - requirements for protecting cardholder data",
        "version": "v4.0.1",
        "source_organization": "PCI Security Standards Council",
        "classification": "certification",
        "framework_type": "certification",
        "certification_body": "PCI Security Standards Council (PCI SSC)",
        "certification_validity_period": "Annual",
        "certification_levels": ["Level 1", "Level 2", "Level 3", "Level 4"],
        "certification_lifecycle": {
            "phases": [
                {"name": "Scoping", "description": "Identify all systems in scope for PCI DSS"},
                {"name": "Gap Assessment", "description": "Assess current state against PCI DSS requirements"},
                {"name": "Remediation", "description": "Address gaps and implement required controls"},
                {"name": "Assessment", "description": "QSA or ISA assessment depending on merchant level"},
                {"name": "Attestation", "description": "Complete and submit Attestation of Compliance (AOC)"},
                {"name": "Maintenance", "description": "Continuous monitoring and quarterly vulnerability scans"}
            ]
        },
        "required_artifacts": [
            "Network diagrams showing CDE boundaries",
            "Data flow diagrams for cardholder data",
            "Policies and procedures for each requirement",
            "Quarterly ASV scan reports",
            "Annual penetration test reports",
            "Security awareness training records"
        ],
        "framework_purpose": "Protect cardholder data wherever it is processed, stored, or transmitted through implementation of technical and operational controls.",
        "framework_scope": "All entities that store, process, or transmit cardholder data or sensitive authentication data.",
        "framework_objectives": [
            "Build and Maintain a Secure Network and Systems",
            "Protect Account Data",
            "Maintain a Vulnerability Management Program",
            "Implement Strong Access Control Measures",
            "Regularly Monitor and Test Networks",
            "Maintain an Information Security Policy"
        ],
        "target_audience": "Merchants, payment processors, acquirers, issuers, and service providers",
        "regulatory_authority": "PCI SSC"
    },
    {
        "source_path": "/home/runner/workspace/attached_assets/SBP_-_CLOUD_outsourcing_framrwork_1769599586175.pdf",
        "name": "SBP Cloud Outsourcing Framework",
        "description": "State Bank of Pakistan framework for cloud outsourcing by financial institutions",
        "version": "2022",
        "source_organization": "State Bank of Pakistan",
        "classification": "compliance",
        "framework_type": "regulatory",
        "regulatory_authority": "State Bank of Pakistan (SBP)",
        "penalty_for_non_compliance": "Regulatory sanctions, fines, and potential suspension of cloud services",
        "adoption_approach": {
            "steps": [
                {"name": "Risk Assessment", "description": "Conduct comprehensive risk assessment before cloud adoption"},
                {"name": "Due Diligence", "description": "Perform thorough due diligence on cloud service providers"},
                {"name": "Contractual Requirements", "description": "Ensure contracts meet SBP requirements"},
                {"name": "Implementation", "description": "Implement required security controls"},
                {"name": "Monitoring", "description": "Establish ongoing monitoring and governance"}
            ]
        },
        "framework_purpose": "Provide guidance for regulated financial institutions on the secure adoption of cloud computing services.",
        "framework_scope": "All SBP-regulated financial institutions considering or using cloud services.",
        "framework_objectives": [
            "Ensure data protection and privacy",
            "Maintain operational resilience",
            "Manage third-party risks",
            "Enable regulatory oversight"
        ],
        "target_audience": "Banks, DFIs, and microfinance banks in Pakistan"
    },
    {
        "source_path": "/home/runner/workspace/attached_assets/SBP_-_Internet_Banking_Framework_1769599586178.pdf",
        "name": "SBP Internet Banking Framework",
        "description": "State Bank of Pakistan framework for internet and mobile banking security",
        "version": "2022",
        "source_organization": "State Bank of Pakistan",
        "classification": "compliance",
        "framework_type": "regulatory",
        "regulatory_authority": "State Bank of Pakistan (SBP)",
        "penalty_for_non_compliance": "Regulatory sanctions and potential restriction of digital banking services",
        "adoption_approach": {
            "steps": [
                {"name": "Board Approval", "description": "Obtain board-level approval for internet banking"},
                {"name": "Policy Development", "description": "Develop comprehensive security policies"},
                {"name": "Technical Implementation", "description": "Implement required security controls"},
                {"name": "Testing", "description": "Conduct security testing including VAPT"},
                {"name": "Go-Live", "description": "Launch with proper monitoring controls"},
                {"name": "Continuous Monitoring", "description": "Ongoing security monitoring and updates"}
            ]
        },
        "framework_purpose": "Ensure secure deployment and operation of internet and mobile banking services by regulated financial institutions.",
        "framework_scope": "All SBP-regulated banks and DFIs offering internet and mobile banking.",
        "framework_objectives": [
            "Secure customer authentication",
            "Protect transaction integrity",
            "Ensure service availability",
            "Enable fraud prevention"
        ],
        "target_audience": "Banks and DFIs in Pakistan offering digital banking"
    },
    {
        "source_path": "/home/runner/workspace/attached_assets/SABIC_CyberTrust_Guidelines_v1-0_1769599586174.pdf",
        "name": "SABIC CyberTrust Guidelines v1.0",
        "description": "SABIC cybersecurity guidelines for industrial control systems and corporate networks",
        "version": "v1.0",
        "source_organization": "SABIC",
        "classification": "compliance",
        "framework_type": "industry_standard",
        "regulatory_authority": "SABIC Corporate Cybersecurity",
        "penalty_for_non_compliance": "Internal non-compliance findings and remediation requirements",
        "adoption_approach": {
            "steps": [
                {"name": "Gap Assessment", "description": "Assess current state against SABIC requirements"},
                {"name": "Remediation Planning", "description": "Develop remediation roadmap"},
                {"name": "Implementation", "description": "Implement required controls"},
                {"name": "Validation", "description": "Validate control implementation"},
                {"name": "Continuous Improvement", "description": "Ongoing monitoring and improvement"}
            ]
        },
        "framework_purpose": "Establish minimum cybersecurity requirements for SABIC facilities and business partners.",
        "framework_scope": "All SABIC manufacturing sites, joint ventures, and third-party service providers.",
        "framework_objectives": [
            "Protect industrial control systems",
            "Secure corporate network",
            "Ensure supply chain security",
            "Enable incident response capability"
        ],
        "target_audience": "SABIC affiliates, JVs, and vendors"
    },
    {
        "source_path": "/home/runner/workspace/attached_assets/ARAMCO_CCC_1769600765257.pdf",
        "name": "ARAMCO CCC (Cybersecurity Compliance Checklist)",
        "description": "Saudi Aramco Third Party Cybersecurity Standard for vendors and contractors",
        "version": "2024",
        "source_organization": "Saudi Aramco",
        "classification": "compliance",
        "framework_type": "industry_standard",
        "regulatory_authority": "Saudi Aramco Cybersecurity",
        "penalty_for_non_compliance": "Contract non-compliance, remediation requirements, potential business impact",
        "adoption_approach": {
            "steps": [
                {"name": "Self-Assessment", "description": "Complete CCC self-assessment"},
                {"name": "Evidence Collection", "description": "Gather evidence for all applicable controls"},
                {"name": "Submission", "description": "Submit assessment to Aramco"},
                {"name": "Review", "description": "Aramco review and feedback"},
                {"name": "Remediation", "description": "Address any identified gaps"},
                {"name": "Certification", "description": "Obtain CCC certification"}
            ]
        },
        "framework_purpose": "Ensure third-party vendors and contractors meet minimum cybersecurity requirements when working with Saudi Aramco.",
        "framework_scope": "All third-party vendors, contractors, and service providers to Saudi Aramco.",
        "framework_objectives": [
            "Protect Aramco data and systems",
            "Ensure vendor security posture",
            "Manage supply chain cyber risks",
            "Enable secure business partnerships"
        ],
        "target_audience": "Aramco vendors, contractors, and service providers"
    },
    {
        "source_path": "/home/runner/workspace/attached_assets/GDPR-Regulation-English_1769600765257.pdf",
        "name": "GDPR (General Data Protection Regulation)",
        "description": "European Union regulation on data protection and privacy",
        "version": "2016/679",
        "source_organization": "European Union",
        "classification": "compliance",
        "framework_type": "regulatory",
        "regulatory_authority": "European Data Protection Board (EDPB) and National Data Protection Authorities",
        "penalty_for_non_compliance": "Fines up to €20 million or 4% of annual global turnover, whichever is higher",
        "adoption_approach": {
            "steps": [
                {"name": "Data Mapping", "description": "Map all personal data processing activities"},
                {"name": "Legal Basis Assessment", "description": "Identify legal basis for each processing activity"},
                {"name": "Gap Assessment", "description": "Assess compliance gaps against GDPR requirements"},
                {"name": "Policy Development", "description": "Develop or update privacy policies and procedures"},
                {"name": "Technical Measures", "description": "Implement required technical safeguards"},
                {"name": "Training", "description": "Train staff on GDPR requirements"},
                {"name": "Ongoing Compliance", "description": "Maintain compliance through continuous monitoring"}
            ]
        },
        "framework_purpose": "Protect the fundamental rights of EU citizens regarding personal data processing and ensure free movement of data within the EU.",
        "framework_scope": "Any organization processing personal data of EU residents, regardless of the organization's location.",
        "framework_objectives": [
            "Lawfulness, fairness and transparency",
            "Purpose limitation",
            "Data minimization",
            "Accuracy",
            "Storage limitation",
            "Integrity and confidentiality",
            "Accountability"
        ],
        "target_audience": "Data controllers and processors handling EU resident data"
    },
    {
        "source_path": "/home/runner/workspace/attached_assets/NIST-CybersecurityFramework-V1.1_1769600765258.pdf",
        "name": "NIST Cybersecurity Framework v1.1",
        "description": "National Institute of Standards and Technology Cybersecurity Framework",
        "version": "v1.1",
        "source_organization": "NIST (National Institute of Standards and Technology)",
        "classification": "compliance",
        "framework_type": "best_practice",
        "regulatory_authority": "NIST (US Department of Commerce)",
        "penalty_for_non_compliance": "No direct penalties - voluntary framework, but may be mandated by contracts or regulations",
        "adoption_approach": {
            "steps": [
                {"name": "Prioritize and Scope", "description": "Identify business objectives and critical assets"},
                {"name": "Orient", "description": "Identify related systems, regulatory requirements, and risk approach"},
                {"name": "Create Current Profile", "description": "Assess current cybersecurity posture"},
                {"name": "Conduct Risk Assessment", "description": "Analyze operational environment and risks"},
                {"name": "Create Target Profile", "description": "Define desired cybersecurity outcomes"},
                {"name": "Determine Gaps", "description": "Compare current and target profiles"},
                {"name": "Implement Action Plan", "description": "Prioritize and implement improvements"}
            ]
        },
        "framework_purpose": "Provide a voluntary framework for organizations to manage and reduce cybersecurity risk through industry standards and best practices.",
        "framework_scope": "All organizations regardless of size, sector, or cybersecurity maturity level.",
        "framework_objectives": [
            "Identify - Asset Management, Risk Assessment",
            "Protect - Access Control, Awareness Training, Data Security",
            "Detect - Anomalies, Continuous Monitoring",
            "Respond - Response Planning, Communications, Analysis",
            "Recover - Recovery Planning, Improvements"
        ],
        "target_audience": "All organizations seeking to improve cybersecurity posture"
    }
]


def get_openai_client() -> OpenAI:
    """Get OpenAI client using Replit AI integration."""
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    
    if not api_key:
        raise RuntimeError("OpenAI API key not configured")
    
    if base_url and "modelfarm" in base_url:
        return OpenAI(api_key=api_key, base_url=base_url)
    
    return OpenAI(api_key=api_key, base_url=base_url)


def extract_text_from_pdf(file_path: str) -> str:
    """Extract text from PDF using PyMuPDF (fitz)."""
    print(f"  [EXTRACT] Opening PDF: {file_path}")
    doc = fitz.open(file_path)
    text_parts = []
    
    print(f"  [EXTRACT] PDF has {len(doc)} pages")
    for page_num, page in enumerate(doc, 1):
        text = page.get_text()
        if text.strip():
            text_parts.append(text)
        if page_num % 20 == 0:
            print(f"  [EXTRACT] Processed {page_num}/{len(doc)} pages...")
    
    doc.close()
    extracted = "\n\n".join(text_parts)
    print(f"  [EXTRACT] Extracted {len(extracted):,} characters from PDF")
    return extracted


def chunk_text(text: str, chunk_size: int = 20000, overlap: int = 2500) -> List[str]:
    """Split text into overlapping chunks for processing."""
    if len(text) <= chunk_size:
        return [text]
    
    chunks = []
    start = 0
    
    while start < len(text):
        end = min(start + chunk_size, len(text))
        
        if end < len(text):
            break_point = text.rfind('\n\n', start + chunk_size - overlap, end)
            if break_point == -1:
                break_point = text.rfind('\n', start + chunk_size - overlap, end)
            if break_point == -1:
                break_point = text.rfind('. ', start + chunk_size - overlap, end)
            if break_point > start:
                end = break_point + 1
        
        chunk_segment = text[start:end]
        if chunk_segment.strip():
            chunks.append(chunk_segment)
        
        next_start = end - overlap
        if next_start <= start:
            next_start = end
        start = next_start
        
        if start >= len(text):
            break
    
    return chunks


def infer_evidence_types(control_data: dict) -> List[str]:
    """Infer appropriate evidence types based on control content."""
    text = f"{control_data.get('title', '')} {control_data.get('description', '')} {control_data.get('full_text', '')}".lower()
    
    evidence_types = []
    
    if any(word in text for word in ['policy', 'policies', 'governance', 'management approval', 'board', 'documented']):
        evidence_types.append('policy')
    
    if any(word in text for word in ['procedure', 'process', 'workflow', 'steps', 'method', 'guideline', 'instruction']):
        evidence_types.append('procedure')
    
    if any(word in text for word in ['configuration', 'setting', 'parameter', 'system', 'network', 'firewall', 'server', 'encryption']):
        evidence_types.append('configuration')
    
    if any(word in text for word in ['log', 'audit trail', 'monitoring', 'event', 'alert', 'detection', 'tracking']):
        evidence_types.append('log')
    
    if any(word in text for word in ['report', 'assessment', 'review', 'audit', 'test', 'scan', 'evaluation', 'analysis']):
        evidence_types.append('report')
    
    if not evidence_types:
        evidence_types = ['policy', 'procedure']
    
    return evidence_types


def normalize_priority(priority: str) -> str:
    """Normalize priority values."""
    priority_lower = (priority or "medium").lower().strip()
    if priority_lower in ["critical", "high"]:
        return "high"
    elif priority_lower in ["medium", "moderate"]:
        return "medium"
    elif priority_lower in ["low", "minimal"]:
        return "low"
    return "medium"


def clean_section_reference(reference: str) -> str:
    """Clean up section/clause reference numbers."""
    import re
    if not reference:
        return reference
    
    cleaned = reference.strip()
    while cleaned and cleaned[-1] in '.-—–:;, \t':
        cleaned = cleaned[:-1]
    cleaned = re.sub(r'\.{2,}', '.', cleaned)
    cleaned = re.sub(r'-{2,}', '-', cleaned)
    while cleaned and cleaned[0] in '.-—–:;, \t':
        cleaned = cleaned[1:]
    
    return cleaned.strip()


def extract_document_structure(client: OpenAI, text: str, framework_name: str) -> dict:
    """Extract document structure using AI."""
    sample_text = text[:25000] if len(text) > 25000 else text
    
    try:
        print(f"  [STRUCTURE] Analyzing document structure...")
        
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a GRC expert analyzing regulatory framework documents."},
                {"role": "user", "content": f"""Analyze this regulatory framework document "{framework_name}" and provide structural analysis.

Document excerpt:
---
{sample_text}
---

Return JSON with:
1. "framework_classification": {{"type": "certification|compliance_regulation|best_practice|industry_standard", "description": "...", "regulatory_authority": "..."}}
2. "document_structure": {{"has_normative_clauses": true/false, "main_requirement_sections": ["..."], "skip_sections": ["..."]}}
3. "sections": ["List of major sections"]
4. "control_patterns": {{"primary_pattern": "...", "examples": ["..."]}}
5. "total_expected_controls": estimated number of controls
6. "framework_type": "ISO|NIST|PCI|Banking|Privacy|Financial|Industry"
7. "evidence_focus_areas": ["Key areas"]"""}
            ],
            response_format={"type": "json_object"},
            max_tokens=4096,
            temperature=0
        )
        
        result = json.loads(response.choices[0].message.content or "{}")
        print(f"  [STRUCTURE] Expected controls: {result.get('total_expected_controls', 'unknown')}")
        return result
    except Exception as e:
        print(f"  [STRUCTURE] Error: {e}")
        return {"sections": [], "total_expected_controls": 0}


def extract_controls_lightweight(client: OpenAI, text: str, framework_name: str, chunk_number: int, total_chunks: int) -> List[dict]:
    """Extract controls with minimal fields for maximum quantity."""
    prompt = f"""Extract ALL regulatory requirements from this document chunk.

DOCUMENT: "{framework_name}" (chunk {chunk_number}/{total_chunks})

SKIP: Foreword, Introduction, Table of Contents, Definitions, Bibliography.
EXTRACT: Every SHALL, MUST, SHOULD, REQUIRE statement as a SEPARATE control.

OUTPUT FORMAT - Return JSON with "controls" array. Each control needs:
{{
  "original_reference": "exact clause number (e.g., '5.1.a', 'Article 25')",
  "title": "brief descriptive title, max 100 chars",
  "full_text": "verbatim requirement text from document",
  "is_mandatory": true for shall/must/required, false for should/may,
  "domain": "Governance|Security|Risk|Access|Operations|Data|Compliance|Vendor|Network|Incident|BCP",
  "category": "specific sub-category",
  "priority": "high|medium|low"
}}

DOCUMENT TEXT:
---
{text}
---

Target 15-25+ controls per chunk. Split compound requirements."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a compliance expert extracting regulatory requirements. Extract the MAXIMUM number of individual controls by splitting compound requirements."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=16384,
            temperature=0
        )
        
        result = json.loads(response.choices[0].message.content or "{}")
        controls = result.get("controls", [])
        print(f"    [CHUNK {chunk_number}/{total_chunks}] Extracted {len(controls)} controls")
        return controls
    except Exception as e:
        print(f"    [CHUNK {chunk_number}] Error: {e}")
        return []


def enhance_controls(client: OpenAI, controls: List[dict], framework_name: str) -> List[dict]:
    """Enhance controls with evidence requirements."""
    if not controls:
        return []
    
    enhanced_controls = []
    batch_size = 10
    total_batches = (len(controls) + batch_size - 1) // batch_size
    
    for batch_num, i in enumerate(range(0, len(controls), batch_size), start=1):
        batch = controls[i:i + batch_size]
        print(f"  [ENHANCE] Processing batch {batch_num}/{total_batches} ({len(batch)} controls)...")
        
        try:
            controls_json = json.dumps(batch, indent=2)
            
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are a GRC expert adding audit-ready evidence requirements to compliance controls."},
                    {"role": "user", "content": f"""For framework "{framework_name}", enhance these controls with additional details.

INPUT CONTROLS:
{controls_json}

For EACH control, add these fields:
- description: Plain English explanation (1-2 sentences)
- parent_reference: Parent clause number if sub-item, null otherwise
- hierarchy_level: 1-5 (1=top clause, 2=sub, etc.)
- control_type: "preventive" | "detective" | "corrective" | "directive"
- implementation_frequency: "one-time" | "daily" | "weekly" | "monthly" | "quarterly" | "annual" | "continuous" | "event-driven"
- evidence_requirements: Array of 2-3 evidence items, each with:
  {{"type": "policy|procedure|configuration|log|report|contract|attestation|register", "title": "...", "description": "...", "is_required": true/false}}
- ai_confidence: 0.0-1.0
- ai_notes: string or null

Return JSON with "controls" array containing the enhanced controls."""}
                ],
                response_format={"type": "json_object"},
                max_tokens=16384,
                temperature=0
            )
            
            result = json.loads(response.choices[0].message.content or "{}")
            enhanced_batch = result.get("controls", batch)
            
            for original, enhanced in zip(batch, enhanced_batch):
                merged = {**original, **enhanced}
                merged.setdefault("description", merged.get("full_text", "")[:500])
                merged.setdefault("evidence_requirements", [])
                merged.setdefault("control_type", "preventive")
                merged.setdefault("implementation_frequency", "continuous")
                merged.setdefault("ai_confidence", 0.8)
                merged.setdefault("ai_notes", None)
                merged.setdefault("parent_reference", None)
                merged.setdefault("hierarchy_level", 1)
                merged["priority"] = normalize_priority(merged.get("priority", "medium"))
                if not merged.get("evidence_types"):
                    merged["evidence_types"] = infer_evidence_types(merged)
                enhanced_controls.append(merged)
        
        except Exception as e:
            print(f"  [ENHANCE] Batch {batch_num} error: {e}. Using defaults.")
            for control in batch:
                control.setdefault("description", control.get("full_text", "")[:500])
                control.setdefault("evidence_requirements", [])
                control.setdefault("control_type", "preventive")
                control.setdefault("implementation_frequency", "continuous")
                control.setdefault("ai_confidence", 0.8)
                control.setdefault("ai_notes", None)
                control.setdefault("parent_reference", None)
                control.setdefault("hierarchy_level", 1)
                control["priority"] = normalize_priority(control.get("priority", "medium"))
                control["evidence_types"] = infer_evidence_types(control)
                enhanced_controls.append(control)
    
    return enhanced_controls


def deduplicate_controls(controls: List[dict]) -> List[dict]:
    """Remove duplicate controls."""
    seen = set()
    unique_controls = []
    
    for control in controls:
        key = (
            control.get('original_reference', '').strip().lower(),
            control.get('title', '').strip().lower()[:100]
        )
        if key[0] or key[1]:
            if key not in seen:
                seen.add(key)
                unique_controls.append(control)
        else:
            unique_controls.append(control)
    
    unique_controls.sort(key=lambda c: (
        c.get('original_reference', 'zzz').lower(),
        c.get('title', '').lower()
    ))
    
    return unique_controls


def parse_framework(client: OpenAI, text: str, framework_name: str) -> tuple:
    """Parse a framework document and extract controls."""
    print(f"  [PARSE] Starting parsing for: {framework_name}")
    print(f"  [PARSE] Document length: {len(text):,} characters")
    
    doc_structure = extract_document_structure(client, text, framework_name)
    
    chunks = chunk_text(text, chunk_size=20000, overlap=2500)
    print(f"  [PARSE] Document split into {len(chunks)} chunks")
    
    all_controls = []
    for idx, chunk in enumerate(chunks, start=1):
        chunk_controls = extract_controls_lightweight(client, chunk, framework_name, idx, len(chunks))
        all_controls.extend(chunk_controls)
    
    print(f"  [PARSE] Total raw controls: {len(all_controls)}")
    
    unique_controls = deduplicate_controls(all_controls)
    print(f"  [PARSE] After deduplication: {len(unique_controls)}")
    
    enhanced_controls = enhance_controls(client, unique_controls, framework_name)
    print(f"  [PARSE] Final enhanced controls: {len(enhanced_controls)}")
    
    return enhanced_controls, doc_structure


def save_controls_to_db(db, framework_id: int, controls: List[dict]) -> int:
    """Save parsed controls to database."""
    saved_count = 0
    
    for idx, control_data in enumerate(controls, start=1):
        raw_reference = control_data.get("original_reference", "")
        cleaned_reference = clean_section_reference(raw_reference) if raw_reference else None
        control_id = cleaned_reference if cleaned_reference else f"CTRL-{idx:03d}"
        
        parent_ref = control_data.get("parent_reference", "")
        cleaned_parent_ref = clean_section_reference(parent_ref) if parent_ref else None
        
        hierarchy_level = control_data.get("hierarchy_level", 1)
        if not isinstance(hierarchy_level, int) or hierarchy_level < 1:
            hierarchy_level = 1
        elif hierarchy_level > 5:
            hierarchy_level = 5
        
        parsed_control = ParsedFrameworkControl(
            uploaded_framework_id=framework_id,
            control_id=control_id,
            original_reference=cleaned_reference,
            title=control_data.get("title", "Untitled Control")[:500],
            description=control_data.get("description"),
            full_text=control_data.get("full_text"),
            domain=control_data.get("domain"),
            category=control_data.get("category"),
            is_mandatory=control_data.get("is_mandatory", True),
            priority=control_data.get("priority", "medium"),
            section_number=cleaned_reference,
            parent_section=cleaned_parent_ref,
            ai_confidence=control_data.get("ai_confidence"),
            ai_notes=control_data.get("ai_notes"),
            is_verified=False,
            evidence_requirements=control_data.get("evidence_requirements", [])
        )
        db.add(parsed_control)
        db.flush()
        
        evidence_requirements = control_data.get("evidence_requirements", [])
        for ev_req in evidence_requirements:
            if isinstance(ev_req, dict):
                ev_type = ev_req.get("type", "document")
                valid_types = ["policy", "procedure", "configuration", "log", "report", "contract", "attestation", "register", "matrix", "plan", "screenshot", "training", "assessment", "document"]
                if ev_type not in valid_types:
                    ev_type = "document"
                
                ev_title = ev_req.get("title", "")
                ev_description = ev_req.get("description", "")
                full_description = f"{ev_title}: {ev_description}" if ev_title else ev_description
                
                evidence_mapping = ControlEvidenceMapping(
                    parsed_control_id=parsed_control.id,
                    evidence_type=ev_type,
                    evidence_description=full_description[:1000] if full_description else None,
                    is_required=ev_req.get("is_required", True),
                    suggested_by_ai=True
                )
                db.add(evidence_mapping)
        
        saved_count += 1
    
    return saved_count


def process_framework(definition: dict, db, client: OpenAI) -> Optional[int]:
    """Process a single framework definition."""
    source_path = definition["source_path"]
    name = definition["name"]
    
    print(f"\n{'='*60}")
    print(f"Processing: {name}")
    print(f"{'='*60}")
    
    if not os.path.exists(source_path):
        print(f"  [ERROR] Source file not found: {source_path}")
        return None
    
    unique_id = str(uuid.uuid4())
    safe_filename = f"{unique_id}_{os.path.basename(source_path)}"
    dest_path = os.path.join(UPLOAD_DIR, safe_filename)
    
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    shutil.copy2(source_path, dest_path)
    print(f"  [COPY] Copied to: {dest_path}")
    
    file_size = os.path.getsize(dest_path)
    
    framework = UploadedFramework(
        tenant_id=1,
        name=name,
        description=definition.get("description"),
        file_name=os.path.basename(source_path),
        file_path=dest_path,
        file_size=file_size,
        file_type="pdf",
        upload_status="parsing",
        framework_type=definition.get("framework_type"),
        source_organization=definition.get("source_organization"),
        version=definition.get("version"),
        classification=definition.get("classification"),
        classification_confidence=0.95,
        classification_reasoning=f"Pre-defined as {definition.get('classification')} framework",
        framework_purpose=definition.get("framework_purpose"),
        framework_scope=definition.get("framework_scope"),
        framework_objectives=definition.get("framework_objectives"),
        target_audience=definition.get("target_audience"),
        certification_body=definition.get("certification_body"),
        certification_validity_period=definition.get("certification_validity_period"),
        certification_levels=definition.get("certification_levels"),
        certification_lifecycle=definition.get("certification_lifecycle"),
        required_artifacts=definition.get("required_artifacts"),
        regulatory_authority=definition.get("regulatory_authority"),
        penalty_for_non_compliance=definition.get("penalty_for_non_compliance"),
        adoption_approach=definition.get("adoption_approach"),
        is_shared=True,
        is_active=True,
        uploaded_by=1
    )
    db.add(framework)
    db.commit()
    db.refresh(framework)
    print(f"  [DB] Created framework record ID: {framework.id}")
    
    try:
        text = extract_text_from_pdf(source_path)
        if not text.strip():
            framework.upload_status = "failed"
            framework.parse_error = "No text could be extracted from PDF"
            db.commit()
            print(f"  [ERROR] No text extracted from PDF")
            return None
        
        controls, doc_structure = parse_framework(client, text, name)
        
        if not controls:
            framework.upload_status = "parsed"
            framework.parsed_at = datetime.utcnow()
            framework.parse_error = "No controls found in document"
            framework.document_structure = doc_structure or {}
            db.commit()
            print(f"  [WARNING] No controls found")
            return framework.id
        
        saved_count = save_controls_to_db(db, framework.id, controls)
        
        framework.upload_status = "parsed"
        framework.parsed_at = datetime.utcnow()
        framework.parse_error = None
        framework.document_structure = doc_structure or {}
        db.commit()
        
        print(f"  [SUCCESS] Saved {saved_count} controls to database")
        return framework.id
        
    except Exception as e:
        framework.upload_status = "failed"
        framework.parse_error = str(e)[:500]
        db.commit()
        print(f"  [ERROR] Processing failed: {e}")
        traceback.print_exc()
        return None


def main():
    """Main function to batch parse all frameworks."""
    print("="*70)
    print("BATCH FRAMEWORK PARSING SCRIPT")
    print("="*70)
    print(f"Started at: {datetime.now().isoformat()}")
    print(f"Frameworks to process: {len(FRAMEWORK_DEFINITIONS)}")
    print()
    
    try:
        client = get_openai_client()
        print("[OK] OpenAI client initialized")
    except Exception as e:
        print(f"[FATAL] Failed to initialize OpenAI client: {e}")
        return
    
    db = SessionLocal()
    
    try:
        tenant = db.query(Tenant).filter(Tenant.id == 1).first()
        if not tenant:
            print("[ERROR] Tenant with ID 1 not found. Creating default tenant...")
            tenant = Tenant(id=1, name="Default Tenant", slug="default", is_active=True)
            db.add(tenant)
            db.commit()
        
        user = db.query(GRCUser).filter(GRCUser.id == 1).first()
        if not user:
            print("[ERROR] User with ID 1 not found. Please ensure a user exists.")
            return
        
        print(f"[OK] Database connection verified")
        print(f"[OK] Using Tenant: {tenant.name} (ID: {tenant.id})")
        print(f"[OK] Using User: {user.display_name or user.username} (ID: {user.id})")
        
        successful_ids = []
        failed_frameworks = []
        
        for definition in FRAMEWORK_DEFINITIONS:
            try:
                framework_id = process_framework(definition, db, client)
                if framework_id:
                    successful_ids.append(framework_id)
                else:
                    failed_frameworks.append(definition["name"])
            except Exception as e:
                print(f"  [FATAL] Unhandled error for {definition['name']}: {e}")
                traceback.print_exc()
                failed_frameworks.append(definition["name"])
        
        print("\n" + "="*70)
        print("EXPORTING FRAMEWORKS TO JSON")
        print("="*70)
        
        os.makedirs(SEED_DATA_DIR, exist_ok=True)
        
        exported_files = []
        for fw_id in successful_ids:
            try:
                file_path = export_framework_to_json(fw_id, SEED_DATA_DIR)
                if file_path:
                    exported_files.append(file_path)
            except Exception as e:
                print(f"  [ERROR] Failed to export framework ID {fw_id}: {e}")
        
        print("\n" + "="*70)
        print("BATCH PROCESSING COMPLETE")
        print("="*70)
        print(f"Completed at: {datetime.now().isoformat()}")
        print(f"Successfully parsed: {len(successful_ids)}/{len(FRAMEWORK_DEFINITIONS)}")
        print(f"Exported to JSON: {len(exported_files)}")
        
        if successful_ids:
            print("\nSuccessfully processed framework IDs:")
            for fw_id in successful_ids:
                print(f"  - {fw_id}")
        
        if failed_frameworks:
            print("\nFailed frameworks:")
            for name in failed_frameworks:
                print(f"  - {name}")
        
        if exported_files:
            print("\nExported JSON files:")
            for path in exported_files:
                print(f"  - {path}")
        
    except Exception as e:
        print(f"[FATAL] Batch processing failed: {e}")
        traceback.print_exc()
    finally:
        db.close()


if __name__ == "__main__":
    main()
