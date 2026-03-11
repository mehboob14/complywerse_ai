from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ....models import (
    ApprovalRequest,
    Role,
    UserRole,
    WorkflowDefinition,
    WorkflowInstance,
    WorkflowEngineStep,
    GRCUser,
    get_db,
)
from ....routers.auth_router import require_auth, get_user_primary_tenant, get_user_tenants, require_tenant_permission
from ..schemas import (
    ApprovalDecisionRequest,
    TriggerExecutionRequest,
    WorkflowInstanceResponse,
)
from ..services.runtime import get_runtime

router = APIRouter(prefix="/executions", tags=["Workflow Engine Executions"])


@router.post("/trigger", status_code=status.HTTP_202_ACCEPTED)
def trigger_workflow_execution(
    payload: TriggerExecutionRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:executions:create")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User is not assigned to any tenant")

    runtime = get_runtime()
    runtime.event_queue.publish(
        {
            "kind": "start_instance",
            "workflow_definition_id": payload.workflow_definition_id,
            "tenant_id": tenant_id,
            "trigger_event": "manual.trigger",
            "trigger_payload": payload.payload,
            "correlation_id": payload.correlation_id,
        }
    )

    return {
        "status": "queued",
        "workflow_definition_id": payload.workflow_definition_id,
        "tenant_id": tenant_id,
    }


@router.get("/instances", response_model=list[WorkflowInstanceResponse])
def list_workflow_instances(
    status_filter: str | None = None,
    workflow_definition_id: int | None = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:executions:view")),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    query = db.query(WorkflowInstance).filter(WorkflowInstance.tenant_id.in_(user_tenants))
    if status_filter:
        query = query.filter(WorkflowInstance.status == status_filter)
    if workflow_definition_id:
        query = query.filter(WorkflowInstance.workflow_definition_id == workflow_definition_id)

    instances = query.order_by(WorkflowInstance.started_at.desc()).limit(200).all()
    return [
        WorkflowInstanceResponse(
            id=item.id,
            workflow_definition_id=item.workflow_definition_id,
            tenant_id=item.tenant_id,
            status=item.status,
            current_node_key=item.current_node_key,
            trigger_event=item.trigger_event,
            trigger_payload=item.trigger_payload or {},
            context=item.context or {},
            correlation_id=item.correlation_id,
            started_at=item.started_at,
            completed_at=item.completed_at,
            failed_at=item.failed_at,
            error_message=item.error_message,
        )
        for item in instances
    ]


@router.get("/instances/{instance_id}")
def get_workflow_instance(
    instance_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:executions:view")),
):
    user_tenants = get_user_tenants(current_user, db)

    instance = db.query(WorkflowInstance).filter(
        WorkflowInstance.id == instance_id,
        WorkflowInstance.tenant_id.in_(user_tenants),
    ).first()
    if not instance:
        raise HTTPException(status_code=404, detail="Workflow instance not found")

    steps = db.query(WorkflowEngineStep).filter(
        WorkflowEngineStep.workflow_instance_id == instance.id
    ).order_by(WorkflowEngineStep.id.asc()).all()

    return {
        "instance": WorkflowInstanceResponse(
            id=instance.id,
            workflow_definition_id=instance.workflow_definition_id,
            tenant_id=instance.tenant_id,
            status=instance.status,
            current_node_key=instance.current_node_key,
            trigger_event=instance.trigger_event,
            trigger_payload=instance.trigger_payload or {},
            context=instance.context or {},
            correlation_id=instance.correlation_id,
            started_at=instance.started_at,
            completed_at=instance.completed_at,
            failed_at=instance.failed_at,
            error_message=instance.error_message,
        ).model_dump(),
        "steps": [
            {
                "id": step.id,
                "node_key": step.node_key,
                "node_type": step.node_type,
                "status": step.status,
                "input_payload": step.input_payload or {},
                "output_payload": step.output_payload or {},
                "attempts": step.attempts,
                "next_run_at": step.next_run_at,
                "started_at": step.started_at,
                "completed_at": step.completed_at,
                "error_message": step.error_message,
            }
            for step in steps
        ],
    }


@router.post("/instances/{instance_id}/resume", status_code=status.HTTP_202_ACCEPTED)
def resume_workflow_instance(
    instance_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:executions:edit")),
):
    user_tenants = get_user_tenants(current_user, db)
    instance = db.query(WorkflowInstance).filter(
        WorkflowInstance.id == instance_id,
        WorkflowInstance.tenant_id.in_(user_tenants),
    ).first()

    if not instance:
        raise HTTPException(status_code=404, detail="Workflow instance not found")

    runtime = get_runtime()
    runtime.event_queue.publish({"kind": "resume_instance", "instance_id": instance.id})
    return {"status": "queued", "instance_id": instance.id}


@router.post("/approvals/{approval_request_id}/decision")
def decide_approval_request(
    approval_request_id: int,
    payload: ApprovalDecisionRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:executions:approve")),
):
    user_tenants = get_user_tenants(current_user, db)

    approval = db.query(ApprovalRequest).filter(
        ApprovalRequest.id == approval_request_id,
        ApprovalRequest.tenant_id.in_(user_tenants),
    ).first()
    if not approval:
        raise HTTPException(status_code=404, detail="Approval request not found")

    if approval.status != "pending":
        raise HTTPException(status_code=400, detail="Approval request already decided")

    # Restrict decisions to the assigned approver user.
    if approval.approver_user_id and approval.approver_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You are not assigned to this approval request")

    # If request is role-scoped, enforce role membership.
    if approval.approver_user_id is None and approval.approver_role:
        role = db.query(Role).filter(
            Role.tenant_id == approval.tenant_id,
            Role.name == approval.approver_role,
        ).first()
        if role:
            is_member = db.query(UserRole).filter(
                UserRole.tenant_id == approval.tenant_id,
                UserRole.role_id == role.id,
                UserRole.user_id == current_user.id,
            ).first()
            if not is_member:
                raise HTTPException(status_code=403, detail="You are not authorized for this role-based approval")

    approval.status = "approved" if payload.decision == "approve" else "rejected"
    approval.responded_at = datetime.utcnow()
    approval.decision_comment = payload.comment

    if approval.approver_user_id is None:
        approval.approver_user_id = current_user.id

    if payload.decision == "approve":
        approval.received_approvals = (approval.received_approvals or 0) + 1
    else:
        step = db.query(WorkflowEngineStep).filter(WorkflowEngineStep.id == approval.workflow_step_id).first()
        if step:
            step.status = "failed"

    db.commit()

    runtime = get_runtime()
    runtime.event_queue.publish({"kind": "resume_instance", "instance_id": approval.workflow_instance_id})

    return {
        "status": approval.status,
        "approval_request_id": approval.id,
        "workflow_instance_id": approval.workflow_instance_id,
    }


@router.get("/approvals/inbox")
def list_my_approval_inbox(
    status_filter: str = "pending",
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:executions:view")),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": []}

    query = db.query(ApprovalRequest).filter(
        ApprovalRequest.tenant_id.in_(user_tenants),
        ApprovalRequest.approver_user_id == current_user.id,
    )
    if status_filter:
        query = query.filter(ApprovalRequest.status == status_filter)

    approvals = query.order_by(ApprovalRequest.created_at.desc()).limit(200).all()

    instance_ids = [item.workflow_instance_id for item in approvals]
    instances = db.query(WorkflowInstance).filter(WorkflowInstance.id.in_(instance_ids)).all() if instance_ids else []
    instance_map = {item.id: item for item in instances}

    definition_ids = [item.workflow_definition_id for item in instances]
    definitions = db.query(WorkflowDefinition).filter(WorkflowDefinition.id.in_(definition_ids)).all() if definition_ids else []
    definition_map = {item.id: item for item in definitions}

    return {
        "items": [
            {
                "approval_request_id": item.id,
                "status": item.status,
                "approval_type": item.approval_type,
                "required_approvals": item.required_approvals,
                "received_approvals": item.received_approvals,
                "due_at": item.due_at,
                "created_at": item.created_at,
                "workflow_instance_id": item.workflow_instance_id,
                "workflow_step_id": item.workflow_step_id,
                "workflow_definition_id": instance_map.get(item.workflow_instance_id).workflow_definition_id if instance_map.get(item.workflow_instance_id) else None,
                "workflow_name": (
                    definition_map.get(instance_map.get(item.workflow_instance_id).workflow_definition_id).name
                    if instance_map.get(item.workflow_instance_id)
                    and definition_map.get(instance_map.get(item.workflow_instance_id).workflow_definition_id)
                    else None
                ),
                "trigger_event": instance_map.get(item.workflow_instance_id).trigger_event if instance_map.get(item.workflow_instance_id) else None,
                "trigger_payload": instance_map.get(item.workflow_instance_id).trigger_payload if instance_map.get(item.workflow_instance_id) else {},
            }
            for item in approvals
        ]
    }
