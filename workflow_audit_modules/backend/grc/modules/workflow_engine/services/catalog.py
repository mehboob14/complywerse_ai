import json
from pathlib import Path
import re


TRIGGER_NODE_TYPES = [
    # ── Core workflow triggers ────────────────────────────────────────────────
    {"key": "manual_trigger", "label": "Manual trigger"},
    {"key": "schedule_recurring", "label": "Schedule / recurring"},
    {"key": "webhook", "label": "Webhook trigger"},
    # ── Evidence & compliance triggers ───────────────────────────────────────
    {"key": "evidence_uploaded", "label": "Evidence uploaded"},
    {"key": "evidence_approved", "label": "Evidence reviewed / approved"},
    {"key": "evidence_expires", "label": "Evidence expires"},
    {"key": "framework_deadline_approaching", "label": "Framework deadline approaching"},
    {"key": "framework_evidence_complete", "label": "Framework evidence collection complete"},
    {"key": "assessment_status_change", "label": "Assessment status change"},
    {"key": "compliance_gap_detected", "label": "Compliance gap detected"},
    {"key": "certification_expiry_approaching", "label": "Certification expiry approaching"},
    # ── Risk triggers ─────────────────────────────────────────────────────────
    {"key": "risk_created", "label": "Risk entry created"},
    {"key": "risk_updated", "label": "Risk entry updated"},
    {"key": "risk_deleted", "label": "Risk entry deleted"},
    {"key": "risk_status_changed", "label": "Risk status changed"},
    {"key": "risk_score_exceeds_threshold", "label": "Risk score exceeds threshold"},
    {"key": "kri_breach", "label": "KRI breach"},
    {"key": "incident_reported", "label": "Incident reported"},
    # ── Vulnerability triggers ────────────────────────────────────────────────
    {"key": "vulnerability_created",       "label": "Vulnerability created (manual entry)"},
    {"key": "vulnerability_updated",       "label": "Vulnerability updated"},
    {"key": "vulnerability_deleted",       "label": "Vulnerability deleted"},
    {"key": "new_vulnerability_detected",  "label": "Vulnerability auto-detected (scanner)"},
    {"key": "vulnerability_sla_breach",    "label": "Vulnerability SLA breached"},
    {"key": "vulnerability_sla_warning",   "label": "Vulnerability SLA warning (approaching)"},
    # ── Governance & policy triggers ──────────────────────────────────────────
    {"key": "governance_document_created",   "label": "Governance document created"},
    {"key": "governance_document_expires",   "label": "Governance document expires / review due"},
    {"key": "governance_document_published", "label": "Governance document published"},
    {"key": "policy_submitted_for_review", "label": "Policy submitted for review"},
    {"key": "policy_review_due",           "label": "Policy review due"},
    {"key": "policy_approved",             "label": "Policy approved / published"},
    {"key": "control_review_due",          "label": "Control effectiveness review due"},
    {"key": "attestation_overdue",         "label": "Attestation campaign overdue"},
    # ── Audit triggers ────────────────────────────────────────────────────────
    {"key": "audit_finding_created",       "label": "Audit finding created"},
    {"key": "audit_finding_updated",       "label": "Audit finding updated"},
    {"key": "audit_finding_closed",        "label": "Audit finding closed / resolved"},
    # ── IT Asset triggers ─────────────────────────────────────────────────────
    {"key": "asset_created", "label": "IT asset created"},
    {"key": "asset_updated", "label": "IT asset updated"},
    {"key": "asset_deleted", "label": "IT asset deleted"},
]

# Actions = generic workflow-engine steps only.
# GRC domain operations (risk, compliance, governance, etc.) live exclusively
# in Platform Functions, which are auto-generated from backend API endpoints.
ACTION_NODE_TYPES = [
    {"key": "send_notification_email", "label": "Send notification / email"},
    {"key": "send_in_app_alert",       "label": "Send in-app alert / notification"},
    {"key": "escalate_to_management",  "label": "Escalate to management"},
    {"key": "call_webhook_api",        "label": "Call webhook / API"},
    {"key": "generate_report",         "label": "Generate report"},
]

PLATFORM_FUNCTION_NODE_TYPES: list[dict] = []

AUTOMATION_RELEVANT_PLATFORM_ACTIONS = {
    "approve",
    "assign",
    "create",
    "delete",
    "export",
    "publish",
    "reject",
    "submit",
    "trigger",
    "update",
    "upload",
}


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


_MANUAL_PLATFORM_ACTIONS: list[dict] = [
    # CIS Plugin Engine — surfaced as Platform Functions so workflow
    # definitions can subscribe to plugin-run events.
    {
        "key": "platform_action.create.compliance.plugin_runs.execute",
        "label": "CIS Plugin: execute check",
        "endpoint": "/grc/compliance-plugins/{plugin_id}/runs",
        "action": "create",
        "module": "Compliance",
        "submodule": "Plugin Engine",
        "functionality_name": "Execute plugin check",
        "source": "manual_wiring",
    },
    {
        "key": "platform_action.trigger.compliance.plugin_runs.failed",
        "label": "CIS Plugin: failed check",
        "endpoint": "/grc/compliance-plugins/{plugin_id}/runs",
        "action": "trigger",
        "module": "Compliance",
        "submodule": "Plugin Engine",
        "functionality_name": "Failed plugin check",
        "source": "manual_wiring",
    },
]


def _generate_functionality_action_nodes() -> list[dict]:
    path = _platform_capabilities_path()
    if not path.exists():
        return list(_MANUAL_PLATFORM_ACTIONS)

    try:
        with open(path, "r", encoding="utf-8") as f:
            capabilities = json.load(f)
    except Exception:
        return []

    items: list[dict] = []
    seen: set[str] = set()

    def add_functionality(module_name: str, submodule_name: str, functionality: dict) -> None:
        action = str(functionality.get("action") or "trigger")
        if action not in AUTOMATION_RELEVANT_PLATFORM_ACTIONS:
            return
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

    # Append manual platform-action entries for modules not yet present in
    # platform-capabilities.json (e.g. CIS Plugin Engine).
    for entry in _MANUAL_PLATFORM_ACTIONS:
        if entry["key"] not in seen:
            seen.add(entry["key"])
            items.append(entry)
    return items


def _backend_modules_root() -> Path:
    # backend/grc/modules/workflow_engine/services/catalog.py -> backend/grc/modules
    return Path(__file__).resolve().parents[2]


_ACRONYM_MAP = {
    "ai": "AI", "api": "API", "kri": "KRI", "kris": "KRIs",
    "rcsa": "RCSA", "sla": "SLA", "ui": "UI", "erm": "ERM",
    "cbsl": "CBSL", "id": "ID", "url": "URL",
    "ocr": "OCR", "pdf": "PDF", "csv": "CSV",
}


def _humanize_slug(value: str) -> str:
    parts = [p for p in re.split(r"[_\-]+", (value or "").strip()) if p]
    words = []
    for p in parts:
        lower = p.lower()
        words.append(_ACRONYM_MAP.get(lower, p.capitalize()))
    return " ".join(words) if words else "General"


def _module_display_name_from_folder(folder_name: str) -> str:
    mapping = {
        "erm": "Risk Management",
        "governance": "Governance",
        "compliance": "Compliance",
        "evidence": "Compliance",
        "audit_management": "Audit Management",
        "vuln_management": "Vulnerability Management",
        "framework_upload": "Compliance",
        "control_library": "Compliance",
        "workflow_engine": "Workflow Engine",
        "chatbot": "Chatbot",
        "vendor_risk": "Risk Management",
    }
    return mapping.get(folder_name, _humanize_slug(folder_name))


# (folder_name, router_stem) → (module_display_name, submodule_display_name)
ROUTER_MODULE_OVERRIDE: dict[tuple[str, str], tuple[str, str]] = {
    # ── Risk Management: ERM sub-module explicit names ────────────────────────
    ("erm", "risks"):                       ("Risk Management", "Risk Register"),
    ("erm", "risk_assessments"):            ("Risk Management", "Risk Assessments"),
    ("erm", "rcsa"):                        ("Risk Management", "RCSA"),
    ("erm", "incidents"):                   ("Risk Management", "Incidents"),
    ("erm", "internal_controls"):           ("Risk Management", "Internal Controls"),
    ("erm", "kris"):                        ("Risk Management", "KRIs"),
    ("erm", "advanced_analytics"):          ("Risk Management", "Advanced Analytics"),
    # ── Risk Management: ERM page-tab aligned submodules ─────────────────────
    ("erm", "appetite"):                    ("Risk Management", "Appetite"),
    ("erm", "dependencies"):                ("Risk Management", "Dependencies"),
    ("erm", "mitigation_actions"):          ("Risk Management", "Mitigation Actions"),
    ("erm", "reviews"):                     ("Risk Management", "Reviews"),
    # ── Risk Management: Risk Framework (framework-level routers) ───────────
    ("erm", "framework_risk_assessments"):  ("Risk Management", "Risk Framework"),
    ("erm", "reports"):                     ("Risk Management", "Risk Framework"),
    ("erm", "scales"):                      ("Risk Management", "Risk Framework"),
    # ── Risk Management: Vendor Risk (5 routers consolidated) ────────────────
    ("vendor_risk", "ai_analysis"):         ("Risk Management", "Vendor Risk"),
    ("vendor_risk", "assessments"):         ("Risk Management", "Vendor Risk"),
    ("vendor_risk", "monitoring"):          ("Risk Management", "Vendor Risk"),
    ("vendor_risk", "questionnaires"):      ("Risk Management", "Vendor Risk"),
    ("vendor_risk", "vendors"):             ("Risk Management", "Vendor Risk"),
    # ── Governance: correct child nodes ──────────────────────────────────────
    ("governance", "documents"):            ("Governance", "Documents"),
    ("governance", "attestations"):         ("Governance", "Attestations"),
    ("governance", "attestation_campaigns"):("Governance", "Attestations"),
    ("governance", "regulatory_changes"):   ("Governance", "Regulatory Changes"),
    ("governance", "regulatory_feeds"):     ("Governance", "Regulatory Feeds"),
    # ── Governance: hide internal-only routers from palette ──────────────────
    ("governance", "workflow_templates"):   ("Internal", "Workflow Templates"),
    # ── Governance: workflows.py — all functions stay in Internal (hidden) ────
    ("governance", "workflows"):            ("Internal", "Governance Workflows"),
    # ── Governance: all document-related routers grouped under Documents ──────
    ("governance", "document_workflow"):    ("Governance", "Documents"),
    ("governance", "reviews"):              ("Governance", "Documents"),
    ("governance", "mappings"):             ("Governance", "Documents"),
    ("governance", "versions"):             ("Governance", "Documents"),
    ("governance", "policy_parser"):        ("Governance", "Documents"),
    ("governance", "policy_exceptions"):    ("Governance", "Documents"),
    # ── Compliance: Assessments (gap analysis + applicability + fw assessment + control gaps) ──
    ("governance", "applicability"):                ("Compliance", "Assessments"),
    ("governance", "gap_analysis"):                 ("Compliance", "Assessments"),
    ("framework_upload", "assessment"):             ("Compliance", "Assessments"),
    ("control_library", "gap_analysis"):            ("Compliance", "Assessments"),
    # ── Compliance: Statements ──────────────────────────────────────────────
    ("compliance", "statements"):                   ("Compliance", "Statements"),
    ("compliance", "dashboard"):                    ("Internal",   "Compliance Dashboard"),
    # ── Compliance: Frameworks (upload + publish + alignment) ────────────────
    ("framework_upload", "upload"):                 ("Compliance", "Frameworks"),
    ("framework_upload", "publish"):                ("Compliance", "Frameworks"),
    ("framework_upload", "alignment"):              ("Compliance", "Frameworks"),
    # ── Compliance: Evidence Requirements (parser + fw evidence + control recs) ─
    ("framework_upload", "parser"):                 ("Compliance", "Evidence Requirements"),
    ("framework_upload", "evidence"):               ("Compliance", "Evidence Requirements"),
    ("control_library", "evidence_recs"):           ("Compliance", "Evidence Requirements"),
    # ── Compliance: Controls (ai mapping + comparison + coverage) ────────────
    ("control_library", "ai_mapping"):              ("Compliance", "Controls"),
    ("control_library", "comparison"):              ("Compliance", "Controls"),
    ("control_library", "coverage"):                ("Compliance", "Controls"),
    # ── Compliance: Control Library (groups + inheritance + reports) ─────────
    ("control_library", "groups"):                  ("Compliance", "Control Library"),
    ("control_library", "inheritance"):             ("Compliance", "Control Library"),
    ("control_library", "reports"):                 ("Compliance", "Control Library"),
    # ── Compliance: Evidence (all evidence module routers) ───────────────────
    ("evidence", "evidence"):                       ("Compliance", "Evidence"),
    ("evidence", "lifecycle"):                      ("Compliance", "Evidence"),
    ("evidence", "ai_assessment"):                  ("Compliance", "Evidence"),
    ("evidence", "audit_packages"):                 ("Compliance", "Evidence"),
    ("evidence", "control_links"):                  ("Compliance", "Evidence"),
    ("evidence", "cross_links"):                    ("Compliance", "Evidence"),
    ("evidence", "ocr"):                            ("Compliance", "Evidence"),
    # ── Vulnerability Management: Vulnerabilities (main register + related features) ──
    ("vuln_management", "vulnerabilities"):         ("Vulnerability Management", "Vulnerabilities"),
    ("vuln_management", "ai_analysis"):             ("Vulnerability Management", "Vulnerabilities"),
    ("vuln_management", "asset_links"):             ("Vulnerability Management", "Vulnerabilities"),
    ("vuln_management", "control_links"):           ("Vulnerability Management", "Vulnerabilities"),
    ("vuln_management", "exceptions"):              ("Vulnerability Management", "Vulnerabilities"),
    ("vuln_management", "mitigations"):             ("Vulnerability Management", "Vulnerabilities"),
    ("vuln_management", "retests"):                 ("Vulnerability Management", "Vulnerabilities"),
    ("vuln_management", "workflows"):               ("Vulnerability Management", "Vulnerabilities"),
    # ── Vulnerability Management: Departments ────────────────────────────────
    ("vuln_management", "departments"):             ("Vulnerability Management", "Departments"),
    # ── Vulnerability Management: Reports ────────────────────────────────────
    ("vuln_management", "reports"):                 ("Vulnerability Management", "Reports"),
    # ── Vulnerability Management: SLA Config (SLA settings + escalations) ───
    ("vuln_management", "sla"):                     ("Vulnerability Management", "SLA Config"),
    ("vuln_management", "escalations"):             ("Vulnerability Management", "SLA Config"),
    # ── Vulnerability Management: dashboard is read-only overview — hide ─────
    ("vuln_management", "dashboard"):               ("Internal", "Vulnerability Dashboard"),
}

# (module_dir.name, fn_name) → (module_display_name, submodule_display_name)
# Redirects a SINGLE function to a different submodule, independent of its router.
FUNCTION_MODULE_OVERRIDE: dict[tuple[str, str], tuple[str, str]] = {
    # "Create Risk Mitigation Action" is defined in erm/risks.py (Risk Register) but
    # creates records shown on the Mitigation Actions page — move it there so users
    # building mitigation workflows find the Create node in the right submodule.
    ("erm", "create_risk_mitigation_action"): ("Risk Management", "Mitigation Actions"),

    # ── Governance Exceptions: hide comment CRUD from palette (out of scope) ───
    # add_comment is a POST /comments endpoint which the catalog classifies as
    # "create" action. Exception comments are not part of the automation palette.
    ("governance", "add_comment"):          ("Internal", "Exception Comments"),
}

# (module_dir.name, router_file.stem, fn_name) → custom label string
# Overrides the auto-generated label text for specific functions.
LABEL_OVERRIDE: dict[tuple[str, str, str], str] = {
    # Dependencies: clarify these act on dependency-level relationships, not global config
    ("erm", "dependencies", "update_appetite"):             "Update Dependency Appetite Level",
    ("erm", "dependencies", "update_control_effectiveness"): "Update Linked Control Effectiveness",
    # Vendor Risk: disambiguate from ERM Incidents nodes that share the same auto-label
    ("vendor_risk", "monitoring", "create_incident"):       "Create Vendor Incident",
    ("vendor_risk", "monitoring", "update_incident"):       "Update Vendor Incident",
    # Risk Assessments: match symmetry with "Link X To Assessment Risk" counterparts
    ("erm", "risk_assessments", "unlink_incident"):         "Unlink Incident From Assessment Risk",
    ("erm", "risk_assessments", "unlink_kri"):              "Unlink KRI From Assessment Risk",
    ("erm", "risk_assessments", "unlink_rcsa_finding"):     "Unlink RCSA Finding From Assessment Risk",
    # Policy Exceptions: AI action needs explicit label (auto-label strips "suggest_" prefix)
    ("governance", "policy_exceptions", "suggest_exception_content"): "AI: Suggest Exception Content",
    # Policy Exceptions: /revoke path is not in trigger_hints so POST action defaults
    # to "create", producing "Create Revoke Exception" — override to correct label.
    ("governance", "policy_exceptions", "revoke_exception"): "Revoke Exception",

    # ── Duplicate label fixes ─────────────────────────────────────────────────
    # Compliance > Evidence vs Evidence Requirements (same fn name, different routers)
    ("framework_upload", "evidence", "delete_evidence"):        "Delete Evidence Requirement",
    ("framework_upload", "evidence", "upload_evidence"):        "Upload Evidence Requirement",

    # Risk Management > RCSA vs Vendor Risk (same fn names, different domains)
    ("erm", "rcsa", "approve_assessment"):                      "Approve RCSA Assessment",
    ("vendor_risk", "assessments", "approve_assessment"):       "Approve Vendor Assessment",
    ("erm", "rcsa", "create_template"):                         "Create RCSA Template",
    ("erm", "rcsa", "update_template"):                         "Update RCSA Template",
    ("erm", "rcsa", "delete_template"):                         "Delete RCSA Template",
    ("vendor_risk", "questionnaires", "create_template"):       "Create Questionnaire Template",
    ("vendor_risk", "questionnaires", "update_template"):       "Update Questionnaire Template",
    ("vendor_risk", "questionnaires", "delete_template"):       "Delete Questionnaire Template",

    # Cross-module: Create/Update Assessment (Compliance Framework vs Vendor Risk)
    ("framework_upload", "assessment", "create_assessment"):    "Create Framework Assessment",
    ("framework_upload", "assessment", "update_assessment"):    "Update Framework Assessment",
    ("vendor_risk", "assessments", "create_assessment"):        "Create Vendor Risk Assessment",
    ("vendor_risk", "assessments", "update_assessment"):        "Update Vendor Risk Assessment",

    # Cross-module: Update Finding (Compliance Gap Analysis vs RCSA)
    ("erm", "rcsa", "update_finding"):                          "Update RCSA Finding",
    ("governance", "gap_analysis", "update_finding"):           "Update Gap Finding",

    # Cross-module: Unlink Evidence From Control (Evidence library vs Internal Controls)
    ("erm", "internal_controls", "unlink_evidence_from_control"): "Unlink Control Evidence Link",

    # Cross-module: Campaigns (RCSA campaigns vs Attestation campaigns)
    ("erm", "rcsa", "activate_campaign"):                       "Activate RCSA Campaign",
    ("erm", "rcsa", "create_campaign"):                         "Create RCSA Campaign",
    ("erm", "rcsa", "update_campaign"):                         "Update RCSA Campaign",
    ("erm", "rcsa", "delete_campaign"):                         "Delete RCSA Campaign",

    # Cross-module: Exceptions (Policy exceptions vs Vulnerability exceptions)
    ("governance", "policy_exceptions", "create_exception"):    "Create Policy Exception",
    ("governance", "policy_exceptions", "update_exception"):    "Update Policy Exception",
    ("vuln_management", "exceptions", "create_exception"):      "Create Vulnerability Exception",
    ("vuln_management", "exceptions", "update_exception"):      "Update Vulnerability Exception",

    # AI-powered functions that don't have "ai_" in their function name
    ("control_library", "reports", "generate_executive_summary"):    "AI: Generate Executive Summary",
    ("control_library", "groups", "generate_summary"):              "AI: Generate Summary",
    ("control_library", "comparison", "analyze_pair"):              "AI: Analyze Pair",
    ("control_library", "evidence_recs", "generate_for_control"):   "AI: Generate For Control",
    ("control_library", "evidence_recs", "generate_for_group"):     "AI: Generate For Group",
    ("control_library", "evidence_recs", "bulk_generate_recommendations"): "AI: Bulk Generate Recommendations",
    ("governance", "regulatory_feeds", "analyze_feed_item"):        "AI: Analyze Feed Item",
    ("governance", "documents", "suggest_policies_for_framework"):  "AI: Suggest Policies For Framework",
    ("framework_upload", "parser", "generate_evidence_requirements"): "AI: Generate Evidence Requirements",
    ("framework_upload", "parser", "classify_framework"):           "AI: Classify Framework",
    ("erm", "framework_risk_assessments", "generate_framework_questions"): "AI: Generate Framework Questions",
    ("vuln_management", "ai_analysis", "analyze_report"):           "AI: Analyze Report",
    ("vuln_management", "ai_analysis", "suggest_fix"):              "AI: Suggest Fix",
    ("evidence", "ai_assessment", "assess_evidence"):               "AI: Assess Evidence",
    ("evidence", "ai_assessment", "quick_assess_evidence"):         "AI: Quick Assess Evidence",
    ("evidence", "ai_assessment", "batch_assess_evidence"):         "AI: Batch Assess Evidence",

    # Cross-module: Clone Template (RCSA vs Workflow Templates)
    ("erm", "rcsa", "clone_template"):                          "Clone RCSA Template",
    ("workflow_engine", "templates", "clone_template"):         "Clone Workflow Template",

    # Cross-module: Delegate Approval (RCSA vs Governance Workflows)
    ("erm", "rcsa", "delegate_approval"):                       "Delegate RCSA Approval",
    ("governance", "workflows", "delegate_approval"):           "Delegate Governance Approval",

    # Cross-module: Advance/Start Workflow (Documents vs Governance Workflows)
    ("governance", "document_workflow", "advance_workflow"):    "Advance Document Workflow",
    ("governance", "workflows", "advance_workflow"):            "Advance Governance Workflow",
    ("governance", "document_workflow", "start_workflow"):      "Start Document Workflow",
    ("governance", "workflows", "start_workflow"):              "Start Governance Workflow",
}


def _trigger_hint_matches(hint: str, lower_path: str) -> bool:
    """Word-boundary-aware trigger hint matching.

    Prevents false positives where a hint word is merely a prefix of a longer
    resource noun, e.g. '/assess' must NOT match '/assessments' (the 's' is a
    continuation of the same word), but it MUST still match '/risks/{id}/assess'
    (exact segment) or '/assess-risk' (dash follows — compound action).

    Rules:
      - Hints that already end with '-' or '_' (e.g. '/ai-', '/batch-') are
        treated as segment-start prefixes and matched with startswith().
      - All other hints are matched with a regex that requires the word to be
        followed by end-of-string, '/', '-', or '_' (i.e. not a plain letter
        that would extend the word into a longer noun).
    """
    bare = hint.lstrip("/")
    if bare.endswith("-") or bare.endswith("_"):
        # e.g. '/ai-' matches 'ai-generate'; '/batch-' matches 'batch-update'
        return any(seg.startswith(bare) for seg in lower_path.split("/"))
    # Require bare word at a path boundary, not followed by another letter/digit
    # so '/assess' won't match 'assessments' but will match 'assess' or 'assess-risk'
    pattern = r"(?:^|/)" + re.escape(bare) + r"(?=$|/|-|_)"
    return bool(re.search(pattern, lower_path))


def _action_from_http_method_and_path(http_method: str, path: str) -> str:
    method = (http_method or "").lower()
    lower_path = (path or "").lower()

    if method == "post":
        trigger_hints = [
            "/approve", "/reject", "/submit", "/publish", "/parse", "/run", "/trigger",
            # NOTE: '/assess' intentionally omitted — it would falsely match '/assessments'
            # (a create endpoint).  Genuine "assess" action endpoints use more-specific
            # suffixes such as '/score', '/review', or '/analyze'.
            "/review", "/close", "/reopen", "/test", "/analyze", "/optimize",
            "/upload", "/import", "/export", "/ai-", "/ai_",
            # Semantic operation suffixes
            "/activate", "/advance", "/auto-populate", "/cancel", "/close",
            "/complete", "/convert", "/delegate", "/draft", "/escalate",
            "/infer", "/poll", "/poll-all", "/remind", "/reparse", "/reword",
            "/rollback", "/seed", "/skip", "/start", "/suggest",
            "/summary", "/ai-generate", "/ai-compare",
            # Bulk / batch operations
            "/bulk", "/batch-",
            # Evidence lifecycle operations
            "/lock", "/unlock", "/expire", "/renew", "/finalize",
            "/log-", "/check-", "/populate", "/quick-",
            # Control library & framework operations
            "/auto-", "/auto-group", "/generate-summary",
            "/enhance", "/classify", "/calculate-", "/prioritize",
            # Additional action suffixes
            "/generate", "/retry", "/confirm", "/sync", "/convert",
            "/extract", "/verify", "/process-",
            # Scoring / assessment operations (explicit suffixes only)
            "/score",
        ]
        if any(_trigger_hint_matches(h, lower_path) for h in trigger_hints):
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
    def_pattern = re.compile(r"^\s*(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", flags=re.MULTILINE)

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
    seen_module_labels: set[tuple[str, str, str]] = set()

    EXCLUDED_MODULES = {"workflow_engine"}

    for module_dir in modules_root.iterdir():
        if not module_dir.is_dir() or module_dir.name.startswith("__"):
            continue
        if module_dir.name in EXCLUDED_MODULES:
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

            # Allow per-router module/submodule override
            _override = ROUTER_MODULE_OVERRIDE.get((module_dir.name, router_file.stem))
            _router_eff_module = _override[0] if _override else module_name
            _router_eff_submodule = _override[1] if _override else submodule_name

            for method, route_path, fn_name in _extract_route_entries(text):
                full_route_path = (sub_prefix or "") + (route_path or "")
                action = _action_from_http_method_and_path(method, full_route_path)
                if action not in AUTOMATION_RELEVANT_PLATFORM_ACTIONS:
                    continue

                # Allow per-function module/submodule override (takes precedence over router-level)
                _fn_override = FUNCTION_MODULE_OVERRIDE.get((module_dir.name, fn_name))
                if _fn_override:
                    _eff_module = _fn_override[0]
                    _eff_submodule = _fn_override[1]
                else:
                    _eff_module = _router_eff_module
                    _eff_submodule = _router_eff_submodule

                # Words that, when appearing at the start of a function name,
                # make the action verb prefix redundant.
                _SELF_DESCRIBING_VERBS = {
                    # Original set
                    "accept", "activate", "advance", "ai", "apply", "assign", "auto",
                    "analyze", "batch", "bulk", "cancel", "change", "check", "classify",
                    "close", "complete", "confirm", "convert", "delegate", "draft",
                    "enhance", "escalate", "expire", "extract", "finalize",
                    "generate", "infer", "link", "lock", "log", "move", "override",
                    "parse", "perform", "poll", "populate", "process", "publish",
                    "quick", "reparse", "remove", "request", "renew", "retry",
                    "reword", "rollback", "schedule", "score", "seed", "send", "set",
                    "side", "skip", "start", "submit", "suggest", "summarize",
                    "sync", "add", "unassign", "unlock", "unlink", "upload", "verify",
                    # Additional action verbs missing from original set
                    "aggregate", "assess", "calculate", "cascade", "clone", "collect",
                    "compare", "count", "dedupe", "download", "evaluate", "export",
                    "flag", "gather", "import", "increment", "map", "normalize",
                    "notify", "raise", "record", "reject", "reopen", "resolve",
                    "revoke", "review", "sanitize", "save", "split",
                }

                # For trigger actions use the ORIGINAL fn name so that stripped
                # prefixes like "generate_" aren't lost.
                orig_first = fn_name.split("_")[0].lower() if fn_name else ""

                cleaned_fn = fn_name
                # Collapse upsert-style prefix "create_or_update_" → keep just the subject
                if cleaned_fn.startswith("create_or_update_"):
                    cleaned_fn = cleaned_fn[len("create_or_update_"):]
                # Strip generic HTTP-verb prefixes (only for non-trigger to keep
                # semantic verbs like "generate_" intact)
                elif action != "trigger" or orig_first not in _SELF_DESCRIBING_VERBS:
                    for p in ["list_", "get_", "create_", "update_", "delete_",
                              "post_", "put_", "patch_", "generate_", "run_", "do_"]:
                        if cleaned_fn.startswith(p):
                            cleaned_fn = cleaned_fn[len(p):]
                            break
                # Strip the action verb itself if the fn still leads with it
                # (prevents "Approve Approve X", "Upload Upload X", etc.)
                if cleaned_fn.lower().startswith(action + "_"):
                    cleaned_fn = cleaned_fn[len(action) + 1:]
                # Also strip the action verb if it appears embedded in the middle
                # e.g. "external_delete_evidence" with action="delete" → "external_evidence"
                # (prevents "Delete External Delete Evidence")
                _embedded = f"_{action}_"
                if _embedded in cleaned_fn.lower() and not cleaned_fn.lower().startswith(action + "_"):
                    cleaned_fn = re.sub(re.escape(_embedded), "_", cleaned_fn, flags=re.IGNORECASE)
                base_label = _humanize_slug(cleaned_fn)
                # Fix common acronym capitalisations
                base_label = re.sub(r"\bAi\b", "AI", base_label)

                action_verb = action.capitalize()
                first_word = (base_label.split()[0].lower()) if base_label else ""

                # Use the fn-derived label directly when it already encodes the
                # action verb — avoids "Create Link …", "Delete Unlink …", etc.
                # Exception: for "update" actions always prepend "Update" so that
                # e.g. update_review → "Update Review" (not just "Review").
                # For "trigger" actions whose name doesn't start with a self-describing
                # verb, also use the base label directly — "Trigger" is an internal
                # implementation detail and should not appear in the UI palette.
                if first_word in _SELF_DESCRIBING_VERBS and action != "update":
                    label = base_label
                elif action == "trigger" and first_word not in _SELF_DESCRIBING_VERBS:
                    label = base_label
                else:
                    label = f"{action_verb} {base_label}"

                # Apply per-function label override if defined
                _lbl_override = LABEL_OVERRIDE.get((module_dir.name, router_file.stem, fn_name))
                if _lbl_override:
                    label = _lbl_override

                # ── Normalize AI-related labels to "AI: …" format ──
                # Detects AI-powered actions by function name patterns and
                # ensures consistent "AI: " prefix so users can instantly
                # distinguish AI actions from manual/system ones.
                _fn_lower = (fn_name or "").lower()
                _router_stem = router_file.stem.lower()
                _is_ai_fn = (
                    _fn_lower.startswith("ai_")
                    or "_ai_" in _fn_lower
                    or _fn_lower.endswith("_with_ai")
                    or _fn_lower.endswith("_ai")
                    or "ai_draft" in _fn_lower
                    or "ai_suggest" in _fn_lower
                    or "ai_score" in _fn_lower
                    or "ai_prioritize" in _fn_lower
                    or "ai_map" in _fn_lower
                    or "ai_explain" in _fn_lower
                    or "ai_reword" in _fn_lower
                )
                if _is_ai_fn and not label.startswith("AI:") and not label.startswith("AI :"):
                    _label_no_ai = re.sub(r"^AI\s+", "", label)
                    _label_no_ai = re.sub(r"\s+AI\b", "", _label_no_ai)
                    _label_no_ai = re.sub(r"\bWith\s*$", "", _label_no_ai).strip()
                    _label_no_ai = re.sub(r"\bFrom AI\b", "From", _label_no_ai)
                    label = f"AI: {_label_no_ai}"

                # Auto-generate a human-readable description
                _action_verbs = {
                    "create": "Creates", "update": "Updates", "trigger": "Triggers",
                    "upload": "Uploads / imports", "approve": "Approves", "reject": "Rejects",
                    "delete": "Deletes", "read": "Reads",
                }
                _verb = _action_verbs.get(action, "Executes")
                description = f"{_verb} {base_label.lower()} in {_eff_submodule}"

                endpoint = f"{sub_prefix}{route_path}" if sub_prefix or route_path else ""
                key = (
                    f"platform_action.{_slugify(action)}."
                    f"{_slugify(_eff_module)}.{_slugify(_eff_submodule)}.{_slugify(base_label)}"
                )
                if key in seen:
                    continue
                seen.add(key)

                module_label_pair = (_eff_module, _eff_submodule, label)
                if module_label_pair in seen_module_labels:
                    continue
                seen_module_labels.add(module_label_pair)

                items.append(
                    {
                        "key": key,
                        "label": label,
                        "description": description,
                        "endpoint": endpoint,
                        "action": action,
                        "module": _eff_module,
                        "submodule": _eff_submodule,
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

CONDITION_NODE_TYPES = [
    # ── Risk conditions ───────────────────────────────────────────────────────
    {"key": "check_risk_level", "label": "Check risk level"},
    # ── Evidence & compliance conditions ─────────────────────────────────────
    {"key": "check_compliance_status", "label": "Check compliance status"},
    {"key": "check_evidence_age", "label": "Check evidence age"},
    {"key": "check_evidence_completeness", "label": "Check evidence completeness (%)"},
    {"key": "check_framework_coverage", "label": "Check framework coverage (%)"},
    # ── Vulnerability conditions ──────────────────────────────────────────────
    {"key": "check_vulnerability_severity", "label": "Check vulnerability severity"},
    # ── Governance conditions ─────────────────────────────────────────────────
    {"key": "check_policy_status", "label": "Check policy status"},
    # ── Workflow / user conditions ────────────────────────────────────────────
    {"key": "check_approval_status", "label": "Check approval status"},
    {"key": "check_user_role", "label": "Check user role"},
    {"key": "evaluate_business_unit", "label": "Evaluate business unit"},
    {"key": "expression_builder", "label": "Expression / custom rule"},
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
