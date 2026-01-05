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
    CommonControlGroup, CommonControlGroupMapping, NormalizedControl,
    FrameworkControl, FrameworkDomain, ControlObjective, Framework,
    GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/groups", tags=["Control Library - Groups"])

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")


class CommonControlGroupCreate(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    domain: Optional[str] = None
    keywords: Optional[List[str]] = None
    evidence_types: Optional[List[str]] = None


class CommonControlGroupUpdate(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    domain: Optional[str] = None
    keywords: Optional[List[str]] = None
    evidence_types: Optional[List[str]] = None
    ai_summary: Optional[str] = None


class GroupMappingCreate(BaseModel):
    normalized_control_ids: Optional[List[int]] = []
    framework_control_ids: Optional[List[int]] = []


class AutoGroupRequest(BaseModel):
    framework_ids: Optional[List[int]] = None


class GenerateSummaryRequest(BaseModel):
    regenerate_keywords: bool = True


def check_ai_available() -> bool:
    """Check if OpenAI API is configured (Replit AI Integrations or direct API key)."""
    ai_integration_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
    if ai_integration_key:
        return True
    api_key = os.environ.get("OPENAI_API_KEY")
    if api_key and not api_key.startswith("your-") and len(api_key) >= 20:
        return True
    return False


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


def generate_keywords_for_group(name: str, description: str) -> List[str]:
    try:
        client = get_openai_client()
        prompt = f"""Extract 5-10 key compliance/security terms from this control group:

Name: {name}
Description: {description or 'No description provided'}

Return JSON: {{"keywords": ["term1", "term2", ...]}}"""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "Extract compliance keywords. Respond only with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=500,
            temperature=0.3
        )
        result = json.loads(response.choices[0].message.content or '{"keywords": []}')
        return result.get("keywords", [])
    except Exception:
        return []


def generate_group_summary(controls_text: str) -> dict:
    try:
        client = get_openai_client()
        prompt = f"""Analyze these related compliance controls and generate:
1. A summary describing their common purpose
2. Key terms/keywords that characterize these controls

Controls:
{controls_text[:4000]}

Return JSON:
{{
    "summary": "<2-3 sentence summary of the control group's purpose>",
    "keywords": ["keyword1", "keyword2", ...],
    "evidence_types": ["<suggested evidence types>"]
}}"""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a compliance expert summarizing control groups. Respond only with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=1000,
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
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI summary generation failed: {error_msg}"
        )


def ai_auto_group_controls(controls_list: List[dict]) -> List[dict]:
    try:
        client = get_openai_client()
        controls_text = "\n\n".join([
            f"Control {i+1} (ID: {c['id']}, Type: {c['type']}, Framework: {c.get('framework', 'N/A')}):\nCode: {c['code']}\nName: {c['name']}\nStatement: {c['statement'][:300]}"
            for i, c in enumerate(controls_list[:30])
        ])

        prompt = f"""Analyze these compliance controls and group them by common purpose/theme.
Create logical groups that cluster controls addressing similar requirements.

Controls:
{controls_text}

Return JSON with groups:
{{
    "groups": [
        {{
            "code": "<short code like CCG-001>",
            "name": "<group name>",
            "description": "<group description>",
            "category": "<category like Access Control, Data Protection, etc>",
            "domain": "<domain like Security, Privacy, etc>",
            "keywords": ["keyword1", "keyword2"],
            "control_ids": [
                {{"id": <control_id>, "type": "<normalized|framework>"}}
            ]
        }}
    ]
}}

Create 3-8 meaningful groups based on control similarities."""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a compliance expert grouping related controls. Respond only with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=4000,
            temperature=0.3
        )
        result = json.loads(response.choices[0].message.content or '{"groups": []}')
        return result.get("groups", [])
    except Exception as e:
        error_msg = str(e)
        if "FREE_CLOUD_BUDGET_EXCEEDED" in error_msg:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail="Cloud budget exceeded. Please upgrade your plan."
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"AI auto-grouping failed: {error_msg}"
        )


def serialize_group(group: CommonControlGroup, db: Session, include_controls: bool = False) -> dict:
    normalized_count = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group.id,
        CommonControlGroupMapping.normalized_control_id.isnot(None)
    ).count()
    
    framework_count = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group.id,
        CommonControlGroupMapping.framework_control_id.isnot(None)
    ).count()
    
    result = {
        "id": group.id,
        "tenant_id": group.tenant_id,
        "code": group.code,
        "name": group.name,
        "description": group.description,
        "category": group.category,
        "domain": group.domain,
        "keywords": group.keywords or [],
        "ai_summary": group.ai_summary,
        "evidence_types": group.evidence_types or [],
        "normalized_control_count": normalized_count,
        "framework_control_count": framework_count,
        "total_control_count": normalized_count + framework_count,
        "created_at": group.created_at.isoformat() if group.created_at else None,
        "updated_at": group.updated_at.isoformat() if group.updated_at else None,
        "created_by": group.created_by
    }
    
    if include_controls:
        mappings = db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.group_id == group.id
        ).all()
        
        normalized_controls = []
        framework_controls = []
        
        for mapping in mappings:
            if mapping.normalized_control_id:
                nc = db.query(NormalizedControl).filter(
                    NormalizedControl.id == mapping.normalized_control_id
                ).first()
                if nc:
                    normalized_controls.append({
                        "mapping_id": mapping.id,
                        "control_id": nc.id,
                        "code": nc.code,
                        "name": nc.name,
                        "statement": nc.statement,
                        "mapping_confidence": mapping.mapping_confidence,
                        "mapping_source": mapping.mapping_source
                    })
            
            if mapping.framework_control_id:
                fc = db.query(FrameworkControl).options(
                    joinedload(FrameworkControl.objective).joinedload(ControlObjective.domain).joinedload(FrameworkDomain.framework)
                ).filter(
                    FrameworkControl.id == mapping.framework_control_id
                ).first()
                if fc:
                    framework = fc.objective.domain.framework if fc.objective and fc.objective.domain else None
                    framework_controls.append({
                        "mapping_id": mapping.id,
                        "control_id": fc.id,
                        "code": fc.code,
                        "name": fc.name,
                        "statement": fc.statement,
                        "framework_id": framework.id if framework else None,
                        "framework_name": framework.name if framework else None,
                        "framework_code": framework.short_code if framework else None,
                        "mapping_confidence": mapping.mapping_confidence,
                        "mapping_source": mapping.mapping_source
                    })
        
        result["normalized_controls"] = normalized_controls
        result["framework_controls"] = framework_controls
    
    return result


@router.get("/categories")
def get_categories(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    categories = db.query(distinct(CommonControlGroup.category)).filter(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        ),
        CommonControlGroup.category.isnot(None)
    ).all()
    
    return {"categories": [c[0] for c in categories if c[0]]}


@router.get("/domains")
def get_domains(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    domains = db.query(distinct(CommonControlGroup.domain)).filter(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        ),
        CommonControlGroup.domain.isnot(None)
    ).all()
    
    return {"domains": [d[0] for d in domains if d[0]]}


@router.get("")
def list_groups(
    category: Optional[str] = None,
    domain: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    query = db.query(CommonControlGroup).filter(
        or_(
            CommonControlGroup.tenant_id.in_(user_tenants),
            CommonControlGroup.tenant_id.is_(None)
        )
    )
    
    if category:
        query = query.filter(CommonControlGroup.category == category)
    if domain:
        query = query.filter(CommonControlGroup.domain == domain)
    if search:
        search_term = f"%{search}%"
        query = query.filter(
            or_(
                CommonControlGroup.name.ilike(search_term),
                CommonControlGroup.code.ilike(search_term),
                CommonControlGroup.description.ilike(search_term)
            )
        )
    
    total = query.count()
    groups = query.order_by(CommonControlGroup.code).offset(skip).limit(limit).all()
    
    return {
        "items": [serialize_group(g, db) for g in groups],
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_group(
    group_data: CommonControlGroupCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    
    existing = db.query(CommonControlGroup).filter(
        CommonControlGroup.tenant_id == tenant_id,
        CommonControlGroup.code == group_data.code
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A group with this code already exists"
        )
    
    keywords = group_data.keywords
    if not keywords and group_data.description:
        keywords = generate_keywords_for_group(group_data.name, group_data.description)
    
    group = CommonControlGroup(
        tenant_id=tenant_id,
        code=group_data.code,
        name=group_data.name,
        description=group_data.description,
        category=group_data.category,
        domain=group_data.domain,
        keywords=keywords or [],
        evidence_types=group_data.evidence_types or [],
        created_by=current_user.id
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    
    return serialize_group(group, db)


@router.get("/{group_id}")
def get_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )
    
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this group"
        )
    
    return serialize_group(group, db, include_controls=True)


@router.put("/{group_id}")
def update_group(
    group_id: int,
    group_data: CommonControlGroupUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )
    
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this group"
        )
    
    if group_data.code and group_data.code != group.code:
        existing = db.query(CommonControlGroup).filter(
            CommonControlGroup.tenant_id == group.tenant_id,
            CommonControlGroup.code == group_data.code,
            CommonControlGroup.id != group_id
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A group with this code already exists"
            )
    
    update_data = group_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(group, field, value)
    
    group.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(group)
    
    return serialize_group(group, db, include_controls=True)


@router.delete("/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )
    
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this group"
        )
    
    db.delete(group)
    db.commit()
    return None


@router.post("/{group_id}/controls")
def add_controls_to_group(
    group_id: int,
    mapping_data: GroupMappingCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )
    
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this group"
        )
    
    created_mappings = []
    
    for nc_id in (mapping_data.normalized_control_ids or []):
        nc = db.query(NormalizedControl).filter(NormalizedControl.id == nc_id).first()
        if not nc:
            continue
        
        existing = db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.group_id == group_id,
            CommonControlGroupMapping.normalized_control_id == nc_id
        ).first()
        if existing:
            continue
        
        mapping = CommonControlGroupMapping(
            group_id=group_id,
            normalized_control_id=nc_id,
            mapping_source="manual"
        )
        db.add(mapping)
        created_mappings.append({"type": "normalized", "control_id": nc_id})
    
    for fc_id in (mapping_data.framework_control_ids or []):
        fc = db.query(FrameworkControl).filter(FrameworkControl.id == fc_id).first()
        if not fc:
            continue
        
        existing = db.query(CommonControlGroupMapping).filter(
            CommonControlGroupMapping.group_id == group_id,
            CommonControlGroupMapping.framework_control_id == fc_id
        ).first()
        if existing:
            continue
        
        mapping = CommonControlGroupMapping(
            group_id=group_id,
            framework_control_id=fc_id,
            mapping_source="manual"
        )
        db.add(mapping)
        created_mappings.append({"type": "framework", "control_id": fc_id})
    
    db.commit()
    
    return {
        "message": f"Added {len(created_mappings)} controls to group",
        "mappings_created": created_mappings,
        "group": serialize_group(group, db, include_controls=True)
    }


@router.delete("/{group_id}/controls/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_control_from_group(
    group_id: int,
    mapping_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )
    
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this group"
        )
    
    mapping = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.id == mapping_id,
        CommonControlGroupMapping.group_id == group_id
    ).first()
    
    if not mapping:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mapping not found"
        )
    
    db.delete(mapping)
    db.commit()
    return None


@router.post("/auto-group")
def auto_group_controls(
    request: AutoGroupRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has no tenant assigned"
        )
    
    if not check_ai_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "AI features unavailable",
                "message": "OpenAI API key is not configured. Please add OPENAI_API_KEY to enable AI features, or use manual grouping instead.",
                "fallback_available": True,
                "fallback_suggestion": "Use the manual 'Create Group' feature to organize controls"
            }
        )
    
    controls_list = []
    
    normalized_controls = db.query(NormalizedControl).limit(30).all()
    for nc in normalized_controls:
        controls_list.append({
            "id": nc.id,
            "type": "normalized",
            "code": nc.code,
            "name": nc.name,
            "statement": nc.statement or nc.objective or "",
            "framework": "Normalized"
        })
    
    framework_query = db.query(FrameworkControl).options(
        joinedload(FrameworkControl.objective).joinedload(ControlObjective.domain).joinedload(FrameworkDomain.framework)
    )
    if request.framework_ids:
        framework_query = framework_query.join(ControlObjective).join(FrameworkDomain).filter(
            FrameworkDomain.framework_id.in_(request.framework_ids)
        )
    framework_controls = framework_query.limit(30).all()
    
    for fc in framework_controls:
        framework_name = fc.objective.domain.framework.name if fc.objective and fc.objective.domain and fc.objective.domain.framework else "Unknown"
        controls_list.append({
            "id": fc.id,
            "type": "framework",
            "code": fc.code,
            "name": fc.name,
            "statement": fc.statement or fc.control_objective or "",
            "framework": framework_name
        })
    
    if len(controls_list) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not enough controls to perform auto-grouping"
        )
    
    ai_groups = ai_auto_group_controls(controls_list)
    
    created_groups = []
    for group_data in ai_groups:
        code = group_data.get("code", f"CCG-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}")
        
        existing = db.query(CommonControlGroup).filter(
            CommonControlGroup.tenant_id == tenant_id,
            CommonControlGroup.code == code
        ).first()
        if existing:
            code = f"{code}-{datetime.utcnow().strftime('%f')}"
        
        group = CommonControlGroup(
            tenant_id=tenant_id,
            code=code,
            name=group_data.get("name", "Auto-generated Group"),
            description=group_data.get("description"),
            category=group_data.get("category"),
            domain=group_data.get("domain"),
            keywords=group_data.get("keywords", []),
            created_by=current_user.id
        )
        db.add(group)
        db.flush()
        
        control_ids = group_data.get("control_ids", [])
        for ctrl in control_ids:
            ctrl_id = ctrl.get("id")
            ctrl_type = ctrl.get("type")
            
            if ctrl_type == "normalized":
                mapping = CommonControlGroupMapping(
                    group_id=group.id,
                    normalized_control_id=ctrl_id,
                    mapping_source="ai",
                    mapping_confidence=0.8
                )
            elif ctrl_type == "framework":
                mapping = CommonControlGroupMapping(
                    group_id=group.id,
                    framework_control_id=ctrl_id,
                    mapping_source="ai",
                    mapping_confidence=0.8
                )
            else:
                continue
            db.add(mapping)
        
        created_groups.append(group)
    
    db.commit()
    
    return {
        "message": f"Created {len(created_groups)} control groups",
        "groups": [serialize_group(g, db, include_controls=True) for g in created_groups]
    }


@router.get("/{group_id}/frameworks")
def get_group_frameworks(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )
    
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this group"
        )
    
    mappings = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group_id,
        CommonControlGroupMapping.framework_control_id.isnot(None)
    ).all()
    
    framework_counts = {}
    for mapping in mappings:
        fc = db.query(FrameworkControl).options(
            joinedload(FrameworkControl.objective).joinedload(ControlObjective.domain).joinedload(FrameworkDomain.framework)
        ).filter(FrameworkControl.id == mapping.framework_control_id).first()
        
        if fc and fc.objective and fc.objective.domain and fc.objective.domain.framework:
            fw = fc.objective.domain.framework
            if fw.id not in framework_counts:
                framework_counts[fw.id] = {
                    "framework_id": fw.id,
                    "framework_name": fw.name,
                    "framework_code": fw.short_code,
                    "control_count": 0
                }
            framework_counts[fw.id]["control_count"] += 1
    
    normalized_count = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group_id,
        CommonControlGroupMapping.normalized_control_id.isnot(None)
    ).count()
    
    return {
        "group_id": group_id,
        "group_name": group.name,
        "normalized_control_count": normalized_count,
        "frameworks": list(framework_counts.values())
    }


@router.post("/{group_id}/generate-summary")
def generate_summary(
    group_id: int,
    request: GenerateSummaryRequest = GenerateSummaryRequest(),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if not check_ai_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "AI features unavailable",
                "message": "OpenAI API key is not configured. Please add OPENAI_API_KEY to enable AI-generated summaries.",
                "fallback_available": False
            }
        )
    
    user_tenants = get_user_tenants(current_user, db)
    
    group = db.query(CommonControlGroup).filter(
        CommonControlGroup.id == group_id
    ).first()
    
    if not group:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Group not found"
        )
    
    if group.tenant_id is not None and group.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this group"
        )
    
    mappings = db.query(CommonControlGroupMapping).filter(
        CommonControlGroupMapping.group_id == group_id
    ).all()
    
    controls_text_parts = []
    for mapping in mappings:
        if mapping.normalized_control_id:
            nc = db.query(NormalizedControl).filter(
                NormalizedControl.id == mapping.normalized_control_id
            ).first()
            if nc:
                controls_text_parts.append(f"- {nc.code}: {nc.name}\n  {nc.statement or ''}")
        
        if mapping.framework_control_id:
            fc = db.query(FrameworkControl).filter(
                FrameworkControl.id == mapping.framework_control_id
            ).first()
            if fc:
                controls_text_parts.append(f"- {fc.code}: {fc.name}\n  {fc.statement or ''}")
    
    if not controls_text_parts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Group has no controls to summarize"
        )
    
    controls_text = f"Group: {group.name}\nDescription: {group.description or 'N/A'}\n\nControls:\n" + "\n".join(controls_text_parts)
    
    result = generate_group_summary(controls_text)
    
    group.ai_summary = result.get("summary")
    if request.regenerate_keywords:
        group.keywords = result.get("keywords", group.keywords or [])
    if result.get("evidence_types"):
        group.evidence_types = result.get("evidence_types")
    
    group.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(group)
    
    return serialize_group(group, db, include_controls=True)
