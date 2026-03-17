from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

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
        node_cfg = dict(node.get("config") or {})
        db.add(
            WorkflowNode(
                workflow_definition_id=definition.id,
                node_key=node.get("node_key"),
                node_type=node.get("node_type") or "action",
                name=node.get("name") or "Node",
                is_start=bool(node.get("is_start")),
                is_terminal=bool(node.get("is_terminal")),
                config=node_cfg,
                position_x=float(node.get("position_x", 0) or 0),
                position_y=float(node.get("position_y", 0) or 0),
            )
        )

    for idx, edge in enumerate(template.edges_json or []):
        condition = dict(edge.get("condition") or {})
        if "priority" not in condition:
            condition["priority"] = int(edge.get("priority", 100) or 100)
        db.add(
            WorkflowEdge(
                workflow_definition_id=definition.id,
                source_node_key=edge.get("source_node_key"),
                target_node_key=edge.get("target_node_key"),
                condition=condition,
                priority=int(edge.get("priority", 100) or 100),
            )
        )

    db.flush()
    db.refresh(definition)
    snapshot_definition(db, definition, change_summary=f"Instantiated from template {template.id}")
    db.commit()

    return {"workflow_definition_id": definition.id, "template_id": template.id, "status": "created"}
