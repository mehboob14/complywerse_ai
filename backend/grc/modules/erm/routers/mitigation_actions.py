from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_

from ....models import (
    Risk, RiskMitigationAction, GRCUser, get_db
)
from ....schemas import (
    RiskMitigationActionCreate, RiskMitigationActionUpdate, RiskMitigationActionResponse,
    MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/mitigation-actions", tags=["ERM - Mitigation Actions"])


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
