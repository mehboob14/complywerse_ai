import json
import os
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
from ..services.catalog import (
    ACTION_NODE_TYPES,
    APPROVAL_NODE_TYPES,
    CONDITION_NODE_TYPES,
    TIMER_NODE_TYPES,
    TRIGGER_NODE_TYPES,
)

router = APIRouter(prefix="/ai", tags=["Workflow Engine AI"])


def _get_openai_client():
    try:
        from openai import OpenAI
    except ImportError:
        raise HTTPException(status_code=503, detail="openai package not installed")

    api_key = os.environ.get("AI_INTEGRATIONS_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="AI service not configured — set OPENAI_API_KEY")

    base_url = os.environ.get("AI_INTEGRATIONS_OPENAI_BASE_URL")
    kwargs = {"api_key": api_key}
    if base_url:
        kwargs["base_url"] = base_url
    return OpenAI(**kwargs)


def _catalog_summary() -> str:
    """Return a compact text summary of available node types for the AI system prompt."""
    lines = ["AVAILABLE NODE TYPES (use these exact keys):"]
    lines.append("TRIGGERS (node_type='start', config.trigger_type=key):")
    lines += [f"  - {n['key']}: {n['label']}" for n in TRIGGER_NODE_TYPES]
    lines.append("ACTIONS (node_type='action', config.action_name=key):")
    lines += [f"  - {n['key']}: {n['label']}" for n in ACTION_NODE_TYPES]
    lines.append("CONDITIONS (node_type='condition', config.condition_kind=key):")
    lines += [f"  - {n['key']}: {n['label']}" for n in CONDITION_NODE_TYPES]
    lines.append("APPROVALS (node_type='approval', config.approval_type=key):")
    lines += [f"  - {n['key']}: {n['label']}" for n in APPROVAL_NODE_TYPES]
    lines.append("TIMERS (node_type='timer', config.timer_kind=key):")
    lines += [f"  - {n['key']}: {n['label']}" for n in TIMER_NODE_TYPES]
    lines.append("CONTROL: node_type='end' (terminal), node_type='subworkflow'")
    return "\n".join(lines)


_NL_SYSTEM_PROMPT = """You are an expert GRC (Governance, Risk & Compliance) workflow designer.

Given a plain-English workflow description, generate a complete workflow graph.

{catalog}

OUTPUT FORMAT — respond with ONLY valid JSON, no markdown, no extra text:
{{
  "name": "<short workflow name>",
  "description": "<one sentence description>",
  "trigger_event": "<event name matching a trigger key above>",
  "nodes": [
    {{
      "node_key": "start",
      "node_type": "start",
      "label": "Start",
      "is_start": true,
      "config": {{"trigger_type": "<trigger_key>"}}
    }},
    {{
      "node_key": "step_1",
      "node_type": "action|condition|approval|timer|end",
      "label": "<human readable step name>",
      "is_terminal": false,
      "config": {{}}
    }}
  ],
  "edges": [
    {{
      "source_node_key": "start",
      "target_node_key": "step_1",
      "edge_label": "",
      "priority": 1,
      "condition": {{}}
    }}
  ]
}}

RULES:
- Always start with a 'start' node and end with an 'end' node (is_terminal: true)
- Condition nodes must have two outgoing edges: one with condition {{"path":"step.condition_result","operator":"eq","value":true}} and one with value false
- Keep it between 4–10 nodes; do not over-engineer
- node_keys must be unique, snake_case identifiers
- Map the description to the most relevant GRC trigger and actions from the catalog
""".format(catalog=_catalog_summary())


_SUGGESTIONS_SYSTEM_PROMPT = """You are a GRC expert. Given a list of active compliance frameworks and existing workflow names, suggest 5–8 specific GRC workflow automation ideas.

For each suggestion return:
{{
  "title": "<workflow title>",
  "description": "<one sentence describing what it does>",
  "framework_ref": "<framework name it addresses>",
  "trigger_event": "<trigger key>",
  "category": "<risk_management|policy_management|evidence_management|incident_response|audit|access_review>",
  "already_exists": false
}}

Available triggers: {triggers}

Respond with ONLY a JSON array, no markdown.
""".format(triggers=", ".join(n["key"] for n in TRIGGER_NODE_TYPES))


_OPTIMIZE_SYSTEM_PROMPT = """You are a GRC workflow optimization expert. Given a workflow graph and its execution stats, provide specific improvement suggestions.

Respond with a JSON object:
{{
  "overall_health": "good|needs_improvement|critical",
  "summary": "<one sentence>",
  "suggestions": [
    {{
      "type": "performance|reliability|compliance|simplification",
      "title": "<short title>",
      "description": "<actionable description>",
      "priority": "high|medium|low"
    }}
  ]
}}

Respond with ONLY valid JSON.
"""


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/natural-language")
def ai_natural_language_to_workflow(
    payload: WorkflowNaturalLanguageRequest,
    db: Session = Depends(get_db),
    current_user: GRCUser = Depends(require_auth),
    _: bool = Depends(require_tenant_permission("workflow_engine:ai:create")),
):
    # Try GPT-4o first, fall back to rule-based
    try:
        client = _get_openai_client()
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": _NL_SYSTEM_PROMPT},
                {"role": "user", "content": f"Create a workflow for: {payload.prompt}"},
            ],
            temperature=0.3,
            max_tokens=2000,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)

        # Validate required keys
        if "nodes" not in data or "edges" not in data:
            raise ValueError("Missing nodes or edges in AI response")

        # Normalize GPT nodes: ensure 'name' field exists (GPT may use 'label')
        for i, node in enumerate(data["nodes"]):
            if "name" not in node and "label" in node:
                node["name"] = node["label"]
            # Add default positions if missing
            if "x" not in node:
                node["x"] = 350
            if "y" not in node:
                node["y"] = 30 + i * 130

        return {
            "name": data.get("name", f"AI: {payload.prompt[:60]}"),
            "description": data.get("description", ""),
            "trigger_event": data.get("trigger_event", payload.target_trigger_event or "manual.trigger"),
            "trigger_conditions": {},
            "definition_json": {"generated_at": datetime.utcnow().isoformat(), "source": "gpt4o_nl"},
            "nodes": data["nodes"],
            "edges": data["edges"],
            "ai_generated": True,
        }

    except HTTPException:
        pass  # AI not configured — fall through to rule-based
    except Exception:
        pass  # Any GPT error — fall through

    # --- Rule-based fallback ---
    text = payload.prompt.lower()
    trigger_event = payload.target_trigger_event or "manual.trigger"
    if "risk" in text and ("critical" in text or "high" in text or "escalat" in text):
        trigger_event = "risks.update"
    elif "evidence" in text and ("expir" in text or "overdue" in text):
        trigger_event = "evidence.update"
    elif "vulnerability" in text or "vuln" in text:
        trigger_event = "vulnerabilities.update"
    elif "incident" in text:
        trigger_event = "incidents.create"
    elif "policy" in text and "review" in text:
        trigger_event = "governance.update"

    nodes = [
        {"node_key": "start", "node_type": "start", "name": "Trigger", "is_start": True,
         "config": {"trigger_type": "manual_trigger"}, "x": 350, "y": 30},
        {"node_key": "condition_1", "node_type": "condition", "name": "Severity Check",
         "config": {"condition_kind": "check_risk_level",
                    "condition": {"path": "trigger.severity", "operator": "in", "value": ["critical", "high"]}},
         "x": 350, "y": 160},
        {"node_key": "approval_1", "node_type": "approval", "name": "Manager Approval",
         "config": {"approval_type": "single", "required_approvals": 1},
         "x": 350, "y": 300},
        {"node_key": "notify_1", "node_type": "action", "name": "Send Notification",
         "config": {"action_name": "send_notification_email",
                    "payload": {"subject": "Workflow Action Required"}},
         "x": 350, "y": 440},
        {"node_key": "end", "node_type": "end", "name": "End", "is_terminal": True, "config": {},
         "x": 350, "y": 570},
    ]
    edges = [
        {"source_node_key": "start", "target_node_key": "condition_1", "priority": 1, "condition": {}},
        {"source_node_key": "condition_1", "target_node_key": "approval_1", "priority": 1,
         "condition": {"path": "step.condition_result", "operator": "eq", "value": True}},
        {"source_node_key": "condition_1", "target_node_key": "end", "priority": 2,
         "condition": {"path": "step.condition_result", "operator": "eq", "value": False}},
        {"source_node_key": "approval_1", "target_node_key": "notify_1", "priority": 1, "condition": {}},
        {"source_node_key": "notify_1", "target_node_key": "end", "priority": 1, "condition": {}},
    ]

    return {
        "name": f"AI: {payload.prompt[:60]}",
        "description": "",
        "trigger_event": trigger_event,
        "trigger_conditions": {},
        "definition_json": {"generated_at": datetime.utcnow().isoformat(), "source": "nl_rule_based"},
        "nodes": nodes,
        "edges": edges,
        "ai_generated": True,
    }


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

    existing_names = [
        d.name for d in db.query(WorkflowDefinition.name)
        .filter(WorkflowDefinition.tenant_id == tenant_id).limit(50).all()
    ]

    # Try GPT-4o
    try:
        client = _get_openai_client()
        user_msg = (
            f"Active frameworks: {', '.join(framework_names) or 'None specified'}.\n"
            f"Existing workflows: {', '.join(existing_names) or 'None'}.\n"
            "Suggest 6 GRC workflow automations most relevant to this tenant."
        )
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": _SUGGESTIONS_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            temperature=0.4,
            max_tokens=1500,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or "[]"
        # GPT may return {"suggestions": [...]} or a bare array
        parsed = json.loads(raw)
        suggestions = parsed if isinstance(parsed, list) else parsed.get("suggestions", parsed.get("items", []))

        # Mark already existing ones
        existing_set = {n.lower() for n in existing_names}
        for s in suggestions:
            s["already_exists"] = any(
                s.get("title", "").lower() in existing_set or
                existing.lower() in s.get("title", "").lower()
                for existing in existing_names
            )

        return {"frameworks": framework_names, "suggestions": suggestions, "ai_generated": True}

    except HTTPException:
        pass
    except Exception:
        pass

    # --- Rule-based fallback ---
    suggestions = []
    for name in framework_names:
        lname = name.lower()
        if "iso" in lname:
            suggestions.append({
                "title": f"{name} Annual Management Review",
                "description": "Automate the annual ISO management review cycle with approval gates.",
                "framework_ref": name,
                "trigger_event": "schedule_recurring",
                "category": "audit",
                "already_exists": name.lower() in {n.lower() for n in existing_names},
            })
        if "nist" in lname:
            suggestions.append({
                "title": f"{name} Quarterly Control Reassessment",
                "description": "Trigger quarterly reassessment and evidence collection for NIST controls.",
                "framework_ref": name,
                "trigger_event": "schedule_recurring",
                "category": "risk_management",
                "already_exists": False,
            })
        if "pci" in lname or "sox" in lname:
            suggestions.append({
                "title": f"{name} Evidence Expiry Escalation",
                "description": "Alert and escalate when compliance evidence is about to expire.",
                "framework_ref": name,
                "trigger_event": "evidence_expires",
                "category": "evidence_management",
                "already_exists": False,
            })

    if not suggestions:
        suggestions = [
            {
                "title": "Critical Risk Escalation",
                "description": "Auto-escalate risks that breach a critical score threshold.",
                "framework_ref": "General",
                "trigger_event": "risk_score_exceeds_threshold",
                "category": "risk_management",
                "already_exists": False,
            },
            {
                "title": "Incident Response Playbook",
                "description": "Automatically assign owners and notify management when an incident is reported.",
                "framework_ref": "General",
                "trigger_event": "incident_reported",
                "category": "incident_response",
                "already_exists": False,
            },
        ]

    return {"frameworks": framework_names, "suggestions": suggestions, "ai_generated": False}


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
    terminal_count = len([
        n
        for n in definition.nodes
        if bool(n.is_terminal) or (n.node_key or "").lower() == "end"
    ])
    approval_count = len([n for n in definition.nodes if (n.node_type or "").lower() == "approval"])
    timer_count = len([n for n in definition.nodes if (n.node_type or "").lower() == "timer"])

    # Build graph summary for GPT
    node_summary = [
        {"key": n.node_key, "type": n.node_type, "label": n.name}
        for n in definition.nodes
    ]

    # Try GPT-4o
    try:
        client = _get_openai_client()
        graph_context = json.dumps({
            "workflow_name": definition.name,
            "node_count": node_count,
            "edge_count": edge_count,
            "approval_nodes": approval_count,
            "timer_nodes": timer_count,
            "terminal_nodes": terminal_count,
            "nodes": node_summary[:20],
        }, indent=2)

        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": _OPTIMIZE_SYSTEM_PROMPT},
                {"role": "user", "content": f"Analyze this GRC workflow:\n{graph_context}"},
            ],
            temperature=0.3,
            max_tokens=800,
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content or "{}"
        data = json.loads(raw)
        return {
            "workflow_definition_id": definition.id,
            "analysis": {
                "node_count": node_count,
                "edge_count": edge_count,
                "terminal_nodes": terminal_count,
            },
            **data,
            "ai_generated": True,
        }

    except HTTPException:
        pass
    except Exception:
        pass

    # --- Rule-based fallback ---
    suggestions = []
    if node_count > 20:
        suggestions.append({
            "type": "simplification",
            "title": "Extract sub-workflows",
            "description": "Consider extracting repeated logic into sub-workflows to reduce complexity.",
            "priority": "medium",
        })
    if terminal_count == 0:
        suggestions.append({
            "type": "reliability",
            "title": "Add an end node",
            "description": "Add at least one terminal/end node to avoid non-terminating paths.",
            "priority": "high",
        })
    if edge_count < max(1, node_count - 1):
        suggestions.append({
            "type": "reliability",
            "title": "Review disconnected nodes",
            "description": "Some nodes appear to have no outbound edges — check for missing transitions.",
            "priority": "high",
        })
    if payload.include_sla_analysis and timer_count == 0 and approval_count > 0:
        suggestions.append({
            "type": "compliance",
            "title": "Add SLA timers",
            "description": "Approval nodes have no SLA timers — add timer nodes to escalate overdue approvals.",
            "priority": "medium",
        })
    if not suggestions:
        suggestions.append({
            "type": "performance",
            "title": "Workflow looks healthy",
            "description": "Structure is clean; monitor runtime bottlenecks for further tuning.",
            "priority": "low",
        })

    return {
        "workflow_definition_id": definition.id,
        "overall_health": "good" if not any(s["priority"] == "high" for s in suggestions) else "needs_improvement",
        "summary": "Automated structural analysis",
        "analysis": {
            "node_count": node_count,
            "edge_count": edge_count,
            "terminal_nodes": terminal_count,
        },
        "suggestions": suggestions,
        "ai_generated": False,
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

    anomalies = [
        {
            "instance_id": item.id,
            "workflow_definition_id": item.workflow_definition_id,
            "status": item.status,
            "current_node_key": item.current_node_key,
            "started_at": item.started_at,
            "signal": "long_running_or_stuck",
            "suggested_action": "Review the current step and check for missing approvals or stuck timers",
        }
        for item in stale_instances
    ]

    return {
        "lookback_hours": payload.lookback_hours,
        "runtime_threshold_minutes": payload.runtime_threshold_minutes,
        "anomalies": anomalies,
        "total_flagged": len(anomalies),
    }
