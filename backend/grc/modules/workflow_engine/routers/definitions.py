import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List, Optional

from ....models import WorkflowDefinition, WorkflowDefinitionVersion, WorkflowEdge, WorkflowNode, GRCUser, get_db
from ....routers.auth_router import require_auth, get_user_primary_tenant, get_user_tenants, require_tenant_permission
from ....rich_audit import write_rich_audit_log, model_to_dict
from ..schemas import (
    WorkflowDefinitionCreate,
    WorkflowDefinitionResponse,
    WorkflowDefinitionUpdate,
    WorkflowVersionResponse,
)
from ..services.definition_versions import snapshot_definition

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/definitions", tags=["Workflow Engine Definitions"])

# ---------------------------------------------------------------------------
# Auto-trigger inference: maps platform_action node → trigger_event
# The first node after Start defines what event auto-fires the workflow.
# Pattern: platform_action.{verb}.{module_path...}
# ---------------------------------------------------------------------------

# Segment(s) in the action_name path → canonical resource type (matches _EVENT_MAP keys)
_PATH_TO_RESOURCE = [
    # ── Compliance submodules (most-specific first) ──
    ("compliance.control_library",      "compliance.control_library"),
    ("compliance.statements",           "compliance.statements"),
    ("compliance.evidence",             "compliance.evidence"),
    ("compliance.evidence_requirements","compliance.evidence_requirements"),
    ("compliance.assessments",          "compliance.assessments"),
    ("compliance.controls",             "compliance.controls"),
    ("compliance.frameworks",           "compliance.frameworks"),
    ("compliance",                      "compliance"),

    # ── Vulnerability Management submodules ──
    ("vulnerability_management.vulnerabilities", "vulnmgmt.vulnerabilities"),
    ("vulnerability_management.departments",     "vulnmgmt.departments"),
    ("vulnerability_management.reports",         "vulnmgmt.reports"),
    ("vulnerability_management.sla_config",      "vulnmgmt.sla_config"),
    ("vulnerability_management",                 "vulnerabilities"),
    ("vuln_management",                          "vulnerabilities"),

    # ── Governance submodules ──
    ("governance.documents",       "governance.documents"),
    ("governance.committees",      "governance.committees"),
    ("governance.attestations",    "governance.attestations"),
    ("governance.clause_coverage", "governance.clause_coverage"),
    ("governance.regulatory_changes", "governance.regulatory_changes"),
    ("governance.regulatory_feeds",   "governance.regulatory_feeds"),
    ("governance.regulatory",      "governance.regulatory"),
    ("governance.critical_rules",  "governance.critical_rules"),
    ("governance.patch_proposals", "governance.patch_proposals"),
    ("governance",                 "governance"),

    # ── Risk Management submodules ──
    ("risk_management.incidents",        "risk.incidents"),
    ("risk_management.kris",             "risk.kris"),
    ("risk_management.risk_register",    "risk.risk_register"),
    ("risk_management.risk_assessments", "risk.risk_assessments"),
    ("risk_management.risk_framework",   "risk.risk_framework"),
    ("risk_management.internal_controls","risk.internal_controls"),
    ("risk_management.mitigation_actions","risk.mitigation_actions"),
    ("risk_management.vendor_risk",      "risk.vendor_risk"),
    ("risk_management.rcsa",             "risk.rcsa"),
    ("risk_management.appetite",         "risk.appetite"),
    ("risk_management.dependencies",     "risk.dependencies"),
    ("risk_management.reviews",          "risk.reviews"),
    ("risk_management.advanced_analytics","risk.advanced_analytics"),
    ("risk_management",                  "risks"),
    ("erm.incident",                     "risk.incidents"),
    ("erm.risk",                         "risks"),
    ("erm",                              "risks"),

    # ── Issue Management submodules ──
    # Only the `issues` lifecycle is a workflow trigger source; links /
    # comments / matrices are sub-actions, not issue events, so they are left
    # unmapped (and therefore non-triggerable).
    ("issue_management.issues",    "issues"),

    # ── Audit (Auditor Portal) ──
    # The auditor portal's only write surface is control auto-approval and
    # review submission; map each to its own resource so they yield distinct
    # audit trigger events.
    ("auditor_portal.controls",    "audit.controls"),
    ("auditor_portal.reviews",     "audit.reviews"),
    ("auditor_portal",             "audits"),

    # ── Other modules ──
    ("audit_management",           "audits"),
    ("evidence_mgmt",              "compliance.evidence"),
    ("evidence",                   "compliance.evidence"),
    ("assets",                     "assets"),
    ("kri",                        "risk.kris"),
    ("audits",                     "audits"),
]

# First canonical trigger event per (resource, verb) — the "primary" trigger name
_VERBS = ("create", "update", "delete", "trigger", "upload", "approve", "reject")

def _sub_triggers(resource: str) -> dict:
    """Generate (resource, verb) → resource.verb entries for all standard verbs."""
    return {(resource, v): f"{resource}.{v}" for v in _VERBS}

_PRIMARY_TRIGGER: dict[tuple[str, str], str] = {
    # ── Compliance submodules ──
    **_sub_triggers("compliance.control_library"),
    **_sub_triggers("compliance.statements"),
    **_sub_triggers("compliance.evidence"),
    **_sub_triggers("compliance.evidence_requirements"),
    **_sub_triggers("compliance.assessments"),
    **_sub_triggers("compliance.controls"),
    **_sub_triggers("compliance.frameworks"),

    # ── Vulnerability Management submodules ──
    **_sub_triggers("vulnmgmt.vulnerabilities"),
    **_sub_triggers("vulnmgmt.departments"),
    **_sub_triggers("vulnmgmt.reports"),
    **_sub_triggers("vulnmgmt.sla_config"),

    # ── Governance submodules ──
    **_sub_triggers("governance.documents"),
    **_sub_triggers("governance.committees"),
    **_sub_triggers("governance.attestations"),
    **_sub_triggers("governance.clause_coverage"),
    **_sub_triggers("governance.regulatory_changes"),
    **_sub_triggers("governance.regulatory_feeds"),
    **_sub_triggers("governance.critical_rules"),
    **_sub_triggers("governance.patch_proposals"),

    # ── Risk Management submodules ──
    **_sub_triggers("risk.incidents"),
    **_sub_triggers("risk.kris"),
    **_sub_triggers("risk.risk_register"),
    **_sub_triggers("risk.risk_assessments"),
    **_sub_triggers("risk.risk_framework"),
    **_sub_triggers("risk.internal_controls"),
    **_sub_triggers("risk.mitigation_actions"),
    **_sub_triggers("risk.vendor_risk"),
    **_sub_triggers("risk.rcsa"),
    **_sub_triggers("risk.appetite"),
    **_sub_triggers("risk.dependencies"),
    **_sub_triggers("risk.reviews"),
    **_sub_triggers("risk.advanced_analytics"),

    # ── Module-level fallbacks (legacy broad triggers) ──
    ("risks",           "create"):  "risk_created",
    ("risks",           "update"):  "risk_updated",
    ("risks",           "delete"):  "risk_deleted",
    ("vulnerabilities", "create"):  "vulnerability_created",
    ("vulnerabilities", "update"):  "vulnerability_updated",
    ("vulnerabilities", "delete"):  "vulnerability_deleted",
    ("assets",          "create"):  "asset_created",
    ("assets",          "update"):  "asset_updated",
    ("assets",          "delete"):  "asset_deleted",
    ("governance",      "create"):  "governance.create",
    ("governance",      "update"):  "assessment_status_change",
    ("governance",      "delete"):  "governance.delete",
    ("governance",      "trigger"): "policy_submitted_for_review",
    ("governance",      "upload"):  "governance.upload",
    ("governance",      "approve"): "governance.approve",
    ("governance",      "reject"):  "governance.reject",
    ("compliance",      "create"):  "compliance_gap_detected",
    ("compliance",      "update"):  "assessment_status_change",
    ("compliance",      "delete"):  "compliance.delete",
    ("compliance",      "trigger"): "compliance_gap_detected",
    ("audits",          "create"):  "audit_finding_created",
    ("audits",          "update"):  "audits.update",
    ("audits",          "delete"):  "audits.delete",

    # ── Issue Management ──
    ("issues",          "create"):  "issue_created",
    ("issues",          "update"):  "issue_state_changed",
    ("issues",          "delete"):  "issue-management.issues.delete",

    # ── Audit (Auditor Portal) — real write events ──
    ("audit.controls",  "trigger"): "audit_control_approved",
    ("audit.reviews",   "create"):  "audit_review_submitted",
}


def _infer_trigger_event(nodes: List[dict], edges: List[dict]) -> Optional[str]:
    """
    Infer trigger_event by looking at the first node connected after Start.
    Returns the inferred trigger event string, or None if it cannot be determined.
    """
    # Find the start node key
    start_key: Optional[str] = None
    # Prefer the explicit Start placeholder (node_key == "start") over generic
    # is_start nodes — palette-added trigger nodes also serialize with
    # is_start=True, so checking node_key first removes payload-order
    # brittleness if the placeholder isn't first in the list. Fall back to
    # is_start only when no placeholder is present.
    for node in nodes:
        if (node.get("node_key") or "").lower() == "start":
            start_key = node.get("node_key")
            break
    if not start_key:
        for node in nodes:
            if node.get("is_start"):
                start_key = node.get("node_key")
                break

    if not start_key:
        return None

    # Find the first node key directly connected after start
    first_node_key: Optional[str] = None
    for edge in edges:
        if edge.get("source_node_key") == start_key:
            first_node_key = edge.get("target_node_key")
            break

    if not first_node_key:
        return None

    # Get that node's config + type. Only ``action`` nodes carry a meaningful
    # ``action_name`` for CRUD-trigger inference; other node types (condition,
    # approval, timer, etc.) may incidentally store an action_name in their
    # config but must NOT be treated as workflow triggers.
    first_cfg: dict = {}
    first_type: str = ""
    for node in nodes:
        if node.get("node_key") == first_node_key:
            first_cfg = node.get("config") or {}
            first_type = (node.get("node_type") or "").lower()
            break

    if first_type != "action":
        return None

    action_name: str = first_cfg.get("action_name") or ""
    if not action_name.startswith("platform_action."):
        return None

    # Parse: platform_action.{verb}.{module_path...}
    parts = action_name.split(".")
    if len(parts) < 3:
        return None

    verb = parts[1]                        # create | update | delete | trigger
    module_path = ".".join(parts[2:])      # e.g. "compliance.control_library.group"

    # Match module_path to resource type (longest-prefix-first)
    resource: Optional[str] = None
    for prefix, res in _PATH_TO_RESOURCE:
        if module_path.startswith(prefix):
            resource = res
            break

    if not resource:
        return None

    # verb normalisation
    verb_key = verb if verb in ("create", "update", "delete", "trigger") else "update"

    trigger = _PRIMARY_TRIGGER.get((resource, verb_key))
    if trigger:
        logger.info(
            "workflow.auto_trigger action=%s → resource=%s verb=%s → trigger=%s",
            action_name, resource, verb_key, trigger,
        )
    return trigger


def _validate_workflow_graph(nodes: List[dict], edges: List[dict]) -> None:
    """
    Enforce trigger-graph invariants at save time. Raises HTTPException(400) on
    violations. Mirrors the frontend `validateWorkflowGraph` so users see the
    same message regardless of which side catches the problem.

    Invariants:
      1. Empty drafts (no user nodes) are allowed.
      2. The Start placeholder must have exactly one outgoing edge.
      3. The first node after Start must either be a dedicated trigger node
         (`is_start=True` or has `config.trigger_type`) OR an action whose
         `action_name` infers to a concrete trigger event.
    """
    # A graph with only the Start PLACEHOLDER (and optionally End) has no real
    # work and cannot have a derivable trigger event. We intentionally do NOT
    # exclude all `is_start` nodes from work_nodes here — palette-added
    # dedicated trigger nodes (Manual Trigger, Webhook, Schedule) serialize
    # with is_start=True but they ARE work because they configure the trigger
    # event. Only the Start placeholder (node_key == "start") and End
    # terminals are excluded. This keeps trigger-only graphs saveable while
    # still rejecting true Start-only / Start→End drafts.
    work_nodes = [
        n for n in nodes
        if not (
            (n.get("node_key") or "").lower() == "start"
            or n.get("is_terminal")
            or (n.get("node_key") or "").lower() == "end"
        )
    ]
    if not work_nodes:
        raise HTTPException(
            status_code=400,
            detail=(
                "Add at least one node after Start so the workflow has something "
                "to do. An empty Start→End workflow cannot be saved."
            ),
        )

    # ── Fixed-shell (guided builder) invariants ───────────────────────────────
    # The guided builder serializes the fixed shell
    #   [Start] → [Trigger(s)] → [Notification(s)?] → [Escalation?] → [End]
    # marking each trigger node with `config.is_workflow_trigger` and the single
    # escalation node with `action_name == "escalate_to_management"`. These checks
    # only engage when those markers are present, so legacy free-form graphs are
    # untouched. Notifications stay optional (trigger → escalation directly is
    # valid); escalation requires at least one trigger.
    def _cfg(n: dict) -> dict:
        c = n.get("config")
        return c if isinstance(c, dict) else {}

    trigger_nodes = [n for n in work_nodes if _cfg(n).get("is_workflow_trigger")]
    escalation_nodes = [
        n for n in work_nodes
        if (_cfg(n).get("action_name") or "") == "escalate_to_management"
    ]
    is_guided = bool(trigger_nodes) or bool(escalation_nodes)
    if is_guided:
        if not trigger_nodes:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Add at least one Trigger node after Start. The escalation step "
                    "stays empty until a trigger is selected."
                ),
            )
        if len(escalation_nodes) > 1:
            raise HTTPException(
                status_code=400,
                detail="A workflow can have only one Escalation node.",
            )
        for tn in trigger_nodes:
            _tc = _cfg(tn)
            # A trigger node is configured when it maps to a platform function
            # (action_name) OR carries a curated semantic event (event_name).
            if not ((_tc.get("action_name") or "").strip() or (_tc.get("event_name") or "").strip()):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Every Trigger node must map to a platform functionality "
                        "or a platform event before the workflow can be saved."
                    ),
                )

    # Locate the Start node (placeholder or user-added trigger placed first).
    start_key: Optional[str] = None
    # Prefer the explicit Start placeholder (node_key == "start") over generic
    # is_start nodes — palette-added trigger nodes also serialize with
    # is_start=True, so checking node_key first removes payload-order
    # brittleness if the placeholder isn't first in the list. Fall back to
    # is_start only when no placeholder is present.
    for node in nodes:
        if (node.get("node_key") or "").lower() == "start":
            start_key = node.get("node_key")
            break
    if not start_key:
        for node in nodes:
            if node.get("is_start"):
                start_key = node.get("node_key")
                break
    if not start_key:
        raise HTTPException(status_code=400, detail="Workflow must contain a Start node.")

    # Check if the Start placeholder itself carries a trigger_type.
    start_node_obj = next((n for n in nodes if n.get("node_key") == start_key), None)
    start_has_trigger = False
    if start_node_obj:
        start_cfg_val = (start_node_obj.get("config") or {}).get("trigger_type", "")
        start_has_trigger = isinstance(start_cfg_val, str) and bool(start_cfg_val.strip())

    start_edges = [e for e in edges if e.get("source_node_key") == start_key]
    if len(start_edges) == 0:
        raise HTTPException(
            status_code=400,
            detail="Connect a node to the Start node to define the workflow trigger.",
        )
    if len(start_edges) > 1:
        raise HTTPException(
            status_code=400,
            detail="Start node can only have one outgoing connection. Branching must come after the trigger node.",
        )

    first_node_key = start_edges[0].get("target_node_key")
    first_node: Optional[dict] = None
    for n in nodes:
        if n.get("node_key") == first_node_key:
            first_node = n
            break
    if not first_node:
        raise HTTPException(
            status_code=400,
            detail="Invalid workflow: edge from Start points to a non-existent node.",
        )

    # If Start itself defines the trigger, skip first-node trigger eligibility
    # check — the trigger is already known. Edge integrity was validated above.
    if start_has_trigger:
        return

    first_cfg = first_node.get("config") or {}
    # Curated event trigger (guided builder) — the event lives in
    # ``config.event_name`` and is a valid trigger on its own.
    if (first_cfg.get("event_name") or "").strip():
        return
    is_structural_trigger = (
        first_node.get("is_start")
        or (first_node.get("node_type") or "").lower() == "start"
    )
    has_trigger_type = bool((first_cfg.get("trigger_type") or "").strip())
    if is_structural_trigger and has_trigger_type:
        return

    # An End node placed directly after Start is not a valid trigger but, since
    # the only-Start/End graph is treated as an empty draft above, this branch
    # only fires when there ARE work nodes elsewhere — meaning the user explicitly
    # routed Start to End and needs to fix the graph.
    if first_node.get("is_terminal") or (first_node.get("node_key") or "").lower() == "end":
        raise HTTPException(
            status_code=400,
            detail="Start cannot connect directly to End when the workflow has other nodes. Route through a trigger.",
        )

    # Otherwise the first node must be an action that infers a concrete trigger event.
    inferred = _infer_trigger_event(nodes, edges)
    if not inferred:
        raise HTTPException(
            status_code=400,
            detail=(
                "The first node after Start cannot be used as a workflow trigger. "
                "Use a Trigger node, or a Platform Function CRUD action that maps to a system event."
            ),
        )


# Canonical mapping for dedicated trigger nodes (manual / scheduled / webhook).
# Mirrors the frontend `TRIGGER_EVENT_MAP` so the persisted `trigger_event`
# stays consistent regardless of which side derived it.
_TRIGGER_TYPE_TO_EVENT: dict[str, str] = {
    "manual_trigger":     "manual.trigger",
    "schedule_recurring": "scheduler.recurring",
    "webhook":            "workflow.webhook",
}


def _derive_trigger_event(nodes: List[dict], edges: List[dict]) -> Optional[str]:
    """
    Return the canonical trigger_event for this graph, or ``None`` if it can't
    be derived (empty draft / Start→End only). The result is what the backend
    persists — ``payload.trigger_event`` is intentionally ignored when this
    returns a value, so a tampered or stale client value cannot bypass the
    structural rules enforced by ``_validate_workflow_graph``.

    Resolution order, matching the frontend ``getTriggerEventForFirstNode``:
      1. Dedicated trigger node first → map ``config.trigger_type`` via
         ``_TRIGGER_TYPE_TO_EVENT`` (falling back to the raw value so custom
         trigger types still round-trip).
      2. Platform Function CRUD action first → ``_infer_trigger_event``.
      3. Otherwise → ``None``.
    """
    # Locate Start.
    start_key: Optional[str] = None
    # Prefer the explicit Start placeholder (node_key == "start") over generic
    # is_start nodes — palette-added trigger nodes also serialize with
    # is_start=True, so checking node_key first removes payload-order
    # brittleness if the placeholder isn't first in the list. Fall back to
    # is_start only when no placeholder is present.
    for node in nodes:
        if (node.get("node_key") or "").lower() == "start":
            start_key = node.get("node_key")
            break
    if not start_key:
        for node in nodes:
            if node.get("is_start"):
                start_key = node.get("node_key")
                break
    if not start_key:
        return None

    # 0. The Start node is a pure entry marker. Its default "manual_trigger"
    # placeholder must NOT win over the real trigger, which is the first node
    # connected after Start. Only a real, non-default event explicitly set on
    # Start short-circuits here (back-compat for workflows that put the event
    # on the Start node).
    start_node_obj = next((n for n in nodes if n.get("node_key") == start_key), None)
    if start_node_obj:
        start_tt = ((start_node_obj.get("config") or {}).get("trigger_type") or "").strip()
        if start_tt and start_tt != "manual_trigger":
            return _TRIGGER_TYPE_TO_EVENT.get(start_tt, start_tt)

    first_node_key: Optional[str] = None
    for edge in edges:
        if edge.get("source_node_key") == start_key:
            first_node_key = edge.get("target_node_key")
            break
    if not first_node_key:
        return None

    first_node: Optional[dict] = None
    for n in nodes:
        if n.get("node_key") == first_node_key:
            first_node = n
            break
    if not first_node:
        return None

    cfg = first_node.get("config") or {}

    # 1. Curated event trigger node (guided builder). The semantic event the
    #    workflow fires on is stored directly in ``config.event_name`` (e.g.
    #    "evidence_uploaded", "vulnerability_sla_breach"). These have no
    #    platform_action CRUD mapping — the event IS the trigger.
    explicit_event = (cfg.get("event_name") or "").strip()
    if explicit_event:
        return explicit_event

    # 2. Dedicated trigger node (manual / scheduled / webhook).
    is_structural_trigger = (
        first_node.get("is_start")
        or (first_node.get("node_type") or "").lower() == "start"
    )
    trigger_type = (cfg.get("trigger_type") or "").strip()
    if is_structural_trigger and trigger_type:
        return _TRIGGER_TYPE_TO_EVENT.get(trigger_type, trigger_type)

    # 3. Platform Function CRUD inference.
    return _infer_trigger_event(nodes, edges)


def _trigger_node_key(nodes: List[dict], edges: List[dict]) -> Optional[str]:
    """node_key of the first node after Start WHEN that node IS the trigger.

    That is the case when the Start node has no explicit (non-default) trigger,
    and the first node after Start is a ``platform_action.*`` node that yields a
    CRUD trigger event. Such a node represents the *triggering event* (e.g.
    "evidence deleted") — it must NOT also be executed as an action when the
    workflow fires (otherwise it would re-perform that action every run).

    Returns None when the trigger lives on the Start node (back-compat) or the
    first node is a regular action — in those cases nothing is skipped.
    """
    start_key: Optional[str] = None
    for node in nodes:
        if (node.get("node_key") or "").lower() == "start":
            start_key = node.get("node_key")
            break
    if not start_key:
        for node in nodes:
            if node.get("is_start"):
                start_key = node.get("node_key")
                break
    if not start_key:
        return None

    start_obj = next((n for n in nodes if n.get("node_key") == start_key), None)
    start_tt = ((start_obj.get("config") or {}).get("trigger_type") or "").strip() if start_obj else ""
    if start_tt and start_tt != "manual_trigger":
        return None  # explicit event on Start → the first node is a real action

    first_key = next(
        (e.get("target_node_key") for e in edges if e.get("source_node_key") == start_key),
        None,
    )
    if not first_key:
        return None
    first = next((n for n in nodes if n.get("node_key") == first_key), None)
    if not first or (first.get("node_type") or "").lower() != "action":
        return None
    action_name = (first.get("config") or {}).get("action_name") or ""
    if not action_name.startswith("platform_action."):
        return None
    # Only treat it as the trigger when it actually maps to a CRUD event.
    return first_key if _infer_trigger_event(nodes, edges) else None


def _default_workflow_name(name: Optional[str], derived_trigger: Optional[str]) -> str:
    """Give untitled workflows a meaningful name derived from their trigger,
    e.g. trigger 'compliance.evidence.delete' -> 'On Compliance Evidence Delete'.
    A real user-supplied name is always kept as-is."""
    n = (name or "").strip()
    if n and n.lower() not in ("untitled workflow", "untitled", "new workflow"):
        return n
    if derived_trigger:
        human = derived_trigger.replace("_", " ").replace(".", " ").strip().title()
        if human:
            return f"On {human}"
    return n or "Untitled Workflow"


def _mark_trigger_node(node_dicts: List[dict], edge_dicts: List[dict]) -> None:
    """Tag every trigger-block node's config with ``_is_trigger_node`` (and clear
    it everywhere else) so the runtime skips executing them — they represent the
    triggering EVENT, not an action to perform. Mutates node_dicts.

    The guided fixed-shell builder flags each trigger node with
    ``config.is_workflow_trigger`` (multiple triggers = OR). The derived
    first-after-start trigger is also marked, for back-compat with workflows
    authored on the legacy single-trigger canvas.
    """
    tk = _trigger_node_key(node_dicts, edge_dicts)
    for n in node_dicts:
        cfg = n.get("config")
        if not isinstance(cfg, dict):
            continue
        is_trigger = bool(cfg.get("is_workflow_trigger")) or (tk is not None and n.get("node_key") == tk)
        if is_trigger:
            cfg["_is_trigger_node"] = True
        else:
            cfg.pop("_is_trigger_node", None)


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
        trigger_events=definition.trigger_events if isinstance(definition.trigger_events, list) and definition.trigger_events else [definition.trigger_event],
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

    node_dicts = [n.model_dump() for n in payload.nodes]
    edge_dicts = [e.model_dump() for e in payload.edges]

    _validate_workflow_graph(node_dicts, edge_dicts)

    # Lock trigger_event to the value the graph itself derives. _validate_workflow_graph
    # has already rejected empty drafts and any graph that can't yield a derivation,
    # so we expect derived to be non-None here; the fallback is a defensive guard.
    derived = _derive_trigger_event(node_dicts, edge_dicts)
    resolved_trigger = derived or payload.trigger_event or "manual.trigger"
    if derived and payload.trigger_event and payload.trigger_event != derived:
        logger.info(
            "workflow.definition.trigger_overridden requested=%s derived=%s",
            payload.trigger_event, derived,
        )

    # Multi-trigger OR set. The guided builder sends every trigger event; the
    # primary derived/resolved trigger is always included and kept first so the
    # NOT NULL `trigger_event` column and the OR-set stay consistent.
    trigger_events = [resolved_trigger, *[t for t in (payload.trigger_events or []) if t and t != resolved_trigger]]

    definition = WorkflowDefinition(
        tenant_id=tenant_id,
        name=_default_workflow_name(payload.name, resolved_trigger),
        description=payload.description,
        trigger_event=resolved_trigger,
        trigger_events=trigger_events,
        trigger_conditions=payload.trigger_conditions,
        definition_json=payload.definition_json,
        is_active=payload.is_active,
        created_by_id=current_user.id,
        updated_by_id=current_user.id,
    )
    db.add(definition)
    db.flush()

    # Tag the trigger node (first node after Start, when it IS the trigger) so
    # the runtime doesn't also execute it as an action.
    _mark_trigger_node(node_dicts, edge_dicts)
    _apply_nodes(db, definition.id, node_dicts)
    _apply_edges(db, definition.id, edge_dicts)

    db.flush()
    db.refresh(definition)
    snapshot_definition(db, definition, change_summary="Initial workflow definition created")
    db.commit()
    db.refresh(definition)

    write_rich_audit_log(
        db=db,
        tenant_id=tenant_id,
        user_id=current_user.id,
        action="create",
        resource_type="workflow_engine",
        resource_id=definition.id,
        resource_name=definition.name,
        summary=f"Created Workflow Definition '{definition.name}' (trigger: {definition.trigger_event})",
        snapshot=model_to_dict(definition),
        resource_url=f"/workflow-engine/{definition.id}",
    )
    db.commit()

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

    _full_before_def = model_to_dict(definition)
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

    # Re-derive trigger_event from the (possibly merged) effective graph. We do
    # this on EVERY update — not just when nodes/edges change — so that a client
    # cannot bypass derivation by patching only ``trigger_event`` while keeping
    # the graph the same (which would otherwise leave the column stale or let
    # the user pin an arbitrary event string for a fully-derivable graph).
    effective_nodes = node_data if node_data is not None else [
        {"node_key": n.node_key, "node_type": n.node_type, "config": n.config or {},
         "is_start": n.is_start, "is_terminal": n.is_terminal}
        for n in db.query(WorkflowNode).filter(WorkflowNode.workflow_definition_id == definition.id).all()
    ]
    effective_edges = edge_data if edge_data is not None else [
        {"source_node_key": e.source_node_key, "target_node_key": e.target_node_key}
        for e in db.query(WorkflowEdge).filter(WorkflowEdge.workflow_definition_id == definition.id).all()
    ]
    # Always re-validate the effective graph on update — including pure metadata
    # PATCHes (name, is_active, trigger_event). Without this, a client could
    # toggle ``is_active=true`` on a pre-existing invalid graph (legacy or
    # externally inserted) and bypass the save-time invariants. Empty drafts
    # are permitted by ``_validate_workflow_graph`` itself.
    _validate_workflow_graph(effective_nodes, effective_edges)
    derived = _derive_trigger_event(effective_nodes, effective_edges)
    if derived:
        if "trigger_event" in update_data and update_data["trigger_event"] != derived:
            logger.info(
                "workflow.definition.trigger_overridden definition_id=%s requested=%s derived=%s",
                definition.id, update_data["trigger_event"], derived,
            )
        if definition.trigger_event != derived:
            definition.trigger_event = derived
            logger.info(
                "workflow.definition.trigger_inferred definition_id=%s trigger=%s",
                definition.id, derived,
            )

    # Multi-trigger OR set. When the guided builder sends an explicit list, use
    # it; otherwise keep the existing set. The primary trigger_event is always
    # first so the OR-set and the NOT NULL column stay consistent.
    if "trigger_events" in update_data:
        explicit = [t for t in (update_data.get("trigger_events") or []) if t]
        primary = definition.trigger_event
        definition.trigger_events = [primary, *[t for t in explicit if t != primary]] if primary else explicit
    elif derived:
        existing = definition.trigger_events if isinstance(definition.trigger_events, list) else []
        definition.trigger_events = [derived, *[t for t in existing if t and t != derived]]
        # Give an untitled workflow a meaningful name from its derived trigger.
        _named = _default_workflow_name(definition.name, derived)
        if _named != (definition.name or ""):
            definition.name = _named
    elif "trigger_event" in update_data:
        # Empty-draft graph: respect the client value (already set above) but
        # log it so changes are auditable.
        logger.info(
            "workflow.definition.trigger_event.draft_set definition_id=%s value=%s",
            definition.id, update_data["trigger_event"],
        )

    # Mark/clear the trigger nodes on the persisted rows so the runtime skips
    # executing them (handles partial updates that don't resend the full graph).
    # Mirror `_mark_trigger_node`: every guided trigger node (config
    # `is_workflow_trigger`, multiple = OR) plus the derived first-after-start
    # trigger is flagged — so multi-trigger workflows skip ALL trigger nodes,
    # not just the first.
    _tk = _trigger_node_key(effective_nodes, effective_edges)
    for _n in db.query(WorkflowNode).filter(WorkflowNode.workflow_definition_id == definition.id).all():
        _cfg = dict(_n.config or {})
        _want = bool(_cfg.get("is_workflow_trigger")) or (_tk is not None and _n.node_key == _tk)
        if _want and not _cfg.get("_is_trigger_node"):
            _cfg["_is_trigger_node"] = True
            _n.config = _cfg
        elif not _want and "_is_trigger_node" in _cfg:
            _cfg.pop("_is_trigger_node", None)
            _n.config = _cfg

    definition.updated_by_id = current_user.id
    db.flush()
    db.refresh(definition)
    snapshot_definition(db, definition, change_summary="Workflow definition updated")

    db.commit()
    db.refresh(definition)

    write_rich_audit_log(
        db=db,
        tenant_id=definition.tenant_id,
        user_id=current_user.id,
        action="update",
        resource_type="workflow_engine",
        resource_id=definition.id,
        resource_name=definition.name,
        summary=f"Updated Workflow Definition '{definition.name}' to version {definition.version}",
        before=_full_before_def,
        after=model_to_dict(definition),
        resource_url=f"/workflow-engine/{definition.id}",
    )
    db.commit()

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

    _saved_id = definition.id
    _saved_name = definition.name
    _saved_tenant = definition.tenant_id
    _saved_snapshot = model_to_dict(definition)

    db.delete(definition)
    write_rich_audit_log(
        db=db,
        tenant_id=_saved_tenant,
        user_id=current_user.id,
        action="delete",
        resource_type="workflow_engine",
        resource_id=_saved_id,
        resource_name=_saved_name,
        summary=f"Deleted Workflow Definition '{_saved_name}'",
        snapshot=_saved_snapshot,
        resource_url=f"/workflow-engine/{_saved_id}",
    )
    db.commit()
    return None
