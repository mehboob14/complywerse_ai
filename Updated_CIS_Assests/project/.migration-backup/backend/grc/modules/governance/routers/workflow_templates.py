from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel

from ....models import (
    WorkflowTemplate, WorkflowStep, WorkflowStepApprover,
    DocumentWorkflowInstance, GRCUser, Role, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/workflows/templates", tags=["Governance - Workflow Templates"])


class WorkflowTemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    doc_types: List[str] = []
    is_default: bool = False
    is_active: bool = True
    allow_skip: bool = False
    require_all_approvers: bool = False
    auto_publish_on_complete: bool = False


class WorkflowTemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    doc_types: Optional[List[str]] = None
    is_default: Optional[bool] = None
    is_active: Optional[bool] = None
    allow_skip: Optional[bool] = None
    require_all_approvers: Optional[bool] = None
    auto_publish_on_complete: Optional[bool] = None


class WorkflowStepCreate(BaseModel):
    name: str
    description: Optional[str] = None
    sequence: int
    step_type: str = "approval"
    approval_mode: str = "any"
    is_required: bool = True
    timeout_days: Optional[int] = None
    on_approve_status: Optional[str] = None
    on_reject_action: str = "return_to_draft"
    notify_on_pending: bool = True
    notify_on_complete: bool = True
    reminder_days: Optional[int] = None


class WorkflowStepUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    step_type: Optional[str] = None
    approval_mode: Optional[str] = None
    is_required: Optional[bool] = None
    timeout_days: Optional[int] = None
    on_approve_status: Optional[str] = None
    on_reject_action: Optional[str] = None
    notify_on_pending: Optional[bool] = None
    notify_on_complete: Optional[bool] = None
    reminder_days: Optional[int] = None


class StepReorderItem(BaseModel):
    step_id: int
    sequence: int


class StepReorderRequest(BaseModel):
    steps: List[StepReorderItem]


class StepApproverCreate(BaseModel):
    approver_type: str
    user_id: Optional[int] = None
    role_id: Optional[int] = None
    is_required: bool = True
    sequence: int = 1


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def serialize_approver(approver: WorkflowStepApprover) -> dict:
    return {
        "id": approver.id,
        "step_id": approver.step_id,
        "approver_type": approver.approver_type,
        "user_id": approver.user_id,
        "user_name": approver.user.display_name if approver.user else None,
        "user_email": approver.user.email if approver.user else None,
        "role_id": approver.role_id,
        "role_name": approver.role.name if approver.role else None,
        "is_required": approver.is_required,
        "sequence": approver.sequence
    }


def serialize_step(step: WorkflowStep) -> dict:
    return {
        "id": step.id,
        "template_id": step.template_id,
        "name": step.name,
        "description": step.description,
        "sequence": step.sequence,
        "step_type": step.step_type,
        "approval_mode": step.approval_mode,
        "is_required": step.is_required,
        "timeout_days": step.timeout_days,
        "on_approve_status": step.on_approve_status,
        "on_reject_action": step.on_reject_action,
        "notify_on_pending": step.notify_on_pending,
        "notify_on_complete": step.notify_on_complete,
        "reminder_days": step.reminder_days,
        "created_at": step.created_at.isoformat() if step.created_at else None,
        "approvers": [serialize_approver(a) for a in step.approvers] if step.approvers else []
    }


def serialize_template(template: WorkflowTemplate, include_steps: bool = False) -> dict:
    result = {
        "id": template.id,
        "tenant_id": template.tenant_id,
        "name": template.name,
        "description": template.description,
        "doc_types": template.doc_types or [],
        "is_default": template.is_default,
        "is_active": template.is_active,
        "allow_skip": template.allow_skip,
        "require_all_approvers": template.require_all_approvers,
        "auto_publish_on_complete": template.auto_publish_on_complete,
        "created_at": template.created_at.isoformat() if template.created_at else None,
        "updated_at": template.updated_at.isoformat() if template.updated_at else None,
        "created_by": template.created_by,
        "creator_name": template.creator.display_name if template.creator else None,
        "steps_count": len(template.steps) if template.steps else 0
    }
    if include_steps:
        result["steps"] = [serialize_step(s) for s in template.steps] if template.steps else []
    return result


@router.get("")
def list_templates(
    tenant_id: Optional[int] = None,
    is_active: Optional[bool] = None,
    doc_type: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    
    query = db.query(WorkflowTemplate).options(
        joinedload(WorkflowTemplate.steps),
        joinedload(WorkflowTemplate.creator)
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(WorkflowTemplate.tenant_id == tenant_id)
    else:
        query = query.filter(WorkflowTemplate.tenant_id.in_(user_tenants))
    
    if is_active is not None:
        query = query.filter(WorkflowTemplate.is_active == is_active)
    
    total = query.count()
    templates = query.order_by(WorkflowTemplate.name).offset(skip).limit(limit).all()
    
    items = [serialize_template(t) for t in templates]
    
    if doc_type:
        items = [t for t in items if doc_type in t["doc_types"]]
    
    return {
        "items": items,
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_template(
    request: WorkflowTemplateCreate,
    tenant_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    validate_tenant_access(current_user, tenant_id, db)
    
    if request.is_default:
        existing_default = db.query(WorkflowTemplate).filter(
            WorkflowTemplate.tenant_id == tenant_id,
            WorkflowTemplate.is_default == True
        ).first()
        if existing_default:
            existing_default.is_default = False
    
    template = WorkflowTemplate(
        tenant_id=tenant_id,
        name=request.name,
        description=request.description,
        doc_types=request.doc_types,
        is_default=request.is_default,
        is_active=request.is_active,
        allow_skip=request.allow_skip,
        require_all_approvers=request.require_all_approvers,
        auto_publish_on_complete=request.auto_publish_on_complete,
        created_by=current_user.id
    )
    
    db.add(template)
    db.commit()
    db.refresh(template)
    
    return serialize_template(template)


@router.get("/{template_id}")
def get_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    template = db.query(WorkflowTemplate).options(
        joinedload(WorkflowTemplate.steps).joinedload(WorkflowStep.approvers).joinedload(WorkflowStepApprover.user),
        joinedload(WorkflowTemplate.steps).joinedload(WorkflowStep.approvers).joinedload(WorkflowStepApprover.role),
        joinedload(WorkflowTemplate.creator)
    ).filter(
        WorkflowTemplate.id == template_id,
        WorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow template not found"
        )
    
    return serialize_template(template, include_steps=True)


@router.put("/{template_id}")
def update_template(
    template_id: int,
    request: WorkflowTemplateUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    template = db.query(WorkflowTemplate).filter(
        WorkflowTemplate.id == template_id,
        WorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow template not found"
        )
    
    if request.is_default and not template.is_default:
        existing_default = db.query(WorkflowTemplate).filter(
            WorkflowTemplate.tenant_id == template.tenant_id,
            WorkflowTemplate.is_default == True,
            WorkflowTemplate.id != template_id
        ).first()
        if existing_default:
            existing_default.is_default = False
    
    update_data = request.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(template, key, value)
    
    template.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(template)
    
    return serialize_template(template)


@router.delete("/{template_id}")
def delete_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    template = db.query(WorkflowTemplate).filter(
        WorkflowTemplate.id == template_id,
        WorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow template not found"
        )
    
    in_use = db.query(DocumentWorkflowInstance).filter(
        DocumentWorkflowInstance.template_id == template_id,
        DocumentWorkflowInstance.status == "active"
    ).first()
    
    if in_use:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete template that is in use by active workflows"
        )
    
    db.delete(template)
    db.commit()
    
    return {"message": "Template deleted successfully", "id": template_id}


@router.post("/{template_id}/clone")
def clone_template(
    template_id: int,
    new_name: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    template = db.query(WorkflowTemplate).options(
        joinedload(WorkflowTemplate.steps).joinedload(WorkflowStep.approvers)
    ).filter(
        WorkflowTemplate.id == template_id,
        WorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow template not found"
        )
    
    cloned = WorkflowTemplate(
        tenant_id=template.tenant_id,
        name=new_name or f"{template.name} (Copy)",
        description=template.description,
        doc_types=template.doc_types.copy() if template.doc_types else [],
        is_default=False,
        is_active=True,
        allow_skip=template.allow_skip,
        require_all_approvers=template.require_all_approvers,
        auto_publish_on_complete=template.auto_publish_on_complete,
        created_by=current_user.id
    )
    db.add(cloned)
    db.flush()
    
    for step in template.steps:
        cloned_step = WorkflowStep(
            template_id=cloned.id,
            name=step.name,
            description=step.description,
            sequence=step.sequence,
            step_type=step.step_type,
            approval_mode=step.approval_mode,
            is_required=step.is_required,
            timeout_days=step.timeout_days,
            on_approve_status=step.on_approve_status,
            on_reject_action=step.on_reject_action,
            notify_on_pending=step.notify_on_pending,
            notify_on_complete=step.notify_on_complete,
            reminder_days=step.reminder_days
        )
        db.add(cloned_step)
        db.flush()
        
        for approver in step.approvers:
            cloned_approver = WorkflowStepApprover(
                step_id=cloned_step.id,
                approver_type=approver.approver_type,
                user_id=approver.user_id,
                role_id=approver.role_id,
                is_required=approver.is_required,
                sequence=approver.sequence
            )
            db.add(cloned_approver)
    
    db.commit()
    db.refresh(cloned)
    
    return serialize_template(cloned, include_steps=True)


@router.post("/{template_id}/set-default")
def set_default_template(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    template = db.query(WorkflowTemplate).filter(
        WorkflowTemplate.id == template_id,
        WorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow template not found"
        )
    
    db.query(WorkflowTemplate).filter(
        WorkflowTemplate.tenant_id == template.tenant_id,
        WorkflowTemplate.is_default == True
    ).update({"is_default": False})
    
    template.is_default = True
    template.updated_at = datetime.utcnow()
    db.commit()
    
    return {"message": "Template set as default", "id": template_id}


@router.get("/{template_id}/steps")
def list_steps(
    template_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    template = db.query(WorkflowTemplate).filter(
        WorkflowTemplate.id == template_id,
        WorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow template not found"
        )
    
    steps = db.query(WorkflowStep).options(
        joinedload(WorkflowStep.approvers).joinedload(WorkflowStepApprover.user),
        joinedload(WorkflowStep.approvers).joinedload(WorkflowStepApprover.role)
    ).filter(
        WorkflowStep.template_id == template_id
    ).order_by(WorkflowStep.sequence).all()
    
    return {
        "template_id": template_id,
        "template_name": template.name,
        "steps": [serialize_step(s) for s in steps]
    }


@router.post("/{template_id}/steps", status_code=status.HTTP_201_CREATED)
def create_step(
    template_id: int,
    request: WorkflowStepCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    template = db.query(WorkflowTemplate).filter(
        WorkflowTemplate.id == template_id,
        WorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow template not found"
        )
    
    existing_at_sequence = db.query(WorkflowStep).filter(
        WorkflowStep.template_id == template_id,
        WorkflowStep.sequence >= request.sequence
    ).all()
    
    for step in existing_at_sequence:
        step.sequence += 1
    
    step = WorkflowStep(
        template_id=template_id,
        name=request.name,
        description=request.description,
        sequence=request.sequence,
        step_type=request.step_type,
        approval_mode=request.approval_mode,
        is_required=request.is_required,
        timeout_days=request.timeout_days,
        on_approve_status=request.on_approve_status,
        on_reject_action=request.on_reject_action,
        notify_on_pending=request.notify_on_pending,
        notify_on_complete=request.notify_on_complete,
        reminder_days=request.reminder_days
    )
    
    db.add(step)
    db.commit()
    db.refresh(step)
    
    return serialize_step(step)


@router.put("/{template_id}/steps/{step_id}")
def update_step(
    template_id: int,
    step_id: int,
    request: WorkflowStepUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    template = db.query(WorkflowTemplate).filter(
        WorkflowTemplate.id == template_id,
        WorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow template not found"
        )
    
    step = db.query(WorkflowStep).filter(
        WorkflowStep.id == step_id,
        WorkflowStep.template_id == template_id
    ).first()
    
    if not step:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow step not found"
        )
    
    update_data = request.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(step, key, value)
    
    db.commit()
    db.refresh(step)
    
    return serialize_step(step)


@router.delete("/{template_id}/steps/{step_id}")
def delete_step(
    template_id: int,
    step_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    template = db.query(WorkflowTemplate).filter(
        WorkflowTemplate.id == template_id,
        WorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow template not found"
        )
    
    step = db.query(WorkflowStep).filter(
        WorkflowStep.id == step_id,
        WorkflowStep.template_id == template_id
    ).first()
    
    if not step:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow step not found"
        )
    
    deleted_sequence = step.sequence
    
    db.delete(step)
    
    remaining_steps = db.query(WorkflowStep).filter(
        WorkflowStep.template_id == template_id,
        WorkflowStep.sequence > deleted_sequence
    ).all()
    
    for s in remaining_steps:
        s.sequence -= 1
    
    db.commit()
    
    return {"message": "Step deleted successfully", "id": step_id}


@router.put("/{template_id}/steps/reorder")
def reorder_steps(
    template_id: int,
    request: StepReorderRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    template = db.query(WorkflowTemplate).filter(
        WorkflowTemplate.id == template_id,
        WorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow template not found"
        )
    
    for item in request.steps:
        step = db.query(WorkflowStep).filter(
            WorkflowStep.id == item.step_id,
            WorkflowStep.template_id == template_id
        ).first()
        if step:
            step.sequence = item.sequence
    
    db.commit()
    
    steps = db.query(WorkflowStep).filter(
        WorkflowStep.template_id == template_id
    ).order_by(WorkflowStep.sequence).all()
    
    return {
        "message": "Steps reordered successfully",
        "steps": [serialize_step(s) for s in steps]
    }


@router.get("/{template_id}/steps/{step_id}/approvers")
def list_approvers(
    template_id: int,
    step_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    template = db.query(WorkflowTemplate).filter(
        WorkflowTemplate.id == template_id,
        WorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow template not found"
        )
    
    step = db.query(WorkflowStep).filter(
        WorkflowStep.id == step_id,
        WorkflowStep.template_id == template_id
    ).first()
    
    if not step:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow step not found"
        )
    
    approvers = db.query(WorkflowStepApprover).options(
        joinedload(WorkflowStepApprover.user),
        joinedload(WorkflowStepApprover.role)
    ).filter(
        WorkflowStepApprover.step_id == step_id
    ).order_by(WorkflowStepApprover.sequence).all()
    
    return {
        "step_id": step_id,
        "step_name": step.name,
        "approvers": [serialize_approver(a) for a in approvers]
    }


@router.post("/{template_id}/steps/{step_id}/approvers", status_code=status.HTTP_201_CREATED)
def add_approver(
    template_id: int,
    step_id: int,
    request: StepApproverCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    template = db.query(WorkflowTemplate).filter(
        WorkflowTemplate.id == template_id,
        WorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow template not found"
        )
    
    step = db.query(WorkflowStep).filter(
        WorkflowStep.id == step_id,
        WorkflowStep.template_id == template_id
    ).first()
    
    if not step:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow step not found"
        )
    
    if request.approver_type == "user" and request.user_id:
        user = db.query(GRCUser).filter(GRCUser.id == request.user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User not found"
            )
    
    if request.approver_type == "role" and request.role_id:
        role = db.query(Role).filter(Role.id == request.role_id).first()
        if not role:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Role not found"
            )
    
    approver = WorkflowStepApprover(
        step_id=step_id,
        approver_type=request.approver_type,
        user_id=request.user_id,
        role_id=request.role_id,
        is_required=request.is_required,
        sequence=request.sequence
    )
    
    db.add(approver)
    db.commit()
    db.refresh(approver)
    
    return serialize_approver(approver)


@router.delete("/{template_id}/steps/{step_id}/approvers/{approver_id}")
def remove_approver(
    template_id: int,
    step_id: int,
    approver_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    template = db.query(WorkflowTemplate).filter(
        WorkflowTemplate.id == template_id,
        WorkflowTemplate.tenant_id.in_(user_tenants)
    ).first()
    
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow template not found"
        )
    
    step = db.query(WorkflowStep).filter(
        WorkflowStep.id == step_id,
        WorkflowStep.template_id == template_id
    ).first()
    
    if not step:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Workflow step not found"
        )
    
    approver = db.query(WorkflowStepApprover).filter(
        WorkflowStepApprover.id == approver_id,
        WorkflowStepApprover.step_id == step_id
    ).first()
    
    if not approver:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approver not found"
        )
    
    db.delete(approver)
    db.commit()
    
    return {"message": "Approver removed successfully", "id": approver_id}


@router.post("/seed-defaults")
def seed_default_templates(
    tenant_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    validate_tenant_access(current_user, tenant_id, db)
    
    existing = db.query(WorkflowTemplate).filter(
        WorkflowTemplate.tenant_id == tenant_id,
        WorkflowTemplate.name == "Standard Policy Approval"
    ).first()
    
    if existing:
        return {
            "message": "Default template already exists",
            "template_id": existing.id
        }
    
    template = WorkflowTemplate(
        tenant_id=tenant_id,
        name="Standard Policy Approval",
        description="Default three-step policy approval workflow: Review → Approval → Publish",
        doc_types=["policy", "standard", "procedure"],
        is_default=True,
        is_active=True,
        allow_skip=False,
        require_all_approvers=False,
        auto_publish_on_complete=True,
        created_by=current_user.id
    )
    db.add(template)
    db.flush()
    
    review_step = WorkflowStep(
        template_id=template.id,
        name="Review",
        description="Initial review by designated reviewers",
        sequence=1,
        step_type="review",
        approval_mode="any",
        is_required=True,
        timeout_days=7,
        on_approve_status="pending_approval",
        on_reject_action="return_to_draft",
        notify_on_pending=True,
        notify_on_complete=True,
        reminder_days=3
    )
    db.add(review_step)
    db.flush()
    
    review_approver = WorkflowStepApprover(
        step_id=review_step.id,
        approver_type="role",
        is_required=True,
        sequence=1
    )
    db.add(review_approver)
    
    approval_step = WorkflowStep(
        template_id=template.id,
        name="Approval",
        description="Formal approval by designated approvers",
        sequence=2,
        step_type="approval",
        approval_mode="any",
        is_required=True,
        timeout_days=5,
        on_approve_status="approved",
        on_reject_action="return_to_draft",
        notify_on_pending=True,
        notify_on_complete=True,
        reminder_days=2
    )
    db.add(approval_step)
    db.flush()
    
    approval_approver = WorkflowStepApprover(
        step_id=approval_step.id,
        approver_type="role",
        is_required=True,
        sequence=1
    )
    db.add(approval_approver)
    
    publish_step = WorkflowStep(
        template_id=template.id,
        name="Publish",
        description="Final publication by designated publishers",
        sequence=3,
        step_type="approval",
        approval_mode="any",
        is_required=True,
        timeout_days=3,
        on_approve_status="published",
        on_reject_action="return_to_previous",
        notify_on_pending=True,
        notify_on_complete=True,
        reminder_days=1
    )
    db.add(publish_step)
    db.flush()
    
    publish_approver = WorkflowStepApprover(
        step_id=publish_step.id,
        approver_type="role",
        is_required=True,
        sequence=1
    )
    db.add(publish_approver)
    
    db.commit()
    db.refresh(template)
    
    return {
        "message": "Default workflow template created successfully",
        "template_id": template.id,
        "template_name": template.name,
        "steps_created": 3
    }
