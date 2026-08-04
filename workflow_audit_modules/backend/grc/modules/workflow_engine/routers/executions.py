from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ....models import ApprovalRequest, WorkflowAuditLog, WorkflowInstance, WorkflowEngineStep, GRCUser, get_db, WorkflowDefinition
from ....routers.auth_router import require_auth, get_user_primary_tenant, get_user_tenants, require_tenant_permission
from ....rich_audit import write_rich_audit_log, model_to_dict
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
            "trigger_event": payload.trigger_event or "manual.trigger",
            "trigger_payload": payload.payload,
            "correlation_id": payload.correlation_id,
        }
    )

    _defn = db.query(WorkflowDefinition).filter(WorkflowDefinition.id == payload.workflow_definition_id).first()
    _defn_name = _defn.name if _defn else f"Definition #{payload.workflow_definition_id}"
    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=current_user.id,
        action="create",
        resource_type="workflow_engine",
        resource_id=payload.workflow_definition_id,
        resource_name=_defn_name,
        summary=f"Manually triggered workflow '{_defn_name}' (event: {payload.trigger_event or 'manual.trigger'})",
        snapshot={"workflow_definition_id": payload.workflow_definition_id,
                  "trigger_event": payload.trigger_event or "manual.trigger",
                  "correlation_id": payload.correlation_id,
                  "payload": payload.payload},
        actor_type="user",
        actor_workflow_id=payload.workflow_definition_id,
        resource_url=f"/workflow-engine/{payload.workflow_definition_id}",
    )
    db.commit()

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

    write_rich_audit_log(
        db=db,
        tenant_id=instance.tenant_id,
        user_id=current_user.id,
        action="update",
        resource_type="workflow_engine",
        resource_id=instance.id,
        resource_name=f"Instance #{instance.id} (def:{instance.workflow_definition_id})",
        summary=f"Manually resumed workflow instance #{instance.id} (status: {instance.status}, node: {instance.current_node_key})",
        snapshot={"instance_id": instance.id, "workflow_definition_id": instance.workflow_definition_id,
                  "status": instance.status, "current_node_key": instance.current_node_key},
        actor_type="user",
        actor_workflow_id=instance.workflow_definition_id,
        resource_url=f"/workflow-engine/{instance.workflow_definition_id}",
    )
    db.commit()

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

    if approval.approver_user_id and approval.approver_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="You are not assigned to this approval request")

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

    db.add(
        WorkflowAuditLog(
            tenant_id=approval.tenant_id,
            workflow_definition_id=None,
            workflow_instance_id=approval.workflow_instance_id,
            workflow_step_id=approval.workflow_step_id,
            event_type="approval.decided",
            message=f"Approval request {approval.id} {approval.status} by user {current_user.id}",
            payload={
                "approval_request_id": approval.id,
                "decision": approval.status,
                "comment": payload.comment,
                "decided_by": current_user.id,
            },
        )
    )

    db.commit()

    _appr_instance = db.query(WorkflowInstance).filter(WorkflowInstance.id == approval.workflow_instance_id).first()
    _appr_defn_id = _appr_instance.workflow_definition_id if _appr_instance else None
    write_rich_audit_log(
        db=db,
        tenant_id=approval.tenant_id,
        user_id=current_user.id,
        action="update",
        resource_type="workflow_engine",
        resource_id=approval.id,
        resource_name=f"Approval #{approval.id} (instance:{approval.workflow_instance_id})",
        summary=f"Approval decision '{approval.status}' for request #{approval.id} on instance #{approval.workflow_instance_id}",
        snapshot={"approval_request_id": approval.id, "decision": approval.status,
                  "comment": payload.comment, "workflow_instance_id": approval.workflow_instance_id,
                  "workflow_step_id": approval.workflow_step_id, "decided_by": current_user.id},
        actor_type="user",
        actor_workflow_id=_appr_defn_id,
        resource_url=f"/workflow-engine/{_appr_defn_id or approval.workflow_instance_id}",
    )
    db.commit()

    runtime = get_runtime()
    runtime.event_queue.publish({"kind": "resume_instance", "instance_id": approval.workflow_instance_id})

    return {
        "status": approval.status,
        "approval_request_id": approval.id,
        "workflow_instance_id": approval.workflow_instance_id,
    }


@router.get("/approvals/inbox")
def get_approval_inbox(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:executions:view")),
):
    """List pending approval requests for the current user."""
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return {"items": [], "total": 0}

    pending = db.query(ApprovalRequest).filter(
        ApprovalRequest.tenant_id.in_(user_tenants),
        ApprovalRequest.status == "pending",
        ApprovalRequest.approver_user_id == current_user.id,
    ).order_by(ApprovalRequest.created_at.asc()).limit(100).all()

    return {
        "items": [
            {
                "id": a.id,
                "workflow_instance_id": a.workflow_instance_id,
                "workflow_step_id": a.workflow_step_id,
                "status": a.status,
                "approval_type": a.approval_type,
                "required_approvals": a.required_approvals,
                "received_approvals": a.received_approvals,
                "approver_user_id": a.approver_user_id,
                "approver_role": a.approver_role,
                "due_at": a.due_at,
                "created_at": a.created_at,
            }
            for a in pending
        ],
        "total": len(pending),
    }
