import os
import json
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc, or_
from pydantic import BaseModel
from openai import OpenAI

from ....models import (
    ControlSimilarityMapping, ControlMappingAnalysis, NormalizedControl,
    FrameworkControl, FrameworkDomain, ControlObjective, Framework,
    GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/ai-mapping", tags=["Control Library - AI Mapping"])

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")


class AnalyzeRequest(BaseModel):
    framework_ids: Optional[List[int]] = None


class AnalyzePairRequest(BaseModel):
    source_type: str
    source_control_id: int
    target_type: str
    target_control_id: int


class VerifySimilarityRequest(BaseModel):
    verified: bool
    adjusted_score: Optional[float] = None


class SimilarityMappingResponse(BaseModel):
    id: int
    tenant_id: int
    source_type: str
    source_control_id: int
    target_type: str
    target_control_id: int
    similarity_score: float
    similarity_type: str
    ai_reasoning: Optional[str]
    verified: bool
    verified_by: Optional[int]
    created_at: str
    source_control: Optional[dict] = None
    target_control: Optional[dict] = None

    class Config:
        from_attributes = True


class AnalysisResponse(BaseModel):
    id: int
    tenant_id: int
    analysis_type: str
    status: str
    frameworks_analyzed: List[int]
    total_controls_analyzed: int
    mappings_created: int
    groups_created: int
    started_at: str
    completed_at: Optional[str]
    error_message: Optional[str]
    created_by: int

    class Config:
        from_attributes = True


class SimilarityAnalysisResult(BaseModel):
    similarity_score: float
    similarity_type: str
    reasoning: str
    keywords_source: List[str]
    keywords_target: List[str]


def check_ai_available() -> bool:
    """Check if OpenAI API is configured (Replit AI Integrations or direct API key)."""
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL", "")
    is_modelfarm = "modelfarm" in base_url
    if is_modelfarm:
        return True
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
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
            "message": "AI integration is not configured. The platform uses Replit AI Integrations or you can add OPENAI_API_KEY to enable AI features.",
            "fallback_available": fallback_available
        }
    )


def get_openai_client() -> OpenAI:
    if not check_ai_available():
        raise_ai_unavailable(fallback_available=False)
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    return OpenAI(
        api_key=api_key,
        base_url=base_url
    )


def analyze_control_similarity(control1_text: str, control2_text: str) -> dict:
    client = get_openai_client()
    
    prompt = f"""Analyze the similarity between these two compliance controls and determine if they address the same or related requirements.

Control 1:
{control1_text[:2000]}

Control 2:
{control2_text[:2000]}

Analyze and respond in JSON format:
{{
    "similarity_score": <float 0.0 to 1.0>,
    "similarity_type": "<one of: identical, equivalent, related, partial, different>",
    "reasoning": "<2-3 sentence explanation of the similarity>",
    "keywords_source": ["<key term 1>", "<key term 2>", ...],
    "keywords_target": ["<key term 1>", "<key term 2>", ...]
}}

Similarity score guidelines:
- 0.9-1.0: Identical or nearly identical requirements
- 0.7-0.89: Equivalent requirements with different wording
- 0.5-0.69: Related requirements addressing similar concerns
- 0.3-0.49: Partially overlapping requirements
- 0.0-0.29: Different requirements with minimal overlap"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "You are a compliance expert analyzing control requirements for similarity. Respond only with valid JSON."
                },
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=1000,
            temperature=0.3
        )
        
        result_text = response.choices[0].message.content or "{}"
        return json.loads(result_text)
    except json.JSONDecodeError:
        return {
            "similarity_score": 0.0,
            "similarity_type": "different",
            "reasoning": "Failed to parse AI response",
            "keywords_source": [],
            "keywords_target": []
        }
    except Exception as e:
        error_msg = str(e)
        if "FREE_CLOUD_BUDGET_EXCEEDED" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Cloud budget exceeded. Please upgrade your plan."
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI analysis failed: {error_msg}"
        )


def batch_analyze_controls(controls_list: List[dict]) -> List[dict]:
    client = get_openai_client()
    
    controls_text = "\n\n".join([
        f"Control {i+1} (ID: {c['id']}, Type: {c['type']}):\nTitle: {c['title']}\nStatement: {c['statement'][:500]}"
        for i, c in enumerate(controls_list[:20])
    ])
    
    prompt = f"""Analyze the following compliance controls and identify similar or related controls. Group them by similarity.

{controls_text}

For each pair of controls that have similarity >= 0.5, provide:
{{
    "pairs": [
        {{
            "control1_id": <id>,
            "control1_type": "<type>",
            "control2_id": <id>,
            "control2_type": "<type>",
            "similarity_score": <float 0.0 to 1.0>,
            "similarity_type": "<identical|equivalent|related|partial>",
            "reasoning": "<brief explanation>"
        }}
    ]
}}

Only include pairs with similarity_score >= 0.5."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "You are a compliance expert identifying similar control requirements. Respond only with valid JSON."
                },
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=4000,
            temperature=0.3
        )
        
        result_text = response.choices[0].message.content or '{"pairs": []}'
        result = json.loads(result_text)
        return result.get("pairs", [])
    except json.JSONDecodeError:
        return []
    except Exception as e:
        error_msg = str(e)
        if "FREE_CLOUD_BUDGET_EXCEEDED" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Cloud budget exceeded. Please upgrade your plan."
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Batch analysis failed: {error_msg}"
        )


def extract_control_keywords(control_text: str) -> List[str]:
    client = get_openai_client()
    
    prompt = f"""Extract the key compliance terms and concepts from this control requirement:

{control_text[:1500]}

Return a JSON object with an array of 5-10 key terms:
{{"keywords": ["term1", "term2", ...]}}"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "You are a compliance expert extracting key terms. Respond only with valid JSON."
                },
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=500,
            temperature=0.3
        )
        
        result_text = response.choices[0].message.content or '{"keywords": []}'
        result = json.loads(result_text)
        return result.get("keywords", [])
    except:
        return []


def get_control_text(control_type: str, control_id: int, db: Session) -> Optional[str]:
    if control_type == "normalized":
        control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
        if control:
            return f"Title: {control.name}\nCode: {control.code}\nStatement: {control.statement or ''}\nObjective: {control.objective or ''}"
    elif control_type == "framework":
        control = db.query(FrameworkControl).filter(FrameworkControl.id == control_id).first()
        if control:
            return f"Title: {control.name}\nCode: {control.code}\nStatement: {control.statement or ''}\nObjective: {control.control_objective or ''}"
    return None


def get_control_details(control_type: str, control_id: int, db: Session) -> Optional[dict]:
    if control_type == "normalized":
        control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
        if control:
            return {
                "id": control.id,
                "type": "normalized",
                "code": control.code,
                "name": control.name,
                "statement": control.statement,
                "objective": control.objective
            }
    elif control_type == "framework":
        control = db.query(FrameworkControl).filter(FrameworkControl.id == control_id).first()
        if control:
            objective = control.objective
            domain = objective.domain if objective else None
            framework = domain.framework if domain else None
            return {
                "id": control.id,
                "type": "framework",
                "code": control.code,
                "name": control.name,
                "statement": control.statement,
                "objective": control.control_objective,
                "framework_id": framework.id if framework else None,
                "framework_name": framework.name if framework else None
            }
    return None


def serialize_analysis(analysis: ControlMappingAnalysis) -> dict:
    return {
        "id": analysis.id,
        "tenant_id": analysis.tenant_id,
        "analysis_type": analysis.analysis_type,
        "status": analysis.status,
        "frameworks_analyzed": analysis.frameworks_analyzed or [],
        "total_controls_analyzed": analysis.total_controls_analyzed,
        "mappings_created": analysis.mappings_created,
        "groups_created": analysis.groups_created,
        "started_at": analysis.started_at.isoformat() if analysis.started_at else "",
        "completed_at": analysis.completed_at.isoformat() if analysis.completed_at else None,
        "error_message": analysis.error_message,
        "created_by": analysis.created_by
    }


def serialize_similarity(mapping: ControlSimilarityMapping, db: Session) -> dict:
    source_control = get_control_details(mapping.source_type, mapping.source_control_id, db)
    target_control = get_control_details(mapping.target_type, mapping.target_control_id, db)
    
    return {
        "id": mapping.id,
        "tenant_id": mapping.tenant_id,
        "source_type": mapping.source_type,
        "source_control_id": mapping.source_control_id,
        "target_type": mapping.target_type,
        "target_control_id": mapping.target_control_id,
        "similarity_score": mapping.similarity_score,
        "similarity_type": mapping.similarity_type,
        "ai_reasoning": mapping.ai_reasoning,
        "verified": mapping.verified,
        "verified_by": mapping.verified_by,
        "created_at": mapping.created_at.isoformat() if mapping.created_at else "",
        "source_control": source_control,
        "target_control": target_control
    }


@router.post("/analyze")
def start_analysis(
    request: AnalyzeRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if not check_ai_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "AI features unavailable",
                "message": "OpenAI API key is not configured. Please add OPENAI_API_KEY to enable AI-powered similarity analysis.",
                "fallback_available": False
            }
        )
    
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has no tenant assigned"
        )
    
    analysis = ControlMappingAnalysis(
        tenant_id=tenant_id,
        analysis_type="full_similarity",
        status="processing",
        frameworks_analyzed=request.framework_ids or [],
        created_by=current_user.id,
        started_at=datetime.utcnow()
    )
    db.add(analysis)
    db.commit()
    db.refresh(analysis)
    
    try:
        controls_list = []
        
        normalized_controls = db.query(NormalizedControl).limit(50).all()
        for nc in normalized_controls:
            controls_list.append({
                "id": nc.id,
                "type": "normalized",
                "title": nc.name,
                "statement": nc.statement or nc.objective or ""
            })
        
        framework_query = db.query(FrameworkControl)
        if request.framework_ids:
            framework_query = framework_query.join(ControlObjective).join(FrameworkDomain).filter(
                FrameworkDomain.framework_id.in_(request.framework_ids)
            )
        framework_controls = framework_query.limit(50).all()
        
        for fc in framework_controls:
            controls_list.append({
                "id": fc.id,
                "type": "framework",
                "title": fc.name,
                "statement": fc.statement or fc.control_objective or ""
            })
        
        analysis.total_controls_analyzed = len(controls_list)
        db.commit()
        
        if len(controls_list) < 2:
            analysis.status = "completed"
            analysis.completed_at = datetime.utcnow()
            analysis.error_message = "Not enough controls to analyze"
            db.commit()
            return serialize_analysis(analysis)
        
        similar_pairs = batch_analyze_controls(controls_list)
        
        mappings_created = 0
        for pair in similar_pairs:
            existing = db.query(ControlSimilarityMapping).filter(
                ControlSimilarityMapping.tenant_id == tenant_id,
                ControlSimilarityMapping.source_type == pair.get("control1_type"),
                ControlSimilarityMapping.source_control_id == pair.get("control1_id"),
                ControlSimilarityMapping.target_type == pair.get("control2_type"),
                ControlSimilarityMapping.target_control_id == pair.get("control2_id")
            ).first()
            
            if not existing:
                mapping = ControlSimilarityMapping(
                    tenant_id=tenant_id,
                    source_type=pair.get("control1_type", "framework"),
                    source_control_id=pair.get("control1_id"),
                    target_type=pair.get("control2_type", "framework"),
                    target_control_id=pair.get("control2_id"),
                    similarity_score=pair.get("similarity_score", 0.5),
                    similarity_type=pair.get("similarity_type", "related"),
                    ai_reasoning=pair.get("reasoning"),
                    verified=False,
                    created_at=datetime.utcnow()
                )
                db.add(mapping)
                mappings_created += 1
        
        analysis.mappings_created = mappings_created
        analysis.status = "completed"
        analysis.completed_at = datetime.utcnow()
        db.commit()
        db.refresh(analysis)
        
        return serialize_analysis(analysis)
        
    except HTTPException:
        raise
    except Exception as e:
        analysis.status = "failed"
        analysis.error_message = str(e)
        analysis.completed_at = datetime.utcnow()
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Analysis failed: {str(e)}"
        )


@router.get("/analysis/{analysis_id}")
def get_analysis(
    analysis_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    analysis = db.query(ControlMappingAnalysis).filter(
        ControlMappingAnalysis.id == analysis_id
    ).first()
    
    if not analysis:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Analysis not found"
        )
    
    if analysis.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this analysis"
        )
    
    return serialize_analysis(analysis)


@router.get("/similarities")
def get_similarities(
    source_type: Optional[str] = Query(None),
    source_id: Optional[int] = Query(None),
    min_score: Optional[float] = Query(None),
    framework_id: Optional[int] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    query = db.query(ControlSimilarityMapping).filter(
        ControlSimilarityMapping.tenant_id.in_(user_tenants)
    )
    
    if source_type:
        query = query.filter(
            or_(
                ControlSimilarityMapping.source_type == source_type,
                ControlSimilarityMapping.target_type == source_type
            )
        )
    
    if source_id:
        query = query.filter(
            or_(
                ControlSimilarityMapping.source_control_id == source_id,
                ControlSimilarityMapping.target_control_id == source_id
            )
        )
    
    if min_score is not None:
        query = query.filter(ControlSimilarityMapping.similarity_score >= min_score)
    
    query = query.order_by(desc(ControlSimilarityMapping.similarity_score))
    
    total = query.count()
    mappings = query.offset(skip).limit(limit).all()
    
    results = []
    for mapping in mappings:
        if framework_id:
            source_control = get_control_details(mapping.source_type, mapping.source_control_id, db)
            target_control = get_control_details(mapping.target_type, mapping.target_control_id, db)
            source_fw_id = source_control.get("framework_id") if source_control else None
            target_fw_id = target_control.get("framework_id") if target_control else None
            if source_fw_id != framework_id and target_fw_id != framework_id:
                continue
        results.append(serialize_similarity(mapping, db))
    
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": results
    }


@router.post("/analyze-pair")
def analyze_pair(
    request: AnalyzePairRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if not check_ai_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "AI features unavailable",
                "message": "OpenAI API key is not configured. Please add OPENAI_API_KEY to enable AI-powered similarity analysis.",
                "fallback_available": False
            }
        )
    
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has no tenant assigned"
        )
    
    source_text = get_control_text(request.source_type, request.source_control_id, db)
    target_text = get_control_text(request.target_type, request.target_control_id, db)
    
    if not source_text:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source control not found: {request.source_type}/{request.source_control_id}"
        )
    
    if not target_text:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Target control not found: {request.target_type}/{request.target_control_id}"
        )
    
    result = analyze_control_similarity(source_text, target_text)
    
    existing = db.query(ControlSimilarityMapping).filter(
        ControlSimilarityMapping.tenant_id == tenant_id,
        ControlSimilarityMapping.source_type == request.source_type,
        ControlSimilarityMapping.source_control_id == request.source_control_id,
        ControlSimilarityMapping.target_type == request.target_type,
        ControlSimilarityMapping.target_control_id == request.target_control_id
    ).first()
    
    if existing:
        existing.similarity_score = result.get("similarity_score", 0)
        existing.similarity_type = result.get("similarity_type", "different")
        existing.ai_reasoning = result.get("reasoning")
        existing.verified = False
        db.commit()
        db.refresh(existing)
        return serialize_similarity(existing, db)
    else:
        mapping = ControlSimilarityMapping(
            tenant_id=tenant_id,
            source_type=request.source_type,
            source_control_id=request.source_control_id,
            target_type=request.target_type,
            target_control_id=request.target_control_id,
            similarity_score=result.get("similarity_score", 0),
            similarity_type=result.get("similarity_type", "different"),
            ai_reasoning=result.get("reasoning"),
            verified=False,
            created_at=datetime.utcnow()
        )
        db.add(mapping)
        db.commit()
        db.refresh(mapping)
        return serialize_similarity(mapping, db)


@router.put("/similarities/{similarity_id}/verify")
def verify_similarity(
    similarity_id: int,
    request: VerifySimilarityRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    mapping = db.query(ControlSimilarityMapping).filter(
        ControlSimilarityMapping.id == similarity_id
    ).first()
    
    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Similarity mapping not found"
        )
    
    if mapping.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this mapping"
        )
    
    mapping.verified = request.verified
    mapping.verified_by = current_user.id
    
    if request.adjusted_score is not None:
        if request.adjusted_score < 0 or request.adjusted_score > 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Adjusted score must be between 0 and 1"
            )
        mapping.similarity_score = request.adjusted_score
    
    db.commit()
    db.refresh(mapping)
    
    return serialize_similarity(mapping, db)


@router.get("/suggestions/{control_type}/{control_id}")
def get_suggestions(
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
    
    control_text = get_control_text(control_type, control_id, db)
    if not control_text:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    existing_mappings = db.query(ControlSimilarityMapping).filter(
        ControlSimilarityMapping.tenant_id.in_(user_tenants),
        or_(
            (ControlSimilarityMapping.source_type == control_type) & 
            (ControlSimilarityMapping.source_control_id == control_id),
            (ControlSimilarityMapping.target_type == control_type) & 
            (ControlSimilarityMapping.target_control_id == control_id)
        )
    ).order_by(desc(ControlSimilarityMapping.similarity_score)).limit(10).all()
    
    if len(existing_mappings) >= 5:
        suggestions = []
        for mapping in existing_mappings:
            if mapping.source_type == control_type and mapping.source_control_id == control_id:
                related_control = get_control_details(mapping.target_type, mapping.target_control_id, db)
            else:
                related_control = get_control_details(mapping.source_type, mapping.source_control_id, db)
            
            if related_control:
                suggestions.append({
                    "control": related_control,
                    "similarity_score": mapping.similarity_score,
                    "similarity_type": mapping.similarity_type,
                    "reasoning": mapping.ai_reasoning,
                    "verified": mapping.verified
                })
        
        return {
            "control_type": control_type,
            "control_id": control_id,
            "suggestions": suggestions,
            "source": "cached"
        }
    
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        return {
            "control_type": control_type,
            "control_id": control_id,
            "suggestions": [],
            "source": "none"
        }
    
    all_controls = []
    
    normalized_controls = db.query(NormalizedControl).filter(
        NormalizedControl.id != control_id if control_type == "normalized" else True
    ).limit(30).all()
    
    for nc in normalized_controls:
        all_controls.append({
            "id": nc.id,
            "type": "normalized",
            "title": nc.name,
            "statement": nc.statement or nc.objective or ""
        })
    
    framework_controls = db.query(FrameworkControl).filter(
        FrameworkControl.id != control_id if control_type == "framework" else True
    ).limit(30).all()
    
    for fc in framework_controls:
        all_controls.append({
            "id": fc.id,
            "type": "framework",
            "title": fc.name,
            "statement": fc.statement or fc.control_objective or ""
        })
    
    source_control_data = {
        "id": control_id,
        "type": control_type,
        "title": "Source Control",
        "statement": control_text
    }
    
    controls_for_analysis = [source_control_data] + all_controls[:19]
    
    try:
        similar_pairs = batch_analyze_controls(controls_for_analysis)
        
        suggestions = []
        for pair in similar_pairs:
            if (pair.get("control1_id") == control_id and pair.get("control1_type") == control_type):
                related_id = pair.get("control2_id")
                related_type = pair.get("control2_type")
            elif (pair.get("control2_id") == control_id and pair.get("control2_type") == control_type):
                related_id = pair.get("control1_id")
                related_type = pair.get("control1_type")
            else:
                continue
            
            related_control = get_control_details(related_type, related_id, db)
            if related_control:
                existing = db.query(ControlSimilarityMapping).filter(
                    ControlSimilarityMapping.tenant_id == tenant_id,
                    ControlSimilarityMapping.source_type == control_type,
                    ControlSimilarityMapping.source_control_id == control_id,
                    ControlSimilarityMapping.target_type == related_type,
                    ControlSimilarityMapping.target_control_id == related_id
                ).first()
                
                if not existing:
                    mapping = ControlSimilarityMapping(
                        tenant_id=tenant_id,
                        source_type=control_type,
                        source_control_id=control_id,
                        target_type=related_type,
                        target_control_id=related_id,
                        similarity_score=pair.get("similarity_score", 0.5),
                        similarity_type=pair.get("similarity_type", "related"),
                        ai_reasoning=pair.get("reasoning"),
                        verified=False,
                        created_at=datetime.utcnow()
                    )
                    db.add(mapping)
                
                suggestions.append({
                    "control": related_control,
                    "similarity_score": pair.get("similarity_score", 0.5),
                    "similarity_type": pair.get("similarity_type", "related"),
                    "reasoning": pair.get("reasoning"),
                    "verified": False
                })
        
        db.commit()
        
        suggestions.sort(key=lambda x: x["similarity_score"], reverse=True)
        
        return {
            "control_type": control_type,
            "control_id": control_id,
            "suggestions": suggestions[:10],
            "source": "ai"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        return {
            "control_type": control_type,
            "control_id": control_id,
            "suggestions": [],
            "source": "error",
            "error": str(e)
        }
