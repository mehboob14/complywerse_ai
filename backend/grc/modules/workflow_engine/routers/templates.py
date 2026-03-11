from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field

from ....models import (
    WorkflowDefinition,
    WorkflowEdge,
    WorkflowEngineTemplate,
    WorkflowNode,
    GRCUser,
    get_db,
)
from ....routers.auth_router import require_auth, get_user_primary_tenant, get_user_tenants, require_tenant_permission
from ..schemas import WorkflowTemplateCreate, WorkflowTemplateResponse
from ..services.definition_versions import snapshot_definition

router = APIRouter(prefix="/templates", tags=["Workflow Engine Templates"])


class DocumentApprovalBootstrapRequest(BaseModel):
    name: str = "Governance Document Approval Workflow"
    description: str | None = "Reviewer and approver flow with timeout escalation"
    trigger_event: str = "governance.policy_draft.created"
    include_reviewer_step: bool = True
    reviewer_user_ids: list[int] = Field(default_factory=list)
    reviewer_role_ids: list[int] = Field(default_factory=list)
    approver_user_ids: list[int] = Field(default_factory=list)
    approver_role_ids: list[int] = Field(default_factory=list)
    escalation_user_ids: list[int] = Field(default_factory=list)
    escalation_role_ids: list[int] = Field(default_factory=list)
    escalation_after_days: int = 14
    notify_user_ids: list[int] = Field(default_factory=list)
    notify_role_ids: list[int] = Field(default_factory=list)
    followup_user_ids: list[int] = Field(default_factory=list)
    followup_role_ids: list[int] = Field(default_factory=list)


@router.post("", response_model=WorkflowTemplateResponse, status_code=status.HTTP_201_CREATED)
def create_template(
    payload: WorkflowTemplateCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:templates:create")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User is not assigned to any tenant")

    template = WorkflowEngineTemplate(
        tenant_id=tenant_id,
        name=payload.name,
        description=payload.description,
        category=payload.category,
        trigger_event=payload.trigger_event,
        trigger_conditions=payload.trigger_conditions,
        definition_json=payload.definition_json,
        nodes_json=payload.nodes_json,
        edges_json=payload.edges_json,
        tags=payload.tags,
        created_by_id=current_user.id,
    )
    db.add(template)
    db.commit()
    db.refresh(template)

    return WorkflowTemplateResponse(
        id=template.id,
        tenant_id=template.tenant_id,
        name=template.name,
        description=template.description,
        category=template.category,
        trigger_event=template.trigger_event,
        trigger_conditions=template.trigger_conditions or {},
        definition_json=template.definition_json or {},
        nodes_json=template.nodes_json or [],
        edges_json=template.edges_json or [],
        tags=template.tags or [],
        is_system_template=template.is_system_template,
        is_active=template.is_active,
        created_at=template.created_at,
        updated_at=template.updated_at,
    )


@router.get("", response_model=list[WorkflowTemplateResponse])
def list_templates(
    category: str | None = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:templates:view")),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    query = db.query(WorkflowEngineTemplate).filter(WorkflowEngineTemplate.tenant_id.in_(user_tenants))
    if category:
        query = query.filter(WorkflowEngineTemplate.category == category)

    items = query.order_by(WorkflowEngineTemplate.updated_at.desc()).all()
    return [
        WorkflowTemplateResponse(
            id=item.id,
            tenant_id=item.tenant_id,
            name=item.name,
            description=item.description,
            category=item.category,
            trigger_event=item.trigger_event,
            trigger_conditions=item.trigger_conditions or {},
            definition_json=item.definition_json or {},
            nodes_json=item.nodes_json or [],
            edges_json=item.edges_json or [],
            tags=item.tags or [],
            is_system_template=item.is_system_template,
            is_active=item.is_active,
            created_at=item.created_at,
            updated_at=item.updated_at,
        )
        for item in items
    ]


@router.post("/{template_id}/instantiate", status_code=status.HTTP_201_CREATED)
def instantiate_template(
    template_id: int,
    name: str | None = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:templates:publish")),
):
    user_tenants = get_user_tenants(current_user, db)
    template = db.query(WorkflowEngineTemplate).filter(
        WorkflowEngineTemplate.id == template_id,
        WorkflowEngineTemplate.tenant_id.in_(user_tenants),
    ).first()
    if not template:
        raise HTTPException(status_code=404, detail="Workflow template not found")

    definition = WorkflowDefinition(
        tenant_id=template.tenant_id,
        name=name or f"{template.name} (Instance)",
        description=template.description,
        trigger_event=template.trigger_event,
        trigger_conditions=template.trigger_conditions or {},
        definition_json=template.definition_json or {},
        is_active=True,
        created_by_id=current_user.id,
        updated_by_id=current_user.id,
    )
    db.add(definition)
    db.flush()

    for node in template.nodes_json or []:
        db.add(
            WorkflowNode(
                workflow_definition_id=definition.id,
                node_key=node.get("node_key"),
                node_type=node.get("node_type") or "action",
                name=node.get("name") or "Node",
                config=node.get("config") or {},
                position_x=int(node.get("position_x", 0)),
                position_y=int(node.get("position_y", 0)),
                is_start=bool(node.get("is_start", False)),
                is_terminal=bool(node.get("is_terminal", False)),
            )
        )

    for edge in template.edges_json or []:
        db.add(
            WorkflowEdge(
                workflow_definition_id=definition.id,
                source_node_key=edge.get("source_node_key"),
                target_node_key=edge.get("target_node_key"),
                condition=edge.get("condition") or {},
                priority=int(edge.get("priority", 100)),
            )
        )

    db.flush()
    db.refresh(definition)
    snapshot_definition(db, definition, change_summary=f"Instantiated from template {template.id}")
    db.commit()

    return {"workflow_definition_id": definition.id, "template_id": template.id, "status": "created"}


@router.post("/bootstrap/document-approval", status_code=status.HTTP_201_CREATED)
def bootstrap_document_approval_workflow(
    payload: DocumentApprovalBootstrapRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:templates:publish")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User is not assigned to any tenant")

    definition = WorkflowDefinition(
        tenant_id=tenant_id,
        name=payload.name,
        description=payload.description,
        trigger_event=payload.trigger_event,
        trigger_conditions={},
        definition_json={
            "kind": "governance_document_approval",
            "bootstrap": True,
        },
        is_active=True,
        created_by_id=current_user.id,
        updated_by_id=current_user.id,
    )
    db.add(definition)
    db.flush()

    nodes = [
        {
            "node_key": "start",
            "node_type": "start",
            "name": "Start",
            "config": {},
            "is_start": True,
            "is_terminal": False,
            "position_x": 80,
            "position_y": 220,
        },
    ]

    if payload.include_reviewer_step:
        nodes.append(
            {
                "node_key": "reviewer",
                "node_type": "approval",
                "name": "Reviewer Approval",
                "config": {
                    "approval_type": "single",
                    "required_approvals": 1,
                    "reviewer_user_ids": payload.reviewer_user_ids,
                    "reviewer_role_ids": payload.reviewer_role_ids,
                    "on_timeout": "auto_reject",
                },
                "is_start": False,
                "is_terminal": False,
                "position_x": 300,
                "position_y": 220,
            }
        )

    nodes.extend(
        [
            {
                "node_key": "approver",
                "node_type": "approval",
                "name": "Approver Approval",
                "config": {
                    "approval_type": "single",
                    "required_approvals": 1,
                    "approver_user_ids": payload.approver_user_ids,
                    "approver_role_ids": payload.approver_role_ids,
                    "on_timeout": "escalate",
                    "timeout_days": payload.escalation_after_days,
                    "escalation_user_ids": payload.escalation_user_ids,
                    "escalation_role_ids": payload.escalation_role_ids,
                },
                "is_start": False,
                "is_terminal": False,
                "position_x": 540,
                "position_y": 220,
            },
            {
                "node_key": "notify_submitter",
                "node_type": "action",
                "name": "Notify Submitter",
                "config": {
                    "action_name": "send_notification_email",
                    "payload": {
                        "include_trigger_user": True,
                        "subject": "Your document was approved",
                    },
                },
                "is_start": False,
                "is_terminal": False,
                "position_x": 800,
                "position_y": 160,
            },
            {
                "node_key": "notify_followup",
                "node_type": "action",
                "name": "Notify Follow-up Review",
                "config": {
                    "action_name": "send_notification_email",
                    "payload": {
                        "user_ids": payload.followup_user_ids or payload.notify_user_ids,
                        "role_ids": payload.followup_role_ids or payload.notify_role_ids,
                        "subject": "Document review follow-up",
                    },
                },
                "is_start": False,
                "is_terminal": False,
                "position_x": 1020,
                "position_y": 160,
            },
            {
                "node_key": "end",
                "node_type": "end",
                "name": "End",
                "config": {},
                "is_start": False,
                "is_terminal": True,
                "position_x": 1220,
                "position_y": 220,
            },
        ]
    )

    edges = []
    if payload.include_reviewer_step:
        edges.append({"source_node_key": "start", "target_node_key": "reviewer", "condition": {}, "priority": 100})
        edges.append({"source_node_key": "reviewer", "target_node_key": "approver", "condition": {}, "priority": 100})
    else:
        edges.append({"source_node_key": "start", "target_node_key": "approver", "condition": {}, "priority": 100})

    edges.extend(
        [
            {"source_node_key": "approver", "target_node_key": "notify_submitter", "condition": {}, "priority": 100},
            {"source_node_key": "notify_submitter", "target_node_key": "notify_followup", "condition": {}, "priority": 100},
            {"source_node_key": "notify_followup", "target_node_key": "end", "condition": {}, "priority": 100},
        ]
    )

    for node in nodes:
        db.add(
            WorkflowNode(
                workflow_definition_id=definition.id,
                node_key=node["node_key"],
                node_type=node["node_type"],
                name=node["name"],
                config=node["config"],
                position_x=node["position_x"],
                position_y=node["position_y"],
                is_start=node["is_start"],
                is_terminal=node["is_terminal"],
            )
        )

    for edge in edges:
        db.add(
            WorkflowEdge(
                workflow_definition_id=definition.id,
                source_node_key=edge["source_node_key"],
                target_node_key=edge["target_node_key"],
                condition=edge["condition"],
                priority=edge["priority"],
            )
        )

    db.flush()
    db.refresh(definition)
    snapshot_definition(db, definition, change_summary="Bootstrapped governance document approval workflow")
    db.commit()

    return {
        "status": "created",
        "workflow_definition_id": definition.id,
        "trigger_event": definition.trigger_event,
        "name": definition.name,
        "include_reviewer_step": payload.include_reviewer_step,
    }
