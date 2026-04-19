'use client';

import { Search, X, Zap } from 'lucide-react';
import { useState } from 'react';
import { BackendEdge, BackendNode, WorkflowTemplate } from './types';

type Props = {
  templates: WorkflowTemplate[];
  onClose: () => void;
  onUse: (templateId: number) => void;
};

const CATEGORY_COLORS: Record<string, string> = {
  'Incident Response': 'bg-red-100 text-red-700',
  'Risk Management': 'bg-orange-100 text-orange-700',
  'Policy': 'bg-blue-100 text-blue-700',
  'Access Review': 'bg-violet-100 text-violet-700',
  'Vendor Onboarding': 'bg-teal-100 text-teal-700',
  'Compliance': 'bg-green-100 text-green-700',
  'Audit': 'bg-yellow-100 text-yellow-700',
  'Vulnerability Management': 'bg-red-100 text-red-800',
  'Asset Management': 'bg-slate-100 text-slate-700',
};

// ─── System Template Graphs ──────────────────────────────────────────────────

const incidentResponseNodes: BackendNode[] = [
  { node_key: 'start', node_type: 'trigger', name: 'Incident Reported', config: { trigger_type: 'incident_reported' }, is_start: true, x: 350, y: 30 },
  { node_key: 'check_severity', node_type: 'condition', name: 'Check Severity', config: { condition_type: 'check_risk_level', field: 'severity', thresholds: { critical: 9, high: 7, medium: 4 } }, x: 350, y: 160 },
  { node_key: 'escalate', node_type: 'action', name: 'Escalate to Management', config: { action_name: 'escalate_to_management', message: 'Critical/High severity incident requires immediate attention' }, x: 100, y: 300 },
  { node_key: 'notify_team', node_type: 'action', name: 'Notify Response Team', config: { action_name: 'send_notification_email', subject: 'Incident Alert', body: 'An incident has been reported and requires your attention.' }, x: 600, y: 300 },
  { node_key: 'approval', node_type: 'approval', name: 'Manager Approval', config: { approval_type: 'single', timeout_hours: 4, timeout_action: 'auto_approve' }, x: 100, y: 440 },
  { node_key: 'collect_evidence', node_type: 'action', name: 'Collect Evidence', config: { action_name: 'request_evidence_upload', evidence_type: 'incident_artifacts', description: 'Upload incident-related evidence and logs' }, x: 350, y: 440 },
  { node_key: 'sla_timer', node_type: 'timer', name: 'Resolution SLA (24h)', config: { timer_type: 'sla_countdown', duration_hours: 24, on_breach: 'escalate' }, x: 350, y: 570 },
  { node_key: 'generate_report', node_type: 'action', name: 'Generate Incident Report', config: { action_name: 'generate_report', report_type: 'incident_summary' }, x: 350, y: 700 },
  { node_key: 'end', node_type: 'end', name: 'End', config: {}, is_terminal: true, x: 350, y: 830 },
];

const incidentResponseEdges: BackendEdge[] = [
  { source_node_key: 'start', target_node_key: 'check_severity', condition: { _label: '' } },
  { source_node_key: 'check_severity', target_node_key: 'escalate', condition: { _label: 'Critical / High', _handle: 'condition-true' } },
  { source_node_key: 'check_severity', target_node_key: 'notify_team', condition: { _label: 'Medium / Low', _handle: 'condition-false' } },
  { source_node_key: 'escalate', target_node_key: 'approval' },
  { source_node_key: 'approval', target_node_key: 'collect_evidence', condition: { _label: 'Approved' } },
  { source_node_key: 'notify_team', target_node_key: 'collect_evidence', condition: { _label: '' } },
  { source_node_key: 'collect_evidence', target_node_key: 'sla_timer' },
  { source_node_key: 'sla_timer', target_node_key: 'generate_report' },
  { source_node_key: 'generate_report', target_node_key: 'end' },
];

const vendorOnboardingNodes: BackendNode[] = [
  { node_key: 'start', node_type: 'trigger', name: 'Start Onboarding', config: { trigger_type: 'manual_trigger' }, is_start: true, x: 350, y: 30 },
  { node_key: 'create_risk', node_type: 'action', name: 'Create Vendor Risk Entry', config: { action_name: 'create_risk_entry', category: 'vendor', description: 'Assess vendor risk profile' }, x: 350, y: 160 },
  { node_key: 'request_docs', node_type: 'action', name: 'Request Vendor Documents', config: { action_name: 'request_evidence_upload', evidence_type: 'vendor_documents', description: 'SOC2, ISO27001 certs, security questionnaire' }, x: 350, y: 290 },
  { node_key: 'check_risk', node_type: 'condition', name: 'Evaluate Risk Score', config: { condition_type: 'check_risk_level', field: 'risk_score', thresholds: { high: 7, medium: 4 } }, x: 350, y: 420 },
  { node_key: 'multi_approval', node_type: 'approval', name: 'Executive Approval', config: { approval_type: 'multi_level', levels: ['Security Lead', 'VP Operations'], timeout_hours: 48 }, x: 100, y: 560 },
  { node_key: 'single_approval', node_type: 'approval', name: 'Manager Approval', config: { approval_type: 'single', timeout_hours: 24 }, x: 600, y: 560 },
  { node_key: 'assign_owner', node_type: 'action', name: 'Assign Vendor Owner', config: { action_name: 'assign_control_owner' }, x: 350, y: 700 },
  { node_key: 'notify_complete', node_type: 'action', name: 'Send Onboarding Complete', config: { action_name: 'send_notification_email', subject: 'Vendor Onboarding Complete', body: 'Vendor has been successfully onboarded.' }, x: 350, y: 830 },
  { node_key: 'end', node_type: 'end', name: 'End', config: {}, is_terminal: true, x: 350, y: 960 },
];

const vendorOnboardingEdges: BackendEdge[] = [
  { source_node_key: 'start', target_node_key: 'create_risk' },
  { source_node_key: 'create_risk', target_node_key: 'request_docs' },
  { source_node_key: 'request_docs', target_node_key: 'check_risk' },
  { source_node_key: 'check_risk', target_node_key: 'multi_approval', condition: { _label: 'High Risk', _handle: 'condition-true' } },
  { source_node_key: 'check_risk', target_node_key: 'single_approval', condition: { _label: 'Medium / Low', _handle: 'condition-false' } },
  { source_node_key: 'multi_approval', target_node_key: 'assign_owner', condition: { _label: 'Approved' } },
  { source_node_key: 'single_approval', target_node_key: 'assign_owner', condition: { _label: 'Approved' } },
  { source_node_key: 'assign_owner', target_node_key: 'notify_complete' },
  { source_node_key: 'notify_complete', target_node_key: 'end' },
];

const policyApprovalNodes: BackendNode[] = [
  { node_key: 'start', node_type: 'trigger', name: 'Policy Review Due', config: { trigger_type: 'policy_review_due' }, is_start: true, x: 350, y: 30 },
  { node_key: 'notify_author', node_type: 'action', name: 'Notify Policy Author', config: { action_name: 'send_notification_email', subject: 'Policy Review Required', body: 'A policy under your ownership is due for review.' }, x: 350, y: 160 },
  { node_key: 'wait_review', node_type: 'timer', name: 'Wait for Draft (72h)', config: { timer_type: 'wait_duration', duration_hours: 72 }, x: 350, y: 290 },
  { node_key: 'multi_approval', node_type: 'approval', name: 'Multi-Level Review', config: { approval_type: 'multi_level', levels: ['Department Head', 'Legal', 'CISO'], timeout_hours: 72, timeout_action: 'delegate' }, x: 350, y: 420 },
  { node_key: 'check_approval', node_type: 'condition', name: 'Check Approval Outcome', config: { condition_type: 'check_approval_status' }, x: 350, y: 560 },
  { node_key: 'publish_notify', node_type: 'action', name: 'Publish & Notify Staff', config: { action_name: 'send_notification_email', subject: 'Updated Policy Published', body: 'A revised policy has been published. Please review and acknowledge.' }, x: 100, y: 700 },
  { node_key: 'reject_notify', node_type: 'action', name: 'Send Rejection Notice', config: { action_name: 'send_notification_email', subject: 'Policy Review Rejected', body: 'Your policy submission has been rejected. Please revise and resubmit.' }, x: 600, y: 700 },
  { node_key: 'generate_report', node_type: 'action', name: 'Generate Policy Report', config: { action_name: 'generate_report', report_type: 'policy_review_summary' }, x: 350, y: 830 },
  { node_key: 'end', node_type: 'end', name: 'End', config: {}, is_terminal: true, x: 350, y: 960 },
];

const policyApprovalEdges: BackendEdge[] = [
  { source_node_key: 'start', target_node_key: 'notify_author' },
  { source_node_key: 'notify_author', target_node_key: 'wait_review' },
  { source_node_key: 'wait_review', target_node_key: 'multi_approval' },
  { source_node_key: 'multi_approval', target_node_key: 'check_approval' },
  { source_node_key: 'check_approval', target_node_key: 'publish_notify', condition: { _label: 'Approved', _handle: 'condition-true' } },
  { source_node_key: 'check_approval', target_node_key: 'reject_notify', condition: { _label: 'Rejected', _handle: 'condition-false' } },
  { source_node_key: 'publish_notify', target_node_key: 'generate_report' },
  { source_node_key: 'reject_notify', target_node_key: 'generate_report' },
  { source_node_key: 'generate_report', target_node_key: 'end' },
];

const accessReviewNodes: BackendNode[] = [
  { node_key: 'start', node_type: 'trigger', name: 'Quarterly Schedule', config: { trigger_type: 'schedule_recurring', schedule: 'quarterly' }, is_start: true, x: 350, y: 30 },
  { node_key: 'notify_managers', node_type: 'action', name: 'Notify All Managers', config: { action_name: 'send_notification_email', subject: 'Quarterly Access Review Campaign', body: 'Please review and certify access for your team members.' }, x: 350, y: 160 },
  { node_key: 'check_role', node_type: 'condition', name: 'Check User Role', config: { condition_type: 'check_user_role', required_roles: ['manager', 'admin'] }, x: 350, y: 290 },
  { node_key: 'approval', node_type: 'approval', name: 'Manager Certification', config: { approval_type: 'single', timeout_hours: 120, timeout_action: 'auto_reject' }, x: 350, y: 420 },
  { node_key: 'sla_timer', node_type: 'timer', name: 'Review SLA (5 days)', config: { timer_type: 'sla_countdown', duration_hours: 120, on_breach: 'escalate' }, x: 350, y: 550 },
  { node_key: 'check_result', node_type: 'condition', name: 'Check Certification', config: { condition_type: 'check_approval_status' }, x: 350, y: 680 },
  { node_key: 'notify_complete', node_type: 'action', name: 'Certification Complete', config: { action_name: 'send_notification_email', subject: 'Access Review Certified', body: 'Access has been certified for this review cycle.' }, x: 100, y: 820 },
  { node_key: 'escalate', node_type: 'action', name: 'Escalate Non-Response', config: { action_name: 'escalate_to_management', message: 'Access review was not completed within the SLA window.' }, x: 600, y: 820 },
  { node_key: 'generate_report', node_type: 'action', name: 'Generate Access Report', config: { action_name: 'generate_report', report_type: 'access_review_summary' }, x: 350, y: 960 },
  { node_key: 'end', node_type: 'end', name: 'End', config: {}, is_terminal: true, x: 350, y: 1090 },
];

const accessReviewEdges: BackendEdge[] = [
  { source_node_key: 'start', target_node_key: 'notify_managers' },
  { source_node_key: 'notify_managers', target_node_key: 'check_role' },
  { source_node_key: 'check_role', target_node_key: 'approval', condition: { _label: 'Authorized', _handle: 'condition-true' } },
  { source_node_key: 'approval', target_node_key: 'sla_timer' },
  { source_node_key: 'sla_timer', target_node_key: 'check_result' },
  { source_node_key: 'check_result', target_node_key: 'notify_complete', condition: { _label: 'Certified', _handle: 'condition-true' } },
  { source_node_key: 'check_result', target_node_key: 'escalate', condition: { _label: 'Not Certified', _handle: 'condition-false' } },
  { source_node_key: 'notify_complete', target_node_key: 'generate_report' },
  { source_node_key: 'escalate', target_node_key: 'generate_report' },
  { source_node_key: 'generate_report', target_node_key: 'end' },
];

const riskAssessmentNodes: BackendNode[] = [
  { node_key: 'start', node_type: 'trigger', name: 'Risk Threshold Exceeded', config: { trigger_type: 'risk_score_exceeds_threshold', threshold: 7 }, is_start: true, x: 350, y: 30 },
  { node_key: 'create_risk', node_type: 'action', name: 'Log Risk Entry', config: { action_name: 'create_risk_entry', description: 'Auto-generated risk entry from threshold breach' }, x: 350, y: 160 },
  { node_key: 'check_level', node_type: 'condition', name: 'Evaluate Risk Level', config: { condition_type: 'check_risk_level', thresholds: { critical: 9, high: 7 } }, x: 350, y: 290 },
  { node_key: 'escalate', node_type: 'action', name: 'Escalate to Management', config: { action_name: 'escalate_to_management', message: 'Critical risk identified, requires executive review' }, x: 100, y: 420 },
  { node_key: 'assign_owner', node_type: 'action', name: 'Assign Risk Owner', config: { action_name: 'assign_control_owner' }, x: 600, y: 420 },
  { node_key: 'sla_timer', node_type: 'timer', name: 'Treatment SLA (48h)', config: { timer_type: 'sla_countdown', duration_hours: 48, on_breach: 'escalate' }, x: 350, y: 560 },
  { node_key: 'approval', node_type: 'approval', name: 'Treatment Plan Approval', config: { approval_type: 'single', timeout_hours: 24 }, x: 350, y: 690 },
  { node_key: 'request_evidence', node_type: 'action', name: 'Request Mitigation Evidence', config: { action_name: 'request_evidence_upload', evidence_type: 'risk_mitigation', description: 'Upload evidence of risk mitigation actions taken' }, x: 350, y: 820 },
  { node_key: 'notify_closure', node_type: 'action', name: 'Notify Risk Closure', config: { action_name: 'send_notification_email', subject: 'Risk Assessment Complete', body: 'Risk treatment has been reviewed and documented.' }, x: 350, y: 950 },
  { node_key: 'end', node_type: 'end', name: 'End', config: {}, is_terminal: true, x: 350, y: 1080 },
];

const riskAssessmentEdges: BackendEdge[] = [
  { source_node_key: 'start', target_node_key: 'create_risk' },
  { source_node_key: 'create_risk', target_node_key: 'check_level' },
  { source_node_key: 'check_level', target_node_key: 'escalate', condition: { _label: 'Critical', _handle: 'condition-true' } },
  { source_node_key: 'check_level', target_node_key: 'assign_owner', condition: { _label: 'High / Medium', _handle: 'condition-false' } },
  { source_node_key: 'escalate', target_node_key: 'sla_timer' },
  { source_node_key: 'assign_owner', target_node_key: 'sla_timer' },
  { source_node_key: 'sla_timer', target_node_key: 'approval' },
  { source_node_key: 'approval', target_node_key: 'request_evidence', condition: { _label: 'Approved' } },
  { source_node_key: 'request_evidence', target_node_key: 'notify_closure' },
  { source_node_key: 'notify_closure', target_node_key: 'end' },
];

const complianceGapNodes: BackendNode[] = [
  { node_key: 'start', node_type: 'trigger', name: 'Assessment Status Changed', config: { trigger_type: 'assessment_status_change' }, is_start: true, x: 350, y: 30 },
  { node_key: 'check_compliance', node_type: 'condition', name: 'Check Compliance Status', config: { condition_type: 'check_compliance_status', expected: ['non_compliant', 'partially_compliant'] }, x: 350, y: 160 },
  { node_key: 'assign_owner', node_type: 'action', name: 'Assign Remediation Owner', config: { action_name: 'assign_control_owner' }, x: 350, y: 300 },
  { node_key: 'notify_gap', node_type: 'action', name: 'Notify Gap Identified', config: { action_name: 'send_notification_email', subject: 'Compliance Gap Detected', body: 'A compliance gap has been identified and assigned for remediation.' }, x: 350, y: 430 },
  { node_key: 'request_evidence', node_type: 'action', name: 'Request Remediation Evidence', config: { action_name: 'request_evidence_upload', evidence_type: 'remediation', description: 'Upload evidence of remediation actions taken' }, x: 350, y: 560 },
  { node_key: 'wait_remediation', node_type: 'timer', name: 'Wait for Remediation (7d)', config: { timer_type: 'wait_duration', duration_hours: 168 }, x: 350, y: 690 },
  { node_key: 'check_evidence', node_type: 'condition', name: 'Check Evidence Provided', config: { condition_type: 'check_evidence_age', max_days: 30 }, x: 350, y: 820 },
  { node_key: 'update_status', node_type: 'action', name: 'Update Compliance Status', config: { action_name: 'update_compliance_status', status: 'compliant' }, x: 100, y: 960 },
  { node_key: 'escalate', node_type: 'action', name: 'Escalate Overdue Gap', config: { action_name: 'escalate_to_management', message: 'Compliance gap remediation is overdue.' }, x: 600, y: 960 },
  { node_key: 'end', node_type: 'end', name: 'End', config: {}, is_terminal: true, x: 350, y: 1100 },
];

const complianceGapEdges: BackendEdge[] = [
  { source_node_key: 'start', target_node_key: 'check_compliance' },
  { source_node_key: 'check_compliance', target_node_key: 'assign_owner', condition: { _label: 'Gap Found', _handle: 'condition-true' } },
  { source_node_key: 'assign_owner', target_node_key: 'notify_gap' },
  { source_node_key: 'notify_gap', target_node_key: 'request_evidence' },
  { source_node_key: 'request_evidence', target_node_key: 'wait_remediation' },
  { source_node_key: 'wait_remediation', target_node_key: 'check_evidence' },
  { source_node_key: 'check_evidence', target_node_key: 'update_status', condition: { _label: 'Evidence Valid', _handle: 'condition-true' } },
  { source_node_key: 'check_evidence', target_node_key: 'escalate', condition: { _label: 'Missing / Expired', _handle: 'condition-false' } },
  { source_node_key: 'update_status', target_node_key: 'end' },
  { source_node_key: 'escalate', target_node_key: 'end' },
];

const annualAuditNodes: BackendNode[] = [
  { node_key: 'start', node_type: 'trigger', name: 'Annual Audit Schedule', config: { trigger_type: 'schedule_recurring', schedule: 'annual' }, is_start: true, x: 350, y: 30 },
  { node_key: 'notify_audit', node_type: 'action', name: 'Announce Audit Campaign', config: { action_name: 'send_notification_email', subject: 'Annual Audit Planning Initiated', body: 'The annual audit planning cycle has begun. Please prepare relevant documentation.' }, x: 350, y: 160 },
  { node_key: 'create_finding', node_type: 'action', name: 'Create Audit Scope', config: { action_name: 'create_audit_finding', finding_type: 'scope_definition', description: 'Define audit universe and scope for this cycle' }, x: 350, y: 290 },
  { node_key: 'multi_approval', node_type: 'approval', name: 'Audit Plan Approval', config: { approval_type: 'multi_level', levels: ['Audit Manager', 'Chief Audit Executive'], timeout_hours: 120 }, x: 350, y: 420 },
  { node_key: 'assign_auditors', node_type: 'action', name: 'Assign Audit Owners', config: { action_name: 'assign_control_owner' }, x: 350, y: 550 },
  { node_key: 'request_evidence', node_type: 'action', name: 'Request Audit Evidence', config: { action_name: 'request_evidence_upload', evidence_type: 'audit_workpapers', description: 'Upload audit workpapers and supporting documents' }, x: 350, y: 680 },
  { node_key: 'sla_timer', node_type: 'timer', name: 'Fieldwork SLA (30d)', config: { timer_type: 'sla_countdown', duration_hours: 720, on_breach: 'escalate' }, x: 350, y: 810 },
  { node_key: 'generate_report', node_type: 'action', name: 'Generate Audit Report', config: { action_name: 'generate_report', report_type: 'annual_audit_summary' }, x: 350, y: 940 },
  { node_key: 'final_notify', node_type: 'action', name: 'Distribute Final Report', config: { action_name: 'send_notification_email', subject: 'Annual Audit Report Published', body: 'The annual audit report has been finalized and is available for review.' }, x: 350, y: 1070 },
  { node_key: 'end', node_type: 'end', name: 'End', config: {}, is_terminal: true, x: 350, y: 1200 },
];

const annualAuditEdges: BackendEdge[] = [
  { source_node_key: 'start', target_node_key: 'notify_audit' },
  { source_node_key: 'notify_audit', target_node_key: 'create_finding' },
  { source_node_key: 'create_finding', target_node_key: 'multi_approval' },
  { source_node_key: 'multi_approval', target_node_key: 'assign_auditors', condition: { _label: 'Approved' } },
  { source_node_key: 'assign_auditors', target_node_key: 'request_evidence' },
  { source_node_key: 'request_evidence', target_node_key: 'sla_timer' },
  { source_node_key: 'sla_timer', target_node_key: 'generate_report' },
  { source_node_key: 'generate_report', target_node_key: 'final_notify' },
  { source_node_key: 'final_notify', target_node_key: 'end' },
];

// ─── New trigger templates ────────────────────────────────────────────────────

const policySubmittedNodes: BackendNode[] = [
  { node_key: 'start', node_type: 'start', name: 'Policy Submitted for Review', config: { trigger_type: 'policy_submitted_for_review', module: 'Governance', domains: ['governance'] }, is_start: true, position_x: 350, position_y: 30 },
  { node_key: 'notify_reviewers', node_type: 'action', name: 'Notify Policy Reviewers', config: { action_name: 'send_notification_email', subject: 'Policy Submitted for Review: {{title}}', body: 'A policy has been submitted for your review.\n\nTitle: {{title}}\nStatus: {{status}}\nSubmitted by: {{created_by_name}}', module: 'Workflow Engine', domains: ['shared'] }, position_x: 350, position_y: 160 },
  { node_key: 'approval', node_type: 'approval', name: 'Reviewer Approval', config: { approval_type: 'single', timeout_seconds: 259200, on_timeout: 'escalate', module: 'Workflow Engine', domains: ['workflow'] }, position_x: 350, position_y: 290 },
  { node_key: 'check_result', node_type: 'condition', name: 'Check Approval Outcome', config: { condition_kind: 'check_approval_status', module: 'Workflow Engine', domains: ['workflow'] }, position_x: 350, position_y: 420 },
  { node_key: 'notify_approved', node_type: 'action', name: 'Notify — Policy Approved', config: { action_name: 'send_notification_email', subject: 'Policy Approved: {{title}}', body: 'The policy "{{title}}" has been approved and will be published.', module: 'Workflow Engine', domains: ['shared'] }, position_x: 100, position_y: 560 },
  { node_key: 'notify_rejected', node_type: 'action', name: 'Notify — Revision Required', config: { action_name: 'send_notification_email', subject: 'Policy Needs Revision: {{title}}', body: 'The policy "{{title}}" requires revision before it can be approved.', module: 'Workflow Engine', domains: ['shared'] }, position_x: 600, position_y: 560 },
  { node_key: 'end', node_type: 'end', name: 'End', config: { module: 'Workflow Engine', domains: ['workflow'] }, is_terminal: true, position_x: 350, position_y: 700 },
];

const policySubmittedEdges: BackendEdge[] = [
  { source_node_key: 'start', target_node_key: 'notify_reviewers', condition: {}, priority: 1 },
  { source_node_key: 'notify_reviewers', target_node_key: 'approval', condition: {}, priority: 1 },
  { source_node_key: 'approval', target_node_key: 'check_result', condition: {}, priority: 1 },
  { source_node_key: 'check_result', target_node_key: 'notify_approved', condition: { _label: 'Approved', _handle: 'condition-true' }, priority: 1 },
  { source_node_key: 'check_result', target_node_key: 'notify_rejected', condition: { _label: 'Rejected', _handle: 'condition-false' }, priority: 2 },
  { source_node_key: 'notify_approved', target_node_key: 'end', condition: {}, priority: 1 },
  { source_node_key: 'notify_rejected', target_node_key: 'end', condition: {}, priority: 1 },
];

const vulnerabilityCreatedNodes: BackendNode[] = [
  { node_key: 'start', node_type: 'start', name: 'Vulnerability Created', config: { trigger_type: 'vulnerability_created', module: 'Vulnerability Management', domains: ['vulnerability'] }, is_start: true, position_x: 350, position_y: 30 },
  { node_key: 'check_severity', node_type: 'condition', name: 'Check Severity', config: { condition_kind: 'check_vulnerability_severity', severity: 'high', operator: 'at_least', module: 'Vulnerability Management', domains: ['vulnerability'] }, position_x: 350, position_y: 160 },
  { node_key: 'alert_critical', node_type: 'action', name: 'Alert Security Team', config: { action_name: 'escalate_to_management', escalation_levels: [{ level: 1, subject: 'Critical/High Vulnerability: {{title}}', message: 'Severity: {{severity}}\nCVSS: {{cvss_score}}\nAffected: {{affected_component}}\nBy: {{created_by_name}}', user_ids: [], role_ids: [], timeout_value: 24, timeout_unit: 'hours', escalation_mode: 'always' }], module: 'Workflow Engine', domains: ['shared'] }, position_x: 100, position_y: 300 },
  { node_key: 'assign_owner', node_type: 'action', name: 'Assign Vulnerability Owner', config: { action_name: 'assign_vulnerability_owner', module: 'Vulnerability Management', domains: ['vulnerability'] }, position_x: 600, position_y: 300 },
  { node_key: 'notify_email', node_type: 'action', name: 'Send Notification', config: { action_name: 'send_notification_email', subject: 'New Vulnerability: {{title}}', body: 'A new vulnerability has been detected.\n\nTitle: {{title}}\nSeverity: {{severity}}\nAffected: {{affected_component}}\nVuln ID: {{vuln_id}}', module: 'Workflow Engine', domains: ['shared'] }, position_x: 350, position_y: 440 },
  { node_key: 'sla_timer', node_type: 'timer', name: 'Remediation SLA', config: { timer_kind: 'sla_countdown', wait_seconds: 604800, module: 'Workflow Engine', domains: ['workflow'] }, position_x: 350, position_y: 570 },
  { node_key: 'end', node_type: 'end', name: 'End', config: { module: 'Workflow Engine', domains: ['workflow'] }, is_terminal: true, position_x: 350, position_y: 700 },
];

const vulnerabilityCreatedEdges: BackendEdge[] = [
  { source_node_key: 'start', target_node_key: 'check_severity', condition: {}, priority: 1 },
  { source_node_key: 'check_severity', target_node_key: 'alert_critical', condition: { _label: 'High / Critical', _handle: 'condition-true' }, priority: 1 },
  { source_node_key: 'check_severity', target_node_key: 'assign_owner', condition: { _label: 'Medium / Low', _handle: 'condition-false' }, priority: 2 },
  { source_node_key: 'alert_critical', target_node_key: 'notify_email', condition: {}, priority: 1 },
  { source_node_key: 'assign_owner', target_node_key: 'notify_email', condition: {}, priority: 1 },
  { source_node_key: 'notify_email', target_node_key: 'sla_timer', condition: {}, priority: 1 },
  { source_node_key: 'sla_timer', target_node_key: 'end', condition: {}, priority: 1 },
];

const assetCreatedNodes: BackendNode[] = [
  { node_key: 'start', node_type: 'start', name: 'IT Asset Created', config: { trigger_type: 'asset_created', module: 'IT Assets', domains: ['shared'] }, is_start: true, position_x: 350, position_y: 30 },
  { node_key: 'notify_owner', node_type: 'action', name: 'Notify Asset Owner', config: { action_name: 'send_notification_email', subject: 'New Asset Registered: {{name}}', body: 'A new IT asset has been registered.\n\nName: {{name}}\nType: {{asset_type}}\nCriticality: {{criticality}}\nHost: {{host_name}}\nIP: {{ip_address}}\nOwner: {{owner_name}}', module: 'Workflow Engine', domains: ['shared'] }, position_x: 350, position_y: 160 },
  { node_key: 'check_criticality', node_type: 'condition', name: 'Check Criticality', config: { condition_kind: 'check_risk_level', risk_level: 'high', operator: 'at_least', module: 'Risk Management', domains: ['risk'] }, position_x: 350, position_y: 290 },
  { node_key: 'request_evidence', node_type: 'action', name: 'Request Baseline Evidence', config: { action_name: 'request_evidence_upload', message: 'Please provide security baseline documentation for the newly registered critical/high asset: {{name}}', module: 'Evidence', domains: ['evidence', 'compliance'] }, position_x: 100, position_y: 430 },
  { node_key: 'assign_risk', node_type: 'action', name: 'Create Asset Risk Entry', config: { action_name: 'create_risk_entry', risk_category: 'operational', title_template: 'Asset risk: {{name}}', module: 'Risk Management', domains: ['risk'] }, position_x: 600, position_y: 430 },
  { node_key: 'notify_complete', node_type: 'action', name: 'Asset Registration Complete', config: { action_name: 'send_notification_email', subject: 'Asset Registration Processed: {{name}}', body: 'The asset "{{name}}" has been registered and processed by the workflow.', module: 'Workflow Engine', domains: ['shared'] }, position_x: 350, position_y: 570 },
  { node_key: 'end', node_type: 'end', name: 'End', config: { module: 'Workflow Engine', domains: ['workflow'] }, is_terminal: true, position_x: 350, position_y: 700 },
];

const assetCreatedEdges: BackendEdge[] = [
  { source_node_key: 'start', target_node_key: 'notify_owner', condition: {}, priority: 1 },
  { source_node_key: 'notify_owner', target_node_key: 'check_criticality', condition: {}, priority: 1 },
  { source_node_key: 'check_criticality', target_node_key: 'request_evidence', condition: { _label: 'Critical / High', _handle: 'condition-true' }, priority: 1 },
  { source_node_key: 'check_criticality', target_node_key: 'assign_risk', condition: { _label: 'Medium / Low', _handle: 'condition-false' }, priority: 2 },
  { source_node_key: 'request_evidence', target_node_key: 'notify_complete', condition: {}, priority: 1 },
  { source_node_key: 'assign_risk', target_node_key: 'notify_complete', condition: {}, priority: 1 },
  { source_node_key: 'notify_complete', target_node_key: 'end', condition: {}, priority: 1 },
];

// ─── Exported System Templates ───────────────────────────────────────────────

export const SYSTEM_TEMPLATES: WorkflowTemplate[] = [
  {
    id: -1,
    name: 'Incident Response Playbook',
    category: 'Incident Response',
    description: 'Automated incident detection, triage, escalation, and resolution workflow with management notifications.',
    trigger_event: 'erm.incident_reported',
    nodes_json: incidentResponseNodes,
    edges_json: incidentResponseEdges,
  },
  {
    id: -2,
    name: 'Vendor Onboarding & Risk Assessment',
    category: 'Vendor Onboarding',
    description: 'End-to-end vendor onboarding with risk scoring, document collection, and approval gates.',
    trigger_event: 'manual.trigger',
    nodes_json: vendorOnboardingNodes,
    edges_json: vendorOnboardingEdges,
  },
  {
    id: -3,
    name: 'Policy Approval & Distribution',
    category: 'Policy',
    description: 'Policy drafting, multi-level review, approval chain, publication, and employee acknowledgment.',
    trigger_event: 'governance.policy_review_due',
    nodes_json: policyApprovalNodes,
    edges_json: policyApprovalEdges,
  },
  {
    id: -4,
    name: 'Quarterly Access Review',
    category: 'Access Review',
    description: 'Automated access certification campaign with manager review, approval, and revocation actions.',
    trigger_event: 'scheduler.recurring',
    nodes_json: accessReviewNodes,
    edges_json: accessReviewEdges,
  },
  {
    id: -5,
    name: 'Risk Assessment Cycle',
    category: 'Risk Management',
    description: 'Periodic risk identification, scoring, treatment planning, and follow-up workflow.',
    trigger_event: 'risks.score_threshold_exceeded',
    nodes_json: riskAssessmentNodes,
    edges_json: riskAssessmentEdges,
  },
  {
    id: -6,
    name: 'Compliance Gap Remediation',
    category: 'Compliance',
    description: 'Automated gap tracking with task assignment, evidence collection, and re-assessment loop.',
    trigger_event: 'compliance.assessment_status_change',
    nodes_json: complianceGapNodes,
    edges_json: complianceGapEdges,
  },
  {
    id: -7,
    name: 'Annual Audit Planning',
    category: 'Audit',
    description: 'Audit universe scoping, resource planning, engagement scheduling, and reporting workflow.',
    trigger_event: 'scheduler.recurring',
    nodes_json: annualAuditNodes,
    edges_json: annualAuditEdges,
  },
  {
    id: -8,
    name: 'Policy Review & Approval',
    category: 'Policy',
    description: 'Automatically routes a submitted policy through reviewer approval with notification on both approval and rejection outcomes.',
    trigger_event: 'policy_submitted_for_review',
    nodes_json: policySubmittedNodes,
    edges_json: policySubmittedEdges,
  },
  {
    id: -9,
    name: 'Vulnerability Triage & Remediation',
    category: 'Vulnerability Management',
    description: 'Triages newly created vulnerabilities by severity, escalates critical/high findings, assigns ownership, and starts a remediation SLA timer.',
    trigger_event: 'vulnerability_created',
    nodes_json: vulnerabilityCreatedNodes,
    edges_json: vulnerabilityCreatedEdges,
  },
  {
    id: -10,
    name: 'IT Asset Onboarding',
    category: 'Asset Management',
    description: 'Processes newly registered IT assets — notifies the asset owner, requests baseline evidence for critical assets, and creates a risk entry.',
    trigger_event: 'asset_created',
    nodes_json: assetCreatedNodes,
    edges_json: assetCreatedEdges,
  },
];

export function TemplatesModal({ templates, onClose, onUse }: Props) {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');

  const allTemplates = [
    ...SYSTEM_TEMPLATES,
    ...templates.filter((t) => t.id > 0),
  ];

  const categories = Array.from(new Set(allTemplates.map((t) => t.category)));

  const filtered = allTemplates.filter((t) => {
    const matchSearch =
      search === '' ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.description?.toLowerCase().includes(search.toLowerCase());
    const matchCat = selectedCategory === '' || t.category === selectedCategory;
    return matchSearch && matchCat;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-base font-bold text-gray-900">Workflow Templates</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Start from a prebuilt template or browse the library
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 bg-gray-50">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
              placeholder="Search templates..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          {filtered.length === 0 && (
            <div className="text-center py-10 text-sm text-gray-400">No templates found</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((template) => {
              const catColor = CATEGORY_COLORS[template.category] || 'bg-gray-100 text-gray-600';
              const nodeCount = template.nodes_json?.length || 0;
              return (
                <div
                  key={template.id}
                  className="border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all flex flex-col gap-2 bg-white"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${catColor}`}>
                          {template.category}
                        </span>
                        {template.id < 0 && (
                          <span className="text-[9px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full border border-blue-200">
                            Built-in
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-semibold text-gray-800">{template.name}</div>
                    </div>
                    <Zap size={16} className="text-gray-300 shrink-0 mt-0.5" />
                  </div>
                  {template.description && (
                    <p className="text-[11px] text-gray-500 leading-relaxed">{template.description}</p>
                  )}
                  {nodeCount > 0 && (
                    <p className="text-[10px] text-gray-400">{nodeCount} steps · {template.edges_json?.length || 0} connections</p>
                  )}
                  <button
                    onClick={() => onUse(template.id)}
                    className="mt-auto w-full text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white py-1.5 rounded-md transition-colors"
                  >
                    Use Template
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
