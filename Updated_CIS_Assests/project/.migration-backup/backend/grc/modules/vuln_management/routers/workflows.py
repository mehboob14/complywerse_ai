from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func

from ....models import (
    GRCVulnWorkflowTemplate, GRCVulnWorkflowState, GRCVulnWorkflowTransition,
    GRCVulnWorkflowEscalation, GRCVulnWorkflowHistory, Vulnerability,
    GRCDepartment, GRCUser, get_db
)
from ....schemas import (
    GRCVulnWorkflowTemplateCreate, GRCVulnWorkflowTemplateUpdate,
    GRCVulnWorkflowTemplateResponse, GRCVulnWorkflowTemplateDetailResponse,
    GRCVulnWorkflowStateCreate, GRCVulnWorkflowStateUpdate, GRCVulnWorkflowStateResponse,
    GRCVulnWorkflowTransitionCreate, GRCVulnWorkflowTransitionUpdate, GRCVulnWorkflowTransitionResponse,
    GRCVulnWorkflowEscalationCreate, GRCVulnWorkflowEscalationUpdate, GRCVulnWorkflowEscalationResponse,
    GRCVulnWorkflowHistoryResponse, VulnWorkflowTransitionRequest, VulnAvailableTransitionResponse,
    MessageResponse
)
from ....routers.auth_router import require_auth, get_user_tenants, get_user_primary_tenant
from ..services.email_service import EmailService
import logging

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Vulnerability Workflows"])


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def get_template_or_404(template_id: int, user_tenants: List[int], db: Session) -> GRCVulnWorkflowTemplate:
    template = db.query(GRCVulnWorkflowTemplate).filter(
        GRCVulnWorkflowTemplate.id == template_id,
        GRCVulnWorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Workflow template not found")
    return template


@router.get("/workflows", response_model=List[GRCVulnWorkflowTemplateResponse])
def list_workflow_templates(
    tenant_id: Optional[int] = None,
    is_active: Optional[bool] = None,
    is_default: Optional[bool] = None,
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []
    
    query = db.query(GRCVulnWorkflowTemplate).filter(
        GRCVulnWorkflowTemplate.tenant_id.in_(user_tenants)
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GRCVulnWorkflowTemplate.tenant_id == tenant_id)
    if is_active is not None:
        query = query.filter(GRCVulnWorkflowTemplate.is_active == is_active)
    if is_default is not None:
        query = query.filter(GRCVulnWorkflowTemplate.is_default == is_default)
    if search:
        query = query.filter(GRCVulnWorkflowTemplate.name.ilike(f"%{search}%"))
    
    templates = query.order_by(GRCVulnWorkflowTemplate.name).offset(skip).limit(limit).all()
    
    result = []
    for t in templates:
        state_count = db.query(func.count(GRCVulnWorkflowState.id)).filter(
            GRCVulnWorkflowState.template_id == t.id
        ).scalar() or 0
        transition_count = db.query(func.count(GRCVulnWorkflowTransition.id)).filter(
            GRCVulnWorkflowTransition.template_id == t.id
        ).scalar() or 0
        escalation_count = db.query(func.count(GRCVulnWorkflowEscalation.id)).filter(
            GRCVulnWorkflowEscalation.template_id == t.id
        ).scalar() or 0
        
        result.append(GRCVulnWorkflowTemplateResponse(
            id=t.id,
            tenant_id=t.tenant_id,
            name=t.name,
            description=t.description,
            is_default=t.is_default,
            is_active=t.is_active,
            created_by=t.created_by,
            creator_name=t.creator.display_name if t.creator else None,
            created_at=t.created_at,
            updated_at=t.updated_at,
            state_count=state_count,
            transition_count=transition_count,
            escalation_count=escalation_count
        ))
    
    return result


@router.post("/workflows", response_model=GRCVulnWorkflowTemplateResponse, status_code=status.HTTP_201_CREATED)
def create_workflow_template(
    request: GRCVulnWorkflowTemplateCreate,
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
    else:
        tenant_id = get_user_primary_tenant(current_user, db) or user_tenants[0]
    
    if request.is_default:
        db.query(GRCVulnWorkflowTemplate).filter(
            GRCVulnWorkflowTemplate.tenant_id == tenant_id,
            GRCVulnWorkflowTemplate.is_default == True
        ).update({"is_default": False})
    
    template = GRCVulnWorkflowTemplate(
        tenant_id=tenant_id,
        name=request.name,
        description=request.description,
        is_default=request.is_default,
        is_active=request.is_active,
        created_by=current_user.id
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    
    return GRCVulnWorkflowTemplateResponse(
        id=template.id,
        tenant_id=template.tenant_id,
        name=template.name,
        description=template.description,
        is_default=template.is_default,
        is_active=template.is_active,
        created_by=template.created_by,
        creator_name=current_user.display_name,
        created_at=template.created_at,
        updated_at=template.updated_at,
        state_count=0,
        transition_count=0,
        escalation_count=0
    )


@router.get("/workflows/{template_id}", response_model=GRCVulnWorkflowTemplateDetailResponse)
def get_workflow_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        raise HTTPException(status_code=403, detail="User not associated with any tenant")
    
    template = db.query(GRCVulnWorkflowTemplate).options(
        joinedload(GRCVulnWorkflowTemplate.creator),
        joinedload(GRCVulnWorkflowTemplate.states).joinedload(GRCVulnWorkflowState.auto_assign_team),
        joinedload(GRCVulnWorkflowTemplate.transitions).joinedload(GRCVulnWorkflowTransition.from_state),
        joinedload(GRCVulnWorkflowTemplate.transitions).joinedload(GRCVulnWorkflowTransition.to_state),
        joinedload(GRCVulnWorkflowTemplate.escalations).joinedload(GRCVulnWorkflowEscalation.escalate_to_team),
        joinedload(GRCVulnWorkflowTemplate.escalations).joinedload(GRCVulnWorkflowEscalation.auto_transition_to_state)
    ).filter(
        GRCVulnWorkflowTemplate.id == template_id,
        GRCVulnWorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not template:
        raise HTTPException(status_code=404, detail="Workflow template not found")
    
    states = [
        GRCVulnWorkflowStateResponse(
            id=s.id,
            template_id=s.template_id,
            name=s.name,
            state_type=s.state_type,
            order_index=s.order_index,
            color=s.color,
            requires_approval=s.requires_approval,
            requires_evidence=s.requires_evidence,
            auto_assign_team_id=s.auto_assign_team_id,
            auto_assign_team_name=s.auto_assign_team.name if s.auto_assign_team else None,
            sla_multiplier=s.sla_multiplier,
            is_terminal=s.is_terminal
        )
        for s in sorted(template.states, key=lambda x: x.order_index)
    ]
    
    transitions = [
        GRCVulnWorkflowTransitionResponse(
            id=t.id,
            template_id=t.template_id,
            from_state_id=t.from_state_id,
            to_state_id=t.to_state_id,
            name=t.name,
            requires_comment=t.requires_comment,
            requires_approval=t.requires_approval,
            approver_role=t.approver_role,
            allowed_roles=t.allowed_roles or [],
            trigger_notification=t.trigger_notification,
            from_state_name=t.from_state.name if t.from_state else None,
            to_state_name=t.to_state.name if t.to_state else None
        )
        for t in template.transitions
    ]
    
    escalations = [
        GRCVulnWorkflowEscalationResponse(
            id=e.id,
            template_id=e.template_id,
            name=e.name,
            trigger_type=e.trigger_type,
            trigger_value=e.trigger_value,
            escalate_to_team_id=e.escalate_to_team_id,
            escalate_to_team_name=e.escalate_to_team.name if e.escalate_to_team else None,
            escalate_to_role=e.escalate_to_role,
            auto_transition_to_state_id=e.auto_transition_to_state_id,
            auto_transition_to_state_name=e.auto_transition_to_state.name if e.auto_transition_to_state else None,
            notification_type=e.notification_type,
            is_active=e.is_active
        )
        for e in template.escalations
    ]
    
    return GRCVulnWorkflowTemplateDetailResponse(
        id=template.id,
        tenant_id=template.tenant_id,
        name=template.name,
        description=template.description,
        is_default=template.is_default,
        is_active=template.is_active,
        created_by=template.created_by,
        creator_name=template.creator.display_name if template.creator else None,
        created_at=template.created_at,
        updated_at=template.updated_at,
        states=states,
        transitions=transitions,
        escalations=escalations
    )


@router.put("/workflows/{template_id}", response_model=GRCVulnWorkflowTemplateResponse)
def update_workflow_template(
    template_id: int,
    request: GRCVulnWorkflowTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    template = get_template_or_404(template_id, user_tenants, db)
    
    update_data = request.model_dump(exclude_unset=True)
    
    if update_data.get("is_default") == True:
        db.query(GRCVulnWorkflowTemplate).filter(
            GRCVulnWorkflowTemplate.tenant_id == template.tenant_id,
            GRCVulnWorkflowTemplate.is_default == True,
            GRCVulnWorkflowTemplate.id != template_id
        ).update({"is_default": False})
    
    for field, value in update_data.items():
        setattr(template, field, value)
    
    template.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(template)
    
    state_count = db.query(func.count(GRCVulnWorkflowState.id)).filter(
        GRCVulnWorkflowState.template_id == template.id
    ).scalar() or 0
    transition_count = db.query(func.count(GRCVulnWorkflowTransition.id)).filter(
        GRCVulnWorkflowTransition.template_id == template.id
    ).scalar() or 0
    escalation_count = db.query(func.count(GRCVulnWorkflowEscalation.id)).filter(
        GRCVulnWorkflowEscalation.template_id == template.id
    ).scalar() or 0
    
    return GRCVulnWorkflowTemplateResponse(
        id=template.id,
        tenant_id=template.tenant_id,
        name=template.name,
        description=template.description,
        is_default=template.is_default,
        is_active=template.is_active,
        created_by=template.created_by,
        creator_name=template.creator.display_name if template.creator else None,
        created_at=template.created_at,
        updated_at=template.updated_at,
        state_count=state_count,
        transition_count=transition_count,
        escalation_count=escalation_count
    )


@router.delete("/workflows/{template_id}", response_model=MessageResponse)
def delete_workflow_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    template = get_template_or_404(template_id, user_tenants, db)
    
    template.is_active = False
    template.updated_at = datetime.utcnow()
    db.commit()
    
    return MessageResponse(message="Workflow template deleted successfully", id=template_id)


@router.post("/workflows/{template_id}/states", response_model=GRCVulnWorkflowStateResponse, status_code=status.HTTP_201_CREATED)
def add_workflow_state(
    template_id: int,
    request: GRCVulnWorkflowStateCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    template = get_template_or_404(template_id, user_tenants, db)
    
    state = GRCVulnWorkflowState(
        template_id=template_id,
        name=request.name,
        state_type=request.state_type,
        order_index=request.order_index,
        color=request.color,
        requires_approval=request.requires_approval,
        requires_evidence=request.requires_evidence,
        auto_assign_department_id=request.auto_assign_department_id,
        sla_multiplier=request.sla_multiplier,
        is_terminal=request.is_terminal
    )
    db.add(state)
    db.commit()
    db.refresh(state)
    
    dept_name = None
    if state.auto_assign_department_id:
        dept = db.query(GRCDepartment).filter(GRCDepartment.id == state.auto_assign_department_id).first()
        dept_name = dept.name if dept else None
    
    return GRCVulnWorkflowStateResponse(
        id=state.id,
        template_id=state.template_id,
        name=state.name,
        state_type=state.state_type,
        order_index=state.order_index,
        color=state.color,
        requires_approval=state.requires_approval,
        requires_evidence=state.requires_evidence,
        auto_assign_department_id=state.auto_assign_department_id,
        auto_assign_department_name=dept_name,
        sla_multiplier=state.sla_multiplier,
        is_terminal=state.is_terminal
    )


@router.put("/workflows/states/{state_id}", response_model=GRCVulnWorkflowStateResponse)
def update_workflow_state(
    state_id: int,
    request: GRCVulnWorkflowStateUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    state = db.query(GRCVulnWorkflowState).join(GRCVulnWorkflowTemplate).filter(
        GRCVulnWorkflowState.id == state_id,
        GRCVulnWorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not state:
        raise HTTPException(status_code=404, detail="Workflow state not found")
    
    update_data = request.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(state, field, value)
    
    db.commit()
    db.refresh(state)
    
    dept_name = None
    if state.auto_assign_department_id:
        dept = db.query(GRCDepartment).filter(GRCDepartment.id == state.auto_assign_department_id).first()
        dept_name = dept.name if dept else None
    
    return GRCVulnWorkflowStateResponse(
        id=state.id,
        template_id=state.template_id,
        name=state.name,
        state_type=state.state_type,
        order_index=state.order_index,
        color=state.color,
        requires_approval=state.requires_approval,
        requires_evidence=state.requires_evidence,
        auto_assign_department_id=state.auto_assign_department_id,
        auto_assign_department_name=dept_name,
        sla_multiplier=state.sla_multiplier,
        is_terminal=state.is_terminal
    )


@router.delete("/workflows/states/{state_id}", response_model=MessageResponse)
def delete_workflow_state(
    state_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    state = db.query(GRCVulnWorkflowState).join(GRCVulnWorkflowTemplate).filter(
        GRCVulnWorkflowState.id == state_id,
        GRCVulnWorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not state:
        raise HTTPException(status_code=404, detail="Workflow state not found")
    
    db.query(GRCVulnWorkflowTransition).filter(
        (GRCVulnWorkflowTransition.from_state_id == state_id) |
        (GRCVulnWorkflowTransition.to_state_id == state_id)
    ).delete()
    
    db.delete(state)
    db.commit()
    
    return MessageResponse(message="Workflow state deleted successfully", id=state_id)


@router.post("/workflows/{template_id}/transitions", response_model=GRCVulnWorkflowTransitionResponse, status_code=status.HTTP_201_CREATED)
def add_workflow_transition(
    template_id: int,
    request: GRCVulnWorkflowTransitionCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    template = get_template_or_404(template_id, user_tenants, db)
    
    from_state = db.query(GRCVulnWorkflowState).filter(
        GRCVulnWorkflowState.id == request.from_state_id,
        GRCVulnWorkflowState.template_id == template_id
    ).first()
    to_state = db.query(GRCVulnWorkflowState).filter(
        GRCVulnWorkflowState.id == request.to_state_id,
        GRCVulnWorkflowState.template_id == template_id
    ).first()
    
    if not from_state or not to_state:
        raise HTTPException(status_code=400, detail="Invalid from_state_id or to_state_id")
    
    transition = GRCVulnWorkflowTransition(
        template_id=template_id,
        from_state_id=request.from_state_id,
        to_state_id=request.to_state_id,
        name=request.name,
        requires_comment=request.requires_comment,
        requires_approval=request.requires_approval,
        approver_role=request.approver_role,
        allowed_roles=request.allowed_roles,
        trigger_notification=request.trigger_notification
    )
    db.add(transition)
    db.commit()
    db.refresh(transition)
    
    return GRCVulnWorkflowTransitionResponse(
        id=transition.id,
        template_id=transition.template_id,
        from_state_id=transition.from_state_id,
        to_state_id=transition.to_state_id,
        name=transition.name,
        requires_comment=transition.requires_comment,
        requires_approval=transition.requires_approval,
        approver_role=transition.approver_role,
        allowed_roles=transition.allowed_roles or [],
        trigger_notification=transition.trigger_notification,
        from_state_name=from_state.name,
        to_state_name=to_state.name
    )


@router.put("/workflows/transitions/{transition_id}", response_model=GRCVulnWorkflowTransitionResponse)
def update_workflow_transition(
    transition_id: int,
    request: GRCVulnWorkflowTransitionUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    transition = db.query(GRCVulnWorkflowTransition).join(GRCVulnWorkflowTemplate).filter(
        GRCVulnWorkflowTransition.id == transition_id,
        GRCVulnWorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not transition:
        raise HTTPException(status_code=404, detail="Workflow transition not found")
    
    update_data = request.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(transition, field, value)
    
    db.commit()
    db.refresh(transition)
    
    from_state = db.query(GRCVulnWorkflowState).filter(GRCVulnWorkflowState.id == transition.from_state_id).first()
    to_state = db.query(GRCVulnWorkflowState).filter(GRCVulnWorkflowState.id == transition.to_state_id).first()
    
    return GRCVulnWorkflowTransitionResponse(
        id=transition.id,
        template_id=transition.template_id,
        from_state_id=transition.from_state_id,
        to_state_id=transition.to_state_id,
        name=transition.name,
        requires_comment=transition.requires_comment,
        requires_approval=transition.requires_approval,
        approver_role=transition.approver_role,
        allowed_roles=transition.allowed_roles or [],
        trigger_notification=transition.trigger_notification,
        from_state_name=from_state.name if from_state else None,
        to_state_name=to_state.name if to_state else None
    )


@router.delete("/workflows/transitions/{transition_id}", response_model=MessageResponse)
def delete_workflow_transition(
    transition_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    transition = db.query(GRCVulnWorkflowTransition).join(GRCVulnWorkflowTemplate).filter(
        GRCVulnWorkflowTransition.id == transition_id,
        GRCVulnWorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not transition:
        raise HTTPException(status_code=404, detail="Workflow transition not found")
    
    db.delete(transition)
    db.commit()
    
    return MessageResponse(message="Workflow transition deleted successfully", id=transition_id)


@router.post("/workflows/{template_id}/escalations", response_model=GRCVulnWorkflowEscalationResponse, status_code=status.HTTP_201_CREATED)
def add_workflow_escalation(
    template_id: int,
    request: GRCVulnWorkflowEscalationCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    template = get_template_or_404(template_id, user_tenants, db)
    
    escalation = GRCVulnWorkflowEscalation(
        template_id=template_id,
        name=request.name,
        trigger_type=request.trigger_type,
        trigger_value=request.trigger_value,
        escalate_to_department_id=request.escalate_to_department_id,
        escalate_to_role=request.escalate_to_role,
        auto_transition_to_state_id=request.auto_transition_to_state_id,
        notification_type=request.notification_type,
        is_active=request.is_active
    )
    db.add(escalation)
    db.commit()
    db.refresh(escalation)
    
    dept_name = None
    state_name = None
    if escalation.escalate_to_department_id:
        dept = db.query(GRCDepartment).filter(GRCDepartment.id == escalation.escalate_to_department_id).first()
        dept_name = dept.name if dept else None
    if escalation.auto_transition_to_state_id:
        state = db.query(GRCVulnWorkflowState).filter(GRCVulnWorkflowState.id == escalation.auto_transition_to_state_id).first()
        state_name = state.name if state else None
    
    return GRCVulnWorkflowEscalationResponse(
        id=escalation.id,
        template_id=escalation.template_id,
        name=escalation.name,
        trigger_type=escalation.trigger_type,
        trigger_value=escalation.trigger_value,
        escalate_to_department_id=escalation.escalate_to_department_id,
        escalate_to_department_name=dept_name,
        escalate_to_role=escalation.escalate_to_role,
        auto_transition_to_state_id=escalation.auto_transition_to_state_id,
        auto_transition_to_state_name=state_name,
        notification_type=escalation.notification_type,
        is_active=escalation.is_active
    )


@router.put("/workflows/escalations/{escalation_id}", response_model=GRCVulnWorkflowEscalationResponse)
def update_workflow_escalation(
    escalation_id: int,
    request: GRCVulnWorkflowEscalationUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    escalation = db.query(GRCVulnWorkflowEscalation).join(GRCVulnWorkflowTemplate).filter(
        GRCVulnWorkflowEscalation.id == escalation_id,
        GRCVulnWorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not escalation:
        raise HTTPException(status_code=404, detail="Workflow escalation not found")
    
    update_data = request.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(escalation, field, value)
    
    db.commit()
    db.refresh(escalation)
    
    dept_name = None
    state_name = None
    if escalation.escalate_to_department_id:
        dept = db.query(GRCDepartment).filter(GRCDepartment.id == escalation.escalate_to_department_id).first()
        dept_name = dept.name if dept else None
    if escalation.auto_transition_to_state_id:
        state = db.query(GRCVulnWorkflowState).filter(GRCVulnWorkflowState.id == escalation.auto_transition_to_state_id).first()
        state_name = state.name if state else None
    
    return GRCVulnWorkflowEscalationResponse(
        id=escalation.id,
        template_id=escalation.template_id,
        name=escalation.name,
        trigger_type=escalation.trigger_type,
        trigger_value=escalation.trigger_value,
        escalate_to_department_id=escalation.escalate_to_department_id,
        escalate_to_department_name=dept_name,
        escalate_to_role=escalation.escalate_to_role,
        auto_transition_to_state_id=escalation.auto_transition_to_state_id,
        auto_transition_to_state_name=state_name,
        notification_type=escalation.notification_type,
        is_active=escalation.is_active
    )


@router.delete("/workflows/escalations/{escalation_id}", response_model=MessageResponse)
def delete_workflow_escalation(
    escalation_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    escalation = db.query(GRCVulnWorkflowEscalation).join(GRCVulnWorkflowTemplate).filter(
        GRCVulnWorkflowEscalation.id == escalation_id,
        GRCVulnWorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not escalation:
        raise HTTPException(status_code=404, detail="Workflow escalation not found")
    
    db.delete(escalation)
    db.commit()
    
    return MessageResponse(message="Workflow escalation deleted successfully", id=escalation_id)


@router.post("/vulnerabilities/{vuln_id}/transition", response_model=GRCVulnWorkflowHistoryResponse)
def perform_vulnerability_transition(
    vuln_id: int,
    request: VulnWorkflowTransitionRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    from ..services.notification_service import NotificationService
    
    user_tenants = get_user_tenants(current_user, db)
    
    vuln = db.query(Vulnerability).filter(
        Vulnerability.id == vuln_id,
        Vulnerability.tenant_id.in_(user_tenants)
    ).first()
    
    if not vuln:
        raise HTTPException(status_code=404, detail="Vulnerability not found")
    
    transition = db.query(GRCVulnWorkflowTransition).filter(
        GRCVulnWorkflowTransition.id == request.transition_id
    ).first()
    
    if not transition:
        raise HTTPException(status_code=404, detail="Transition not found")
    
    if vuln.current_state_id and vuln.current_state_id != transition.from_state_id:
        raise HTTPException(status_code=400, detail="Invalid transition from current state")
    
    if transition.requires_comment and not request.comment:
        raise HTTPException(status_code=400, detail="Comment is required for this transition")
    
    if transition.allowed_roles and len(transition.allowed_roles) > 0:
        from ....models import UserRole, Role
        user_roles = db.query(Role.name).join(UserRole).filter(
            UserRole.user_id == current_user.id,
            UserRole.tenant_id == vuln.tenant_id
        ).all()
        user_role_names = [r[0].lower() for r in user_roles]
        allowed_roles_lower = [r.lower() for r in transition.allowed_roles]
        
        has_role = any(role in user_role_names for role in allowed_roles_lower)
        if not has_role and "admin" not in user_role_names:
            raise HTTPException(
                status_code=403, 
                detail=f"User does not have required role for this transition. Required: {transition.allowed_roles}"
            )
    
    from_state_id = vuln.current_state_id
    from_state = db.query(GRCVulnWorkflowState).filter(GRCVulnWorkflowState.id == from_state_id).first() if from_state_id else None
    
    history = GRCVulnWorkflowHistory(
        vulnerability_id=vuln_id,
        from_state_id=from_state_id,
        to_state_id=transition.to_state_id,
        transition_id=transition.id,
        performed_by=current_user.id,
        comment=request.comment
    )
    db.add(history)
    
    vuln.current_state_id = transition.to_state_id
    if not vuln.workflow_template_id:
        vuln.workflow_template_id = transition.template_id
    vuln.updated_at = datetime.utcnow()
    
    to_state = db.query(GRCVulnWorkflowState).filter(GRCVulnWorkflowState.id == transition.to_state_id).first()
    if to_state:
        if to_state.state_type == "resolved":
            vuln.status = "resolved"
            vuln.resolved_at = datetime.utcnow()
        elif to_state.state_type == "closed":
            vuln.status = "resolved"
        elif to_state.state_type == "exception":
            vuln.status = "accepted"
        elif to_state.state_type == "in_progress":
            vuln.status = "in_progress"
    
    db.commit()
    db.refresh(history)
    
    if transition.trigger_notification:
        try:
            NotificationService.create_status_change_notification(
                db=db,
                vulnerability=vuln,
                old_state_name=from_state.name if from_state else None,
                new_state_name=to_state.name if to_state else "Unknown",
                changed_by_user_id=current_user.id,
                notify_user_id=vuln.assigned_to
            )
            
            if vuln.assignee and vuln.assignee.email:
                try:
                    EmailService.send_status_change(
                        recipient_email=vuln.assignee.email,
                        recipient_name=vuln.assignee.display_name,
                        vulnerability=vuln,
                        old_status=from_state.name if from_state else None,
                        new_status=to_state.name if to_state else "Unknown",
                        changed_by=current_user.display_name
                    )
                except Exception as e:
                    logger.error(f"Failed to send status change email: {e}")
        except Exception:
            pass
    
    if transition.requires_approval and to_state:
        try:
            NotificationService.create_approval_required_notification(
                db=db,
                vulnerability=vuln,
                approver_role=transition.approver_role,
                transition_name=transition.name,
                requested_by_user_id=current_user.id,
                approver_team_id=to_state.auto_assign_team_id
            )
        except Exception:
            pass
    
    return GRCVulnWorkflowHistoryResponse(
        id=history.id,
        vulnerability_id=history.vulnerability_id,
        from_state_id=history.from_state_id,
        from_state_name=from_state.name if from_state else None,
        to_state_id=history.to_state_id,
        to_state_name=to_state.name if to_state else None,
        transition_id=history.transition_id,
        transition_name=transition.name,
        performed_by=history.performed_by,
        performer_name=current_user.display_name,
        comment=history.comment,
        performed_at=history.performed_at
    )


@router.get("/vulnerabilities/{vuln_id}/history", response_model=List[GRCVulnWorkflowHistoryResponse])
def get_vulnerability_workflow_history(
    vuln_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    vuln = db.query(Vulnerability).filter(
        Vulnerability.id == vuln_id,
        Vulnerability.tenant_id.in_(user_tenants)
    ).first()
    
    if not vuln:
        raise HTTPException(status_code=404, detail="Vulnerability not found")
    
    history_entries = db.query(GRCVulnWorkflowHistory).options(
        joinedload(GRCVulnWorkflowHistory.from_state),
        joinedload(GRCVulnWorkflowHistory.to_state),
        joinedload(GRCVulnWorkflowHistory.transition),
        joinedload(GRCVulnWorkflowHistory.performer)
    ).filter(
        GRCVulnWorkflowHistory.vulnerability_id == vuln_id
    ).order_by(GRCVulnWorkflowHistory.performed_at.desc()).all()
    
    return [
        GRCVulnWorkflowHistoryResponse(
            id=h.id,
            vulnerability_id=h.vulnerability_id,
            from_state_id=h.from_state_id,
            from_state_name=h.from_state.name if h.from_state else None,
            to_state_id=h.to_state_id,
            to_state_name=h.to_state.name if h.to_state else None,
            transition_id=h.transition_id,
            transition_name=h.transition.name if h.transition else None,
            performed_by=h.performed_by,
            performer_name=h.performer.display_name if h.performer else None,
            comment=h.comment,
            performed_at=h.performed_at
        )
        for h in history_entries
    ]


@router.get("/vulnerabilities/{vuln_id}/available-transitions", response_model=List[VulnAvailableTransitionResponse])
def get_available_transitions(
    vuln_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    vuln = db.query(Vulnerability).filter(
        Vulnerability.id == vuln_id,
        Vulnerability.tenant_id.in_(user_tenants)
    ).first()
    
    if not vuln:
        raise HTTPException(status_code=404, detail="Vulnerability not found")
    
    if not vuln.workflow_template_id and not vuln.current_state_id:
        default_template = db.query(GRCVulnWorkflowTemplate).filter(
            GRCVulnWorkflowTemplate.tenant_id == vuln.tenant_id,
            GRCVulnWorkflowTemplate.is_default == True,
            GRCVulnWorkflowTemplate.is_active == True
        ).first()
        
        if not default_template:
            return []
        
        initial_state = db.query(GRCVulnWorkflowState).filter(
            GRCVulnWorkflowState.template_id == default_template.id,
            GRCVulnWorkflowState.state_type == "initial"
        ).first()
        
        if not initial_state:
            return []
        
        transitions = db.query(GRCVulnWorkflowTransition).options(
            joinedload(GRCVulnWorkflowTransition.to_state)
        ).filter(
            GRCVulnWorkflowTransition.template_id == default_template.id,
            GRCVulnWorkflowTransition.from_state_id == initial_state.id
        ).all()
    else:
        if not vuln.current_state_id:
            return []
        
        transitions = db.query(GRCVulnWorkflowTransition).options(
            joinedload(GRCVulnWorkflowTransition.to_state)
        ).filter(
            GRCVulnWorkflowTransition.from_state_id == vuln.current_state_id
        ).all()
    
    return [
        VulnAvailableTransitionResponse(
            id=t.id,
            name=t.name,
            to_state_id=t.to_state_id,
            to_state_name=t.to_state.name if t.to_state else "",
            requires_comment=t.requires_comment,
            requires_approval=t.requires_approval
        )
        for t in transitions
    ]
