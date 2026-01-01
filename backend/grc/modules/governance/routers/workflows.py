from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_, and_
from pydantic import BaseModel

from ....models import (
    GovernanceDocument, DocumentApprovalStep, DocumentReviewer,
    DocumentAuditLog, GRCUser, get_db
)
from ....routers.auth_router import require_auth, get_user_tenants

router = APIRouter(prefix="/workflows", tags=["Governance - Workflows"])


class SubmitForApprovalRequest(BaseModel):
    document_id: int
    due_days: int = 7
    message: Optional[str] = None


class ApprovalActionRequest(BaseModel):
    comments: Optional[str] = None


class DelegateRequest(BaseModel):
    delegate_to_user_id: int
    reason: Optional[str] = None


class EscalateRequest(BaseModel):
    escalate_to_user_id: int
    reason: Optional[str] = None


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
    action_details: Optional[str] = None,
    field_changed: Optional[str] = None,
    old_value: Optional[str] = None,
    new_value: Optional[str] = None
) -> DocumentAuditLog:
    audit_log = DocumentAuditLog(
        document_id=document_id,
        tenant_id=tenant_id,
        action=action,
        action_details=action_details,
        field_changed=field_changed,
        old_value=old_value,
        new_value=new_value,
        performed_by=user_id,
        performed_at=datetime.utcnow()
    )
    db.add(audit_log)
    return audit_log


def serialize_approval_step(step: DocumentApprovalStep) -> dict:
    return {
        "id": step.id,
        "document_id": step.document_id,
        "version_id": step.version_id,
        "step_sequence": step.step_sequence,
        "step_name": step.step_name,
        "approval_type": step.approval_type,
        "approver_id": step.approver_id,
        "approver_name": step.approver.display_name if step.approver else None,
        "approver_role": step.approver_role,
        "status": step.status,
        "requested_at": step.requested_at.isoformat() if step.requested_at else None,
        "due_date": step.due_date.isoformat() if step.due_date else None,
        "completed_at": step.completed_at.isoformat() if step.completed_at else None,
        "comments": step.comments,
        "delegated_to": step.delegated_to,
        "delegated_to_name": step.delegate.display_name if step.delegate else None,
        "delegated_at": step.delegated_at.isoformat() if step.delegated_at else None,
        "delegation_reason": step.delegation_reason,
    }


def serialize_pending_approval(step: DocumentApprovalStep, document: GovernanceDocument) -> dict:
    return {
        "step_id": step.id,
        "document_id": document.id,
        "document_title": document.title,
        "document_code": document.document_code,
        "doc_type": document.doc_type,
        "step_sequence": step.step_sequence,
        "step_name": step.step_name,
        "requested_at": step.requested_at.isoformat() if step.requested_at else None,
        "due_date": step.due_date.isoformat() if step.due_date else None,
        "is_overdue": step.due_date < datetime.utcnow() if step.due_date else False,
        "owner_name": document.owner.display_name if document.owner else None,
    }


@router.get("/pending")
def list_pending_approvals(
    tenant_id: Optional[int] = None,
    include_delegated: bool = True,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    
    query = db.query(DocumentApprovalStep).options(
        joinedload(DocumentApprovalStep.document).joinedload(GovernanceDocument.owner),
        joinedload(DocumentApprovalStep.approver),
        joinedload(DocumentApprovalStep.delegate)
    ).join(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        DocumentApprovalStep.status == "pending"
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    
    if include_delegated:
        query = query.filter(
            or_(
                DocumentApprovalStep.approver_id == current_user.id,
                DocumentApprovalStep.delegated_to == current_user.id
            )
        )
    else:
        query = query.filter(DocumentApprovalStep.approver_id == current_user.id)
    
    total = query.count()
    steps = query.order_by(DocumentApprovalStep.due_date.asc().nulls_last()).offset(skip).limit(limit).all()
    
    return {
        "items": [serialize_pending_approval(step, step.document) for step in steps],
        "total": total,
        "skip": skip,
        "limit": limit
    }


@router.get("/documents/{document_id}/steps")
def get_approval_steps(
    document_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    steps = db.query(DocumentApprovalStep).options(
        joinedload(DocumentApprovalStep.approver),
        joinedload(DocumentApprovalStep.delegate)
    ).filter(
        DocumentApprovalStep.document_id == document_id
    ).order_by(DocumentApprovalStep.step_sequence).all()
    
    return {
        "document_id": document_id,
        "document_title": document.title,
        "document_status": document.status,
        "steps": [serialize_approval_step(step) for step in steps]
    }


@router.post("/submit")
def submit_for_approval(
    request: SubmitForApprovalRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == request.document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    if document.status not in ["draft", "pending_review"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Document cannot be submitted for approval in '{document.status}' status"
        )
    
    approvers = db.query(DocumentReviewer).filter(
        DocumentReviewer.document_id == request.document_id,
        DocumentReviewer.role_type == "approver"
    ).order_by(DocumentReviewer.sequence).all()
    
    if not approvers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No approvers assigned to this document. Please add approvers first."
        )
    
    existing_pending = db.query(DocumentApprovalStep).filter(
        DocumentApprovalStep.document_id == request.document_id,
        DocumentApprovalStep.status == "pending"
    ).first()
    
    if existing_pending:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Document already has pending approval steps"
        )
    
    due_date = datetime.utcnow() + timedelta(days=request.due_days)
    
    created_steps = []
    for idx, reviewer in enumerate(approvers, start=1):
        step = DocumentApprovalStep(
            document_id=document.id,
            step_sequence=idx,
            step_name=f"Approval Step {idx}",
            approval_type="single",
            approver_id=reviewer.user_id,
            approver_role=reviewer.role_type,
            status="pending",
            requested_at=datetime.utcnow(),
            due_date=due_date
        )
        db.add(step)
        created_steps.append(step)
    
    document.status = "pending_approval"
    document.updated_at = datetime.utcnow()
    
    create_audit_log(
        db=db,
        document_id=document.id,
        tenant_id=document.tenant_id,
        user_id=current_user.id,
        action="submitted",
        action_details=f"Document submitted for approval. {len(created_steps)} approval steps created."
    )
    
    db.commit()
    
    return {
        "message": "Document submitted for approval",
        "document_id": document.id,
        "steps_created": len(created_steps),
        "due_date": due_date.isoformat()
    }


@router.post("/steps/{step_id}/approve")
def approve_step(
    step_id: int,
    request: ApprovalActionRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    step = db.query(DocumentApprovalStep).options(
        joinedload(DocumentApprovalStep.document)
    ).filter(
        DocumentApprovalStep.id == step_id
    ).first()
    
    if not step:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval step not found"
        )
    
    if step.document.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    actual_approver_id = step.delegated_to if step.delegated_to else step.approver_id
    if actual_approver_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to approve this step"
        )
    
    if step.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Step cannot be approved in '{step.status}' status"
        )
    
    step.status = "approved"
    step.completed_at = datetime.utcnow()
    step.comments = request.comments
    
    create_audit_log(
        db=db,
        document_id=step.document_id,
        tenant_id=step.document.tenant_id,
        user_id=current_user.id,
        action="approved",
        action_details=f"Approval step {step.step_sequence} approved. Comments: {request.comments or 'None'}"
    )
    
    all_steps = db.query(DocumentApprovalStep).filter(
        DocumentApprovalStep.document_id == step.document_id
    ).all()
    
    all_approved = all(s.status == "approved" for s in all_steps)
    
    if all_approved:
        document = step.document
        document.status = "approved"
        document.approved_by = current_user.id
        document.approved_at = datetime.utcnow()
        document.updated_at = datetime.utcnow()
        
        create_audit_log(
            db=db,
            document_id=document.id,
            tenant_id=document.tenant_id,
            user_id=current_user.id,
            action="approved",
            action_details="All approval steps completed. Document approved."
        )
    
    db.commit()
    
    return {
        "message": "Step approved successfully",
        "step_id": step_id,
        "all_steps_complete": all_approved,
        "document_status": step.document.status
    }


@router.post("/steps/{step_id}/reject")
def reject_step(
    step_id: int,
    request: ApprovalActionRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    step = db.query(DocumentApprovalStep).options(
        joinedload(DocumentApprovalStep.document)
    ).filter(
        DocumentApprovalStep.id == step_id
    ).first()
    
    if not step:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval step not found"
        )
    
    if step.document.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    actual_approver_id = step.delegated_to if step.delegated_to else step.approver_id
    if actual_approver_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to reject this step"
        )
    
    if step.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Step cannot be rejected in '{step.status}' status"
        )
    
    if not request.comments:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Comments are required when rejecting"
        )
    
    step.status = "rejected"
    step.completed_at = datetime.utcnow()
    step.comments = request.comments
    
    document = step.document
    document.status = "draft"
    document.updated_at = datetime.utcnow()
    
    other_pending = db.query(DocumentApprovalStep).filter(
        DocumentApprovalStep.document_id == step.document_id,
        DocumentApprovalStep.id != step_id,
        DocumentApprovalStep.status == "pending"
    ).all()
    
    for other_step in other_pending:
        other_step.status = "skipped"
        other_step.completed_at = datetime.utcnow()
        other_step.comments = "Skipped due to rejection of another step"
    
    create_audit_log(
        db=db,
        document_id=document.id,
        tenant_id=document.tenant_id,
        user_id=current_user.id,
        action="rejected",
        action_details=f"Approval step {step.step_sequence} rejected. Document returned to draft. Reason: {request.comments}"
    )
    
    db.commit()
    
    return {
        "message": "Step rejected successfully",
        "step_id": step_id,
        "document_status": document.status
    }


@router.post("/steps/{step_id}/delegate")
def delegate_approval(
    step_id: int,
    request: DelegateRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    step = db.query(DocumentApprovalStep).options(
        joinedload(DocumentApprovalStep.document)
    ).filter(
        DocumentApprovalStep.id == step_id
    ).first()
    
    if not step:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval step not found"
        )
    
    if step.document.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    if step.approver_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the original approver can delegate"
        )
    
    if step.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Step cannot be delegated in '{step.status}' status"
        )
    
    delegate_user = db.query(GRCUser).filter(
        GRCUser.id == request.delegate_to_user_id,
        GRCUser.is_active == True
    ).first()
    
    if not delegate_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Delegate user not found or inactive"
        )
    
    if request.delegate_to_user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delegate to yourself"
        )
    
    step.delegated_to = request.delegate_to_user_id
    step.delegated_at = datetime.utcnow()
    step.delegation_reason = request.reason
    step.status = "delegated"
    
    new_step = DocumentApprovalStep(
        document_id=step.document_id,
        version_id=step.version_id,
        step_sequence=step.step_sequence,
        step_name=f"{step.step_name} (Delegated)",
        approval_type=step.approval_type,
        approver_id=request.delegate_to_user_id,
        approver_role=step.approver_role,
        status="pending",
        requested_at=datetime.utcnow(),
        due_date=step.due_date
    )
    db.add(new_step)
    
    create_audit_log(
        db=db,
        document_id=step.document_id,
        tenant_id=step.document.tenant_id,
        user_id=current_user.id,
        action="delegated",
        action_details=f"Approval step {step.step_sequence} delegated from {current_user.display_name} to {delegate_user.display_name}. Reason: {request.reason or 'None'}"
    )
    
    db.commit()
    db.refresh(new_step)
    
    return {
        "message": "Approval delegated successfully",
        "original_step_id": step_id,
        "new_step_id": new_step.id,
        "delegated_to": delegate_user.display_name
    }


@router.post("/steps/{step_id}/escalate")
def escalate_approval(
    step_id: int,
    request: EscalateRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    step = db.query(DocumentApprovalStep).options(
        joinedload(DocumentApprovalStep.document)
    ).filter(
        DocumentApprovalStep.id == step_id
    ).first()
    
    if not step:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval step not found"
        )
    
    if step.document.tenant_id not in user_tenants:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    if step.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Step cannot be escalated in '{step.status}' status"
        )
    
    escalate_user = db.query(GRCUser).filter(
        GRCUser.id == request.escalate_to_user_id,
        GRCUser.is_active == True
    ).first()
    
    if not escalate_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Escalation user not found or inactive"
        )
    
    original_approver_name = step.approver.display_name if step.approver else "Unknown"
    
    step.status = "skipped"
    step.completed_at = datetime.utcnow()
    step.comments = f"Escalated to {escalate_user.display_name}. Reason: {request.reason or 'Overdue'}"
    
    escalated_step = DocumentApprovalStep(
        document_id=step.document_id,
        version_id=step.version_id,
        step_sequence=step.step_sequence,
        step_name=f"{step.step_name} (Escalated)",
        approval_type=step.approval_type,
        approver_id=request.escalate_to_user_id,
        approver_role="escalated_approver",
        status="pending",
        requested_at=datetime.utcnow(),
        due_date=datetime.utcnow() + timedelta(days=3)
    )
    db.add(escalated_step)
    
    create_audit_log(
        db=db,
        document_id=step.document_id,
        tenant_id=step.document.tenant_id,
        user_id=current_user.id,
        action="escalated",
        action_details=f"Approval step escalated from {original_approver_name} to {escalate_user.display_name}. Reason: {request.reason or 'Overdue'}"
    )
    
    db.commit()
    db.refresh(escalated_step)
    
    return {
        "message": "Approval escalated successfully",
        "original_step_id": step_id,
        "escalated_step_id": escalated_step.id,
        "escalated_to": escalate_user.display_name
    }


@router.get("/documents/{document_id}/history")
def get_workflow_history(
    document_id: int,
    action_filter: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    
    document = db.query(GovernanceDocument).filter(
        GovernanceDocument.id == document_id,
        GovernanceDocument.tenant_id.in_(user_tenants)
    ).first()
    
    if not document:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found"
        )
    
    query = db.query(DocumentAuditLog).options(
        joinedload(DocumentAuditLog.user)
    ).filter(
        DocumentAuditLog.document_id == document_id
    )
    
    if action_filter:
        query = query.filter(DocumentAuditLog.action == action_filter)
    
    total = query.count()
    
    logs = query.order_by(DocumentAuditLog.performed_at.desc()).offset(skip).limit(limit).all()
    
    return {
        "document_id": document_id,
        "document_title": document.title,
        "total": total,
        "skip": skip,
        "limit": limit,
        "history": [
            {
                "id": log.id,
                "action": log.action,
                "action_details": log.action_details,
                "field_changed": log.field_changed,
                "old_value": log.old_value,
                "new_value": log.new_value,
                "performed_by": log.performed_by,
                "performed_by_name": log.user.display_name if log.user else None,
                "performed_at": log.performed_at.isoformat() if log.performed_at else None,
                "ip_address": log.ip_address
            }
            for log in logs
        ]
    }


@router.get("/dashboard")
def get_workflow_dashboard(
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {
            "pending_my_approval": 0,
            "pending_all": 0,
            "overdue": 0,
            "approved_today": 0,
            "rejected_today": 0,
            "documents_awaiting_approval": 0
        }
    
    base_query = db.query(DocumentApprovalStep).join(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(user_tenants)
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        base_query = base_query.filter(GovernanceDocument.tenant_id == tenant_id)
    
    pending_my = base_query.filter(
        DocumentApprovalStep.status == "pending",
        or_(
            DocumentApprovalStep.approver_id == current_user.id,
            DocumentApprovalStep.delegated_to == current_user.id
        )
    ).count()
    
    pending_all = base_query.filter(
        DocumentApprovalStep.status == "pending"
    ).count()
    
    overdue = base_query.filter(
        DocumentApprovalStep.status == "pending",
        DocumentApprovalStep.due_date < datetime.utcnow()
    ).count()
    
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    
    approved_today = base_query.filter(
        DocumentApprovalStep.status == "approved",
        DocumentApprovalStep.completed_at >= today_start
    ).count()
    
    rejected_today = base_query.filter(
        DocumentApprovalStep.status == "rejected",
        DocumentApprovalStep.completed_at >= today_start
    ).count()
    
    docs_query = db.query(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        GovernanceDocument.status == "pending_approval"
    )
    if tenant_id:
        docs_query = docs_query.filter(GovernanceDocument.tenant_id == tenant_id)
    docs_awaiting = docs_query.count()
    
    return {
        "pending_my_approval": pending_my,
        "pending_all": pending_all,
        "overdue": overdue,
        "approved_today": approved_today,
        "rejected_today": rejected_today,
        "documents_awaiting_approval": docs_awaiting
    }


@router.get("/overdue")
def list_overdue_approvals(
    tenant_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0, "skip": skip, "limit": limit}
    
    query = db.query(DocumentApprovalStep).options(
        joinedload(DocumentApprovalStep.document).joinedload(GovernanceDocument.owner),
        joinedload(DocumentApprovalStep.approver)
    ).join(GovernanceDocument).filter(
        GovernanceDocument.tenant_id.in_(user_tenants),
        DocumentApprovalStep.status == "pending",
        DocumentApprovalStep.due_date < datetime.utcnow()
    )
    
    if tenant_id:
        validate_tenant_access(current_user, tenant_id, db)
        query = query.filter(GovernanceDocument.tenant_id == tenant_id)
    
    total = query.count()
    steps = query.order_by(DocumentApprovalStep.due_date.asc()).offset(skip).limit(limit).all()
    
    return {
        "items": [
            {
                **serialize_pending_approval(step, step.document),
                "days_overdue": (datetime.utcnow() - step.due_date).days if step.due_date else 0
            }
            for step in steps
        ],
        "total": total,
        "skip": skip,
        "limit": limit
    }
