from ....config import get_openai_api_key
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
# v2.3: Added mandatory multi-framework analysis requirement
# v3.0: Intent-based analysis with three-tier matching (explicit/implicit/inferred) and cross-framework equivalence
PROMPT_VERSION = "3.0"
# the newest OpenAI model is "gpt-5" which was released August 7, 2025.
# Using gpt-4o for compatibility with Replit AI integrations
MODEL_VERSION = "gpt-4o"

# Enhanced prompt for intent-based analysis with cross-framework mapping
# Version 3.0: Intent-based analysis with three-tier matching system
DETERMINISTIC_ASSESSMENT_PROMPT = """You are a Senior GRC Compliance Expert with 20+ years of experience, holding CISA, CISSP, CRISC, and ISO 27001 Lead Auditor certifications. Analyze this compliance evidence using INTENT-BASED ANALYSIS for regulatory audit purposes.

## CORE PRINCIPLE: INTENT-BASED ANALYSIS
Instead of requiring exact text matches, analyze what each control is trying to ACHIEVE and whether the evidence demonstrates that INTENT is being satisfied. This enables broader, more accurate compliance mapping.

## THREE-TIER MATCHING SYSTEM
Classify each control mapping using one of these match types:

1. **EXPLICIT** (Confidence: 90-100%): Direct text match
   - Evidence explicitly states or directly addresses the control requirement
   - Clear, unambiguous language that maps directly to the control
   - Example: Policy states "access reviews shall be conducted quarterly" → maps to access review control

2. **IMPLICIT** (Confidence: 70-89%): Indirect address through related mechanisms
   - Evidence addresses the control through related policies, procedures, or mechanisms
   - The intent of the control is satisfied even without exact terminology
   - Example: Policy describes "role-based permissions with manager approval" → satisfies access control intent

3. **INFERRED** (Confidence: 50-69%): Reasonably derived from policy scope and context
   - Control can be reasonably inferred from the overall policy scope, organizational context, or related statements
   - Based on logical implications from documented practices
   - Example: Information Security Policy implies security awareness exists → inferred security training control

## CROSS-FRAMEWORK EQUIVALENCE MAPPING
When a control is satisfied in ONE framework, you MUST identify equivalent controls across ALL other frameworks:
- If evidence satisfies "SAMA CSF 3.3.1 - Access Control", check for equivalent access control requirements in SBP, SABIC, ARAMCO, NIST, PCI-DSS, etc.
- Security policies typically satisfy controls across MULTIPLE frameworks simultaneously
- DO NOT stop after finding matches in one framework - analyze ALL frameworks for equivalent controls

## MANDATORY REQUIREMENTS
1. **ANALYZE EVERY FRAMEWORK**: Examine each framework in the list and identify ALL controls whose INTENT is addressed
2. **ONLY use control IDs from the VALID CONTROL IDs list** - DO NOT invent or hallucinate control IDs
3. Use the EXACT framework names and EXACT control IDs as provided
4. For each mapping, provide an intent_analysis explaining HOW the evidence satisfies the control's PURPOSE
5. Include specific text excerpts that support each mapping (even for implicit/inferred matches)
6. Return mappings from MULTIPLE frameworks - a security policy should map to 10-50+ controls across frameworks

## AVAILABLE FRAMEWORKS WITH THEIR VALID CONTROL IDs:
{available_frameworks}

## EVIDENCE CONTENT:
{evidence_content}

## ANALYSIS PROCESS:
1. First, extract ALL key policy statements, principles, and commitments from the evidence
2. For EACH framework listed above, identify controls whose INTENT is addressed by these statements
3. Classify each mapping as explicit, implicit, or inferred based on the matching criteria
4. Apply cross-framework equivalence: if a control is satisfied in one framework, find equivalent controls in ALL other frameworks
5. Provide intent analysis explaining the semantic connection between evidence and control

## REQUIRED JSON RESPONSE FORMAT:
{{
    "relevance_score": <0-100>,
    "adequacy_score": <0-100>,
    "audit_readiness": <0-100>,
    "confidence_score": <0-100>,
    "summary": "<2-3 sentence description of what this evidence covers>",
    
    "extracted_policy_statements": [
        "<key policy statement or principle from evidence>",
        "<another key statement>",
        "..."
    ],
    
    "clause_mappings": [
        {{
            "framework_name": "<USE EXACT framework name from the list above>",
            "control_id": "<exact control ID from framework>",
            "clause_reference": "<exact clause/sub-clause reference>",
            "control_title": "<control title text>",
            "match_type": "<explicit|implicit|inferred>",
            "confidence": <90-100 for explicit, 70-89 for implicit, 50-69 for inferred>,
            "intent_analysis": "<Explain HOW the evidence satisfies the control's intent/purpose. What is the control trying to achieve and how does the evidence demonstrate that?>",
            "matching_rationale": "<specific explanation of the match>",
            "coverage_type": "<full|partial|supporting>",
            "matched_text_excerpt": "<text from evidence that supports this mapping>",
            "cross_framework_equivalents": ["<FRAMEWORK: control_id>", "..."]
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
    ],
    
    "cross_framework_summary": {{
        "total_frameworks_analyzed": <number>,
        "frameworks_with_matches": ["<framework names with at least one match>"],
        "control_coverage_by_framework": {{
            "<framework_name>": <number of controls matched>
        }}
    }}
}}

## CRITICAL REMINDERS:
1. A typical Information Security Policy should map to 20-50+ controls across multiple frameworks
2. Use intent-based analysis - don't require exact text matches
3. For IMPLICIT and INFERRED matches, still provide matched_text_excerpt showing the supporting evidence
4. Every control in clause_mappings MUST have match_type and intent_analysis fields
5. cross_framework_equivalents should list related controls in OTHER frameworks that address the same security domain
6. Analyze ALL frameworks provided - do not skip any framework"""


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
    match_type: str = "explicit"  # explicit, implicit, or inferred
    intent_analysis: Optional[str] = None  # explains HOW the evidence satisfies the control intent
    cross_framework_equivalents: Optional[List[str]] = None  # equivalent controls in other frameworks


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


class QuickAssessRequest(BaseModel):
    evidence_name: str
    file_name: str
    file_type: str
    description: Optional[str] = None
    evidence_type: Optional[str] = None


class CompletenessCheck(BaseModel):
    has_date: bool = False
    has_version: bool = False
    has_approval: bool = False


class InitialAssessment(BaseModel):
    relevance_estimate: str
    suggested_type: str
    detected_frameworks: List[str]
    suggested_controls: List[str]
    quality_tips: List[str]
    completeness_check: CompletenessCheck


class QuickAssessResponse(BaseModel):
    initial_assessment: InitialAssessment


def validate_evidence_access(user: GRCUser, evidence: Evidence, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if evidence.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this evidence"
        )


def get_openai_client() -> OpenAI:
    api_key = get_openai_api_key()
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    is_modelfarm = base_url and "modelfarm" in base_url
    if not api_key and not is_modelfarm:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    if not is_modelfarm and (api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI features unavailable. OpenAI API key not configured."
        )
    return OpenAI(
        api_key=api_key,
        base_url=base_url
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
            # Partial match - try containment
            for key in valid_controls_by_framework:
                if key in fw_name_lower or fw_name_lower in key:
                    matched_fw_key = key
                    break
        
        # If still no match, try word-based matching (handles typos like "framrwork" vs "framework")
        if not matched_fw_key:
            ai_words = set(fw_name_lower.replace('-', ' ').split())
            for key in valid_controls_by_framework:
                db_words = set(key.replace('-', ' ').split())
                # If at least 2 significant words match, consider it a match
                common_words = ai_words & db_words
                significant_common = [w for w in common_words if len(w) >= 3]
                if len(significant_common) >= 2:
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
            # Try prefix matching: AI might return "3.3.3" when database has "3.3.3.a"
            # Find any control that starts with the normalized AI control
            matched_by_prefix = False
            for valid_id in valid_ids:
                if valid_id.startswith(normalized_ctrl) and len(normalized_ctrl) >= 2:
                    # Found a match - AI returned parent control, database has more specific
                    matched_by_prefix = True
                    validated_mappings.append(mapping)
                    break
            
            if not matched_by_prefix:
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
    # Check if cache entry already exists (handle race conditions)
    existing = db.query(EvidenceAssessmentCache).filter(
        EvidenceAssessmentCache.content_hash == content_hash
    ).first()
    
    if existing:
        # Update existing entry
        existing.cached_response = response
        existing.model_version = MODEL_VERSION
        existing.prompt_version = PROMPT_VERSION
        existing.last_used_at = datetime.utcnow()
        existing.use_count = (existing.use_count or 0) + 1
        db.commit()
    else:
        # Create new entry
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
            
            # AI clause mappings are stored as suggestions only
            # Users must manually click "Link to Requirement" to create actual links
            
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
        
        # AI clause mappings are stored as suggestions only
        # Users must manually click "Link to Requirement" to create actual links
        
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
        try:
            # Build a cache of framework controls for verification
            user_tenants = get_user_tenants(current_user, db)
            frameworks = db.query(UploadedFramework).filter(
                UploadedFramework.upload_status.in_(['parsed', 'completed', 'published']),
                UploadedFramework.is_active == True,
                (UploadedFramework.tenant_id.in_(user_tenants)) | 
                (UploadedFramework.is_shared == True) |
                (UploadedFramework.tenant_id == None)
            ).all()
            
            # Build control lookup with multiple key formats for flexible matching
            control_lookup = {}
            framework_name_map = {}  # AI name variations -> actual framework
            
            for fw in frameworks:
                fw_name_lower = fw.name.lower()
                framework_name_map[fw_name_lower] = fw.name
                
                controls = db.query(ParsedFrameworkControl).filter(
                    ParsedFrameworkControl.uploaded_framework_id == fw.id
                ).all()
                
                for ctrl in controls:
                    ctrl_id_lower = (ctrl.control_id or "").lower().strip()
                    orig_ref_lower = (ctrl.original_reference or "").lower().strip()
                    
                    # Store with multiple key variations
                    if ctrl_id_lower:
                        control_lookup[(fw_name_lower, ctrl_id_lower)] = (ctrl.title, fw.name, ctrl.control_id)
                    if orig_ref_lower and orig_ref_lower != ctrl_id_lower:
                        control_lookup[(fw_name_lower, orig_ref_lower)] = (ctrl.title, fw.name, ctrl.control_id)
            
            # Return clause mappings with verified control titles from database
            result = []
            for idx, mapping in enumerate(latest_assessment.clause_mappings):
                ai_framework = mapping.get("framework_name", "")
                ai_control_id = mapping.get("control_id", "")
                ai_title = mapping.get("control_title", "")
                
                # Default to AI-provided values
                verified_title = ai_title
                verified_framework = ai_framework
                verified_control_id = ai_control_id
                
                # Try to find matching framework and verify control
                ai_fw_lower = ai_framework.lower()
                matched_fw_name = None
                
                for fw in frameworks:
                    fw_lower = fw.name.lower()
                    # Flexible framework name matching
                    if (fw_lower in ai_fw_lower or ai_fw_lower in fw_lower or
                        any(word in ai_fw_lower for word in fw_lower.split() if len(word) >= 4)):
                        matched_fw_name = fw_lower
                        break
                
                if matched_fw_name:
                    # Try to find the control in this framework
                    ctrl_key = (matched_fw_name, ai_control_id.lower().strip())
                    if ctrl_key in control_lookup:
                        verified_title, verified_framework, verified_control_id = control_lookup[ctrl_key]
                
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
        except Exception as e:
            logger.error(f"Error verifying clause mappings: {e}")
            # Fallback: return raw mappings without verification
            return [
                {
                    "id": idx,
                    "framework_name": mapping.get("framework_name", ""),
                    "control_id": mapping.get("control_id", ""),
                    "clause_reference": mapping.get("clause_reference", ""),
                    "control_title": mapping.get("control_title", ""),
                    "matching_rationale": mapping.get("matching_rationale", ""),
                    "confidence": mapping.get("confidence", 0),
                    "coverage_type": mapping.get("coverage_type", "partial"),
                    "matched_text_excerpt": mapping.get("matched_text_excerpt", ""),
                }
                for idx, mapping in enumerate(latest_assessment.clause_mappings)
            ]
    
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


QUICK_ASSESS_PROMPT = """You are a GRC Compliance Expert. Analyze this evidence metadata and provide a quick initial assessment.

Evidence Name: {evidence_name}
File Name: {file_name}
File Type: {file_type}
Description: {description}
Evidence Type (if specified): {evidence_type}

Based on this metadata, provide an initial assessment in the following JSON format:
{{
    "relevance_estimate": "<high|medium|low>",
    "suggested_type": "<best matching evidence type: policy, procedure, certificate, audit_report, screenshot, log, configuration, attestation, training_record, access_review, vulnerability_scan, penetration_test, backup_log, change_record, incident_report, or other>",
    "detected_frameworks": ["<list of likely applicable frameworks like SAMA CSF, ISO 27001, PCI-DSS, NIST CSF, SOC 2, etc.>"],
    "suggested_controls": ["<list of likely control areas like Access Control, Encryption, Incident Management, etc.>"],
    "quality_tips": ["<list of 2-3 tips to improve evidence quality based on the evidence type>"],
    "completeness_check": {{
        "has_date": <true if filename or description suggests date inclusion, false otherwise>,
        "has_version": <true if filename or description suggests version info, false otherwise>,
        "has_approval": <true if filename or description suggests approval/signature, false otherwise>
    }}
}}

Be concise and practical. Focus on GRC compliance evidence best practices."""


@router.post("/quick-assess", response_model=QuickAssessResponse)
def quick_assess_evidence(
    request: QuickAssessRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Quick AI assessment based on evidence metadata before full OCR/content analysis.
    
    This is a lightweight endpoint that provides instant feedback to users during
    the evidence upload process, helping them understand relevance and quality
    before the full assessment runs.
    """
    try:
        client = get_openai_client()
        
        prompt = QUICK_ASSESS_PROMPT.format(
            evidence_name=request.evidence_name,
            file_name=request.file_name,
            file_type=request.file_type,
            description=request.description or "Not provided",
            evidence_type=request.evidence_type or "Not specified"
        )
        
        response = client.chat.completions.create(
            model=MODEL_VERSION,
            messages=[
                {"role": "system", "content": "You are a GRC compliance expert. Respond only with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=800
        )
        
        result = parse_ai_response(response.choices[0].message.content)
        
        completeness = result.get("completeness_check", {})
        
        return QuickAssessResponse(
            initial_assessment=InitialAssessment(
                relevance_estimate=result.get("relevance_estimate", "medium"),
                suggested_type=result.get("suggested_type", request.evidence_type or "document"),
                detected_frameworks=result.get("detected_frameworks", []),
                suggested_controls=result.get("suggested_controls", []),
                quality_tips=result.get("quality_tips", []),
                completeness_check=CompletenessCheck(
                    has_date=completeness.get("has_date", False),
                    has_version=completeness.get("has_version", False),
                    has_approval=completeness.get("has_approval", False)
                )
            )
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Quick assess error: {e}")
        return QuickAssessResponse(
            initial_assessment=InitialAssessment(
                relevance_estimate="medium",
                suggested_type=request.evidence_type or "document",
                detected_frameworks=[],
                suggested_controls=[],
                quality_tips=[
                    "Include effective dates for documents",
                    "Add version numbers for tracking",
                    "Include approval signatures where applicable"
                ],
                completeness_check=CompletenessCheck(
                    has_date=False,
                    has_version=False,
                    has_approval=False
                )
            )
        )


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
