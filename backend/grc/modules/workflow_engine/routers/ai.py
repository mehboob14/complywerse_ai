from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ....models import Framework, WorkflowDefinition, WorkflowEngineStep, WorkflowInstance, GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_primary_tenant, get_user_tenants, require_tenant_permission
from ..schemas import (
    IntelligentRoutingRequest,
    WorkflowAnomalyRequest,
    WorkflowNaturalLanguageRequest,
    WorkflowOptimizationRequest,
)

router = APIRouter(prefix="/ai", tags=["Workflow Engine AI"])


@router.get("/suggestions")
def ai_workflow_suggestions(
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:ai:view")),
):
    tenant_id = get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="User is not assigned to any tenant")

    frameworks = db.query(Framework).filter(Framework.is_active == True).all()
    framework_names = [f.name for f in frameworks][:10]

    suggestions = []
    for name in framework_names:
        lname = name.lower()
        if "iso" in lname:
            suggestions.append({
                "title": f"{name} Annual Management Review",
                "trigger_event": "scheduler.annual_management_review",
                "reason": "Annual review obligations are common in ISO-aligned governance",
            })
        if "nist" in lname:
            suggestions.append({
                "title": f"{name} Quarterly Control Reassessment",
                "trigger_event": "scheduler.control_reassessment",
                "reason": "Continuous monitoring and periodic reassessment expectations",
            })
        if "pci" in lname:
            suggestions.append({
                "title": f"{name} Evidence Expiry Escalation",
                "trigger_event": "evidence.update",
                "reason": "Evidence freshness is critical for payment control attestations",
            })

    if not suggestions:
        suggestions.append({
            "title": "Risk Escalation Workflow",
            "trigger_event": "risks.update",
            "reason": "Escalate critical residual risk changes to management",
        })

    return {"frameworks": framework_names, "suggestions": suggestions}


@router.post("/natural-language")
def ai_natural_language_to_workflow(
    payload: WorkflowNaturalLanguageRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:ai:create")),
):
    text = payload.prompt.lower()

    trigger_event = payload.target_trigger_event or "manual.trigger"
    if "critical" in text and "risk" in text:
        trigger_event = "risks.update"
    elif "evidence" in text and "expire" in text:
        trigger_event = "evidence.update"
    elif "vulnerability" in text:
        trigger_event = "vulnerabilities.update"

    nodes = [
        {"node_key": "start", "node_type": "start", "name": "Start", "is_start": True},
        {"node_key": "condition_1", "node_type": "condition", "name": "Condition Check", "config": {"condition": {"path": "trigger.severity", "operator": "in", "value": ["critical", "high"]}}},
        {"node_key": "approval_1", "node_type": "approval", "name": "Manager Approval", "config": {"approval_type": "single", "required_approvals": 1}},
        {"node_key": "notify_1", "node_type": "action", "name": "Send Notification", "config": {"action_name": "send_notification_email", "payload": {"channel": "email"}}},
        {"node_key": "end", "node_type": "end", "name": "End", "is_terminal": True},
    ]
    edges = [
        {"source_node_key": "start", "target_node_key": "condition_1", "priority": 1, "condition": {}},
        {"source_node_key": "condition_1", "target_node_key": "approval_1", "priority": 1, "condition": {"path": "step.condition_result", "operator": "eq", "value": True}},
        {"source_node_key": "condition_1", "target_node_key": "end", "priority": 2, "condition": {"path": "step.condition_result", "operator": "eq", "value": False}},
        {"source_node_key": "approval_1", "target_node_key": "notify_1", "priority": 1, "condition": {}},
        {"source_node_key": "notify_1", "target_node_key": "end", "priority": 1, "condition": {}},
    ]

    return {
        "name": f"AI Generated: {payload.prompt[:60]}",
        "trigger_event": trigger_event,
        "trigger_conditions": {},
        "definition_json": {"generated_at": datetime.utcnow().isoformat(), "source": "nl_v1"},
        "nodes": nodes,
        "edges": edges,
    }


@router.post("/optimize")
def ai_optimize_workflow(
    payload: WorkflowOptimizationRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:ai:edit")),
):
    user_tenants = get_user_tenants(current_user, db)
    definition = db.query(WorkflowDefinition).filter(
        WorkflowDefinition.id == payload.workflow_definition_id,
        WorkflowDefinition.tenant_id.in_(user_tenants),
    ).first()
    if not definition:
        raise HTTPException(status_code=404, detail="Workflow definition not found")

    node_count = len(definition.nodes)
    edge_count = len(definition.edges)
    terminal_count = len([n for n in definition.nodes if n.is_terminal or (n.node_type or "").lower() == "end"])

    suggestions = []
    if node_count > 20:
        suggestions.append("Consider extracting repeated logic into sub-workflows to reduce complexity")
    if terminal_count == 0:
        suggestions.append("Add at least one terminal/end node to avoid non-terminating paths")
    if edge_count < max(1, node_count - 1):
        suggestions.append("Review disconnected nodes or missing transitions between steps")
    if payload.include_sla_analysis:
        timer_nodes = [n for n in definition.nodes if (n.node_type or "").lower() == "timer"]
        if len(timer_nodes) == 0:
            suggestions.append("Add timer/SLA nodes for escalation on overdue approvals")

    if not suggestions:
        suggestions.append("Workflow structure looks healthy; monitor runtime bottlenecks for further tuning")

    return {
        "workflow_definition_id": definition.id,
        "analysis": {
            "node_count": node_count,
            "edge_count": edge_count,
            "terminal_nodes": terminal_count,
        },
        "suggestions": suggestions,
    }


@router.post("/intelligent-routing")
def ai_intelligent_routing(
    payload: IntelligentRoutingRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:ai:view")),
):
    tenant_id = payload.tenant_id or get_user_primary_tenant(current_user, db)
    if not tenant_id:
        raise HTTPException(status_code=400, detail="Tenant context not resolved")

    workload_rows = db.query(
        WorkflowEngineStep.assigned_to_user_id,
    ).join(
        WorkflowInstance, WorkflowEngineStep.workflow_instance_id == WorkflowInstance.id
    ).filter(
        WorkflowInstance.tenant_id == tenant_id,
        WorkflowEngineStep.status.in_(["pending", "running", "waiting_approval", "waiting_timer", "waiting_subworkflow"]),
        WorkflowEngineStep.assigned_to_user_id.isnot(None),
    ).all()

    workload = {}
    for row in workload_rows:
        workload[row.assigned_to_user_id] = workload.get(row.assigned_to_user_id, 0) + 1

    best_user_id = None
    lowest = None
    for user_id, count in workload.items():
        if lowest is None or count < lowest:
            lowest = count
            best_user_id = user_id

    if best_user_id is None:
        best_user_id = current_user.id
        lowest = 0

    return {
        "task_type": payload.task_type,
        "recommended_user_id": best_user_id,
        "current_open_task_count": lowest,
        "reason": "Lowest active workflow workload among currently assigned users",
    }


@router.post("/anomalies")
def ai_anomaly_detection(
    payload: WorkflowAnomalyRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:ai:view")),
):
    user_tenants = get_user_tenants(current_user, db)
    cutoff = datetime.utcnow() - timedelta(hours=max(1, payload.lookback_hours))
    runtime_cutoff = datetime.utcnow() - timedelta(minutes=max(1, payload.runtime_threshold_minutes))

    stale_instances = db.query(WorkflowInstance).filter(
        WorkflowInstance.tenant_id.in_(user_tenants),
        WorkflowInstance.started_at >= cutoff,
        WorkflowInstance.status.in_(["running", "waiting"]),
        WorkflowInstance.started_at <= runtime_cutoff,
    ).order_by(WorkflowInstance.started_at.asc()).limit(200).all()

    return {
        "lookback_hours": payload.lookback_hours,
        "runtime_threshold_minutes": payload.runtime_threshold_minutes,
        "anomalies": [
            {
                "instance_id": item.id,
                "workflow_definition_id": item.workflow_definition_id,
                "status": item.status,
                "current_node_key": item.current_node_key,
                "started_at": item.started_at,
                "signal": "long_running_or_stuck",
            }
            for item in stale_instances
        ],
    }
