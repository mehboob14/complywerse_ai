from ....config import get_openai_api_key
import os
import json
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, func, distinct
from pydantic import BaseModel
from openai import OpenAI

from ....models import (
    AIEvidenceRecommendation, CommonControlGroup, CommonControlGroupMapping,
    NormalizedControl, FrameworkControl, FrameworkDomain, ControlObjective,
    Framework, GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/evidence-recs", tags=["Control Library - Evidence Recommendations"])

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")

EVIDENCE_RECOMMENDATION_PROMPT = """Analyze this compliance control and recommend evidence types that would demonstrate compliance.

Control Information:
- Type: {control_type}
- Framework: {framework_name}
- Name: {control_name}
- Statement: {control_text}

Consider the control domain (security, privacy, operations, etc.) and provide specific evidence recommendations.

Return JSON with the following structure:
{{
    "recommendations": [
        {{
            "evidence_type": "<specific evidence type e.g., Policy Document, Access Log, Training Record>",
            "description": "<detailed description of what this evidence should contain>",
            "priority": "<critical|high|medium|low>",
            "confidence": <0.0-1.0>,
            "reasoning": "<why this evidence is appropriate for this control>",
            "sample_names": ["<example1.pdf>", "<example2.xlsx>"]
        }}
    ]
}}

Provide 3-7 relevant evidence types prioritized by importance for audit readiness."""


class EvidenceRecommendationCreate(BaseModel):
    group_id: Optional[int] = None
    normalized_control_id: Optional[int] = None
    framework_control_id: Optional[int] = None
    evidence_type: str
    evidence_description: Optional[str] = None
    priority: str = "medium"
    ai_confidence: Optional[float] = None
    ai_reasoning: Optional[str] = None
    sample_evidence_names: Optional[List[str]] = []


class EvidenceRecommendationUpdate(BaseModel):
    evidence_type: Optional[str] = None
    evidence_description: Optional[str] = None
    priority: Optional[str] = None
    sample_evidence_names: Optional[List[str]] = None


class BulkGenerateRequest(BaseModel):
    control_ids: List[dict]


class RecommendationResponse(BaseModel):
    id: int
    tenant_id: int
    group_id: Optional[int]
    normalized_control_id: Optional[int]
    framework_control_id: Optional[int]
    evidence_type: str
    evidence_description: Optional[str]
    priority: str
    ai_confidence: Optional[float]
    ai_reasoning: Optional[str]
    sample_evidence_names: List[str]
    created_at: str
    control_name: Optional[str] = None
    control_code: Optional[str] = None
    framework_name: Optional[str] = None
    group_name: Optional[str] = None


def check_ai_available() -> bool:
    """Check if OpenAI API key is configured (Replit AI Integrations or direct API key)."""
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL", "")
    is_modelfarm = "modelfarm" in base_url
    if is_modelfarm:
        return True
    api_key = get_openai_api_key()
    if not api_key:
        return False
    if not is_modelfarm and (api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20):
        return False
    return True


def raise_ai_unavailable(fallback_available: bool = False):
    """Raise HTTP 503 error when AI features are unavailable."""
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "error": "AI features unavailable",
            "message": "OpenAI API key is not configured. Please add OPENAI_API_KEY to enable AI features.",
            "fallback_available": fallback_available
        }
    )


def get_openai_client() -> OpenAI:
    if not check_ai_available():
        raise_ai_unavailable(fallback_available=False)
    api_key = get_openai_api_key()
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    return OpenAI(
        api_key=api_key,
        base_url=base_url
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
        return {"recommendations": []}


def generate_evidence_recommendations(
    control_text: str,
    control_type: str,
    control_name: str,
    framework_name: str = "Unknown"
) -> List[dict]:
    try:
        client = get_openai_client()
        prompt = EVIDENCE_RECOMMENDATION_PROMPT.format(
            control_type=control_type,
            framework_name=framework_name,
            control_name=control_name,
            control_text=control_text[:4000]
        )
        
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "You are a compliance expert recommending evidence types for audit readiness. Respond only with valid JSON."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            response_format={"type": "json_object"},
            max_tokens=2000,
            temperature=0.3
        )
        
        result = parse_ai_response(response.choices[0].message.content or '{"recommendations": []}')
        return result.get("recommendations", [])
        
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
            detail=f"AI recommendation generation failed: {error_msg}"
        )


def serialize_recommendation(rec: AIEvidenceRecommendation, db: Session) -> dict:
    control_name = None
    control_code = None
    framework_name = None
    group_name = None
    
    if rec.group_id:
        group = db.query(CommonControlGroup).filter(CommonControlGroup.id == rec.group_id).first()
        if group:
            group_name = group.name
    
    if rec.normalized_control_id:
        nc = db.query(NormalizedControl).filter(NormalizedControl.id == rec.normalized_control_id).first()
        if nc:
            control_name = nc.name
            control_code = nc.code
    
    if rec.framework_control_id:
        fc = db.query(FrameworkControl).options(
            joinedload(FrameworkControl.objective).joinedload(ControlObjective.domain).joinedload(FrameworkDomain.framework)
        ).filter(FrameworkControl.id == rec.framework_control_id).first()
        if fc:
            control_name = fc.name
            control_code = fc.code
            if fc.objective and fc.objective.domain and fc.objective.domain.framework:
                framework_name = fc.objective.domain.framework.name
    
    return {
        "id": rec.id,
        "tenant_id": rec.tenant_id,
        "group_id": rec.group_id,
        "normalized_control_id": rec.normalized_control_id,
        "framework_control_id": rec.framework_control_id,
        "evidence_type": rec.evidence_type,
        "evidence_description": rec.evidence_description,
        "priority": rec.priority,
        "ai_confidence": rec.ai_confidence,
        "ai_reasoning": rec.ai_reasoning,
        "sample_evidence_names": rec.sample_evidence_names or [],
        "created_at": rec.created_at.isoformat() if rec.created_at else "",
        "control_name": control_name,
        "control_code": control_code,
        "framework_name": framework_name,
        "group_name": group_name
    }


@router.get("")
def list_recommendations(
    group_id: Optional[int] = None,
    control_type: Optional[str] = None,
    control_id: Optional[int] = None,
    priority: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    query = db.query(AIEvidenceRecommendation).filter(
        AIEvidenceRecommendation.tenant_id.in_(user_tenants)
    )
    
    if group_id:
        query = query.filter(AIEvidenceRecommendation.group_id == group_id)
    
    if control_type and control_id:
        if control_type == "normalized":
            query = query.filter(AIEvidenceRecommendation.normalized_control_id == control_id)
        elif control_type == "framework":
            query = query.filter(AIEvidenceRecommendation.framework_control_id == control_id)
    
    if priority:
        query = query.filter(AIEvidenceRecommendation.priority == priority)
    
    total = query.count()
    recommendations = query.order_by(AIEvidenceRecommendation.created_at.desc()).offset(skip).limit(limit).all()
    
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "recommendations": [serialize_recommendation(r, db) for r in recommendations]
    }


@router.get("/evidence-types")
def get_evidence_types(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    results = db.query(
        AIEvidenceRecommendation.evidence_type,
        func.count(AIEvidenceRecommendation.id).label("count")
    ).filter(
        AIEvidenceRecommendation.tenant_id.in_(user_tenants)
    ).group_by(
        AIEvidenceRecommendation.evidence_type
    ).order_by(
        func.count(AIEvidenceRecommendation.id).desc()
    ).all()
    
    return {
        "evidence_types": [
            {"evidence_type": r[0], "count": r[1]}
            for r in results
        ]
    }


@router.get("/priority-summary")
def get_priority_summary(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    results = db.query(
        AIEvidenceRecommendation.priority,
        func.count(AIEvidenceRecommendation.id).label("count")
    ).filter(
        AIEvidenceRecommendation.tenant_id.in_(user_tenants)
    ).group_by(
        AIEvidenceRecommendation.priority
    ).all()
    
    summary = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    for r in results:
        if r[0] in summary:
            summary[r[0]] = r[1]
    
    return {
        "priority_summary": summary,
        "total": sum(summary.values())
    }


@router.get("/for-control/{control_type}/{control_id}")
def get_recommendations_for_control(
    control_type: str,
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    if control_type not in ["normalized", "framework"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="control_type must be 'normalized' or 'framework'"
        )
    
    if control_type == "normalized":
        control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
        if not control:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Normalized control not found")
        
        recommendations = db.query(AIEvidenceRecommendation).filter(
            AIEvidenceRecommendation.tenant_id.in_(user_tenants),
            AIEvidenceRecommendation.normalized_control_id == control_id
        ).order_by(AIEvidenceRecommendation.priority).all()
    else:
        control = db.query(FrameworkControl).filter(FrameworkControl.id == control_id).first()
        if not control:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Framework control not found")
        
        recommendations = db.query(AIEvidenceRecommendation).filter(
            AIEvidenceRecommendation.tenant_id.in_(user_tenants),
            AIEvidenceRecommendation.framework_control_id == control_id
        ).order_by(AIEvidenceRecommendation.priority).all()
    
    return {
        "control_type": control_type,
        "control_id": control_id,
        "control_name": control.name,
        "control_code": control.code,
        "recommendations": [serialize_recommendation(r, db) for r in recommendations]
    }


@router.get("/for-group/{group_id}")
def get_recommendations_for_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id,
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        )
    ).first()
    
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Control group not found")
    
    recommendations = db.query(AIEvidenceRecommendation).filter(
        AIEvidenceRecommendation.tenant_id.in_(user_tenants),
        AIEvidenceRecommendation.group_id == group_id
    ).order_by(AIEvidenceRecommendation.priority).all()
    
    seen_types = set()
    deduplicated = []
    for rec in recommendations:
        if rec.evidence_type not in seen_types:
            seen_types.add(rec.evidence_type)
            deduplicated.append(rec)
    
    return {
        "group_id": group_id,
        "group_name": group.name,
        "group_code": group.code,
        "recommendations": [serialize_recommendation(r, db) for r in deduplicated]
    }


@router.post("/generate/{control_type}/{control_id}")
def generate_for_control(
    control_type: str,
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if not check_ai_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "AI features unavailable",
                "message": "OpenAI API key is not configured. Please add OPENAI_API_KEY to enable AI-generated evidence recommendations.",
                "fallback_available": True,
                "fallback_suggestion": "Create evidence recommendations manually using the 'Add Recommendation' feature"
            }
        )
    
    tenant_id = get_user_primary_tenant(current_user, db)
    
    if control_type not in ["normalized", "framework"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="control_type must be 'normalized' or 'framework'"
        )
    
    framework_name = "Unknown"
    
    if control_type == "normalized":
        control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
        if not control:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Normalized control not found")
        control_text = control.statement or control.name
        control_name = control.name
    else:
        control = db.query(FrameworkControl).options(
            joinedload(FrameworkControl.objective).joinedload(ControlObjective.domain).joinedload(FrameworkDomain.framework)
        ).filter(FrameworkControl.id == control_id).first()
        if not control:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Framework control not found")
        control_text = control.statement or control.name
        control_name = control.name
        if control.objective and control.objective.domain and control.objective.domain.framework:
            framework_name = control.objective.domain.framework.name
    
    ai_recommendations = generate_evidence_recommendations(
        control_text=control_text,
        control_type=control_type,
        control_name=control_name,
        framework_name=framework_name
    )
    
    created_recommendations = []
    for rec_data in ai_recommendations:
        rec = AIEvidenceRecommendation(
            tenant_id=tenant_id,
            normalized_control_id=control_id if control_type == "normalized" else None,
            framework_control_id=control_id if control_type == "framework" else None,
            evidence_type=rec_data.get("evidence_type", "Unknown"),
            evidence_description=rec_data.get("description"),
            priority=rec_data.get("priority", "medium"),
            ai_confidence=rec_data.get("confidence"),
            ai_reasoning=rec_data.get("reasoning"),
            sample_evidence_names=rec_data.get("sample_names", []),
            created_at=datetime.utcnow()
        )
        db.add(rec)
        created_recommendations.append(rec)
    
    db.commit()
    
    for rec in created_recommendations:
        db.refresh(rec)
    
    return {
        "control_type": control_type,
        "control_id": control_id,
        "control_name": control_name,
        "generated_count": len(created_recommendations),
        "recommendations": [serialize_recommendation(r, db) for r in created_recommendations]
    }


@router.post("/generate-for-group/{group_id}")
def generate_for_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if not check_ai_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "AI features unavailable",
                "message": "OpenAI API key is not configured. Please add OPENAI_API_KEY to enable AI-generated evidence recommendations.",
                "fallback_available": True,
                "fallback_suggestion": "Create evidence recommendations manually using the 'Add Recommendation' feature"
            }
        )
    
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id,
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        )
    ).first()
    
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Control group not found")
    
    mappings = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group_id
    ).all()
    
    if not mappings:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Control group has no mapped controls"
        )
    
    all_recommendations = []
    
    for mapping in mappings:
        if mapping.normalized_control_id:
            control = db.query(NormalizedControl).filter(
                NormalizedControl.id == mapping.normalized_control_id
            ).first()
            if control:
                control_text = control.statement or control.name
                ai_recs = generate_evidence_recommendations(
                    control_text=control_text,
                    control_type="normalized",
                    control_name=control.name,
                    framework_name="Normalized"
                )
                for rec_data in ai_recs:
                    rec = AIEvidenceRecommendation(
                        tenant_id=tenant_id,
                        group_id=group_id,
                        normalized_control_id=control.id,
                        evidence_type=rec_data.get("evidence_type", "Unknown"),
                        evidence_description=rec_data.get("description"),
                        priority=rec_data.get("priority", "medium"),
                        ai_confidence=rec_data.get("confidence"),
                        ai_reasoning=rec_data.get("reasoning"),
                        sample_evidence_names=rec_data.get("sample_names", []),
                        created_at=datetime.utcnow()
                    )
                    db.add(rec)
                    all_recommendations.append(rec)
        
        if mapping.framework_control_id:
            control = db.query(FrameworkControl).options(
                joinedload(FrameworkControl.objective).joinedload(ControlObjective.domain).joinedload(FrameworkDomain.framework)
            ).filter(
                FrameworkControl.id == mapping.framework_control_id
            ).first()
            if control:
                control_text = control.statement or control.name
                framework_name = "Unknown"
                if control.objective and control.objective.domain and control.objective.domain.framework:
                    framework_name = control.objective.domain.framework.name
                
                ai_recs = generate_evidence_recommendations(
                    control_text=control_text,
                    control_type="framework",
                    control_name=control.name,
                    framework_name=framework_name
                )
                for rec_data in ai_recs:
                    rec = AIEvidenceRecommendation(
                        tenant_id=tenant_id,
                        group_id=group_id,
                        framework_control_id=control.id,
                        evidence_type=rec_data.get("evidence_type", "Unknown"),
                        evidence_description=rec_data.get("description"),
                        priority=rec_data.get("priority", "medium"),
                        ai_confidence=rec_data.get("confidence"),
                        ai_reasoning=rec_data.get("reasoning"),
                        sample_evidence_names=rec_data.get("sample_names", []),
                        created_at=datetime.utcnow()
                    )
                    db.add(rec)
                    all_recommendations.append(rec)
    
    db.commit()
    
    for rec in all_recommendations:
        db.refresh(rec)
    
    return {
        "group_id": group_id,
        "group_name": group.name,
        "controls_processed": len(mappings),
        "generated_count": len(all_recommendations),
        "recommendations": [serialize_recommendation(r, db) for r in all_recommendations]
    }


@router.post("/bulk-generate")
def bulk_generate_recommendations(
    request: BulkGenerateRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if not check_ai_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "AI features unavailable",
                "message": "OpenAI API key is not configured. Please add OPENAI_API_KEY to enable AI-generated evidence recommendations.",
                "fallback_available": True,
                "fallback_suggestion": "Create evidence recommendations manually using the 'Add Recommendation' feature"
            }
        )
    
    tenant_id = get_user_primary_tenant(current_user, db)
    
    results = []
    total_generated = 0
    failed_count = 0
    
    for control_info in request.control_ids:
        control_type = control_info.get("type", "framework")
        control_id = control_info.get("id")
        
        if not control_id:
            results.append({
                "control_id": control_id,
                "control_type": control_type,
                "status": "failed",
                "message": "Missing control ID"
            })
            failed_count += 1
            continue
        
        try:
            if control_type == "normalized":
                control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
                if not control:
                    results.append({
                        "control_id": control_id,
                        "control_type": control_type,
                        "status": "failed",
                        "message": "Control not found"
                    })
                    failed_count += 1
                    continue
                control_text = control.statement or control.name
                control_name = control.name
                framework_name = "Normalized"
            else:
                control = db.query(FrameworkControl).options(
                    joinedload(FrameworkControl.objective).joinedload(ControlObjective.domain).joinedload(FrameworkDomain.framework)
                ).filter(FrameworkControl.id == control_id).first()
                if not control:
                    results.append({
                        "control_id": control_id,
                        "control_type": control_type,
                        "status": "failed",
                        "message": "Control not found"
                    })
                    failed_count += 1
                    continue
                control_text = control.statement or control.name
                control_name = control.name
                framework_name = "Unknown"
                if control.objective and control.objective.domain and control.objective.domain.framework:
                    framework_name = control.objective.domain.framework.name
            
            ai_recs = generate_evidence_recommendations(
                control_text=control_text,
                control_type=control_type,
                control_name=control_name,
                framework_name=framework_name
            )
            
            for rec_data in ai_recs:
                rec = AIEvidenceRecommendation(
                    tenant_id=tenant_id,
                    normalized_control_id=control_id if control_type == "normalized" else None,
                    framework_control_id=control_id if control_type == "framework" else None,
                    evidence_type=rec_data.get("evidence_type", "Unknown"),
                    evidence_description=rec_data.get("description"),
                    priority=rec_data.get("priority", "medium"),
                    ai_confidence=rec_data.get("confidence"),
                    ai_reasoning=rec_data.get("reasoning"),
                    sample_evidence_names=rec_data.get("sample_names", []),
                    created_at=datetime.utcnow()
                )
                db.add(rec)
            
            results.append({
                "control_id": control_id,
                "control_type": control_type,
                "status": "completed",
                "generated_count": len(ai_recs)
            })
            total_generated += len(ai_recs)
            
        except HTTPException as e:
            results.append({
                "control_id": control_id,
                "control_type": control_type,
                "status": "failed",
                "message": e.detail
            })
            failed_count += 1
        except Exception as e:
            results.append({
                "control_id": control_id,
                "control_type": control_type,
                "status": "failed",
                "message": str(e)
            })
            failed_count += 1
    
    db.commit()
    
    return {
        "total_requested": len(request.control_ids),
        "total_generated": total_generated,
        "failed_count": failed_count,
        "results": results
    }


@router.put("/{recommendation_id}")
def update_recommendation(
    recommendation_id: int,
    update_data: EvidenceRecommendationUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    rec = db.query(AIEvidenceRecommendation).filter(
        AIEvidenceRecommendation.id == recommendation_id,
        AIEvidenceRecommendation.tenant_id.in_(user_tenants)
    ).first()
    
    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recommendation not found")
    
    if update_data.evidence_type is not None:
        rec.evidence_type = update_data.evidence_type
    if update_data.evidence_description is not None:
        rec.evidence_description = update_data.evidence_description
    if update_data.priority is not None:
        if update_data.priority not in ["critical", "high", "medium", "low"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Priority must be critical, high, medium, or low"
            )
        rec.priority = update_data.priority
    if update_data.sample_evidence_names is not None:
        rec.sample_evidence_names = update_data.sample_evidence_names
    
    db.commit()
    db.refresh(rec)
    
    return serialize_recommendation(rec, db)


@router.delete("/{recommendation_id}")
def delete_recommendation(
    recommendation_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    rec = db.query(AIEvidenceRecommendation).filter(
        AIEvidenceRecommendation.id == recommendation_id,
        AIEvidenceRecommendation.tenant_id.in_(user_tenants)
    ).first()
    
    if not rec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recommendation not found")
    
    db.delete(rec)
    db.commit()
    
    return {"message": "Recommendation deleted successfully", "id": recommendation_id}
