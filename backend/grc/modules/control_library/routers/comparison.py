from ....config import get_openai_api_key
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

from fastapi import Request

from ....models import (
    CommonControlGroup, CommonControlGroupMapping, NormalizedControl,
    FrameworkControl, FrameworkDomain, ControlObjective, Framework,
    ControlSimilarityMapping, GRCUser, get_db,
    UploadedFramework, ParsedFrameworkControl,
    ControlComparisonRun, ControlComparisonMapping,
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
    user_tenants = get_user_tenants(current_user, db)
    
    frameworks = db.query(UploadedFramework).filter(
        or_(
            UploadedFramework.tenant_id.in_(user_tenants),
            UploadedFramework.tenant_id.is_(None),
            UploadedFramework.is_shared == True
        ),
        UploadedFramework.upload_status.in_(['published', 'completed', 'parsed', 'classified']),
        UploadedFramework.is_active == True
    ).all()
    
    seen_keys: set = set()
    result = []
    for fw in frameworks:
        key = (fw.name.lower().strip(), (fw.version or '').lower().strip())
        if key in seen_keys:
            continue
        seen_keys.add(key)
        control_count = db.query(ParsedFrameworkControl).filter(
            ParsedFrameworkControl.uploaded_framework_id == fw.id
        ).count()
        
        domains = db.query(ParsedFrameworkControl.domain).filter(
            ParsedFrameworkControl.uploaded_framework_id == fw.id,
            ParsedFrameworkControl.domain != None
        ).distinct().all()
        
        result.append({
            "id": fw.id,
            "name": fw.name,
            "short_code": fw.name.split()[0] if fw.name else str(fw.id),
            "version": fw.version,
            "control_count": control_count,
            "domain_count": len(domains)
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


@router.get("/crosswalk")
def get_framework_crosswalk(
    source_framework_id: int = Query(...),
    destination_framework_id: int = Query(...),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Get crosswalk mapping between source and destination frameworks."""
    user_tenants = get_user_tenants(current_user, db)
    
    source_fw = db.query(UploadedFramework).filter(
        UploadedFramework.id == source_framework_id,
        or_(UploadedFramework.tenant_id.in_(user_tenants), UploadedFramework.tenant_id.is_(None))
    ).first()
    dest_fw = db.query(UploadedFramework).filter(
        UploadedFramework.id == destination_framework_id,
        or_(UploadedFramework.tenant_id.in_(user_tenants), UploadedFramework.tenant_id.is_(None))
    ).first()
    
    if not source_fw or not dest_fw:
        raise HTTPException(status_code=404, detail="Framework not found")
    
    source_controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == source_framework_id
    ).order_by(ParsedFrameworkControl.original_reference).all()
    
    dest_controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == destination_framework_id
    ).all()
    
    dest_by_category = {}
    dest_by_domain = {}
    for dc in dest_controls:
        cat = (dc.category or "").lower().strip()
        dom = (dc.domain or "").lower().strip()
        if cat:
            dest_by_category.setdefault(cat, []).append(dc)
        if dom:
            dest_by_domain.setdefault(dom, []).append(dc)
    
    def _extract_keywords(text):
        if not text:
            return set()
        stop_words = {'the', 'and', 'for', 'of', 'to', 'in', 'a', 'an', 'is', 'are', 'be', 'with', 'that', 'this', 'shall', 'must', 'should', 'or', 'its', 'by', 'on', 'as', 'from', 'all', 'has', 'have', 'not', 'at'}
        words = set(w.lower().strip('.,;:()[]') for w in text.split() if len(w) > 2)
        return words - stop_words
    
    def _keyword_score(source_ctrl, dest_ctrl):
        s_keywords = _extract_keywords(f"{source_ctrl.title} {source_ctrl.description or ''}")
        d_keywords = _extract_keywords(f"{dest_ctrl.title} {dest_ctrl.description or ''}")
        if not s_keywords or not d_keywords:
            return 0
        overlap = s_keywords & d_keywords
        return len(overlap) / max(len(s_keywords), 1)
    
    total = len(source_controls)
    paginated_source = source_controls[skip:skip+limit]
    
    crosswalk_rows = []
    for sc in paginated_source:
        matched_dest = []
        match_type = "category"
        sc_cat = (sc.category or "").lower().strip()
        sc_dom = (sc.domain or "").lower().strip()
        
        if sc_cat and sc_cat in dest_by_category:
            matched_dest.extend(dest_by_category[sc_cat])
        
        if not matched_dest and sc_dom and sc_dom in dest_by_domain:
            matched_dest.extend(dest_by_domain[sc_dom])
            match_type = "domain"
        
        if not matched_dest:
            scored = [(dc, _keyword_score(sc, dc)) for dc in dest_controls]
            scored.sort(key=lambda x: x[1], reverse=True)
            matched_dest = [dc for dc, score in scored if score >= 0.15][:5]
            match_type = "keyword" if matched_dest else "none"
        
        seen_ids = set()
        unique_matched = []
        for dc in matched_dest:
            if dc.id not in seen_ids:
                seen_ids.add(dc.id)
                unique_matched.append(dc)
        
        evidence_recs = []
        if sc.evidence_requirements:
            if isinstance(sc.evidence_requirements, list):
                evidence_recs.extend(sc.evidence_requirements[:3])
            elif isinstance(sc.evidence_requirements, dict):
                evidence_recs.append(sc.evidence_requirements)
        
        for dc in unique_matched[:3]:
            if dc.evidence_requirements:
                if isinstance(dc.evidence_requirements, list):
                    for er in dc.evidence_requirements[:2]:
                        if er not in evidence_recs:
                            evidence_recs.append(er)
        
        row = {
            "source_control": {
                "id": sc.id,
                "reference": sc.original_reference or sc.control_id,
                "title": sc.title,
                "description": sc.description,
                "section": sc.section_number or sc.parent_section,
                "domain": sc.domain,
                "category": sc.category,
                "full_text": sc.full_text,
            },
            "destination_controls": [{
                "id": dc.id,
                "reference": dc.original_reference or dc.control_id,
                "title": dc.title,
                "description": dc.description,
                "section": dc.section_number or dc.parent_section,
                "domain": dc.domain,
                "category": dc.category,
                "full_text": dc.full_text,
            } for dc in unique_matched[:5]],
            "match_count": len(unique_matched),
            "match_type": match_type,
            "evidence_recommendations": evidence_recs[:5]
        }
        crosswalk_rows.append(row)
    
    return {
        "source_framework": {"id": source_fw.id, "name": source_fw.name, "version": source_fw.version},
        "destination_framework": {"id": dest_fw.id, "name": dest_fw.name, "version": dest_fw.version},
        "total": total,
        "skip": skip,
        "limit": limit,
        "crosswalk": crosswalk_rows
    }


@router.post("/crosswalk/ai-map")
def ai_map_crosswalk(
    source_framework_id: int = Query(...),
    destination_framework_id: int = Query(...),
    source_control_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    """Use AI to find the best matching controls in destination framework for a source control."""
    user_tenants = get_user_tenants(current_user, db)

    source_control = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.id == source_control_id,
        ParsedFrameworkControl.uploaded_framework_id == source_framework_id
    ).first()
    if not source_control:
        raise HTTPException(status_code=404, detail="Source control not found for selected source framework")

    framework_scope_filter = or_(
        UploadedFramework.tenant_id.in_(user_tenants),
        UploadedFramework.is_shared == True,
        UploadedFramework.tenant_id.is_(None)
    )
    
    dest_fw = db.query(UploadedFramework).filter(
        UploadedFramework.id == destination_framework_id,
        framework_scope_filter
    ).first()
    if not dest_fw:
        raise HTTPException(status_code=404, detail="Destination framework not found")
    
    dest_controls = db.query(ParsedFrameworkControl).filter(
        ParsedFrameworkControl.uploaded_framework_id == destination_framework_id
    ).all()
    
    dest_list = "\n".join([
        f"- [{dc.original_reference or dc.control_id}] {dc.title}: {(dc.description or '')[:150]}"
        for dc in dest_controls
    ])
    
    try:
        client = get_openai_client()
        prompt = f"""You are a compliance expert. Map this source control to the most relevant controls in the destination framework.

SOURCE CONTROL:
Reference: {source_control.original_reference or source_control.control_id}
Title: {source_control.title}
Description: {source_control.description or ''}
Full Text: {(source_control.full_text or '')[:500]}

DESTINATION FRAMEWORK CONTROLS ({dest_fw.name}):
{dest_list[:6000]}

Find the best matching controls and recommend evidence that satisfies both.

Return JSON:
{{
  "mappings": [
    {{
      "destination_reference": "<reference>",
      "confidence": <0.0-1.0>,
      "rationale": "<why these map>",
      "evidence_recommendations": ["<evidence item 1>", "<evidence item 2>"]
    }}
  ]
}}

Return up to 5 best matches. Only include matches with confidence >= 0.5."""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a regulatory compliance mapping expert. Respond only with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=2000,
            temperature=0.2
        )
        
        result = json.loads(response.choices[0].message.content or '{}')
        
        enriched_mappings = []
        dest_map = {(dc.original_reference or dc.control_id): dc for dc in dest_controls}
        
        for m in result.get("mappings", []):
            dest_ref = m.get("destination_reference", "")
            dest_ctrl = dest_map.get(dest_ref)
            enriched_mappings.append({
                "destination_reference": dest_ref,
                "destination_title": dest_ctrl.title if dest_ctrl else None,
                "destination_description": dest_ctrl.description if dest_ctrl else None,
                "destination_section": (dest_ctrl.section_number or dest_ctrl.parent_section) if dest_ctrl else None,
                "confidence": m.get("confidence", 0),
                "rationale": m.get("rationale", ""),
                "evidence_recommendations": m.get("evidence_recommendations", [])
            })
        
        return {
            "source_control": {
                "reference": source_control.original_reference or source_control.control_id,
                "title": source_control.title,
                "description": source_control.description,
            },
            "ai_mappings": enriched_mappings
        }
    except Exception as e:
        error_msg = str(e)
        if "FREE_CLOUD_BUDGET_EXCEEDED" in error_msg:
            raise HTTPException(status_code=402, detail="Cloud budget exceeded")
        raise HTTPException(status_code=500, detail=f"AI mapping failed: {error_msg}")


# =============================================================================
# AI-driven framework-to-framework comparison (Celery-backed, cached)
# =============================================================================

class AiCompareRunRequest(BaseModel):
    source_framework_id: int
    dest_framework_id: int
    refresh: Optional[bool] = False  # if True, drop existing run before dispatch


def _serialize_run(run: ControlComparisonRun) -> dict:
    return {
        "id": run.id,
        "source_framework_id": run.source_framework_id,
        "dest_framework_id": run.dest_framework_id,
        "status": run.status,
        "progress_total": run.progress_total or 0,
        "progress_done": run.progress_done or 0,
        "progress_percent": (
            int((run.progress_done or 0) * 100 / run.progress_total)
            if run.progress_total else 0
        ),
        "error_message": run.error_message,
        "model_used": run.model_used,
        "task_id": run.task_id,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        "created_at": run.created_at.isoformat() if run.created_at else None,
    }


def _serialize_mappings(run_id: int, db: Session) -> dict:
    """Build the per-source-control map of dest matches for a completed run.

    Returns a list shaped roughly like the keyword-match crosswalk so the
    frontend can render with minimal changes."""
    mappings = (
        db.query(ControlComparisonMapping)
        .filter(ControlComparisonMapping.run_id == run_id)
        .order_by(
            ControlComparisonMapping.source_control_id.asc(),
            ControlComparisonMapping.rank.asc(),
        )
        .all()
    )
    if not mappings:
        return {"items": [], "total": 0}

    src_ids = sorted({m.source_control_id for m in mappings})
    dst_ids = sorted({m.dest_control_id for m in mappings})
    src_lookup = {
        c.id: c
        for c in db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id.in_(src_ids)).all()
    }
    dst_lookup = {
        c.id: c
        for c in db.query(ParsedFrameworkControl).filter(ParsedFrameworkControl.id.in_(dst_ids)).all()
    }

    grouped: dict = {}
    for m in mappings:
        bucket = grouped.setdefault(m.source_control_id, [])
        dst = dst_lookup.get(m.dest_control_id)
        bucket.append({
            "dest_control_id": m.dest_control_id,
            "dest_reference": (dst.original_reference or dst.control_id or "") if dst else "",
            "dest_title": dst.title if dst else "",
            "dest_description": dst.description if dst else "",
            "dest_domain": dst.domain if dst else "",
            "confidence": round(m.confidence or 0.0, 3),
            "rationale": m.rationale or "",
            "evidence_recommendations": m.evidence_recommendations or [],
            "rank": m.rank,
        })

    items = []
    for src_id, dest_list in grouped.items():
        src = src_lookup.get(src_id)
        if not src:
            continue
        items.append({
            "source_control_id": src.id,
            "source_reference": src.original_reference or src.control_id or "",
            "source_title": src.title or "",
            "source_description": src.description or "",
            "source_domain": src.domain or "",
            "destinations": dest_list,
        })
    items.sort(key=lambda x: x["source_reference"] or "")
    return {"items": items, "total": len(items)}


@router.get("/ai-compare/runs")
def ai_compare_list_runs(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """List previously-run AI comparisons for the current tenant.

    Used by the compare page to surface a "previously mapped" history strip.
    Each row carries enough info (framework names, status, mapping count,
    timestamps) for the UI to render a clickable shortcut without extra
    round-trips. Clicking a row in the UI re-uses the existing cached run."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"runs": []}

    runs = (
        db.query(ControlComparisonRun)
        .filter(ControlComparisonRun.tenant_id.in_(user_tenants))
        .order_by(ControlComparisonRun.updated_at.desc().nullslast(),
                  ControlComparisonRun.id.desc())
        .all()
    )
    if not runs:
        return {"runs": []}

    fw_ids = {r.source_framework_id for r in runs} | {r.dest_framework_id for r in runs}
    fw_lookup = {
        fw.id: fw
        for fw in db.query(UploadedFramework).filter(UploadedFramework.id.in_(fw_ids)).all()
    }

    run_ids = [r.id for r in runs]
    mapping_counts = dict(
        db.query(
            ControlComparisonMapping.run_id,
            func.count(ControlComparisonMapping.id),
        )
        .filter(ControlComparisonMapping.run_id.in_(run_ids))
        .group_by(ControlComparisonMapping.run_id)
        .all()
    ) if run_ids else {}

    def _fw_label(fw_id: int) -> dict:
        fw = fw_lookup.get(fw_id)
        if not fw:
            return {"id": fw_id, "name": "Unknown framework", "short_code": None, "version": None}
        return {
            "id": fw.id,
            "name": getattr(fw, "name", None) or "Unknown framework",
            "short_code": getattr(fw, "short_code", None),
            "version": getattr(fw, "version", None),
        }

    out = []
    for r in runs:
        payload = _serialize_run(r)
        payload["source_framework"] = _fw_label(r.source_framework_id)
        payload["destination_framework"] = _fw_label(r.dest_framework_id)
        payload["mapping_count"] = int(mapping_counts.get(r.id, 0))
        out.append(payload)
    return {"runs": out}


@router.get("/ai-compare/lookup")
def ai_compare_lookup(
    source_framework_id: int = Query(...),
    dest_framework_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Check if a comparison run already exists for this (tenant, src, dst) pair.

    Frontend calls this on framework selection. If a completed run is found,
    UI can render results immediately without dispatch."""
    user_tenants = get_user_tenants(current_user, db)
    run = (
        db.query(ControlComparisonRun)
        .filter(
            ControlComparisonRun.tenant_id.in_(user_tenants),
            ControlComparisonRun.source_framework_id == source_framework_id,
            ControlComparisonRun.dest_framework_id == dest_framework_id,
        )
        .order_by(ControlComparisonRun.id.desc())
        .first()
    )
    if not run:
        return {"exists": False}
    return {"exists": True, "run": _serialize_run(run)}


@router.post("/ai-compare/run", status_code=status.HTTP_202_ACCEPTED)
def ai_compare_dispatch(
    body: AiCompareRunRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Dispatch (or return cached) AI cross-framework comparison job.

    * If a completed run exists for (tenant, src, dst) and `refresh` is false,
      return it immediately — caller skips polling.
    * If a run is queued/running, return it; the caller should poll
      `/ai-compare/runs/{id}`.
    * If `refresh=true`, the existing run + mappings are deleted and a fresh
      run is dispatched.
    * Otherwise, create a new run and enqueue the Celery task.
    """
    if not check_ai_available():
        raise_ai_unavailable(fallback_available=True)

    tenant_slug = getattr(http_request.state, "tenant_slug", None)
    if not tenant_slug:
        raise HTTPException(status_code=400, detail="Tenant context required")

    if body.source_framework_id == body.dest_framework_id:
        raise HTTPException(
            status_code=400,
            detail="Source and destination framework must be different",
        )

    user_tenants = get_user_tenants(current_user, db)

    source_fw = db.query(UploadedFramework).filter(
        UploadedFramework.id == body.source_framework_id,
        UploadedFramework.tenant_id.in_(user_tenants),
    ).first()
    dest_fw = db.query(UploadedFramework).filter(
        UploadedFramework.id == body.dest_framework_id,
        UploadedFramework.tenant_id.in_(user_tenants),
    ).first()
    if not source_fw or not dest_fw:
        raise HTTPException(
            status_code=404,
            detail="Source or destination framework not found in this tenant",
        )

    primary_tenant_id = get_user_primary_tenant(current_user, db)

    existing = (
        db.query(ControlComparisonRun)
        .filter(
            ControlComparisonRun.tenant_id.in_(user_tenants),
            ControlComparisonRun.source_framework_id == body.source_framework_id,
            ControlComparisonRun.dest_framework_id == body.dest_framework_id,
        )
        .first()
    )

    if existing and not body.refresh:
        if existing.status in ("queued", "running", "completed"):
            return _serialize_run(existing)
        # status == "failed" -> fall through and re-dispatch

    if existing and (body.refresh or existing.status == "failed"):
        db.delete(existing)
        db.commit()
        existing = None

    from ....tasks.base import tenant_rate_limit, RateLimitExceeded
    try:
        tenant_rate_limit(tenant_slug, bucket="control_compare")
    except RateLimitExceeded:
        raise HTTPException(
            status_code=429,
            detail="Too many comparison runs queued; try again shortly",
        )

    run = ControlComparisonRun(
        tenant_id=primary_tenant_id,
        source_framework_id=body.source_framework_id,
        dest_framework_id=body.dest_framework_id,
        status="queued",
        progress_total=0,
        progress_done=0,
        created_by_id=current_user.id,
        model_used=os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    from ....tasks.control_library import ai_compare_frameworks as _compare_task
    async_result = _compare_task.delay(tenant_slug, run.id)
    run.task_id = async_result.id
    db.commit()
    print(
        f"[DISPATCH] ai_compare -> celery task_id={async_result.id} tenant={tenant_slug} "
        f"run={run.id} source={body.source_framework_id} dest={body.dest_framework_id}",
        flush=True,
    )

    return _serialize_run(run)


@router.get("/ai-compare/runs/{run_id}")
def ai_compare_run_detail(
    run_id: int,
    include_mappings: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Get a comparison run's status. Pass `include_mappings=true` to also
    return the full source-to-dest mapping list (only useful when completed)."""
    user_tenants = get_user_tenants(current_user, db)
    run = (
        db.query(ControlComparisonRun)
        .filter(
            ControlComparisonRun.id == run_id,
            ControlComparisonRun.tenant_id.in_(user_tenants),
        )
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Comparison run not found")

    payload = _serialize_run(run)
    if include_mappings and run.status == "completed":
        payload["mappings"] = _serialize_mappings(run.id, db)
    return payload


@router.get("/ai-compare/runs/{run_id}/mappings")
def ai_compare_run_mappings(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
):
    """Mappings for a completed run. Separate from status so the UI can poll
    cheaply and only fetch the (possibly large) mappings once."""
    user_tenants = get_user_tenants(current_user, db)
    run = (
        db.query(ControlComparisonRun)
        .filter(
            ControlComparisonRun.id == run_id,
            ControlComparisonRun.tenant_id.in_(user_tenants),
        )
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Comparison run not found")
    if run.status != "completed":
        raise HTTPException(
            status_code=409,
            detail=f"Run status is {run.status}; mappings available only when completed",
        )
    return _serialize_mappings(run.id, db)
