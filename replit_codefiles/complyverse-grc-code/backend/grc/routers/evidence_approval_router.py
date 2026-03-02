from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session

from ..models import (
    EvidenceApprovalWorkflow, EvidenceApprovalStep, Evidence, GRCUser, TenantUser, get_db
)
from .auth_router import require_auth, get_user_tenants, get_user_primary_tenant

router = APIRouter(prefix="/evidence-approvals", tags=["Evidence Approvals"])


@router.post("/evidence/{evidence_id}/workflow", status_code=status.HTTP_201_CREATED)
def create_workflow(
    evidence_id: int,
    data: dict,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    if not evidence:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence not found")

    existing = db.query(EvidenceApprovalWorkflow).filter(
        EvidenceApprovalWorkflow.evidence_id == evidence_id,
        EvidenceApprovalWorkflow.status.in_(["pending", "in_progress"])
    ).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="An active workflow already exists for this evidence")

    reviewer_ids = data.get("reviewer_ids", [])
    if not reviewer_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one reviewer is required")

    # Validate all reviewers exist and are in user's tenants
    for reviewer_id in reviewer_ids:
        reviewer = db.query(GRCUser).filter(GRCUser.id == reviewer_id).first()
        if not reviewer:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Reviewer with ID {reviewer_id} not found")
        
        # Check reviewer is in at least one of the user's tenants
        reviewer_in_tenant = db.query(TenantUser).filter(
            TenantUser.user_id == reviewer_id,
            TenantUser.tenant_id.in_(user_tenants)
        ).first()
        if not reviewer_in_tenant:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Reviewer {reviewer_id} is not in your organization")

    workflow = EvidenceApprovalWorkflow(
        tenant_id=evidence.tenant_id,
        evidence_id=evidence_id,
        name=data.get("name", f"Approval for {evidence.name}"),
        status="pending",
        created_by=current_user.id
    )
    db.add(workflow)
    db.flush()

    for i, reviewer_id in enumerate(reviewer_ids):
        reviewer = db.query(GRCUser).filter(GRCUser.id == reviewer_id).first()
        if not reviewer:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Reviewer {reviewer_id} not found")

        step = EvidenceApprovalStep(
            workflow_id=workflow.id,
            step_order=i + 1,
            reviewer_id=reviewer_id,
            status="pending"
        )
        db.add(step)

    db.commit()
    db.refresh(workflow)
    return _workflow_to_dict(workflow, db)


@router.get("/evidence/{evidence_id}/workflow")
def get_evidence_workflow(
    evidence_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)

    evidence = db.query(Evidence).filter(
        Evidence.id == evidence_id,
        Evidence.tenant_id.in_(user_tenants)
    ).first()
    if not evidence:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evidence not found")

    workflow = db.query(EvidenceApprovalWorkflow).filter(
        EvidenceApprovalWorkflow.evidence_id == evidence_id
    ).order_by(EvidenceApprovalWorkflow.created_at.desc()).first()

    if not workflow:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No workflow found for this evidence")

    return _workflow_to_dict(workflow, db)


@router.get("/my-reviews")
def get_my_reviews(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    pending_steps = db.query(EvidenceApprovalStep).join(EvidenceApprovalWorkflow).filter(
        EvidenceApprovalWorkflow.tenant_id.in_(user_tenants),
        EvidenceApprovalStep.reviewer_id == current_user.id,
        EvidenceApprovalStep.status == "pending",
        EvidenceApprovalWorkflow.status.in_(["pending", "in_progress"])
    ).all()

    result = []
    for step in pending_steps:
        workflow = step.workflow
        evidence = db.query(Evidence).filter(Evidence.id == workflow.evidence_id).first()

        prev_steps = db.query(EvidenceApprovalStep).filter(
            EvidenceApprovalStep.workflow_id == workflow.id,
            EvidenceApprovalStep.step_order < step.step_order
        ).all()
        all_prev_approved = all(s.status == "approved" for s in prev_steps)

        result.append({
            "step_id": step.id,
            "workflow_id": workflow.id,
            "workflow_name": workflow.name,
            "evidence_id": workflow.evidence_id,
            "evidence_name": evidence.name if evidence else None,
            "step_order": step.step_order,
            "status": step.status,
            "is_actionable": all_prev_approved,
            "created_at": step.created_at.isoformat() if step.created_at else None
        })

    return result


@router.post("/steps/{step_id}/approve")
def approve_step(
    step_id: int,
    data: dict = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if data is None:
        data = {}
    return _process_step(step_id, "approved", data.get("comments"), current_user, db)


@router.post("/steps/{step_id}/reject")
def reject_step(
    step_id: int,
    data: dict = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if data is None:
        data = {}
    return _process_step(step_id, "rejected", data.get("comments"), current_user, db)


@router.post("/steps/{step_id}/request-changes")
def request_changes(
    step_id: int,
    data: dict = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    if data is None:
        data = {}
    return _process_step(step_id, "changes_requested", data.get("comments"), current_user, db)


@router.get("/workflows")
def list_workflows(
    status_filter: Optional[str] = Query(None, alias="status"),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    query = db.query(EvidenceApprovalWorkflow).filter(
        EvidenceApprovalWorkflow.tenant_id.in_(user_tenants)
    )

    if status_filter:
        query = query.filter(EvidenceApprovalWorkflow.status == status_filter)

    workflows = query.order_by(EvidenceApprovalWorkflow.created_at.desc()).offset(skip).limit(limit).all()
    return [_workflow_to_dict(w, db) for w in workflows]


@router.get("/workflows/{workflow_id}")
def get_workflow(
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    workflow = db.query(EvidenceApprovalWorkflow).filter(
        EvidenceApprovalWorkflow.id == workflow_id,
        EvidenceApprovalWorkflow.tenant_id.in_(user_tenants)
    ).first()
    if not workflow:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    return _workflow_to_dict(workflow, db)


@router.delete("/workflows/{workflow_id}", status_code=status.HTTP_204_NO_CONTENT)
def cancel_workflow(
    workflow_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth)
):
    user_tenants = get_user_tenants(current_user, db)
    workflow = db.query(EvidenceApprovalWorkflow).filter(
        EvidenceApprovalWorkflow.id == workflow_id,
        EvidenceApprovalWorkflow.tenant_id.in_(user_tenants)
    ).first()
    if not workflow:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")

    db.delete(workflow)
    db.commit()
    return None


def _process_step(step_id: int, new_status: str, comments: str, current_user: GRCUser, db: Session):
    user_tenants = get_user_tenants(current_user, db)

    step = db.query(EvidenceApprovalStep).join(EvidenceApprovalWorkflow).filter(
        EvidenceApprovalStep.id == step_id,
        EvidenceApprovalWorkflow.tenant_id.in_(user_tenants)
    ).first()
    if not step:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Step not found")
    if step.reviewer_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You are not the reviewer for this step")
    if step.status != "pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Step has already been processed")

    prev_steps = db.query(EvidenceApprovalStep).filter(
        EvidenceApprovalStep.workflow_id == step.workflow_id,
        EvidenceApprovalStep.step_order < step.step_order
    ).all()
    if not all(s.status == "approved" for s in prev_steps):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Previous steps must be approved first")

    step.status = new_status
    step.comments = comments
    step.reviewed_at = datetime.utcnow()

    workflow = step.workflow

    if new_status == "approved":
        workflow.status = "in_progress"
        all_steps = db.query(EvidenceApprovalStep).filter(
            EvidenceApprovalStep.workflow_id == workflow.id
        ).all()
        if all(s.status == "approved" for s in all_steps):
            workflow.status = "approved"
            workflow.completed_at = datetime.utcnow()
    elif new_status == "rejected":
        workflow.status = "rejected"
        workflow.completed_at = datetime.utcnow()
    elif new_status == "changes_requested":
        workflow.status = "in_progress"

    workflow.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(step)
    return _workflow_to_dict(workflow, db)


def _workflow_to_dict(workflow: EvidenceApprovalWorkflow, db: Session) -> dict:
    evidence = db.query(Evidence).filter(Evidence.id == workflow.evidence_id).first()
    creator = db.query(GRCUser).filter(GRCUser.id == workflow.created_by).first() if workflow.created_by else None

    steps = db.query(EvidenceApprovalStep).filter(
        EvidenceApprovalStep.workflow_id == workflow.id
    ).order_by(EvidenceApprovalStep.step_order.asc()).all()

    steps_list = []
    for s in steps:
        reviewer = db.query(GRCUser).filter(GRCUser.id == s.reviewer_id).first()
        steps_list.append({
            "id": s.id,
            "step_order": s.step_order,
            "reviewer_id": s.reviewer_id,
            "reviewer_name": (reviewer.display_name or reviewer.username) if reviewer else None,
            "status": s.status,
            "comments": s.comments,
            "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
            "created_at": s.created_at.isoformat() if s.created_at else None
        })

    return {
        "id": workflow.id,
        "tenant_id": workflow.tenant_id,
        "evidence_id": workflow.evidence_id,
        "evidence_name": evidence.name if evidence else None,
        "name": workflow.name,
        "status": workflow.status,
        "created_by": workflow.created_by,
        "creator_name": (creator.display_name or creator.username) if creator else None,
        "created_at": workflow.created_at.isoformat() if workflow.created_at else None,
        "updated_at": workflow.updated_at.isoformat() if workflow.updated_at else None,
        "completed_at": workflow.completed_at.isoformat() if workflow.completed_at else None,
        "steps": steps_list,
        "total_steps": len(steps_list),
        "completed_steps": sum(1 for s in steps_list if s["status"] == "approved")
    }
