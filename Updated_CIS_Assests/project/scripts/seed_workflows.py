"""
GRC Workflow Catalog seeder — v5 (Platform-Functions edition).

Produces one valid live workflow per ⚡-eligible Platform Function node in
the canvas palette.  Per the user's spec, the dedicated "Triggers" palette
module (manual / schedule / webhook / evidence_uploaded / kri_breach / …)
is INTENTIONALLY IGNORED — every workflow uses a system action node from
the Platform Functions module as its first-after-Start node, which is what
the canvas marks with the green ⚡ "trigger-eligible" badge.

Anti-drift contract:
  - The list of nodes is enumerated directly from the backend's authoritative
    `PLATFORM_FUNCTION_NODE_TYPES` (the same source the frontend palette
    consumes via the catalog API).  Trigger-eligibility is decided by the
    1:1 Python mirror of `getTriggerEventForFirstNode` in
    `scripts/workflow_validator.py`.
  - Every recipe is pre-flight validated.  Pre-flight failures abort the run
    BEFORE any HTTP call is made.
  - After POSTing, every created definition is re-fetched and the persisted
    `trigger_event` is strict-compared against the canvas-derived value.
    Any drift fails the run with a non-zero exit code.

Usage:
    python3 scripts/seed_workflows.py
"""
from __future__ import annotations

import os
import sys
import time
from typing import Any

import requests

# Allow running from project root or scripts/ dir
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# Backend lives at .migration-backup/backend in this monorepo — needed so we
# can import the authoritative PLATFORM_FUNCTION_NODE_TYPES catalog.
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
sys.path.insert(0, os.path.join(_REPO_ROOT, ".migration-backup", "backend"))

from workflow_validator import (  # noqa: E402
    infer_trigger_event_from_action_name,
    synthesize_action_name,
    validate_graph,
)
from grc.modules.workflow_engine.services.catalog import (  # noqa: E402
    PLATFORM_FUNCTION_NODE_TYPES,
)

BASE = os.environ.get("GRC_BASE_URL", "http://localhost:5000/grc")
EMAIL = os.environ.get("GRC_SEED_EMAIL", "info@layeron.com")
PASSWORD = os.environ.get("GRC_SEED_PASSWORD", "TestE2E!2026")
USER_ID = "1"

session = requests.Session()


# ───────────────────────── Auth + listing ─────────────────────────────────
def login() -> None:
    r = session.post(f"{BASE}/auth/login", json={"username": EMAIL, "password": PASSWORD}, timeout=15)
    r.raise_for_status()
    print(f"[auth] logged in as {EMAIL}")


def existing_definition_names() -> set[str]:
    r = session.get(f"{BASE}/workflow-engine/definitions", timeout=15)
    r.raise_for_status()
    return {d.get("name") for d in r.json() if d.get("name")}


# Populated by main() after login. Used by _verify_one to reject any node
# whose action_name/condition_kind/approval_type/timer_kind isn't a real
# palette item from the backend catalog.
CATALOG_KEYS: dict[str, set[str]] = {
    "actions": set(),
    "conditions": set(),
    "approvals": set(),
    "timers": set(),
    "platform_functions": set(),
}


def fetch_catalog_keys() -> dict[str, set[str]]:
    """Fetch /workflow-engine/catalog/node-types and bucket every key by group.
    platform_functions is a dict-of-lists (module → items) — flatten."""
    r = session.get(f"{BASE}/workflow-engine/catalog/node-types", timeout=15)
    r.raise_for_status()
    raw = r.json()
    out: dict[str, set[str]] = {k: set() for k in CATALOG_KEYS}
    for grp in ("actions", "conditions", "approvals", "timers"):
        for item in raw.get(grp) or []:
            k = item.get("key")
            if k:
                out[grp].add(k)
    pf = raw.get("platform_functions") or {}
    for items in pf.values():
        for item in items or []:
            k = item.get("key")
            if k:
                out["platform_functions"].add(k)
    return out


def fetch_definition(def_id: int) -> dict | None:
    r = session.get(f"{BASE}/workflow-engine/definitions/{def_id}", timeout=15)
    if not r.ok:
        return None
    return r.json()


# ───────────────────────── Node builders ──────────────────────────────────
def start_plain() -> dict:
    return {
        "node_key": "start", "node_type": "trigger.start", "name": "Start",
        "config": {}, "is_start": True, "is_terminal": False,
        "position_x": 80, "position_y": 200,
    }


def start_dedicated(trigger_type: str, label: str, extra_cfg: dict | None = None) -> dict:
    cfg = {"trigger_type": trigger_type}
    if extra_cfg:
        cfg.update(extra_cfg)
    return {
        "node_key": "start", "node_type": "trigger.start", "name": label,
        "config": cfg, "is_start": True, "is_terminal": False,
        "position_x": 80, "position_y": 200,
    }


def trigger_node(trigger_type: str, label: str, extra_cfg: dict | None = None,
                 x: int = 320) -> dict:
    """Pattern-A separate dedicated trigger node (placed after a Start
    placeholder). Has its own generated node_key but serializes with
    is_start=True + node_type=trigger.start."""
    cfg = {"trigger_type": trigger_type}
    if extra_cfg:
        cfg.update(extra_cfg)
    return {
        "node_key": f"trigger_{trigger_type}",
        "node_type": "trigger.start",
        "name": label, "config": cfg,
        "is_start": True, "is_terminal": False,
        "position_x": x, "position_y": 200,
    }


def end_node(x: int = 1100, y: int = 200) -> dict:
    return {
        "node_key": "end", "node_type": "end", "name": "End", "config": {},
        "is_start": False, "is_terminal": True, "position_x": x, "position_y": y,
    }


def platform_action(key: str, name: str, action_name: str, x: int, y: int = 200) -> dict:
    return {
        "node_key": key, "node_type": "action", "name": name,
        "config": {"action_name": action_name},
        "is_start": False, "is_terminal": False,
        "position_x": x, "position_y": y,
    }


# ─── Palette-faithful helpers ──────────────────────────────────────────────
# Every non-platform-function helper below mirrors the EXACT shape that
# page.tsx::onDropCanvas produces when a user drags a palette item onto the
# canvas (see also defaultConfigForGroup at page.tsx:91).
#
# Canonical palette mapping (verified against /grc/workflow-engine/catalog/node-types):
#   actions     → node_type="action",    config={action_name, payload}
#   conditions  → node_type="condition", config={condition_kind, condition:{path,operator,value}}
#   approvals   → node_type="approval",  config={approval_type, approver_user_ids,
#                                                 required_approvals, timeout_seconds, on_timeout}
#   timers      → node_type="timer",     config={timer_kind, wait_seconds}
#
# There is NO "notification" or "control" group in the catalog. Notifications
# are real `action` items with action_name = "send_notification_email" or
# "send_in_app_alert". A "combined" notification is achieved by chaining
# both action nodes — there is no synthetic combined node_type.

# Canonical palette LABELS (must match catalog payload exactly so the canvas
# renders the same name as the palette item).
PALETTE_LABEL_EMAIL = "Send notification / email"
PALETTE_LABEL_IN_APP = "Send in-app alert / notification"


def _action_notification(key: str, action_name: str, label: str,
                         subject: str, body: str, x: int, y: int) -> dict:
    """Build a real palette-action notification node."""
    return {
        "node_key": key, "node_type": "action", "name": label,
        "config": {
            "action_name": action_name,
            "payload": {
                "subject": subject,
                "message_template": body,
                "recipients": [USER_ID],
            },
        },
        "is_start": False, "is_terminal": False,
        "position_x": x, "position_y": y,
    }


def make_notify(kind: str, key_prefix: str, name_prefix: str,
                subject: str, body: str, x: int, y: int = 200,
                ) -> tuple[list[dict], list[dict], str, str]:
    """Build notification node(s) using ONLY real palette actions.

    Returns (nodes, internal_edges, first_node_key, last_node_key).

    - kind="email"    → 1 action node (send_notification_email)
    - kind="in_app"   → 1 action node (send_in_app_alert)
    - kind="combined" → 2 action nodes chained (email → in_app)
    """
    if kind == "email":
        n = _action_notification(key_prefix, "send_notification_email",
                                 name_prefix or PALETTE_LABEL_EMAIL,
                                 subject, body, x, y)
        return [n], [], key_prefix, key_prefix
    if kind == "in_app":
        n = _action_notification(key_prefix, "send_in_app_alert",
                                 name_prefix or PALETTE_LABEL_IN_APP,
                                 subject, body, x, y)
        return [n], [], key_prefix, key_prefix
    if kind == "combined":
        k1 = f"{key_prefix}_email"
        k2 = f"{key_prefix}_inapp"
        n1 = _action_notification(k1, "send_notification_email",
                                  f"{name_prefix} — Email", subject, body, x, y)
        n2 = _action_notification(k2, "send_in_app_alert",
                                  f"{name_prefix} — In-App Alert",
                                  subject, body, x, y + 150)
        return [n1, n2], [edge(k1, k2)], k1, k2
    raise ValueError(f"unknown notify kind: {kind!r}")


def approval(key: str, name: str, message: str, x: int, y: int = 200,
             hours: int = 48) -> dict:
    """Real palette `approvals` item shape (approval_type='single')."""
    return {
        "node_key": key, "node_type": "approval", "name": name,
        "config": {
            "approval_type": "single",
            "approver_user_ids": [USER_ID],
            "required_approvals": 1,
            "timeout_seconds": hours * 3600,
            "on_timeout": "escalate",
            "approval_message": message,
        },
        "is_start": False, "is_terminal": False,
        "position_x": x, "position_y": y,
    }


def condition(key: str, name: str, kind: str, x: int, y: int = 200,
              **extra: Any) -> dict:
    """Real palette `conditions` item shape (condition_kind from catalog)."""
    cond_payload: dict[str, Any] = {
        "path": extra.pop("path", "trigger.severity"),
        "operator": extra.pop("operator", "eq"),
        "value": extra.pop("value", extra.pop("risk_level", "high")),
    }
    return {
        "node_key": key, "node_type": "condition", "name": name,
        "config": {"condition_kind": kind, "condition": cond_payload, **extra},
        "is_start": False, "is_terminal": False,
        "position_x": x, "position_y": y,
    }


def wait_node(key: str, name: str, hours: int, x: int, y: int = 200) -> dict:
    """Real palette `timers` item shape (timer_kind='wait_duration')."""
    return {
        "node_key": key, "node_type": "timer", "name": name,
        "config": {
            "timer_kind": "wait_duration",
            "wait_seconds": hours * 3600,
        },
        "is_start": False, "is_terminal": False,
        "position_x": x, "position_y": y,
    }


def edge(src: str, tgt: str, condition: dict | None = None, priority: int = 100) -> dict:
    return {"source_node_key": src, "target_node_key": tgt,
            "condition": condition or {}, "priority": priority}


def approval_edge(src: str, tgt: str, branch: str) -> dict:
    label = "Approved" if branch == "approved" else "Rejected"
    return edge(src, tgt, {"branch": branch, "_label": label, "_handle": branch})


def cond_edge(src: str, tgt: str, truthy: bool, label: str | None = None) -> dict:
    handle = "condition-true" if truthy else "condition-false"
    return edge(src, tgt,
                {"_label": label or ("Yes" if truthy else "No"), "_handle": handle},
                priority=1 if truthy else 2)


# ───────────────────────── Recipe shapes ──────────────────────────────────
def _bundle(name: str, category: str, description: str,
            nodes: list[dict], edges: list[dict]) -> dict:
    return {
        "name": name,
        "category": category,
        "description": description,
        "trigger_event": "manual.trigger",  # backend re-derives from graph
        "nodes_json": nodes,
        "edges_json": edges,
        "definition_json": {},
        "trigger_conditions": {},
        "tags": [category.lower().replace(" ", "_")],
    }


def crud_notify_recipe(name: str, category: str, description: str,
                       action_name: str, subject: str, body: str,
                       action_label: str = "Trigger") -> dict:
    """Pattern B: Start → CRUD action → notify → end."""
    n_nodes, n_edges, n_first, n_last = make_notify(
        "email", "notify", PALETTE_LABEL_EMAIL, subject, body, 600)
    nodes = [
        start_plain(),
        platform_action("trigger_action", action_label, action_name, 320),
        *n_nodes,
        end_node(900),
    ]
    edges = [
        edge("start", "trigger_action"),
        edge("trigger_action", n_first),
        *n_edges,
        edge(n_last, "end"),
    ]
    return _bundle(name, category, description, nodes, edges)


def crud_approval_recipe(name: str, category: str, description: str,
                         action_name: str, approval_msg: str,
                         approved_subj: str, rejected_subj: str,
                         action_label: str = "Trigger") -> dict:
    # Symmetric branches: both single-node so BFS depth aligns and there's
    # no visual disconnect between the two approval outcomes.
    ok_nodes, ok_edges, ok_first, ok_last = make_notify(
        "email", "notify_ok", "Notify Approved",
        approved_subj, "Your request has been approved.", 820, 100)
    no_nodes, no_edges, no_first, no_last = make_notify(
        "email", "notify_no", "Notify Rejected",
        rejected_subj, "Your request was rejected.", 820, 360)
    nodes = [
        start_plain(),
        platform_action("trigger_action", action_label, action_name, 280),
        approval("approval1", "Approval Required", approval_msg, 540),
        *ok_nodes,
        *no_nodes,
        end_node(1120),
    ]
    edges = [
        edge("start", "trigger_action"),
        edge("trigger_action", "approval1"),
        approval_edge("approval1", ok_first, "approved"),
        approval_edge("approval1", no_first, "rejected"),
        *ok_edges,
        *no_edges,
        edge(ok_last, "end"),
        edge(no_last, "end"),
    ]
    return _bundle(name, category, description, nodes, edges)


def crud_severity_recipe(name: str, category: str, description: str,
                         action_name: str, critical_subj: str, low_subj: str,
                         action_label: str = "Trigger") -> dict:
    # Symmetric branches (both single-node) keeps BFS depth aligned.
    crit_nodes, crit_edges, crit_first, crit_last = make_notify(
        "email", "notify_crit", "Notify Critical/High",
        critical_subj, "A critical/high item was detected. Immediate action required.",
        820, 100)
    low_nodes, low_edges, low_first, low_last = make_notify(
        "email", "notify_low", "Notify Medium/Low",
        low_subj, "A medium/low item was detected. Follow standard handling.",
        820, 360)
    nodes = [
        start_plain(),
        platform_action("trigger_action", action_label, action_name, 280),
        condition("check_sev", "Check Severity", "check_risk_level",
                  540, risk_level="high", operator="at_least"),
        *crit_nodes,
        *low_nodes,
        end_node(1120),
    ]
    edges = [
        edge("start", "trigger_action"),
        edge("trigger_action", "check_sev"),
        cond_edge("check_sev", crit_first, True, "Critical / High"),
        cond_edge("check_sev", low_first, False, "Medium / Low"),
        *crit_edges,
        *low_edges,
        edge(crit_last, "end"),
        edge(low_last, "end"),
    ]
    return _bundle(name, category, description, nodes, edges)


def crud_with_wait_recipe(name: str, category: str, description: str,
                          action_name: str, wait_hours: int,
                          subject: str, body: str,
                          action_label: str = "Trigger") -> dict:
    n_nodes, n_edges, n_first, n_last = make_notify(
        "combined", "notify", "SLA Reminder", subject, body, 820)
    nodes = [
        start_plain(),
        platform_action("trigger_action", action_label, action_name, 280),
        wait_node("sla_wait", f"Wait {wait_hours}h", wait_hours, 540),
        *n_nodes,
        end_node(1120),
    ]
    edges = [
        edge("start", "trigger_action"),
        edge("trigger_action", "sla_wait"),
        edge("sla_wait", n_first),
        *n_edges,
        edge(n_last, "end"),
    ]
    return _bundle(name, category, description, nodes, edges)


def chain_notify_recipe(name: str, category: str, description: str,
                        trigger: tuple[str, str],
                        steps: list[tuple[str, str]],
                        subject: str, body: str) -> dict:
    """Pattern B with a downstream chain:
       Start → ⚡trigger → step1 → step2 → ... → notify → end.
       trigger / each step = (action_name, label).
    """
    nodes: list[dict] = [start_plain()]
    edges_l: list[dict] = []
    x = 320
    prev = "start"
    trig_action, trig_label = trigger
    nodes.append(platform_action("n_trigger", trig_label, trig_action, x))
    edges_l.append(edge(prev, "n_trigger"))
    prev = "n_trigger"
    x += 280
    for idx, (action_name, label) in enumerate(steps, start=1):
        node_id = f"n_step{idx}"
        nodes.append(platform_action(node_id, label, action_name, x))
        edges_l.append(edge(prev, node_id))
        prev = node_id
        x += 280
    n_nodes, n_edges, n_first, n_last = make_notify(
        "combined", "notify", "Send Notification", subject, body, x)
    nodes.extend(n_nodes)
    edges_l.append(edge(prev, n_first))
    edges_l.extend(n_edges)
    x += 280
    nodes.append(end_node(x))
    edges_l.append(edge(n_last, "end"))
    return _bundle(name, category, description, nodes, edges_l)


def chain_approval_recipe(name: str, category: str, description: str,
                          trigger: tuple[str, str],
                          steps: list[tuple[str, str]],
                          approval_msg: str,
                          approved_subj: str, rejected_subj: str) -> dict:
    """Start → ⚡trigger → step1 → ... → approval → (approved | rejected) → end."""
    nodes: list[dict] = [start_plain()]
    edges_l: list[dict] = []
    x = 320
    trig_action, trig_label = trigger
    nodes.append(platform_action("n_trigger", trig_label, trig_action, x))
    edges_l.append(edge("start", "n_trigger"))
    prev = "n_trigger"
    x += 280
    for idx, (action_name, label) in enumerate(steps, start=1):
        node_id = f"n_step{idx}"
        nodes.append(platform_action(node_id, label, action_name, x))
        edges_l.append(edge(prev, node_id))
        prev = node_id
        x += 280
    nodes.append(approval("approval1", "Approval Required", approval_msg, x))
    edges_l.append(edge(prev, "approval1"))
    x += 280
    ok_nodes, ok_edges, ok_first, ok_last = make_notify(
        "email", "notify_ok", "Notify Approved",
        approved_subj, "Your request has been approved.", x, 100)
    no_nodes, no_edges, no_first, no_last = make_notify(
        "email", "notify_no", "Notify Rejected",
        rejected_subj, "Your request was rejected.", x, 360)
    nodes.extend(ok_nodes)
    nodes.extend(no_nodes)
    edges_l.extend(ok_edges)
    edges_l.extend(no_edges)
    edges_l.append(approval_edge("approval1", ok_first, "approved"))
    edges_l.append(approval_edge("approval1", no_first, "rejected"))
    x += 280
    nodes.append(end_node(x))
    edges_l.append(edge(ok_last, "end"))
    edges_l.append(edge(no_last, "end"))
    return _bundle(name, category, description, nodes, edges_l)


def chain_wait_recipe(name: str, category: str, description: str,
                      trigger: tuple[str, str],
                      pre_wait_steps: list[tuple[str, str]],
                      wait_hours: int,
                      post_wait_steps: list[tuple[str, str]],
                      subject: str, body: str) -> dict:
    """Start → ⚡trigger → pre_wait_steps... → wait → post_wait_steps... → notify → end."""
    nodes: list[dict] = [start_plain()]
    edges_l: list[dict] = []
    x = 320
    trig_action, trig_label = trigger
    nodes.append(platform_action("n_trigger", trig_label, trig_action, x))
    edges_l.append(edge("start", "n_trigger"))
    prev = "n_trigger"
    x += 280
    for idx, (action_name, label) in enumerate(pre_wait_steps, start=1):
        node_id = f"n_pre{idx}"
        nodes.append(platform_action(node_id, label, action_name, x))
        edges_l.append(edge(prev, node_id))
        prev = node_id
        x += 280
    nodes.append(wait_node("sla_wait", f"Wait {wait_hours}h", wait_hours, x))
    edges_l.append(edge(prev, "sla_wait"))
    prev = "sla_wait"
    x += 280
    for idx, (action_name, label) in enumerate(post_wait_steps, start=1):
        node_id = f"n_post{idx}"
        nodes.append(platform_action(node_id, label, action_name, x))
        edges_l.append(edge(prev, node_id))
        prev = node_id
        x += 280
    n_nodes, n_edges, n_first, n_last = make_notify(
        "combined", "notify", "Send Notification", subject, body, x)
    nodes.extend(n_nodes)
    edges_l.append(edge(prev, n_first))
    edges_l.extend(n_edges)
    x += 280
    nodes.append(end_node(x))
    edges_l.append(edge(n_last, "end"))
    return _bundle(name, category, description, nodes, edges_l)


def chain_severity_recipe(name: str, category: str, description: str,
                          trigger: tuple[str, str],
                          steps: list[tuple[str, str]],
                          critical_subj: str, low_subj: str) -> dict:
    """Start → ⚡trigger → steps... → severity check → (crit | low) → end."""
    nodes: list[dict] = [start_plain()]
    edges_l: list[dict] = []
    x = 320
    trig_action, trig_label = trigger
    nodes.append(platform_action("n_trigger", trig_label, trig_action, x))
    edges_l.append(edge("start", "n_trigger"))
    prev = "n_trigger"
    x += 280
    for idx, (action_name, label) in enumerate(steps, start=1):
        node_id = f"n_step{idx}"
        nodes.append(platform_action(node_id, label, action_name, x))
        edges_l.append(edge(prev, node_id))
        prev = node_id
        x += 280
    nodes.append(condition("check_sev", "Check Severity", "check_risk_level",
                           x, risk_level="high", operator="at_least"))
    edges_l.append(edge(prev, "check_sev"))
    x += 280
    crit_nodes, crit_edges, crit_first, crit_last = make_notify(
        "email", "notify_crit", "Notify Critical/High",
        critical_subj,
        "Critical/high severity detected — escalate immediately.", x, 100)
    low_nodes, low_edges, low_first, low_last = make_notify(
        "email", "notify_low", "Notify Medium/Low",
        low_subj,
        "Medium/low severity — follow standard handling.", x, 360)
    nodes.extend(crit_nodes)
    nodes.extend(low_nodes)
    edges_l.extend(crit_edges)
    edges_l.extend(low_edges)
    edges_l.append(cond_edge("check_sev", crit_first, True, "Critical / High"))
    edges_l.append(cond_edge("check_sev", low_first, False, "Medium / Low"))
    x += 280
    nodes.append(end_node(x))
    edges_l.append(edge(crit_last, "end"))
    edges_l.append(edge(low_last, "end"))
    return _bundle(name, category, description, nodes, edges_l)




# ───────────────────────── Catalog generation ─────────────────────────────
# v6: hand-curated, business-meaningful workflows.
#
# Rules every entry obeys:
#   • First node after Start is a ⚡-eligible Platform Function node
#     (validator gates this — no exceptions).
#   • The dedicated "Triggers" palette module (manual/schedule/webhook/etc.)
#     is intentionally NOT used as the first-after-Start node.
#   • Downstream nodes can be ANY platform action (⚡ trigger-eligible OR
#     non-⚡ utility/AI tool from the 106-node downstream pool) plus control
#     nodes (wait, condition, approval) and notifications — chosen because
#     the workflow LOGICALLY needs them, not mechanically.
#   • A workflow may have one node or many; only the business logic decides.
def _PA(action: str, label: str) -> tuple[str, str]:
    """Tiny alias to keep the catalog dense & readable."""
    return (action, label)


def build_catalog() -> list[dict]:
    catalog: list[dict] = []
    seen_names: set[str] = set()

    # ╔══════════════════════════════════════════════════════════════════╗
    # ║  COMPLIANCE                                                       ║
    # ╚══════════════════════════════════════════════════════════════════╝

    # ── Evidence lifecycle ────────────────────────────────────────────
    catalog += [
        chain_notify_recipe(
            "Evidence Upload → AI Assessment", "Compliance",
            "When new evidence is uploaded, run AI quick-assessment, lock the "
            "assessment so it cannot be edited mid-review, and notify the "
            "compliance lead.",
            _PA("platform_action.upload.compliance.evidence.evidence", "Upload Evidence"),
            [
                _PA("platform_action.trigger.compliance.evidence.quick_assess_evidence", "AI: Quick Assess Evidence"),
                _PA("platform_action.trigger.compliance.evidence.lock_assessment", "Lock Assessment"),
            ],
            "[GRC] Evidence assessed and locked",
            "New evidence has been uploaded, AI-assessed and locked for review.",
        ),
        chain_notify_recipe(
            "Bulk Evidence AI Review", "Compliance",
            "After bulk evidence upload, fire AI batch assessment then notify the team.",
            _PA("platform_action.create.compliance.evidence.evidence", "Create Evidence"),
            [_PA("platform_action.trigger.compliance.evidence.batch_assess_evidence", "AI: Batch Assess Evidence")],
            "[GRC] Bulk evidence batch reviewed",
            "Batch AI assessment completed for newly uploaded evidence.",
        ),
        chain_notify_recipe(
            "Evidence OCR & Submission Pipeline", "Compliance",
            "Process scanned evidence with OCR, then submit it for review.",
            _PA("platform_action.upload.compliance.evidence.evidence", "Upload Evidence"),
            [
                _PA("platform_action.trigger.compliance.evidence.process_ocr", "Process OCR"),
                _PA("platform_action.trigger.compliance.evidence.submit_evidence", "Submit Evidence"),
            ],
            "[GRC] Evidence OCR processed and submitted",
            "OCR completed and the evidence is now in the review queue.",
        ),
        chain_wait_recipe(
            "Evidence Staleness Check (90 days)", "Compliance",
            "Ninety days after evidence is created, check staleness and notify the owner if expired.",
            _PA("platform_action.create.compliance.evidence.evidence", "Evidence Created"),
            [], 24 * 90,
            [_PA("platform_action.trigger.compliance.evidence.check_staleness", "Check Staleness")],
            "[GRC] Evidence staleness check",
            "Evidence is 90 days old — confirm it is still valid or upload a new copy.",
        ),
        chain_notify_recipe(
            "Audit Package Finalization", "Compliance",
            "Finalize an audit package once all evidence has been added.",
            _PA("platform_action.create.compliance.evidence.audit_package", "Create Audit Package"),
            [
                _PA("platform_action.create.compliance.evidence.add_evidence_to_package", "Add Evidence To Package"),
                _PA("platform_action.trigger.compliance.evidence.finalize_package", "Finalize Package"),
            ],
            "[GRC] Audit package finalized",
            "Audit package is sealed and ready to share with auditors.",
        ),
        chain_notify_recipe(
            "AI-Suggested Evidence Linking", "Compliance",
            "When AI suggests an evidence-control link, accept it and trigger reviewer assessment.",
            _PA("platform_action.create.compliance.evidence.link_evidence_from_ai_suggestion", "AI: Link Evidence From Suggestion"),
            [_PA("platform_action.trigger.compliance.evidence.review_evidence", "Review Evidence")],
            "[GRC] AI evidence link queued for review",
            "AI suggested an evidence-control link; please review.",
        ),
        chain_notify_recipe(
            "Evidence Renewal Workflow", "Compliance",
            "When evidence is updated, renew its validity window and log access.",
            _PA("platform_action.update.compliance.evidence.evidence", "Update Evidence"),
            [
                _PA("platform_action.trigger.compliance.evidence.renew_evidence", "Renew Evidence"),
                _PA("platform_action.trigger.compliance.evidence.log_access", "Log Access"),
            ],
            "[GRC] Evidence renewed",
            "Evidence has been renewed and the access log updated.",
        ),
    ]

    # ── Control library ──────────────────────────────────────────────
    catalog += [
        chain_notify_recipe(
            "Control Group Auto-Population", "Compliance",
            "Create a new control group, auto-classify controls into it, then summarize.",
            _PA("platform_action.create.compliance.control_library.group", "Create Group"),
            [
                _PA("platform_action.trigger.compliance.control_library.auto_group_controls", "Auto Group Controls"),
                _PA("platform_action.trigger.compliance.control_library.generate_summary", "AI: Generate Summary"),
            ],
            "[GRC] Control group ready",
            "New control group is populated and summarized.",
        ),
        chain_notify_recipe(
            "Control Inheritance Analysis", "Compliance",
            "After an inheritance relationship is created, run analysis to detect duplication and gaps.",
            _PA("platform_action.create.compliance.control_library.inheritance_relationship", "Create Inheritance Relationship"),
            [_PA("platform_action.trigger.compliance.control_library.analyze_inheritance", "Analyze Inheritance")],
            "[GRC] Control inheritance analysis ready",
            "Inheritance analysis completed for the new relationship.",
        ),
        chain_notify_recipe(
            "Framework-Driven Group Population", "Compliance",
            "When a group is updated, repopulate it from the latest framework mappings.",
            _PA("platform_action.update.compliance.control_library.group", "Update Group"),
            [
                _PA("platform_action.trigger.compliance.control_library.populate_group_from_frameworks", "Populate Group From Frameworks"),
                _PA("platform_action.trigger.compliance.control_library.generate_executive_summary", "AI: Generate Executive Summary"),
            ],
            "[GRC] Group repopulated and summarized",
            "Group refreshed from frameworks; executive summary attached.",
        ),
        chain_notify_recipe(
            "Harmonization Report Distribution", "Compliance",
            "Export the harmonization report and notify stakeholders.",
            _PA("platform_action.export.compliance.control_library.harmonization_report", "Export Harmonization Report"),
            [],
            "[GRC] Harmonization report exported",
            "The harmonization report has been exported and is ready to share.",
        ),
    ]

    # ── Controls comparison ──────────────────────────────────────────
    catalog += [
        chain_notify_recipe(
            "Control Pair AI Crosswalk", "Compliance",
            "Compare two controls side-by-side, run AI crosswalk mapping and notify reviewers.",
            _PA("platform_action.create.compliance.controls.side_by_side_comparison", "Side By Side Comparison"),
            [
                _PA("platform_action.trigger.compliance.controls.start_analysis", "Start Analysis"),
                _PA("platform_action.trigger.compliance.controls.ai_map_crosswalk", "AI: Map Crosswalk"),
            ],
            "[GRC] Crosswalk mapping ready",
            "AI crosswalk mapping completed for the comparison.",
        ),
        chain_notify_recipe(
            "Control Comparison Export", "Compliance",
            "Export a controls comparison and notify the requester.",
            _PA("platform_action.export.compliance.controls.comparison", "Export Comparison"),
            [],
            "[GRC] Controls comparison exported",
            "The comparison export is ready for download.",
        ),
    ]

    # ── Frameworks ───────────────────────────────────────────────────
    catalog += [
        chain_notify_recipe(
            "Framework Upload & Alignment", "Compliance",
            "Upload a framework, extract the text and run alignment analysis.",
            _PA("platform_action.upload.compliance.frameworks.framework", "Upload Framework"),
            [
                _PA("platform_action.upload.compliance.frameworks.extract_text_from_framework", "Extract Text From Framework"),
                _PA("platform_action.trigger.compliance.frameworks.analyze_and_align_controls", "Analyze And Align Controls"),
            ],
            "[GRC] Framework aligned",
            "New framework has been parsed and aligned to existing controls.",
        ),
        chain_approval_recipe(
            "Framework Publishing Approval", "Compliance",
            "Confirm alignment, route to compliance lead for approval, then publish and sync.",
            _PA("platform_action.update.compliance.frameworks.alignment", "Update Alignment"),
            [_PA("platform_action.trigger.compliance.frameworks.confirm_alignment", "Confirm Alignment")],
            "Framework alignment is ready — approve to publish to library.",
            "Framework approved — publishing now",
            "Framework publishing rejected",
        ),
        chain_notify_recipe(
            "Framework Decommissioning", "Compliance",
            "Notify stakeholders when a framework is unpublished from the library.",
            _PA("platform_action.delete.compliance.frameworks.unpublish_framework", "Unpublish Framework"),
            [],
            "[GRC] Framework unpublished",
            "A framework has been removed from the active library.",
        ),
    ]

    # ── Evidence requirements ────────────────────────────────────────
    catalog += [
        chain_notify_recipe(
            "AI Evidence Requirement Generation (per control)", "Compliance",
            "Generate AI-suggested evidence requirements for a single control after upload.",
            _PA("platform_action.create.compliance.evidence_requirements.upload_evidence", "Upload Evidence Requirement"),
            [_PA("platform_action.trigger.compliance.evidence_requirements.generate_for_control", "AI: Generate For Control")],
            "[GRC] AI evidence requirements ready",
            "AI-generated evidence requirements are ready for review.",
        ),
        chain_notify_recipe(
            "Bulk Evidence Recommendations", "Compliance",
            "Refresh recommendations and run bulk AI generation across the framework.",
            _PA("platform_action.update.compliance.evidence_requirements.recommendation", "Update Recommendation"),
            [_PA("platform_action.trigger.compliance.evidence_requirements.bulk_generate_recommendations", "AI: Bulk Generate Recommendations")],
            "[GRC] Bulk evidence recommendations regenerated",
            "Bulk evidence recommendations have been regenerated.",
        ),
        chain_notify_recipe(
            "Framework Document Parsing Pipeline", "Compliance",
            "Parse a framework document, classify it and surface for review.",
            _PA("platform_action.create.compliance.evidence_requirements.upload_evidence", "Upload Framework Document"),
            [
                _PA("platform_action.trigger.compliance.evidence_requirements.parse_framework_document", "Parse Framework Document"),
                _PA("platform_action.trigger.compliance.evidence_requirements.classify_framework", "AI: Classify Framework"),
            ],
            "[GRC] Framework document parsed",
            "Framework document parsed and classified.",
        ),
        chain_notify_recipe(
            "Parsed Control Verification", "Compliance",
            "Verify a parsed control after editing and notify the reviewer.",
            _PA("platform_action.update.compliance.evidence_requirements.parsed_control", "Update Parsed Control"),
            [_PA("platform_action.trigger.compliance.evidence_requirements.verify_parsed_control", "Verify Parsed Control")],
            "[GRC] Parsed control verified",
            "Parsed control has been verified.",
        ),
        chain_notify_recipe(
            "Evidence Requirement Approved", "Compliance",
            "Notify when an evidence requirement is approved.",
            _PA("platform_action.approve.compliance.evidence_requirements.evidence_requirement", "Approve Evidence Requirement"),
            [],
            "[GRC] Evidence requirement approved",
            "An evidence requirement has been approved.",
        ),
        chain_notify_recipe(
            "Evidence Requirement Rejected", "Compliance",
            "Notify when an evidence requirement is rejected.",
            _PA("platform_action.reject.compliance.evidence_requirements.evidence_requirement", "Reject Evidence Requirement"),
            [],
            "[GRC] Evidence requirement rejected",
            "An evidence requirement has been rejected.",
        ),
    ]

    # ── Compliance assessments ───────────────────────────────────────
    catalog += [
        chain_notify_recipe(
            "Framework Assessment Kick-Off", "Compliance",
            "Create a framework assessment then compute the initial compliance score.",
            _PA("platform_action.create.compliance.assessments.assessment", "Create Framework Assessment"),
            [_PA("platform_action.trigger.compliance.assessments.calculate_compliance_score", "Calculate Compliance Score")],
            "[GRC] Framework assessment opened",
            "A new framework assessment is open with the initial score computed.",
        ),
        chain_notify_recipe(
            "Gap Analysis with AI Prioritization", "Compliance",
            "Run gap analysis and AI prioritization after an assessment item changes.",
            _PA("platform_action.update.compliance.assessments.assessment_item", "Update Assessment Item"),
            [
                _PA("platform_action.trigger.compliance.assessments.gap_analysis", "Gap Analysis"),
                _PA("platform_action.trigger.compliance.assessments.ai_prioritize_gaps", "AI: Prioritize Gaps"),
            ],
            "[GRC] Gap analysis prioritized",
            "Gap analysis with AI prioritization is ready.",
        ),
        chain_notify_recipe(
            "Gap Analysis Export", "Compliance",
            "Export gap analysis and distribute to stakeholders.",
            _PA("platform_action.export.compliance.assessments.gap_analysis", "Export Gap Analysis"),
            [],
            "[GRC] Gap analysis exported",
            "Gap analysis has been exported.",
        ),
        chain_approval_recipe(
            "Risk Acceptance from Gap", "Compliance",
            "Route a gap-acceptance request through approval before recording it.",
            _PA("platform_action.update.compliance.assessments.accept_risk", "Accept Gap as Risk"),
            [],
            "Compliance gap is being accepted as a risk — approve or reject.",
            "Gap acceptance approved", "Gap acceptance rejected",
        ),
        chain_notify_recipe(
            "Compliance Score Recalculation", "Compliance",
            "Recalculate the compliance score after an override.",
            _PA("platform_action.update.compliance.assessments.override_finding", "Override Finding"),
            [_PA("platform_action.trigger.compliance.assessments.calculate_compliance_score", "Calculate Compliance Score")],
            "[GRC] Compliance score updated",
            "Compliance score has been recalculated after a finding override.",
        ),
        chain_notify_recipe(
            "Remediation Created", "Compliance",
            "Notify the assigned owner when a remediation task is created.",
            _PA("platform_action.create.compliance.assessments.remediation", "Create Remediation"),
            [],
            "[GRC] Remediation assigned",
            "A remediation task was created and assigned.",
        ),
    ]

    # ── Statements ───────────────────────────────────────────────────
    catalog += [
        chain_notify_recipe(
            "Compliance Status Change Alert", "Compliance",
            "Alert stakeholders whenever a compliance status moves.",
            _PA("platform_action.update.compliance.statements.compliance_status", "Update Compliance Status"),
            [],
            "[GRC] Compliance status changed",
            "A statement's compliance status has changed.",
        ),
        chain_notify_recipe(
            "Statement-Evidence Linking", "Compliance",
            "Notify when evidence is linked to a compliance statement.",
            _PA("platform_action.create.compliance.statements.link_evidence_to_compliance", "Link Evidence To Compliance"),
            [],
            "[GRC] Evidence linked to statement",
            "Evidence has been linked to a compliance statement.",
        ),
    ]

    # ╔══════════════════════════════════════════════════════════════════╗
    # ║  RISK MANAGEMENT                                                  ║
    # ╚══════════════════════════════════════════════════════════════════╝

    # ── Risk register ────────────────────────────────────────────────
    catalog += [
        chain_notify_recipe(
            "New Risk → AI Suggestions", "Risk Management",
            "When a risk is logged, run AI suggestions and notify the risk owner.",
            _PA("platform_action.create.risk_management.risk_register.risk", "Create Risk"),
            [_PA("platform_action.trigger.risk_management.risk_register.risk_ai_suggestions", "AI: Risk Suggestions")],
            "[GRC] AI suggestions ready for new risk",
            "AI suggestions have been generated for the newly logged risk.",
        ),
        chain_notify_recipe(
            "AI Treatment Plan Generation", "Risk Management",
            "When a treatment plan slot is opened, generate AI suggestions to populate it.",
            _PA("platform_action.create.risk_management.risk_register.add_treatment_plan", "Add Treatment Plan"),
            [_PA("platform_action.trigger.risk_management.risk_register.generate_ai_treatment_plan", "AI: Generate Treatment Plan")],
            "[GRC] AI treatment plan ready",
            "An AI-generated treatment plan is ready for review.",
        ),
        chain_severity_recipe(
            "Risk Register: Severity-Based Routing", "Risk Management",
            "Route new risks to escalation or standard queue based on severity.",
            _PA("platform_action.create.risk_management.risk_register.risk", "Risk Created"),
            [],
            "HIGH/CRITICAL risk requires immediate review",
            "New risk filed for standard review cycle",
        ),
        chain_approval_recipe(
            "Risk Acceptance Approval Gate", "Risk Management",
            "Route risk-acceptance updates through CISO approval.",
            _PA("platform_action.update.risk_management.risk_register.risk", "Risk Updated"),
            [],
            "A risk acceptance request has been submitted. Approve or reject.",
            "Risk acceptance approved", "Risk acceptance rejected",
        ),
        chain_wait_recipe(
            "Risk Treatment Plan SLA Reminder (72h)", "Risk Management",
            "Wait 72h after a risk is logged then nudge the owner if no treatment plan exists.",
            _PA("platform_action.create.risk_management.risk_register.risk", "Risk Created"),
            [], 72, [],
            "[GRC] Treatment plan still missing",
            "A risk was logged 72h ago. Please document a treatment plan or escalate.",
        ),
        chain_notify_recipe(
            "Risk Closure", "Risk Management",
            "Notify when a risk is moved to closed.",
            _PA("platform_action.update.risk_management.risk_register.risk", "Update Risk"),
            [_PA("platform_action.trigger.risk_management.risk_register.close_risk", "Close Risk")],
            "[GRC] Risk closed",
            "A risk has been closed in the register.",
        ),
        chain_notify_recipe(
            "Risk Reopened", "Risk Management",
            "Notify when a previously closed risk is reopened.",
            _PA("platform_action.update.risk_management.risk_register.risk", "Update Risk"),
            [_PA("platform_action.trigger.risk_management.risk_register.reopen_risk", "Reopen Risk")],
            "[GRC] Risk reopened",
            "A previously closed risk has been reopened.",
        ),
        chain_notify_recipe(
            "Risk-Control Linking", "Risk Management",
            "Notify when a risk is linked to a control.",
            _PA("platform_action.create.risk_management.risk_register.link_risk_to_control", "Link Risk To Control"),
            [],
            "[GRC] Risk-control link added",
            "A risk has been linked to a control.",
        ),
        chain_notify_recipe(
            "Risk-Asset Linking", "Risk Management",
            "Notify when a risk is linked to an asset.",
            _PA("platform_action.create.risk_management.risk_register.link_risk_to_asset", "Link Risk To Asset"),
            [],
            "[GRC] Risk-asset link added",
            "A risk has been linked to an asset.",
        ),
        chain_notify_recipe(
            "Audit Finding to Risk", "Risk Management",
            "When an audit finding is linked to risk, generate an AI treatment plan.",
            _PA("platform_action.create.risk_management.risk_register.link_audit_finding_to_risk", "Link Audit Finding To Risk"),
            [_PA("platform_action.trigger.risk_management.risk_register.generate_ai_treatment_plan", "AI: Generate Treatment Plan")],
            "[GRC] Audit finding tracked as risk",
            "An audit finding is now tracked in the risk register with an AI plan.",
        ),
        chain_notify_recipe(
            "Risk Register Bulk Upload", "Risk Management",
            "Acknowledge bulk upload of the risk register.",
            _PA("platform_action.upload.risk_management.risk_register.risk_register", "Upload Risk Register"),
            [],
            "[GRC] Risk register bulk upload received",
            "The risk register bulk upload has been received and processed.",
        ),
    ]

    # ── KRIs & incidents ─────────────────────────────────────────────
    catalog += [
        chain_severity_recipe(
            "KRI Threshold Breach Routing", "Risk Management",
            "Route KRI updates based on whether the threshold is breached.",
            _PA("platform_action.update.risk_management.kris.kri", "KRI Updated"),
            [],
            "KRI threshold BREACHED",
            "KRI updated within tolerance",
        ),
        chain_severity_recipe(
            "Incident Severity Routing", "Risk Management",
            "Route new incidents based on severity.",
            _PA("platform_action.create.risk_management.incidents.incident", "Incident Created"),
            [],
            "CRITICAL/HIGH incident — page on-call",
            "Lower-severity incident — standard triage",
        ),
        chain_approval_recipe(
            "Incident Closure Approval", "Risk Management",
            "Require manager approval before closing an incident.",
            _PA("platform_action.delete.risk_management.incidents.incident", "Incident Closed"),
            [],
            "Approval required to close this incident.",
            "Incident closure approved", "Incident closure rejected",
        ),
    ]

    # ── Risk assessments ─────────────────────────────────────────────
    catalog += [
        chain_notify_recipe(
            "Risk Assessment Bulk-Add", "Risk Management",
            "After adding a risk to an assessment, run bulk-add to fill from the register.",
            _PA("platform_action.create.risk_management.risk_assessments.add_risk_to_assessment", "Add Risk To Assessment"),
            [_PA("platform_action.trigger.risk_management.risk_assessments.bulk_add_risks", "Bulk Add Risks")],
            "[GRC] Bulk-add complete",
            "Bulk-add of risks to the assessment has finished.",
        ),
        chain_notify_recipe(
            "AI-Suggested Assessment Risk", "Risk Management",
            "When an assessment is updated, ask AI to suggest additional risks.",
            _PA("platform_action.update.risk_management.risk_assessments.risk_assessment", "Update Risk Assessment"),
            [_PA("platform_action.trigger.risk_management.risk_assessments.ai_suggest_assessment_risk", "AI: Suggest Assessment Risk")],
            "[GRC] AI suggested assessment risks",
            "AI has suggested additional risks for this assessment.",
        ),
        chain_notify_recipe(
            "Excel Risk Assessment Upload", "Risk Management",
            "Acknowledge an Excel-based risk assessment upload.",
            _PA("platform_action.upload.risk_management.risk_assessments.excel_risk_assessment", "Upload Excel Risk Assessment"),
            [],
            "[GRC] Risk assessment uploaded",
            "An Excel risk assessment has been uploaded.",
        ),
    ]

    # ── Risk framework ───────────────────────────────────────────────
    catalog += [
        chain_notify_recipe(
            "Framework Question Generation", "Risk Management",
            "After creating a framework risk assessment, AI-generate questions.",
            _PA("platform_action.create.risk_management.risk_framework.framework_risk_assessment", "Create Framework Risk Assessment"),
            [_PA("platform_action.trigger.risk_management.risk_framework.generate_framework_questions", "AI: Generate Framework Questions")],
            "[GRC] Framework questions generated",
            "AI-generated framework questions are ready.",
        ),
        chain_notify_recipe(
            "Risk Framework Report", "Risk Management",
            "Regenerate the framework report after an update.",
            _PA("platform_action.update.risk_management.risk_framework.framework_risk_assessment", "Update Framework Risk Assessment"),
            [_PA("platform_action.trigger.risk_management.risk_framework.generate_report", "Generate Report")],
            "[GRC] Risk framework report ready",
            "An updated risk framework report is available.",
        ),
        chain_notify_recipe(
            "Risk Scale Setup", "Risk Management",
            "When a new scale is created, seed the default scale set if missing.",
            _PA("platform_action.create.risk_management.risk_framework.scale", "Create Scale"),
            [_PA("platform_action.trigger.risk_management.risk_framework.seed_default_scales", "Seed Default Scales")],
            "[GRC] Risk scales configured",
            "Risk scales have been configured.",
        ),
    ]

    # ── Vendor risk ──────────────────────────────────────────────────
    catalog += [
        chain_notify_recipe(
            "Vendor Onboarding", "Risk Management",
            "After a vendor is created, automatically send the assessment questionnaire.",
            _PA("platform_action.create.risk_management.vendor_risk.vendor", "Create Vendor"),
            [_PA("platform_action.create.risk_management.vendor_risk.send_questionnaire", "Send Questionnaire")],
            "[GRC] Vendor onboarded — questionnaire sent",
            "New vendor created and the assessment questionnaire has been sent.",
        ),
        chain_notify_recipe(
            "Vendor Assessment Auto-Scoring", "Risk Management",
            "After a vendor assessment is updated, run AI scoring then numeric scoring.",
            _PA("platform_action.update.risk_management.vendor_risk.assessment", "Update Vendor Risk Assessment"),
            [
                _PA("platform_action.trigger.risk_management.vendor_risk.ai_score_assessment", "AI: Score Assessment"),
                _PA("platform_action.trigger.risk_management.vendor_risk.score_assessment", "Score Assessment"),
            ],
            "[GRC] Vendor assessment scored",
            "Vendor assessment has been AI-scored and numerically scored.",
        ),
        chain_approval_recipe(
            "Vendor Assessment Approval", "Risk Management",
            "Route vendor assessments through procurement approval.",
            _PA("platform_action.approve.risk_management.vendor_risk.assessment", "Approve Vendor Assessment"),
            [],
            "Vendor assessment is ready — approve or reject.",
            "Vendor assessment approved", "Vendor assessment rejected",
        ),
        chain_notify_recipe(
            "External Questionnaire Submission", "Risk Management",
            "When a vendor submits via the external portal, AI-score it.",
            _PA("platform_action.create.risk_management.vendor_risk.external_submit_questionnaire", "External Submit Questionnaire"),
            [_PA("platform_action.trigger.risk_management.vendor_risk.ai_score_assessment", "AI: Score Assessment")],
            "[GRC] External questionnaire scored",
            "Vendor's external questionnaire submission has been AI-scored.",
        ),
        chain_notify_recipe(
            "Vendor Risk AI Summary", "Risk Management",
            "Generate a vendor risk summary on demand.",
            _PA("platform_action.create.risk_management.vendor_risk.ai_vendor_risk_summary", "AI: Vendor Risk Summary"),
            [],
            "[GRC] Vendor risk summary ready",
            "A new AI-generated vendor risk summary is available.",
        ),
        chain_notify_recipe(
            "Vendor SLA Tracking", "Risk Management",
            "Notify the vendor manager when an SLA record is logged.",
            _PA("platform_action.create.risk_management.vendor_risk.sla_record", "Create SLA Record"),
            [],
            "[GRC] Vendor SLA recorded",
            "A new vendor SLA record has been logged.",
        ),
        chain_notify_recipe(
            "Vendor Incident Logged", "Risk Management",
            "Notify when a vendor incident is created.",
            _PA("platform_action.create.risk_management.vendor_risk.incident", "Create Vendor Incident"),
            [],
            "[GRC] Vendor incident logged",
            "A vendor incident has been logged.",
        ),
        chain_notify_recipe(
            "External Vendor Evidence Upload", "Risk Management",
            "Acknowledge external vendor evidence uploads.",
            _PA("platform_action.create.risk_management.vendor_risk.external_upload_evidence", "External Upload Evidence"),
            [],
            "[GRC] External vendor evidence received",
            "External vendor evidence has been uploaded.",
        ),
    ]

    # ── RCSA ─────────────────────────────────────────────────────────
    catalog += [
        chain_notify_recipe(
            "RCSA Campaign Activation", "Risk Management",
            "Activate the RCSA campaign once the approval workflow is configured.",
            _PA("platform_action.update.risk_management.rcsa.approval_workflow", "Update Approval Workflow"),
            [_PA("platform_action.trigger.risk_management.rcsa.activate_campaign", "Activate RCSA Campaign")],
            "[GRC] RCSA campaign live",
            "RCSA campaign is now active.",
        ),
        chain_approval_recipe(
            "RCSA Assessment Approval", "Risk Management",
            "Approve or reject submitted RCSA assessments.",
            _PA("platform_action.approve.risk_management.rcsa.assessment", "Approve RCSA Assessment"),
            [],
            "RCSA assessment submitted — approve or reject.",
            "RCSA assessment approved", "RCSA assessment rejected",
        ),
        chain_notify_recipe(
            "RCSA Rejection → Return", "Risk Management",
            "When an RCSA assessment is rejected, automatically create a return-to-owner record.",
            _PA("platform_action.reject.risk_management.rcsa.assessment", "Reject Assessment"),
            [_PA("platform_action.create.risk_management.rcsa.return_assessment", "Create Return Assessment")],
            "[GRC] RCSA returned to owner",
            "Rejected RCSA assessment has been returned to the owner.",
        ),
        chain_notify_recipe(
            "RCSA Finding → Risk + Mitigation", "Risk Management",
            "Convert an RCSA finding into a risk-register entry plus a mitigation action.",
            _PA("platform_action.create.risk_management.rcsa.finding", "Create RCSA Finding"),
            [
                _PA("platform_action.create.risk_management.rcsa.link_finding_to_risk", "Link Finding To Risk"),
                _PA("platform_action.create.risk_management.rcsa.mitigation_action_from_finding", "Create Mitigation Action From Finding"),
            ],
            "[GRC] RCSA finding tracked",
            "RCSA finding has been linked to a risk with a mitigation action.",
        ),
        chain_notify_recipe(
            "RCSA Submit & Close", "Risk Management",
            "Submit a completed RCSA and close the campaign once all are in.",
            _PA("platform_action.update.risk_management.rcsa.approval_workflow", "Update Approval Workflow"),
            [
                _PA("platform_action.trigger.risk_management.rcsa.submit_assessment", "Submit Assessment"),
                _PA("platform_action.trigger.risk_management.rcsa.close_campaign", "Close Campaign"),
            ],
            "[GRC] RCSA campaign closed",
            "RCSA assessments submitted and the campaign is closed.",
        ),
    ]

    # ── Mitigation actions, reviews ──────────────────────────────────
    catalog += [
        chain_wait_recipe(
            "Mitigation Action Due Reminder (24h)", "Risk Management",
            "Remind the owner 24h after a mitigation action is created.",
            _PA("platform_action.create.risk_management.mitigation_actions.mitigation_action", "Mitigation Action Created"),
            [], 24, [],
            "[GRC] Mitigation action approaching due date",
            "Your assigned mitigation action is due soon. Please update status.",
        ),
        chain_notify_recipe(
            "Bulk Risk Review Scheduling", "Risk Management",
            "After scheduling one review, fan out to bulk-schedule the rest.",
            _PA("platform_action.create.risk_management.reviews.schedule_review", "Schedule Review"),
            [_PA("platform_action.trigger.risk_management.reviews.bulk_schedule_reviews", "Bulk Schedule Reviews")],
            "[GRC] Risk reviews scheduled",
            "All risk reviews have been bulk-scheduled.",
        ),
    ]

    # ╔══════════════════════════════════════════════════════════════════╗
    # ║  VULNERABILITY MANAGEMENT                                         ║
    # ╚══════════════════════════════════════════════════════════════════╝

    catalog += [
        chain_severity_recipe(
            "Vulnerability: Critical/High Escalation", "Vulnerability Management",
            "Auto-escalate critical or high vulnerabilities to the security on-call.",
            _PA("platform_action.create.vulnerability_management.vulnerabilities.exception", "Vulnerability Exception Created"),
            [],
            "CRITICAL/HIGH vulnerability — page on-call",
            "Lower-severity vulnerability — standard queue",
        ),
        chain_wait_recipe(
            "Vulnerability SLA Warning (24h before breach)", "Vulnerability Management",
            "Remind the assigned engineer 24h before the SLA expires.",
            _PA("platform_action.update.vulnerability_management.vulnerabilities.mitigation", "Vulnerability Mitigation Updated"),
            [], 24,
            [_PA("platform_action.trigger.vulnerability_management.sla_config.sla_check", "SLA Check")],
            "[GRC] Vulnerability SLA warning",
            "Vulnerability remediation SLA expires within 24 hours. Update or escalate.",
        ),
        chain_notify_recipe(
            "Vulnerability Report → AI Analysis & Fix", "Vulnerability Management",
            "On report upload, run AI analysis and AI-suggest fixes.",
            _PA("platform_action.create.vulnerability_management.reports.upload_report", "Upload Vulnerability Report"),
            [
                _PA("platform_action.trigger.vulnerability_management.vulnerabilities.analyze_report", "AI: Analyze Report"),
                _PA("platform_action.trigger.vulnerability_management.vulnerabilities.suggest_fix", "AI: Suggest Fix"),
            ],
            "[GRC] Vulnerability report analyzed",
            "AI analysis and fix suggestions are ready for the report.",
        ),
        chain_notify_recipe(
            "Bulk Vulnerability Upload", "Vulnerability Management",
            "After uploading a report, run bulk import into the vulnerabilities table.",
            _PA("platform_action.create.vulnerability_management.reports.upload_report", "Upload Report"),
            [
                _PA("platform_action.trigger.vulnerability_management.vulnerabilities.bulk_upload_vulnerabilities", "Bulk Upload Vulnerabilities"),
                _PA("platform_action.trigger.vulnerability_management.vulnerabilities.analyze_report", "AI: Analyze Report"),
            ],
            "[GRC] Vulnerabilities ingested in bulk",
            "Vulnerabilities have been ingested in bulk and analyzed.",
        ),
        chain_approval_recipe(
            "Vulnerability Exception Approval", "Vulnerability Management",
            "Route vulnerability exception requests through security approval.",
            _PA("platform_action.create.vulnerability_management.vulnerabilities.exception", "Create Vulnerability Exception"),
            [],
            "A vulnerability exception is requested — approve or reject.",
            "Exception approved", "Exception rejected",
        ),
        chain_notify_recipe(
            "Vulnerability Mitigation Created", "Vulnerability Management",
            "Notify when a mitigation is added to a vulnerability.",
            _PA("platform_action.create.vulnerability_management.vulnerabilities.mitigation", "Create Mitigation"),
            [],
            "[GRC] Mitigation logged",
            "A mitigation has been logged against a vulnerability.",
        ),
        chain_notify_recipe(
            "Vulnerability Retest Requested", "Vulnerability Management",
            "Notify when a retest is requested.",
            _PA("platform_action.create.vulnerability_management.vulnerabilities.retest", "Create Retest"),
            [],
            "[GRC] Retest requested",
            "A retest has been requested for a vulnerability.",
        ),
        chain_notify_recipe(
            "Vulnerability-Asset Linking", "Vulnerability Management",
            "Notify when a vulnerability is linked to an asset.",
            _PA("platform_action.create.vulnerability_management.vulnerabilities.asset_link", "Create Asset Link"),
            [],
            "[GRC] Vulnerability-asset link added",
            "A vulnerability has been linked to an asset.",
        ),
        chain_notify_recipe(
            "Vulnerability-Control Linking", "Vulnerability Management",
            "Notify when a vulnerability is linked to a control.",
            _PA("platform_action.create.vulnerability_management.vulnerabilities.control_link", "Create Control Link"),
            [],
            "[GRC] Vulnerability-control link added",
            "A vulnerability has been linked to a control.",
        ),
        chain_notify_recipe(
            "Workflow Template Setup", "Vulnerability Management",
            "Build a complete vulnerability workflow template (states + transitions).",
            _PA("platform_action.create.vulnerability_management.vulnerabilities.workflow_template", "Create Workflow Template"),
            [
                _PA("platform_action.create.vulnerability_management.vulnerabilities.add_workflow_state", "Add Workflow State"),
                _PA("platform_action.create.vulnerability_management.vulnerabilities.add_workflow_transition", "Add Workflow Transition"),
            ],
            "[GRC] Vulnerability workflow template ready",
            "Vulnerability workflow template is configured with states and transitions.",
        ),
    ]

    # ── Departments / SLA config ─────────────────────────────────────
    catalog += [
        chain_notify_recipe(
            "Department Onboarding", "Vulnerability Management",
            "Create a department and add an initial member.",
            _PA("platform_action.create.vulnerability_management.departments.department", "Create Department"),
            [_PA("platform_action.create.vulnerability_management.departments.add_department_member", "Add Department Member")],
            "[GRC] Department onboarded",
            "A new department has been onboarded with an initial member.",
        ),
        chain_notify_recipe(
            "Bulk Vulnerability Assignment", "Vulnerability Management",
            "Assign a vulnerability then run bulk-assignment to clear the backlog.",
            _PA("platform_action.create.vulnerability_management.departments.assign_vulnerability_to_department", "Assign Vulnerability To Department"),
            [_PA("platform_action.trigger.vulnerability_management.departments.bulk_assign_vulnerabilities", "Bulk Assign Vulnerabilities")],
            "[GRC] Vulnerabilities bulk-assigned",
            "Vulnerabilities have been bulk-assigned to departments.",
        ),
        chain_notify_recipe(
            "SLA Configuration Update", "Vulnerability Management",
            "Update SLA per severity then run an SLA check pass.",
            _PA("platform_action.update.vulnerability_management.sla_config.sla_for_severity", "Update SLA For Severity"),
            [_PA("platform_action.trigger.vulnerability_management.sla_config.sla_check", "SLA Check")],
            "[GRC] SLA configuration updated",
            "Vulnerability SLA configuration has been updated and re-evaluated.",
        ),
        chain_notify_recipe(
            "SLA Initial Setup", "Vulnerability Management",
            "Notify when the SLA configuration is first set.",
            _PA("platform_action.create.vulnerability_management.sla_config.set_sla_config", "Set SLA Config"),
            [],
            "[GRC] SLA configured",
            "The vulnerability SLA configuration has been set.",
        ),
    ]

    # ╔══════════════════════════════════════════════════════════════════╗
    # ║  GOVERNANCE                                                       ║
    # ╚══════════════════════════════════════════════════════════════════╝

    # ── Documents / policies ─────────────────────────────────────────
    catalog += [
        chain_approval_recipe(
            "Policy Document Approval Workflow", "Governance",
            "Route new policy documents through approval before publishing.",
            _PA("platform_action.trigger.governance.documents.start_workflow", "Start Document Workflow"),
            [_PA("platform_action.trigger.governance.documents.advance_workflow", "Advance Document Workflow")],
            "A new policy document is awaiting approval.",
            "Policy approved — please publish",
            "Policy approval rejected",
        ),
        chain_wait_recipe(
            "Annual Policy Review Reminder", "Governance",
            "After a policy workflow advances to published, schedule an annual review reminder.",
            _PA("platform_action.trigger.governance.documents.advance_workflow", "Policy Document Published"),
            [], 24 * 365, [],
            "[GRC] Annual policy review due",
            "It has been one year since this policy was published. Schedule a review.",
        ),
        chain_notify_recipe(
            "Document Workflow Rejected", "Governance",
            "Notify when a document workflow step is rejected.",
            _PA("platform_action.reject.governance.documents.workflow_step", "Reject Workflow Step"),
            [],
            "[GRC] Document workflow rejected",
            "A document workflow step has been rejected.",
        ),
        chain_notify_recipe(
            "Document-Control Linking", "Governance",
            "Notify when a document is linked to a control.",
            _PA("platform_action.create.governance.documents.link_document_to_control", "Link Document To Control"),
            [],
            "[GRC] Document linked to control",
            "A governance document has been linked to a control.",
        ),
    ]

    # ── Committees ───────────────────────────────────────────────────
    catalog += [
        chain_notify_recipe(
            "Committee Onboarding", "Governance",
            "Create a committee with charter and seed members.",
            _PA("platform_action.create.governance.committees.committee", "Create Committee"),
            [
                _PA("platform_action.create.governance.committees.committee_charter", "Create Committee Charter"),
                _PA("platform_action.create.governance.committees.add_committee_member", "Add Committee Member"),
            ],
            "[GRC] Committee onboarded",
            "A new committee has been created with charter and members.",
        ),
        chain_notify_recipe(
            "Committee Meeting Setup", "Governance",
            "Set up the meeting agenda from pending approvals.",
            _PA("platform_action.update.governance.committees.meeting", "Update Meeting"),
            [_PA("platform_action.trigger.governance.committees.auto_populate_agenda_from_pending_approvals", "Auto Populate Agenda From Pending Approvals")],
            "[GRC] Meeting agenda ready",
            "Committee meeting agenda has been auto-populated.",
        ),
        chain_notify_recipe(
            "Meeting Minutes & Action Summary", "Governance",
            "When minutes are recorded, generate an AI action summary.",
            _PA("platform_action.create.governance.committees.minutes", "Create Minutes"),
            [_PA("platform_action.trigger.governance.committees.ai_generate_action_summary", "AI: Generate Action Summary")],
            "[GRC] Meeting minutes ready",
            "Meeting minutes have been recorded with an AI action summary.",
        ),
        chain_notify_recipe(
            "Oversight Action with AI Rewording", "Governance",
            "Create an oversight action and AI-improve its wording.",
            _PA("platform_action.create.governance.committees.oversight_action", "Create Oversight Action"),
            [_PA("platform_action.trigger.governance.committees.ai_reword_action_text", "AI: Reword Action Text")],
            "[GRC] Oversight action logged",
            "Oversight action has been logged and AI-reworded for clarity.",
        ),
        chain_notify_recipe(
            "Manual Action Logged", "Governance",
            "Notify when a manual oversight action is added.",
            _PA("platform_action.create.governance.committees.manual_action", "Create Manual Action"),
            [],
            "[GRC] Manual oversight action logged",
            "A manual oversight action has been logged.",
        ),
    ]

    # ── Attestations ─────────────────────────────────────────────────
    catalog += [
        chain_notify_recipe(
            "Attestation Campaign Launch", "Governance",
            "Activate a campaign and notify participants.",
            _PA("platform_action.create.governance.attestations.campaign", "Create Campaign"),
            [_PA("platform_action.trigger.governance.attestations.activate_campaign", "Activate Campaign")],
            "[GRC] Attestation campaign launched",
            "A new attestation campaign is live.",
        ),
        chain_wait_recipe(
            "Attestation Reminder & Escalation", "Governance",
            "After 7d, send a reminder; if still pending, escalate.",
            _PA("platform_action.create.governance.attestations.request_attestations", "Request Attestations"),
            [], 24 * 7,
            [
                _PA("platform_action.trigger.governance.attestations.send_reminder", "Send Reminder"),
                _PA("platform_action.trigger.governance.attestations.escalate_request", "Escalate Request"),
            ],
            "[GRC] Attestation escalated",
            "Outstanding attestations have been reminded and escalated.",
        ),
        chain_notify_recipe(
            "Bulk Attestation-Evidence Linking", "Governance",
            "After linking one attestation to evidence, run bulk-link.",
            _PA("platform_action.create.governance.attestations.link_attestation_to_evidence", "Link Attestation To Evidence"),
            [_PA("platform_action.trigger.governance.attestations.bulk_link_attestations_to_evidence", "Bulk Link Attestations To Evidence")],
            "[GRC] Attestations linked to evidence in bulk",
            "Attestations have been bulk-linked to evidence.",
        ),
        chain_notify_recipe(
            "Attestation Completed", "Governance",
            "Notify when an attestation is completed.",
            _PA("platform_action.trigger.governance.attestations.complete_attestation", "Complete Attestation"),
            [],
            "[GRC] Attestation complete",
            "An attestation has been completed.",
        ),
    ]

    # ── Patch proposals, regulatory, critical rules, clause coverage ─
    catalog += [
        chain_approval_recipe(
            "Patch Proposal Review Gate", "Governance",
            "Route patch proposals through the governance committee.",
            _PA("platform_action.create.governance.patch_proposals.patch_proposal", "Patch Proposal Created"),
            [],
            "A new regulatory patch proposal needs review.",
            "Patch approved", "Patch rejected",
        ),
        chain_notify_recipe(
            "Critical Rule Update", "Governance",
            "Notify when a critical governance rule is changed.",
            _PA("platform_action.update.governance.critical_rules.rule", "Update Rule"),
            [],
            "[GRC] Critical rule updated",
            "A critical governance rule has been updated.",
        ),
        chain_notify_recipe(
            "Clause Coverage Document Scan", "Governance",
            "Scan a document for clause coverage and notify.",
            _PA("platform_action.create.governance.clause_coverage.scan_document", "Create Scan Document"),
            [],
            "[GRC] Clause coverage scan complete",
            "Clause coverage scan has finished.",
        ),
        chain_notify_recipe(
            "Coverage Decision Recorded", "Governance",
            "Notify when a coverage decision is recorded.",
            _PA("platform_action.create.governance.clause_coverage.record_decision", "Record Decision"),
            [],
            "[GRC] Coverage decision recorded",
            "A clause coverage decision has been recorded.",
        ),
    ]

    # ── Dedupe by name and return ────────────────────────────────────
    deduped: list[dict] = []
    for w in catalog:
        if w["name"] in seen_names:
            continue
        seen_names.add(w["name"])
        deduped.append(w)
    return deduped



# ───────────────────────── Pre-flight + post-flight ───────────────────────
def preflight(catalog: list[dict]) -> tuple[list[dict], list[tuple[str, str]]]:
    valid: list[dict] = []
    invalid: list[tuple[str, str]] = []
    for r in catalog:
        ok, err, _ = validate_graph(r["nodes_json"], r["edges_json"])
        if ok:
            valid.append(r)
        else:
            invalid.append((r["name"], err))
    return valid, invalid


def postflight(created_ids: list[int]) -> tuple[int, list[tuple[str, str]]]:
    pass_ct = 0
    failures: list[tuple[str, str]] = []
    for did in created_ids:
        d = fetch_definition(did)
        if not d:
            failures.append((f"id={did}", "could not refetch"))
            continue
        nodes = []
        for n in d.get("nodes", []) or []:
            nodes.append({
                "node_key": n.get("node_key"),
                "node_type": n.get("node_type"),
                "config": n.get("config") or {},
                "is_start": n.get("is_start"),
                "is_terminal": n.get("is_terminal"),
            })
        edges = []
        for e in d.get("edges", []) or []:
            edges.append({
                "source_node_key": e.get("source_node_key"),
                "target_node_key": e.get("target_node_key"),
            })
        ok, err, computed = validate_graph(nodes, edges)
        if not ok:
            failures.append((d.get("name") or f"id={did}", err))
            continue
        # Strict check: backend's persisted trigger_event must match the
        # canvas-derived value. Catches backend regressions where
        # _derive_trigger_event silently fails or stores a stale value.
        persisted = (d.get("trigger_event") or "").strip()
        if persisted != computed:
            failures.append((
                d.get("name") or f"id={did}",
                f"trigger_event drift: persisted={persisted!r} canvas-derived={computed!r}",
            ))
            continue
        pass_ct += 1
    return pass_ct, failures


# ───────────────────────── Per-workflow create + verify loop ──────────────
def _verify_one(did: int, recipe: dict) -> tuple[bool, str]:
    """Re-fetch a freshly-created definition and run the strict validator
    plus connectivity & first-after-Start ⚡ Platform Function checks.
    Returns (ok, error_message)."""
    d = fetch_definition(did)
    if not d:
        return False, "could not refetch"

    nodes_raw = d.get("nodes") or []
    edges_raw = d.get("edges") or []
    nodes = [{"node_key": n.get("node_key"), "node_type": n.get("node_type"),
              "config": n.get("config") or {}, "is_start": n.get("is_start"),
              "is_terminal": n.get("is_terminal")} for n in nodes_raw]
    edges = [{"source_node_key": e.get("source_node_key"),
              "target_node_key": e.get("target_node_key")} for e in edges_raw]

    ok, err, computed = validate_graph(nodes, edges)
    if not ok:
        return False, f"graph invalid: {err}"

    persisted = (d.get("trigger_event") or "").strip()
    if persisted != computed:
        return False, f"trigger_event drift: persisted={persisted!r} canvas={computed!r}"

    # Connectivity: every non-start, non-terminal node must have ≥1 incoming AND ≥1 outgoing edge.
    in_keys = {e["target_node_key"] for e in edges}
    out_keys = {e["source_node_key"] for e in edges}
    for n in nodes:
        k = n["node_key"]
        if not n.get("is_start") and k not in in_keys:
            return False, f"node {k!r} has no incoming edge (disconnected)"
        if not n.get("is_terminal") and k not in out_keys:
            return False, f"node {k!r} has no outgoing edge (disconnected)"

    # First-after-Start MUST be a ⚡ Platform Function (action_name starts with platform_action.).
    start_keys = {n["node_key"] for n in nodes if n.get("is_start")}
    first_keys = [e["target_node_key"] for e in edges if e["source_node_key"] in start_keys]
    if not first_keys:
        return False, "Start has no outgoing edge"
    cfg_by_key = {n["node_key"]: n["config"] for n in nodes}
    for fk in first_keys:
        an = (cfg_by_key.get(fk) or {}).get("action_name") or ""
        if not an.startswith("platform_action."):
            return False, f"first-after-Start {fk!r} action_name={an!r} is NOT a ⚡ Platform Function"

    # Palette-fidelity: every node_type must match a real palette group, and the
    # corresponding key (action_name / condition_kind / approval_type / timer_kind)
    # must exist in the live backend catalog. This rejects any fabricated/invented
    # node_type or kind that the canvas palette doesn't expose.
    allowed_types = {"start", "end", "action", "condition", "approval", "timer", "subworkflow"}
    for n in nodes:
        nt = (n.get("node_type") or "action").strip()
        if n.get("is_start"): nt = "start"
        if n.get("is_terminal"): nt = "end"
        if nt not in allowed_types:
            return False, f"node {n['node_key']!r} has invalid node_type {nt!r} (palette only allows {sorted(allowed_types)})"
        cfg = n.get("config") or {}
        if nt == "action":
            an = cfg.get("action_name") or ""
            if an.startswith("platform_action."):
                continue  # platform_functions are namespace-validated by frontend validator
            if CATALOG_KEYS["actions"] and an not in CATALOG_KEYS["actions"]:
                return False, f"node {n['node_key']!r} action_name={an!r} not in palette actions catalog"
        elif nt == "condition":
            ck = cfg.get("condition_kind") or ""
            if CATALOG_KEYS["conditions"] and ck not in CATALOG_KEYS["conditions"]:
                return False, f"node {n['node_key']!r} condition_kind={ck!r} not in palette conditions catalog"
        elif nt == "approval":
            at = cfg.get("approval_type") or ""
            if CATALOG_KEYS["approvals"] and at not in CATALOG_KEYS["approvals"]:
                return False, f"node {n['node_key']!r} approval_type={at!r} not in palette approvals catalog"
        elif nt == "timer":
            tk = cfg.get("timer_kind") or ""
            if CATALOG_KEYS["timers"] and tk not in CATALOG_KEYS["timers"]:
                return False, f"node {n['node_key']!r} timer_kind={tk!r} not in palette timers catalog"

    return True, ""


def create_and_verify(catalog: list[dict], existing: set[str]) -> tuple[int, int, list[tuple[str, str]]]:
    """One-by-one: print description, POST, immediately re-fetch and validate.
    Aborts on first failure (returns counts so far)."""
    created = 0
    skipped = 0
    failures: list[tuple[str, str]] = []
    total = len(catalog)
    width = len(str(total))

    for idx, r in enumerate(catalog, 1):
        name = r["name"]
        desc = (r["description"] or "").strip().replace("\n", " ")
        if len(desc) > 160:
            desc = desc[:157] + "..."
        print(f"\n[{idx:>{width}}/{total}] {name}")
        print(f"     business reason: {desc}")

        if name in existing:
            print(f"     [skip] already exists in tenant")
            skipped += 1
            continue

        payload = {
            "name": name, "description": r["description"],
            "category": r["category"], "trigger_event": r["trigger_event"],
            "trigger_conditions": r["trigger_conditions"],
            "nodes": r["nodes_json"], "edges": r["edges_json"],
            "definition_json": r["definition_json"], "tags": r["tags"],
            "is_active": True,
        }
        resp = session.post(f"{BASE}/workflow-engine/definitions", json=payload, timeout=30)
        if not resp.ok:
            err = f"HTTP {resp.status_code}: {resp.text[:200]}"
            print(f"     [FAIL POST] {err}")
            failures.append((name, err))
            print(f"\n[seed] ABORT after {idx} workflows ({created} created, last failed)")
            return created, skipped, failures

        try:
            did = int(resp.json().get("id"))
        except Exception:
            err = f"could not parse id from response: {resp.text[:200]}"
            print(f"     [FAIL PARSE] {err}")
            failures.append((name, err))
            return created, skipped, failures

        ok, verr = _verify_one(did, r)
        if not ok:
            print(f"     [FAIL VERIFY id={did}] {verr}")
            failures.append((name, verr))
            print(f"\n[seed] ABORT after {idx} workflows ({created} created, last verify failed)")
            return created, skipped, failures

        created += 1
        print(f"     [OK id={did}] graph valid · first-after-Start is ⚡ · all nodes connected")

    return created, skipped, failures


# ───────────────────────── Main ───────────────────────────────────────────
def main() -> int:
    print("[seed] building catalog...")
    catalog = build_catalog()
    print(f"[seed] {len(catalog)} recipes generated")

    print("[seed] pre-flight validating ALL recipes (no HTTP yet)...")
    valid, invalid = preflight(catalog)
    if invalid:
        print(f"[seed] ABORT — {len(invalid)} pre-flight failures:")
        for name, err in invalid:
            print(f"   - {name!r}: {err}")
        return 2
    print(f"[seed] pre-flight OK: {len(valid)}/{len(catalog)} recipes valid")

    print("[seed] logging in...")
    login()

    print("[seed] fetching live palette catalog for fidelity validation...")
    keys = fetch_catalog_keys()
    for grp, ks in keys.items():
        CATALOG_KEYS[grp] = ks
    print(f"[seed] catalog keys: actions={len(keys['actions'])} "
          f"conditions={len(keys['conditions'])} approvals={len(keys['approvals'])} "
          f"timers={len(keys['timers'])} platform_functions={len(keys['platform_functions'])}")

    existing = existing_definition_names()
    print(f"[seed] {len(existing)} existing definitions — duplicates will be skipped")

    print(f"\n[seed] creating + verifying {len(valid)} workflows ONE BY ONE")
    print(f"[seed] (each: print description → POST → re-fetch → strict validate → next)\n")
    created, skipped, failures = create_and_verify(valid, existing)

    print("\n=== summary ===")
    print(f"  recipes:                {len(catalog)}")
    print(f"  pre-flight valid:       {len(valid)}")
    print(f"  created+verified:       {created}")
    print(f"  skipped (existing):     {skipped}")
    print(f"  failures:               {len(failures)}")
    if failures:
        print("\n  first failure:")
        n, e = failures[0]
        print(f"    {n!r}: {e}")
    return 3 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
