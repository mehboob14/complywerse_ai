import os
import json
import threading
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel
from openai import OpenAI

from ....models import (
    UploadedFramework, ParsedFrameworkControl, ControlEvidenceMapping,
    FrameworkControlAlignment, AssessmentItem, AssessmentEvidence,
    AssessmentRemediation, GRCUser, get_db, SessionLocal
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/parser", tags=["Framework Upload - Parser"])

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")


class ParsedControlUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    domain: Optional[str] = None
    category: Optional[str] = None
    is_mandatory: Optional[bool] = None
    priority: Optional[str] = None


class ParsedControlResponse(BaseModel):
    id: int
    uploaded_framework_id: int
    control_id: str
    original_reference: Optional[str]
    title: str
    description: Optional[str]
    full_text: Optional[str]
    domain: Optional[str]
    category: Optional[str]
    is_mandatory: bool
    priority: str
    section_number: Optional[str]
    parent_section: Optional[str]
    ai_confidence: Optional[float]
    ai_notes: Optional[str]
    is_verified: bool
    verified_by: Optional[int]
    verified_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    evidence_mappings: List[dict]

    class Config:
        from_attributes = True


def validate_framework_access(user: GRCUser, framework: UploadedFramework, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if framework.tenant_id and framework.tenant_id not in user_tenants and not framework.is_shared:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this framework"
        )


def serialize_parsed_control(control: ParsedFrameworkControl) -> dict:
    return {
        "id": control.id,
        "uploaded_framework_id": control.uploaded_framework_id,
        "control_id": control.control_id,
        "original_reference": control.original_reference,
        "title": control.title,
        "description": control.description,
        "full_text": control.full_text,
        "domain": control.domain,
        "category": control.category,
        "is_mandatory": control.is_mandatory,
        "priority": control.priority,
        "section_number": control.section_number,
        "parent_section": control.parent_section,
        "ai_confidence": control.ai_confidence,
        "ai_notes": control.ai_notes,
        "is_verified": control.is_verified,
        "verified_by": control.verified_by,
        "verified_at": control.verified_at.isoformat() if control.verified_at else None,
        "created_at": control.created_at.isoformat() if control.created_at else None,
        "updated_at": control.updated_at.isoformat() if control.updated_at else None,
        "evidence_mappings": [
            {
                "id": em.id,
                "evidence_type": em.evidence_type,
                "evidence_description": em.evidence_description,
                "is_required": em.is_required,
                "suggested_by_ai": em.suggested_by_ai
            }
            for em in control.evidence_mappings
        ]
    }


def extract_text_from_file(framework: UploadedFramework) -> str:
    if not os.path.exists(framework.file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework file not found on disk"
        )
    
    extracted_text = ""
    
    if framework.file_type == "pdf":
        from PyPDF2 import PdfReader
        reader = PdfReader(framework.file_path)
        text_parts = []
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
        extracted_text = "\n\n".join(text_parts)
    
    elif framework.file_type == "docx":
        from docx import Document
        doc = Document(framework.file_path)
        text_parts = []
        for paragraph in doc.paragraphs:
            if paragraph.text.strip():
                text_parts.append(paragraph.text)
        for table in doc.tables:
            for row in table.rows:
                row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
                if row_text:
                    text_parts.append(row_text)
        extracted_text = "\n".join(text_parts)
    
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file type: {framework.file_type}"
        )
    
    return extracted_text


def chunk_text(text: str, chunk_size: int = 30000, overlap: int = 3000) -> List[str]:
    """Split text into overlapping chunks for processing large documents.
    
    Uses smaller chunks with larger overlap to ensure no controls are missed
    at chunk boundaries. Prioritizes breaking at section boundaries.
    """
    if len(text) <= chunk_size:
        return [text]
    
    chunks = []
    start = 0
    
    while start < len(text):
        end = min(start + chunk_size, len(text))
        
        if end < len(text):
            search_start = max(start + chunk_size - overlap - 1000, start)
            search_end = min(end + 500, len(text))
            search_region = text[search_start:search_end]
            
            import re
            section_patterns = [
                r'\n\s*(?:Chapter|Section|Article|Part|Annex|Appendix)\s+\d+',
                r'\n\s*\d+\.\s+[A-Z]',
                r'\n\s*[A-Z]\.\s+[A-Z]',
                r'\n\s*Principle\s+\d+',
                r'\n\s*Requirement\s+\d+',
                r'\n\s*Control\s+\d+',
                r'\n\n\s*\d+\.\d+\s+',
                r'\n\n\n',
                r'\n\n',
            ]
            
            best_break = -1
            for pattern in section_patterns:
                matches = list(re.finditer(pattern, search_region, re.IGNORECASE))
                if matches:
                    last_match = matches[-1]
                    break_pos = search_start + last_match.start()
                    if break_pos > start + (chunk_size // 2):
                        best_break = break_pos
                        break
            
            if best_break > start:
                end = best_break
            else:
                break_point = text.rfind('\n\n', start + chunk_size - overlap, end)
                if break_point == -1:
                    break_point = text.rfind('\n', start + chunk_size - overlap, end)
                if break_point == -1:
                    break_point = text.rfind('. ', start + chunk_size - overlap, end)
                if break_point > start:
                    end = break_point + 1
        
        chunk_text_segment = text[start:end]
        if chunk_text_segment.strip():
            chunks.append(chunk_text_segment)
        
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
    
    if any(word in text for word in ['configuration', 'setting', 'parameter', 'system', 'network', 'firewall', 'server', 'encryption', 'tls', 'ssl']):
        evidence_types.append('configuration')
    
    if any(word in text for word in ['log', 'audit trail', 'monitoring', 'event', 'alert', 'detection', 'tracking']):
        evidence_types.append('log')
    
    if any(word in text for word in ['report', 'assessment', 'review', 'audit', 'test', 'scan', 'evaluation', 'analysis']):
        evidence_types.append('report')
    
    if any(word in text for word in ['contract', 'agreement', 'sla', 'vendor', 'third party', 'supplier', 'outsourcing']):
        evidence_types.append('contract')
    
    if not evidence_types:
        evidence_types = ['policy', 'procedure']
    
    return evidence_types


def normalize_priority(priority: str) -> str:
    """Normalize priority values to expected enum values (high/medium/low)."""
    priority_lower = (priority or "medium").lower().strip()
    if priority_lower in ["critical", "high"]:
        return "high"
    elif priority_lower in ["medium", "moderate"]:
        return "medium"
    elif priority_lower in ["low", "minimal"]:
        return "low"
    return "medium"


def clean_section_reference(reference: str) -> str:
    """Clean up section/clause reference numbers by removing trailing artifacts.
    
    Examples:
    - "6.4.2.—" -> "6.4.2"
    - "5.1.." -> "5.1"
    - "A.5.1.1-" -> "A.5.1.1"
    - "Principle 3:" -> "Principle 3"
    """
    import re
    if not reference:
        return reference
    
    cleaned = reference.strip()
    
    # Remove trailing dashes, dots, colons, and whitespace repeatedly
    while cleaned and cleaned[-1] in '.-—–:;, \t':
        cleaned = cleaned[:-1]
    
    # Remove multiple consecutive dots/dashes in the middle (e.g., "5..1" -> "5.1")
    cleaned = re.sub(r'\.{2,}', '.', cleaned)
    cleaned = re.sub(r'-{2,}', '-', cleaned)
    cleaned = re.sub(r'—+', '', cleaned)
    
    # Clean up any leading artifacts too
    while cleaned and cleaned[0] in '.-—–:;, \t':
        cleaned = cleaned[1:]
    
    return cleaned.strip()


def deduplicate_controls(controls: List[dict]) -> List[dict]:
    """Remove duplicate controls based on title and original_reference, maintaining order by reference."""
    seen = set()
    unique_controls = []
    
    for control in controls:
        control["priority"] = normalize_priority(control.get("priority", "medium"))
        
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


GRC_SME_SYSTEM_PROMPT = """You are a SENIOR GRC SUBJECT MATTER EXPERT with 20+ years of experience in regulatory compliance, audit, and risk management across multiple industries. You have deep expertise in:

=== YOUR CREDENTIALS AND EXPERTISE ===

CERTIFICATIONS YOU HOLD:
- CISA (Certified Information Systems Auditor)
- CISSP (Certified Information Systems Security Professional)
- CRISC (Certified in Risk and Information Systems Control)
- CGEIT (Certified in Governance of Enterprise IT)
- ISO 27001 Lead Auditor
- PCI QSA (Qualified Security Assessor)
- SOC 2 Type II Practitioner

FRAMEWORKS YOU KNOW INTIMATELY:
1. ISO STANDARDS: ISO 27001/27002 (ISMS), ISO 27701 (Privacy), ISO 22301 (BCM), ISO 9001 (QMS), ISO 31000 (Risk), ISO 27017/27018 (Cloud)
2. NIST: CSF, SP 800-53, SP 800-171, RMF, Privacy Framework
3. PAYMENT CARD: PCI DSS v4.0, PA-DSS, PCI PIN, P2PE
4. FINANCIAL: SOX, Basel III/IV, DORA, MAS TRM, FFIEC, GLBA
5. PRIVACY: GDPR, CCPA/CPRA, HIPAA, LGPD, PDPA, POPIA
6. INDUSTRY: COBIT, ITIL, CIS Controls, NERC CIP, FedRAMP, StateRAMP
7. REGIONAL: NCA (Saudi), SAMA, ISR (Israel), TISAX (Auto), SWIFT CSP

=== YOUR ANALYTICAL APPROACH ===

When analyzing any regulatory document, you ALWAYS:

1. CLASSIFY THE DOCUMENT TYPE:
   - CERTIFICATION FRAMEWORK: Auditable standards requiring third-party certification (ISO 27001, PCI DSS, SOC 2)
   - COMPLIANCE REGULATION: Legal/regulatory requirements with enforcement (GDPR, HIPAA, SOX, Basel)
   - BEST PRACTICE GUIDELINE: Advisory frameworks without mandatory certification (NIST CSF, CIS Controls, COBIT)
   - INDUSTRY STANDARD: Sector-specific requirements (SWIFT CSP, NERC CIP, MAS TRM)

2. IDENTIFY THE REGULATORY AUTHORITY:
   - International bodies (ISO, NIST, PCI SSC)
   - Government regulators (FTC, OCC, SEC, CFTC, FSA)
   - Central banks (Federal Reserve, ECB, MAS, SAMA)
   - Industry consortiums (SWIFT, NERC)

3. UNDERSTAND THE DOCUMENT STRUCTURE:
   - ISO Standards: Clauses (4-10) + Annex A controls (A.5-A.18)
   - NIST: Categories > Subcategories > Informative References
   - PCI DSS: Requirements > Sub-requirements > Testing Procedures
   - Basel: Principles > Articles > Paragraphs
   - GDPR: Chapters > Articles > Paragraphs

4. DISTINGUISH REQUIREMENTS FROM CONTEXT:
   SKIP (NOT requirements):
   - Foreword, Introduction, Scope, Normative References
   - Table of Contents, Index, Bibliography
   - Informative Annexes (background information)
   - Editor's notes, historical context, rationale
   
   EXTRACT (actual requirements):
   - Normative clauses with SHALL/MUST/REQUIRED
   - Controls and control objectives
   - Testing procedures and validation criteria
   - Documented evidence requirements
   - Implementation specifications

5. PRESERVE EXACT CLAUSE NUMBERING:
   - Never modify, simplify, or consolidate clause numbers
   - Include ALL hierarchical levels: 5.1.1.a.i, A.5.1.1.1
   - Preserve framework-specific formats exactly
   - Track parent-child relationships accurately

=== EVIDENCE EXPERTISE ===

You know EXACTLY what auditors look for. For each control, you provide SPECIFIC, PRACTICAL evidence that:
- Is commonly accepted by certification bodies
- Demonstrates effective implementation (not just existence)
- Includes operational proof (not just policies)
- Maps to specific audit procedures
- Is feasible for organizations to produce

EVIDENCE HIERARCHY (in order of audit value):
1. POLICY: Governance documents, standards, approved procedures
2. PROCEDURE: Step-by-step operational processes, runbooks
3. CONFIGURATION: System settings, hardening baselines, exports
4. LOG: Audit trails, event logs, monitoring data, alerts
5. REPORT: Assessments, test results, scan outputs, reviews
6. ATTESTATION: Sign-offs, certifications, declarations
7. REGISTER: Inventories, lists, catalogs, matrices
8. TRAINING: Records, materials, completion certificates
9. CONTRACT: Agreements, SLAs, vendor assessments
10. SCREENSHOT: Point-in-time configuration proof (last resort)

=== YOUR OUTPUT QUALITY STANDARDS ===

- COMPLETENESS: Extract 100% of requirements - never summarize or skip
- ACCURACY: Exact clause numbers, exact wording, exact hierarchy
- SPECIFICITY: Evidence requirements tailored to each exact control
- PRACTICALITY: Real artifacts that organizations actually maintain
- AUDITABILITY: Evidence an auditor would accept during certification"""


FRAMEWORK_EVIDENCE_TEMPLATES = {
    "iso_27001": {
        "access_control": [
            {"type": "policy", "title": "Access Control Policy", "description": "Formal policy defining access control principles, user lifecycle, role definitions, and segregation of duties requirements per ISO 27001 A.9"},
            {"type": "procedure", "title": "User Provisioning Procedure", "description": "Step-by-step process for granting, modifying, and revoking user access including approval workflows"},
            {"type": "register", "title": "User Access Rights Register", "description": "Complete inventory of users, roles, and assigned permissions across all systems"},
            {"type": "log", "title": "Access Review Records", "description": "Documented quarterly/annual access reviews with manager sign-offs and remediation actions"},
            {"type": "configuration", "title": "RBAC System Configuration", "description": "Export of role definitions and permission assignments from IAM/directory systems"}
        ],
        "risk_management": [
            {"type": "procedure", "title": "Risk Assessment Methodology", "description": "Documented approach for risk identification, analysis, evaluation, and treatment per ISO 27001 Clause 6.1.2"},
            {"type": "register", "title": "Information Security Risk Register", "description": "Complete risk register with asset owners, threats, vulnerabilities, likelihood, impact, and risk scores"},
            {"type": "report", "title": "Risk Assessment Report", "description": "Formal risk assessment output with identified risks, treatment decisions, and residual risk acceptance"},
            {"type": "attestation", "title": "Risk Treatment Plan Approval", "description": "Management-approved risk treatment plans with assigned owners and target dates"}
        ],
        "incident_management": [
            {"type": "procedure", "title": "Incident Response Procedure", "description": "Documented incident handling process covering detection, containment, eradication, recovery per ISO 27001 A.16"},
            {"type": "register", "title": "Security Incident Log", "description": "Record of all security incidents with classification, timeline, root cause, and lessons learned"},
            {"type": "report", "title": "Incident Post-Mortem Reports", "description": "Detailed analysis of significant incidents including timeline, impact assessment, and improvement actions"}
        ]
    },
    "pci_dss": {
        "network_security": [
            {"type": "configuration", "title": "Firewall Ruleset Export", "description": "Complete firewall configuration showing inbound/outbound rules, CDE segmentation per PCI DSS Req 1"},
            {"type": "report", "title": "Network Diagram", "description": "Current network topology showing CDE boundaries, segmentation controls, and data flows"},
            {"type": "procedure", "title": "Firewall Change Management Process", "description": "Procedure for requesting, approving, and documenting firewall rule changes"},
            {"type": "log", "title": "Firewall Rule Review Records", "description": "Documented semi-annual review of firewall rules with justifications and approvals"}
        ],
        "vulnerability_management": [
            {"type": "report", "title": "Quarterly ASV Scan Reports", "description": "Approved Scanning Vendor reports showing external vulnerability scan results per PCI DSS Req 11.2.2"},
            {"type": "report", "title": "Internal Vulnerability Scan Reports", "description": "Internal network vulnerability scans with remediation tracking per PCI DSS Req 11.2.1"},
            {"type": "report", "title": "Penetration Test Report", "description": "Annual/after-change penetration test results covering network and application layers per PCI DSS Req 11.3"},
            {"type": "procedure", "title": "Vulnerability Management Procedure", "description": "Process for scanning, prioritizing, and remediating vulnerabilities with defined SLAs by severity"}
        ],
        "encryption": [
            {"type": "policy", "title": "Encryption and Key Management Policy", "description": "Policy defining cryptographic standards, key lifecycle, and custodian responsibilities per PCI DSS Req 3 & 4"},
            {"type": "configuration", "title": "TLS Configuration Export", "description": "Web server/load balancer TLS settings showing minimum TLS 1.2, cipher suites, certificate details"},
            {"type": "procedure", "title": "Key Rotation Procedure", "description": "Documented process for cryptographic key generation, distribution, and rotation"},
            {"type": "register", "title": "Key Custodian Register", "description": "List of cryptographic key custodians with split knowledge and dual control assignments"}
        ]
    },
    "gdpr": {
        "lawful_basis": [
            {"type": "register", "title": "Processing Activities Register (ROPA)", "description": "Record of Processing Activities per Article 30 with purposes, legal bases, categories, transfers"},
            {"type": "policy", "title": "Data Protection Policy", "description": "Overarching policy covering GDPR principles, lawful bases, and data subject rights"},
            {"type": "procedure", "title": "Consent Management Procedure", "description": "Process for obtaining, recording, and managing consent with withdrawal mechanisms"}
        ],
        "data_subject_rights": [
            {"type": "procedure", "title": "Subject Access Request (SAR) Procedure", "description": "Process for handling access, rectification, erasure, portability requests within 30-day deadline"},
            {"type": "register", "title": "DSR Request Log", "description": "Record of all data subject requests with dates, actions, and response timelines"},
            {"type": "attestation", "title": "DSR Response Templates", "description": "Approved response templates for each type of data subject request"}
        ],
        "breach_notification": [
            {"type": "procedure", "title": "Data Breach Response Procedure", "description": "Process for 72-hour supervisory authority notification and affected individual communication"},
            {"type": "register", "title": "Breach Register", "description": "Log of all personal data breaches including nature, scope, consequences, and remedial measures"},
            {"type": "report", "title": "Breach Notification Records", "description": "Copies of supervisory authority notifications and data subject communications for actual breaches"}
        ]
    },
    "nist_csf": {
        "identify": [
            {"type": "register", "title": "IT Asset Inventory", "description": "Complete inventory of hardware, software, data, and personnel assets per ID.AM"},
            {"type": "report", "title": "Business Impact Analysis", "description": "BIA documenting critical business processes and recovery priorities per ID.BE"},
            {"type": "policy", "title": "Cybersecurity Policy", "description": "Overarching policy aligned to NIST CSF functions with roles and responsibilities per ID.GV"}
        ],
        "protect": [
            {"type": "procedure", "title": "Identity and Access Management Procedures", "description": "IAM processes covering provisioning, authentication, and authorization per PR.AC"},
            {"type": "training", "title": "Security Awareness Training Records", "description": "Training completion records and materials for workforce security awareness per PR.AT"},
            {"type": "configuration", "title": "Security Baseline Configurations", "description": "Hardening standards and compliance reports for systems per PR.IP"}
        ],
        "detect": [
            {"type": "procedure", "title": "Security Monitoring Procedures", "description": "Processes for continuous monitoring, event correlation, and alert handling per DE.CM"},
            {"type": "log", "title": "SIEM Alert Samples", "description": "Sample security event logs and alerts demonstrating detection capability per DE.AE"},
            {"type": "report", "title": "Detection Capability Assessment", "description": "Assessment of detection coverage across MITRE ATT&CK or similar framework"}
        ]
    },
    "sox": {
        "financial_controls": [
            {"type": "matrix", "title": "Risk Control Matrix (RCM)", "description": "Mapping of financial statement risks to controls with control owners and testing procedures"},
            {"type": "procedure", "title": "Financial Close Procedures", "description": "Month/quarter/year-end close procedures with reconciliation and review steps"},
            {"type": "attestation", "title": "Management Review Sign-offs", "description": "Evidence of management review and approval of financial statements and reconciliations"}
        ],
        "it_general_controls": [
            {"type": "procedure", "title": "Change Management Procedure", "description": "IT change management process with segregation between development and production"},
            {"type": "log", "title": "Access Provisioning/Deprovisioning Logs", "description": "Records of access grants and revocations for financially significant applications"},
            {"type": "report", "title": "Privileged Access Review", "description": "Quarterly review of privileged access to financially significant systems"}
        ]
    },
    "basel": {
        "capital_requirements": [
            {"type": "report", "title": "Capital Adequacy Report", "description": "Regulatory capital calculations showing CET1, Tier 1, and Total Capital ratios"},
            {"type": "procedure", "title": "RWA Calculation Methodology", "description": "Documented methodology for calculating Risk-Weighted Assets across credit, market, operational risk"},
            {"type": "register", "title": "Capital Instruments Register", "description": "Inventory of regulatory capital instruments with terms and eligibility analysis"}
        ],
        "risk_management": [
            {"type": "policy", "title": "Enterprise Risk Management Framework", "description": "Board-approved ERM framework covering risk appetite, governance, and three lines of defense"},
            {"type": "report", "title": "ICAAP Documentation", "description": "Internal Capital Adequacy Assessment Process documentation and results"},
            {"type": "register", "title": "Material Risk Register", "description": "Inventory of material risks with quantification, monitoring, and mitigation strategies"}
        ]
    }
}


def get_framework_category(framework_name: str, text_sample: str) -> str:
    """Determine the framework category for tailored evidence generation."""
    name_lower = framework_name.lower()
    text_lower = text_sample[:5000].lower()
    
    if "27001" in name_lower or "27002" in name_lower or "isms" in text_lower:
        return "iso_27001"
    elif "pci" in name_lower or "payment card" in text_lower or "cardholder" in text_lower:
        return "pci_dss"
    elif "gdpr" in name_lower or "general data protection" in text_lower:
        return "gdpr"
    elif "nist" in name_lower or "cybersecurity framework" in text_lower:
        return "nist_csf"
    elif "sox" in name_lower or "sarbanes" in text_lower:
        return "sox"
    elif "basel" in name_lower or "capital adequacy" in text_lower:
        return "basel"
    elif "hipaa" in name_lower or "health insurance portability" in text_lower:
        return "hipaa"
    else:
        return "general"


def extract_document_structure(text: str, framework_name: str) -> dict:
    """First pass: Extract the document's structure and classify the framework type using GRC SME expertise."""
    if not AI_INTEGRATIONS_OPENAI_API_KEY or not AI_INTEGRATIONS_OPENAI_BASE_URL:
        return {"sections": [], "total_expected_controls": 0}
    
    client = OpenAI(
        api_key=AI_INTEGRATIONS_OPENAI_API_KEY,
        base_url=AI_INTEGRATIONS_OPENAI_BASE_URL
    )
    
    sample_text = text[:25000] if len(text) > 25000 else text
    
    try:
        import time
        start_time = time.time()
        print(f"[PARSE] Extracting document structure with OpenAI (gpt-4o)...", flush=True)
        
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": GRC_SME_SYSTEM_PROMPT},
                {"role": "user", "content": f"""As a Senior GRC SME, analyze this regulatory framework document "{framework_name}" and provide comprehensive structural analysis.

Document excerpt:
---
{sample_text}
---

Perform deep analysis and return JSON with:

1. "framework_classification": {{
     "type": "certification|compliance_regulation|best_practice|industry_standard",
     "description": "Why this classification applies",
     "regulatory_authority": "Issuing body (e.g., ISO, NIST, PCI SSC, regulators)",
     "jurisdiction": "Global/Regional/National applicability",
     "certification_body_required": true/false
   }}

2. "document_structure": {{
     "has_normative_clauses": true/false,
     "has_informative_annexes": true/false,
     "main_requirement_sections": ["List of sections containing actual requirements"],
     "skip_sections": ["List of sections to SKIP - intro, foreword, scope, TOC, bibliography"],
     "control_hierarchy_depth": 1-5 (how deep the clause numbering goes)
   }}

3. "sections": Array of ALL major sections/chapters with their exact numbering

4. "control_patterns": {{
     "primary_pattern": "Main numbering format (e.g., 'N.N.N', 'A.N.N.N', 'Requirement N.N.N')",
     "secondary_patterns": ["Additional patterns used"],
     "examples": ["5.1.1", "A.5.1.1", "Requirement 1.1.1a"]
   }}

5. "requirement_indicators": {{
     "mandatory_keywords": ["shall", "must", "required", etc.],
     "advisory_keywords": ["should", "may", "recommended", etc.]
   }}

6. "total_expected_controls": Estimated total number of extractable requirements
7. "framework_type": "ISO|NIST|PCI|Banking|Privacy|Financial|Industry"
8. "evidence_focus_areas": ["Key areas where evidence will be most important"]"""}
            ],
            response_format={"type": "json_object"},
            max_completion_tokens=4096,
            temperature=0
        )
        
        elapsed = time.time() - start_time
        print(f"[PARSE] Document structure extracted in {elapsed:.1f}s", flush=True)
        
        result = json.loads(response.choices[0].message.content or "{}")
        expected = result.get("total_expected_controls", 0)
        print(f"[PARSE] Expected controls from document structure: {expected}", flush=True)
        return result
    except Exception as e:
        print(f"[PARSE] Error extracting document structure: {e}", flush=True)
        return {"sections": [], "total_expected_controls": 0}


def parse_with_openai(text: str, framework_name: str, chunk_number: int = 1, total_chunks: int = 1, doc_structure: dict = None) -> List[dict]:
    if not AI_INTEGRATIONS_OPENAI_API_KEY or not AI_INTEGRATIONS_OPENAI_BASE_URL:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OpenAI integration not configured"
        )
    
    client = OpenAI(
        api_key=AI_INTEGRATIONS_OPENAI_API_KEY,
        base_url=AI_INTEGRATIONS_OPENAI_BASE_URL
    )
    
    chunk_context = ""
    if total_chunks > 1:
        chunk_context = f"""

=== DOCUMENT CHUNK CONTEXT ===
- This is chunk {chunk_number} of {total_chunks} from a large document
- You MUST extract EVERY control from this section - do not skip any
- If a control spans chunk boundaries, extract what you see with a note
- Previous/next chunks will capture overlapping content
- CRITICAL: Do not assume content from other chunks - focus on THIS text only"""
    
    structure_context = ""
    if doc_structure:
        fw_classification = doc_structure.get("framework_classification", {})
        doc_struct = doc_structure.get("document_structure", {})
        control_patterns = doc_structure.get("control_patterns", {})
        skip_sections = doc_struct.get("skip_sections", [])
        
        structure_context = f"""

=== FRAMEWORK ANALYSIS (from structural pre-scan) ===

FRAMEWORK CLASSIFICATION:
- Type: {fw_classification.get('type', 'Unknown')}
- Regulatory Authority: {fw_classification.get('regulatory_authority', 'Unknown')}
- Jurisdiction: {fw_classification.get('jurisdiction', 'Unknown')}
- Requires Certification: {fw_classification.get('certification_body_required', False)}

DOCUMENT STRUCTURE:
- Control Hierarchy Depth: {doc_struct.get('control_hierarchy_depth', 3)} levels deep
- Has Normative Clauses: {doc_struct.get('has_normative_clauses', True)}
- Has Informative Annexes: {doc_struct.get('has_informative_annexes', False)}

NUMBERING PATTERNS TO LOOK FOR:
- Primary Pattern: {control_patterns.get('primary_pattern', 'N.N.N')}
- Examples: {', '.join(control_patterns.get('examples', [])[:5])}

SECTIONS TO SKIP (non-requirements):
{chr(10).join(['- ' + s for s in skip_sections[:10]]) if skip_sections else '- None identified'}

SECTIONS WITH ACTUAL REQUIREMENTS:
{chr(10).join(['- ' + s for s in doc_struct.get('main_requirement_sections', [])[:10]])}"""
    
    prompt = f"""As a SENIOR GRC SUBJECT MATTER EXPERT, perform EXHAUSTIVE and INTELLIGENT extraction of ALL compliance requirements from this regulatory framework document.

=== DOCUMENT: "{framework_name}" ==={chunk_context}{structure_context}

=== YOUR EXPERT ANALYSIS PROCESS ===

STEP 1: SKIP NON-REQUIREMENT CONTENT
Intelligently skip these sections (they contain NO auditable requirements):
- Foreword, Introduction, Scope (unless scope contains SHALL statements)
- Normative References, Terms and Definitions (unless defining obligations)
- Table of Contents, Index, Bibliography, Acknowledgments
- Informative Annexes (background/guidance only, not normative)
- Historical context, rationale explanations, "Note:" sections (unless they contain SHALL)
- Page headers, footers, version information

STEP 2: IDENTIFY REQUIREMENT LANGUAGE
Extract ONLY when you find:
- MANDATORY: "shall", "must", "is required", "are required to", "needs to", "is mandatory"
- CONDITIONAL MANDATORY: "shall, where applicable", "must, unless documented"
- ADVISORY: "should", "may", "is recommended", "is encouraged", "it is advisable"

STEP 3: PRESERVE EXACT HIERARCHICAL STRUCTURE
Capture the COMPLETE clause hierarchy as it appears in the document:

For ISO-style documents:
- "4.1" (Clause 4.1)
- "4.1.1" (Sub-clause)
- "4.1.1.1" (Sub-sub-clause)
- "A.5.1.1" (Annex A control)
- "A.5.1.1.a" or "A.5.1.1 a)" (Lettered item)

For PCI DSS-style documents:
- "Requirement 1.1" (Main requirement)
- "1.1.1" (Sub-requirement)
- "1.1.1.a" (Testing procedure)
- "1.1.1.a.i" (Detailed procedure)

For NIST-style documents:
- "ID.AM-1" (Subcategory)
- "PR.AC-1" (Subcategory)
- Preserve the exact category codes

For Banking/Basel-style documents:
- "Principle 1" (High-level principle)
- "Principle 1.1" or "Principle 1, paragraph 2"
- "Article 3.2.1" (Detailed article)

For GDPR/Regulation-style:
- "Article 5(1)(a)" (Exact legal citation)
- "Article 32(1)" (Specific paragraph)

CRITICAL: Never consolidate, simplify, or modify clause numbers. Copy EXACTLY as written.

STEP 4: GRANULAR EXTRACTION
- Extract EACH "shall/must/should" statement as a SEPARATE control
- If one clause has 5 requirements, create 5 controls with references like "4.1.a", "4.1.b", etc.
- Sub-clauses within a bullet point still need individual extraction
- Testing procedures (in PCI DSS, for example) are separate from requirements

=== OUTPUT FORMAT FOR EACH CONTROL ===

{{
  "original_reference": "EXACT clause number as it appears (e.g., '4.1.2', 'A.5.1.1', 'Requirement 1.1.1.a', 'Article 32(1)(a)')",
  "parent_reference": "Parent clause if this is a sub-item (e.g., '4.1' is parent of '4.1.2')",
  "hierarchy_level": 1-5 (1=top clause, 2=sub-clause, 3=sub-sub-clause, etc.),
  "title": "Clear, descriptive title (max 200 chars) - not just the clause number",
  "description": "Plain English explanation of what this control requires and why",
  "full_text": "COMPLETE VERBATIM text of the requirement - copy exactly as written including any notes",
  "domain": "One of: Governance|Risk Management|Security|Access Control|Incident Management|Business Continuity|Data Protection|Compliance|Operations|Third Party|Capital & Liquidity|Credit Risk|Human Resources|Physical Security|Network Security|Application Security|Asset Management|Cryptography|Communications Security|Supplier Management",
  "category": "Specific sub-category (e.g., 'Access Control Policy', 'User Access Management', 'Privileged Access')",
  "is_mandatory": true for shall/must/required, false for should/may/recommended,
  "priority": "critical|high|medium|low based on risk and regulatory importance",
  "control_type": "preventive|detective|corrective|directive",
  "implementation_frequency": "one-time|daily|weekly|monthly|quarterly|annual|continuous|event-driven",
  "evidence_requirements": [
    {{
      "type": "policy|procedure|configuration|log|report|contract|attestation|register|matrix|plan|screenshot|training|assessment|interview|observation",
      "title": "Specific evidence artifact name (e.g., 'Information Security Policy v2.0', 'User Access Review Q4 2024')",
      "description": "Detailed description of what the auditor will look for in this evidence - reference the SPECIFIC control requirement",
      "artifact_examples": ["Practical examples of what to provide"],
      "review_frequency": "How often this evidence should be produced/updated",
      "is_required": true/false (true for primary evidence, false for supporting)
    }}
  ],
  "testing_procedure": "How an auditor would test/verify this control",
  "ai_confidence": 0.0-1.0 (1.0 for clear SHALL statements, lower for implicit requirements),
  "ai_notes": "Any extraction notes (e.g., 'Requirement spans two paragraphs', 'Implicit from context')"
}}

=== FRAMEWORK-SPECIFIC EVIDENCE GUIDANCE ===

Provide PRACTICAL, AUDITABLE evidence that auditors actually request. Examples:

FOR ISO 27001 A.9 ACCESS CONTROL:
- NOT: "Access Control Document" (too vague)
- YES: "Access Control Policy (version-controlled, management-approved) covering: logical access principles, user lifecycle management, privileged access, access review requirements per A.9.1"
- YES: "Quarterly User Access Review spreadsheet showing: review date, reviewer name, systems reviewed, exceptions found, remediation actions with target dates"
- YES: "Active Directory group membership export showing RBAC implementation"

FOR PCI DSS REQUIREMENT 1 (FIREWALLS):
- NOT: "Firewall documentation" (too vague)  
- YES: "Firewall ruleset export from [vendor] showing: deny-all default, explicit permit rules with business justification, no any-any rules per Req 1.1.1"
- YES: "Semi-annual firewall rule review minutes with: rules reviewed, justifications validated, rules removed as obsolete per Req 1.1.7"
- YES: "Network diagram (Visio/Lucidchart) showing CDE boundaries, firewall placement, and all connections per Req 1.1.2"

FOR GDPR ARTICLE 30 (RECORDS OF PROCESSING):
- NOT: "Processing register" (too vague)
- YES: "Record of Processing Activities (ROPA) spreadsheet containing: processing purposes, lawful basis for each, data categories, retention periods, recipients, transfer safeguards per Art 30(1)"
- YES: "Data Protection Impact Assessment (DPIA) for [system name] with: risk assessment, necessity evaluation, safeguards implemented per Art 35"

FOR SOX IT GENERAL CONTROLS:
- NOT: "Change management evidence" (too vague)
- YES: "Change Advisory Board (CAB) meeting minutes showing: change requests reviewed, approvals documented, segregation between requester and approver"
- YES: "ServiceNow change ticket samples (10 samples across quarter) showing: request, testing, approval, implementation, post-implementation review"

=== DOCUMENT TEXT TO ANALYZE ===
---
{text}
---

=== MANDATORY OUTPUT FIELDS ===

Every control in your output MUST include ALL of these fields (no exceptions):
- original_reference: string (REQUIRED - exact clause number)
- parent_reference: string or null (REQUIRED - parent clause number if sub-item)  
- hierarchy_level: integer 1-5 (REQUIRED - 1=top, 2=sub, 3=sub-sub, etc.)
- title: string (REQUIRED)
- description: string (REQUIRED)
- full_text: string (REQUIRED - verbatim text)
- domain: string (REQUIRED)
- category: string (REQUIRED)
- is_mandatory: boolean (REQUIRED)
- priority: string (REQUIRED - critical/high/medium/low)
- control_type: string (REQUIRED - preventive/detective/corrective/directive)
- implementation_frequency: string (REQUIRED - one-time/daily/weekly/monthly/quarterly/annual/continuous/event-driven)
- evidence_requirements: array (REQUIRED - at least 1 evidence item with type, title, description, artifact_examples array, review_frequency, is_required)
- testing_procedure: string (REQUIRED - how auditor would verify)
- ai_confidence: float (REQUIRED - 0.0-1.0)
- ai_notes: string or null (optional notes)

=== FINAL EXTRACTION CHECKLIST ===

Before completing, verify you have:
[ ] Skipped introductory/non-normative content appropriately
[ ] Extracted EVERY SHALL/MUST/SHOULD statement as a separate control
[ ] Preserved EXACT clause numbering including all hierarchy levels (a, b, c, i, ii, iii)
[ ] Set parent_reference and hierarchy_level for EVERY control (null parent for top-level)
[ ] Provided SPECIFIC, PRACTICAL evidence with artifact_examples array for each control
[ ] Included testing_procedure for EVERY control (how auditor verifies compliance)
[ ] Set control_type and implementation_frequency for EVERY control
[ ] Set appropriate ai_confidence levels (1.0 for explicit SHALL, lower for implicit)

For a typical regulatory document, expect to extract 50-500+ controls. 
If you extract fewer than 20, you may have missed requirements - review the text again.

CRITICAL: Return a JSON object with a "controls" array. Each control MUST have ALL mandatory fields listed above.

Example control structure:
{{
  "original_reference": "A.5.1.1",
  "parent_reference": "A.5.1",
  "hierarchy_level": 3,
  "title": "Information Security Policies",
  "description": "A set of policies for information security shall be defined, approved by management, published and communicated to employees and relevant external parties.",
  "full_text": "A.5.1.1 Policies for information security: A set of policies for information security shall be defined, approved by management, published and communicated to employees and relevant external parties.",
  "domain": "Governance",
  "category": "Information Security Policies",
  "is_mandatory": true,
  "priority": "high",
  "control_type": "directive",
  "implementation_frequency": "annual",
  "evidence_requirements": [
    {{
      "type": "policy",
      "title": "Information Security Policy Document",
      "description": "Version-controlled policy document with management approval signature, covering security principles, roles, and responsibilities",
      "artifact_examples": ["Information Security Policy v2.0.pdf", "ISMS Policy Manual"],
      "review_frequency": "Annual",
      "is_required": true
    }},
    {{
      "type": "attestation",
      "title": "Policy Communication Records",
      "description": "Evidence of policy distribution to employees - email notifications, intranet announcements, training acknowledgments",
      "artifact_examples": ["Employee acknowledgment forms", "Email distribution logs"],
      "review_frequency": "Upon update",
      "is_required": true
    }}
  ],
  "testing_procedure": "1. Obtain current information security policy. 2. Verify management approval (signature/date). 3. Sample 10 employees and verify receipt/acknowledgment. 4. Confirm policy published on intranet.",
  "ai_confidence": 1.0,
  "ai_notes": null
}}"""

    try:
        import time
        start_time = time.time()
        print(f"[PARSE] Calling OpenAI API (model: gpt-4o)...", flush=True)
        
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": GRC_SME_SYSTEM_PROMPT},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=16384,
            temperature=0
        )
        
        elapsed = time.time() - start_time
        print(f"[PARSE] OpenAI API response received in {elapsed:.1f}s", flush=True)
        
        result_text = response.choices[0].message.content or "{}"
        result = json.loads(result_text)
        controls = result.get("controls", [])
        print(f"[PARSE] Parsed {len(controls)} controls from API response", flush=True)
        
        for control in controls:
            if not control.get("evidence_types") or len(control.get("evidence_types", [])) == 0:
                control["evidence_types"] = infer_evidence_types(control)
        
        return controls
    
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to parse OpenAI response: {str(e)}"
        )
    except Exception as e:
        error_msg = str(e)
        if "FREE_CLOUD_BUDGET_EXCEEDED" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Cloud budget exceeded. Please upgrade your plan."
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"OpenAI API error: {error_msg}"
        )


def parse_document_with_chunking(text: str, framework_name: str) -> List[dict]:
    """Parse a document using a two-pass approach for comprehensive extraction.
    
    Pass 1: Extract document structure to understand numbering patterns
    Pass 2: Process each chunk with structure context for exhaustive extraction
    """
    print(f"[PARSE] Starting document parsing for: {framework_name}", flush=True)
    print(f"[PARSE] Document text length: {len(text):,} characters", flush=True)
    
    print(f"[PARSE] Pass 1: Extracting document structure...", flush=True)
    doc_structure = extract_document_structure(text, framework_name)
    print(f"[PARSE] Document structure extracted. Expected controls: {doc_structure.get('total_expected_controls', 'unknown')}", flush=True)
    
    chunks = chunk_text(text, chunk_size=30000, overlap=3000)
    print(f"[PARSE] Document split into {len(chunks)} chunks for processing", flush=True)
    
    all_controls = []
    
    for idx, chunk in enumerate(chunks, start=1):
        print(f"[PARSE] Processing chunk {idx}/{len(chunks)} ({len(chunk):,} chars)... (AI processing, may take 1-3 min)", flush=True)
        chunk_controls = parse_with_openai(
            chunk, 
            framework_name, 
            chunk_number=idx, 
            total_chunks=len(chunks),
            doc_structure=doc_structure
        )
        all_controls.extend(chunk_controls)
        print(f"[PARSE] Chunk {idx}/{len(chunks)} complete. Found {len(chunk_controls)} controls. Total so far: {len(all_controls)}", flush=True)
    
    print(f"[PARSE] All chunks processed. Total raw controls: {len(all_controls)}", flush=True)
    print(f"[PARSE] Deduplicating controls...", flush=True)
    unique_controls = deduplicate_controls(all_controls)
    print(f"[PARSE] Deduplication complete. Unique controls: {len(unique_controls)}", flush=True)
    
    expected_count = doc_structure.get("total_expected_controls", 0)
    if expected_count > 0 and len(unique_controls) < expected_count * 0.7:
        print(f"[PARSE] Warning: Found fewer controls than expected ({len(unique_controls)} vs {expected_count})", flush=True)
    
    print(f"[PARSE] Parsing complete! Returning {len(unique_controls)} controls", flush=True)
    return unique_controls


def run_background_parsing(framework_id: int, file_path: str, file_type: str, framework_name: str):
    """Run parsing in a background thread to avoid HTTP timeout."""
    print(f"[PARSE] ========================================", flush=True)
    print(f"[PARSE] Background parsing started for framework ID: {framework_id}", flush=True)
    print(f"[PARSE] Framework name: {framework_name}", flush=True)
    print(f"[PARSE] File: {file_path} ({file_type})", flush=True)
    print(f"[PARSE] ========================================", flush=True)
    
    db = SessionLocal()
    try:
        extracted_text = ""
        if file_type == "pdf":
            print(f"[PARSE] Extracting text from PDF...", flush=True)
            from PyPDF2 import PdfReader
            reader = PdfReader(file_path)
            print(f"[PARSE] PDF has {len(reader.pages)} pages", flush=True)
            text_parts = []
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
            extracted_text = "\n\n".join(text_parts)
            print(f"[PARSE] Text extraction complete. Total characters: {len(extracted_text):,}", flush=True)
        elif file_type == "docx":
            from docx import Document
            doc = Document(file_path)
            text_parts = []
            for paragraph in doc.paragraphs:
                if paragraph.text.strip():
                    text_parts.append(paragraph.text)
            for table in doc.tables:
                for row in table.rows:
                    row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
                    if row_text:
                        text_parts.append(row_text)
            extracted_text = "\n".join(text_parts)
        else:
            fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
            if fw:
                fw.upload_status = "failed"
                fw.parse_error = f"Unsupported file type: {file_type}"
                db.commit()
            return
        
        if not extracted_text.strip():
            fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
            if fw:
                fw.upload_status = "failed"
                fw.parse_error = "No text could be extracted from the document"
                db.commit()
            return
        
        parsed_controls_data = parse_document_with_chunking(extracted_text, framework_name)
        
        if not parsed_controls_data:
            fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
            if fw:
                fw.upload_status = "parsed"
                fw.parsed_at = datetime.utcnow()
                fw.parse_error = "No controls found in document"
                db.commit()
            return
        
        existing_controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == framework_id
        ).all()
        existing_control_ids = [c.id for c in existing_controls]
        
        if existing_control_ids:
            assessment_item_ids = db.query(AssessmentItem.id).filter(
                AssessmentItem.parsed_control_id.in_(existing_control_ids)
            ).all()
            ai_ids = [a.id for a in assessment_item_ids]
            
            if ai_ids:
                db.query(AssessmentRemediation).filter(
                    AssessmentRemediation.assessment_item_id.in_(ai_ids)
                ).delete(synchronize_session=False)
                
                db.query(AssessmentEvidence).filter(
                    AssessmentEvidence.assessment_item_id.in_(ai_ids)
                ).delete(synchronize_session=False)
                
                db.query(AssessmentItem).filter(
                    AssessmentItem.id.in_(ai_ids)
                ).delete(synchronize_session=False)
            
            db.query(FrameworkControlAlignment).filter(
                FrameworkControlAlignment.parsed_control_id.in_(existing_control_ids)
            ).delete(synchronize_session=False)
            
            db.query(ControlEvidenceMapping).filter(
                ControlEvidenceMapping.parsed_control_id.in_(existing_control_ids)
            ).delete(synchronize_session=False)
            
            db.query(ParsedFrameworkControl).filter(
                ParsedFrameworkControl.id.in_(existing_control_ids)
            ).delete(synchronize_session=False)
        
        db.flush()
        
        for idx, control_data in enumerate(parsed_controls_data, start=1):
            control_id = f"FW-{framework_id:03d}-{idx:03d}"
            
            raw_reference = control_data.get("original_reference", "")
            cleaned_reference = clean_section_reference(raw_reference) if raw_reference else None
            
            parent_ref = control_data.get("parent_reference", "")
            cleaned_parent_ref = clean_section_reference(parent_ref) if parent_ref else None
            
            hierarchy_level = control_data.get("hierarchy_level", 1)
            if not isinstance(hierarchy_level, int) or hierarchy_level < 1:
                hierarchy_level = 1
            elif hierarchy_level > 5:
                hierarchy_level = 5
            
            testing_procedure = control_data.get("testing_procedure", "")
            ai_notes = control_data.get("ai_notes", "")
            
            full_ai_notes = ai_notes
            if testing_procedure:
                full_ai_notes = f"Testing: {testing_procedure}" + (f"\n{ai_notes}" if ai_notes else "")
            
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
                ai_notes=full_ai_notes[:1000] if full_ai_notes else None,
                is_verified=False
            )
            db.add(parsed_control)
            db.flush()
            
            evidence_requirements = control_data.get("evidence_requirements", [])
            if evidence_requirements:
                for ev_req in evidence_requirements:
                    if isinstance(ev_req, dict):
                        ev_type = ev_req.get("type", "document")
                        ev_title = ev_req.get("title", "")
                        ev_description = ev_req.get("description", "")
                        ev_is_required = ev_req.get("is_required", True)
                        ev_examples = ev_req.get("artifact_examples", [])
                        ev_frequency = ev_req.get("review_frequency", "")
                        
                        full_description = ev_title
                        if ev_description:
                            full_description = f"{ev_title}: {ev_description}" if ev_title else ev_description
                        if ev_examples and isinstance(ev_examples, list):
                            full_description += f" Examples: {', '.join(ev_examples[:3])}"
                        if ev_frequency:
                            full_description += f" (Frequency: {ev_frequency})"
                        
                        valid_types = [
                            "policy", "procedure", "configuration", "log", "report", 
                            "contract", "attestation", "register", "matrix", "plan", 
                            "screenshot", "training", "assessment", "document",
                            "interview", "observation"
                        ]
                        if ev_type not in valid_types:
                            ev_type = "document"
                        
                        evidence_mapping = ControlEvidenceMapping(
                            parsed_control_id=parsed_control.id,
                            evidence_type=ev_type,
                            evidence_description=full_description[:1000] if full_description else None,
                            is_required=ev_is_required if isinstance(ev_is_required, bool) else True,
                            suggested_by_ai=True
                        )
                        db.add(evidence_mapping)
            else:
                evidence_types = control_data.get("evidence_types", [])
                for evidence_type in evidence_types:
                    if evidence_type in ["policy", "procedure", "configuration", "log", "report", "contract"]:
                        evidence_mapping = ControlEvidenceMapping(
                            parsed_control_id=parsed_control.id,
                            evidence_type=evidence_type,
                            is_required=True,
                            suggested_by_ai=True
                        )
                        db.add(evidence_mapping)
        
        fw_final = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
        if fw_final:
            fw_final.upload_status = "parsed"
            fw_final.parsed_at = datetime.utcnow()
            fw_final.parse_error = None
        
        db.commit()
        
    except Exception as e:
        error_msg = str(e)
        try:
            fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
            if fw:
                fw.upload_status = "failed"
                fw.parse_error = error_msg[:500]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


@router.post("/{framework_id}/parse")
def parse_framework_document(
    framework_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Start parsing a framework document in the background.
    
    Returns immediately with status 'parsing'. The actual parsing runs in
    the background. Poll the framework status to check when parsing completes.
    """
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    if framework.upload_status == "parsing":
        return {
            "message": "Parsing already in progress",
            "framework_id": framework_id,
            "status": "parsing"
        }
    
    file_path = framework.file_path
    file_type = framework.file_type
    framework_name = framework.name
    
    if not os.path.exists(file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework file not found on disk"
        )
    
    framework.upload_status = "parsing"
    framework.parse_error = None
    db.commit()
    
    thread = threading.Thread(
        target=run_background_parsing,
        args=(framework_id, file_path, file_type, framework_name),
        daemon=True
    )
    thread.start()
    
    return {
        "message": "Parsing started in background. Refresh the page periodically to check status.",
        "framework_id": framework_id,
        "status": "parsing"
    }


@router.get("/{framework_id}/parse-status")
def get_parse_status(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Check the parsing status of a framework."""
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    controls_count = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    ).count() if framework.upload_status == "parsed" else 0
    
    return {
        "framework_id": framework_id,
        "status": framework.upload_status,
        "parse_error": framework.parse_error,
        "parsed_at": framework.parsed_at.isoformat() if framework.parsed_at else None,
        "controls_count": controls_count
    }


@router.post("/{framework_id}/parse-sync")
def parse_framework_document_sync(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Parse a framework document synchronously (for small documents only).
    
    Warning: This may timeout for large documents. Use the async /parse endpoint instead.
    """
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    file_path = framework.file_path
    file_type = framework.file_type
    framework_name = framework.name
    
    framework.upload_status = "parsing"
    db.commit()
    
    try:
        if not os.path.exists(file_path):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Framework file not found on disk"
            )
        
        extracted_text = ""
        if file_type == "pdf":
            from PyPDF2 import PdfReader
            reader = PdfReader(file_path)
            text_parts = []
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text_parts.append(page_text)
            extracted_text = "\n\n".join(text_parts)
        elif file_type == "docx":
            from docx import Document
            doc = Document(file_path)
            text_parts = []
            for paragraph in doc.paragraphs:
                if paragraph.text.strip():
                    text_parts.append(paragraph.text)
            for table in doc.tables:
                for row in table.rows:
                    row_text = " | ".join(cell.text.strip() for cell in row.cells if cell.text.strip())
                    if row_text:
                        text_parts.append(row_text)
            extracted_text = "\n".join(text_parts)
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported file type: {file_type}"
            )
        
        if not extracted_text.strip():
            db.rollback()
            fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
            if fw:
                fw.upload_status = "parsed"
                fw.parsed_at = datetime.utcnow()
                fw.parse_error = "No text could be extracted from the document"
                db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No text could be extracted from the document"
            )
        
        parsed_controls_data = parse_document_with_chunking(extracted_text, framework_name)
        
        if not parsed_controls_data:
            fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
            if fw:
                fw.upload_status = "parsed"
                fw.parsed_at = datetime.utcnow()
                fw.parse_error = "No controls found in document"
                db.commit()
            return {"message": "No controls found", "controls": []}
        
        fw_check = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
        if not fw_check:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Framework was deleted during parsing"
            )
        
        existing_controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == framework_id
        ).all()
        existing_control_ids = [c.id for c in existing_controls]
        
        if existing_control_ids:
            assessment_item_ids = db.query(AssessmentItem.id).filter(
                AssessmentItem.parsed_control_id.in_(existing_control_ids)
            ).all()
            ai_ids = [a.id for a in assessment_item_ids]
            
            if ai_ids:
                db.query(AssessmentRemediation).filter(
                    AssessmentRemediation.assessment_item_id.in_(ai_ids)
                ).delete(synchronize_session=False)
                
                db.query(AssessmentEvidence).filter(
                    AssessmentEvidence.assessment_item_id.in_(ai_ids)
                ).delete(synchronize_session=False)
                
                db.query(AssessmentItem).filter(
                    AssessmentItem.id.in_(ai_ids)
                ).delete(synchronize_session=False)
            
            db.query(FrameworkControlAlignment).filter(
                FrameworkControlAlignment.parsed_control_id.in_(existing_control_ids)
            ).delete(synchronize_session=False)
            
            db.query(ControlEvidenceMapping).filter(
                ControlEvidenceMapping.parsed_control_id.in_(existing_control_ids)
            ).delete(synchronize_session=False)
            
            db.query(ParsedFrameworkControl).filter(
                ParsedFrameworkControl.id.in_(existing_control_ids)
            ).delete(synchronize_session=False)
        
        db.flush()
        
        created_controls = []
        for idx, control_data in enumerate(parsed_controls_data, start=1):
            control_id = f"FW-{framework_id:03d}-{idx:03d}"
            
            raw_reference = control_data.get("original_reference", "")
            cleaned_reference = clean_section_reference(raw_reference) if raw_reference else None
            
            parent_ref = control_data.get("parent_reference", "")
            cleaned_parent_ref = clean_section_reference(parent_ref) if parent_ref else None
            
            hierarchy_level = control_data.get("hierarchy_level", 1)
            if not isinstance(hierarchy_level, int) or hierarchy_level < 1:
                hierarchy_level = 1
            elif hierarchy_level > 5:
                hierarchy_level = 5
            
            testing_procedure = control_data.get("testing_procedure", "")
            ai_notes = control_data.get("ai_notes", "")
            
            full_ai_notes = ai_notes
            if testing_procedure:
                full_ai_notes = f"Testing: {testing_procedure}" + (f"\n{ai_notes}" if ai_notes else "")
            
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
                ai_notes=full_ai_notes[:1000] if full_ai_notes else None,
                is_verified=False
            )
            db.add(parsed_control)
            db.flush()
            
            evidence_requirements = control_data.get("evidence_requirements", [])
            if evidence_requirements:
                for ev_req in evidence_requirements:
                    if isinstance(ev_req, dict):
                        ev_type = ev_req.get("type", "document")
                        ev_title = ev_req.get("title", "")
                        ev_description = ev_req.get("description", "")
                        ev_is_required = ev_req.get("is_required", True)
                        ev_examples = ev_req.get("artifact_examples", [])
                        ev_frequency = ev_req.get("review_frequency", "")
                        
                        full_description = ev_title
                        if ev_description:
                            full_description = f"{ev_title}: {ev_description}" if ev_title else ev_description
                        if ev_examples and isinstance(ev_examples, list):
                            full_description += f" Examples: {', '.join(ev_examples[:3])}"
                        if ev_frequency:
                            full_description += f" (Frequency: {ev_frequency})"
                        
                        valid_types = [
                            "policy", "procedure", "configuration", "log", "report", 
                            "contract", "attestation", "register", "matrix", "plan", 
                            "screenshot", "training", "assessment", "document",
                            "interview", "observation"
                        ]
                        if ev_type not in valid_types:
                            ev_type = "document"
                        
                        evidence_mapping = ControlEvidenceMapping(
                            parsed_control_id=parsed_control.id,
                            evidence_type=ev_type,
                            evidence_description=full_description[:1000] if full_description else None,
                            is_required=ev_is_required if isinstance(ev_is_required, bool) else True,
                            suggested_by_ai=True
                        )
                        db.add(evidence_mapping)
            else:
                evidence_types = control_data.get("evidence_types", [])
                for evidence_type in evidence_types:
                    if evidence_type in ["policy", "procedure", "configuration", "log", "report", "contract"]:
                        evidence_mapping = ControlEvidenceMapping(
                            parsed_control_id=parsed_control.id,
                            evidence_type=evidence_type,
                            is_required=True,
                            suggested_by_ai=True
                        )
                        db.add(evidence_mapping)
            
            created_controls.append(parsed_control)
        
        fw_final = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
        if fw_final:
            fw_final.upload_status = "parsed"
            fw_final.parsed_at = datetime.utcnow()
            fw_final.parse_error = None
        
        db.commit()
        
        for control in created_controls:
            db.refresh(control)
        
        return {
            "message": f"Successfully parsed {len(created_controls)} controls",
            "framework_id": framework_id,
            "controls_count": len(created_controls),
            "controls": [serialize_parsed_control(c) for c in created_controls]
        }
    
    except HTTPException:
        db.rollback()
        try:
            fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
            if fw:
                fw.upload_status = "failed"
                fw.parse_error = "Parsing failed"
                db.commit()
        except Exception:
            pass
        raise
    except Exception as e:
        db.rollback()
        error_msg = str(e)
        try:
            fw = db.query(UploadedFramework).filter(UploadedFramework.id == framework_id).first()
            if fw:
                fw.upload_status = "failed"
                fw.parse_error = error_msg[:500]
                db.commit()
        except Exception:
            pass
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Parsing failed: {error_msg}"
        )


@router.get("/{framework_id}/controls")
def list_parsed_controls(
    framework_id: int,
    domain: Optional[str] = None,
    category: Optional[str] = None,
    is_verified: Optional[bool] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Uploaded framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    query = db.query(ParsedFrameworkControl).options(
        joinedload(ParsedFrameworkControl.evidence_mappings)
    ).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    )
    
    if domain:
        query = query.filter(ParsedFrameworkControl.domain == domain)
    if category:
        query = query.filter(ParsedFrameworkControl.category == category)
    if is_verified is not None:
        query = query.filter(ParsedFrameworkControl.is_verified == is_verified)
    
    total = query.count()
    controls = query.order_by(ParsedFrameworkControl.control_id).offset(skip).limit(limit).all()
    
    return {
        "items": [serialize_parsed_control(c) for c in controls],
        "total": total,
        "skip": skip,
        "limit": limit,
        "framework_id": framework_id,
        "framework_name": framework.name
    }


@router.put("/controls/{control_id}")
def update_parsed_control(
    control_id: int,
    update_data: ParsedControlUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(ParsedFrameworkControl).options(
        joinedload(ParsedFrameworkControl.evidence_mappings),
        joinedload(ParsedFrameworkControl.uploaded_framework)
    ).filter(
        ParsedFrameworkControl.id == control_id
    ).first()
    
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Parsed control not found"
        )
    
    validate_framework_access(current_user, control.uploaded_framework, db)
    
    if update_data.title is not None:
        control.title = update_data.title[:500]
    if update_data.description is not None:
        control.description = update_data.description
    if update_data.domain is not None:
        control.domain = update_data.domain
    if update_data.category is not None:
        control.category = update_data.category
    if update_data.is_mandatory is not None:
        control.is_mandatory = update_data.is_mandatory
    if update_data.priority is not None:
        if update_data.priority in ["high", "medium", "low"]:
            control.priority = update_data.priority
    
    control.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(control)
    
    return serialize_parsed_control(control)


@router.post("/controls/{control_id}/verify")
def verify_parsed_control(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(ParsedFrameworkControl).options(
        joinedload(ParsedFrameworkControl.evidence_mappings),
        joinedload(ParsedFrameworkControl.uploaded_framework)
    ).filter(
        ParsedFrameworkControl.id == control_id
    ).first()
    
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Parsed control not found"
        )
    
    validate_framework_access(current_user, control.uploaded_framework, db)
    
    control.is_verified = True
    control.verified_by = current_user.id
    control.verified_at = datetime.utcnow()
    control.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(control)
    
    return {
        "message": "Control verified successfully",
        "control": serialize_parsed_control(control)
    }


@router.delete("/controls/{control_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_parsed_control(
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    control = db.query(ParsedFrameworkControl).options(
        joinedload(ParsedFrameworkControl.uploaded_framework)
    ).filter(
        ParsedFrameworkControl.id == control_id
    ).first()
    
    if not control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Parsed control not found"
        )
    
    validate_framework_access(current_user, control.uploaded_framework, db)
    
    db.delete(control)
    db.commit()
    
    return None


parser_router = router
