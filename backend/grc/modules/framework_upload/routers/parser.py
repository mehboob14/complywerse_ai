from ....config import get_openai_api_key, get_openai_model

import os
import json
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request, status, Query, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from pydantic import BaseModel
from openai import OpenAI

from ....models import (
    UploadedFramework, ParsedFrameworkControl, GRCUser, get_db,
    ControlEvidenceRequirement, EvidenceRequirementHistory,
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/parser", tags=["Frameworks - Controls and evidence requirements"])


def get_openai_client() -> OpenAI:
    """Get OpenAI client with runtime API key reading."""
    api_key = get_openai_api_key()
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    if base_url and "modelfarm" in base_url:
        return OpenAI(
            api_key=api_key,
            base_url=base_url
        )
    if api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    return OpenAI(
        api_key=api_key,
        base_url=base_url
    )


def check_ai_available() -> bool:
    """Check if OpenAI API key is configured (at runtime)."""
    api_key = get_openai_api_key()
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if not api_key:
        return False
    if base_url and "modelfarm" in base_url:
        return True
    if api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20:
        return False
    return True


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


GRC_SME_SYSTEM_PROMPT = """You are a SENIOR GRC SUBJECT MATTER EXPERT with 20+ years of experience in regulatory compliance, audit, and risk management across multiple industries. You have deep expertise in:

=== YOUR CREDENTIALS AND EXPERTISE ===

CERTIFICATIONS YOU HOLD:
- CISA (Certified Information Systems Auditor)
- CISSP (Certified Information Systems Security Professional)
- CRISC (Certified in Risk and Information Systems Control)
- CGEIT (Certified in Governance of Enterprise IT)
- ISO 27001 and other ISO standards  Lead Auditor
- PCI QSA (Qualified Security Assessor)
- SOC 2 Type II Practitioner
- SBP - State bank of Pakistan, internet outsourcing,cloud etc frameworks.

FRAMEWORKS YOU KNOW INTIMATELY:
1. ISO STANDARDS: ISO 27001/27002 (ISMS), ISO 27701 (Privacy), ISO 22301 (BCM), ISO 9001 (QMS), ISO 31000 (Risk), ISO 27017/27018 (Cloud)
2. NIST: CSF, SP 800-53, SP 800-171, RMF, Privacy Framework
3. PAYMENT CARD: PCI DSS v4.0, PA-DSS, PCI PIN, P2PE
4. FINANCIAL: SOX, Basel III/IV, DORA, MAS TRM, FFIEC, GLBA
5. PRIVACY: GDPR, CCPA/CPRA, HIPAA, LGPD, PDPA, POPIA
6. INDUSTRY: COBIT, ITIL, CIS Controls, NERC CIP, FedRAMP, StateRAMP
7. REGIONAL: NCA (Saudi), SAMA, ISR (Israel), TISAX (Auto), SWIFT CSP
8. PAKISTAN: State Bank of Pakistan (SBP) frameworks for outsourcing, cloud, information security, etc.

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


def _enhance_controls_body(db, framework_id: int, framework_name: str):
    """Body of the AI-enhance job. Takes an open tenant-scoped session."""
    try:
        if not check_ai_available():
            print("[ENHANCE] OpenAI API key not configured", flush=True)
            return
        
        client = get_openai_client()
        
        controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == framework_id
        ).all()
        
        if not controls:
            print(f"[ENHANCE] No controls found for framework {framework_id}", flush=True)
            return
        
        framework = db.query(UploadedFramework).filter(
            UploadedFramework.id == framework_id
        ).first()
        
        if framework:
            framework.upload_status = "enhancing"
            db.commit()
        
        print(f"[ENHANCE] Starting enhancement for {len(controls)} controls in {framework_name}", flush=True)
        
        batch_size = 10
        total_batches = (len(controls) + batch_size - 1) // batch_size
        
        for batch_num, i in enumerate(range(0, len(controls), batch_size), start=1):
            batch = controls[i:i + batch_size]
            print(f"[ENHANCE] Processing batch {batch_num}/{total_batches} ({len(batch)} controls)...", flush=True)
            
            controls_data = []
            for c in batch:
                controls_data.append({
                    "id": c.id,
                    "control_id": c.control_id,
                    "title": c.title,
                    "description": c.description or "",
                    "full_text": c.full_text or ""
                })
            
            controls_json = json.dumps(controls_data, indent=2)
            
            prompt = f"""For framework "{framework_name}", generate audit-ready evidence requirements for these controls.

INPUT CONTROLS:
{controls_json}

For EACH control, provide:
- id: Keep the same ID from input
- evidence_requirements: Array of 2-4 evidence items, each with:
  {{
    "type": "policy|procedure|configuration|log|report|contract|attestation|register|screenshot|interview|test_results",
    "title": "specific evidence name (e.g., 'Access Control Policy Document')",
    "description": "what auditor looks for and how to obtain",
    "is_required": true/false
  }}

Be specific and practical. Example evidence types:
- policy: Written policies (Information Security Policy, Access Control Policy)
- procedure: Step-by-step procedures (Incident Response Procedure, Change Management Procedure)
- configuration: System configs (Firewall rules, AD group memberships, encryption settings)
- log: Audit logs (Login logs, change logs, access logs)
- report: Periodic reports (Vulnerability scan reports, compliance dashboards)
- attestation: Signed acknowledgments (Training completion, policy acceptance)
- test_results: Test evidence (Penetration test reports, DR test results)

Return JSON with "controls" array containing objects with "id" and "evidence_requirements"."""

            try:
                import time
                start_time = time.time()
                
                response = client.chat.completions.create(
                    model=get_openai_model(),
                    messages=[
                        {"role": "system", "content": "You are a GRC expert adding audit-ready evidence requirements to compliance controls. Be specific and practical."},
                        {"role": "user", "content": prompt}
                    ],
                    response_format={"type": "json_object"},
                    max_tokens=16384,
                    temperature=0
                )
                
                elapsed = time.time() - start_time
                result_text = response.choices[0].message.content or "{}"
                result = json.loads(result_text)
                enhanced_batch = result.get("controls", [])
                
                id_to_evidence = {int(item["id"]): item.get("evidence_requirements", []) for item in enhanced_batch}
                
                matched_count = 0
                for control in batch:
                    if control.id in id_to_evidence:
                        evidence_reqs = id_to_evidence[control.id]
                        if evidence_reqs:
                            control.evidence_requirements = evidence_reqs
                            control.updated_at = datetime.utcnow()
                            matched_count += 1
                
                print(f"[ENHANCE] Matched {matched_count}/{len(batch)} controls with evidence", flush=True)
                
                db.commit()
                print(f"[ENHANCE] Batch {batch_num} completed in {elapsed:.1f}s", flush=True)
                
            except Exception as e:
                print(f"[ENHANCE] Error in batch {batch_num}: {str(e)}", flush=True)
                continue
        
        if framework:
            framework.upload_status = "published"
            framework.updated_at = datetime.utcnow()
            db.commit()
        
        print(f"[ENHANCE] Enhancement complete for framework {framework_id}", flush=True)
        return {"status": "completed", "framework_id": framework_id}
    except Exception as e:
        print(f"[ENHANCE] Error: {str(e)}", flush=True)
        raise


def enhance_framework_controls_background(framework_id: int, framework_name: str, tenant_slug: str):
    """Legacy in-process entry; new dispatches use the Celery task."""
    from ....db import open_tenant_session
    db = open_tenant_session(tenant_slug)
    try:
        return _enhance_controls_body(db, framework_id, framework_name)
    finally:
        db.close()


@router.post("/frameworks/{framework_id}/enhance")
def enhance_framework_with_evidence(
    framework_id: int,
    background_tasks: BackgroundTasks,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Enhance all controls in a framework with AI-generated evidence requirements."""
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    if framework.upload_status == "enhancing":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Framework is already being enhanced"
        )
    
    control_count = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    ).count()
    
    if control_count == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No controls found to enhance"
        )
    
    controls_with_evidence = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id,
        ParsedFrameworkControl.evidence_requirements != None,
        func.jsonb_array_length(ParsedFrameworkControl.evidence_requirements) > 0
    ).count()
    
    tenant_slug = getattr(http_request.state, "tenant_slug", None)
    if not tenant_slug:
        raise HTTPException(status_code=400, detail="Tenant context required")

    from ....tasks.base import tenant_rate_limit, RateLimitExceeded
    try:
        tenant_rate_limit(tenant_slug, bucket="framework_enhance")
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many enhancement runs queued; try again shortly")
    from ....tasks.frameworks import enhance_framework_controls as _enhance_task
    _enhance_task.delay(tenant_slug, framework_id, framework.name)
    
    return {
        "message": "Enhancement started",
        "framework_id": framework_id,
        "framework_name": framework.name,
        "total_controls": control_count,
        "controls_with_evidence": controls_with_evidence,
        "estimated_time_minutes": max(1, (control_count // 10) * 0.5)
    }


@router.get("/frameworks/{framework_id}/enhancement-status")
def get_enhancement_status(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get the enhancement status for a framework."""
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    total_controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    ).count()
    
    controls_with_evidence = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id,
        ParsedFrameworkControl.evidence_requirements != None,
        func.jsonb_array_length(ParsedFrameworkControl.evidence_requirements) > 0
    ).count()
    
    return {
        "framework_id": framework_id,
        "framework_name": framework.name,
        "status": framework.upload_status,
        "total_controls": total_controls,
        "controls_with_evidence": controls_with_evidence,
        "enhancement_progress": round((controls_with_evidence / total_controls * 100) if total_controls > 0 else 0, 1)
    }


EVIDENCE_GENERATION_PROMPT = """You are a GRC expert specializing in audit evidence and compliance documentation. For the given control requirement, generate SPECIFIC evidence requirements that would satisfy an auditor.

CONTROL INFORMATION:
Control ID: {control_id}
Title: {title}
Description: {description}
Full Text: {full_text}
Domain: {domain}
Is Mandatory: {is_mandatory}

Generate 1-5 SPECIFIC evidence requirements. Be EXACT about what documentation, screenshots, exports, or records are needed.

For each evidence requirement, specify:
1. evidence_title: Clear, specific title
2. evidence_description: Detailed description (2-3 sentences)
3. evidence_type: One of: policy, procedure, configuration, screenshot, log, report, contract, attestation, certificate, training_record
4. evidence_format: e.g., "PDF document", "System screenshot", "CSV export", "Signed PDF"
5. exact_requirements: Array of specific items needed (e.g., ["Rule definitions", "Source/destination IPs", "Date of last update"])
6. acceptance_criteria: Array of criteria (e.g., ["Dated within last 12 months", "Signed by manager", "Shows complete configuration"])
7. sample_evidence: Brief description of an ideal sample
8. collection_guidance: How to collect this evidence (1-2 sentences)
9. collection_frequency: one-time, monthly, quarterly, annually, or on-change
10. retention_period: e.g., "3 years"
11. priority: high (critical controls), medium, or low
12. is_mandatory: true if required for compliance, false if supporting

Return JSON with "evidence_requirements" array."""


def generate_evidence_requirements_for_controls_batch(
    controls: List[ParsedFrameworkControl],
    framework_name: str
) -> List[dict]:
    """Generate evidence requirements for a batch of controls using AI."""
    if not check_ai_available():
        return []
    
    client = get_openai_client()
    
    results = []
    
    for control in controls:
        prompt = EVIDENCE_GENERATION_PROMPT.format(
            control_id=control.control_id,
            title=control.title,
            description=control.description or "",
            full_text=control.full_text or "",
            domain=control.domain or "General",
            is_mandatory=control.is_mandatory
        )
        
        try:
            response = client.chat.completions.create(
                model=get_openai_model(),
                messages=[
                    {"role": "system", "content": GRC_SME_SYSTEM_PROMPT},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"},
                max_tokens=4096,
                temperature=0
            )
            
            result_text = response.choices[0].message.content or "{}"
            result = json.loads(result_text)
            evidence_reqs = result.get("evidence_requirements", [])
            
            for req in evidence_reqs:
                req["parsed_control_id"] = control.id
            
            results.extend(evidence_reqs)
            
        except Exception as e:
            print(f"[EVIDENCE] Error generating for control {control.id}: {e}", flush=True)
            continue
    
    return results


def _generate_evidence_reqs_body(db, framework_id: int, framework_name: str):
    """Body of the generate-evidence-reqs job. Takes an open tenant-scoped session."""
    try:
        framework = db.query(UploadedFramework).filter(
            UploadedFramework.id == framework_id
        ).first()
        
        if not framework:
            return
        
        framework.parse_error = "Generating evidence requirements..."
        db.commit()
        
        controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == framework_id
        ).all()
        
        if not controls:
            framework.parse_error = "No controls found"
            db.commit()
            return
        
        total_controls = len(controls)
        batch_size = 5
        total_batches = (total_controls + batch_size - 1) // batch_size
        total_requirements = 0
        
        for batch_num, i in enumerate(range(0, total_controls, batch_size), start=1):
            batch = controls[i:i + batch_size]
            
            progress = round((batch_num / total_batches) * 100)
            framework.parse_error = f"Generating evidence requirements... {progress}% ({batch_num}/{total_batches} batches)"
            db.commit()
            
            print(f"[EVIDENCE] Processing batch {batch_num}/{total_batches} ({len(batch)} controls)", flush=True)
            
            evidence_reqs = generate_evidence_requirements_for_controls_batch(batch, framework_name)
            
            for req in evidence_reqs:
                evidence_record = ControlEvidenceRequirement(
                    framework_id=framework_id,
                    parsed_control_id=req.get("parsed_control_id"),
                    evidence_title=req.get("evidence_title", "Evidence Requirement")[:500],
                    evidence_description=req.get("evidence_description", ""),
                    evidence_type=req.get("evidence_type", "policy")[:100],
                    evidence_format=req.get("evidence_format", "PDF")[:100] if req.get("evidence_format") else None,
                    exact_requirements=req.get("exact_requirements", []),
                    acceptance_criteria=req.get("acceptance_criteria", []),
                    sample_evidence=req.get("sample_evidence"),
                    collection_guidance=req.get("collection_guidance"),
                    collection_frequency=req.get("collection_frequency", "annually")[:50] if req.get("collection_frequency") else None,
                    retention_period=req.get("retention_period", "3 years")[:100] if req.get("retention_period") else None,
                    priority=normalize_priority(req.get("priority", "medium")),
                    is_mandatory=req.get("is_mandatory", True),
                    status="draft",
                    ai_confidence=0.85,
                    ai_reasoning=f"AI-generated evidence requirement for control {req.get('parsed_control_id')}"
                )
                db.add(evidence_record)
                total_requirements += 1
            
            db.commit()
        
        framework.parse_error = None
        db.commit()

        print(f"[EVIDENCE] Completed! Generated {total_requirements} evidence requirements for {total_controls} controls", flush=True)
        return {"status": "completed", "framework_id": framework_id, "total_requirements": total_requirements, "total_controls": total_controls}
    except Exception as e:
        print(f"[EVIDENCE] Error: {str(e)}", flush=True)
        if framework:
            framework.parse_error = f"Error generating evidence: {str(e)[:200]}"
            db.commit()
        raise


def generate_evidence_requirements_background(framework_id: int, framework_name: str, tenant_slug: str):
    """Legacy in-process entry; new dispatches use the Celery task."""
    from ....db import open_tenant_session
    db = open_tenant_session(tenant_slug)
    try:
        return _generate_evidence_reqs_body(db, framework_id, framework_name)
    finally:
        db.close()


@router.post("/{framework_id}/generate-evidence-requirements")
def generate_evidence_requirements(
    framework_id: int,
    background_tasks: BackgroundTasks,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Generate AI-powered evidence requirements for all controls in a framework."""
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    if not check_ai_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    
    control_count = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    ).count()
    
    if control_count == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No controls found in this framework. Please parse the framework first."
        )
    
    existing_requirements = db.query(ControlEvidenceRequirement).filter(
        ControlEvidenceRequirement.framework_id == framework_id
    ).count()
    
    tenant_slug = getattr(http_request.state, "tenant_slug", None)
    if not tenant_slug:
        raise HTTPException(status_code=400, detail="Tenant context required")

    from ....tasks.base import tenant_rate_limit, RateLimitExceeded
    try:
        tenant_rate_limit(tenant_slug, bucket="framework_evidence_reqs")
    except RateLimitExceeded:
        raise HTTPException(status_code=429, detail="Too many evidence-requirement jobs queued; try again shortly")
    from ....tasks.frameworks import generate_evidence_requirements as _evid_task
    _evid_task.delay(tenant_slug, framework_id, framework.name)
    
    return {
        "message": "Evidence requirement generation started",
        "framework_id": framework_id,
        "framework_name": framework.name,
        "total_controls": control_count,
        "existing_requirements": existing_requirements,
        "estimated_time_minutes": max(1, (control_count // 5) * 0.5)
    }


@router.get("/{framework_id}/evidence-requirements")
def list_evidence_requirements(
    framework_id: int,
    status_filter: Optional[str] = Query(None, alias="status"),
    control_id: Optional[int] = Query(None),
    evidence_type: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """List all evidence requirements for a framework with filtering options."""
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    query = db.query(ControlEvidenceRequirement).filter(
        ControlEvidenceRequirement.framework_id == framework_id,
        ControlEvidenceRequirement.is_active == True
    )
    
    if status_filter:
        query = query.filter(ControlEvidenceRequirement.status == status_filter)
    
    if control_id:
        query = query.filter(ControlEvidenceRequirement.parsed_control_id == control_id)
    
    if evidence_type:
        query = query.filter(ControlEvidenceRequirement.evidence_type == evidence_type)
    
    if priority:
        query = query.filter(ControlEvidenceRequirement.priority == priority)
    
    total = query.count()
    
    requirements = query.order_by(
        ControlEvidenceRequirement.parsed_control_id,
        ControlEvidenceRequirement.display_order,
        ControlEvidenceRequirement.id
    ).offset(skip).limit(limit).all()
    
    status_counts = db.query(
        ControlEvidenceRequirement.status,
        func.count(ControlEvidenceRequirement.id)
    ).filter(
        ControlEvidenceRequirement.framework_id == framework_id,
        ControlEvidenceRequirement.is_active == True
    ).group_by(ControlEvidenceRequirement.status).all()
    
    return {
        "framework_id": framework_id,
        "framework_name": framework.name,
        "total": total,
        "status_counts": {s: c for s, c in status_counts},
        "requirements": [
            {
                "id": req.id,
                "parsed_control_id": req.parsed_control_id,
                "control_id": req.parsed_control.control_id if req.parsed_control else None,
                "control_title": req.parsed_control.title if req.parsed_control else None,
                "evidence_title": req.evidence_title,
                "evidence_description": req.evidence_description,
                "evidence_type": req.evidence_type,
                "evidence_format": req.evidence_format,
                "exact_requirements": req.exact_requirements,
                "acceptance_criteria": req.acceptance_criteria,
                "sample_evidence": req.sample_evidence,
                "collection_guidance": req.collection_guidance,
                "collection_frequency": req.collection_frequency,
                "retention_period": req.retention_period,
                "priority": req.priority,
                "is_mandatory": req.is_mandatory,
                "status": req.status,
                "ai_confidence": req.ai_confidence,
                "ai_reasoning": req.ai_reasoning,
                "rejection_reason": req.rejection_reason,
                "created_at": req.created_at.isoformat() if req.created_at else None,
                "submitted_at": req.submitted_at.isoformat() if req.submitted_at else None,
                "reviewed_at": req.reviewed_at.isoformat() if req.reviewed_at else None,
                "approved_at": req.approved_at.isoformat() if req.approved_at else None
            }
            for req in requirements
        ]
    }


class WorkflowSubmitRequest(BaseModel):
    notes: Optional[str] = None


class WorkflowReviewRequest(BaseModel):
    notes: Optional[str] = None


class WorkflowApproveRequest(BaseModel):
    notes: Optional[str] = None


class WorkflowRejectRequest(BaseModel):
    reason: str


@router.post("/evidence-requirements/{requirement_id}/submit")
def submit_evidence_requirement(
    requirement_id: int,
    request: WorkflowSubmitRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Submit an evidence requirement for review."""
    requirement = db.query(ControlEvidenceRequirement).filter(
        ControlEvidenceRequirement.id == requirement_id,
        ControlEvidenceRequirement.is_active == True
    ).first()
    
    if not requirement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence requirement not found"
        )
    
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == requirement.framework_id
    ).first()
    
    if framework:
        validate_framework_access(current_user, framework, db)
    
    if requirement.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot submit requirement with status '{requirement.status}'. Only draft requirements can be submitted."
        )
    
    previous_status = requirement.status
    requirement.status = "submitted"
    requirement.submitted_by = current_user.id
    requirement.submitted_at = datetime.utcnow()
    requirement.submission_notes = request.notes
    
    history = EvidenceRequirementHistory(
        evidence_requirement_id=requirement_id,
        action="submitted",
        previous_status=previous_status,
        new_status="submitted",
        performed_by=current_user.id,
        notes=request.notes
    )
    db.add(history)
    
    db.commit()
    
    return {
        "message": "Evidence requirement submitted for review",
        "requirement_id": requirement_id,
        "status": requirement.status,
        "submitted_at": requirement.submitted_at.isoformat()
    }


@router.post("/evidence-requirements/{requirement_id}/review")
def start_review_evidence_requirement(
    requirement_id: int,
    request: WorkflowReviewRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Start review of an evidence requirement (requires reviewer role)."""
    requirement = db.query(ControlEvidenceRequirement).filter(
        ControlEvidenceRequirement.id == requirement_id,
        ControlEvidenceRequirement.is_active == True
    ).first()
    
    if not requirement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence requirement not found"
        )
    
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == requirement.framework_id
    ).first()
    
    if framework:
        validate_framework_access(current_user, framework, db)
    
    if requirement.status != "submitted":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot review requirement with status '{requirement.status}'. Only submitted requirements can be reviewed."
        )
    
    previous_status = requirement.status
    requirement.status = "pending_review"
    requirement.reviewer_id = current_user.id
    requirement.reviewed_at = datetime.utcnow()
    requirement.review_notes = request.notes
    
    history = EvidenceRequirementHistory(
        evidence_requirement_id=requirement_id,
        action="review_started",
        previous_status=previous_status,
        new_status="pending_review",
        performed_by=current_user.id,
        notes=request.notes
    )
    db.add(history)
    
    db.commit()
    
    return {
        "message": "Review started for evidence requirement",
        "requirement_id": requirement_id,
        "status": requirement.status,
        "reviewed_at": requirement.reviewed_at.isoformat()
    }


@router.post("/evidence-requirements/{requirement_id}/approve")
def approve_evidence_requirement(
    requirement_id: int,
    request: WorkflowApproveRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Approve an evidence requirement."""
    requirement = db.query(ControlEvidenceRequirement).filter(
        ControlEvidenceRequirement.id == requirement_id,
        ControlEvidenceRequirement.is_active == True
    ).first()
    
    if not requirement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence requirement not found"
        )
    
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == requirement.framework_id
    ).first()
    
    if framework:
        validate_framework_access(current_user, framework, db)
    
    if requirement.status not in ["submitted", "pending_review"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot approve requirement with status '{requirement.status}'. Only submitted or pending_review requirements can be approved."
        )
    
    previous_status = requirement.status
    requirement.status = "approved"
    requirement.approver_id = current_user.id
    requirement.approved_at = datetime.utcnow()
    requirement.approval_notes = request.notes
    
    history = EvidenceRequirementHistory(
        evidence_requirement_id=requirement_id,
        action="approved",
        previous_status=previous_status,
        new_status="approved",
        performed_by=current_user.id,
        notes=request.notes
    )
    db.add(history)
    
    db.commit()
    
    return {
        "message": "Evidence requirement approved",
        "requirement_id": requirement_id,
        "status": requirement.status,
        "approved_at": requirement.approved_at.isoformat()
    }


@router.post("/evidence-requirements/{requirement_id}/reject")
def reject_evidence_requirement(
    requirement_id: int,
    request: WorkflowRejectRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Reject an evidence requirement with a reason."""
    requirement = db.query(ControlEvidenceRequirement).filter(
        ControlEvidenceRequirement.id == requirement_id,
        ControlEvidenceRequirement.is_active == True
    ).first()
    
    if not requirement:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence requirement not found"
        )
    
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == requirement.framework_id
    ).first()
    
    if framework:
        validate_framework_access(current_user, framework, db)
    
    if requirement.status not in ["submitted", "pending_review"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot reject requirement with status '{requirement.status}'. Only submitted or pending_review requirements can be rejected."
        )
    
    previous_status = requirement.status
    requirement.status = "rejected"
    requirement.rejection_reason = request.reason
    requirement.approver_id = current_user.id
    requirement.approved_at = datetime.utcnow()
    
    history = EvidenceRequirementHistory(
        evidence_requirement_id=requirement_id,
        action="rejected",
        previous_status=previous_status,
        new_status="rejected",
        performed_by=current_user.id,
        notes=request.reason
    )
    db.add(history)
    
    db.commit()
    
    return {
        "message": "Evidence requirement rejected",
        "requirement_id": requirement_id,
        "status": requirement.status,
        "rejection_reason": requirement.rejection_reason
    }


@router.get("/{framework_id}/evidence-generation-status")
def get_evidence_generation_status(
    framework_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get the status of evidence requirement generation for a framework."""
    framework = db.query(UploadedFramework).filter(
        UploadedFramework.id == framework_id
    ).first()
    
    if not framework:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Framework not found"
        )
    
    validate_framework_access(current_user, framework, db)
    
    total_controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == framework_id
    ).count()
    
    total_requirements = db.query(ControlEvidenceRequirement).filter(
        ControlEvidenceRequirement.framework_id == framework_id,
        ControlEvidenceRequirement.is_active == True
    ).count()
    
    controls_with_requirements = db.query(
        func.count(func.distinct(ControlEvidenceRequirement.parsed_control_id))
    ).filter(
        ControlEvidenceRequirement.framework_id == framework_id,
        ControlEvidenceRequirement.is_active == True
    ).scalar() or 0
    
    status_counts = db.query(
        ControlEvidenceRequirement.status,
        func.count(ControlEvidenceRequirement.id)
    ).filter(
        ControlEvidenceRequirement.framework_id == framework_id,
        ControlEvidenceRequirement.is_active == True
    ).group_by(ControlEvidenceRequirement.status).all()
    
    is_generating = framework.parse_error and "Generating evidence requirements" in framework.parse_error
    
    return {
        "framework_id": framework_id,
        "framework_name": framework.name,
        "is_generating": is_generating,
        "progress_message": framework.parse_error if is_generating else None,
        "total_controls": total_controls,
        "controls_with_requirements": controls_with_requirements,
        "total_requirements": total_requirements,
        "average_requirements_per_control": round(total_requirements / controls_with_requirements, 1) if controls_with_requirements > 0 else 0,
        "status_breakdown": {s: c for s, c in status_counts}
    }


parser_router = router
