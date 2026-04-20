from sqlalchemy import desc

from .models import (
    GRCUser,
    SessionLocal,
    Tenant,
    TenantUser,
    WorkflowDefinition,
    WorkflowEdge,
    WorkflowEngineTemplate,
    WorkflowNode,
    logger,
)


DEFAULT_WORKFLOWS = [
    {"name": "risk_creation", "trigger": "risk_created", "category": "Risk Management"},
    {"name": "anomaly creation", "trigger": "vulnerability_created", "category": "Vulnerability Management"},
    {"name": "risk_updated", "trigger": "risk_updated", "category": "Risk Management"},
    {"name": "risk_deleted", "trigger": "risk_deleted", "category": "Risk Management"},
    {"name": "vulnerability_updated", "trigger": "vulnerability_updated", "category": "Vulnerability Management"},
    {"name": "vulnerability_deleted", "trigger": "vulnerability_deleted", "category": "Vulnerability Management"},
    {"name": "policy_submitted_for_review", "trigger": "policy_submitted_for_review", "category": "Policy"},
    {"name": "asset_created", "trigger": "asset_created", "category": "Asset Management"},
    {"name": "asset_updated", "trigger": "asset_updated", "category": "Asset Management"},
    {"name": "asset_deleted", "trigger": "asset_deleted", "category": "Asset Management"},
]


def _default_recipient_for_tenant(db, tenant_id: int):
    tenant_user = (
        db.query(TenantUser)
        .filter(TenantUser.tenant_id == tenant_id)
        .order_by(desc(TenantUser.is_primary), TenantUser.id.asc())
        .first()
    )
    if not tenant_user:
        return None, "admin@example.com"

    user = db.query(GRCUser).filter(GRCUser.id == tenant_user.user_id).first()
    if not user:
        return None, "admin@example.com"

    return user.id, user.email or "admin@example.com"


def _build_workflow_graph(trigger: str, recipient_user_id: int | None, recipient_email: str):
    email_node_key = f"send_email_{trigger}"
    alert_node_key = f"send_alert_{trigger}"

    email_cfg = {
        "action_name": "send_notification_email",
        "payload": {},
        "module": "Workflow Engine",
        "domains": ["shared"],
        "to": [recipient_email],
        "recipient_user_ids": [recipient_user_id] if recipient_user_id else [],
        "subject": f"[{trigger}] {{{{title}}}}",
        "body": (
            f"Event: {trigger}\n\n"
            "Title: {{title}}\nStatus: {{status}}\nBy: {{created_by_name}}"
        ),
    }

    alert_cfg = {
        "action_name": "send_in_app_alert",
        "payload": {},
        "module": "Workflow Engine",
        "domains": ["shared"],
        "recipient_user_ids": [recipient_user_id] if recipient_user_id else [],
        "alert_type": "info",
        "subject": trigger,
        "message": "{{title}} — {{status}}",
    }

    nodes = [
        {
            "node_key": "start",
            "node_type": "start",
            "name": "Start",
            "config": {"trigger_type": trigger, "module": "GRC", "domains": ["shared"]},
            "position_x": 350,
            "position_y": 30,
            "is_start": True,
            "is_terminal": False,
        },
        {
            "node_key": email_node_key,
            "node_type": "action",
            "name": "Send Email",
            "config": email_cfg,
            "position_x": 350,
            "position_y": 160,
            "is_start": False,
            "is_terminal": False,
        },
        {
            "node_key": alert_node_key,
            "node_type": "action",
            "name": "In-App Alert",
            "config": alert_cfg,
            "position_x": 350,
            "position_y": 290,
            "is_start": False,
            "is_terminal": False,
        },
        {
            "node_key": "end",
            "node_type": "end",
            "name": "End",
            "config": {"module": "Workflow Engine", "domains": ["workflow"]},
            "position_x": 350,
            "position_y": 420,
            "is_start": False,
            "is_terminal": True,
        },
    ]

    edges = [
        {
            "source_node_key": "start",
            "target_node_key": email_node_key,
            "condition": {},
            "priority": 1,
        },
        {
            "source_node_key": email_node_key,
            "target_node_key": alert_node_key,
            "condition": {},
            "priority": 1,
        },
        {
            "source_node_key": alert_node_key,
            "target_node_key": "end",
            "condition": {},
            "priority": 1,
        },
    ]

    return nodes, edges


def seed_workflow_engine_defaults():
    """Ensure default workflow engine definitions/templates exist for every active tenant."""
    db = SessionLocal()
    try:
        active_tenants = db.query(Tenant).filter(Tenant.is_active == True).all()
        if not active_tenants:
            logger.info("No active tenants found; skipping workflow engine default seeding")
            return

        seeded_definitions = 0
        seeded_templates = 0

        for tenant in active_tenants:
            recipient_user_id, recipient_email = _default_recipient_for_tenant(db, tenant.id)

            for workflow in DEFAULT_WORKFLOWS:
                nodes, edges = _build_workflow_graph(
                    workflow["trigger"], recipient_user_id, recipient_email
                )

                existing_definition = db.query(WorkflowDefinition).filter(
                    WorkflowDefinition.tenant_id == tenant.id,
                    WorkflowDefinition.trigger_event == workflow["trigger"],
                ).first()

                if not existing_definition:
                    definition = WorkflowDefinition(
                        tenant_id=tenant.id,
                        name=workflow["name"],
                        description=f"Auto-fires on {workflow['trigger']}",
                        trigger_event=workflow["trigger"],
                        is_active=True,
                        trigger_conditions={},
                        definition_json={},
                        created_by_id=recipient_user_id,
                        updated_by_id=recipient_user_id,
                    )
                    db.add(definition)
                    db.flush()

                    for node in nodes:
                        db.add(
                            WorkflowNode(
                                workflow_definition_id=definition.id,
                                node_key=node["node_key"],
                                node_type=node["node_type"],
                                name=node["name"],
                                is_start=node["is_start"],
                                is_terminal=node["is_terminal"],
                                config=node["config"],
                                position_x=node["position_x"],
                                position_y=node["position_y"],
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

                    seeded_definitions += 1

                existing_template = db.query(WorkflowEngineTemplate).filter(
                    WorkflowEngineTemplate.tenant_id == tenant.id,
                    WorkflowEngineTemplate.trigger_event == workflow["trigger"],
                    WorkflowEngineTemplate.name == workflow["name"],
                ).first()

                if not existing_template:
                    db.add(
                        WorkflowEngineTemplate(
                            tenant_id=tenant.id,
                            name=workflow["name"],
                            description=f"Default template for {workflow['trigger']}",
                            category=workflow["category"],
                            trigger_event=workflow["trigger"],
                            trigger_conditions={},
                            definition_json={},
                            nodes_json=nodes,
                            edges_json=edges,
                            tags=[workflow["category"], workflow["trigger"]],
                            is_system_template=True,
                            is_active=True,
                            created_by_id=recipient_user_id,
                        )
                    )
                    seeded_templates += 1

        db.commit()
        logger.info(
            "Workflow engine default seeding complete: %s definitions added, %s templates added",
            seeded_definitions,
            seeded_templates,
        )
    except Exception as exc:
        db.rollback()
        logger.error("Error seeding workflow engine defaults: %s", exc)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed_workflow_engine_defaults()
