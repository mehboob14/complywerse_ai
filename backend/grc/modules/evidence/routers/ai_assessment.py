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
    GRCUser, get_db, Framework, FrameworkDomain, ControlObjective, FrameworkControl
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/ai", tags=["Evidence - AI Assessment"])

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")

# Version tracking for deterministic assessments
PROMPT_VERSION = "2.0"
# the newest OpenAI model is "gpt-5" which was released August 7, 2025.
# Using gpt-4o for compatibility with Replit AI integrations
MODEL_VERSION = "gpt-4o"

# Enhanced prompt for clause-level mapping with auditor-defensible output
DETERMINISTIC_ASSESSMENT_PROMPT = """You are a Senior GRC Compliance Expert with 20+ years of experience, holding CISA, CISSP, CRISC, and ISO 27001 Lead Auditor certifications. Analyze this compliance evidence with extreme precision for regulatory audit purposes.

CRITICAL REQUIREMENTS:
- ONLY map to controls that have EXPLICIT evidence in the document
- Provide EXACT clause references (not just control numbers)
- Include specific text excerpts from the evidence that support each mapping
- No control should be marked applicable without explicit clause-level evidence match

Available Compliance Frameworks:
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
            "framework_name": "<exact framework name with version, e.g., ISO 27001:2022>",
            "control_id": "<exact control ID, e.g., A.5.1>",
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

IMPORTANT: Be extremely precise. Do NOT hallucinate control mappings. Only include controls where the evidence EXPLICITLY demonstrates compliance."""


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


def get_available_frameworks(db: Session) -> str:
    """Fetch available framework names and short codes for AI context."""
    frameworks = db.query(Framework).filter(Framework.is_active == True).all()
    
    framework_info = []
    for fw in frameworks:
        control_count = db.query(FrameworkControl).join(ControlObjective).join(FrameworkDomain).filter(
            FrameworkDomain.framework_id == fw.id
        ).count()
        framework_info.append(f"- {fw.name} (code: {fw.short_code}) - {control_count} controls")
    
    return "\n".join(framework_info)


def normalize_control_code(code: str) -> str:
    """Normalize control code for matching."""
    import re
    normalized = code.lower().strip()
    normalized = re.sub(r'[\s\-_\.]+', '', normalized)
    normalized = re.sub(r'^(req|requirement|control|ctrl)[\s\-_\.]*', '', normalized)
    return normalized


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
    """Auto-link detected controls with full clause-level data."""
    linked_count = 0
    
    frameworks = {fw.short_code.lower(): fw for fw in db.query(Framework).filter(Framework.is_active == True).all()}
    framework_by_name = {fw.name.lower(): fw for fw in frameworks.values()}
    
    for mapping in clause_mappings:
        framework_name = mapping.get("framework_name", "")
        control_id = mapping.get("control_id", "")
        
        if not framework_name or not control_id:
            continue
        
        # Find the framework
        fw = None
        fw_name_lower = framework_name.lower()
        for key, f in framework_by_name.items():
            if key in fw_name_lower or fw_name_lower in key:
                fw = f
                break
        
        if not fw:
            for code, f in frameworks.items():
                if code in fw_name_lower:
                    fw = f
                    break
        
        if not fw:
            continue
        
        # Find the control
        normalized_code = normalize_control_code(control_id)
        controls = db.query(FrameworkControl).join(ControlObjective).join(FrameworkDomain).filter(
            FrameworkDomain.framework_id == fw.id
        ).all()
        
        matched_control = None
        for ctrl in controls:
            ctrl_normalized = normalize_control_code(ctrl.code)
            if ctrl_normalized == normalized_code or normalized_code in ctrl_normalized or ctrl_normalized in normalized_code:
                matched_control = ctrl
                break
        
        if not matched_control:
            for ctrl in controls:
                if control_id.lower() in ctrl.code.lower() or ctrl.code.lower() in control_id.lower():
                    matched_control = ctrl
                    break
        
        if matched_control:
            # Check if already exists
            existing = db.query(EvidenceControlMapping).filter(
                EvidenceControlMapping.evidence_id == evidence.id,
                EvidenceControlMapping.framework_control_id == matched_control.id
            ).first()
            
            if not existing:
                control_mapping = EvidenceControlMapping(
                    evidence_id=evidence.id,
                    framework_control_id=matched_control.id,
                    framework_name=framework_name,
                    control_code=control_id,
                    clause_reference=mapping.get("clause_reference"),
                    control_title=mapping.get("control_title"),
                    matching_rationale=mapping.get("matching_rationale"),
                    confidence_score=mapping.get("confidence"),
                    coverage_type=mapping.get("coverage_type", "partial"),
                    matched_text_snippets=[mapping.get("matched_text_excerpt")] if mapping.get("matched_text_excerpt") else [],
                    matched_control_language=matched_control.statement or matched_control.name,
                    similarity_score=mapping.get("confidence"),
                    rule_based_validation=True,
                    is_locked=False,
                    created_at=datetime.utcnow(),
                    created_by_ai=True,
                    assessment_id=assessment_id
                )
                db.add(control_mapping)
                linked_count += 1
    
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
            # Create assessment from cache
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
                clause_mappings=cached_response.get("clause_mappings", []),
                matched_text_excerpts=cached_response.get("evidence_text_excerpts", []),
                assessed_at=datetime.utcnow(),
                created_by=user_id
            )
            
            db.add(assessment)
            db.flush()
            
            # Link controls with clause data
            clause_mappings = cached_response.get("clause_mappings", [])
            auto_link_controls_with_clause_data(evidence, clause_mappings, db, assessment.id)
            
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
        available_frameworks = get_available_frameworks(db)
        
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
            clause_mappings=ai_result.get("clause_mappings", []),
            matched_text_excerpts=ai_result.get("evidence_text_excerpts", []),
            assessed_at=datetime.utcnow(),
            assessment_duration_ms=assessment_duration,
            created_by=user_id
        )
        
        db.add(assessment)
        db.flush()
        
        # Link controls with clause-level data
        clause_mappings = ai_result.get("clause_mappings", [])
        auto_link_controls_with_clause_data(evidence, clause_mappings, db, assessment.id)
        
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
        # Return clause mappings from the AI assessment directly
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
