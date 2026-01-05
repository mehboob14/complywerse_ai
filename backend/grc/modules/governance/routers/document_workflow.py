from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_
from pydantic import BaseModel

from ....models import (
    GovernanceDocument, DocumentWorkflowInstance, DocumentWorkflowAction,
    WorkflowTemplate, WorkflowStep, WorkflowStepApprover,
    DocumentAuditLog, GRCUser, Role, UserRole, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/documents", tags=["Governance - Document Workflow"])


class StartWorkflowRequest(BaseModel):
    template_id: Optional[int] = None


class WorkflowActionRequest(BaseModel):
    comments: Optional[str] = None


def validate_tenant_access(user: GRCUser, tenant_id: int, db: Session) -> None:
    user_tenants = get_user_tenants(user, db)
    if tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied to this tenant's data"
        )


def create_audit_log(
    db: Session,
    document_id: int,
    tenant_id: int,
    user_id: int,
    action: str,
    action_details: Optional[str] = None
) -> DocumentAuditLog:
    audit_log = DocumentAuditLog(
        document_id=document_id,
        tenant_id=tenant_id,
        action=action,
        action_details=action_details,
        performed_by=user_id,
        performed_at=datetime.utcnow()
    )
    db.add(audit_log)
    return audit_log


def get_user_role_ids(user: GRCUser, db: Session) -> List[int]:
    user_roles = db.query(UserRole).filter(UserRole.user_id == user.id).all()
    return [ur.role_id for ur in user_roles]


def is_user_authorized_approver(
    user: GRCUser,
    step: WorkflowStep,
    document: GovernanceDocument,
    db: Session
) -> bool:
    user_role_ids = get_user_role_ids(user, db)
    
    for approver in step.approvers:
        if approver.approver_type == "user" and approver.user_id == user.id:
            return True
        elif approver.approver_type == "role" and approver.role_id in user_role_ids:
            return True
        elif approver.approver_type == "document_owner" and document.owner_id == user.id:
            return True
    
    return False


def check_step_approval_requirements(
    step: WorkflowStep,
    instance: DocumentWorkflowInstance,
    user: GRCUser,
    db: Session
) -> dict:
    """Check if step approval requirements are met based on approval_mode.
    
    Note: This is called AFTER the current user's approval action has been flushed,
    so approved_user_ids will include the current user if they just approved.
    """
    approval_mode = step.approval_mode or "any"
    
    existing_approvals = db.query(DocumentWorkflowAction).filter(
        DocumentWorkflowAction.instance_id == instance.id,
        DocumentWorkflowAction.step_id == step.id,
        DocumentWorkflowAction.action == "approve"
    ).all()
    
    approved_user_ids = {a.action_by for a in existing_approvals}
    
    if approval_mode == "any":
        return {"can_advance": True, "reason": "Any approver can advance"}
    
    elif approval_mode == "all":
        required_approvers = [a for a in step.approvers if a.is_required]
        missing = []
        
        for approver in required_approvers:
            if approver.approver_type == "user":
                if approver.user_id not in approved_user_ids:
                    user_obj = db.query(GRCUser).filter(GRCUser.id == approver.user_id).first()
                    missing.append(user_obj.display_name if user_obj else f"User {approver.user_id}")
            elif approver.approver_type == "role":
                role_users = db.query(UserRole.user_id).filter(
                    UserRole.role_id == approver.role_id
                ).all()
                role_user_ids = {u.user_id for u in role_users}
                if not (role_user_ids & approved_user_ids):
                    role_obj = db.query(Role).filter(Role.id == approver.role_id).first()
                    missing.append(f"Role: {role_obj.name if role_obj else approver.role_id}")
            elif approver.approver_type == "document_owner":
                document = db.query(GovernanceDocument).filter(
                    GovernanceDocument.id == instance.document_id
                ).first()
                if document and document.owner_id and document.owner_id not in approved_user_ids:
                    missing.append("Document Owner")
        
        can_advance = len(missing) == 0
        return {
            "can_advance": can_advance,
            "reason": f"Waiting for: {', '.join(missing)}" if missing else "All required approvers approved",
            "pending_approvers": missing,
            "approved_count": len(approved_user_ids),
            "required_count": len(required_approvers)
        }
    
    elif approval_mode == "sequential":
        sorted_approvers = sorted(step.approvers, key=lambda a: a.sequence)
        for approver in sorted_approvers:
            if approver.approver_type == "user":
                if approver.user_id in approved_user_ids:
                    continue
                return {"can_advance": False, "reason": f"Waiting for user (sequence {approver.sequence})"}
            elif approver.approver_type == "role":
                role_users = db.query(UserRole.user_id).filter(
                    UserRole.role_id == approver.role_id
                ).all()
                role_user_ids = {u.user_id for u in role_users}
                if role_user_ids & approved_user_ids:
                    continue
                return {"can_advance": False, "reason": f"Waiting for role (sequence {approver.sequence})"}
            elif approver.approver_type == "document_owner":
                document = db.query(GovernanceDocument).filter(
                    GovernanceDocument.id == instance.document_id
                ).first()
                if document and document.owner_id in approved_user_ids:
                    continue
                return {"can_advance": False, "reason": "Waiting for document owner"}
        
        return {"can_advance": True, "reason": "All sequential approvals complete"}
    
    return {"can_advance": True, "reason": "Unknown approval mode, defaulting to allow"}


def get_approvers_for_step(step: WorkflowStep, document: GovernanceDocument, db: Session) -> List[dict]:
    approvers = []
    for approver in step.approvers:
        approver_info = {
            "id": approver.id,
            "approver_type": approver.approver_type,
            "is_required": approver.is_required,
            "sequence": approver.sequence
        }
        if approver.approver_type == "user" and approver.user:
            approver_info["user_id"] = approver.user_id
            approver_info["user_name"] = approver.user.display_name
            approver_info["user_email"] = approver.user.email
        elif approver.approver_type == "role" and approver.role:
            approver_info["role_id"] = approver.role_id
            approver_info["role_name"] = approver.role.name
        elif approver.approver_type == "document_owner":
            if document.owner:
                approver_info["user_id"] = document.owner_id
                approver_info["user_name"] = document.owner.display_name
                approver_info["user_email"] = document.owner.email
        approvers.append(approver_info)
    return approvers


def serialize_workflow_action(action: DocumentWorkflowAction) -> dict:
    return {
        "id": action.id,
        "instance_id": action.instance_id,
        "step_id": action.step_id,
        "step_sequence": action.step_sequence,
        "step_name": action.step_name,
        "action": action.action,
        "action_by": action.action_by,
        "actor_name": action.actor.display_name if action.actor else None,
        "action_at": action.action_at.isoformat() if action.action_at else None,
        "comments": action.comments,
        "delegated_to": action.delegated_to,
        "delegate_name": action.delegate.display_name if action.delegate else None
    }


def serialize_workflow_step(step: WorkflowStep, document: GovernanceDocument, db: Session, is_current: bool = False) -> dict:
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
        "is_current": is_current,
        "approvers": get_approvers_for_step(step, document, db)
    }


def serialize_workflow_instance(
    instance: DocumentWorkflowInstance,
    document: GovernanceDocument,
    db: Session,
    include_steps: bool = False,
    include_actions: bool = False
) -> dict:
    result = {
        "id": instance.id,
        "document_id": instance.document_id,
        "template_id": instance.template_id,
        "template_name": instance.template.name if instance.template else None,
        "current_step_id": instance.current_step_id,
        "current_step_sequence": instance.current_step_sequence,
        "current_step_name": instance.current_step.name if instance.current_step else None,
        "status": instance.status,
        "started_at": instance.started_at.isoformat() if instance.started_at else None,
        "completed_at": instance.completed_at.isoformat() if instance.completed_at else None,
        "started_by": instance.started_by,
        "initiator_name": instance.initiator.display_name if instance.initiator else None
    }
    
    if include_steps and instance.template:
        result["steps"] = [
            serialize_workflow_step(
                step, document, db, 
                is_current=(step.id == instance.current_step_id)
            )
            for step in sorted(instance.template.steps, key=lambda s: s.sequence)
        ]
    
    if include_actions and instance.actions:
        result["actions"] = [
            serialize_workflow_action(action)
            for action in sorted(instance.actions, key=lambda a: a.action_at or datetime.min)
        ]
    
    if instance.current_step:
        result["current_step_approvers"] = get_approvers_for_step(
            instance.current_step, document, db
        )
    
    return result


@router.post("/{document_id}/start-workflow", status_code=status.HTTP_201_CREATED)
def start_workflow(
    document_id: int,
    request: StartWorkflowRequest = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).options(
        joinedload(GovernanceDocument.owner),
        joinedload(GovernanceDocument.workflow_instance)
    ).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    if document.workflow_instance and document.workflow_instance.status == "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Document already has an active workflow"
        )
    
    if request and request.template_id:
        template = db.query(WorkflowTemplate).options(
            joinedload(WorkflowTemplate.steps).joinedload(WorkflowStep.approvers).joinedload(WorkflowStepApprover.user),
            joinedload(WorkflowTemplate.steps).joinedload(WorkflowStep.approvers).joinedload(WorkflowStepApprover.role)
        ).filter(
            WorkflowTemplate.id == request.template_id,
            WorkflowTemplate.tenant_id == document.tenant_id,
            WorkflowTemplate.is_active == True
        ).first()
        
        if not template:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Workflow template not found or not active"
            )
    else:
        template = db.query(WorkflowTemplate).options(
            joinedload(WorkflowTemplate.steps).joinedload(WorkflowStep.approvers).joinedload(WorkflowStepApprover.user),
            joinedload(WorkflowTemplate.steps).joinedload(WorkflowStep.approvers).joinedload(WorkflowStepApprover.role)
        ).filter(
            WorkflowTemplate.tenant_id == document.tenant_id,
            WorkflowTemplate.is_active == True,
            or_(
                WorkflowTemplate.is_default == True,
                WorkflowTemplate.doc_types.contains([document.doc_type])
            )
        ).order_by(WorkflowTemplate.is_default.desc()).first()
        
        if not template:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No applicable workflow template found for this document type"
            )
    
    if not template.steps:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Workflow template has no steps defined"
        )
    
    sorted_steps = sorted(template.steps, key=lambda s: s.sequence)
    first_step = sorted_steps[0]
    
    if document.workflow_instance:
        db.delete(document.workflow_instance)
        db.flush()
    
    workflow_instance = DocumentWorkflowInstance(
        document_id=document_id,
        template_id=template.id,
        current_step_id=first_step.id,
        current_step_sequence=first_step.sequence,
        status="active",
        started_at=datetime.utcnow(),
        started_by=current_user.id
    )
    db.add(workflow_instance)
    
    if first_step.on_approve_status:
        document.status = first_step.on_approve_status
    else:
        document.status = "pending_approval"
    document.updated_at = datetime.utcnow()
    
    create_audit_log(
        db=db,
        document_id=document_id,
        tenant_id=document.tenant_id,
        user_id=current_user.id,
        action="workflow_started",
        action_details=f"Workflow '{template.name}' started. First step: {first_step.name}"
    )
    
    db.commit()
    db.refresh(workflow_instance)
    
    return serialize_workflow_instance(workflow_instance, document, db, include_steps=True)


@router.post("/{document_id}/workflow/advance")
def advance_workflow(
    document_id: int,
    request: WorkflowActionRequest = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).options(
        joinedload(GovernanceDocument.owner),
        joinedload(GovernanceDocument.workflow_instance).joinedload(DocumentWorkflowInstance.template).joinedload(WorkflowTemplate.steps).joinedload(WorkflowStep.approvers)
    ).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    instance = document.workflow_instance
    if not instance or instance.status != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Document has no active workflow"
        )
    
    current_step = db.query(WorkflowStep).options(
        joinedload(WorkflowStep.approvers).joinedload(WorkflowStepApprover.user),
        joinedload(WorkflowStep.approvers).joinedload(WorkflowStepApprover.role)
    ).filter(WorkflowStep.id == instance.current_step_id).first()
    
    if not current_step:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Current workflow step not found"
        )
    
    if not is_user_authorized_approver(current_user, current_step, document, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to approve this step"
        )
    
    existing_approval = db.query(DocumentWorkflowAction).filter(
        DocumentWorkflowAction.instance_id == instance.id,
        DocumentWorkflowAction.step_id == current_step.id,
        DocumentWorkflowAction.action == "approve",
        DocumentWorkflowAction.action_by == current_user.id
    ).first()
    
    if existing_approval:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You have already approved this step"
        )
    
    approval_mode = current_step.approval_mode or "any"
    if approval_mode == "sequential":
        existing_approvals = db.query(DocumentWorkflowAction).filter(
            DocumentWorkflowAction.instance_id == instance.id,
            DocumentWorkflowAction.step_id == current_step.id,
            DocumentWorkflowAction.action == "approve"
        ).all()
        approved_user_ids = {a.action_by for a in existing_approvals}
        
        sorted_approvers = sorted(current_step.approvers, key=lambda a: a.sequence)
        for approver in sorted_approvers:
            if approver.approver_type == "user":
                if approver.user_id in approved_user_ids:
                    continue
                if approver.user_id == current_user.id:
                    break
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Sequential approval required. Waiting for another approver first (sequence {approver.sequence})"
                )
            elif approver.approver_type == "role":
                role_users = db.query(UserRole.user_id).filter(
                    UserRole.role_id == approver.role_id
                ).all()
                role_user_ids = {u.user_id for u in role_users}
                if role_user_ids & approved_user_ids:
                    continue
                if current_user.id in role_user_ids:
                    break
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Sequential approval required. Waiting for role (sequence {approver.sequence})"
                )
            elif approver.approver_type == "document_owner":
                if document.owner_id in approved_user_ids:
                    continue
                if current_user.id == document.owner_id:
                    break
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Sequential approval required. Waiting for document owner"
                )
    
    action = DocumentWorkflowAction(
        instance_id=instance.id,
        step_id=current_step.id,
        action="approve",
        action_by=current_user.id,
        action_at=datetime.utcnow(),
        comments=request.comments if request else None,
        step_sequence=current_step.sequence,
        step_name=current_step.name
    )
    db.add(action)
    db.flush()
    
    approval_check = check_step_approval_requirements(current_step, instance, current_user, db)
    
    if not approval_check["can_advance"]:
        db.commit()
        return {
            "message": f"Approval recorded but step not yet complete: {approval_check['reason']}",
            "approval_recorded": True,
            "step_complete": False,
            "instance": serialize_workflow_instance(instance, document, db, include_steps=True, include_actions=True)
        }
    
    all_steps = sorted(instance.template.steps, key=lambda s: s.sequence)
    current_index = next(
        (i for i, s in enumerate(all_steps) if s.id == current_step.id),
        -1
    )
    
    if current_index < len(all_steps) - 1:
        next_step = all_steps[current_index + 1]
        instance.current_step_id = next_step.id
        instance.current_step_sequence = next_step.sequence
        
        if next_step.on_approve_status:
            document.status = next_step.on_approve_status
        
        create_audit_log(
            db=db,
            document_id=document_id,
            tenant_id=document.tenant_id,
            user_id=current_user.id,
            action="workflow_step_approved",
            action_details=f"Step '{current_step.name}' approved. Next step: {next_step.name}"
        )
    else:
        instance.status = "completed"
        instance.completed_at = datetime.utcnow()
        instance.current_step_id = None
        
        document.status = "approved"
        document.approved_by = current_user.id
        document.approved_at = datetime.utcnow()
        
        if instance.template.auto_publish_on_complete:
            document.status = "published"
            document.published_by = current_user.id
            document.published_at = datetime.utcnow()
            
            create_audit_log(
                db=db,
                document_id=document_id,
                tenant_id=document.tenant_id,
                user_id=current_user.id,
                action="workflow_completed_published",
                action_details=f"Workflow completed. Document auto-published."
            )
        else:
            create_audit_log(
                db=db,
                document_id=document_id,
                tenant_id=document.tenant_id,
                user_id=current_user.id,
                action="workflow_completed",
                action_details=f"Workflow completed. Final step '{current_step.name}' approved."
            )
    
    document.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(instance)
    
    return serialize_workflow_instance(instance, document, db, include_steps=True, include_actions=True)


@router.post("/{document_id}/workflow/reject")
def reject_workflow_step(
    document_id: int,
    request: WorkflowActionRequest = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).options(
        joinedload(GovernanceDocument.owner),
        joinedload(GovernanceDocument.workflow_instance).joinedload(DocumentWorkflowInstance.template).joinedload(WorkflowTemplate.steps)
    ).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    instance = document.workflow_instance
    if not instance or instance.status != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Document has no active workflow"
        )
    
    current_step = db.query(WorkflowStep).options(
        joinedload(WorkflowStep.approvers).joinedload(WorkflowStepApprover.user),
        joinedload(WorkflowStep.approvers).joinedload(WorkflowStepApprover.role)
    ).filter(WorkflowStep.id == instance.current_step_id).first()
    
    if not current_step:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Current workflow step not found"
        )
    
    if not is_user_authorized_approver(current_user, current_step, document, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to reject this step"
        )
    
    action = DocumentWorkflowAction(
        instance_id=instance.id,
        step_id=current_step.id,
        action="reject",
        action_by=current_user.id,
        action_at=datetime.utcnow(),
        comments=request.comments if request else None,
        step_sequence=current_step.sequence,
        step_name=current_step.name
    )
    db.add(action)
    
    on_reject = current_step.on_reject_action or "return_to_draft"
    
    if on_reject == "return_to_draft":
        instance.status = "cancelled"
        instance.completed_at = datetime.utcnow()
        document.status = "draft"
        
        create_audit_log(
            db=db,
            document_id=document_id,
            tenant_id=document.tenant_id,
            user_id=current_user.id,
            action="workflow_rejected",
            action_details=f"Step '{current_step.name}' rejected. Document returned to draft."
        )
    elif on_reject == "return_to_previous":
        all_steps = sorted(instance.template.steps, key=lambda s: s.sequence)
        current_index = next(
            (i for i, s in enumerate(all_steps) if s.id == current_step.id),
            -1
        )
        
        if current_index > 0:
            prev_step = all_steps[current_index - 1]
            instance.current_step_id = prev_step.id
            instance.current_step_sequence = prev_step.sequence
            
            create_audit_log(
                db=db,
                document_id=document_id,
                tenant_id=document.tenant_id,
                user_id=current_user.id,
                action="workflow_rejected",
                action_details=f"Step '{current_step.name}' rejected. Returned to step: {prev_step.name}"
            )
        else:
            instance.status = "cancelled"
            instance.completed_at = datetime.utcnow()
            document.status = "draft"
            
            create_audit_log(
                db=db,
                document_id=document_id,
                tenant_id=document.tenant_id,
                user_id=current_user.id,
                action="workflow_rejected",
                action_details=f"First step '{current_step.name}' rejected. Document returned to draft."
            )
    elif on_reject == "cancel":
        instance.status = "cancelled"
        instance.completed_at = datetime.utcnow()
        document.status = "draft"
        
        create_audit_log(
            db=db,
            document_id=document_id,
            tenant_id=document.tenant_id,
            user_id=current_user.id,
            action="workflow_cancelled",
            action_details=f"Workflow cancelled due to rejection at step '{current_step.name}'."
        )
    
    document.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(instance)
    
    return serialize_workflow_instance(instance, document, db, include_steps=True, include_actions=True)


@router.get("/{document_id}/workflow")
def get_workflow_status(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).options(
        joinedload(GovernanceDocument.owner),
        joinedload(GovernanceDocument.workflow_instance).joinedload(DocumentWorkflowInstance.template).joinedload(WorkflowTemplate.steps).joinedload(WorkflowStep.approvers).joinedload(WorkflowStepApprover.user),
        joinedload(GovernanceDocument.workflow_instance).joinedload(DocumentWorkflowInstance.template).joinedload(WorkflowTemplate.steps).joinedload(WorkflowStep.approvers).joinedload(WorkflowStepApprover.role),
        joinedload(GovernanceDocument.workflow_instance).joinedload(DocumentWorkflowInstance.actions).joinedload(DocumentWorkflowAction.actor),
        joinedload(GovernanceDocument.workflow_instance).joinedload(DocumentWorkflowInstance.current_step),
        joinedload(GovernanceDocument.workflow_instance).joinedload(DocumentWorkflowInstance.initiator)
    ).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    if not document.workflow_instance:
        return {
            "has_workflow": False,
            "document_id": document_id,
            "document_title": document.title,
            "document_status": document.status
        }
    
    instance = document.workflow_instance
    result = serialize_workflow_instance(instance, document, db, include_steps=True, include_actions=True)
    result["has_workflow"] = True
    result["document_title"] = document.title
    result["document_status"] = document.status
    
    if instance.current_step:
        result["can_current_user_approve"] = is_user_authorized_approver(
            current_user, instance.current_step, document, db
        )
    else:
        result["can_current_user_approve"] = False
    
    return result


@router.get("/workflows/my-pending")
def get_my_pending_approvals(
    tenant_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        filter_tenants = [tenant_id]
    else:
        filter_tenants = user_tenants
    
    user_role_ids = get_user_role_ids(current_user, db)
    
    instances = db.query(DocumentWorkflowInstance).options(
        joinedload(DocumentWorkflowInstance.document).joinedload(GovernanceDocument.owner),
        joinedload(DocumentWorkflowInstance.template),
        joinedload(DocumentWorkflowInstance.current_step).joinedload(WorkflowStep.approvers).joinedload(WorkflowStepApprover.user),
        joinedload(DocumentWorkflowInstance.current_step).joinedload(WorkflowStep.approvers).joinedload(WorkflowStepApprover.role),
        joinedload(DocumentWorkflowInstance.initiator)
    ).join(GovernanceDocument).filter(
        DocumentWorkflowInstance.status == "active",
        GovernanceDocument.tenant_id.in_(filter_tenants)
    ).all()
    
    pending_items = []
    for instance in instances:
        if not instance.current_step:
            continue
        
        document = instance.document
        is_approver = False
        
        for approver in instance.current_step.approvers:
            if approver.approver_type == "user" and approver.user_id == current_user.id:
                is_approver = True
                break
            elif approver.approver_type == "role" and approver.role_id in user_role_ids:
                is_approver = True
                break
            elif approver.approver_type == "document_owner" and document.owner_id == current_user.id:
                is_approver = True
                break
        
        if is_approver:
            pending_items.append({
                "workflow_instance_id": instance.id,
                "document_id": document.id,
                "document_title": document.title,
                "document_code": document.document_code,
                "doc_type": document.doc_type,
                "document_status": document.status,
                "owner_name": document.owner.display_name if document.owner else None,
                "template_name": instance.template.name if instance.template else None,
                "current_step_id": instance.current_step_id,
                "current_step_name": instance.current_step.name,
                "current_step_sequence": instance.current_step_sequence,
                "workflow_started_at": instance.started_at.isoformat() if instance.started_at else None,
                "started_by_name": instance.initiator.display_name if instance.initiator else None,
                "approvers": get_approvers_for_step(instance.current_step, document, db)
            })
    
    total = len(pending_items)
    paginated_items = pending_items[skip:skip + limit]
    
    return {
        "items": paginated_items,
        "total": total,
        "skip": skip,
        "limit": limit
    }
