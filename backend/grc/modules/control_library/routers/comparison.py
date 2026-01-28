import csv
import io
import os
import json
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, func, and_
from pydantic import BaseModel
from openai import OpenAI

try:
    from openpyxl import Workbook
    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False

from ....models import (
    CommonControlGroup, CommonControlGroupMapping, NormalizedControl,
    FrameworkControl, FrameworkDomain, ControlObjective, Framework,
    ControlSimilarityMapping, GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/comparison", tags=["Control Library - Comparison"])

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")


class ControlPair(BaseModel):
    control1_type: str
    control1_id: int
    control2_type: str
    control2_id: int


class SideBySideRequest(BaseModel):
    control_pairs: List[ControlPair]


class ExportComparisonRequest(BaseModel):
    framework_ids: List[int]
    format: str = "csv"


def check_ai_available() -> bool:
    """Check if OpenAI API key is configured (Replit AI Integrations or direct API key)."""
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    if base_url and "modelfarm" in base_url:
        return True
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return False
    if api_key.startswith("_DUMMY") or api_key == "your-api-key-here" or len(api_key) < 20:
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
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    return OpenAI(
        api_key=api_key,
        base_url=base_url
    )


def get_control_text(control_type: str, control_id: int, db: Session) -> Optional[str]:
    if control_type == "normalized":
        control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
        if control:
            return f"Code: {control.code}\nName: {control.name}\nStatement: {control.statement or ''}\nObjective: {control.objective or ''}"
    elif control_type == "framework":
        control = db.query(FrameworkControl).filter(FrameworkControl.id == control_id).first()
        if control:
            return f"Code: {control.code}\nName: {control.name}\nStatement: {control.statement or ''}\nObjective: {control.control_objective or ''}"
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
                "objective": control.objective,
                "framework_id": None,
                "framework_name": None,
                "framework_code": None
            }
    elif control_type == "framework":
        control = db.query(FrameworkControl).options(
            joinedload(FrameworkControl.objective)
            .joinedload(ControlObjective.domain)
            .joinedload(FrameworkDomain.framework)
        ).filter(FrameworkControl.id == control_id).first()
        if control:
            framework = None
            if control.objective and control.objective.domain:
                framework = control.objective.domain.framework
            return {
                "id": control.id,
                "type": "framework",
                "code": control.code,
                "name": control.name,
                "statement": control.statement,
                "objective": control.control_objective,
                "framework_id": framework.id if framework else None,
                "framework_name": framework.name if framework else None,
                "framework_code": framework.short_code if framework else None
            }
    return None


def get_control_differences(control1_text: str, control2_text: str) -> dict:
    try:
        client = get_openai_client()
        prompt = f"""Analyze these two compliance controls and identify differences:

Control 1:
{control1_text[:2000]}

Control 2:
{control2_text[:2000]}

Respond in JSON format:
{{
    "similarity_score": <float 0.0 to 1.0>,
    "common_keywords": ["<shared terms>"],
    "differences": ["<key difference 1>", "<key difference 2>"],
    "control1_unique": ["<requirements only in control 1>"],
    "control2_unique": ["<requirements only in control 2>"],
    "control1_stricter": ["<aspects where control 1 is stricter>"],
    "control2_stricter": ["<aspects where control 2 is stricter>"]
}}"""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a compliance expert comparing control requirements. Respond only with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=1500,
            temperature=0.3
        )
        return json.loads(response.choices[0].message.content or '{}')
    except Exception as e:
        error_msg = str(e)
        if "FREE_CLOUD_BUDGET_EXCEEDED" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Cloud budget exceeded. Please upgrade your plan."
            )
        return {
            "similarity_score": 0.0,
            "common_keywords": [],
            "differences": ["Analysis failed"],
            "control1_unique": [],
            "control2_unique": [],
            "control1_stricter": [],
            "control2_stricter": []
        }


def analyze_control_with_equivalents(control_text: str, equivalent_texts: List[str]) -> dict:
    try:
        client = get_openai_client()
        equivalents_formatted = "\n\n".join([f"Equivalent {i+1}:\n{t[:800]}" for i, t in enumerate(equivalent_texts[:5])])
        
        prompt = f"""Analyze this control against its mapped equivalents from other frameworks:

Main Control:
{control_text[:1500]}

Equivalent Controls:
{equivalents_formatted}

Respond in JSON format:
{{
    "common_requirements": ["<requirements shared across all>"],
    "unique_requirements": ["<requirements unique to main control>"],
    "stricter_aspects": ["<aspects where main control is stricter>"],
    "gaps": ["<requirements in equivalents but not in main>"],
    "summary": "<brief comparison summary>"
}}"""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a compliance expert analyzing control requirements across frameworks. Respond only with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=2000,
            temperature=0.3
        )
        return json.loads(response.choices[0].message.content or '{}')
    except Exception as e:
        error_msg = str(e)
        if "FREE_CLOUD_BUDGET_EXCEEDED" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Cloud budget exceeded. Please upgrade your plan."
            )
        return {
            "common_requirements": [],
            "unique_requirements": [],
            "stricter_aspects": [],
            "gaps": [],
            "summary": "Analysis failed"
        }


def build_comparison_matrix(db: Session, tenant_id: int, framework_ids: List[int]) -> dict:
    matrix = {}
    for fw1_id in framework_ids:
        matrix[fw1_id] = {}
        for fw2_id in framework_ids:
            if fw1_id == fw2_id:
                matrix[fw1_id][fw2_id] = None
            else:
                count = db.query(ControlSimilarityMapping).filter(
                    ControlSimilarityMapping.tenant_id == tenant_id,
                    ControlSimilarityMapping.source_type == "framework",
                    ControlSimilarityMapping.target_type == "framework",
                    ControlSimilarityMapping.similarity_score >= 0.5
                ).count()
                
                fc1_count = db.query(FrameworkControl).join(
                    ControlObjective, FrameworkControl.objective_id == ControlObjective.id
                ).join(
                    FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
                ).filter(FrameworkDomain.framework_id == fw1_id).count()
                
                fc2_count = db.query(FrameworkControl).join(
                    ControlObjective, FrameworkControl.objective_id == ControlObjective.id
                ).join(
                    FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
                ).filter(FrameworkDomain.framework_id == fw2_id).count()
                
                fc1_ids = db.query(FrameworkControl.id).join(
                    ControlObjective, FrameworkControl.objective_id == ControlObjective.id
                ).join(
                    FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
                ).filter(FrameworkDomain.framework_id == fw1_id).subquery()
                
                fc2_ids = db.query(FrameworkControl.id).join(
                    ControlObjective, FrameworkControl.objective_id == ControlObjective.id
                ).join(
                    FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
                ).filter(FrameworkDomain.framework_id == fw2_id).subquery()
                
                shared_groups = db.query(func.count(func.distinct(CommonControlGroupMapping.group_id))).filter(
                    or_(
                        CommonControlGroupMapping.framework_control_id.in_(fc1_ids),
                        CommonControlGroupMapping.framework_control_id.in_(fc2_ids)
                    )
                ).scalar() or 0
                
                matrix[fw1_id][fw2_id] = {
                    "shared_mappings": shared_groups,
                    "framework1_controls": fc1_count,
                    "framework2_controls": fc2_count
                }
    
    return matrix


def serialize_framework_control(fc: FrameworkControl) -> dict:
    framework_info = None
    if fc.objective and fc.objective.domain and fc.objective.domain.framework:
        fw = fc.objective.domain.framework
        framework_info = {
            "id": fw.id,
            "name": fw.name,
            "short_code": fw.short_code
        }
    
    return {
        "id": fc.id,
        "code": fc.code,
        "name": fc.name,
        "statement": fc.statement,
        "control_type": "framework",
        "framework": framework_info
    }


@router.get("/frameworks")
def get_frameworks_for_comparison(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    frameworks = db.query(Framework).filter(Framework.is_active == True).all()
    
    result = []
    for fw in frameworks:
        control_count = db.query(FrameworkControl).join(
            ControlObjective, FrameworkControl.objective_id == ControlObjective.id
        ).join(
            FrameworkDomain, ControlObjective.domain_id == FrameworkDomain.id
        ).filter(FrameworkDomain.framework_id == fw.id).count()
        
        domain_count = db.query(FrameworkDomain).filter(
            FrameworkDomain.framework_id == fw.id
        ).count()
        
        result.append({
            "id": fw.id,
            "name": fw.name,
            "short_code": fw.short_code,
            "version": fw.version,
            "regulator": fw.regulator,
            "jurisdiction": fw.jurisdiction,
            "control_count": control_count,
            "domain_count": domain_count
        })
    
    return {"frameworks": result}


@router.get("/controls")
def compare_controls_between_frameworks(
    framework_ids: List[int] = Query(..., min_length=2),
    category: Optional[str] = None,
    domain: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    frameworks = db.query(Framework).filter(Framework.id.in_(framework_ids)).all()
    framework_map = {fw.id: fw for fw in frameworks}
    
    if len(frameworks) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least 2 valid frameworks are required for comparison"
        )
    
    groups_query = db.query(CommonControlGroup).filter(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        )
    )
    
    if category:
        groups_query = groups_query.filter(CommonControlGroup.category == category)
    if domain:
        groups_query = groups_query.filter(CommonControlGroup.domain == domain)
    
    total = groups_query.count()
    groups = groups_query.offset(skip).limit(limit).all()
    
    comparison_grid = []
    for group in groups:
        mappings = db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.group_id == group.id,
            CommonControlGroupMapping.framework_control_id.isnot(None)
        ).all()
        
        framework_controls = {}
        for fw_id in framework_ids:
            framework_controls[fw_id] = []
        
        for mapping in mappings:
            if mapping.framework_control_id:
                fc = db.query(FrameworkControl).options(
                    joinedload(FrameworkControl.objective)
                    .joinedload(ControlObjective.domain)
                    .joinedload(FrameworkDomain.framework)
                ).filter(FrameworkControl.id == mapping.framework_control_id).first()
                
                if fc and fc.objective and fc.objective.domain:
                    fw_id = fc.objective.domain.framework_id
                    if fw_id in framework_ids:
                        framework_controls[fw_id].append({
                            "id": fc.id,
                            "code": fc.code,
                            "name": fc.name,
                            "statement": fc.statement[:200] if fc.statement else None,
                            "mapping_confidence": mapping.mapping_confidence
                        })
        
        has_controls = any(len(controls) > 0 for controls in framework_controls.values())
        if has_controls:
            comparison_grid.append({
                "group_id": group.id,
                "group_code": group.code,
                "group_name": group.name,
                "category": group.category,
                "domain": group.domain,
                "framework_controls": framework_controls
            })
    
    frameworks_info = [
        {
            "id": fw.id,
            "name": fw.name,
            "short_code": fw.short_code
        }
        for fw in frameworks
    ]
    
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "frameworks": frameworks_info,
        "comparison_grid": comparison_grid
    }


@router.get("/group/{group_id}")
def compare_controls_in_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control group not found"
        )
    
    mappings = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group_id
    ).all()
    
    controls_by_framework = {}
    normalized_controls = []
    
    for mapping in mappings:
        if mapping.normalized_control_id:
            nc = db.query(NormalizedControl).filter(
                NormalizedControl.id == mapping.normalized_control_id
            ).first()
            if nc:
                normalized_controls.append({
                    "id": nc.id,
                    "code": nc.code,
                    "name": nc.name,
                    "statement": nc.statement,
                    "mapping_confidence": mapping.mapping_confidence,
                    "mapping_source": mapping.mapping_source
                })
        
        if mapping.framework_control_id:
            fc = db.query(FrameworkControl).options(
                joinedload(FrameworkControl.objective)
                .joinedload(ControlObjective.domain)
                .joinedload(FrameworkDomain.framework)
            ).filter(FrameworkControl.id == mapping.framework_control_id).first()
            
            if fc and fc.objective and fc.objective.domain and fc.objective.domain.framework:
                fw = fc.objective.domain.framework
                if fw.id not in controls_by_framework:
                    controls_by_framework[fw.id] = {
                        "framework_id": fw.id,
                        "framework_name": fw.name,
                        "framework_code": fw.short_code,
                        "controls": []
                    }
                
                similarity_mapping = db.query(ControlSimilarityMapping).filter(
                    ControlSimilarityMapping.tenant_id == tenant_id,
                    or_(
                        and_(
                            ControlSimilarityMapping.source_control_id == fc.id,
                            ControlSimilarityMapping.source_type == "framework"
                        ),
                        and_(
                            ControlSimilarityMapping.target_control_id == fc.id,
                            ControlSimilarityMapping.target_type == "framework"
                        )
                    )
                ).first()
                
                controls_by_framework[fw.id]["controls"].append({
                    "id": fc.id,
                    "code": fc.code,
                    "name": fc.name,
                    "statement": fc.statement,
                    "mapping_confidence": mapping.mapping_confidence,
                    "mapping_source": mapping.mapping_source,
                    "similarity_score": similarity_mapping.similarity_score if similarity_mapping else None
                })
    
    return {
        "group": {
            "id": group.id,
            "code": group.code,
            "name": group.name,
            "description": group.description,
            "category": group.category,
            "domain": group.domain,
            "keywords": group.keywords,
            "ai_summary": group.ai_summary
        },
        "normalized_controls": normalized_controls,
        "framework_controls": list(controls_by_framework.values())
    }


@router.get("/control/{control_type}/{control_id}")
def compare_control_with_equivalents(
    control_type: str,
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    
    if control_type not in ["normalized", "framework"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid control type. Must be 'normalized' or 'framework'"
        )
    
    main_control = get_control_details(control_type, control_id, db)
    if not main_control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    similar_controls = []
    
    similarity_mappings = db.query(ControlSimilarityMapping).filter(
        ControlSimilarityMapping.tenant_id == tenant_id,
        or_(
            and_(
                ControlSimilarityMapping.source_control_id == control_id,
                ControlSimilarityMapping.source_type == control_type
            ),
            and_(
                ControlSimilarityMapping.target_control_id == control_id,
                ControlSimilarityMapping.target_type == control_type
            )
        )
    ).all()
    
    for mapping in similarity_mappings:
        if mapping.source_control_id == control_id and mapping.source_type == control_type:
            other_type = mapping.target_type
            other_id = mapping.target_control_id
        else:
            other_type = mapping.source_type
            other_id = mapping.source_control_id
        
        other_control = get_control_details(other_type, other_id, db)
        if other_control:
            main_text = get_control_text(control_type, control_id, db)
            other_text = get_control_text(other_type, other_id, db)
            
            difference_highlights = []
            if main_text and other_text:
                main_keywords = set(main_text.lower().split())
                other_keywords = set(other_text.lower().split())
                unique_to_main = main_keywords - other_keywords
                unique_to_other = other_keywords - main_keywords
                if unique_to_main:
                    difference_highlights.append(f"Unique to main: {', '.join(list(unique_to_main)[:5])}")
                if unique_to_other:
                    difference_highlights.append(f"Unique to equivalent: {', '.join(list(unique_to_other)[:5])}")
            
            similar_controls.append({
                **other_control,
                "similarity_score": mapping.similarity_score,
                "similarity_type": mapping.similarity_type,
                "ai_reasoning": mapping.ai_reasoning,
                "difference_highlights": difference_highlights
            })
    
    tenant_group_ids = db.query(CommonControlGroup.id).filter(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        )
    ).subquery()
    
    if control_type == "framework":
        group_mappings = db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.framework_control_id == control_id,
            CommonControlGroupMapping.group_id.in_(tenant_group_ids)
        ).all()
    else:
        group_mappings = db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.normalized_control_id == control_id,
            CommonControlGroupMapping.group_id.in_(tenant_group_ids)
        ).all()
    
    for gm in group_mappings:
        related_mappings = db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.group_id == gm.group_id,
            CommonControlGroupMapping.id != gm.id,
            CommonControlGroupMapping.group_id.in_(tenant_group_ids)
        ).all()
        
        for rm in related_mappings:
            already_added = any(
                (sc.get("type") == "framework" and sc.get("id") == rm.framework_control_id) or
                (sc.get("type") == "normalized" and sc.get("id") == rm.normalized_control_id)
                for sc in similar_controls
            )
            
            if not already_added:
                if rm.framework_control_id:
                    other_control = get_control_details("framework", rm.framework_control_id, db)
                elif rm.normalized_control_id:
                    other_control = get_control_details("normalized", rm.normalized_control_id, db)
                else:
                    continue
                
                if other_control:
                    similar_controls.append({
                        **other_control,
                        "similarity_score": rm.mapping_confidence or 0.7,
                        "similarity_type": "group_mapping",
                        "ai_reasoning": f"Mapped to same control group (Group ID: {gm.group_id})",
                        "difference_highlights": []
                    })
    
    similar_controls.sort(key=lambda x: x.get("similarity_score", 0), reverse=True)
    
    return {
        "control": main_control,
        "similar_controls": similar_controls,
        "total_similar": len(similar_controls)
    }


@router.post("/side-by-side")
def get_side_by_side_comparison(
    request: SideBySideRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if not request.control_pairs:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one control pair is required"
        )
    
    ai_available = check_ai_available()
    
    comparisons = []
    for pair in request.control_pairs:
        control1 = get_control_details(pair.control1_type, pair.control1_id, db)
        control2 = get_control_details(pair.control2_type, pair.control2_id, db)
        
        if not control1 or not control2:
            comparisons.append({
                "pair": {
                    "control1": {"type": pair.control1_type, "id": pair.control1_id},
                    "control2": {"type": pair.control2_type, "id": pair.control2_id}
                },
                "error": "One or both controls not found",
                "control1": control1,
                "control2": control2,
                "comparison": None,
                "ai_analysis": False
            })
            continue
        
        text1 = get_control_text(pair.control1_type, pair.control1_id, db)
        text2 = get_control_text(pair.control2_type, pair.control2_id, db)
        
        if ai_available:
            differences = get_control_differences(text1 or "", text2 or "")
            comparison_data = {
                "similarity_score": differences.get("similarity_score", 0),
                "common_keywords": differences.get("common_keywords", []),
                "differences": differences.get("differences", []),
                "control1_unique": differences.get("control1_unique", []),
                "control2_unique": differences.get("control2_unique", []),
                "control1_stricter": differences.get("control1_stricter", []),
                "control2_stricter": differences.get("control2_stricter", [])
            }
            ai_analyzed = True
        else:
            words1 = set((text1 or "").lower().split())
            words2 = set((text2 or "").lower().split())
            common = words1 & words2
            unique1 = words1 - words2
            unique2 = words2 - words1
            comparison_data = {
                "similarity_score": len(common) / max(len(words1 | words2), 1),
                "common_keywords": list(common)[:20],
                "differences": ["AI analysis unavailable - showing basic text comparison"],
                "control1_unique": list(unique1)[:15],
                "control2_unique": list(unique2)[:15],
                "control1_stricter": [],
                "control2_stricter": []
            }
            ai_analyzed = False
        
        comparisons.append({
            "pair": {
                "control1": {"type": pair.control1_type, "id": pair.control1_id},
                "control2": {"type": pair.control2_type, "id": pair.control2_id}
            },
            "control1": {
                **control1,
                "control_text": text1
            },
            "control2": {
                **control2,
                "control_text": text2
            },
            "comparison": comparison_data,
            "ai_analysis": ai_analyzed
        })
    
    return {
        "comparisons": comparisons,
        "ai_available": ai_available,
        "ai_unavailable_message": None if ai_available else "OpenAI API key is not configured. Enable AI features for detailed comparison analysis."
    }


@router.get("/differences/{control_type}/{control_id}")
def get_ai_analyzed_differences(
    control_type: str,
    control_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    tenant_id = get_user_primary_tenant(current_user, db)
    ai_available = check_ai_available()
    
    if control_type not in ["normalized", "framework"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid control type. Must be 'normalized' or 'framework'"
        )
    
    main_control = get_control_details(control_type, control_id, db)
    if not main_control:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Control not found"
        )
    
    main_text = get_control_text(control_type, control_id, db)
    
    equivalent_texts = []
    equivalent_controls = []
    
    tenant_group_ids = db.query(CommonControlGroup.id).filter(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        )
    ).subquery()
    
    if control_type == "framework":
        group_mappings = db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.framework_control_id == control_id,
            CommonControlGroupMapping.group_id.in_(tenant_group_ids)
        ).all()
    else:
        group_mappings = db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.normalized_control_id == control_id,
            CommonControlGroupMapping.group_id.in_(tenant_group_ids)
        ).all()
    
    for gm in group_mappings:
        related_mappings = db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.group_id == gm.group_id,
            CommonControlGroupMapping.id != gm.id,
            CommonControlGroupMapping.group_id.in_(tenant_group_ids)
        ).limit(10).all()
        
        for rm in related_mappings:
            if rm.framework_control_id:
                eq_text = get_control_text("framework", rm.framework_control_id, db)
                eq_control = get_control_details("framework", rm.framework_control_id, db)
            elif rm.normalized_control_id:
                eq_text = get_control_text("normalized", rm.normalized_control_id, db)
                eq_control = get_control_details("normalized", rm.normalized_control_id, db)
            else:
                continue
            
            if eq_text and eq_control:
                equivalent_texts.append(eq_text)
                equivalent_controls.append(eq_control)
    
    similarity_mappings = db.query(ControlSimilarityMapping).filter(
        ControlSimilarityMapping.tenant_id == tenant_id,
        or_(
            and_(
                ControlSimilarityMapping.source_control_id == control_id,
                ControlSimilarityMapping.source_type == control_type
            ),
            and_(
                ControlSimilarityMapping.target_control_id == control_id,
                ControlSimilarityMapping.target_type == control_type
            )
        ),
        ControlSimilarityMapping.similarity_score >= 0.5
    ).limit(10).all()
    
    for sm in similarity_mappings:
        if sm.source_control_id == control_id and sm.source_type == control_type:
            other_type = sm.target_type
            other_id = sm.target_control_id
        else:
            other_type = sm.source_type
            other_id = sm.source_control_id
        
        eq_text = get_control_text(other_type, other_id, db)
        eq_control = get_control_details(other_type, other_id, db)
        
        if eq_text and eq_control and eq_control not in equivalent_controls:
            equivalent_texts.append(eq_text)
            equivalent_controls.append(eq_control)
    
    if not equivalent_texts:
        return {
            "control": main_control,
            "equivalent_count": 0,
            "analysis": {
                "common_requirements": [],
                "unique_requirements": [],
                "stricter_aspects": [],
                "gaps": [],
                "summary": "No equivalent controls found for comparison"
            },
            "equivalents": [],
            "ai_analysis": False
        }
    
    if not ai_available:
        main_words = set((main_text or "").lower().split())
        all_equiv_words = set()
        for eq_text in equivalent_texts:
            all_equiv_words.update(eq_text.lower().split())
        common_words = main_words & all_equiv_words
        unique_to_main = main_words - all_equiv_words
        
        return {
            "control": main_control,
            "equivalent_count": len(equivalent_controls),
            "analysis": {
                "common_requirements": [],
                "unique_requirements": [],
                "stricter_aspects": [],
                "gaps": [],
                "summary": "AI analysis unavailable. Basic text comparison shows the controls share common terminology."
            },
            "equivalents": equivalent_controls[:10],
            "ai_analysis": False,
            "basic_comparison": {
                "common_keywords": list(common_words)[:20],
                "unique_keywords": list(unique_to_main)[:20]
            },
            "ai_unavailable_message": "OpenAI API key is not configured. Enable AI features for detailed analysis."
        }
    
    analysis = analyze_control_with_equivalents(main_text or "", equivalent_texts)
    
    return {
        "control": main_control,
        "equivalent_count": len(equivalent_controls),
        "analysis": {
            "common_requirements": analysis.get("common_requirements", []),
            "unique_requirements": analysis.get("unique_requirements", []),
            "stricter_aspects": analysis.get("stricter_aspects", []),
            "gaps": analysis.get("gaps", []),
            "summary": analysis.get("summary", "")
        },
        "equivalents": equivalent_controls[:10],
        "ai_analysis": True
    }


@router.get("/matrix")
def get_comparison_matrix(
    framework_ids: Optional[List[int]] = Query(None),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    
    if framework_ids:
        frameworks = db.query(Framework).filter(
            Framework.id.in_(framework_ids),
            Framework.is_active == True
        ).all()
    else:
        frameworks = db.query(Framework).filter(Framework.is_active == True).all()
    
    if len(frameworks) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least 2 frameworks are required for comparison matrix"
        )
    
    fw_ids = [fw.id for fw in frameworks]
    matrix = build_comparison_matrix(db, tenant_id, fw_ids)
    
    frameworks_info = [
        {
            "id": fw.id,
            "name": fw.name,
            "short_code": fw.short_code
        }
        for fw in frameworks
    ]
    
    matrix_rows = []
    for fw in frameworks:
        row = {
            "framework_id": fw.id,
            "framework_name": fw.name,
            "framework_code": fw.short_code,
            "mappings": {}
        }
        for other_fw in frameworks:
            if fw.id == other_fw.id:
                row["mappings"][other_fw.id] = None
            else:
                row["mappings"][other_fw.id] = matrix.get(fw.id, {}).get(other_fw.id, {})
        matrix_rows.append(row)
    
    return {
        "frameworks": frameworks_info,
        "matrix": matrix_rows
    }


@router.post("/export-comparison")
def export_comparison(
    request: ExportComparisonRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    if len(request.framework_ids) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least 2 frameworks are required for comparison export"
        )
    
    frameworks = db.query(Framework).filter(Framework.id.in_(request.framework_ids)).all()
    framework_map = {fw.id: fw for fw in frameworks}
    
    groups = db.query(CommonControlGroup).filter(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        )
    ).all()
    
    export_data = []
    for group in groups:
        mappings = db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.group_id == group.id,
            CommonControlGroupMapping.framework_control_id.isnot(None)
        ).all()
        
        row = {
            "group_code": group.code,
            "group_name": group.name,
            "category": group.category,
            "domain": group.domain
        }
        
        for fw_id in request.framework_ids:
            fw = framework_map.get(fw_id)
            if fw:
                controls = []
                for mapping in mappings:
                    if mapping.framework_control_id:
                        fc = db.query(FrameworkControl).options(
                            joinedload(FrameworkControl.objective)
                            .joinedload(ControlObjective.domain)
                        ).filter(FrameworkControl.id == mapping.framework_control_id).first()
                        
                        if fc and fc.objective and fc.objective.domain and fc.objective.domain.framework_id == fw_id:
                            controls.append(fc.code)
                
                row[f"{fw.short_code}_controls"] = ", ".join(controls) if controls else ""
        
        if any(row.get(f"{framework_map[fid].short_code}_controls") for fid in request.framework_ids if fid in framework_map):
            export_data.append(row)
    
    if request.format == "xlsx":
        if not HAS_OPENPYXL:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Excel export not available"
            )
        
        wb = Workbook()
        ws = wb.active
        ws.title = "Framework Comparison"
        
        headers = ["Group Code", "Group Name", "Category", "Domain"]
        for fw_id in request.framework_ids:
            fw = framework_map.get(fw_id)
            if fw:
                headers.append(f"{fw.short_code} Controls")
        
        ws.append(headers)
        
        for row in export_data:
            row_data = [
                row["group_code"],
                row["group_name"],
                row["category"],
                row["domain"]
            ]
            for fw_id in request.framework_ids:
                fw = framework_map.get(fw_id)
                if fw:
                    row_data.append(row.get(f"{fw.short_code}_controls", ""))
            ws.append(row_data)
        
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=framework_comparison.xlsx"}
        )
    
    output = io.StringIO()
    fieldnames = ["group_code", "group_name", "category", "domain"]
    for fw_id in request.framework_ids:
        fw = framework_map.get(fw_id)
        if fw:
            fieldnames.append(f"{fw.short_code}_controls")
    
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    
    for row in export_data:
        filtered_row = {k: row.get(k, "") for k in fieldnames}
        writer.writerow(filtered_row)
    
    output.seek(0)
    
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=framework_comparison.csv"}
    )
