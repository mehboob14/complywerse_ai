from typing import Optional

from ....models import WorkflowDefinition, WorkflowDefinitionVersion


def snapshot_definition(db, definition: WorkflowDefinition, change_summary: Optional[str] = None) -> WorkflowDefinitionVersion:
    version = WorkflowDefinitionVersion(
        workflow_definition_id=definition.id,
        tenant_id=definition.tenant_id,
        version_number=definition.version or 1,
        name=definition.name,
        description=definition.description,
        trigger_event=definition.trigger_event,
        trigger_conditions=definition.trigger_conditions or {},
        definition_json=definition.definition_json or {},
        nodes_json=[
            {
                "node_key": node.node_key,
                "node_type": node.node_type,
                "name": node.name,
                "config": node.config or {},
                "position_x": node.position_x,
                "position_y": node.position_y,
                "is_start": node.is_start,
                "is_terminal": node.is_terminal,
            }
            for node in definition.nodes
        ],
        edges_json=[
            {
                "source_node_key": edge.source_node_key,
                "target_node_key": edge.target_node_key,
                "condition": edge.condition or {},
                "priority": edge.priority,
            }
            for edge in definition.edges
        ],
        change_summary=change_summary,
        created_by_id=definition.updated_by_id or definition.created_by_id,
    )
    db.add(version)
    db.flush()
    return version
