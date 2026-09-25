import json
from pathlib import Path
import re
from typing import Optional

from ....feature_map import HUB_ASSESSMENTS, PAGE_ORDER, sidebar_path, sidebar_rank
from ....feature_map import place as place_in_sidebar
from .route_events import event_name


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
    # ── Audit triggers (Auditor Portal) ───────────────────────────────────────
    {"key": "audit_review_submitted",      "label": "Auditor review submitted"},
    {"key": "audit_control_approved",      "label": "Auditor auto-approved a control"},
    # ── IT Asset triggers ─────────────────────────────────────────────────────
    {"key": "asset_created", "label": "IT asset created"},
    {"key": "asset_updated", "label": "IT asset updated"},
    {"key": "asset_deleted", "label": "IT asset deleted"},
    # ── Issue Management triggers ─────────────────────────────────────────────
    {"key": "issue_created", "label": "Issue created"},
    {"key": "issue_severity_changed", "label": "Issue severity changed"},
    {"key": "issue_state_changed", "label": "Issue workflow state changed"},
    {"key": "issue_sla_breached", "label": "Issue SLA breached (target_closure_date passed)"},
    # ── CIS Compliance triggers ───────────────────────────────────────────────
    # Plugin-run lifecycle events come off the run-row create / status update
    # audit-log entries.  Polling-based events (pass-rate drop, agent offline)
    # are dispatched from the periodic check inside the trigger loop.
    {"key": "cis_check_failed", "label": "CIS check failed (single plugin run)"},
    {"key": "cis_scan_completed", "label": "CIS scan batch completed"},
    {"key": "cis_pass_rate_dropped", "label": "CIS tenant pass rate dropped below threshold"},
    {"key": "agent_offline", "label": "Compliance agent offline (no heartbeat)"},
    {"key": "agent_enrolled", "label": "Compliance agent enrolled / came online"},
    {"key": "connection_handshake_completed", "label": "Connect Wizard handshake completed"},
    # ── Governance: document review & sign-off ────────────────────────────
    {"key": "document_review_started", "label": "Document review started"},
    {"key": "document_review_completed", "label": "Document review completed"},
    {"key": "document_signoff_requested", "label": "Document sign-off requested"},
    {"key": "document_signoff_completed", "label": "Document sign-off completed"},
    # ── Governance: committees ────────────────────────────────────────────
    {"key": "committee_created", "label": "Committee created"},
    {"key": "committee_updated", "label": "Committee updated"},
    {"key": "committee_meeting_scheduled", "label": "Committee meeting scheduled"},
    {"key": "committee_meeting_completed", "label": "Committee meeting completed"},
    {"key": "committee_action_overdue", "label": "Committee action overdue"},
    # ── Governance: attestations & certification ──────────────────────────
    {"key": "attestation_requested", "label": "Attestation requested"},
    {"key": "attestation_completed", "label": "Attestation completed"},
    {"key": "attestation_campaign_activated", "label": "Attestation campaign activated"},
    {"key": "attestation_campaign_completed", "label": "Attestation campaign completed"},
    {"key": "attestation_campaign_escalated", "label": "Attestation campaign escalated"},
    # ── Governance: regulatory changes & exceptions ───────────────────────
    {"key": "regulatory_change_created", "label": "Regulatory change created"},
    {"key": "regulatory_change_closed", "label": "Regulatory change closed"},
    {"key": "regulatory_task_created", "label": "Regulatory task created"},
    {"key": "policy_exception_created", "label": "Policy exception created"},
    {"key": "policy_exception_approved", "label": "Policy exception approved"},
    {"key": "policy_exception_revoked", "label": "Policy exception revoked"},
    # ── Risk / ERM: mitigation actions & incidents ─────────────────────────
    {"key": "mitigation_action_created", "label": "Mitigation action created"},
    {"key": "mitigation_action_completed", "label": "Mitigation action completed"},
    {"key": "mitigation_action_overdue", "label": "Mitigation action overdue"},
    {"key": "incident_closed", "label": "Incident closed"},
    {"key": "incident_updated", "label": "Incident updated"},
    # ── Risk / ERM: KRIs ─────────────────────────────────────────────────
    {"key": "kri_measured", "label": "KRI measured"},
    {"key": "kri_breach_resolved", "label": "KRI breach resolved"},
    # ── Risk / ERM: reviews & assessments ─────────────────────────────────
    {"key": "risk_review_scheduled", "label": "Risk review scheduled"},
    {"key": "risk_review_completed", "label": "Risk review completed"},
    {"key": "risk_closed", "label": "Risk closed"},
    {"key": "risk_reopened", "label": "Risk reopened"},
    {"key": "risk_assessment_created", "label": "Risk assessment created"},
    {"key": "risk_assessment_completed", "label": "Risk assessment completed"},
    # ── Risk / ERM: RCSA ─────────────────────────────────────────────────
    {"key": "rcsa_campaign_activated", "label": "RCSA campaign activated"},
    {"key": "rcsa_assessment_submitted", "label": "RCSA assessment submitted"},
    {"key": "rcsa_assessment_approved", "label": "RCSA assessment approved"},
    # ── Risk / ERM: internal controls ────────────────────────────────────
    {"key": "internal_control_submitted", "label": "Internal control submitted for approval"},
    {"key": "internal_control_approved", "label": "Internal control approved"},
    {"key": "internal_control_test_failed", "label": "Internal control test failed"},
    {"key": "appetite_breach_detected", "label": "Appetite breach detected"},
    # ── Third-Party Risk: vendors, assessments, questionnaires ────────────
    {"key": "vendor_created", "label": "Vendor created"},
    {"key": "vendor_updated", "label": "Vendor updated"},
    {"key": "vendor_assessment_created", "label": "Vendor assessment created"},
    {"key": "vendor_assessment_approved", "label": "Vendor assessment approved"},
    {"key": "vendor_questionnaire_sent", "label": "Vendor questionnaire sent"},
    {"key": "vendor_questionnaire_completed", "label": "Vendor questionnaire completed"},
    {"key": "vendor_incident_created", "label": "Vendor incident created"},
    {"key": "vendor_remediation_created", "label": "Vendor remediation action created"},
    {"key": "vendor_reassessment_scheduled", "label": "Vendor reassessment scheduled"},
    {"key": "vendor_offboarding_updated", "label": "Vendor offboarding updated"},
    # ── Compliance: evidence & access reviews ─────────────────────────────
    {"key": "evidence_submitted", "label": "Evidence submitted"},
    {"key": "evidence_rejected", "label": "Evidence rejected"},
    {"key": "evidence_renewed", "label": "Evidence renewed"},
    {"key": "evidence_stale", "label": "Evidence stale"},
    {"key": "audit_package_finalized", "label": "Audit package finalized"},
    {"key": "evidence_linked_to_control", "label": "Evidence linked to control"},
    {"key": "compliance_assessment_created", "label": "Compliance assessment created"},
    {"key": "compliance_assessment_completed", "label": "Compliance assessment completed"},
    {"key": "framework_published", "label": "Framework published"},
    {"key": "access_review_campaign_created", "label": "Access review campaign created"},
    {"key": "access_review_item_decided", "label": "Access review item decided"},
    {"key": "access_review_campaign_closed", "label": "Access review campaign closed"},
    {"key": "access_review_escalated", "label": "Access review escalated"},
    # ── Issues / CAPA ─────────────────────────────────────────────────────
    {"key": "issue_closed", "label": "Issue closed"},
    {"key": "issue_reopened", "label": "Issue reopened"},
    {"key": "issue_assigned", "label": "Issue assigned"},
    {"key": "capa_action_created", "label": "CAPA action created"},
    {"key": "capa_action_completed", "label": "CAPA action completed"},
    # ── Audit Issue Register ──────────────────────────────────────────────
    {"key": "audit_register_imported", "label": "Audit register workbook imported"},
    {"key": "audit_finding_added", "label": "Audit finding added"},
    {"key": "audit_finding_updated", "label": "Audit finding edited"},
    {"key": "audit_finding_deleted", "label": "Audit finding deleted"},
    {"key": "audit_finding_restored", "label": "Audit finding restored"},
    {"key": "audit_finding_submitted_for_validation", "label": "Audit finding submitted for validation"},
    {"key": "audit_finding_validated", "label": "Audit finding passed validation (closed)"},
    {"key": "audit_finding_returned", "label": "Audit finding sent back (more materials or failed)"},
    {"key": "audit_extension_requested", "label": "Audit finding extension requested"},
    {"key": "audit_extension_decided", "label": "Audit finding extension decided"},
    {"key": "audit_extension_approved", "label": "Audit finding extension approved"},
    {"key": "audit_extension_rejected", "label": "Audit finding extension not approved"},
    {"key": "audit_regulator_status_changed", "label": "MRA regulator status changed"},
    {"key": "audit_reminders_sent", "label": "Audit register reminders sent"},
    # ── Assets / BCM / Administration ─────────────────────────────────────
    {"key": "asset_criticality_changed", "label": "Asset criticality changed"},
    {"key": "bcm_plan_created", "label": "BCM Plan Created"},
    {"key": "bcm_plan_activated", "label": "BCM Plan Activated"},
    {"key": "bcm_drill_scheduled", "label": "BCM Drill Scheduled"},
    {"key": "bcm_drill_completed", "label": "BCM Drill Completed"},
    {"key": "bcm_bia_updated", "label": "BCM BIA Updated"},
    {"key": "user_created", "label": "User created"},
    {"key": "user_updated", "label": "User updated"},
    {"key": "user_deactivated", "label": "User deactivated"},
    {"key": "role_created", "label": "Role created"},
    {"key": "role_updated", "label": "Role updated"},
    {"key": "password_policy_updated", "label": "Password policy updated"},
    {"key": "critical_task_created", "label": "Critical task created"},
    {"key": "critical_task_completed", "label": "Critical task completed"},
    {"key": "critical_task_overdue", "label": "Critical task overdue"},
    # ── Optional metrics ──────────────────────────────────────────────────
    {"key": "kpi_breached", "label": "KPI breached"},
]

# Named action nodes. Generic workflow-engine steps PLUS the curated GRC
# domain actions that have dedicated handlers in action_handlers.py. These
# coexist with the auto-generated Platform Function nodes (which surface the
# full backend API surface) — keeping both means no node disappears from the
# palette while every backend endpoint is also reachable.
ACTION_NODE_TYPES = [
    # ── Notifications & communication ─────────────────────────────────────────
    {"key": "send_notification_email", "label": "Send notification / email"},
    {"key": "send_in_app_alert", "label": "Send in-app alert / notification"},
    {"key": "escalate_to_management", "label": "Escalate to management"},
    {"key": "call_webhook_api", "label": "Call webhook / API"},
    {"key": "generate_report", "label": "Generate report"},
    # ── Evidence & compliance actions ─────────────────────────────────────────
    {"key": "request_evidence_upload", "label": "Request evidence upload"},
    {"key": "request_evidence_review", "label": "Request evidence review"},
    {"key": "approve_evidence", "label": "Approve evidence"},
    {"key": "reject_evidence", "label": "Reject evidence / return for revision"},
    {"key": "update_compliance_status", "label": "Update compliance status"},
    {"key": "start_compliance_assessment", "label": "Start compliance assessment"},
    {"key": "close_compliance_gap", "label": "Close / remediate compliance gap"},
    {"key": "link_evidence_to_control", "label": "Link evidence to control"},
    {"key": "assign_control_owner", "label": "Assign control owner"},
    # ── Risk actions ──────────────────────────────────────────────────────────
    {"key": "create_risk_entry", "label": "Create risk entry"},
    {"key": "update_risk_status", "label": "Update risk status / treatment"},
    {"key": "assign_risk_owner", "label": "Assign risk owner"},
    {"key": "trigger_risk_review", "label": "Trigger risk review cycle"},
    {"key": "create_remediation_task", "label": "Create remediation task"},
    # ── Vulnerability actions ─────────────────────────────────────────────────
    {"key": "assign_vulnerability_owner", "label": "Assign vulnerability owner"},
    {"key": "update_vulnerability_status", "label": "Update vulnerability status"},
    {"key": "create_vulnerability_entry", "label": "Create vulnerability entry"},
    # ── Governance actions ────────────────────────────────────────────────────
    {"key": "create_policy_review_task", "label": "Create policy review task"},
    {"key": "publish_policy", "label": "Publish policy / document"},
    {"key": "submit_policy_exception", "label": "Submit policy exception request"},
    {"key": "approve_policy_exception", "label": "Approve policy exception"},
    {"key": "request_attestation", "label": "Request policy attestation"},
    # ── Control library actions ───────────────────────────────────────────────
    {"key": "update_control_effectiveness", "label": "Update control effectiveness rating"},
    {"key": "set_control_not_applicable", "label": "Mark control as not applicable"},
    # ── Issue Management actions ──────────────────────────────────────────────
    {"key": "create_issue", "label": "Create issue"},
    {"key": "assign_issue", "label": "Assign issue (owner / assignee)"},
    {"key": "transition_issue_state", "label": "Transition issue workflow state"},
    {"key": "add_capa_action", "label": "Add corrective action (CAPA) to issue"},
    # ── CIS Compliance actions ────────────────────────────────────────────────
    {"key": "trigger_cis_scan_all", "label": "Trigger CIS scan-all (optional asset/benchmark filters)"},
    {"key": "revoke_cis_agent", "label": "Revoke compliance agent api_token"},
    {"key": "create_issue_from_failed_check", "label": "Create issue from failed CIS check"},
    {"key": "update_plugin_review_status", "label": "Bulk approve / reject CIS plugins by filter"},
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
        # so it is named after its sidebar page like every other node
        "route_path": "/grc/compliance-plugins/{plugin_id}/runs",
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
        # so it is named after its sidebar page like every other node
        "route_path": "/grc/compliance-plugins/{plugin_id}/runs",
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
    # ── Issue Management: corrective actions on an issue ────────────────────
    ("issue_management", "actions"):                ("Issue Management", "CAPA Actions"),
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
    # Framework Upload: the auto-label "Analyze And Align Controls" is opaque —
    # spell out that it maps an uploaded framework's controls onto the library.
    ("framework_upload", "alignment", "analyze_and_align_controls"): "Map Framework Controls to Library",
    # Dependencies: clarify these act on dependency-level relationships, not global config
    ("erm", "dependencies", "update_appetite"): "Edit Dependency Appetite Level",
    ("erm", "dependencies", "update_control_effectiveness"): "Edit Linked Control Effectiveness",
    # Vendor Risk: disambiguate from ERM Incidents nodes that share the same auto-label
    ("vendor_risk", "monitoring", "create_incident"):       "Create Vendor Incident",
    ("vendor_risk", "monitoring", "update_incident"): "Edit Vendor Incident",
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
    ("erm", "rcsa", "update_template"): "Edit RCSA Template",
    ("erm", "rcsa", "delete_template"):                         "Delete RCSA Template",
    ("vendor_risk", "questionnaires", "create_template"):       "Create Questionnaire Template",
    ("vendor_risk", "questionnaires", "update_template"): "Edit Questionnaire Template",
    ("vendor_risk", "questionnaires", "delete_template"):       "Delete Questionnaire Template",

    # Cross-module: Create/Update Assessment (Compliance Framework vs Vendor Risk)
    ("framework_upload", "assessment", "create_assessment"):    "Create Framework Assessment",
    ("framework_upload", "assessment", "update_assessment"): "Edit Framework Assessment",
    ("vendor_risk", "assessments", "create_assessment"):        "Create Vendor Risk Assessment",
    ("vendor_risk", "assessments", "update_assessment"): "Edit Vendor Risk Assessment",

    # Cross-module: Update Finding (Compliance Gap Analysis vs RCSA)
    ("erm", "rcsa", "update_finding"): "Edit RCSA Finding",
    ("governance", "gap_analysis", "update_finding"): "Edit Gap Finding",

    # Cross-module: Unlink Evidence From Control (Evidence library vs Internal Controls)
    ("erm", "internal_controls", "unlink_evidence_from_control"): "Unlink Control Evidence Link",

    # Cross-module: Campaigns (RCSA campaigns vs Attestation campaigns)
    ("erm", "rcsa", "activate_campaign"):                       "Activate RCSA Campaign",
    ("erm", "rcsa", "create_campaign"):                         "Create RCSA Campaign",
    ("erm", "rcsa", "update_campaign"): "Edit RCSA Campaign",
    ("erm", "rcsa", "delete_campaign"):                         "Delete RCSA Campaign",

    # Cross-module: Exceptions (Policy exceptions vs Vulnerability exceptions)
    ("governance", "policy_exceptions", "create_exception"):    "Create Policy Exception",
    ("governance", "policy_exceptions", "update_exception"): "Edit Policy Exception",
    ("vuln_management", "exceptions", "create_exception"):      "Create Vulnerability Exception",
    ("vuln_management", "exceptions", "update_exception"): "Edit Vulnerability Exception",

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

    # Issue Management: CAPA actions (routes on router_issue / router_actions)
    ("issue_management", "actions", "create_action"):           "Add CAPA Action To Issue",
    ("issue_management", "actions", "update_action"):           "Edit CAPA Action",
    ("issue_management", "actions", "verify_action"):           "Verify CAPA Action",
    ("issue_management", "actions", "delete_action"):           "Delete CAPA Action",
    ("issue_management", "actions", "promote_action_to_task"):  "Promote CAPA Action To Critical Task",
    ("erm", "mitigation_actions", "create_risk_action"):        "Add Mitigation Action To Risk",
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


def _extract_route_entries(py_text: str) -> list[tuple[str, str, str, str]]:
    """(method, path, function, prefix) per route. `router` routes take the
    file's first prefix, as they always have; a file's other routers (CAPA's
    router_issue and router_actions) take their own."""
    entries: list[tuple[str, str, str, str]] = []
    own_prefixes = {var: "" for var in re.findall(r"^(\w+)\s*=\s*APIRouter\(", py_text, flags=re.MULTILINE)}
    own_prefixes.update(re.findall(
        r"^(\w+)\s*=\s*APIRouter\([^\)]*?prefix\s*=\s*['\"]([^'\"]+)['\"]", py_text, flags=re.MULTILINE))
    first_prefix = _extract_router_prefix(py_text)
    route_pattern = re.compile(r"@(\w+)\.(get|post|put|patch|delete)\(\s*['\"]([^'\"]*)['\"]", flags=re.IGNORECASE)
    def_pattern = re.compile(r"^\s*(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", flags=re.MULTILINE)

    for match in route_pattern.finditer(py_text):
        router_var = match.group(1)
        if router_var == "router":
            prefix = first_prefix
        elif router_var in own_prefixes:
            prefix = own_prefixes[router_var]
        else:
            continue  # not a router of this file (e.g. @app.get)
        method = match.group(2).lower()
        path = match.group(3) or ""
        fn_name = "handler"
        def_match = def_pattern.search(py_text, pos=match.end())
        if def_match:
            fn_name = def_match.group(1)
        entries.append((method, path, fn_name, prefix))
    return entries


def _label_for(action: str, fn_name: str, override_key: tuple) -> tuple[str, str]:
    """(label, base_label) the palette shows for an endpoint function."""
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

    # Plain-language verbs so labels read naturally for tech and
    # non-tech users ("Edit …" rather than "Update …"). Falls back
    # to a capitalised action for anything not mapped here.
    _LABEL_VERBS = {
        "create": "Create",
        "update": "Edit",
        "delete": "Delete",
        "upload": "Upload",
        "assign": "Assign",
        "approve": "Approve",
        "reject": "Reject",
        "submit": "Submit",
        "publish": "Publish",
        "export": "Export",
        "read": "View",
        "trigger": "Run",
    }
    action_verb = _LABEL_VERBS.get(action, action.capitalize())
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
    _lbl_override = LABEL_OVERRIDE.get(override_key)
    if _lbl_override:
        label = _lbl_override

    # ── Normalize AI-related labels to "AI: …" format ──
    # Detects AI-powered actions by function name patterns and
    # ensures consistent "AI: " prefix so users can instantly
    # distinguish AI actions from manual/system ones.
    _fn_lower = (fn_name or "").lower()
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
    return label, base_label


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

            submodule_name = _humanize_slug(router_file.stem)

            # Allow per-router module/submodule override
            _override = ROUTER_MODULE_OVERRIDE.get((module_dir.name, router_file.stem))
            _router_eff_module = _override[0] if _override else module_name
            _router_eff_submodule = _override[1] if _override else submodule_name

            for method, route_path, fn_name, sub_prefix in _extract_route_entries(text):
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

                label, base_label = _label_for(
                    action, fn_name, (module_dir.name, router_file.stem, fn_name))

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
                        # Route identity — used to match this node back to its live
                        # FastAPI route so we can introspect its real parameters
                        # (path / query / body fields) for the config panel.
                        "fn_name": fn_name,
                        "method": method,
                        "router_stem": router_file.stem,
                        "module_dir": module_dir.name,
                        "route_path": full_route_path,
                        "endpoint_module": f"grc.modules.{module_dir.name}.routers.{router_file.stem}",
                        # The event its own endpoint raises (route_events), so
                        # the node used as a trigger fires on exactly that call.
                        "trigger_event": _trigger_event_for(
                            method, fn_name, f"grc.modules.{module_dir.name}.routers.{router_file.stem}", label),
                    }
                )

    return items


def get_platform_functions_grouped_by_module() -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for item in PLATFORM_FUNCTION_NODE_TYPES:
        module_name = str(item.get("module") or "General")
        grouped.setdefault(module_name, []).append(item)
    # PLATFORM_FUNCTION_NODE_TYPES is already in menu order once the app's routes
    # have placed it (extend_with_app_routes), so modules and pages keep that order.
    return grouped


# POSTs that read or compute (a dataset query, a preview, an AI suggestion)
# change nothing, so they never start a workflow.
_READ_LIKE_PREFIXES = (
    "query_", "aggregate_", "preview_", "search_", "list_", "get_", "lookup_", "count_",
    "estimate_", "compare_", "enrich_", "metabase_", "export_", "download_",
)
_MUTATING_METHODS = {"post", "put", "patch", "delete"}


def _trigger_event_for(method: str, fn_name: str, module_path: str, label: str) -> Optional[str]:
    """The endpoint event a write raises, or None for reads, read-like POSTs
    and AI helpers (they suggest; a person then saves)."""
    if (method or "").lower() not in _MUTATING_METHODS or (fn_name or "").startswith(_READ_LIKE_PREFIXES):
        return None
    if label.startswith("AI:"):
        return None
    return event_name(module_path, fn_name)


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


# ── Route files outside modules/*/routers ────────────────────────────────────
# The scanner above only reads modules/<module>/routers/*.py; extend_with_app_routes
# adds the platform's other write endpoints from the live app's routes, and
# feature_map.place() names them after the sidebar page they serve.
# These entries are kept for one reason: a node key is generated from the names
# below, and saved workflow graphs store keys, so they must not move. Displayed
# names come from feature_map — add nothing here for new routes.
ROUTE_FILE_MODULES: dict[str, tuple[str, Optional[str]]] = {
    # Controls Automation
    "grc.modules.automation.router": ("Controls Automation", "Common Controls"),
    "grc.modules.automation.assurance": ("Controls Automation", "Control Assurance"),
    "grc.modules.scf.router": ("Controls Automation", "Scope & Custom Controls"),
    # Reports
    "grc.routers.reporting_router": ("Reports", "Reports"),
    # Cybersecurity Assurance
    "grc.routers.assets_router": ("Cybersecurity Assurance", "IT Asset Inventory"),
    "grc.routers.entity_extras_router": ("Cybersecurity Assurance", "IT Asset Inventory"),
    "grc.modules.asset_discovery.router": ("Cybersecurity Assurance", "IT Asset Discovery"),
    "grc.modules.onboarding.router": ("Cybersecurity Assurance", "IT Asset Discovery"),
    "grc.modules.risk_posture.router": ("Cybersecurity Assurance", "Assets Risk Posture"),
    "grc.routers.criticality_assessments_router": ("Cybersecurity Assurance", "Criticality Assessments"),
    "grc.modules.integrations.router": ("Cybersecurity Assurance", "Vulnerability Scanning"),
    "grc.routers.nca_vuln_router": ("Cybersecurity Assurance", "NCA Vulnerabilities"),
    # Governance
    "grc.routers.is_projects_router": ("Governance", "Projects"),
    "grc.routers.nca_kpi_router": ("Governance", "KPI Report"),
    "grc.routers.documents_router": ("Governance", "Document Library"),
    "grc.routers.governance_router": ("Governance", "Exceptions"),
    "grc.routers.policy_exception_router": ("Governance", "Policy Exceptions"),
    "grc.routers.nca_templates_router": ("Governance", "Document Templates"),
    "grc.routers.reference_laws_router": ("Governance", "Document Templates"),
    # Risk Management
    "grc.routers.risks_router": ("Risk Management", "Risks"),
    "grc.routers.advanced_erm_router": ("Risk Management", "Advanced ERM"),
    "grc.routers.ai_risk_assessment_router": ("Risk Management", "AI Risk Assessment"),
    "grc.routers.nca_risk_router": ("Risk Management", "NCA Risks"),
    # Third-Party Vendor Risk
    "grc.modules.vendor_risk.tpra.api": ("Third-Party Vendor Risk", "Third-Party Risk Assessments"),
    # Compliance
    "grc.routers.compliance_assessments_router": ("Compliance", "Compliance Assessments"),
    "grc.routers.dcc_router": ("Compliance", "Compliance Assessments"),
    "grc.routers.certification_router": ("Compliance", "Certifications"),
    "grc.routers.access_review_router": ("Compliance", "Access Reviews"),
    "grc.routers.controls_router": ("Compliance", "Framework Controls"),
    "grc.routers.evidence_router": ("Compliance", "Evidence Library"),
    "grc.routers.frameworks_router": ("Compliance", "Framework Catalog"),
    "grc.routers.artifacts_router": ("Compliance", "Artifacts"),
    # Auditor Portal
    "grc.routers.audit_plan_router": ("Auditor Portal", "Internal Audit"),
    # Critical Tasks
    "grc.routers.critical_tasks_router": ("Critical Tasks", "Critical Tasks"),
    # Administration
    "grc.routers.admin_router": ("Administration", None),
    "grc.routers.teams_router": ("Administration", "Teams"),
    "grc.routers.tenants_router": ("Administration", "Company"),
    "grc.routers.sso_router": ("Administration", "Identity Providers"),
    "grc.modules.integrations.cloud.router": ("Administration", "Cloud Connectors"),
    "grc.modules.connectors.router": ("Administration", "Connectors"),
    "grc.modules.compliance_plugins.router": ("Administration", "Connections"),
    "grc.modules.agents.router": ("Administration", "Compliance Agents"),
    "grc.routers.connect_wizard_router": ("Administration", "Connect Wizard"),
}
# Machine traffic, not something a person does.
_SKIPPED_ENDPOINTS = {"agent_heartbeat", "agent_results"}
_ROUTES_EXTENDED = False

# "<file>:<function>" (route_events.endpoint_of) → what it does, in the words
# the builder uses ("Edit Risk", "View Risks"), for every route, reads too. An
# audit row names its action with it.
ENDPOINT_LABELS: dict[str, str] = {}


def _label_override_key(module_path: str, fn_name: str) -> tuple:
    parts = module_path.split(".")
    if len(parts) == 5 and parts[:2] == ["grc", "modules"] and parts[3] == "routers":
        return (parts[2], parts[4], fn_name)
    return (module_path, "", fn_name)


def _record_endpoint_labels(app) -> None:
    from fastapi.routing import APIRoute

    node_labels = {f"{n.get('endpoint_module')}:{n.get('fn_name')}": str(n.get("label"))
                   for n in PLATFORM_FUNCTION_NODE_TYPES if n.get("endpoint_module") and n.get("fn_name")}
    for route in getattr(app, "routes", []):
        if not isinstance(route, APIRoute):
            continue
        module_path = getattr(route.endpoint, "__module__", "") or ""
        fn_name = getattr(route.endpoint, "__name__", "") or ""
        endpoint = f"{module_path}:{fn_name}"
        if endpoint in ENDPOINT_LABELS:
            continue
        methods = sorted(m.lower() for m in (route.methods or ()))
        method = next((m for m in methods if m in _MUTATING_METHODS), "get")
        ENDPOINT_LABELS[endpoint] = node_labels.get(endpoint) or _label_for(
            _action_from_http_method_and_path(method, route.path), fn_name,
            _label_override_key(module_path, fn_name))[0]


def _submodule_from_path(path: str) -> str:
    segments = [s for s in (path or "").split("/") if s and not s.startswith("{")]
    return _humanize_slug(segments[1] if len(segments) > 1 else (segments[0] if segments else "general"))


# Sign-in is nobody's workflow, and it is the one route file whose writes are
# not a person doing something to a record.
_SKIPPED_ROUTE_FILES = {"grc.routers.auth_router", "grc.routers.sso_router"}

_ACTION_VERBS = {"create": "Creates", "update": "Updates", "trigger": "Triggers",
                 "upload": "Uploads / imports", "approve": "Approves", "reject": "Rejects",
                 "delete": "Deletes"}


def _sidebar_place(module_path: str, route_path: str,
                   fallback: tuple[str, str]) -> tuple[str, str]:
    """The sidebar page this endpoint serves, from the one map that already
    names audit rows (grc/feature_map.py), so the builder groups its nodes
    exactly like the menu. The fallback covers nodes with no route of their own."""
    module, submodule = place_in_sidebar(module_path, route_path)
    if module == "System":
        return (fallback[0] or "General"), (fallback[1] or _submodule_from_path(route_path))
    return module, submodule


def extend_with_app_routes(app) -> int:
    """Name every Platform Function node after its sidebar page, and add the
    write endpoints the source scanner never saw. Idempotent; returns how many
    were added.

    A node key is an identifier saved workflow graphs store, so keys keep the
    names they were first built from; only what the builder displays moves.
    """
    global _ROUTES_EXTENDED
    if _ROUTES_EXTENDED:
        return 0
    from fastapi.routing import APIRoute

    # (route file, function) → (write method, URL) for every live route.
    routes: dict[tuple[str, str], tuple[str, str]] = {}
    for route in getattr(app, "routes", []):
        if not isinstance(route, APIRoute):
            continue
        module_path = getattr(route.endpoint, "__module__", "") or ""
        fn_name = getattr(route.endpoint, "__name__", "") or ""
        method = next((m.lower() for m in sorted(route.methods or ())
                       if m.lower() in _MUTATING_METHODS), "")
        routes.setdefault((module_path, fn_name), (method, route.path))

    # 1. Re-name what the scanner produced. Two route files can serve one page
    #    (a legacy API beside its replacement), so drop the second node that
    #    ends up saying the same thing on the same page.
    kept: list[dict] = []
    seen_labels: set[tuple[str, str, str]] = set()
    for node in PLATFORM_FUNCTION_NODE_TYPES:
        endpoint_module = str(node.get("endpoint_module") or "")
        _, path = routes.get((endpoint_module, str(node.get("fn_name") or "")),
                             ("", str(node.get("route_path") or "")))
        node["module"], node["submodule"] = _sidebar_place(
            endpoint_module, path,
            (str(node.get("module") or ""), str(node.get("submodule") or "")))
        node["path"] = sidebar_path(node["module"], node["submodule"])
        trio = (node["module"], node["submodule"], str(node.get("label") or ""))
        if trio in seen_labels:
            continue
        seen_labels.add(trio)
        kept.append(node)
    PLATFORM_FUNCTION_NODE_TYPES[:] = kept

    # 2. Add the rest of the platform's writes, so every sidebar page has its
    #    actions in the builder.
    seen = {str(n.get("key")) for n in PLATFORM_FUNCTION_NODE_TYPES}
    covered = {(str(n.get("endpoint_module")), str(n.get("fn_name")))
               for n in PLATFORM_FUNCTION_NODE_TYPES}
    added = 0
    for (module_path, fn_name), (method, path) in routes.items():
        if not method or (module_path, fn_name) in covered:
            continue
        if not module_path.startswith("grc.") or "workflow_engine" in module_path:
            continue
        if module_path in _SKIPPED_ROUTE_FILES or fn_name in _SKIPPED_ENDPOINTS \
                or fn_name.startswith(_READ_LIKE_PREFIXES):
            continue
        action = _action_from_http_method_and_path(method, path)
        if action not in AUTOMATION_RELEVANT_PLATFORM_ACTIONS:
            continue
        frozen = ROUTE_FILE_MODULES.get(module_path)
        module_name, submodule = _sidebar_place(module_path, path, frozen or ("", ""))
        if module_name == "General":
            continue
        label, base_label = _label_for(action, fn_name, (module_path, "", fn_name))
        if (module_name, submodule, label) in seen_labels:
            continue
        key_module, key_sub = frozen or (module_name, submodule)
        key = (f"platform_action.{_slugify(action)}.{_slugify(key_module)}."
               f"{_slugify(key_sub or _submodule_from_path(path))}.{_slugify(base_label)}")
        if key in seen:
            continue
        seen.add(key)
        seen_labels.add((module_name, submodule, label))
        PLATFORM_FUNCTION_NODE_TYPES.append({
            "key": key, "label": label,
            "description": f"{_ACTION_VERBS.get(action, 'Executes')} {base_label.lower()} in {submodule}",
            "endpoint": path, "action": action, "module": module_name, "submodule": submodule,
            "functionality_name": label, "source": "app_routes", "fn_name": fn_name, "method": method,
            "route_path": path, "endpoint_module": module_path,
            "trigger_event": _trigger_event_for(method, fn_name, module_path, label),
            "path": sidebar_path(module_name, submodule),
        })
        added += 1
    PLATFORM_FUNCTION_NODE_TYPES.sort(key=lambda n: (sidebar_rank(n["module"], n["submodule"]), n["label"]))
    _place_triggers({event_name(mp, fn): (mp, path) for (mp, fn), (_, path) in routes.items()})
    _record_endpoint_labels(app)
    _ROUTES_EXTENDED = True
    return added


# ── Named platform events raised by specific endpoints ───────────────────────
# (key, label, module, endpoints, when). An endpoint is "<file>.<function>" as
# route_events names it; `when` narrows it to a request-field value. Keys new
# here are added to TRIGGER_NODE_TYPES; existing ones that nothing raised
# (or raised only from another path) get their endpoints wired.
_EndpointEvent = tuple[str, str, str, tuple[str, ...], Optional[tuple]]

# ── Assessments ──────────────────────────────────────────────────────────────
# Every assessment page, and every assessment inside a hub page, posts to the
# same endpoints and differs only by format. So each event is gated on the page
# the audit row was placed under, or on the format it recorded: a workflow can
# run for OWASP ASVS alone without firing for NCA or DPIA. Keys are stored in
# saved workflows, so the page-level ones keep the names they shipped with.
_ASSESSMENT_PAGES = [  # (key prefix, what it is, the pages its rows are placed under)
    ("cyber_security", "Cyber Security assessment", {"cyber security"}),
    ("nca", "NCA assessment", {"nca"}),
    ("dpia", "DPIA / PIA", {"dpia / pia"}),
    ("pdpl", "Saudi PDPL assessment", {"saudi pdpl"}),
    ("digital_ops", "Digital Operations Maturity assessment", {"digital operations maturity"}),
    ("other", "Other assessment", {"other assessments", "overview"}),
]
_HUB_KEYS = {  # format → key prefix of the assessment inside a hub page
    "asvs_checklist": "owasp_asvs", "owasp_v4_testing_checklist": "owasp_testing",
    "mobile_app_security": "mobile_app_security", "csir_maturity": "csir_maturity",
    "cti_maturity": "cti_maturity", "incident_maturity": "incident_maturity",
    "itsecops_maturity": "itsecops_maturity", "nca_dcc_tool": "nca_dcc",
    "nca_vuln_register": "nca_vulnerability_register", "nca_audit_register": "nca_audit_plan",
    "nca_risk_register": "nca_risk_register",
}
_ASSESSMENT_ENDPOINTS = [  # (key suffix, what happened, endpoint, a further condition)
    ("created", "created", "compliance_assessments_router.upload_assessment", None),
    ("updated", "updated", "compliance_assessments_router.update_assessment", None),
    ("completed", "completed", "compliance_assessments_router.update_assessment",
     ("status", frozenset({"completed", "complete", "closed"}))),
    ("item_updated", "control or question updated", "compliance_assessments_router.update_assessment_item", None),
    ("approval", "evidence approval recorded", "compliance_assessments_router.perform_approval_action", None),
    ("remediation_updated", "remediation item updated", "compliance_assessments_router.update_remediation_item", None),
]


def _assessment_events() -> list:
    kinds = [(prefix, name, ("submodule", frozenset(pages))) for prefix, name, pages in _ASSESSMENT_PAGES]
    kinds += [(_HUB_KEYS[fmt], f"NCA {label}" if hub == "NCA" else f"{label} assessment",
               ("assessment_format", frozenset({fmt})))
              for hub, items in HUB_ASSESSMENTS.items() for fmt, label in items]
    return [(f"{prefix}_assessment_{suffix}", f"{name} {what}", "Assessments", (endpoint,),
             (gate, extra) if extra else gate)
            for prefix, name, gate in kinds for suffix, what, endpoint, extra in _ASSESSMENT_ENDPOINTS]

ENDPOINT_EVENT_TYPES: list[_EndpointEvent] = [
    # ── Controls Automation ───────────────────────────────────────────────
    ("control_test_started", "Control test started", "Controls Automation",
     ("automation.assurance.start_test",), None),
    ("control_test_recorded", "Control test recorded", "Controls Automation",
     ("automation.assurance.record_test",), None),
    ("control_test_concluded", "Control test concluded", "Controls Automation",
     ("automation.assurance.conclude_test",), None),
    ("control_test_signed_off", "Control test signed off", "Controls Automation",
     ("automation.assurance.sign_off_test",), None),
    ("control_test_reopened", "Control test reopened", "Controls Automation",
     ("automation.assurance.reopen_test",), None),
    ("control_maturity_changed", "Control maturity changed", "Controls Automation",
     ("automation.assurance.set_control_maturity",), None),
    ("common_control_evidence_linked", "Evidence linked to a common control", "Controls Automation",
     ("automation.assurance.link_artifact_evidence", "automation.router.link_control_evidence"), None),
    ("common_control_risk_linked", "Risk linked to a common control", "Controls Automation",
     ("automation.router.link_control_risk", "automation.router.create_and_link_control_risk"), None),
    ("common_control_asset_linked", "Asset linked to a common control", "Controls Automation",
     ("automation.router.link_control_asset",), None),
    ("control_mapping_reviewed", "Control mapping reviewed", "Controls Automation",
     ("automation.router.record_mapping_review",), None),
    ("automated_check_run", "Automated control check run", "Controls Automation",
     ("automation.router.run_check", "automation.router.run_all", "automation.router.run_collector"), None),
    ("evidence_collector_connected", "Evidence collector connected", "Controls Automation",
     ("automation.router.connect_collector",), None),
    ("control_applicability_changed", "Control applicability changed", "Controls Automation",
     ("scf.router.set_applicability_override", "scf.router.review_applicability"), None),
    ("control_owner_assigned", "Control owner assigned", "Controls Automation",
     ("scf.router.put_ownership", "scf.router.bulk_ownership"), None),
    ("custom_control_created", "Custom control created", "Controls Automation",
     ("scf.router.create_custom_control",), None),
    ("custom_control_retired", "Custom control retired", "Controls Automation",
     ("scf.router.retire_custom_control",), None),
    ("audit_period_created", "Audit period created", "Controls Automation",
     ("scf.router.create_audit_period",), None),
    ("audit_period_frozen", "Audit period frozen", "Controls Automation",
     ("scf.router.freeze_audit_period_endpoint",), None),
    ("audit_period_closed", "Audit period closed", "Controls Automation",
     ("scf.router.close_audit_period",), None),
    # ── Reports ───────────────────────────────────────────────────────────
    ("report_saved", "Report saved", "Reports", ("reporting_router.upsert_report",), None),
    ("report_deleted", "Saved report deleted", "Reports", ("reporting_router.delete_report",), None),
    ("report_snapshot_captured", "Report trend snapshot captured", "Reports",
     ("reporting_router.capture_snapshot",), None),
    ("report_target_changed", "Report target changed", "Reports",
     ("reporting_router.set_target", "reporting_router.reset_target"), None),
    # ── Cybersecurity Assurance ───────────────────────────────────────────
    ("discovery_campaign_created", "Discovery campaign created", "IT Asset Management",
     ("asset_discovery.router.create_campaign",), None),
    ("discovery_run_started", "Discovery run started", "IT Asset Management",
     ("asset_discovery.router.trigger_run",), None),
    ("discovery_run_cancelled", "Discovery run cancelled", "IT Asset Management",
     ("asset_discovery.router.cancel_run",), None),
    ("discovered_asset_onboarded", "Discovered asset onboarded", "IT Asset Management",
     ("asset_discovery.router.connect_discovered_device", "asset_discovery.router.connect_discovered_service",
      "asset_discovery.router.connect_all_discovered", "asset_discovery.router.connect_selected"), None),
    ("discovered_asset_disconnected", "Discovered asset disconnected", "IT Asset Management",
     ("asset_discovery.router.disconnect_discovered_device",), None),
    ("assets_imported", "Assets imported", "IT Asset Management",
     ("assets_router.upload_assets_file", "onboarding.router.bulk_import", "onboarding.router.ad_onboard"), None),
    ("asset_lifecycle_changed", "Asset lifecycle changed", "IT Asset Management",
     ("assets_router.transition_asset_lifecycle",), None),
    ("asset_risk_assessed", "Asset risk assessed", "IT Asset Management",
     ("assets_router.perform_risk_assessment", "assets_router.assess_asset"), None),
    ("asset_alert_acknowledged", "Asset alert acknowledged", "IT Asset Management",
     ("entity_extras_router.acknowledge_alert",), None),
    ("asset_alert_resolved", "Asset alert resolved", "IT Asset Management",
     ("entity_extras_router.resolve_alert",), None),
    ("criticality_assessment_submitted", "Criticality assessment submitted", "IT Asset Management",
     ("criticality_assessments_router.submit_for_review",), None),
    ("criticality_assessment_approved", "Criticality assessment approved", "IT Asset Management",
     ("criticality_assessments_router.approve_business_owner", "criticality_assessments_router.approve_ciso"), None),
    ("criticality_assessment_returned", "Criticality assessment rejected or returned", "IT Asset Management",
     ("criticality_assessments_router.reject_assessment", "criticality_assessments_router.return_assessment"), None),
    ("vulnerability_scan_started", "Vulnerability scan started", "Vulnerability Management",
     ("integrations.router.trigger_hosted_scan", "integrations.router.trigger_sync"), None),
    ("vulnerability_scan_stopped", "Vulnerability scan stopped", "Vulnerability Management",
     ("integrations.router.stop_hosted_scan",), None),
    ("vulnerability_exception_requested", "Vulnerability exception requested", "Vulnerability Management",
     ("integrations.router.create_exception",), None),
    ("vulnerability_exception_approved", "Vulnerability exception approved", "Vulnerability Management",
     ("integrations.router.approve_exception",), None),
    ("vulnerability_exception_rejected", "Vulnerability exception rejected", "Vulnerability Management",
     ("integrations.router.reject_exception",), None),
    # ── Governance ────────────────────────────────────────────────────────
    ("governance_document_created", "Governance document created", "Governance",
     ("governance.documents.create_document", "governance.documents.create_document_with_file"), None),
    ("governance_document_published", "Governance document published", "Governance",
     ("governance.documents.publish_document",), None),
    ("governance_document_published", "Governance document published", "Governance",
     ("governance.documents.update_document_status",), ("status", frozenset({"published"}))),
    ("project_created", "Project created", "Governance", ("is_projects_router.create_project",), None),
    ("project_updated", "Project updated", "Governance", ("is_projects_router.update_project",), None),
    ("project_deleted", "Project deleted", "Governance", ("is_projects_router.delete_project",), None),
    ("project_status_reported", "Project status update posted", "Governance",
     ("is_projects_router.create_status_update",), None),
    ("project_risk_raised", "Project risk raised", "Governance", ("is_projects_router.create_risk",), None),
    ("project_milestone_added", "Project milestone added", "Governance",
     ("is_projects_router.create_milestone",), None),
    ("project_milestone_updated", "Project milestone updated", "Governance",
     ("is_projects_router.update_milestone",), None),
    ("project_task_created", "Project task created", "Governance", ("is_projects_router.create_task",), None),
    # ── Third-Party Vendor Risk ───────────────────────────────────────────
    ("tpra_lifecycle_started", "Vendor assessment lifecycle started", "Third-Party Risk",
     ("vendor_risk.tpra.api.init_lifecycle",), None),
    ("tpra_stage_advanced", "Vendor assessment moved to the next stage", "Third-Party Risk",
     ("vendor_risk.tpra.api.advance",), None),
    ("tpra_stage_sent_back", "Vendor assessment sent back", "Third-Party Risk",
     ("vendor_risk.tpra.api.send_back",), None),
    ("tpra_gate_decided", "Vendor assessment gate decision", "Third-Party Risk",
     ("vendor_risk.tpra.api.gate_decision",), None),
    ("tpra_finding_raised", "Vendor assessment finding raised", "Third-Party Risk",
     ("vendor_risk.tpra.api.create_finding",), None),
    ("tpra_finding_promoted", "Vendor finding promoted to the risk register", "Third-Party Risk",
     ("vendor_risk.tpra.api.promote_finding",), None),
    ("tpra_remediation_created", "Vendor finding remediation created", "Third-Party Risk",
     ("vendor_risk.tpra.api.create_remediation",), None),
    ("tpra_risk_accepted", "Vendor risk accepted", "Third-Party Risk",
     ("vendor_risk.tpra.api.create_acceptance",), None),
    ("tpra_approval_recorded", "Vendor assessment approval recorded", "Third-Party Risk",
     ("vendor_risk.tpra.api.create_approval",), None),
    ("vendor_contract_created", "Vendor contract created", "Third-Party Risk",
     ("vendor_risk.tpra.api.create_contract",), None),
    ("vendor_monitoring_signal", "Vendor monitoring signal recorded", "Third-Party Risk",
     ("vendor_risk.tpra.api.create_signal",), None),
    ("vendor_reassessment_started", "Vendor reassessment started", "Third-Party Risk",
     ("vendor_risk.tpra.api.reassess",), None),
    # ── Compliance ────────────────────────────────────────────────────────
    ("compliance_assessment_created", "Compliance assessment created", "Compliance",
     ("compliance_assessments_router.upload_assessment", "framework_upload.assessment.create_assessment",
      "dcc_router.initialize_dcc_assessment"), None),
    ("compliance_assessment_completed", "Compliance assessment completed", "Compliance",
     ("compliance_assessments_router.update_assessment", "framework_upload.assessment.update_assessment"),
     ("status", frozenset({"completed", "complete", "closed"}))),
    ("assessment_item_updated", "Assessment item updated", "Compliance",
     ("compliance_assessments_router.update_assessment_item",), None),
    ("assessment_evidence_decided", "Assessment evidence approved or rejected", "Compliance",
     ("compliance_assessments_router.perform_approval_action",), None),
    ("assessment_remediation_updated", "Assessment remediation item updated", "Compliance",
     ("compliance_assessments_router.update_remediation_item",), None),
    ("certification_created", "Certification journey started", "Compliance",
     ("certification_router.create_certification",), None),
    ("certification_updated", "Certification journey updated", "Compliance",
     ("certification_router.update_certification",), None),
    ("certification_control_updated", "Certification control updated", "Compliance",
     ("certification_router.update_control_implementation", "certification_router.update_control_criteria_status"),
     None),
    ("certification_control_assigned", "Certification control assigned", "Compliance",
     ("certification_router.assign_control_implementation",), None),
    ("certification_evidence_reviewed", "Certification evidence reviewed", "Compliance",
     ("certification_router.review_evidence", "certification_router.review_evidence_by_impl_id",
      "certification_router.review_implementation_evidence"), None),
    ("certification_snapshot_taken", "Certification snapshot taken", "Compliance",
     ("certification_router.create_snapshot",), None),
    ("access_review_population_synced", "Access review population synced", "Compliance",
     ("access_review_router.sync_population", "access_review_router.okta_sync", "access_review_router.google_sync",
      "access_review_router.ldap_sync", "access_review_router.sailpoint_sync", "access_review_router.iga_sync",
      "access_review_router.apps_sync", "access_review_router.import_spreadsheet"), None),
    ("access_review_checks_run", "Access review checks run", "Compliance",
     ("access_review_router.run_checks",), None),
    ("access_review_finding_updated", "Access review finding updated", "Compliance",
     ("access_review_router.update_finding",), None),
    ("sod_rule_created", "Segregation-of-duties rule created", "Compliance",
     ("access_review_router.create_sod_rule",), None),
    # ── Auditor Portal ────────────────────────────────────────────────────
    ("audit_plan_entry_created", "Internal audit plan entry added", "Auditor Portal",
     ("audit_plan_router.create_entry",), None),
    ("audit_plan_entry_updated", "Internal audit plan entry updated", "Auditor Portal",
     ("audit_plan_router.update_entry",), None),
    ("audit_observation_created", "Statutory audit observation created", "Auditor Portal",
     ("auditor_portal.statutory_audit.create_observation", "auditor_portal.statutory_audit.confirm_import"), None),
    ("audit_observation_updated", "Statutory audit observation updated", "Auditor Portal",
     ("auditor_portal.statutory_audit.update_observation",), None),
    ("audit_observation_status_changed", "Statutory audit observation status changed", "Auditor Portal",
     ("auditor_portal.statutory_audit.transition_status",), None),
    # ── Critical Tasks ────────────────────────────────────────────────────
    ("critical_task_created", "Critical task created", "Administration",
     ("critical_tasks_router.create_task", "critical_tasks_router.create_task_from_module",
      "critical_tasks_router.create_from_template"), None),
    ("critical_task_status_changed", "Critical task status changed", "Administration",
     ("critical_tasks_router.transition_status",), None),
    ("critical_task_completed", "Critical task completed", "Administration",
     ("critical_tasks_router.transition_status",), ("new_status", frozenset({"completed", "verified"}))),
    ("critical_task_approval_requested", "Critical task approval requested", "Administration",
     ("critical_tasks_router.request_approval",), None),
    ("critical_task_approved", "Critical task approved", "Administration",
     ("critical_tasks_router.approve_task",), None),
    ("critical_task_rejected", "Critical task rejected", "Administration",
     ("critical_tasks_router.reject_task",), None),
    # ── Administration ────────────────────────────────────────────────────
    ("user_deleted", "User deleted", "Administration", ("admin_router.delete_user",), None),
    ("role_deleted", "Role deleted", "Administration", ("admin_router.delete_role",), None),
    ("team_created", "Team created", "Administration", ("teams_router.create_team",), None),
    ("team_updated", "Team updated", "Administration", ("teams_router.update_team",), None),
    ("team_member_added", "Team member added", "Administration", ("teams_router.add_member",), None),
    ("team_member_removed", "Team member removed", "Administration", ("teams_router.remove_member",), None),
    ("company_settings_updated", "Company settings updated", "Administration",
     ("admin_router.update_organization_profile", "tenants_router.update_tenant"), None),
    ("business_unit_created", "Business unit created", "Administration",
     ("tenants_router.create_business_unit",), None),
    ("ai_budget_updated", "AI token budget changed", "Administration",
     ("admin_router.update_ai_usage_budgets",), None),
    ("identity_provider_configured", "Identity provider configured", "Administration",
     ("sso_router.update_config",), None),
    ("identity_provider_removed", "Identity provider removed", "Administration",
     ("sso_router.delete_config",), None),
    ("sso_users_provisioned", "Users provisioned from the identity provider", "Administration",
     ("sso_router.provision_users",), None),
    ("integration_connected", "Integration connection added", "Administration",
     ("integrations.router.create_connection",), None),
    ("integration_removed", "Integration connection removed", "Administration",
     ("integrations.router.delete_connection",), None),
    ("cloud_connector_added", "Cloud connector added", "Administration",
     ("integrations.cloud.router.create_connector",), None),
    ("cloud_connector_synced", "Cloud connector synced", "Administration",
     ("integrations.cloud.router.sync_connector_now", "integrations.cloud.router.sync_all_connectors"), None),
    ("connector_added", "Connector added", "Administration", ("connectors.router.create_connector",), None),
    ("connector_synced", "Connector synced", "Administration", ("connectors.router.sync_connector",), None),
    ("connection_scope_changed", "Evidence connection scope changed", "Administration",
     ("compliance_plugins.router.update_connection_scope",), None),
    ("agent_revoked", "Compliance agent revoked", "Administration", ("agents.router.revoke_agent",), None),
    # Sign-in. A refused sign-in is a failed request, which never raises an
    # endpoint event: the dispatcher raises sign_in_failed for it.
    ("user_signed_in", "User signed in", "Administration", ("auth_router.login",), None),
    ("user_signed_out", "User signed out", "Administration", ("auth_router.logout",), None),
    # ── Issue Management: CAPA ────────────────────────────────────────────
    ("capa_action_created", "CAPA action created", "Issue Management",
     ("issue_management.actions.create_action",), None),
    ("capa_action_completed", "CAPA action completed", "Issue Management",
     ("issue_management.actions.verify_action",), None),
    ("capa_action_promoted", "CAPA action promoted to a critical task", "Issue Management",
     ("issue_management.actions.promote_action_to_task",), None),
    ("assessment_status_change", "Assessment approval recorded (any type)", "Assessments",
     ("compliance_assessments_router.perform_approval_action",), None),
    *_assessment_events(),
]

# "api.<endpoint>" → [(trigger key, condition or None)] for the dispatcher. A
# condition is (field, values), or a tuple of them that must all hold.
ENDPOINT_TRIGGERS: dict[str, list[tuple[str, Optional[tuple]]]] = {}
for _key, _label, _module, _endpoints, _when in ENDPOINT_EVENT_TYPES:
    for _endpoint in _endpoints:
        ENDPOINT_TRIGGERS.setdefault(f"api.{_endpoint}", []).append((_key, _when))

_known_triggers = {t["key"] for t in TRIGGER_NODE_TYPES}
for _key, _label, _module, _endpoints, _when in ENDPOINT_EVENT_TYPES:
    if _key not in _known_triggers:
        _known_triggers.add(_key)
        TRIGGER_NODE_TYPES.append({"key": _key, "label": _label, "module": _module})


# ── Dates reached ────────────────────────────────────────────────────────────
# Events nothing writes: a due, expiry or review date arriving. The dispatcher
# checks each once a minute (_check_due_dates) and raises the event once per
# record and date. `when`: "overdue" — the date has passed; "soon" — it falls
# within `days` and hasn't passed; "upcoming" — within `days`, or passed.
# `done` are status values (lower-cased) that end the wait.
_WORK_DONE = frozenset({
    "completed", "complete", "done", "closed", "cancelled", "canceled", "verified", "resolved", "fixed",
    "remediated", "accepted", "risk_accepted", "false_positive", "approved", "rejected", "archived",
    "deprecated", "inactive", "not_applicable", "skipped", "retired", "superseded", "achieved", "met",
})
_LAPSE_DONE = frozenset({
    "archived", "retired", "superseded", "revoked", "rejected", "expired", "cancelled", "canceled",
    "closed", "inactive", "deleted", "deprecated", "offboarded", "terminated",
})
_DueEvent = tuple[str, str, Optional[str], str, str, str, int, frozenset]
DUE_DATE_EVENTS: list[_DueEvent] = [
    # (key, label, module, model, date column, when, days, done statuses)
    ("evidence_expires", "Evidence expires", None, "Evidence", "expiry_date", "upcoming", 30, _LAPSE_DONE),
    ("control_review_due", "Control effectiveness review due", None,
     "InternalControl", "review_date", "upcoming", 14, _LAPSE_DONE),
    ("internal_control_test_due", "Internal control test due", "Risk Management",
     "InternalControl", "next_test_date", "upcoming", 14, _LAPSE_DONE),
    ("attestation_overdue", "Attestation campaign overdue", None,
     "AttestationCampaign", "due_date", "overdue", 0, _WORK_DONE),
    ("committee_action_overdue", "Committee action overdue", None,
     "OversightAction", "due_date", "overdue", 0, _WORK_DONE),
    ("mitigation_action_overdue", "Mitigation action overdue", None,
     "RiskMitigationAction", "due_date", "overdue", 0, _WORK_DONE),
    ("critical_task_overdue", "Critical task overdue", None, "CriticalTask", "due_date", "overdue", 0, _WORK_DONE),
    ("vulnerability_sla_warning", "Vulnerability SLA warning (approaching)", None,
     "Vulnerability", "due_date", "soon", 7, _WORK_DONE),
    ("vulnerability_sla_breach", "Vulnerability SLA breached", None,
     "Vulnerability", "due_date", "overdue", 0, _WORK_DONE),
    ("capa_action_overdue", "CAPA action overdue", "Issue Management", "IssueAction", "due_date", "overdue", 0, _WORK_DONE),
    ("risk_review_due", "Risk review date approaching", "Risk Management", "Risk", "review_date", "upcoming", 14,
     frozenset({"closed", "archived", "retired"})),
    ("risk_review_overdue", "Risk review overdue", "Risk Management", "RiskReview", "due_date", "overdue", 0, _WORK_DONE),
    ("rcsa_campaign_overdue", "RCSA campaign overdue", "Risk Management", "RCSACampaign", "due_date", "overdue", 0, _WORK_DONE),
    ("kri_measurement_due", "KRI measurement due", "Risk Management", "RiskKRI", "next_due_date", "upcoming", 3, frozenset()),
    ("policy_exception_expiring", "Policy exception expiring", "Governance",
     "PolicyException", "expiry_date", "upcoming", 30, _LAPSE_DONE | {"draft"}),
    ("policy_exception_expiring", "Policy exception expiring", "Governance",
     "Exception", "expiry_date", "upcoming", 30, _LAPSE_DONE | {"pending"}),
    ("committee_charter_expiring", "Committee charter expiring", "Governance",
     "CommitteeCharter", "expiry_date", "upcoming", 30, _LAPSE_DONE | {"draft"}),
    ("project_task_overdue", "Project task overdue", "Governance", "ISProjectTask", "due_date", "overdue", 0, _WORK_DONE),
    ("project_milestone_overdue", "Project milestone overdue", "Governance",
     "ISProjectMilestone", "target_date", "overdue", 0, _WORK_DONE),
    ("vendor_reassessment_due", "Vendor reassessment due", "Third-Party Risk",
     "Vendor", "next_reassessment_date", "upcoming", 30, _LAPSE_DONE),
    ("vendor_contract_expiring", "Vendor contract ending", "Third-Party Risk",
     "Vendor", "contract_end_date", "upcoming", 30, _LAPSE_DONE),
    ("vendor_assessment_overdue", "Vendor assessment overdue", "Third-Party Risk",
     "VendorAssessment", "due_date", "overdue", 0, _WORK_DONE),
    ("tpra_contract_expiring", "Third-party contract expiring", "Third-Party Risk",
     "TPRAContract", "expiry_date", "upcoming", 30, _LAPSE_DONE | {"draft"}),
    ("tpra_remediation_overdue", "Third-party remediation overdue", "Third-Party Risk",
     "TPRARemediation", "due_date", "overdue", 0, _WORK_DONE),
    ("access_review_overdue", "Access review campaign overdue", "Compliance",
     "AccessReviewCampaign", "due_date", "overdue", 0, _WORK_DONE | {"draft"}),
    ("regulatory_task_overdue", "Regulatory task overdue", "Compliance",
     "RegulatoryImplementationTask", "due_date", "overdue", 0, _WORK_DONE),
    ("compliance_assessment_due", "Compliance assessment due date approaching", "Compliance",
     "ComplianceAssessmentDocument", "due_date", "upcoming", 14, _WORK_DONE),
    ("nca_vulnerability_overdue", "NCA vulnerability overdue", "Compliance", "NcaVulnEntry", "due_date", "overdue", 0,
     _WORK_DONE),
    ("audit_observation_overdue", "Statutory audit observation overdue", "Auditor Portal",
     "AuditObservation", "due_date", "overdue", 0, _WORK_DONE),
    ("bcm_plan_review_due", "BCM plan review due", "BCM", "BcmPlan", "next_review_due", "upcoming", 30, _LAPSE_DONE),
    ("control_test_due", "Common control test due", "Controls Automation",
     "SCFControlState", "next_due_at", "upcoming", 14, _LAPSE_DONE | {"not_applicable", "out_of_scope"}),
]
for _key, _label, _module, *_rest in DUE_DATE_EVENTS:
    if _key not in _known_triggers:
        _known_triggers.add(_key)
        TRIGGER_NODE_TYPES.append({"key": _key, "label": _label, **({"module": _module} if _module else {})})

# Raised by the dispatcher from a refused sign-in's audit row (a failed request
# never raises its endpoint's event).
TRIGGER_NODE_TYPES.append({"key": "sign_in_failed", "label": "Sign-in failed", "module": "Administration"})


# ── Where each trigger sits in the sidebar ───────────────────────────────────
# The builder lists triggers as the sidebar does, module → page → assessment.
# An event an endpoint raises sits on that endpoint's page (the one map that names
# audit rows); a date event on its record's page; the rest by how their name
# begins, first match first.
_DUE_PLACES: dict[str, tuple] = {
    "Evidence": ("Compliance Management", "Evidence Management"),
    "InternalControl": ("Risk Management", "Internal Controls"),
    "AttestationCampaign": ("Governance", "Attestations"),
    "OversightAction": ("Governance", "Committees"),
    "CommitteeCharter": ("Governance", "Committees"),
    "RiskMitigationAction": ("Risk Management", "Mitigation Actions"),
    "CriticalTask": ("Critical Tasks", "Critical Tasks"),
    "Vulnerability": ("Cybersecurity Assurance", "Vulnerabilities"),
    "IssueAction": ("Issue & Incident Management", "Issues"),
    "Risk": ("Risk Management", "Risk Register"),
    "RiskReview": ("Risk Management", "Risk Reviews"),
    "RCSACampaign": ("Risk Management", "RCSA"),
    "RiskKRI": ("Governance", "KRIs"),
    "PolicyException": ("Governance", "Policy Exceptions"),
    "Exception": ("Governance", "Policy Exceptions"),
    "ISProjectTask": ("Governance", "Projects"),
    "ISProjectMilestone": ("Governance", "Projects"),
    "Vendor": ("Third-Party Vendor Risk", "Vendors"),
    "VendorAssessment": ("Third-Party Vendor Risk", "Vendor Assessments"),
    "TPRAContract": ("Third-Party Vendor Risk", "Third-Party Risk Assessments"),
    "TPRARemediation": ("Third-Party Vendor Risk", "Third-Party Risk Assessments"),
    "AccessReviewCampaign": ("Compliance Management", "Access Reviews"),
    "RegulatoryImplementationTask": ("Compliance Management", "Regulatory Changes"),
    "ComplianceAssessmentDocument": ("Assessments", "Overview"),
    "NcaVulnEntry": ("Assessments", "NCA", "Vulnerability Register"),
    "AuditObservation": ("Auditor Portal", "Statutory Audit"),
    "BcmPlan": ("Business Continuity", "Continuity Plans"),
    "SCFControlState": ("Controls Automation", "Common Controls"),
}
_KEY_PLACES: list[tuple[str, tuple]] = [
    ("manual_trigger", ("Administration", "Workflow Engine")),
    ("schedule_recurring", ("Administration", "Workflow Engine")),
    ("webhook", ("Administration", "Workflow Engine")),
    ("evidence_", ("Compliance Management", "Evidence Management")),
    ("audit_package", ("Compliance Management", "Evidence Management")),
    ("framework_", ("Compliance Management", "Frameworks")),
    ("compliance_gap", ("Compliance Management", "Frameworks")),
    ("certification_", ("Compliance Management", "Certifications")),
    ("access_review", ("Compliance Management", "Access Reviews")),
    ("regulatory_", ("Compliance Management", "Regulatory Changes")),
    ("compliance_assessment", ("Assessments", "Overview")),
    ("assessment_", ("Assessments", "Overview")),
    ("risk_assessment", ("Risk Management", "Risk Assessments")),
    ("risk_review", ("Risk Management", "Risk Reviews")),
    ("risk_", ("Risk Management", "Risk Register")),
    ("rcsa_", ("Risk Management", "RCSA")),
    ("internal_control", ("Risk Management", "Internal Controls")),
    ("control_review", ("Risk Management", "Internal Controls")),
    ("mitigation_action", ("Risk Management", "Mitigation Actions")),
    ("appetite_", ("Risk Management", "Risk Appetite")),
    ("kri_", ("Governance", "KRIs")),
    ("kpi_", ("Governance", "KPI Report")),
    ("governance_document", ("Governance", "Documents")),
    ("document_", ("Governance", "Documents")),
    ("policy_exception", ("Governance", "Policy Exceptions")),
    ("policy_", ("Governance", "Documents")),
    ("attestation_", ("Governance", "Attestations")),
    ("committee_", ("Governance", "Committees")),
    ("incident_", ("Issue & Incident Management", "Incidents")),
    ("issue_", ("Issue & Incident Management", "Issues")),
    ("capa_", ("Issue & Incident Management", "Issues")),
    ("new_vulnerability", ("Cybersecurity Assurance", "Vulnerabilities")),
    ("vulnerability_", ("Cybersecurity Assurance", "Vulnerabilities")),
    ("asset_", ("Cybersecurity Assurance", "IT Asset Inventory")),
    ("audit_review", ("Auditor Portal", "Portal")),
    ("audit_control", ("Auditor Portal", "Portal")),
    ("audit_", ("Auditor Portal", "Issue Register")),
    ("vendor_assessment", ("Third-Party Vendor Risk", "Vendor Assessments")),
    ("vendor_questionnaire", ("Third-Party Vendor Risk", "Questionnaires")),
    ("vendor_", ("Third-Party Vendor Risk", "Vendors")),
    ("bcm_drill", ("Business Continuity", "Drills & Invocations")),
    ("bcm_", ("Business Continuity", "Continuity Plans")),
    ("cis_", ("Administration", "Compliance Agents")),
    ("agent_", ("Administration", "Compliance Agents")),
    ("connection_", ("Administration", "Connections")),
    ("user_", ("Administration", "User Management")),
    ("role_", ("Administration", "Role Management")),
    ("password_", ("Administration", "Password Policy")),
    ("sign_in", ("Administration", "Sign-in")),
    ("critical_task", ("Critical Tasks", "Critical Tasks")),
]
_HUB_OF = {fmt: (hub, label) for hub, items in HUB_ASSESSMENTS.items() for fmt, label in items}


def _conditions(when: Optional[tuple]) -> list:
    return list(when) if when and isinstance(when[0], tuple) else ([when] if when else [])


def _refine(module: str, page: str, when: Optional[tuple]) -> tuple:
    """The assessment page, or the assessment inside a hub page, an event is gated on."""
    leaf = None
    for field, values in _conditions(when):
        if field == "submodule":
            page = next((p for p in ("Other Assessments", *PAGE_ORDER["Assessments"]) if p.lower() in values), page)
        elif field == "assessment_format":
            page, leaf = _HUB_OF.get(next(iter(values)), (page, None))
    return module, page, leaf


def _place_triggers(routes_by_event: dict) -> None:
    """Give every trigger its sidebar module, page and path, and list them in menu order."""
    placed: dict[str, tuple] = {}
    for key, _label, _module, endpoints, when in ENDPOINT_EVENT_TYPES:
        route = next((routes_by_event[f"api.{e}"] for e in endpoints if f"api.{e}" in routes_by_event), None)
        if key in placed or route is None:
            continue
        module, page = _sidebar_place(route[0], route[1], ("", ""))
        if module not in ("", "General"):
            placed[key] = _refine(module, page, when)
    for key, _label, _module, model, *_ in DUE_DATE_EVENTS:
        if key not in placed and model in _DUE_PLACES:
            placed[key] = _DUE_PLACES[model]
    for trig in TRIGGER_NODE_TYPES:
        key = trig["key"]
        place = placed.get(key) or next((p for prefix, p in _KEY_PLACES if key.startswith(prefix)), None)
        if place is None:
            continue
        module, page, leaf = (*place, None, None)[:3]
        trig.update(module=module, submodule=page, path=sidebar_path(module, page, leaf))
        if leaf:
            trig["leaf"] = leaf
    last = ((len(TRIGGER_NODE_TYPES), ""),)
    TRIGGER_NODE_TYPES.sort(key=lambda t: (
        sidebar_rank(t["module"], t.get("submodule"), t.get("leaf")) if t.get("path") else last, t["label"]))


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
