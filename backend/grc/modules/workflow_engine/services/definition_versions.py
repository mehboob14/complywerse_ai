from typing import Optional

from ....models import WorkflowDefinition, WorkflowDefinitionVersion


def snapshot_definition(db, definition: WorkflowDefinition, change_summary: Optional[str] = None) -> WorkflowDefinitionVersion:
    nodes_json = []
    for node in definition.nodes:
        nodes_json.append(
            {
                "node_key": node.node_key,
                "node_type": node.node_type,
                "name": node.name,
                "config": node.config or {},
                "position_x": float(node.position_x or 0),
                "position_y": float(node.position_y or 0),
                "is_start": bool(node.is_start),
                "is_terminal": bool(node.is_terminal),
            }
        )

    edges_json = []
    for edge in definition.edges:
        condition = edge.condition or {}
        edges_json.append(
            {
                "source_node_key": edge.source_node_key,
                "target_node_key": edge.target_node_key,
                "condition": condition,
                "priority": int(edge.priority or 100),
                "source_handle": condition.get("_handle"),
                "label": condition.get("_label", ""),
            }
        )

    target_version_number = definition.version or 1
    version = db.query(WorkflowDefinitionVersion).filter(
        WorkflowDefinitionVersion.workflow_definition_id == definition.id,
        WorkflowDefinitionVersion.version_number == target_version_number,
    ).first()

    if version:
        version.tenant_id = definition.tenant_id
        version.name = definition.name
        version.description = definition.description
        version.trigger_event = definition.trigger_event
        version.trigger_conditions = definition.trigger_conditions or {}
        version.definition_json = definition.definition_json or {}
        version.nodes_json = nodes_json
        version.edges_json = edges_json
        if change_summary is not None:
            version.change_summary = change_summary
        version.created_by_id = definition.updated_by_id or definition.created_by_id
    else:
        version = WorkflowDefinitionVersion(
            workflow_definition_id=definition.id,
            tenant_id=definition.tenant_id,
            version_number=target_version_number,
            name=definition.name,
            description=definition.description,
            trigger_event=definition.trigger_event,
            trigger_conditions=definition.trigger_conditions or {},
            definition_json=definition.definition_json or {},
            nodes_json=nodes_json,
            edges_json=edges_json,
            change_summary=change_summary,
            created_by_id=definition.updated_by_id or definition.created_by_id,
        )
        db.add(version)

    db.flush()
    return version
