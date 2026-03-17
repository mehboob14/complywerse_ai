from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ....models import WorkflowDefinition, WorkflowDefinitionVersion, WorkflowEdge, WorkflowNode, GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_primary_tenant, get_user_tenants, require_tenant_permission
from ..schemas import (
    WorkflowDefinitionCreate,
    WorkflowDefinitionResponse,
    WorkflowDefinitionUpdate,
    WorkflowVersionResponse,
)
from ..services.definition_versions import snapshot_definition

router = APIRouter(prefix="/definitions", tags=["Workflow Engine Definitions"])


def _is_start_node(node: WorkflowNode) -> bool:
    return bool(node.is_start) or (node.node_key or "").lower() == "start"


def _is_terminal_node(node: WorkflowNode) -> bool:
    return bool(node.is_terminal) or (node.node_key or "").lower() == "end"


def _to_definition_response(definition: WorkflowDefinition) -> WorkflowDefinitionResponse:
    return WorkflowDefinitionResponse(
        id=definition.id,
        tenant_id=definition.tenant_id,
        name=definition.name,
        description=definition.description,
        version=definition.version,
        is_active=definition.is_active,
        trigger_event=definition.trigger_event,
        trigger_conditions=definition.trigger_conditions or {},
        definition_json=definition.definition_json or {},
        nodes=[
            {
                "id": node.id,
                "node_key": node.node_key,
                "node_type": node.node_type,
                "name": node.name,
                "config": node.config or {},
                "position_x": float(node.position_x or 0),
                "position_y": float(node.position_y or 0),
                "is_start": _is_start_node(node),
                "is_terminal": _is_terminal_node(node),
            }
            for node in definition.nodes
        ],
        edges=[
            {
                "id": edge.id,
                "source_node_key": edge.source_node_key,
                "target_node_key": edge.target_node_key,
                "source_handle": (edge.condition or {}).get("_handle"),
                "target_handle": None,
                "label": (edge.condition or {}).get("_label", ""),
                "condition": edge.condition or {},
                "priority": int(edge.priority or 100),
            }
            for edge in definition.edges
        ],
        created_at=definition.created_at,
        updated_at=definition.updated_at,
    )


def _resolve_tenant_id(current_user: GRCUser, db: Session) -> int:
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User is not assigned to any tenant")
    return tenant_id


def _apply_nodes(db: Session, definition_id: int, nodes: list[dict]) -> None:
    db.query(WorkflowNode).filter(WorkflowNode.workflow_definition_id == definition_id).delete()
    for node in nodes:
        db.add(
            WorkflowNode(
                workflow_definition_id=definition_id,
                node_key=node.get("node_key"),
                node_type=node.get("node_type") or "action",
                name=node.get("name") or node.get("node_key") or "Node",
                config=node.get("config") or {},
                position_x=float(node.get("position_x", 0) or 0),
                position_y=float(node.get("position_y", 0) or 0),
                is_start=bool(node.get("is_start", False)),
                is_terminal=bool(node.get("is_terminal", False)),
            )
        )


def _apply_edges(db: Session, definition_id: int, edges: list[dict]) -> None:
    db.query(WorkflowEdge).filter(WorkflowEdge.workflow_definition_id == definition_id).delete()
    for idx, edge in enumerate(edges):
        condition = dict(edge.get("condition") or {})
        priority = int(edge.get("priority") or condition.get("priority") or 100)
        if edge.get("label") and "_label" not in condition:
            condition["_label"] = edge.get("label")
        if edge.get("source_handle") and "_handle" not in condition:
            condition["_handle"] = edge.get("source_handle")

        db.add(
            WorkflowEdge(
                workflow_definition_id=definition_id,
                source_node_key=edge.get("source_node_key"),
                target_node_key=edge.get("target_node_key"),
                condition=condition,
                priority=priority,
            )
        )


@router.post("", response_model=WorkflowDefinitionResponse, status_code=status.HTTP_201_CREATED)
def create_workflow_definition(
    payload: WorkflowDefinitionCreate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:create")),
):
    tenant_id = _resolve_tenant_id(current_user, db)

    definition = WorkflowDefinition(
        tenant_id=tenant_id,
        name=payload.name,
        description=payload.description,
        trigger_event=payload.trigger_event,
        trigger_conditions=payload.trigger_conditions,
        definition_json=payload.definition_json,
        is_active=payload.is_active,
        created_by_id=current_user.id,
        updated_by_id=current_user.id,
    )
    db.add(definition)
    db.flush()

    _apply_nodes(db, definition.id, [n.model_dump() for n in payload.nodes])
    _apply_edges(db, definition.id, [e.model_dump() for e in payload.edges])

    db.flush()
    db.refresh(definition)
    snapshot_definition(db, definition, change_summary="Initial workflow definition created")
    db.commit()
    db.refresh(definition)
    return _to_definition_response(definition)


@router.get("", response_model=list[WorkflowDefinitionResponse])
def list_workflow_definitions(
    is_active: bool | None = None,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:view")),
):
    user_tenants = get_user_tenants(current_user, db)
    if not user_tenants:
        return []

    query = db.query(WorkflowDefinition).filter(WorkflowDefinition.tenant_id.in_(user_tenants))
    if is_active is not None:
        query = query.filter(WorkflowDefinition.is_active == is_active)

    definitions = query.order_by(WorkflowDefinition.updated_at.desc()).all()
    return [_to_definition_response(item) for item in definitions]


@router.get("/{definition_id}", response_model=WorkflowDefinitionResponse)
def get_workflow_definition(
    definition_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:view")),
):
    user_tenants = get_user_tenants(current_user, db)
    definition = db.query(WorkflowDefinition).filter(
        WorkflowDefinition.id == definition_id,
        WorkflowDefinition.tenant_id.in_(user_tenants),
    ).first()

    if not definition:
        raise HTTPException(status_code=404, detail="Workflow definition not found")
    return _to_definition_response(definition)


@router.put("/{definition_id}", response_model=WorkflowDefinitionResponse)
def update_workflow_definition(
    definition_id: int,
    payload: WorkflowDefinitionUpdate,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:edit")),
):
    user_tenants = get_user_tenants(current_user, db)
    definition = db.query(WorkflowDefinition).filter(
        WorkflowDefinition.id == definition_id,
        WorkflowDefinition.tenant_id.in_(user_tenants),
    ).first()

    if not definition:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    update_data = payload.model_dump(exclude_unset=True)
    node_data = update_data.pop("nodes", None)
    edge_data = update_data.pop("edges", None)

    if "definition_json" in update_data:
        definition.definition_json = update_data.pop("definition_json")

    for field, value in update_data.items():
        setattr(definition, field, value)

    if update_data or node_data is not None or edge_data is not None:
        definition.version = (definition.version or 1) + 1

    if node_data is not None:
        _apply_nodes(db, definition.id, node_data)

    if edge_data is not None:
        _apply_edges(db, definition.id, edge_data)

    definition.updated_by_id = current_user.id
    db.flush()
    db.refresh(definition)
    snapshot_definition(db, definition, change_summary="Workflow definition updated")

    db.commit()
    db.refresh(definition)
    return _to_definition_response(definition)


@router.get("/{definition_id}/versions", response_model=list[WorkflowVersionResponse])
def list_workflow_definition_versions(
    definition_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:view")),
):
    user_tenants = get_user_tenants(current_user, db)

    definition = db.query(WorkflowDefinition).filter(
        WorkflowDefinition.id == definition_id,
        WorkflowDefinition.tenant_id.in_(user_tenants),
    ).first()
    if not definition:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    versions = db.query(WorkflowDefinitionVersion).filter(
        WorkflowDefinitionVersion.workflow_definition_id == definition.id,
        WorkflowDefinitionVersion.tenant_id.in_(user_tenants),
    ).order_by(WorkflowDefinitionVersion.version_number.desc()).all()

    return [
        WorkflowVersionResponse(
            id=item.id,
            workflow_definition_id=item.workflow_definition_id,
            tenant_id=item.tenant_id,
            version_number=item.version_number,
            name=item.name,
            description=item.description,
            trigger_event=item.trigger_event,
            trigger_conditions=item.trigger_conditions or {},
            definition_json=item.definition_json or {},
            nodes_json=item.nodes_json or [],
            edges_json=item.edges_json or [],
            change_summary=item.change_summary,
            created_at=item.created_at,
        )
        for item in versions
    ]


@router.post("/{definition_id}/rollback/{version_id}", response_model=WorkflowDefinitionResponse)
def rollback_workflow_definition_version(
    definition_id: int,
    version_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:edit")),
):
    user_tenants = get_user_tenants(current_user, db)

    definition = db.query(WorkflowDefinition).filter(
        WorkflowDefinition.id == definition_id,
        WorkflowDefinition.tenant_id.in_(user_tenants),
    ).first()
    if not definition:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    version = db.query(WorkflowDefinitionVersion).filter(
        WorkflowDefinitionVersion.id == version_id,
        WorkflowDefinitionVersion.workflow_definition_id == definition.id,
        WorkflowDefinitionVersion.tenant_id.in_(user_tenants),
    ).first()
    if not version:
        raise HTTPException(status_code=404, detail="Workflow version not found")

    definition.name = version.name
    definition.description = version.description
    definition.trigger_event = version.trigger_event
    definition.trigger_conditions = version.trigger_conditions or {}
    definition.definition_json = version.definition_json or {}
    definition.version = (definition.version or 1) + 1
    definition.updated_by_id = current_user.id

    _apply_nodes(db, definition.id, version.nodes_json or [])
    _apply_edges(db, definition.id, version.edges_json or [])

    db.flush()
    db.refresh(definition)
    snapshot_definition(db, definition, change_summary=f"Rolled back to version {version.version_number}")
    db.commit()
    db.refresh(definition)

    return _to_definition_response(definition)


@router.delete("/{definition_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_workflow_definition(
    definition_id: int,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:definitions:delete")),
):
    user_tenants = get_user_tenants(current_user, db)
    definition = db.query(WorkflowDefinition).filter(
        WorkflowDefinition.id == definition_id,
        WorkflowDefinition.tenant_id.in_(user_tenants),
    ).first()

    if not definition:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    db.delete(definition)
    db.commit()
    return None
