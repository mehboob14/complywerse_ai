import os
import json
import hashlib
import time
import logging
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from pydantic import BaseModel
from openai import OpenAI

logger = logging.getLogger(__name__)

from ....models import (
    Evidence, EvidenceAIAssessment, EvidenceControlMapping, EvidenceAssessmentCache,
    GRCUser, get_db, Framework, FrameworkDomain, ControlObjective, FrameworkControl,
    UploadedFramework, ParsedFrameworkControl
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/ai", tags=["Evidence - AI Assessment"])

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")

# Version tracking for deterministic assessments
# v2.1: Updated to use uploaded frameworks instead of pre-seeded ones
# v2.2: Include actual control IDs in prompt to prevent hallucination of generic control IDs
PROMPT_VERSION = "2.3"  # Added mandatory multi-framework analysis
# the newest OpenAI model is "gpt-5" which was released August 7, 2025.
# Using gpt-4o for compatibility with Replit AI integrations
MODEL_VERSION = "gpt-4o"

# Enhanced prompt for clause-level mapping with auditor-defensible output
# Version 2.3: Added MANDATORY multi-framework analysis requirement
DETERMINISTIC_ASSESSMENT_PROMPT = """You are a Senior GRC Compliance Expert with 20+ years of experience, holding CISA, CISSP, CRISC, and ISO 27001 Lead Auditor certifications. Analyze this compliance evidence with extreme precision for regulatory audit purposes.

MANDATORY MULTI-FRAMEWORK ANALYSIS:
You MUST analyze this evidence against EVERY framework listed below and return control mappings for ALL frameworks where relevant controls exist. Do NOT stop after finding matches in one framework. Enterprise compliance requires demonstrating coverage across ALL applicable regulatory frameworks.

CRITICAL REQUIREMENTS:
1. ANALYZE EVERY FRAMEWORK: Examine each framework in the list and identify ALL applicable controls
2. ONLY use control IDs from the VALID CONTROL IDs list below - DO NOT invent or hallucinate control IDs
3. Use the EXACT framework names and EXACT control IDs as provided - no variations allowed
4. If a control ID is not in the list below, DO NOT include it in your response
5. ONLY map to controls that have EXPLICIT evidence in the document
6. Include specific text excerpts from the evidence that support each mapping
7. No control should be marked applicable without explicit clause-level evidence match
8. Return mappings from MULTIPLE frameworks if the evidence covers controls in multiple frameworks

WARNING: Generic ISO 27001 control IDs like "A.5.1", "A.12.4.1" are NOT valid unless they appear in the VALID CONTROL IDs list below. Each framework has its OWN control numbering scheme.

AVAILABLE FRAMEWORKS WITH THEIR VALID CONTROL IDs (analyze evidence against ALL of these):
{available_frameworks}

Evidence Content:
{evidence_content}

Provide a comprehensive, auditor-defensible assessment in the following JSON format:
{{
    "relevance_score": <0-100>,
    "adequacy_score": <0-100>,
    "audit_readiness": <0-100>,
    "confidence_score": <0-100>,
    "summary": "<2-3 sentence description>",
    
    "clause_mappings": [
        {{
            "framework_name": "<USE EXACT framework name from the UPLOADED FRAMEWORKS list above>",
            "control_id": "<exact control ID from the framework, e.g., A.5.1, 1.2.3>",
            "clause_reference": "<exact clause/sub-clause reference>",
            "control_title": "<control title text>",
            "matching_rationale": "<specific explanation why this evidence satisfies this control>",
            "confidence": <0-100>,
            "coverage_type": "<full|partial|supporting|not_applicable>",
            "matched_text_excerpt": "<exact text from evidence that matches this control>"
        }}
    ],
    
    "detected_controls": ["<FRAMEWORK: control_code>", ...],
    "compliance_frameworks": ["<FRAMEWORK: clause>", ...],
    "gaps": ["<specific gap with remediation suggestion>", ...],
    "recommendations": ["<actionable recommendation>", ...],
    
    "evidence_text_excerpts": [
        {{
            "text": "<relevant excerpt from evidence>",
            "relevance": "<what this excerpt demonstrates>"
        }}
    ]
}}

IMPORTANT: 
1. Be extremely precise. Do NOT hallucinate control mappings. Only include controls where the evidence EXPLICITLY demonstrates compliance.
2. You MUST check EVERY framework listed above and return clause_mappings for ALL frameworks where the evidence is relevant - not just one framework.
3. If this evidence relates to security controls, it likely applies to multiple frameworks (e.g., endpoint protection may satisfy controls in ISO 27001, NIST, PCI-DSS, SBP frameworks, etc.)
4. Your response should contain clause_mappings from MULTIPLE frameworks when applicable."""


class BatchAssessRequest(BaseModel):
    evidence_ids: List[int]


class AssessmentMode(BaseModel):
    mode: str = "initial"  # initial, incremental, locked_audit


class ClauseMappingResponse(BaseModel):
    framework_name: str
    control_id: str
    clause_reference: str
    control_title: str
    matching_rationale: str
    confidence: float
    coverage_type: str
    matched_text_excerpt: Optional[str] = None


class AssessmentResponse(BaseModel):
    id: int
    evidence_id: int
    relevance_score: Optional[float]
    adequacy_score: Optional[float]
    confidence_score: Optional[float]
    audit_readiness: Optional[float]
    content_summary: Optional[str]
    detected_controls: List[str]
    compliance_frameworks: List[str]
    compliance_gaps: List[str]
    recommendations: List[str]
    assessed_at: str
    # New deterministic fields
    content_hash: Optional[str] = None
    model_version: Optional[str] = None
    prompt_version: Optional[str] = None
    assessment_mode: Optional[str] = None
    is_locked: bool = False
    clause_mappings: List[dict] = []
    matched_text_excerpts: List[dict] = []


class AssessmentResultResponse(BaseModel):
    assessment: AssessmentResponse
    quality_score_updated: bool
    from_cache: bool = False


class BatchAssessResponse(BaseModel):
    total: int
    processed: int
    failed: int
    results: List[dict]


class LowQualityEvidenceResponse(BaseModel):
    id: int
    name: str
    quality_score: Optional[float]
    status: str
    evidence_type: Optional[str]
    uploaded_at: str


class LockAssessmentRequest(BaseModel):
    lock_reason: Optional[str] = "User validated"


def validate_evidence_access(user: GRCUser, evidence: Evidence, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if evidence.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this evidence"
        )


def get_openai_client() -> OpenAI:
    if not AI_INTEGRATIONS_OPENAI_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OpenAI integration not configured"
        )
    return OpenAI(
        api_key=AI_INTEGRATIONS_OPENAI_API_KEY,
        base_url=AI_INTEGRATIONS_OPENAI_BASE_URL
    )


def compute_content_hash(content: str) -> str:
    """Compute SHA-256 hash of content for deterministic caching."""
    return hashlib.sha256(content.encode('utf-8')).hexdigest()


def parse_ai_response(response_text: str) -> dict:
    try:
        cleaned = response_text.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        return json.loads(cleaned.strip())
    except json.JSONDecodeError:
        return {
            "relevance_score": 50,
            "adequacy_score": 50,
            "audit_readiness": 50,
            "confidence_score": 30,
            "summary": "Unable to parse AI response",
            "detected_controls": [],
            "clause_mappings": [],
            "gaps": ["Assessment parsing failed"],
            "recommendations": ["Re-run assessment"]
        }


def format_assessment_response(assessment: EvidenceAIAssessment) -> AssessmentResponse:
    gap_analysis = assessment.gap_analysis or {}
    return AssessmentResponse(
        id=assessment.id,
        evidence_id=assessment.evidence_id,
        relevance_score=assessment.relevance_score,
        adequacy_score=assessment.adequacy_score,
        confidence_score=assessment.confidence_score,
        audit_readiness=assessment.audit_readiness,
        content_summary=assessment.content_summary,
        detected_controls=gap_analysis.get("detected_controls", []),
        compliance_frameworks=gap_analysis.get("compliance_frameworks", []),
        compliance_gaps=gap_analysis.get("gaps", []),
        recommendations=gap_analysis.get("recommendations", []),
        assessed_at=assessment.assessed_at.isoformat() if assessment.assessed_at else "",
        content_hash=assessment.content_hash,
        model_version=assessment.model_version,
        prompt_version=assessment.prompt_version,
        assessment_mode=assessment.assessment_mode,
        is_locked=assessment.is_locked or False,
        clause_mappings=assessment.clause_mappings or [],
        matched_text_excerpts=assessment.matched_text_excerpts or []
    )


def get_available_frameworks(db: Session, tenant_id: int = None) -> str:
    """Fetch available framework names AND their actual control IDs for AI context.
    
    IMPORTANT: This now queries UPLOADED frameworks (grc_uploaded_frameworks) 
    instead of pre-seeded frameworks (grc_frameworks) to ensure AI assessment 
    maps to user-uploaded framework versions.
    
    CRITICAL: We now include the actual control IDs from each framework so the
    AI can ONLY map to controls that actually exist. This prevents hallucination
    of generic ISO 27001 control IDs when assessing against custom frameworks.
    """
    framework_info = []
    
    # Query uploaded frameworks with status 'parsed', 'completed', or 'published'
    query = db.query(UploadedFramework).filter(
        UploadedFramework.upload_status.in_(['parsed', 'completed', 'published']),
        UploadedFramework.is_active == True
    )
    
    # Filter by tenant if provided (include shared frameworks too)
    if tenant_id:
        query = query.filter(
            (UploadedFramework.tenant_id == tenant_id) | 
            (UploadedFramework.is_shared == True) |
            (UploadedFramework.tenant_id == None)
        )
    
    uploaded_frameworks = query.all()
    
    for fw in uploaded_frameworks:
        # Fetch ALL actual control IDs from this framework
        controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == fw.id
        ).order_by(ParsedFrameworkControl.control_id).all()
        
        version_info = f" v{fw.version}" if fw.version else ""
        
        # Build control ID list with titles for context
        control_list = []
        for ctrl in controls:
            ctrl_id = ctrl.original_reference or ctrl.control_id
            ctrl_title = ctrl.title or ""
            if ctrl_title:
                control_list.append(f"    - {ctrl_id}: {ctrl_title[:80]}")
            else:
                control_list.append(f"    - {ctrl_id}")
        
        # Format framework with its controls
        fw_header = f"\nFRAMEWORK: {fw.name}{version_info} (ID: {fw.id})"
        fw_header += f"\nTotal Controls: {len(controls)}"
        fw_header += f"\nVALID CONTROL IDs (use ONLY these exact IDs in mappings):"
        
        if control_list:
            # Limit to first 150 controls to avoid token limits, but include all if fewer
            displayed_controls = control_list[:150]
            if len(control_list) > 150:
                displayed_controls.append(f"    ... and {len(control_list) - 150} more controls")
            fw_header += "\n" + "\n".join(displayed_controls)
        else:
            fw_header += "\n    (No controls parsed yet)"
        
        framework_info.append(fw_header)
    
    if not framework_info:
        return "No uploaded frameworks available. Please upload and parse frameworks first."
    
    return "\n".join(framework_info)


def normalize_control_code(code: str) -> str:
    """Normalize control code for matching."""
    import re
    normalized = code.lower().strip()
    normalized = re.sub(r'[\s\-_\.]+', '', normalized)
    normalized = re.sub(r'^(req|requirement|control|ctrl)[\s\-_\.]*', '', normalized)
    return normalized


def validate_and_filter_clause_mappings(
    clause_mappings: List[dict], 
    db: Session, 
    tenant_id: int
) -> List[dict]:
    """Validate AI-generated clause mappings against actual database controls.
    
    This is a CRITICAL security and accuracy layer that ensures:
    1. Only control IDs that exist in ParsedFrameworkControl are kept
    2. Hallucinated/invented control IDs are filtered out
    3. Mappings to non-existent frameworks are removed
    
    Returns only valid mappings that reference actual database records.
    """
    if not clause_mappings:
        return []
    
    # Get all uploaded frameworks for this tenant
    uploaded_frameworks = db.query(UploadedFramework).filter(
        UploadedFramework.upload_status.in_(['parsed', 'completed', 'published']),
        UploadedFramework.is_active == True,
        (UploadedFramework.tenant_id == tenant_id) | 
        (UploadedFramework.is_shared == True) |
        (UploadedFramework.tenant_id == None)
    ).all()
    
    if not uploaded_frameworks:
        logger.warning(f"No uploaded frameworks found for tenant {tenant_id} - rejecting all mappings")
        return []
    
    # Build lookup: framework name -> set of valid control IDs
    valid_controls_by_framework = {}
    framework_by_name = {}
    
    for fw in uploaded_frameworks:
        fw_name_lower = fw.name.lower()
        framework_by_name[fw_name_lower] = fw
        
        # Get all control IDs for this framework
        controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == fw.id
        ).all()
        
        valid_ids = set()
        for ctrl in controls:
            # Add both control_id and original_reference as valid
            if ctrl.control_id:
                valid_ids.add(normalize_control_code(ctrl.control_id))
            if ctrl.original_reference:
                valid_ids.add(normalize_control_code(ctrl.original_reference))
        
        valid_controls_by_framework[fw_name_lower] = valid_ids
    
    # Filter mappings
    validated_mappings = []
    rejected_count = 0
    
    for mapping in clause_mappings:
        framework_name = mapping.get("framework_name", "")
        control_id = mapping.get("control_id", "")
        
        if not framework_name or not control_id:
            rejected_count += 1
            continue
        
        # Find matching framework
        fw_name_lower = framework_name.lower()
        matched_fw_key = None
        
        # Exact match first
        if fw_name_lower in valid_controls_by_framework:
            matched_fw_key = fw_name_lower
        else:
            # Partial match
            for key in valid_controls_by_framework:
                if key in fw_name_lower or fw_name_lower in key:
                    matched_fw_key = key
                    break
        
        if not matched_fw_key:
            logger.warning(f"Rejected mapping: framework '{framework_name}' not found in uploaded frameworks")
            rejected_count += 1
            continue
        
        # Check if control ID exists in this framework
        normalized_ctrl = normalize_control_code(control_id)
        valid_ids = valid_controls_by_framework[matched_fw_key]
        
        if normalized_ctrl in valid_ids:
            validated_mappings.append(mapping)
        else:
            # STRICT: No partial matching - only exact normalized matches allowed
            # This prevents hallucinated control IDs like "A.12" from matching "A.12.4.1"
            logger.warning(f"Rejected mapping: control '{control_id}' (normalized: '{normalized_ctrl}') not found in framework '{framework_name}'")
            rejected_count += 1
    
    if rejected_count > 0:
        logger.info(f"Clause mapping validation: {len(validated_mappings)} valid, {rejected_count} rejected (invalid control IDs)")
    
    return validated_mappings


def get_cached_assessment(content_hash: str, tenant_id: int, db: Session) -> Optional[dict]:
    """Check if we have a cached assessment for this content hash."""
    cache_entry = db.query(EvidenceAssessmentCache).filter(
        EvidenceAssessmentCache.content_hash == content_hash,
        EvidenceAssessmentCache.tenant_id == tenant_id,
        EvidenceAssessmentCache.model_version == MODEL_VERSION,
        EvidenceAssessmentCache.prompt_version == PROMPT_VERSION
    ).first()
    
    if cache_entry:
        # Update usage tracking
        cache_entry.last_used_at = datetime.utcnow()
        cache_entry.use_count = (cache_entry.use_count or 0) + 1
        db.commit()
        return cache_entry.cached_response
    
    return None


def save_cached_assessment(content_hash: str, tenant_id: int, response: dict, db: Session) -> None:
    """Cache an assessment response for future deterministic retrieval."""
    cache_entry = EvidenceAssessmentCache(
        content_hash=content_hash,
        tenant_id=tenant_id,
        cached_response=response,
        model_version=MODEL_VERSION,
        prompt_version=PROMPT_VERSION,
        created_at=datetime.utcnow(),
        last_used_at=datetime.utcnow(),
        use_count=1
    )
    db.add(cache_entry)
    db.commit()


def auto_link_controls_with_clause_data(
    evidence: Evidence, 
    clause_mappings: List[dict], 
    db: Session,
    assessment_id: int
) -> int:
    """Auto-link detected controls with full clause-level data.
    
    IMPORTANT: This now links to UPLOADED frameworks (ParsedFrameworkControl)
    instead of pre-seeded frameworks (FrameworkControl) to ensure accurate
    mapping to user-uploaded framework versions.
    
    SECURITY: Tenant isolation is strictly enforced - only frameworks belonging 
    to the evidence's tenant (or shared frameworks) are considered for mapping.
    If evidence has no tenant_id, no linking is performed as a security safeguard.
    """
    linked_count = 0
    
    # SECURITY: Hard check - evidence MUST have a tenant_id for mapping
    if not evidence.tenant_id:
        logger.warning(f"Evidence {evidence.id} has no tenant_id - skipping control linking for security")
        return 0
    
    # Query uploaded frameworks with STRICT TENANT SCOPING for security
    # Only get frameworks belonging to this tenant or explicitly shared frameworks
    uploaded_frameworks = db.query(UploadedFramework).filter(
        UploadedFramework.upload_status.in_(['parsed', 'published']),
        UploadedFramework.is_active == True,
        (UploadedFramework.tenant_id == evidence.tenant_id) | 
        (UploadedFramework.is_shared == True)
    ).all()
    
    # Build lookup dictionaries for uploaded frameworks
    framework_by_name = {fw.name.lower(): fw for fw in uploaded_frameworks}
    framework_by_id = {fw.id: fw for fw in uploaded_frameworks}
    
    for mapping in clause_mappings:
        framework_name = mapping.get("framework_name", "")
        control_id = mapping.get("control_id", "")
        
        if not framework_name or not control_id:
            continue
        
        # Find the uploaded framework by name matching
        fw = None
        fw_name_lower = framework_name.lower()
        
        # Exact match first
        for key, f in framework_by_name.items():
            if key == fw_name_lower:
                fw = f
                break
        
        # Partial match
        if not fw:
            for key, f in framework_by_name.items():
                if key in fw_name_lower or fw_name_lower in key:
                    fw = f
                    break
        
        # Try common framework name variations
        if not fw:
            name_variations = {
                'iso 27001': ['iso_iec-270012022', 'iso-27001', 'iso27001'],
                'pci-dss': ['pci-dss', 'pcidss', 'pci_dss'],
                'nist': ['nist', 'nist-csf'],
                'sama': ['sama', 'sama-csf', 'sama - cyber'],
                'sbp': ['sbp', 'sbp-etgrmf', 'sbp etgrmf'],
                'soc 2': ['soc2', 'soc-2', 'soc 2'],
            }
            for base_name, variations in name_variations.items():
                if any(v in fw_name_lower for v in [base_name] + variations):
                    for key, f in framework_by_name.items():
                        if any(v in key for v in variations):
                            fw = f
                            break
                if fw:
                    break
        
        if not fw:
            logger.warning(f"Could not find uploaded framework for: {framework_name}")
            continue
        
        # Find the parsed control within this framework
        normalized_code = normalize_control_code(control_id)
        parsed_controls = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == fw.id
        ).all()
        
        matched_control = None
        
        # Try exact match on control_id or original_reference
        for ctrl in parsed_controls:
            ctrl_code_normalized = normalize_control_code(ctrl.control_id)
            ctrl_ref_normalized = normalize_control_code(ctrl.original_reference or "")
            
            if ctrl_code_normalized == normalized_code or ctrl_ref_normalized == normalized_code:
                matched_control = ctrl
                break
        
        # Try partial match
        if not matched_control:
            for ctrl in parsed_controls:
                ctrl_code = (ctrl.control_id or "").lower()
                ctrl_ref = (ctrl.original_reference or "").lower()
                control_lower = control_id.lower()
                
                if (control_lower in ctrl_code or ctrl_code in control_lower or
                    control_lower in ctrl_ref or ctrl_ref in control_lower):
                    matched_control = ctrl
                    break
        
        # Try matching by title similarity
        if not matched_control:
            control_title = mapping.get("control_title", "").lower()
            if control_title:
                for ctrl in parsed_controls:
                    if control_title in (ctrl.title or "").lower() or (ctrl.title or "").lower() in control_title:
                        matched_control = ctrl
                        break
        
        if matched_control:
            # Check if already exists (using parsed_control_id)
            existing = db.query(EvidenceControlMapping).filter(
                EvidenceControlMapping.evidence_id == evidence.id,
                EvidenceControlMapping.parsed_control_id == matched_control.id
            ).first()
            
            if not existing:
                control_mapping = EvidenceControlMapping(
                    evidence_id=evidence.id,
                    parsed_control_id=matched_control.id,
                    uploaded_framework_id=fw.id,
                    framework_name=fw.name,
                    control_code=matched_control.original_reference or matched_control.control_id,
                    clause_reference=mapping.get("clause_reference"),
                    control_title=matched_control.title,
                    matching_rationale=mapping.get("matching_rationale"),
                    confidence_score=mapping.get("confidence"),
                    coverage_type=mapping.get("coverage_type", "partial"),
                    matched_text_snippets=[mapping.get("matched_text_excerpt")] if mapping.get("matched_text_excerpt") else [],
                    matched_control_language=matched_control.description or matched_control.full_text or matched_control.title,
                    similarity_score=mapping.get("confidence"),
                    rule_based_validation=True,
                    is_locked=False,
                    created_at=datetime.utcnow(),
                    created_by_ai=True,
                    assessment_id=assessment_id
                )
                db.add(control_mapping)
                linked_count += 1
                logger.info(f"Linked evidence {evidence.id} to parsed control {matched_control.id} ({fw.name}: {matched_control.control_id})")
        else:
            logger.warning(f"Could not find control '{control_id}' in framework '{fw.name}'")
    
    return linked_count


def run_ai_assessment(
    evidence: Evidence, 
    db: Session, 
    mode: str = "initial",
    force_refresh: bool = False,
    user_id: Optional[int] = None
) -> EvidenceAIAssessment:
    """Run deterministic AI assessment with caching and clause-level mapping."""
    
    if not evidence.ocr_content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Evidence has no OCR content. Please run OCR first."
        )
    
    # Check for locked assessments
    if mode != "initial":
        existing_locked = db.query(EvidenceAIAssessment).filter(
            EvidenceAIAssessment.evidence_id == evidence.id,
            EvidenceAIAssessment.is_locked == True
        ).first()
        
        if existing_locked and mode == "locked_audit":
            # Return the locked assessment without re-running
            return existing_locked
    
    # Compute content hash for determinism
    content_hash = compute_content_hash(evidence.ocr_content)
    
    # Check cache for deterministic results (unless force refresh)
    if not force_refresh:
        cached_response = get_cached_assessment(content_hash, evidence.tenant_id, db)
        if cached_response:
            # CRITICAL: Re-validate cached clause mappings against current database
            # This ensures cached responses don't contain stale/invalid control IDs
            raw_cached_mappings = cached_response.get("clause_mappings", [])
            validated_cached_mappings = validate_and_filter_clause_mappings(
                raw_cached_mappings, db, evidence.tenant_id
            )
            
            # Create assessment from cache with validated mappings
            assessment = EvidenceAIAssessment(
                evidence_id=evidence.id,
                relevance_score=float(cached_response.get("relevance_score", 0)),
                adequacy_score=float(cached_response.get("adequacy_score", 0)),
                confidence_score=float(cached_response.get("confidence_score", 0)),
                audit_readiness=float(cached_response.get("audit_readiness", 0)),
                content_summary=cached_response.get("summary", ""),
                gap_analysis={
                    "detected_controls": cached_response.get("detected_controls", []),
                    "compliance_frameworks": cached_response.get("compliance_frameworks", []),
                    "gaps": cached_response.get("gaps", []),
                    "recommendations": cached_response.get("recommendations", [])
                },
                content_hash=content_hash,
                model_version=MODEL_VERSION,
                prompt_version=PROMPT_VERSION,
                assessment_mode=mode,
                clause_mappings=validated_cached_mappings,  # Use validated mappings only
                matched_text_excerpts=cached_response.get("evidence_text_excerpts", []),
                assessed_at=datetime.utcnow(),
                created_by=user_id
            )
            
            db.add(assessment)
            db.flush()
            
            # Link controls with validated clause data
            auto_link_controls_with_clause_data(evidence, validated_cached_mappings, db, assessment.id)
            
            quality_score = (
                cached_response.get("relevance_score", 0) * 0.3 +
                cached_response.get("adequacy_score", 0) * 0.4 +
                cached_response.get("audit_readiness", 0) * 0.3
            )
            evidence.quality_score = quality_score
            evidence.content_summary = cached_response.get("summary", "")
            
            db.commit()
            db.refresh(assessment)
            
            return assessment
    
    # Run fresh AI assessment
    try:
        start_time = time.time()
        client = get_openai_client()
        available_frameworks = get_available_frameworks(db, tenant_id=evidence.tenant_id)
        
        enhanced_prompt = DETERMINISTIC_ASSESSMENT_PROMPT.format(
            available_frameworks=available_frameworks,
            evidence_content=evidence.ocr_content[:12000]
        )
        
        # Use deterministic parameters: temperature=0 for consistent output
        # Note: seed parameter removed for compatibility with Replit AI integrations
        response = client.chat.completions.create(
            model=MODEL_VERSION,
            messages=[
                {
                    "role": "system",
                    "content": "You are a Senior GRC Compliance Expert. Provide precise, auditor-defensible assessments with exact clause-level control mappings. Never hallucinate control references - only include controls with explicit evidence support."
                },
                {
                    "role": "user",
                    "content": enhanced_prompt
                }
            ],
            temperature=0,  # CRITICAL: Deterministic output
            max_tokens=4000
        )
        
        assessment_duration = int((time.time() - start_time) * 1000)
        ai_result = parse_ai_response(response.choices[0].message.content or "")
        
        # CRITICAL: Validate and filter clause mappings against actual database controls
        # This prevents hallucinated control IDs (like generic ISO 27001 IDs) from being saved
        raw_clause_mappings = ai_result.get("clause_mappings", [])
        validated_clause_mappings = validate_and_filter_clause_mappings(
            raw_clause_mappings, db, evidence.tenant_id
        )
        
        # Update ai_result with validated mappings for caching
        ai_result["clause_mappings"] = validated_clause_mappings
        ai_result["_original_mappings_count"] = len(raw_clause_mappings)
        ai_result["_validated_mappings_count"] = len(validated_clause_mappings)
        
        # Cache the response for future deterministic retrieval
        save_cached_assessment(content_hash, evidence.tenant_id, ai_result, db)
        
        # Create assessment with full audit trail
        assessment = EvidenceAIAssessment(
            evidence_id=evidence.id,
            relevance_score=float(ai_result.get("relevance_score", 0)),
            adequacy_score=float(ai_result.get("adequacy_score", 0)),
            confidence_score=float(ai_result.get("confidence_score", 0)),
            audit_readiness=float(ai_result.get("audit_readiness", 0)),
            content_summary=ai_result.get("summary", ""),
            gap_analysis={
                "detected_controls": ai_result.get("detected_controls", []),
                "compliance_frameworks": ai_result.get("compliance_frameworks", []),
                "gaps": ai_result.get("gaps", []),
                "recommendations": ai_result.get("recommendations", [])
            },
            content_hash=content_hash,
            model_version=MODEL_VERSION,
            prompt_version=PROMPT_VERSION,
            assessment_mode=mode,
            clause_mappings=validated_clause_mappings,  # Use validated mappings only
            matched_text_excerpts=ai_result.get("evidence_text_excerpts", []),
            assessed_at=datetime.utcnow(),
            assessment_duration_ms=assessment_duration,
            created_by=user_id
        )
        
        db.add(assessment)
        db.flush()
        
        # Link controls with clause-level data (uses already validated mappings)
        auto_link_controls_with_clause_data(evidence, validated_clause_mappings, db, assessment.id)
        
        # Update evidence quality score
        quality_score = (
            ai_result.get("relevance_score", 0) * 0.3 +
            ai_result.get("adequacy_score", 0) * 0.4 +
            ai_result.get("audit_readiness", 0) * 0.3
        )
        evidence.quality_score = quality_score
        evidence.content_summary = ai_result.get("summary", "")
        
        db.commit()
        db.refresh(assessment)
        
        return assessment
        
    except HTTPException:
        raise
    except Exception as e:
        error_msg = str(e)
        logger.error(f"AI Assessment Error: {error_msg}", exc_info=True)
        if "FREE_CLOUD_BUDGET_EXCEEDED" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Cloud budget exceeded. Please upgrade your plan."
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI assessment failed: {error_msg}"
        )


@router.post("/{evidence_id}/assess", response_model=AssessmentResultResponse)
def assess_evidence(
    evidence_id: int,
    mode: str = Query(default="initial", description="Assessment mode: initial, incremental, locked_audit"),
    force_refresh: bool = Query(default=False, description="Force fresh AI assessment, bypassing cache"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """
    Run deterministic AI assessment on evidence.
    
    - **initial**: Full assessment (default)
    - **incremental**: Only assess changes/delta
    - **locked_audit**: Read-only mode, returns locked assessment if exists
    """
    evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
    
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    validate_evidence_access(current_user, evidence, db)
    
    # Check content hash to detect if this is the same content
    content_hash = compute_content_hash(evidence.ocr_content) if evidence.ocr_content else None
    from_cache = False
    
    if content_hash and not force_refresh:
        cached = get_cached_assessment(content_hash, evidence.tenant_id, db)
        from_cache = cached is not None
    
    assessment = run_ai_assessment(
        evidence, db, 
        mode=mode, 
        force_refresh=force_refresh,
        user_id=current_user.id
    )
    
    return AssessmentResultResponse(
        assessment=format_assessment_response(assessment),
        quality_score_updated=True,
        from_cache=from_cache
    )


@router.post("/{evidence_id}/lock")
def lock_assessment(
    evidence_id: int,
    request: LockAssessmentRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Lock an assessment to prevent re-assessment and ensure audit stability."""
    evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
    
    if not evidence:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence not found")
    
    validate_evidence_access(current_user, evidence, db)
    
    # Get latest assessment
    assessment = db.query(EvidenceAIAssessment).filter(
        EvidenceAIAssessment.evidence_id == evidence_id
    ).order_by(desc(EvidenceAIAssessment.assessed_at)).first()
    
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No assessment found to lock")
    
    assessment.is_locked = True
    assessment.locked_at = datetime.utcnow()
    assessment.locked_by = current_user.id
    assessment.lock_reason = request.lock_reason
    
    # Also lock the control mappings
    db.query(EvidenceControlMapping).filter(
        EvidenceControlMapping.assessment_id == assessment.id
    ).update({
        "is_locked": True,
        "locked_at": datetime.utcnow(),
        "locked_by": current_user.id
    })
    
    db.commit()
    
    return {"message": "Assessment locked successfully", "assessment_id": assessment.id}


@router.post("/{evidence_id}/unlock")
def unlock_assessment(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Unlock an assessment to allow re-assessment."""
    evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
    
    if not evidence:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence not found")
    
    validate_evidence_access(current_user, evidence, db)
    
    # Unlock all assessments for this evidence
    db.query(EvidenceAIAssessment).filter(
        EvidenceAIAssessment.evidence_id == evidence_id
    ).update({
        "is_locked": False,
        "locked_at": None,
        "locked_by": None,
        "lock_reason": None
    })
    
    # Unlock control mappings
    db.query(EvidenceControlMapping).filter(
        EvidenceControlMapping.evidence_id == evidence_id
    ).update({
        "is_locked": False,
        "locked_at": None,
        "locked_by": None
    })
    
    db.commit()
    
    return {"message": "Assessment unlocked successfully"}


@router.get("/{evidence_id}/assessments", response_model=List[AssessmentResponse])
def get_assessments(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
    
    if not evidence:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence not found")
    
    validate_evidence_access(current_user, evidence, db)
    
    assessments = db.query(EvidenceAIAssessment).filter(
        EvidenceAIAssessment.evidence_id == evidence_id
    ).order_by(desc(EvidenceAIAssessment.assessed_at)).all()
    
    return [format_assessment_response(a) for a in assessments]


@router.get("/{evidence_id}/latest-assessment", response_model=AssessmentResponse)
def get_latest_assessment(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
    
    if not evidence:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence not found")
    
    validate_evidence_access(current_user, evidence, db)
    
    assessment = db.query(EvidenceAIAssessment).filter(
        EvidenceAIAssessment.evidence_id == evidence_id
    ).order_by(desc(EvidenceAIAssessment.assessed_at)).first()
    
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No assessments found")
    
    return format_assessment_response(assessment)


@router.get("/{evidence_id}/clause-mappings")
def get_clause_mappings(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get detailed clause-level control mappings from the latest AI assessment."""
    evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
    
    if not evidence:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence not found")
    
    validate_evidence_access(current_user, evidence, db)
    
    # Get clause mappings from the latest AI assessment (primary source of truth)
    latest_assessment = db.query(EvidenceAIAssessment).filter(
        EvidenceAIAssessment.evidence_id == evidence_id
    ).order_by(EvidenceAIAssessment.assessed_at.desc()).first()
    
    if latest_assessment and latest_assessment.clause_mappings:
        # Build a cache of framework controls for verification
        user_tenants = get_user_tenants(current_user, db)
        frameworks = db.query(UploadedFramework).filter(
            UploadedFramework.tenant_id.in_(user_tenants)
        ).all()
        
        # Build control lookup: (framework_name_lower_part, control_id) -> (actual_title, actual_framework_name)
        control_lookup = {}
        for fw in frameworks:
            controls = db.query(ParsedFrameworkControl).filter(
                ParsedFrameworkControl.uploaded_framework_id == fw.id
            ).all()
            fw_name_lower = fw.name.lower()
            for ctrl in controls:
                # Use multiple keys for flexible matching
                key1 = (fw_name_lower, ctrl.control_id.lower() if ctrl.control_id else "")
                key2 = (fw_name_lower, ctrl.original_reference.lower() if ctrl.original_reference else "")
                control_lookup[key1] = (ctrl.title, fw.name, ctrl.control_id)
                if key2 != key1:
                    control_lookup[key2] = (ctrl.title, fw.name, ctrl.control_id)
        
        # Return clause mappings with verified control titles from database
        result = []
        for idx, mapping in enumerate(latest_assessment.clause_mappings):
            ai_framework = mapping.get("framework_name", "")
            ai_control_id = mapping.get("control_id", "")
            ai_title = mapping.get("control_title", "")
            
            # Try to find the actual control in our lookup
            verified_title = ai_title
            verified_framework = ai_framework
            verified_control_id = ai_control_id
            
            # Try matching with different framework name variations
            for fw in frameworks:
                fw_lower = fw.name.lower()
                # Check if AI framework name contains or is contained in actual framework name
                if fw_lower in ai_framework.lower() or ai_framework.lower() in fw_lower:
                    key = (fw_lower, ai_control_id.lower())
                    if key in control_lookup:
                        verified_title, verified_framework, verified_control_id = control_lookup[key]
                        break
            
            result.append({
                "id": idx,
                "framework_name": verified_framework,
                "control_id": verified_control_id,
                "clause_reference": mapping.get("clause_reference", ""),
                "control_title": verified_title,
                "matching_rationale": mapping.get("matching_rationale", ""),
                "confidence": mapping.get("confidence", 0),
                "coverage_type": mapping.get("coverage_type", "partial"),
                "matched_text_excerpt": mapping.get("matched_text_excerpt", ""),
            })
        
        return result
    
    # Fallback to EvidenceControlMapping table for backward compatibility
    mappings = db.query(EvidenceControlMapping).filter(
        EvidenceControlMapping.evidence_id == evidence_id
    ).all()
    
    return [
        {
            "id": m.id,
            "framework_name": m.framework_name or "",
            "control_id": m.control_code or "",
            "clause_reference": m.clause_reference or "",
            "control_title": m.control_title or "",
            "matching_rationale": m.matching_rationale or "",
            "confidence": m.confidence_score or 0,
            "coverage_type": m.coverage_type or "partial",
            "matched_text_excerpt": (m.matched_text_snippets[0] if m.matched_text_snippets else "") or "",
        }
        for m in mappings
    ]


@router.post("/batch-assess", response_model=BatchAssessResponse)
def batch_assess_evidence(
    request: BatchAssessRequest,
    mode: str = Query(default="initial"),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    results = []
    processed_count = 0
    failed_count = 0
    
    for evidence_id in request.evidence_ids:
        evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
        
        if not evidence:
            results.append({"evidence_id": evidence_id, "status": "failed", "message": "Not found"})
            failed_count += 1
            continue
        
        if evidence.tenant_id not in user_tenants:
            results.append({"evidence_id": evidence_id, "status": "failed", "message": "Access denied"})
            failed_count += 1
            continue
        
        if not evidence.ocr_content:
            results.append({"evidence_id": evidence_id, "status": "failed", "message": "No OCR content"})
            failed_count += 1
            continue
        
        try:
            assessment = run_ai_assessment(evidence, db, mode=mode, user_id=current_user.id)
            results.append({
                "evidence_id": evidence_id,
                "status": "completed",
                "assessment_id": assessment.id,
                "quality_score": evidence.quality_score,
                "content_hash": assessment.content_hash
            })
            processed_count += 1
        except HTTPException as e:
            results.append({"evidence_id": evidence_id, "status": "failed", "message": e.detail})
            failed_count += 1
        except Exception as e:
            results.append({"evidence_id": evidence_id, "status": "failed", "message": str(e)})
            failed_count += 1
    
    return BatchAssessResponse(
        total=len(request.evidence_ids),
        processed=processed_count,
        failed=failed_count,
        results=results
    )


@router.get("/low-quality", response_model=List[LowQualityEvidenceResponse])
def get_low_quality_evidence(
    threshold: float = Query(default=50, ge=0, le=100),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    evidence_items = db.query(Evidence).filter(
        Evidence.tenant_id.in_(user_tenants),
        Evidence.quality_score.isnot(None),
        Evidence.quality_score < threshold
    ).order_by(Evidence.quality_score.asc()).all()
    
    return [
        LowQualityEvidenceResponse(
            id=e.id,
            name=e.name,
            quality_score=e.quality_score,
            status=e.status or "draft",
            evidence_type=e.evidence_type,
            uploaded_at=e.uploaded_at.isoformat() if e.uploaded_at else ""
        )
        for e in evidence_items
    ]
