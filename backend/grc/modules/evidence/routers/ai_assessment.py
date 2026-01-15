import os
import json
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from pydantic import BaseModel
from openai import OpenAI

from ....models import Evidence, EvidenceAIAssessment, EvidenceControlMapping, GRCUser, get_db, Framework, FrameworkDomain, ControlObjective, FrameworkControl
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/ai", tags=["Evidence - AI Assessment"])

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")

ASSESSMENT_PROMPT = """Analyze this compliance evidence and provide a comprehensive assessment:

1. Relevance Score (0-100): How relevant is this for demonstrating compliance
2. Adequacy Score (0-100): How complete and sufficient is this evidence
3. Audit Readiness (0-100): How ready is this for an audit
4. Summary: Brief 2-3 sentence description of what this evidence shows and its purpose
5. Detected Controls: List specific controls from known frameworks (ISO 27001, PCI DSS, NIST CSF, SOC 2, etc.) this evidence can support
6. Compliance Frameworks: List regulatory frameworks or standards this evidence applies to (e.g., "PCI DSS 4.0 - Requirement 5.5.18", "ISO 27001:2022 - A.8.7", "NIST CSF - PR.DS-1")
7. Gaps: List any potential gaps or missing elements for full compliance
8. Recommendations: Suggestions for improvement

Evidence content:
{ocr_content}

Respond in JSON format with the following structure:
{{
    "relevance_score": <number 0-100>,
    "adequacy_score": <number 0-100>,
    "audit_readiness": <number 0-100>,
    "confidence_score": <number 0-100>,
    "summary": "<string describing what this evidence is and what it demonstrates>",
    "detected_controls": ["<specific control reference 1>", "<specific control reference 2>"],
    "compliance_frameworks": ["<framework: requirement>", "<framework: requirement>"],
    "gaps": ["<gap1>", "<gap2>"],
    "recommendations": ["<rec1>", "<rec2>"]
}}"""


class BatchAssessRequest(BaseModel):
    evidence_ids: List[int]


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


class AssessmentResultResponse(BaseModel):
    assessment: AssessmentResponse
    quality_score_updated: bool


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
        assessed_at=assessment.assessed_at.isoformat() if assessment.assessed_at else ""
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
    """Normalize control code for matching (remove spaces, lowercase, standardize separators)."""
    import re
    normalized = code.lower().strip()
    normalized = re.sub(r'[\s\-_\.]+', '', normalized)
    normalized = re.sub(r'^(req|requirement|control|ctrl)[\s\-_\.]*', '', normalized)
    return normalized


def auto_link_controls(evidence: Evidence, detected_controls: List[str], compliance_frameworks: List[str], db: Session) -> int:
    """Auto-link detected controls to actual database controls using smart matching."""
    linked_count = 0
    all_refs = detected_controls + compliance_frameworks
    
    frameworks = {fw.short_code.lower(): fw for fw in db.query(Framework).filter(Framework.is_active == True).all()}
    
    for control_ref in all_refs:
        control_ref = control_ref.strip()
        if not control_ref:
            continue
            
        framework_code = None
        control_code = control_ref
        
        if ':' in control_ref:
            parts = control_ref.split(':', 1)
            framework_code = parts[0].strip().lower()
            control_code = parts[1].strip()
        elif ' - ' in control_ref:
            parts = control_ref.split(' - ', 1)
            framework_code = parts[0].strip().lower()
            control_code = parts[1].strip()
        
        normalized_code = normalize_control_code(control_code)
        
        query = db.query(FrameworkControl)
        
        if framework_code:
            framework_short_codes = [k for k in frameworks.keys() if framework_code in k or k in framework_code]
            if framework_short_codes:
                fw = frameworks.get(framework_short_codes[0])
                if fw:
                    query = query.join(ControlObjective).join(FrameworkDomain).filter(
                        FrameworkDomain.framework_id == fw.id
                    )
        
        all_controls = query.all()
        matched_control = None
        
        for ctrl in all_controls:
            ctrl_normalized = normalize_control_code(ctrl.code)
            if ctrl_normalized == normalized_code or normalized_code in ctrl_normalized or ctrl_normalized in normalized_code:
                matched_control = ctrl
                break
        
        if not matched_control:
            for ctrl in all_controls:
                if control_code.lower() in ctrl.code.lower() or ctrl.code.lower() in control_code.lower():
                    matched_control = ctrl
                    break
        
        if matched_control:
            existing = db.query(EvidenceControlMapping).filter(
                EvidenceControlMapping.evidence_id == evidence.id,
                EvidenceControlMapping.framework_control_id == matched_control.id
            ).first()
            
            if not existing:
                mapping = EvidenceControlMapping(
                    evidence_id=evidence.id,
                    framework_control_id=matched_control.id
                )
                db.add(mapping)
                linked_count += 1
    
    return linked_count


def run_ai_assessment(evidence: Evidence, db: Session) -> EvidenceAIAssessment:
    if not evidence.ocr_content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Evidence has no OCR content. Please run OCR first using the /ocr/{evidence_id}/process-ocr endpoint."
        )
    
    client = get_openai_client()
    
    available_frameworks = get_available_frameworks(db)
    
    enhanced_prompt = f"""Analyze this compliance evidence and provide a comprehensive assessment.

Available Compliance Frameworks in our GRC system:
{available_frameworks}

Assessment Requirements:
1. Relevance Score (0-100): How relevant is this for demonstrating compliance
2. Adequacy Score (0-100): How complete and sufficient is this evidence
3. Audit Readiness (0-100): How ready is this for an audit
4. Summary: Brief 2-3 sentence description of what this evidence shows and its purpose
5. Detected Controls: List specific control codes from standard frameworks this evidence supports. Use format "FRAMEWORK_CODE: control_number" (e.g., "PCI-DSS: 1.1.1", "ISO27001: A.8.1", "NIST-CSF: PR.AC-1")
6. Compliance Frameworks: List framework requirements this evidence applies to using format: "FRAMEWORK_CODE: control_code" (e.g., "PCI-DSS: 5.2.1", "ISO27001: A.9.1.2", "SWIFT-CSP: 1.1")
7. Gaps: List any potential gaps or missing elements for full compliance
8. Recommendations: Suggestions for improvement

Evidence content:
{evidence.ocr_content[:12000]}

Respond in JSON format:
{{
    "relevance_score": <number 0-100>,
    "adequacy_score": <number 0-100>,
    "audit_readiness": <number 0-100>,
    "confidence_score": <number 0-100>,
    "summary": "<string>",
    "detected_controls": ["<FRAMEWORK_CODE: control_code>", ...],
    "compliance_frameworks": ["<FRAMEWORK_CODE: control_code>", ...],
    "gaps": ["<gap1>", ...],
    "recommendations": ["<rec1>", ...]
}}"""
    
    try:
        response = client.chat.completions.create(
            model="gpt-5.2",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert GRC compliance analyst. Analyze evidence documents and map them to EXACT control codes from the provided framework list. Be precise with control references - only use codes that exist in the available frameworks."
                },
                {
                    "role": "user",
                    "content": enhanced_prompt
                }
            ],
            max_tokens=4000,
            temperature=0.2
        )
        
        ai_result = parse_ai_response(response.choices[0].message.content or "")
        
        detected_controls = ai_result.get("detected_controls", [])
        compliance_frameworks = ai_result.get("compliance_frameworks", [])
        
        assessment = EvidenceAIAssessment(
            evidence_id=evidence.id,
            relevance_score=float(ai_result.get("relevance_score", 0)),
            adequacy_score=float(ai_result.get("adequacy_score", 0)),
            confidence_score=float(ai_result.get("confidence_score", 0)),
            audit_readiness=float(ai_result.get("audit_readiness", 0)),
            content_summary=ai_result.get("summary", ""),
            gap_analysis={
                "detected_controls": detected_controls,
                "compliance_frameworks": compliance_frameworks,
                "gaps": ai_result.get("gaps", []),
                "recommendations": ai_result.get("recommendations", [])
            },
            assessed_at=datetime.utcnow()
        )
        
        db.add(assessment)
        
        linked_count = auto_link_controls(evidence, detected_controls, compliance_frameworks, db)
        
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
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
    
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    validate_evidence_access(current_user, evidence, db)
    
    assessment = run_ai_assessment(evidence, db)
    
    return AssessmentResultResponse(
        assessment=format_assessment_response(assessment),
        quality_score_updated=True
    )


@router.get("/{evidence_id}/assessments", response_model=List[AssessmentResponse])
def get_assessments(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    evidence = db.query(Evidence).filter(Evidence.id == evidence_id).first()
    
    if not evidence:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Evidence not found"
        )
    
    validate_evidence_access(current_user, evidence, db)
    
    assessment = db.query(EvidenceAIAssessment).filter(
        EvidenceAIAssessment.evidence_id == evidence_id
    ).order_by(desc(EvidenceAIAssessment.assessed_at)).first()
    
    if not assessment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No assessments found for this evidence"
        )
    
    return format_assessment_response(assessment)


@router.post("/batch-assess", response_model=BatchAssessResponse)
def batch_assess_evidence(
    request: BatchAssessRequest,
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
            results.append({
                "evidence_id": evidence_id,
                "status": "failed",
                "message": "Evidence not found"
            })
            failed_count += 1
            continue
        
        if evidence.tenant_id not in user_tenants:
            results.append({
                "evidence_id": evidence_id,
                "status": "failed",
                "message": "Access denied"
            })
            failed_count += 1
            continue
        
        if not evidence.ocr_content:
            results.append({
                "evidence_id": evidence_id,
                "status": "failed",
                "message": "No OCR content available"
            })
            failed_count += 1
            continue
        
        try:
            assessment = run_ai_assessment(evidence, db)
            results.append({
                "evidence_id": evidence_id,
                "status": "completed",
                "assessment_id": assessment.id,
                "quality_score": evidence.quality_score
            })
            processed_count += 1
        except HTTPException as e:
            results.append({
                "evidence_id": evidence_id,
                "status": "failed",
                "message": e.detail
            })
            failed_count += 1
        except Exception as e:
            results.append({
                "evidence_id": evidence_id,
                "status": "failed",
                "message": str(e)
            })
            failed_count += 1
    
    return BatchAssessResponse(
        total=len(request.evidence_ids),
        processed=processed_count,
        failed=failed_count,
        results=results
    )


@router.get("/low-quality", response_model=List[LowQualityEvidenceResponse])
def get_low_quality_evidence(
    threshold: float = Query(default=50, ge=0, le=100, description="Quality score threshold"),
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
