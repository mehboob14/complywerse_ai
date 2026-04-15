from typing import List, Optional
import os, json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_
from openai import OpenAI

from ....models import (
    Risk, RiskMitigationAction, GRCUser, InternalControl, get_db
)
from ....schemas import (
    RiskMitigationActionCreate, RiskMitigationActionUpdate, RiskMitigationActionResponse,
    MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/mitigation-actions", tags=["ERM - Mitigation Actions"])


def _get_openai_client() -> OpenAI:
    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    is_modelfarm = base_url and "modelfarm" in base_url
    if not api_key and not is_modelfarm:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenAI API key not configured"
        )
    return OpenAI(api_key=api_key, base_url=base_url)


class AISuggestMitigationsRequest(BaseModel):
    risk_id: Optional[int] = None
    title: Optional[str] = None


class SuggestedMitigation(BaseModel):
    title: str
    description: str
    action_type: str
    priority: str
    expected_residual_reduction: float


class AISuggestMitigationsResponse(BaseModel):
    suggestions: List[SuggestedMitigation]


@router.post("/ai-suggest", response_model=AISuggestMitigationsResponse)
def ai_suggest_mitigations(
    request: AISuggestMitigationsRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if not request.risk_id and not request.title:
        raise HTTPException(status_code=400, detail="Either risk_id or title must be provided")

    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=404, detail="Tenant not found")

    risk = None
    if request.risk_id:
        risk = db.query(Risk).filter(
            Risk.id == request.risk_id,
            Risk.tenant_id.in_(user_tenants)
        ).first()
        if not risk:
            raise HTTPException(status_code=404, detail="Risk not found")

    existing_controls = []
    try:
        controls = db.query(InternalControl).filter(
            InternalControl.tenant_id.in_(user_tenants)
        ).limit(20).all()
        existing_controls = [c.name for c in controls if c.name]
    except Exception:
        pass

    existing_action_titles: list = []
    if risk:
        existing_actions = db.query(RiskMitigationAction).filter(
            RiskMitigationAction.risk_id == risk.id
        ).all()
        existing_action_titles = [a.title for a in existing_actions]

    if risk:
        prompt = f"""You are an enterprise risk management expert. Given the following risk details, suggest 3-5 concrete mitigation actions.

Risk Title: {risk.title}
Risk Description: {risk.description or 'N/A'}
Risk Category: {risk.category or 'N/A'}
Risk Sub-Category: {risk.risk_sub_category or 'N/A'}
Inherent Likelihood: {risk.inherent_likelihood or 'N/A'}
Inherent Impact: {risk.inherent_impact or 'N/A'}
Residual Likelihood: {risk.residual_likelihood or 'N/A'}
Residual Impact: {risk.residual_impact or 'N/A'}
Current Treatment Status: {risk.treatment_status or 'N/A'}
Existing Controls: {', '.join(existing_controls[:10]) if existing_controls else 'None identified'}
Existing Mitigation Actions: {', '.join(existing_action_titles) if existing_action_titles else 'None yet'}

Return a JSON object with a "suggestions" array containing 3-5 mitigation actions. Each suggestion must have:
- "title": concise action title (max 100 chars)
- "description": detailed description of what to do (2-3 sentences)
- "action_type": one of "mitigate", "transfer", "avoid", "accept"
- "priority": one of "critical", "high", "medium", "low"
- "expected_residual_reduction": estimated percentage reduction in residual risk (number 5-50)

Do NOT duplicate existing mitigation actions. Focus on practical, actionable items.
Return ONLY valid JSON, no markdown."""
    else:
        prompt = f"""You are an enterprise risk management expert. Given the following mitigation action title, suggest 3-5 related concrete mitigation actions.

Action Title: {request.title}
Existing Controls: {', '.join(existing_controls[:10]) if existing_controls else 'None identified'}

Return a JSON object with a "suggestions" array containing 3-5 mitigation actions. Each suggestion must have:
- "title": concise action title (max 100 chars)
- "description": detailed description of what to do (2-3 sentences)
- "action_type": one of "mitigate", "transfer", "avoid", "accept"
- "priority": one of "critical", "high", "medium", "low"
- "expected_residual_reduction": estimated percentage reduction in residual risk (number 5-50)

Focus on practical, actionable items related to the given title.
Return ONLY valid JSON, no markdown."""

    try:
        client = _get_openai_client()
        model = os.environ.get("AI_INTEGRATIONS_OPENAI_MODEL", "gpt-4o-mini")
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are an enterprise risk management expert. Return only valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=2000,
        )

        content = response.choices[0].message.content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
            if content.endswith("```"):
                content = content[:-3]
            content = content.strip()

        data = json.loads(content)
        suggestions = data.get("suggestions", data if isinstance(data, list) else [])

        valid_types = {"mitigate", "transfer", "avoid", "accept"}
        valid_priorities = {"critical", "high", "medium", "low"}

        result = []
        for s in suggestions[:5]:
            result.append(SuggestedMitigation(
                title=s.get("title", "Untitled Action")[:100],
                description=s.get("description", ""),
                action_type=s.get("action_type", "mitigate") if s.get("action_type") in valid_types else "mitigate",
                priority=s.get("priority", "medium") if s.get("priority") in valid_priorities else "medium",
                expected_residual_reduction=min(max(float(s.get("expected_residual_reduction", 15)), 1), 100),
            ))

        return AISuggestMitigationsResponse(suggestions=result)

    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse AI response")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI suggestion failed: {str(e)}")


def get_risk_for_user(risk_id: int, db: Session, current_user: GRCUser):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return None
    
    risk = db.query(Risk).filter(
        Risk.id == risk_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    return risk


@router.get("/overdue", response_model=List[RiskMitigationActionResponse])
def list_overdue_actions(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    now = datetime.utcnow()
    
    actions = db.query(RiskMitigationAction).options(
        joinedload(RiskMitigationAction.risk),
        joinedload(RiskMitigationAction.owner)
    ).join(Risk).filter(
        Risk.tenant_id.in_(user_tenants),
        RiskMitigationAction.due_date < now,
        RiskMitigationAction.status.in_(["open", "in_progress"])
    ).order_by(RiskMitigationAction.due_date.asc()).all()
    
    result = []
    for action in actions:
        action_data = RiskMitigationActionResponse.model_validate(action)
        if action.owner:
            action_data.owner_name = action.owner.display_name
        result.append(action_data)
    
    return result


@router.get("/{action_id}", response_model=RiskMitigationActionResponse)
def get_action(
    action_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mitigation action not found"
        )
    
    action = db.query(RiskMitigationAction).options(
        joinedload(RiskMitigationAction.owner)
    ).join(Risk).filter(
        RiskMitigationAction.id == action_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not action:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mitigation action not found"
        )
    
    action_data = RiskMitigationActionResponse.model_validate(action)
    if action.owner:
        action_data.owner_name = action.owner.display_name
    return action_data


@router.put("/{action_id}", response_model=RiskMitigationActionResponse)
def update_action(
    action_id: int,
    action_update: RiskMitigationActionUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mitigation action not found"
        )
    
    action = db.query(RiskMitigationAction).join(Risk).filter(
        RiskMitigationAction.id == action_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not action:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mitigation action not found"
        )
    
    update_data = action_update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(action, key, value)
    
    action.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(action)
    
    action_data = RiskMitigationActionResponse.model_validate(action)
    if action.owner:
        action_data.owner_name = action.owner.display_name
    return action_data


@router.delete("/{action_id}", response_model=MessageResponse)
def delete_action(
    action_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mitigation action not found"
        )
    
    action = db.query(RiskMitigationAction).join(Risk).filter(
        RiskMitigationAction.id == action_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not action:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mitigation action not found"
        )
    
    db.delete(action)
    db.commit()
    return {"message": "Mitigation action deleted successfully", "id": action_id}


@router.post("/{action_id}/complete", response_model=RiskMitigationActionResponse)
def complete_action(
    action_id: int,
    actual_reduction: Optional[float] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mitigation action not found"
        )
    
    action = db.query(RiskMitigationAction).join(Risk).filter(
        RiskMitigationAction.id == action_id,
        Risk.tenant_id.in_(user_tenants)
    ).first()
    
    if not action:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mitigation action not found"
        )
    
    action.status = "completed"
    action.completed_at = datetime.utcnow()
    if actual_reduction is not None:
        action.actual_residual_reduction = actual_reduction
    action.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(action)
    
    action_data = RiskMitigationActionResponse.model_validate(action)
    if action.owner:
        action_data.owner_name = action.owner.display_name
    return action_data


risk_actions_router = APIRouter(prefix="/risks", tags=["ERM - Risk Mitigation Actions"])


@risk_actions_router.get("/{risk_id}/mitigation-actions", response_model=List[RiskMitigationActionResponse])
def list_risk_actions(
    risk_id: int,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    risk = get_risk_for_user(risk_id, db, current_user)
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    query = db.query(RiskMitigationAction).options(
        joinedload(RiskMitigationAction.owner)
    ).filter(RiskMitigationAction.risk_id == risk_id)
    
    if status_filter:
        query = query.filter(RiskMitigationAction.status == status_filter)
    
    actions = query.order_by(RiskMitigationAction.due_date.asc()).all()
    
    result = []
    for action in actions:
        action_data = RiskMitigationActionResponse.model_validate(action)
        if action.owner:
            action_data.owner_name = action.owner.display_name
        result.append(action_data)
    
    return result


@risk_actions_router.post("/{risk_id}/mitigation-actions", response_model=RiskMitigationActionResponse, status_code=status.HTTP_201_CREATED)
def create_risk_action(
    risk_id: int,
    action: RiskMitigationActionCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    risk = get_risk_for_user(risk_id, db, current_user)
    if not risk:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Risk not found"
        )
    
    db_action = RiskMitigationAction(
        risk_id=risk_id,
        title=action.title,
        description=action.description,
        action_type=action.action_type,
        priority=action.priority,
        owner_id=action.owner_id,
        due_date=action.due_date,
        expected_residual_reduction=action.expected_residual_reduction,
        notes=action.notes
    )
    db.add(db_action)
    db.commit()
    db.refresh(db_action)
    
    return RiskMitigationActionResponse.model_validate(db_action)
