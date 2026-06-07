from ....config import get_openai_api_key
import os
import json
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import or_
from pydantic import BaseModel, Field
from openai import OpenAI

from ....models import (
    ControlInheritance, NormalizedControl, FrameworkControl,
    FrameworkDomain, ControlObjective, Framework,
    GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/inheritance", tags=["Control Library - Inheritance"])

AI_INTEGRATIONS_OPENAI_API_KEY = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY")
AI_INTEGRATIONS_OPENAI_BASE_URL = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")


class ControlInheritanceCreate(BaseModel):
    parent_type: str = Field(..., pattern="^(normalized|framework)$")
    parent_control_id: int
    child_type: str = Field(..., pattern="^(normalized|framework)$")
    child_control_id: int
    inheritance_type: str = Field(..., pattern="^(full|partial|conditional)$")
    condition_description: Optional[str] = None
    coverage_percentage: int = Field(100, ge=0, le=100)


class ControlInheritanceUpdate(BaseModel):
    inheritance_type: Optional[str] = Field(None, pattern="^(full|partial|conditional)$")
    condition_description: Optional[str] = None
    coverage_percentage: Optional[int] = Field(None, ge=0, le=100)


class ControlInheritanceResponse(BaseModel):
    id: int
    tenant_id: int
    parent_type: str
    parent_control_id: int
    child_type: str
    child_control_id: int
    inheritance_type: str
    condition_description: Optional[str]
    coverage_percentage: int
    created_at: str
    created_by: Optional[int]
    parent_control: Optional[dict] = None
    child_control: Optional[dict] = None

    class Config:
        from_attributes = True


class InheritanceTreeNode(BaseModel):
    control_type: str
    control_id: int
    control_code: str
    control_name: str
    inheritance_type: Optional[str] = None
    coverage_percentage: Optional[int] = None
    condition_description: Optional[str] = None
    ancestors: List["InheritanceTreeNode"] = []
    descendants: List["InheritanceTreeNode"] = []

    class Config:
        from_attributes = True


class AnalyzeInheritanceRequest(BaseModel):
    control_type: str = Field(..., pattern="^(normalized|framework)$")
    control_id: int


class InheritanceSuggestion(BaseModel):
    related_control_type: str
    related_control_id: int
    related_control_code: str
    related_control_name: str
    direction: str
    inheritance_type: str
    coverage_percentage: int
    reasoning: str


InheritanceTreeNode.model_rebuild()


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
                "framework_name": framework.name if framework else None,
                "framework_code": framework.short_code if framework else None
            }
    return None


def validate_control_exists(control_type: str, control_id: int, db: Session) -> bool:
    if control_type == "normalized":
        return db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first() is not None
    elif control_type == "framework":
        return db.query(FrameworkControl).filter(FrameworkControl.id == control_id).first() is not None
    return False


def serialize_inheritance(inheritance: ControlInheritance, db: Session) -> dict:
    parent_control = get_control_details(inheritance.parent_type, inheritance.parent_control_id, db)
    child_control = get_control_details(inheritance.child_type, inheritance.child_control_id, db)
    
    return {
        "id": inheritance.id,
        "tenant_id": inheritance.tenant_id,
        "parent_type": inheritance.parent_type,
        "parent_control_id": inheritance.parent_control_id,
        "child_type": inheritance.child_type,
        "child_control_id": inheritance.child_control_id,
        "inheritance_type": inheritance.inheritance_type,
        "condition_description": inheritance.condition_description,
        "coverage_percentage": inheritance.coverage_percentage,
        "created_at": inheritance.created_at.isoformat() if inheritance.created_at else "",
        "created_by": inheritance.created_by,
        "parent_control": parent_control,
        "child_control": child_control
    }


def get_control_text(control_type: str, control_id: int, db: Session) -> Optional[str]:
    if control_type == "normalized":
        control = db.query(NormalizedControl).filter(NormalizedControl.id == control_id).first()
        if control:
            return f"Code: {control.code}\nName: {control.name}\nStatement: {control.statement or ''}\nObjective: {control.objective or ''}"
    elif control_type == "framework":
        control = db.query(FrameworkControl).filter(FrameworkControl.id == control_id).first()
        if control:
            objective = control.objective
            domain = objective.domain if objective else None
            framework = domain.framework if domain else None
            fw_name = framework.name if framework else "Unknown"
            return f"Framework: {fw_name}\nCode: {control.code}\nName: {control.name}\nStatement: {control.statement or ''}\nObjective: {control.control_objective or ''}"
    return None


@router.get("")
def list_inheritance_relationships(
    parent_type: Optional[str] = Query(None, pattern="^(normalized|framework)$"),
    parent_id: Optional[int] = None,
    child_type: Optional[str] = Query(None, pattern="^(normalized|framework)$"),
    inheritance_type: Optional[str] = Query(None, pattern="^(full|partial|conditional)$"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    query = db.query(ControlInheritance).filter(
        ControlInheritance.tenant_id.in_(user_tenants)
    )
    
    if parent_type:
        query = query.filter(ControlInheritance.parent_type == parent_type)
    if parent_id:
        query = query.filter(ControlInheritance.parent_control_id == parent_id)
    if child_type:
        query = query.filter(ControlInheritance.child_type == child_type)
    if inheritance_type:
        query = query.filter(ControlInheritance.inheritance_type == inheritance_type)
    
    total = query.count()
    inheritances = query.order_by(ControlInheritance.created_at.desc()).offset(skip).limit(limit).all()
    
    return {
        "total": total,
        "skip": skip,
        "limit": limit,
        "items": [serialize_inheritance(i, db) for i in inheritances]
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_inheritance_relationship(
    request: ControlInheritanceCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    primary_tenant = get_user_primary_tenant(current_user, db)
    if not primary_tenant:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User has no associated tenant"
        )
    
    if not validate_control_exists(request.parent_type, request.parent_control_id, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Parent control not found: {request.parent_type} ID {request.parent_control_id}"
        )
    
    if not validate_control_exists(request.child_type, request.child_control_id, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Child control not found: {request.child_type} ID {request.child_control_id}"
        )
    
    if request.parent_type == request.child_type and request.parent_control_id == request.child_control_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A control cannot inherit from itself"
        )
    
    existing = db.query(ControlInheritance).filter(
        ControlInheritance.tenant_id == primary_tenant,
        ControlInheritance.parent_type == request.parent_type,
        ControlInheritance.parent_control_id == request.parent_control_id,
        ControlInheritance.child_type == request.child_type,
        ControlInheritance.child_control_id == request.child_control_id
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This inheritance relationship already exists"
        )
    
    inheritance = ControlInheritance(
        tenant_id=primary_tenant,
        parent_type=request.parent_type,
        parent_control_id=request.parent_control_id,
        child_type=request.child_type,
        child_control_id=request.child_control_id,
        inheritance_type=request.inheritance_type,
        condition_description=request.condition_description,
        coverage_percentage=request.coverage_percentage,
        created_by=current_user.id
    )
    
    db.add(inheritance)
    db.commit()
    db.refresh(inheritance)
    
    return serialize_inheritance(inheritance, db)


@router.get("/{inheritance_id}")
def get_inheritance_relationship(
    inheritance_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    inheritance = db.query(ControlInheritance).filter(
        ControlInheritance.id == inheritance_id,
        ControlInheritance.tenant_id.in_(user_tenants)
    ).first()
    
    if not inheritance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inheritance relationship not found"
        )
    
    return serialize_inheritance(inheritance, db)


@router.put("/{inheritance_id}")
def update_inheritance_relationship(
    inheritance_id: int,
    request: ControlInheritanceUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    inheritance = db.query(ControlInheritance).filter(
        ControlInheritance.id == inheritance_id,
        ControlInheritance.tenant_id.in_(user_tenants)
    ).first()
    
    if not inheritance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inheritance relationship not found"
        )
    
    if request.inheritance_type is not None:
        inheritance.inheritance_type = request.inheritance_type
    if request.condition_description is not None:
        inheritance.condition_description = request.condition_description
    if request.coverage_percentage is not None:
        inheritance.coverage_percentage = request.coverage_percentage
    
    db.commit()
    db.refresh(inheritance)
    
    return serialize_inheritance(inheritance, db)


@router.delete("/{inheritance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_inheritance_relationship(
    inheritance_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    inheritance = db.query(ControlInheritance).filter(
        ControlInheritance.id == inheritance_id,
        ControlInheritance.tenant_id.in_(user_tenants)
    ).first()
    
    if not inheritance:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Inheritance relationship not found"
        )
    
    db.delete(inheritance)
    db.commit()
    
    return None


@router.get("/parent/{control_type}/{control_id}")
def get_inherited_controls(
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
    
    if not validate_control_exists(control_type, control_id, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Control not found: {control_type} ID {control_id}"
        )
    
    inheritances = db.query(ControlInheritance).filter(
        ControlInheritance.tenant_id.in_(user_tenants),
        ControlInheritance.parent_type == control_type,
        ControlInheritance.parent_control_id == control_id
    ).all()
    
    result = []
    for inh in inheritances:
        child_details = get_control_details(inh.child_type, inh.child_control_id, db)
        if child_details:
            result.append({
                "inheritance_id": inh.id,
                "inheritance_type": inh.inheritance_type,
                "coverage_percentage": inh.coverage_percentage,
                "condition_description": inh.condition_description,
                "control": child_details
            })
    
    parent_details = get_control_details(control_type, control_id, db)
    
    return {
        "parent_control": parent_details,
        "inherited_controls": result,
        "count": len(result)
    }


@router.get("/child/{control_type}/{control_id}")
def get_satisfying_controls(
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
    
    if not validate_control_exists(control_type, control_id, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Control not found: {control_type} ID {control_id}"
        )
    
    inheritances = db.query(ControlInheritance).filter(
        ControlInheritance.tenant_id.in_(user_tenants),
        ControlInheritance.child_type == control_type,
        ControlInheritance.child_control_id == control_id
    ).all()
    
    result = []
    for inh in inheritances:
        parent_details = get_control_details(inh.parent_type, inh.parent_control_id, db)
        if parent_details:
            result.append({
                "inheritance_id": inh.id,
                "inheritance_type": inh.inheritance_type,
                "coverage_percentage": inh.coverage_percentage,
                "condition_description": inh.condition_description,
                "control": parent_details
            })
    
    child_details = get_control_details(control_type, control_id, db)
    
    return {
        "child_control": child_details,
        "satisfying_controls": result,
        "count": len(result)
    }


@router.post("/analyze-inheritance")
def analyze_inheritance(
    request: AnalyzeInheritanceRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if not check_ai_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "error": "AI features unavailable",
                "message": "OpenAI API key is not configured. Please add OPENAI_API_KEY to enable AI-powered inheritance analysis.",
                "fallback_available": True,
                "fallback_suggestion": "Create inheritance relationships manually using the 'Create Inheritance' feature"
            }
        )
    
    user_tenants = get_user_tenants(current_user, db)
    
    if not validate_control_exists(request.control_type, request.control_id, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Control not found: {request.control_type} ID {request.control_id}"
        )
    
    target_control_text = get_control_text(request.control_type, request.control_id, db)
    target_control_details = get_control_details(request.control_type, request.control_id, db)
    
    normalized_controls = db.query(NormalizedControl).limit(30).all()
    framework_controls = db.query(FrameworkControl).limit(30).all()
    
    controls_list = []
    for nc in normalized_controls:
        if not (request.control_type == "normalized" and nc.id == request.control_id):
            controls_list.append({
                "id": nc.id,
                "type": "normalized",
                "code": nc.code,
                "name": nc.name,
                "statement": nc.statement or ""
            })
    
    for fc in framework_controls:
        if not (request.control_type == "framework" and fc.id == request.control_id):
            objective = fc.objective
            domain = objective.domain if objective else None
            framework = domain.framework if domain else None
            controls_list.append({
                "id": fc.id,
                "type": "framework",
                "code": fc.code,
                "name": fc.name,
                "statement": fc.statement or "",
                "framework": framework.name if framework else "Unknown"
            })
    
    controls_text = "\n\n".join([
        f"Control {i+1} (ID: {c['id']}, Type: {c['type']}):\nCode: {c['code']}\nName: {c['name']}\nStatement: {c['statement'][:300]}"
        for i, c in enumerate(controls_list[:25])
    ])
    
    try:
        client = get_openai_client()
        
        prompt = f"""Analyze the inheritance relationships for this target control and identify which controls from the list could have inheritance relationships with it.

TARGET CONTROL:
{target_control_text}

OTHER CONTROLS:
{controls_text}

For each potential inheritance relationship, identify:
1. Direction: "parent" (if the other control satisfies the target) or "child" (if satisfying target would satisfy the other control)
2. Inheritance type: "full" (100% coverage), "partial" (some coverage), or "conditional" (depends on conditions)
3. Coverage percentage estimate

Return JSON:
{{
    "suggestions": [
        {{
            "related_control_id": <id>,
            "related_control_type": "<normalized|framework>",
            "direction": "<parent|child>",
            "inheritance_type": "<full|partial|conditional>",
            "coverage_percentage": <0-100>,
            "reasoning": "<brief explanation>"
        }}
    ]
}}

Only include controls with meaningful inheritance relationships (coverage >= 30%)."""

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": "You are a compliance expert analyzing control inheritance relationships. Respond only with valid JSON."
                },
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            max_tokens=2000,
            temperature=0.3
        )
        
        result_text = response.choices[0].message.content or '{"suggestions": []}'
        result = json.loads(result_text)
        suggestions_raw = result.get("suggestions", [])
        
        suggestions = []
        for s in suggestions_raw:
            ctrl_type = s.get("related_control_type")
            ctrl_id = s.get("related_control_id")
            if ctrl_type and ctrl_id:
                ctrl_details = get_control_details(ctrl_type, ctrl_id, db)
                if ctrl_details:
                    suggestions.append({
                        "related_control_type": ctrl_type,
                        "related_control_id": ctrl_id,
                        "related_control_code": ctrl_details.get("code", ""),
                        "related_control_name": ctrl_details.get("name", ""),
                        "direction": s.get("direction", "child"),
                        "inheritance_type": s.get("inheritance_type", "partial"),
                        "coverage_percentage": s.get("coverage_percentage", 50),
                        "reasoning": s.get("reasoning", "")
                    })
        
        return {
            "target_control": target_control_details,
            "suggestions": suggestions,
            "count": len(suggestions)
        }
        
    except json.JSONDecodeError:
        return {
            "target_control": target_control_details,
            "suggestions": [],
            "count": 0,
            "error": "Failed to parse AI response"
        }
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
            detail=f"AI analysis failed: {error_msg}"
        )


def build_inheritance_tree(
    control_type: str,
    control_id: int,
    db: Session,
    user_tenants: List[int],
    visited_ancestors: set = None,
    visited_descendants: set = None,
    depth: int = 0,
    max_depth: int = 5
) -> Optional[dict]:
    if depth > max_depth:
        return None
    
    if visited_ancestors is None:
        visited_ancestors = set()
    if visited_descendants is None:
        visited_descendants = set()
    
    control_key = f"{control_type}:{control_id}"
    
    control_details = get_control_details(control_type, control_id, db)
    if not control_details:
        return None
    
    node = {
        "control_type": control_type,
        "control_id": control_id,
        "control_code": control_details.get("code", ""),
        "control_name": control_details.get("name", ""),
        "inheritance_type": None,
        "coverage_percentage": None,
        "condition_description": None,
        "ancestors": [],
        "descendants": []
    }
    
    if control_key not in visited_ancestors:
        visited_ancestors.add(control_key)
        parent_inheritances = db.query(ControlInheritance).filter(
            ControlInheritance.tenant_id.in_(user_tenants),
            ControlInheritance.child_type == control_type,
            ControlInheritance.child_control_id == control_id
        ).all()
        
        for inh in parent_inheritances:
            parent_key = f"{inh.parent_type}:{inh.parent_control_id}"
            if parent_key not in visited_ancestors:
                parent_node = build_inheritance_tree(
                    inh.parent_type,
                    inh.parent_control_id,
                    db,
                    user_tenants,
                    visited_ancestors.copy(),
                    set(),
                    depth + 1,
                    max_depth
                )
                if parent_node:
                    parent_node["inheritance_type"] = inh.inheritance_type
                    parent_node["coverage_percentage"] = inh.coverage_percentage
                    parent_node["condition_description"] = inh.condition_description
                    node["ancestors"].append(parent_node)
    
    if control_key not in visited_descendants:
        visited_descendants.add(control_key)
        child_inheritances = db.query(ControlInheritance).filter(
            ControlInheritance.tenant_id.in_(user_tenants),
            ControlInheritance.parent_type == control_type,
            ControlInheritance.parent_control_id == control_id
        ).all()
        
        for inh in child_inheritances:
            child_key = f"{inh.child_type}:{inh.child_control_id}"
            if child_key not in visited_descendants:
                child_node = build_inheritance_tree(
                    inh.child_type,
                    inh.child_control_id,
                    db,
                    user_tenants,
                    set(),
                    visited_descendants.copy(),
                    depth + 1,
                    max_depth
                )
                if child_node:
                    child_node["inheritance_type"] = inh.inheritance_type
                    child_node["coverage_percentage"] = inh.coverage_percentage
                    child_node["condition_description"] = inh.condition_description
                    node["descendants"].append(child_node)
    
    return node


@router.get("/tree/{control_type}/{control_id}")
def get_inheritance_tree(
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
    
    if not validate_control_exists(control_type, control_id, db):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Control not found: {control_type} ID {control_id}"
        )
    
    tree = build_inheritance_tree(control_type, control_id, db, user_tenants)
    
    return {
        "tree": tree,
        "total_ancestors": count_tree_nodes(tree.get("ancestors", [])) if tree else 0,
        "total_descendants": count_tree_nodes(tree.get("descendants", [])) if tree else 0
    }


def count_tree_nodes(nodes: List[dict]) -> int:
    count = len(nodes)
    for node in nodes:
        count += count_tree_nodes(node.get("ancestors", []))
        count += count_tree_nodes(node.get("descendants", []))
    return count
