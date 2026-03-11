TRIGGER_NODE_TYPES = [
    {"key": "governance.policy_draft.created", "label": "Policy draft created"},
    {"key": "governance.documents.create", "label": "Governance policy draft created"},
    {"key": "governance.documents.file_uploaded", "label": "Governance document file uploaded"},
    {"key": "evidence.items.uploaded", "label": "Evidence uploaded"},
    {"key": "evidence.items.create", "label": "Evidence uploaded/created"},
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
    {"key": "reviewer", "label": "Reviewer node"},
    {"key": "approver", "label": "Approver node"},
    {"key": "escalation", "label": "Escalation node"},
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
