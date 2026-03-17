import json
from pathlib import Path
import re


TRIGGER_NODE_TYPES = [
    {"key": "framework_deadline_approaching", "label": "Framework deadline approaching"},
    {"key": "risk_score_exceeds_threshold", "label": "Risk score exceeds threshold"},
    {"key": "evidence_expires", "label": "Evidence expires"},
    {"key": "new_vulnerability_detected", "label": "New vulnerability detected"},
    {"key": "policy_review_due", "label": "Policy review due"},
    {"key": "incident_reported", "label": "Incident reported"},
    {"key": "kri_breach", "label": "KRI breach"},
    {"key": "assessment_status_change", "label": "Assessment status change"},
    {"key": "manual_trigger", "label": "Manual trigger"},
    {"key": "schedule_recurring", "label": "Schedule / recurring"},
    {"key": "webhook", "label": "Webhook trigger"},
]

ACTION_NODE_TYPES = [
    {"key": "create_risk_entry", "label": "Create risk entry"},
    {"key": "request_evidence_upload", "label": "Request evidence upload"},
    {"key": "assign_control_owner", "label": "Assign control owner"},
    {"key": "send_notification_email", "label": "Send notification/email"},
    {"key": "generate_report", "label": "Generate report"},
    {"key": "update_compliance_status", "label": "Update compliance status"},
    {"key": "create_audit_finding", "label": "Create audit finding"},
    {"key": "escalate_to_management", "label": "Escalate to management"},
    {"key": "call_webhook_api", "label": "Call webhook/API"},
]

PLATFORM_FUNCTION_NODE_TYPES: list[dict] = []


def _slugify(value: str) -> str:
    return (
        (value or "")
        .strip()
        .lower()
        .replace(" & ", " and ")
        .replace("/", "_")
        .replace("-", "_")
        .replace(" ", "_")
        .replace(".", "_")
        .replace("{", "")
        .replace("}", "")
    )


def _platform_capabilities_path() -> Path:
    # backend/grc/modules/workflow_engine/services/catalog.py -> project root
    return Path(__file__).resolve().parents[5] / "platform-capabilities.json"


def _generate_functionality_action_nodes() -> list[dict]:
    path = _platform_capabilities_path()
    if not path.exists():
        return []

    try:
        with open(path, "r", encoding="utf-8") as f:
            capabilities = json.load(f)
    except Exception:
        return []

    items: list[dict] = []
    seen: set[str] = set()

    def add_functionality(module_name: str, submodule_name: str, functionality: dict) -> None:
        action = str(functionality.get("action") or "trigger")
        func_name = str(functionality.get("name") or "Unnamed functionality")
        endpoint = str(functionality.get("endpoint") or "")
        key = (
            f"platform_action.{_slugify(action)}."
            f"{_slugify(module_name)}.{_slugify(submodule_name)}.{_slugify(func_name)}"
        )
        if key in seen:
            return
        seen.add(key)
        label = func_name
        items.append(
            {
                "key": key,
                "label": label,
                "endpoint": endpoint,
                "action": action,
                "module": module_name,
                "submodule": submodule_name,
                "functionality_name": func_name,
                "source": "capabilities_json",
            }
        )

    for module_data in capabilities.get("modules", []):
        module_name = str(module_data.get("module") or "General")
        for submodule_data in module_data.get("submodules", []):
            submodule_name = str(submodule_data.get("name") or "General")
            for functionality in submodule_data.get("functionalities", []):
                add_functionality(module_name, submodule_name, functionality)

            for nested in submodule_data.get("nested", []):
                nested_name = str(nested.get("name") or "General")
                nested_submodule_name = f"{submodule_name} > {nested_name}"
                for functionality in nested.get("functionalities", []):
                    add_functionality(module_name, nested_submodule_name, functionality)

    return items


def _backend_modules_root() -> Path:
    # backend/grc/modules/workflow_engine/services/catalog.py -> backend/grc/modules
    return Path(__file__).resolve().parents[2]


def _humanize_slug(value: str) -> str:
    parts = [p for p in re.split(r"[_\-]+", (value or "").strip()) if p]
    return " ".join(p.capitalize() for p in parts) if parts else "General"


def _module_display_name_from_folder(folder_name: str) -> str:
    mapping = {
        "erm": "Risk Management",
        "governance": "Governance",
        "compliance": "Compliance",
        "evidence": "Evidence",
        "audit_management": "Audit Management",
        "vuln_management": "Vulnerability Management",
        "framework_upload": "Framework Upload",
        "control_library": "Control Library",
        "workflow_engine": "Workflow Engine",
        "chatbot": "Chatbot",
    }
    return mapping.get(folder_name, _humanize_slug(folder_name))


def _action_from_http_method_and_path(http_method: str, path: str) -> str:
    method = (http_method or "").lower()
    lower_path = (path or "").lower()

    if method == "post":
        trigger_hints = [
            "/approve", "/reject", "/submit", "/publish", "/parse", "/run", "/trigger",
            "/assess", "/review", "/close", "/reopen", "/test", "/analyze", "/optimize",
            "/upload", "/import", "/export", "/ai-", "/ai_",
        ]
        if any(h in lower_path for h in trigger_hints):
            if "/upload" in lower_path or "/import" in lower_path:
                return "upload"
            if "/export" in lower_path:
                return "export"
            if "/approve" in lower_path:
                return "approve"
            if "/reject" in lower_path:
                return "reject"
            return "trigger"
        return "create"

    if method in {"put", "patch"}:
        return "update"
    if method == "delete":
        return "delete"

    # GET
    trigger_like = ["/dashboard", "/analytics", "/heatmap", "/trends", "/summary", "/report", "/export"]
    if any(h in lower_path for h in trigger_like):
        return "read"
    return "read"


def _extract_router_prefix(py_text: str) -> str:
    m = re.search(r"APIRouter\([^\)]*prefix\s*=\s*['\"]([^'\"]+)['\"]", py_text, flags=re.DOTALL)
    return m.group(1) if m else ""


def _extract_route_entries(py_text: str) -> list[tuple[str, str, str]]:
    entries: list[tuple[str, str, str]] = []
    route_pattern = re.compile(r"@router\.(get|post|put|patch|delete)\(\s*['\"]([^'\"]*)['\"]", flags=re.IGNORECASE)
    def_pattern = re.compile(r"^\s*def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", flags=re.MULTILINE)

    for match in route_pattern.finditer(py_text):
        method = match.group(1).lower()
        path = match.group(2) or ""
        fn_name = "handler"
        def_match = def_pattern.search(py_text, pos=match.end())
        if def_match:
            fn_name = def_match.group(1)
        entries.append((method, path, fn_name))
    return entries


def _generate_functionality_nodes_from_router_code() -> list[dict]:
    modules_root = _backend_modules_root()
    if not modules_root.exists():
        return []

    items: list[dict] = []
    seen: set[str] = set()

    for module_dir in modules_root.iterdir():
        if not module_dir.is_dir() or module_dir.name.startswith("__"):
            continue

        module_name = _module_display_name_from_folder(module_dir.name)
        routers_dir = module_dir / "routers"
        if not routers_dir.exists() or not routers_dir.is_dir():
            continue

        for router_file in routers_dir.glob("*.py"):
            if router_file.name.startswith("__"):
                continue
            try:
                text = router_file.read_text(encoding="utf-8")
            except Exception:
                continue

            sub_prefix = _extract_router_prefix(text)
            submodule_name = _humanize_slug(router_file.stem)

            for method, route_path, fn_name in _extract_route_entries(text):
                action = _action_from_http_method_and_path(method, route_path)

                cleaned_fn = fn_name
                for p in ["list_", "get_", "create_", "update_", "delete_", "post_", "put_", "patch_"]:
                    if cleaned_fn.startswith(p):
                        cleaned_fn = cleaned_fn[len(p):]
                        break
                label = _humanize_slug(cleaned_fn)

                endpoint = f"{sub_prefix}{route_path}" if sub_prefix or route_path else ""
                key = (
                    f"platform_action.{_slugify(action)}."
                    f"{_slugify(module_name)}.{_slugify(submodule_name)}.{_slugify(label)}"
                )
                if key in seen:
                    continue
                seen.add(key)

                items.append(
                    {
                        "key": key,
                        "label": label,
                        "endpoint": endpoint,
                        "action": action,
                        "module": module_name,
                        "submodule": submodule_name,
                        "functionality_name": label,
                        "source": "router_code",
                    }
                )

    return items


def get_platform_functions_grouped_by_module() -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for item in PLATFORM_FUNCTION_NODE_TYPES:
        module_name = str(item.get("module") or "General")
        grouped.setdefault(module_name, []).append(item)
    for module_name in grouped:
        grouped[module_name] = sorted(
            grouped[module_name],
            key=lambda x: (str(x.get("submodule") or ""), str(x.get("label") or "")),
        )
    return grouped


_json_platform_nodes = _generate_functionality_action_nodes()
_code_platform_nodes = _generate_functionality_nodes_from_router_code()

_merged: list[dict] = []
_seen_keys: set[str] = set()
for n in [*_code_platform_nodes, *_json_platform_nodes]:
    k = str(n.get("key") or "")
    if not k or k in _seen_keys:
        continue
    _seen_keys.add(k)
    _merged.append(n)

PLATFORM_FUNCTION_NODE_TYPES = _merged
ACTION_NODE_TYPES.extend(PLATFORM_FUNCTION_NODE_TYPES)

CONDITION_NODE_TYPES = [
    {"key": "check_risk_level", "label": "Check risk level"},
    {"key": "check_user_role", "label": "Check user role"},
    {"key": "check_compliance_status", "label": "Check compliance status"},
    {"key": "check_evidence_age", "label": "Check evidence age"},
    {"key": "check_approval_status", "label": "Check approval status"},
    {"key": "evaluate_business_unit", "label": "Evaluate business unit"},
    {"key": "expression_builder", "label": "Expression builder"},
]

APPROVAL_NODE_TYPES = [
    {"key": "single", "label": "Single approver"},
    {"key": "multi_level", "label": "Multi-level approval chain"},
    {"key": "quorum", "label": "Quorum-based approval"},
]

TIMER_NODE_TYPES = [
    {"key": "wait_duration", "label": "Wait for duration"},
    {"key": "wait_until_date", "label": "Wait until date"},
    {"key": "sla_countdown", "label": "SLA countdown with escalation"},
]

PREBUILT_TEMPLATES = [
    {"name": "Incident Response Playbook", "category": "incident_management", "trigger_event": "risks.create"},
    {"name": "Vendor Onboarding Compliance", "category": "compliance", "trigger_event": "assets.create"},
    {"name": "Policy Approval Cycle", "category": "policy_management", "trigger_event": "governance.create"},
    {"name": "Quarterly Access Review", "category": "governance", "trigger_event": "scheduler.access_review"},
    {"name": "Risk Reassessment Cycle", "category": "risk_management", "trigger_event": "scheduler.risk_reassessment"},
]

INTEGRATION_POINTS = [
    "evidence_management",
    "risk_management",
    "policy_management",
    "compliance_assessments",
    "incident_management",
    "governance",
    "asset_management",
    "vulnerability_management",
]
