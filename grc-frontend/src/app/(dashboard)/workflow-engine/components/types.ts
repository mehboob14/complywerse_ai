// Shared types for Workflow Engine components

// Display label overrides for node keys. Use these when the naive
// title-case from `snake_case` would mangle acronyms (KRI, SLA, API, RCSA)
// or compound words ("in-app").
export const NODE_LABEL_OVERRIDES: Record<string, string> = {
  // Triggers
  kri_breach: 'KRI Breach',
  bcm_plan_created: 'BCM Plan Created',
  bcm_plan_activated: 'BCM Plan Activated',
  bcm_drill_scheduled: 'BCM Drill Scheduled',
  bcm_drill_completed: 'BCM Drill Completed',
  bcm_bia_updated: 'BCM BIA Updated',
  vulnerability_sla_breach: 'Vulnerability SLA Breach',
  vulnerability_sla_warning: 'Vulnerability SLA Warning',
  // Actions
  send_in_app_alert: 'Send In-App Alert',
  call_webhook_api: 'Call Webhook API',
  // Approvals
  multi_level: 'Multi-Level',
  // Timers
  sla_countdown: 'SLA Countdown',
};

// Acronyms / token replacements applied AFTER the basic title-case pass.
// Word-boundary substitutions only — won't touch substrings inside larger words.
const NODE_LABEL_ACRONYMS: Array<[RegExp, string]> = [
  [/\bKri\b/g, 'KRI'],
  [/\bKris\b/g, 'KRIs'],
  [/\bSla\b/g, 'SLA'],
  [/\bApi\b/g, 'API'],
  [/\bRcsa\b/g, 'RCSA'],
  [/\bKpi\b/g, 'KPI'],
  [/\bIt\b/g, 'IT'],
  [/\bAi\b/g, 'AI'],
  [/\bUrl\b/g, 'URL'],
  [/\bId\b/g, 'ID'],
  [/\bCcm\b/g, 'CCM'],
  [/\bCis\b/g, 'CIS'],
  [/\bIso\b/g, 'ISO'],
  [/\bNist\b/g, 'NIST'],
  [/\bPci\b/g, 'PCI'],
  [/\bSoc\b/g, 'SOC'],
  [/\bGdpr\b/g, 'GDPR'],
  [/\bHipaa\b/g, 'HIPAA'],
  [/\bCsf\b/g, 'CSF'],
];

export function formatNodeLabel(key: string): string {
  if (NODE_LABEL_OVERRIDES[key]) return NODE_LABEL_OVERRIDES[key];
  let label = key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
  for (const [re, rep] of NODE_LABEL_ACRONYMS) {
    label = label.replace(re, rep);
  }
  return label;
}

export type WorkflowDefinition = {
  id: number;
  name: string;
  description?: string;
  trigger_event: string;
  trigger_conditions: Record<string, unknown>;
  definition_json: Record<string, unknown>;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  is_active: boolean;
  version: number;
  created_at?: string;
  updated_at?: string;
  created_by_id?: number;
};

export type BackendNode = {
  node_key: string;
  node_type: string;
  name?: string;
  config?: Record<string, unknown>;
  is_start?: boolean;
  is_terminal?: boolean;
  x?: number;
  y?: number;
  position_x?: number;
  position_y?: number;
};

export type BackendEdge = {
  source_node_key: string;
  target_node_key: string;
  condition?: Record<string, unknown>;
  priority?: number;
  source_handle?: string;
  target_handle?: string;
  label?: string;
};

export type FlowNodeData = {
  nodeKey: string;
  nodeType: string;
  label: string;
  config: Record<string, unknown>;
  module?: string;
  submodule?: string;
  domains?: WorkflowDomain[];
  isStart?: boolean;
  isTerminal?: boolean;
  executionStatus?: 'running' | 'completed' | 'failed' | 'waiting' | null;
  // Set by page.tsx during render: true when this node is the single node
  // directly connected after the Start placeholder.
  isFirstAfterStart?: boolean;
  // Set by page.tsx: 'valid' when isFirstAfterStart and trigger event can be
  // inferred, 'invalid' when it cannot. Drives the ⚡ / ⚠ canvas indicator.
  triggerStatus?: 'valid' | 'invalid';
  // The inferred trigger event string when triggerStatus === 'valid'.
  inferredTriggerEvent?: string;
};

export type WorkflowDomain =
  | 'core'
  | 'evidence'
  | 'compliance'
  | 'risk'
  | 'vulnerability'
  | 'governance'
  | 'audit'
  | 'control'
  | 'assets'
  | 'workflow'
  | 'shared';

export type PaletteItem = {
  key: string;
  label: string;
  description: string;
  group: 'triggers' | 'actions' | 'conditions' | 'approvals' | 'timers' | 'control' | 'platform_functions';
  module?: string;
  submodule?: string;
};

export type NodeOptionItem = {
  key: string;
  label: string;
  module?: string;
  submodule?: string;
};

export type NodeCatalogContext = {
  key: string;
  domains: WorkflowDomain[];
  module?: string;
  submodule?: string;
  isPlatformFunction?: boolean;
};

export type AnalyticsOverview = {
  total_instances?: number;
  completed?: number;
  failed?: number;
  waiting?: number;
  running?: number;
  avg_completion_minutes?: number;
};

export type WorkflowTemplate = {
  id: number;
  name: string;
  category: string;
  description?: string;
  tags?: string[];
  trigger_event?: string;
  nodes_json?: BackendNode[];
  edges_json?: BackendEdge[];
};

export type BottleneckItem = {
  node_key: string;
  node_type: string;
  avg_duration_seconds: number;
  instance_count: number;
};

export type LiveInstance = {
  id: number;
  workflow_name?: string;
  status: string;
  current_node_key?: string;
  started_at: string;
  is_overdue?: boolean;
  trigger_event?: string;
};

export type WorkflowVersion = {
  id: number;
  version_number: number;
  name: string;
  change_summary?: string;
  created_by_id?: number;
  created_at: string;
};

export type AISuggestion = {
  title: string;
  description: string;
  framework_ref?: string;
  already_exists: boolean;
  suggested_nodes?: BackendNode[];
  suggested_edges?: BackendEdge[];
  trigger_event?: string;
  category?: string;
};

export type NodeConfigOptions = {
  frameworks: Array<{ id: number; name: string; version?: string; short_code?: string }>;
  risk_categories: string[];
  risk_statuses: string[];
  risk_levels: string[];
  risk_treatment_types: string[];
  risk_register_types: string[];
  risk_sub_categories: string[];
  compliance_statuses: string[];
  vulnerability_severities: string[];
  vulnerability_statuses: string[];
  vulnerability_sla_configs: Array<{ severity: string; remediation_days: number }>;
  policy_categories: string[];
  policy_statuses: string[];
  audit_types: string[];
  finding_severities: string[];
  control_effectiveness_levels: string[];
  evidence_categories: string[];
  report_types: string[];
  kri_categories: string[];
  remediation_priorities: string[];
  asset_types: string[];
  asset_criticality_levels: string[];
};

// A single input field for a platform-function node, derived on the backend
// from the node's real API endpoint (path / query / body parameter).
export type NodeParamField = {
  name: string;
  label: string;
  location: 'path' | 'query' | 'body';
  type: string;            // string | integer | number | boolean | array | object
  required: boolean;
  enum?: string[];         // when present → render a dropdown
  entity?: string;         // when present → render a record picker (risk, control, document, …)
  format?: string;         // e.g. 'date', 'date-time'
};

// Map of platform-function node key → its input fields.
export type NodeParamSchemas = Record<string, NodeParamField[]>;

export const EMPTY_NODE_CONFIG_OPTIONS: NodeConfigOptions = {
  frameworks: [],
  risk_categories: [],
  risk_statuses: [],
  risk_levels: [],
  risk_treatment_types: [],
  risk_register_types: ['operational', 'strategic', 'financial', 'technology', 'compliance', 'third_party', 'project_change', 'ubl_template'],
  risk_sub_categories: ['cybersecurity', 'data_privacy', 'business_continuity', 'fraud', 'regulatory', 'reputational', 'supply_chain', 'human_error', 'natural_disaster', 'financial_reporting', 'market', 'credit', 'liquidity', 'it_infrastructure', 'change_management'],
  compliance_statuses: [],
  vulnerability_severities: [],
  vulnerability_statuses: [],
  vulnerability_sla_configs: [],
  policy_categories: [],
  policy_statuses: [],
  audit_types: [],
  finding_severities: [],
  control_effectiveness_levels: [],
  evidence_categories: [],
  report_types: [],
  kri_categories: [],
  remediation_priorities: [],
  asset_types: ['server', 'workstation', 'network_device', 'database', 'application', 'cloud_service', 'storage', 'endpoint', 'iot_device', 'virtual_machine'],
  asset_criticality_levels: ['critical', 'high', 'medium', 'low'],
};

// Node group colors
export const NODE_GROUP_COLORS: Record<string, string> = {
  triggers: 'border-blue-500 bg-blue-50',
  actions: 'border-emerald-500 bg-emerald-50',
  conditions: 'border-amber-500 bg-amber-50',
  approvals: 'border-violet-500 bg-violet-50',
  timers: 'border-cyan-500 bg-cyan-50',
  control: 'border-gray-400 bg-gray-50',
};

export const NODE_CANVAS_COLORS: Record<string, string> = {
  start: 'border-blue-500 bg-blue-50',
  end: 'border-gray-400 bg-gray-50',
  condition: 'border-amber-500 bg-amber-50',
  action: 'border-emerald-500 bg-emerald-50',
  approval: 'border-violet-500 bg-violet-50',
  timer: 'border-cyan-500 bg-cyan-50',
  subworkflow: 'border-orange-500 bg-orange-50',
};

export const NODE_ICON_COLORS: Record<string, string> = {
  start: 'text-blue-600',
  end: 'text-gray-500',
  condition: 'text-amber-600',
  action: 'text-emerald-600',
  approval: 'text-violet-600',
  timer: 'text-cyan-600',
  subworkflow: 'text-orange-600',
};

export const STATUS_COLORS: Record<string, string> = {
  running: 'bg-blue-100 text-blue-700 border-blue-300',
  completed: 'bg-green-100 text-green-700 border-green-300',
  failed: 'bg-red-100 text-red-700 border-red-300',
  waiting: 'bg-yellow-100 text-yellow-700 border-yellow-300',
  waiting_approval: 'bg-purple-100 text-purple-700 border-purple-300',
  waiting_timer: 'bg-cyan-100 text-cyan-700 border-cyan-300',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-300',
};

export const TRIGGER_KEYS = new Set([
  // Core triggers
  'manual_trigger',
  'schedule_recurring',
  'webhook',
  // Evidence & compliance
  'evidence_uploaded',
  'evidence_approved',
  'evidence_expires',
  'framework_deadline_approaching',
  'framework_evidence_complete',
  'assessment_status_change',
  'compliance_gap_detected',
  'certification_expiry_approaching',
  // Risk
  'risk_created',
  'risk_status_changed',
  'risk_score_exceeds_threshold',
  'kri_breach',
  'incident_reported',
  // Vulnerability
  'new_vulnerability_detected',
  'vulnerability_sla_breach',
  'vulnerability_sla_warning',
  // Risk (additional)
  'risk_updated',
  'risk_deleted',
  // Vulnerability (additional)
  'vulnerability_created',
  'vulnerability_updated',
  'vulnerability_deleted',
  // Governance & policy
  'policy_submitted_for_review',
  'policy_review_due',
  'policy_approved',
  'control_review_due',
  'attestation_overdue',
  // Governance documents
  'governance_document_created',
  'governance_document_expires',
  'governance_document_published',
  // Auditor Portal
  'audit_review_submitted',
  'audit_control_approved',
  // IT Assets
  'asset_created',
  'asset_updated',
  'asset_deleted',
  // Control Library
  'control_group_created',
  'control_group_updated',
  'control_group_deleted',
  // Governance: document review & sign-off
  'document_review_started',
  'document_review_completed',
  'document_signoff_requested',
  'document_signoff_completed',
  // Governance: committees
  'committee_created',
  'committee_updated',
  'committee_meeting_scheduled',
  'committee_meeting_completed',
  'committee_action_overdue',
  // Governance: attestations & certification
  'attestation_requested',
  'attestation_completed',
  'attestation_campaign_activated',
  'attestation_campaign_completed',
  'attestation_campaign_escalated',
  // Governance: regulatory changes & exceptions
  'regulatory_change_created',
  'regulatory_change_closed',
  'regulatory_task_created',
  'policy_exception_created',
  'policy_exception_approved',
  'policy_exception_revoked',
  // Risk / ERM: mitigation actions & incidents
  'mitigation_action_created',
  'mitigation_action_completed',
  'mitigation_action_overdue',
  'incident_closed',
  'incident_updated',
  // Risk / ERM: KRIs
  'kri_measured',
  'kri_breach_resolved',
  // Risk / ERM: reviews & assessments
  'risk_review_scheduled',
  'risk_review_completed',
  'risk_closed',
  'risk_reopened',
  'risk_assessment_created',
  'risk_assessment_completed',
  // Risk / ERM: RCSA
  'rcsa_campaign_activated',
  'rcsa_assessment_submitted',
  'rcsa_assessment_approved',
  // Risk / ERM: internal controls
  'internal_control_submitted',
  'internal_control_approved',
  'internal_control_test_failed',
  'appetite_breach_detected',
  // Third-Party Risk: vendors, assessments, questionnaires
  'vendor_created',
  'vendor_updated',
  'vendor_assessment_created',
  'vendor_assessment_approved',
  'vendor_questionnaire_sent',
  'vendor_questionnaire_completed',
  'vendor_incident_created',
  'vendor_remediation_created',
  'vendor_reassessment_scheduled',
  'vendor_offboarding_updated',
  // Compliance: evidence & access reviews
  'evidence_submitted',
  'evidence_rejected',
  'evidence_renewed',
  'evidence_stale',
  'audit_package_finalized',
  'evidence_linked_to_control',
  'compliance_assessment_created',
  'compliance_assessment_completed',
  'framework_published',
  'access_review_campaign_created',
  'access_review_item_decided',
  'access_review_campaign_closed',
  'access_review_escalated',
  // Issues / CAPA
  'issue_closed',
  'issue_reopened',
  'issue_assigned',
  'capa_action_created',
  'capa_action_completed',
  // Assets / BCM / Administration / Tasks
  'asset_criticality_changed',
  'bcm_plan_created',
  'bcm_plan_activated',
  'bcm_drill_scheduled',
  'bcm_drill_completed',
  'bcm_bia_updated',
  'user_created',
  'user_updated',
  'user_deactivated',
  'role_created',
  'role_updated',
  'password_policy_updated',
  'critical_task_created',
  'critical_task_completed',
  'critical_task_overdue',
  // Optional metrics
  'kpi_breached',
]);

// Actions = generic workflow-engine steps only.
// GRC domain operations (risk, compliance, governance, etc.) live exclusively
// in Platform Functions, which are auto-generated from backend API endpoints.
export const ACTION_KEYS = new Set([
  // Notifications
  'send_notification_email',
  'send_in_app_alert',
  'escalate_to_management',
  'call_webhook_api',
  'generate_report',
  // Evidence & compliance
  'request_evidence_upload',
  'request_evidence_review',
  'approve_evidence',
  'reject_evidence',
  'update_compliance_status',
  'start_compliance_assessment',
  'close_compliance_gap',
  'link_evidence_to_control',
  'assign_control_owner',
  // Risk
  'create_risk_entry',
  'update_risk_status',
  'assign_risk_owner',
  'trigger_risk_review',
  'create_remediation_task',
  // Vulnerability
  'assign_vulnerability_owner',
  'update_vulnerability_status',
  'create_vulnerability_entry',
  // Governance
  'create_policy_review_task',
  'publish_policy',
  'submit_policy_exception',
  'approve_policy_exception',
  'request_attestation',
  // Control library
  'update_control_effectiveness',
  'set_control_not_applicable',
]);

export const CONDITION_KEYS = new Set([
  'check_risk_level',
  'check_compliance_status',
  'check_evidence_age',
  'check_evidence_completeness',
  'check_framework_coverage',
  'check_vulnerability_severity',
  'check_policy_status',
  'check_approval_status',
  'check_user_role',
  'evaluate_business_unit',
  'expression_builder',
]);

export const APPROVAL_KEYS = new Set(['single', 'multi_level', 'quorum']);
export const TIMER_KEYS = new Set(['wait_duration', 'wait_until_date', 'sla_countdown']);

type NodeDefinitionMeta = {
  domains: WorkflowDomain[];
  module?: string;
};

const CURATED_NODE_METADATA: Record<string, NodeDefinitionMeta> = {
  manual_trigger: { domains: ['core'], module: 'Workflow Engine' },
  schedule_recurring: { domains: ['core'], module: 'Workflow Engine' },
  webhook: { domains: ['core'], module: 'Workflow Engine' },
  evidence_uploaded: { domains: ['evidence', 'compliance'], module: 'Evidence' },
  evidence_approved: { domains: ['evidence', 'compliance'], module: 'Evidence' },
  evidence_expires: { domains: ['evidence', 'compliance'], module: 'Evidence' },
  evidence_submitted: { domains: ['evidence', 'compliance'], module: 'Evidence' },
  evidence_rejected: { domains: ['evidence', 'compliance'], module: 'Evidence' },
  evidence_renewed: { domains: ['evidence', 'compliance'], module: 'Evidence' },
  evidence_stale: { domains: ['evidence', 'compliance'], module: 'Evidence' },
  framework_deadline_approaching: { domains: ['compliance'], module: 'Compliance' },
  framework_evidence_complete: { domains: ['evidence', 'compliance'], module: 'Compliance' },
  assessment_status_change: { domains: ['compliance'], module: 'Compliance' },
  compliance_gap_detected: { domains: ['compliance'], module: 'Compliance' },
  certification_expiry_approaching: { domains: ['compliance'], module: 'Compliance' },
  audit_package_finalized: { domains: ['compliance', 'evidence'], module: 'Evidence' },
  evidence_linked_to_control: { domains: ['evidence', 'compliance', 'control'], module: 'Evidence' },
  compliance_assessment_created: { domains: ['compliance'], module: 'Compliance' },
  compliance_assessment_completed: { domains: ['compliance'], module: 'Compliance' },
  framework_published: { domains: ['compliance'], module: 'Compliance' },
  access_review_campaign_created: { domains: ['compliance'], module: 'Compliance' },
  access_review_item_decided: { domains: ['compliance'], module: 'Compliance' },
  access_review_campaign_closed: { domains: ['compliance'], module: 'Compliance' },
  access_review_escalated: { domains: ['compliance'], module: 'Compliance' },
  risk_created: { domains: ['risk'], module: 'Risk Management' },
  risk_status_changed: { domains: ['risk'], module: 'Risk Management' },
  risk_score_exceeds_threshold: { domains: ['risk'], module: 'Risk Management' },
  kri_breach: { domains: ['risk'], module: 'Risk Management' },
  incident_reported: { domains: ['risk'], module: 'Risk Management' },
  // Mitigation actions
  mitigation_action_created: { domains: ['risk'], module: 'Risk Management' },
  mitigation_action_completed: { domains: ['risk'], module: 'Risk Management' },
  mitigation_action_overdue: { domains: ['risk'], module: 'Risk Management' },
  // Incident lifecycle
  incident_closed: { domains: ['risk'], module: 'Risk Management' },
  incident_updated: { domains: ['risk'], module: 'Risk Management' },
  // KRI measurement & breach resolution
  kri_measured: { domains: ['risk'], module: 'Risk Management' },
  kri_breach_resolved: { domains: ['risk'], module: 'Risk Management' },
  // Risk review lifecycle
  risk_review_scheduled: { domains: ['risk'], module: 'Risk Management' },
  risk_review_completed: { domains: ['risk'], module: 'Risk Management' },
  // Risk closure & reopening
  risk_closed: { domains: ['risk'], module: 'Risk Management' },
  risk_reopened: { domains: ['risk'], module: 'Risk Management' },
  // Risk assessments
  risk_assessment_created: { domains: ['risk'], module: 'Risk Management' },
  risk_assessment_completed: { domains: ['risk'], module: 'Risk Management' },
  // RCSA
  rcsa_campaign_activated: { domains: ['risk', 'compliance'], module: 'Risk Management' },
  rcsa_assessment_submitted: { domains: ['risk', 'compliance'], module: 'Risk Management' },
  rcsa_assessment_approved: { domains: ['risk', 'compliance'], module: 'Risk Management' },
  // Internal controls
  internal_control_submitted: { domains: ['risk', 'compliance'], module: 'Internal Controls' },
  internal_control_approved: { domains: ['risk', 'compliance'], module: 'Internal Controls' },
  internal_control_test_failed: { domains: ['risk', 'compliance'], module: 'Internal Controls' },
  appetite_breach_detected: { domains: ['risk'], module: 'Risk Management' },
  // Third-party risk (vendor)
  vendor_created: { domains: ['risk'], module: 'Third-Party Risk' },
  vendor_updated: { domains: ['risk'], module: 'Third-Party Risk' },
  vendor_assessment_created: { domains: ['risk'], module: 'Third-Party Risk' },
  vendor_assessment_approved: { domains: ['risk'], module: 'Third-Party Risk' },
  vendor_questionnaire_sent: { domains: ['risk'], module: 'Third-Party Risk' },
  vendor_questionnaire_completed: { domains: ['risk'], module: 'Third-Party Risk' },
  vendor_incident_created: { domains: ['risk'], module: 'Third-Party Risk' },
  vendor_remediation_created: { domains: ['risk'], module: 'Third-Party Risk' },
  vendor_reassessment_scheduled: { domains: ['risk'], module: 'Third-Party Risk' },
  vendor_offboarding_updated: { domains: ['risk'], module: 'Third-Party Risk' },
  new_vulnerability_detected: { domains: ['vulnerability'], module: 'Vulnerability Management' },
  vulnerability_sla_breach: { domains: ['vulnerability'], module: 'Vulnerability Management' },
  vulnerability_sla_warning: { domains: ['vulnerability'], module: 'Vulnerability Management' },
  risk_updated: { domains: ['risk'], module: 'Risk Management' },
  risk_deleted: { domains: ['risk'], module: 'Risk Management' },
  vulnerability_created: { domains: ['vulnerability'], module: 'Vulnerability Management' },
  vulnerability_updated: { domains: ['vulnerability'], module: 'Vulnerability Management' },
  vulnerability_deleted: { domains: ['vulnerability'], module: 'Vulnerability Management' },
  policy_submitted_for_review: { domains: ['governance'], module: 'Governance' },
  policy_review_due: { domains: ['governance'], module: 'Governance' },
  policy_approved: { domains: ['governance'], module: 'Governance' },
  control_review_due: { domains: ['governance', 'control'], module: 'Governance' },
  attestation_overdue: { domains: ['governance'], module: 'Governance' },
  // Governance: document review & sign-off
  document_review_started: { domains: ['governance'], module: 'Governance' },
  document_review_completed: { domains: ['governance'], module: 'Governance' },
  document_signoff_requested: { domains: ['governance'], module: 'Governance' },
  document_signoff_completed: { domains: ['governance'], module: 'Governance' },
  // Governance: committees
  committee_created: { domains: ['governance'], module: 'Board & Committee Management' },
  committee_updated: { domains: ['governance'], module: 'Board & Committee Management' },
  committee_meeting_scheduled: { domains: ['governance'], module: 'Board & Committee Management' },
  committee_meeting_completed: { domains: ['governance'], module: 'Board & Committee Management' },
  committee_action_overdue: { domains: ['governance'], module: 'Board & Committee Management' },
  // Governance: attestations & certification
  attestation_requested: { domains: ['governance'], module: 'Governance' },
  attestation_completed: { domains: ['governance'], module: 'Governance' },
  attestation_campaign_activated: { domains: ['governance'], module: 'Attestation & Certification Management' },
  attestation_campaign_completed: { domains: ['governance'], module: 'Attestation & Certification Management' },
  attestation_campaign_escalated: { domains: ['governance'], module: 'Attestation & Certification Management' },
  // Governance: regulatory changes & exceptions
  regulatory_change_created: { domains: ['governance'], module: 'Regulatory Change Management' },
  regulatory_change_closed: { domains: ['governance'], module: 'Regulatory Change Management' },
  regulatory_task_created: { domains: ['governance'], module: 'Regulatory Change Management' },
  policy_exception_created: { domains: ['governance'], module: 'Policy Exceptions' },
  policy_exception_approved: { domains: ['governance'], module: 'Policy Exceptions' },
  policy_exception_revoked: { domains: ['governance'], module: 'Policy Exceptions' },
  audit_review_submitted: { domains: ['audit'], module: 'Auditor Portal' },
  audit_control_approved: { domains: ['audit'], module: 'Auditor Portal' },
  asset_created: { domains: ['assets'], module: 'IT Asset Management' },
  asset_updated: { domains: ['assets'], module: 'IT Asset Management' },
  asset_deleted: { domains: ['assets'], module: 'IT Asset Management' },
  asset_criticality_changed: { domains: ['assets'], module: 'IT Asset Management' },
  // BCM
  bcm_plan_created: { domains: ['workflow'], module: 'Business Continuity Management' },
  bcm_plan_activated: { domains: ['workflow'], module: 'Business Continuity Management' },
  bcm_drill_scheduled: { domains: ['workflow'], module: 'Business Continuity Management' },
  bcm_drill_completed: { domains: ['workflow'], module: 'Business Continuity Management' },
  bcm_bia_updated: { domains: ['workflow'], module: 'Business Continuity Management' },
  // Administration
  user_created: { domains: ['workflow'], module: 'Administration' },
  user_updated: { domains: ['workflow'], module: 'Administration' },
  user_deactivated: { domains: ['workflow'], module: 'Administration' },
  role_created: { domains: ['workflow'], module: 'Administration' },
  role_updated: { domains: ['workflow'], module: 'Administration' },
  password_policy_updated: { domains: ['workflow'], module: 'Administration' },
  critical_task_created: { domains: ['workflow'], module: 'Administration' },
  critical_task_completed: { domains: ['workflow'], module: 'Administration' },
  critical_task_overdue: { domains: ['workflow'], module: 'Administration' },
  // Issues / CAPA
  issue_closed: { domains: ['workflow'], module: 'Issue Management' },
  issue_reopened: { domains: ['workflow'], module: 'Issue Management' },
  issue_assigned: { domains: ['workflow'], module: 'Issue Management' },
  capa_action_created: { domains: ['workflow'], module: 'Issue Management' },
  capa_action_completed: { domains: ['workflow'], module: 'Issue Management' },
  control_group_created: { domains: ['compliance', 'control'], module: 'Control Library' },
  control_group_updated: { domains: ['compliance', 'control'], module: 'Control Library' },
  control_group_deleted: { domains: ['compliance', 'control'], module: 'Control Library' },
  send_notification_email: { domains: ['shared'], module: 'Workflow Engine' },
  send_in_app_alert: { domains: ['shared'], module: 'Workflow Engine' },
  escalate_to_management: { domains: ['shared'], module: 'Workflow Engine' },
  call_webhook_api: { domains: ['shared'], module: 'Workflow Engine' },
  generate_report: { domains: ['shared'], module: 'Workflow Engine' },
  request_evidence_upload: { domains: ['evidence', 'compliance'], module: 'Evidence' },
  request_evidence_review: { domains: ['evidence', 'compliance'], module: 'Evidence' },
  approve_evidence: { domains: ['evidence', 'compliance'], module: 'Evidence' },
  reject_evidence: { domains: ['evidence', 'compliance'], module: 'Evidence' },
  update_compliance_status: { domains: ['compliance'], module: 'Compliance' },
  start_compliance_assessment: { domains: ['compliance'], module: 'Compliance' },
  close_compliance_gap: { domains: ['compliance'], module: 'Compliance' },
  link_evidence_to_control: { domains: ['evidence', 'compliance', 'control'], module: 'Evidence' },
  assign_control_owner: { domains: ['control', 'governance'], module: 'Control Library' },
  create_risk_entry: { domains: ['risk'], module: 'Risk Management' },
  update_risk_status: { domains: ['risk'], module: 'Risk Management' },
  assign_risk_owner: { domains: ['risk'], module: 'Risk Management' },
  trigger_risk_review: { domains: ['risk'], module: 'Risk Management' },
  create_remediation_task: { domains: ['risk', 'vulnerability', 'compliance'], module: 'Risk Management' },
  assign_vulnerability_owner: { domains: ['vulnerability'], module: 'Vulnerability Management' },
  update_vulnerability_status: { domains: ['vulnerability'], module: 'Vulnerability Management' },
  create_vulnerability_entry: { domains: ['vulnerability'], module: 'Vulnerability Management' },
  create_policy_review_task: { domains: ['governance'], module: 'Governance' },
  publish_policy: { domains: ['governance'], module: 'Governance' },
  submit_policy_exception: { domains: ['governance'], module: 'Governance' },
  approve_policy_exception: { domains: ['governance'], module: 'Governance' },
  request_attestation: { domains: ['governance'], module: 'Governance' },
  update_control_effectiveness: { domains: ['control', 'governance'], module: 'Control Library' },
  set_control_not_applicable: { domains: ['control', 'governance'], module: 'Control Library' },
  // KRI management
  create_kri: { domains: ['risk'], module: 'Risk Management' },
  update_kri_value: { domains: ['risk'], module: 'Risk Management' },
  resolve_kri_breach: { domains: ['risk'], module: 'Risk Management' },
  // Incident management
  create_incident: { domains: ['risk'], module: 'Risk Management' },
  update_incident_status: { domains: ['risk'], module: 'Risk Management' },
  assign_incident_owner: { domains: ['risk'], module: 'Risk Management' },
  close_incident: { domains: ['risk'], module: 'Risk Management' },
  // Mitigation plans
  create_mitigation_plan: { domains: ['risk'], module: 'Risk Management' },
  update_mitigation_status: { domains: ['risk'], module: 'Risk Management' },
  link_risk_to_mitigation: { domains: ['risk'], module: 'Risk Management' },
  // RCSA
  initiate_rcsa: { domains: ['risk', 'compliance'], module: 'Risk Management' },
  submit_rcsa_results: { domains: ['risk', 'compliance'], module: 'Risk Management' },
  review_rcsa: { domains: ['risk', 'compliance'], module: 'Risk Management' },
  // Risk reviews
  schedule_risk_review: { domains: ['risk'], module: 'Risk Management' },
  complete_risk_review: { domains: ['risk'], module: 'Risk Management' },
  // Risk assessments
  create_risk_assessment: { domains: ['risk'], module: 'Risk Management' },
  update_risk_assessment_status: { domains: ['risk'], module: 'Risk Management' },
  assign_risk_assessor: { domains: ['risk'], module: 'Risk Management' },
  // Internal controls
  create_internal_control: { domains: ['risk'], module: 'Risk Management' },
  test_internal_control: { domains: ['risk'], module: 'Risk Management' },
  update_control_test_result: { domains: ['risk'], module: 'Risk Management' },
  // Risk appetite
  set_risk_appetite: { domains: ['risk'], module: 'Risk Management' },
  update_risk_tolerance: { domains: ['risk'], module: 'Risk Management' },
  // Risk dependencies
  add_risk_dependency: { domains: ['risk'], module: 'Risk Management' },
  check_risk_level: { domains: ['risk'], module: 'Risk Management' },
  check_compliance_status: { domains: ['compliance'], module: 'Compliance' },
  check_evidence_age: { domains: ['evidence', 'compliance'], module: 'Evidence' },
  check_evidence_completeness: { domains: ['evidence', 'compliance'], module: 'Evidence' },
  check_framework_coverage: { domains: ['compliance'], module: 'Compliance' },
  check_vulnerability_severity: { domains: ['vulnerability'], module: 'Vulnerability Management' },
  check_policy_status: { domains: ['governance'], module: 'Governance' },
  check_approval_status: { domains: ['workflow'], module: 'Workflow Engine' },
  check_user_role: { domains: ['workflow'], module: 'Workflow Engine' },
  evaluate_business_unit: { domains: ['workflow'], module: 'Workflow Engine' },
  expression_builder: { domains: ['workflow'], module: 'Workflow Engine' },
  single: { domains: ['workflow'], module: 'Workflow Engine' },
  multi_level: { domains: ['workflow'], module: 'Workflow Engine' },
  quorum: { domains: ['workflow'], module: 'Workflow Engine' },
  wait_duration: { domains: ['workflow'], module: 'Workflow Engine' },
  wait_until_date: { domains: ['workflow'], module: 'Workflow Engine' },
  sla_countdown: { domains: ['workflow'], module: 'Workflow Engine' },
  subworkflow: { domains: ['workflow'], module: 'Workflow Engine' },
  end: { domains: ['workflow'], module: 'Workflow Engine' },
  start: { domains: ['workflow'], module: 'Workflow Engine' },
};

const SHARED_ACTION_KEYS = new Set([
  'send_notification_email',
  'send_in_app_alert',
  'escalate_to_management',
  'call_webhook_api',
  'generate_report',
]);

function titleizeSlug(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .replace(/\s*>\s*/g, ' > ');
}

function normalizeConfiguredValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function matchesDomainScope(itemDomains: WorkflowDomain[], scope: Set<WorkflowDomain>): boolean {
  return itemDomains.some((domain) => scope.has(domain));
}

function expandDomainScope(domains: WorkflowDomain[]): Set<WorkflowDomain> {
  const scope = new Set<WorkflowDomain>(domains.length ? domains : ['workflow']);
  scope.add('shared');
  scope.add('workflow');

  if (scope.has('evidence') || scope.has('compliance')) {
    scope.add('evidence');
    scope.add('compliance');
  }

  if (scope.has('governance') || scope.has('control')) {
    scope.add('governance');
    scope.add('control');
  }

  return scope;
}

export function inferWorkflowDomainsFromModuleName(moduleName?: string): WorkflowDomain[] {
  const lower = (moduleName || '').trim().toLowerCase();
  if (!lower) return ['workflow'];
  if (lower.includes('evidence')) return ['evidence', 'compliance'];
  if (lower.includes('compliance') || lower.includes('framework')) return ['compliance'];
  if (lower.includes('risk') || lower.includes('erm') || lower.includes('incident') || lower.includes('kri')) return ['risk'];
  if (lower.includes('vulnerability') || lower.includes('vuln')) return ['vulnerability'];
  if (lower.includes('governance') || lower.includes('policy') || lower.includes('attestation')) return ['governance'];
  if (lower.includes('audit')) return ['audit'];
  if (lower.includes('control')) return ['control'];
  if (lower.includes('asset')) return ['assets'];
  return ['workflow'];
}

export function parsePlatformActionContext(key: string): Pick<NodeCatalogContext, 'module' | 'submodule'> {
  if (!key.startsWith('platform_action.')) return {};
  const segments = key.split('.');
  return {
    module: segments[2] ? titleizeSlug(segments[2]) : undefined,
    submodule: segments[3] ? titleizeSlug(segments[3]) : undefined,
  };
}

export function getCatalogContextForKey(
  key: string,
  fallbackModule?: string,
  fallbackSubmodule?: string,
): NodeCatalogContext {
  const meta = CURATED_NODE_METADATA[key];
  const configuredModule = normalizeConfiguredValue(fallbackModule);
  const configuredSubmodule = normalizeConfiguredValue(fallbackSubmodule);

  if (key.startsWith('platform_action.')) {
    const parsed = parsePlatformActionContext(key);
    const moduleName = configuredModule || parsed.module;
    const submodule = configuredSubmodule || parsed.submodule;
    return {
      key,
      domains: inferWorkflowDomainsFromModuleName(moduleName),
      module: moduleName,
      submodule,
      isPlatformFunction: true,
    };
  }

  const moduleName = configuredModule || meta?.module;
  return {
    key,
    domains: meta?.domains || inferWorkflowDomainsFromModuleName(moduleName),
    module: moduleName,
    submodule: configuredSubmodule,
    isPlatformFunction: false,
  };
}

export function getNodeCatalogContext(
  nodeType: string,
  config: Record<string, unknown>,
  nodeKey?: string,
): NodeCatalogContext {
  const currentKey =
    nodeType === 'start'
      ? normalizeConfiguredValue(config.trigger_type) || nodeKey || 'manual_trigger'
      : nodeType === 'action'
        ? normalizeConfiguredValue(config.action_name) || nodeKey || ''
        : nodeType === 'condition'
          ? normalizeConfiguredValue(config.condition_kind) || nodeKey || ''
          : nodeType === 'approval'
            ? normalizeConfiguredValue(config.approval_type) || nodeKey || 'single'
            : nodeType === 'timer'
              ? normalizeConfiguredValue(config.timer_kind) || nodeKey || 'wait_duration'
              : normalizeConfiguredValue(nodeKey) || '';

  return getCatalogContextForKey(
    currentKey,
    normalizeConfiguredValue(config.module),
    normalizeConfiguredValue(config.submodule),
  );
}

export function enrichWorkflowNodeConfig(
  nodeType: string,
  config: Record<string, unknown>,
  nodeKey?: string,
): Record<string, unknown> {
  const context = getNodeCatalogContext(nodeType, config, nodeKey);
  const nextConfig: Record<string, unknown> = { ...config };

  if (context.module) nextConfig.module = context.module;
  else delete nextConfig.module;

  if (context.submodule) nextConfig.submodule = context.submodule;
  else delete nextConfig.submodule;

  if (context.domains.length > 0) nextConfig.domains = context.domains;
  else delete nextConfig.domains;

  return nextConfig;
}

export function getRelevantTriggerKeys(context: NodeCatalogContext): string[] {
  const scope = expandDomainScope(context.domains);
  scope.add('core');
  return Array.from(TRIGGER_KEYS).filter((key) => {
    if (key === context.key) return true;
    return matchesDomainScope(getCatalogContextForKey(key).domains, scope);
  });
}

export function getRelevantConditionKeys(context: NodeCatalogContext): string[] {
  const scope = expandDomainScope(context.domains);
  return Array.from(CONDITION_KEYS).filter((key) => {
    if (key === context.key) return true;
    return matchesDomainScope(getCatalogContextForKey(key).domains, scope);
  });
}

export function getRelevantActionOptions(
  actionOptions: NodeOptionItem[],
  context: NodeCatalogContext,
): NodeOptionItem[] {
  const scope = expandDomainScope(context.domains);
  const filtered = actionOptions.filter((option) => {
    if (option.key === context.key) return true;
    if (SHARED_ACTION_KEYS.has(option.key)) return true;

    if (option.key.startsWith('platform_action.')) {
      if (context.module && option.module === context.module) return true;
      if (!context.module) {
        const optionDomains = inferWorkflowDomainsFromModuleName(option.module);
        return matchesDomainScope(optionDomains, scope);
      }
      return false;
    }

    const optionContext = getCatalogContextForKey(option.key, option.module, option.submodule);
    if (context.module && optionContext.module === context.module) return true;
    return matchesDomainScope(optionContext.domains, scope);
  });

  return filtered.sort((left, right) => {
    const leftSameModule = context.module && left.module === context.module ? 0 : 1;
    const rightSameModule = context.module && right.module === context.module ? 0 : 1;
    if (leftSameModule !== rightSameModule) return leftSameModule - rightSameModule;
    return left.label.localeCompare(right.label);
  });
}

export function formatWorkflowContextLabel(context: NodeCatalogContext): string {
  if (context.submodule && context.module) return `${context.module} / ${context.submodule}`;
  if (context.module) return context.module;
  if (context.domains.length === 0) return 'Workflow Engine';
  return context.domains.map((domain) => titleizeSlug(domain)).join(' / ');
}

// ─── Auto-trigger inference (mirrors backend definitions.py) ─────────────────
// When a Platform Function CRUD node is placed first after Start, the workflow
// auto-fires on the corresponding platform event. Frontend computes the same
// trigger_event the backend will derive, so it can be shown in the UI and
// submitted in the payload.
//
// Action key format: platform_action.{verb}.{module_path...}
// e.g. platform_action.create.erm.risk.create_risk → resource=risks verb=create
const PATH_TO_RESOURCE_FRONTEND: Array<[string, string]> = [
  // ── Compliance submodules (most-specific first) ──
  ['compliance.control_library',       'compliance.control_library'],
  ['compliance.statements',            'compliance.statements'],
  ['compliance.evidence',              'compliance.evidence'],
  ['compliance.evidence_requirements', 'compliance.evidence_requirements'],
  ['compliance.assessments',           'compliance.assessments'],
  ['compliance.controls',              'compliance.controls'],
  ['compliance.frameworks',            'compliance.frameworks'],
  ['compliance.plugin_runs',           'compliance.plugin_runs'],
  ['compliance',                       'compliance'],

  // ── Vulnerability Management submodules ──
  ['vulnerability_management.vulnerabilities', 'vulnmgmt.vulnerabilities'],
  ['vulnerability_management.departments',     'vulnmgmt.departments'],
  ['vulnerability_management.reports',         'vulnmgmt.reports'],
  ['vulnerability_management.sla_config',      'vulnmgmt.sla_config'],
  ['vulnerability_management',                 'vulnerabilities'],
  ['vuln_management',                          'vulnerabilities'],

  // ── Governance submodules ──
  ['governance.documents',             'governance.documents'],
  ['governance.committees',            'governance.committees'],
  ['governance.attestations',          'governance.attestations'],
  ['governance.clause_coverage',       'governance.clause_coverage'],
  ['governance.regulatory_changes',    'governance.regulatory_changes'],
  ['governance.regulatory_feeds',      'governance.regulatory_feeds'],
  ['governance.regulatory',            'governance.regulatory'],
  ['governance.critical_rules',        'governance.critical_rules'],
  ['governance.patch_proposals',       'governance.patch_proposals'],
  ['governance',                       'governance'],

  // ── Risk Management submodules ──
  ['risk_management.incidents',         'risk.incidents'],
  ['risk_management.kris',              'risk.kris'],
  ['risk_management.risk_register',     'risk.risk_register'],
  ['risk_management.risk_assessments',  'risk.risk_assessments'],
  ['risk_management.risk_framework',    'risk.risk_framework'],
  ['risk_management.internal_controls', 'risk.internal_controls'],
  ['risk_management.mitigation_actions','risk.mitigation_actions'],
  ['risk_management.vendor_risk',       'risk.vendor_risk'],
  ['risk_management.rcsa',              'risk.rcsa'],
  ['risk_management.appetite',          'risk.appetite'],
  ['risk_management.dependencies',      'risk.dependencies'],
  ['risk_management.reviews',           'risk.reviews'],
  ['risk_management.advanced_analytics','risk.advanced_analytics'],
  ['risk_management',                   'risks'],
  ['erm.incident',                      'risk.incidents'],
  ['erm.risk',                          'risks'],
  ['erm',                               'risks'],

  // ── Issue Management (only the issues lifecycle is a trigger source) ──
  ['issue_management.issues',           'issues'],

  // ── Audit (Auditor Portal) ──
  ['auditor_portal.controls',           'audit.controls'],
  ['auditor_portal.reviews',            'audit.reviews'],
  ['auditor_portal',                    'audits'],

  // ── Other modules ──
  ['evidence_mgmt',                     'compliance.evidence'],
  ['evidence',                          'compliance.evidence'],
  ['assets',                            'assets'],
  ['kri',                               'risk.kris'],
  ['audits',                            'audits'],
];

const PRIMARY_TRIGGER_FRONTEND: Record<string, string> = {
  // ── Compliance submodules ──
  'compliance.control_library:create':  'compliance.control_library.create',
  'compliance.control_library:update':  'compliance.control_library.update',
  'compliance.control_library:delete':  'compliance.control_library.delete',
  'compliance.statements:create':       'compliance.statements.create',
  'compliance.statements:update':       'compliance.statements.update',
  'compliance.statements:delete':       'compliance.statements.delete',
  'compliance.evidence:create':         'compliance.evidence.create',
  'compliance.evidence:update':         'compliance.evidence.update',
  'compliance.evidence:delete':         'compliance.evidence.delete',
  'compliance.evidence:upload':         'compliance.evidence.upload',
  'compliance.evidence_requirements:create': 'compliance.evidence_requirements.create',
  'compliance.evidence_requirements:update': 'compliance.evidence_requirements.update',
  'compliance.evidence_requirements:delete': 'compliance.evidence_requirements.delete',
  'compliance.assessments:create':      'compliance.assessments.create',
  'compliance.assessments:update':      'compliance.assessments.update',
  'compliance.assessments:delete':      'compliance.assessments.delete',
  'compliance.assessments:trigger':     'compliance.assessments.trigger',
  'compliance.controls:create':         'compliance.controls.create',
  'compliance.controls:update':         'compliance.controls.update',
  'compliance.controls:delete':         'compliance.controls.delete',
  'compliance.frameworks:create':       'compliance.frameworks.create',
  'compliance.frameworks:update':       'compliance.frameworks.update',
  'compliance.frameworks:delete':       'compliance.frameworks.delete',
  'compliance.frameworks:upload':       'compliance.frameworks.upload',
  'compliance.plugin_runs:create':      'compliance.plugin_runs.create',
  'compliance.plugin_runs:update':      'compliance.plugin_runs.update',
  'compliance.plugin_runs:trigger':     'compliance.plugin_runs.trigger',
  'compliance.plugin_runs:execute':     'compliance.plugin_runs.execute',
  'compliance.plugin_runs:failed':      'compliance.plugin_runs.failed',

  // ── Vulnerability Management submodules ──
  'vulnmgmt.vulnerabilities:create':   'vulnmgmt.vulnerabilities.create',
  'vulnmgmt.vulnerabilities:update':   'vulnmgmt.vulnerabilities.update',
  'vulnmgmt.vulnerabilities:delete':   'vulnmgmt.vulnerabilities.delete',
  'vulnmgmt.departments:create':       'vulnmgmt.departments.create',
  'vulnmgmt.departments:update':       'vulnmgmt.departments.update',
  'vulnmgmt.departments:delete':       'vulnmgmt.departments.delete',
  'vulnmgmt.reports:create':           'vulnmgmt.reports.create',
  'vulnmgmt.sla_config:create':        'vulnmgmt.sla_config.create',
  'vulnmgmt.sla_config:update':        'vulnmgmt.sla_config.update',
  'vulnmgmt.sla_config:delete':        'vulnmgmt.sla_config.delete',

  // ── Governance submodules ──
  'governance.documents:create':       'governance.documents.create',
  'governance.documents:update':       'governance.documents.update',
  'governance.documents:delete':       'governance.documents.delete',
  'governance.documents:trigger':      'governance.documents.trigger',
  'governance.documents:upload':       'governance.documents.upload',
  'governance.documents:approve':      'governance.documents.approve',
  'governance.documents:reject':       'governance.documents.reject',
  'governance.committees:create':      'governance.committees.create',
  'governance.committees:update':      'governance.committees.update',
  'governance.committees:delete':      'governance.committees.delete',
  'governance.committees:trigger':     'governance.committees.trigger',
  'governance.committees:upload':      'governance.committees.upload',
  'governance.attestations:create':    'governance.attestations.create',
  'governance.attestations:update':    'governance.attestations.update',
  'governance.attestations:delete':    'governance.attestations.delete',
  'governance.attestations:trigger':   'governance.attestations.trigger',
  'governance.clause_coverage:create': 'governance.clause_coverage.create',
  'governance.regulatory_changes:create': 'governance.regulatory_changes.create',
  'governance.regulatory_changes:update': 'governance.regulatory_changes.update',
  'governance.regulatory_changes:delete': 'governance.regulatory_changes.delete',
  'governance.regulatory_feeds:create':   'governance.regulatory_feeds.create',
  'governance.regulatory_feeds:update':   'governance.regulatory_feeds.update',
  'governance.critical_rules:create':     'governance.critical_rules.create',
  'governance.critical_rules:update':     'governance.critical_rules.update',
  'governance.patch_proposals:create':    'governance.patch_proposals.create',
  'governance.patch_proposals:update':    'governance.patch_proposals.update',

  // ── Risk Management submodules ──
  'risk.incidents:create':             'risk.incidents.create',
  'risk.incidents:update':             'risk.incidents.update',
  'risk.incidents:delete':             'risk.incidents.delete',
  'risk.kris:create':                  'risk.kris.create',
  'risk.kris:update':                  'risk.kris.update',
  'risk.kris:delete':                  'risk.kris.delete',
  'risk.risk_register:create':         'risk.risk_register.create',
  'risk.risk_register:update':         'risk.risk_register.update',
  'risk.risk_register:delete':         'risk.risk_register.delete',
  'risk.risk_assessments:create':      'risk.risk_assessments.create',
  'risk.risk_assessments:update':      'risk.risk_assessments.update',
  'risk.risk_assessments:delete':      'risk.risk_assessments.delete',
  'risk.risk_framework:create':        'risk.risk_framework.create',
  'risk.risk_framework:update':        'risk.risk_framework.update',
  'risk.risk_framework:delete':        'risk.risk_framework.delete',
  'risk.internal_controls:create':     'risk.internal_controls.create',
  'risk.internal_controls:update':     'risk.internal_controls.update',
  'risk.internal_controls:delete':     'risk.internal_controls.delete',
  'risk.mitigation_actions:create':    'risk.mitigation_actions.create',
  'risk.mitigation_actions:update':    'risk.mitigation_actions.update',
  'risk.mitigation_actions:delete':    'risk.mitigation_actions.delete',
  'risk.vendor_risk:create':           'risk.vendor_risk.create',
  'risk.vendor_risk:update':           'risk.vendor_risk.update',
  'risk.vendor_risk:delete':           'risk.vendor_risk.delete',
  'risk.rcsa:create':                  'risk.rcsa.create',
  'risk.rcsa:update':                  'risk.rcsa.update',
  'risk.rcsa:delete':                  'risk.rcsa.delete',
  'risk.appetite:create':              'risk.appetite.create',
  'risk.appetite:update':              'risk.appetite.update',
  'risk.dependencies:create':          'risk.dependencies.create',
  'risk.dependencies:update':          'risk.dependencies.update',
  'risk.reviews:create':               'risk.reviews.create',
  'risk.reviews:update':               'risk.reviews.update',

  // ── Module-level fallbacks (legacy broad triggers) ──
  'risks:create':            'risk_created',
  'risks:update':            'risk_updated',
  'risks:delete':            'risk_deleted',
  'vulnerabilities:create':  'vulnerability_created',
  'vulnerabilities:update':  'vulnerability_updated',
  'vulnerabilities:delete':  'vulnerability_deleted',
  'assets:create':           'asset_created',
  'assets:update':           'asset_updated',
  'assets:delete':           'asset_deleted',
  'governance:create':       'governance.create',
  'governance:update':       'assessment_status_change',
  'governance:delete':       'governance.delete',
  'governance:upload':       'governance.upload',
  'governance:approve':      'governance.approve',
  'governance:reject':       'governance.reject',
  'governance:trigger':      'policy_submitted_for_review',
  'compliance:create':       'compliance_gap_detected',
  'compliance:update':       'assessment_status_change',
  'compliance:delete':       'compliance.delete',
  'compliance:trigger':      'compliance_gap_detected',
  'audits:create':           'audits.create',
  'audits:update':           'audits.update',
  'audits:delete':           'audits.delete',

  // ── Issue Management ──
  'issues:create':           'issue_created',
  'issues:update':           'issue_state_changed',
  'issues:delete':           'issue-management.issues.delete',

  // ── Audit (Auditor Portal) — real write events ──
  'audit.controls:trigger':  'audit_control_approved',
  'audit.reviews:create':    'audit_review_submitted',
};

/**
 * Given an action_name like "platform_action.create.erm.risk.create_risk",
 * return the canonical trigger event the backend would infer, or null when
 * the action is not eligible to be a trigger.
 */
export function inferTriggerEventFromActionName(actionName?: string): string | null {
  if (!actionName || !actionName.startsWith('platform_action.')) return null;
  const parts = actionName.split('.');
  if (parts.length < 3) return null;
  const verb = parts[1];
  const modulePath = parts.slice(2).join('.');
  let resource: string | null = null;
  for (const [prefix, res] of PATH_TO_RESOURCE_FRONTEND) {
    if (modulePath.startsWith(prefix)) { resource = res; break; }
  }
  if (!resource) return null;
  const verbKey = ['create', 'update', 'delete', 'trigger'].includes(verb) ? verb : 'update';
  return PRIMARY_TRIGGER_FRONTEND[`${resource}:${verbKey}`] || null;
}

/**
 * Returns true when an action key is eligible to act as the workflow trigger
 * (i.e. when used as the first node after Start, the backend will derive a
 * concrete trigger_event for it). Used to render the ⚡ badge in the palette.
 */
export function isTriggerEligibleAction(actionKey: string): boolean {
  return inferTriggerEventFromActionName(actionKey) !== null;
}

/**
 * Compute the workflow's trigger_event from the first node connected after the
 * Start placeholder. Mirrors backend `_infer_trigger_event` plus the existing
 * dedicated-trigger-node behaviour. Returns null when nothing can be inferred.
 */
export function getTriggerEventForFirstNode(
  firstNode: { nodeType?: string; config?: Record<string, unknown> } | null | undefined,
): string | null {
  if (!firstNode) return null;
  const cfg = firstNode.config || {};
  if (firstNode.nodeType === 'start') {
    const tt = typeof cfg.trigger_type === 'string' ? cfg.trigger_type : '';
    if (!tt) return null;
    return TRIGGER_EVENT_MAP[tt] || tt;
  }
  if (firstNode.nodeType === 'action') {
    const action = typeof cfg.action_name === 'string' ? cfg.action_name : '';
    return inferTriggerEventFromActionName(action);
  }
  return null;
}

export type WorkflowGraphValidation =
  | { ok: true; firstNodeKey: string; computedTrigger: string }
  | { ok: false; error: string; firstNodeKey?: string };

/**
 * Validate the workflow graph for save-time enforcement. Returns ok=true with
 * computed trigger event when valid, or ok=false with a human-readable error.
 *
 * Rules enforced:
 *   1. Exactly one Start placeholder must exist.
 *   2. Start must have exactly one outgoing edge.
 *   3. The first node after Start must yield a valid trigger_event (either a
 *      dedicated trigger node, or a Platform Function CRUD action eligible
 *      for trigger inference).
 *   4. The graph must contain at least one real node beyond the Start
 *      placeholder and optional End terminal — true empty drafts (Start only
 *      or Start→End only) are rejected because they produce no derivable
 *      trigger and would create noise rows that can never run. Dedicated
 *      trigger nodes (palette-added Manual / Schedule / Webhook) DO count as
 *      real nodes for this check.
 */
export function validateWorkflowGraph(
  nodes: Array<{ id: string; data: { nodeType: string; config?: Record<string, unknown>; isStart?: boolean } }>,
  edges: Array<{ source: string; target: string }>,
): WorkflowGraphValidation {
  // Reject true empty drafts here — Start placeholder only, or Start→End only,
  // produces no derivable trigger and would create a noise definition row that
  // can never run. Dedicated trigger nodes (palette Manual / Schedule / Webhook)
  // serialize as nodeType==='start' with a generated id and DO count as work.
  const hasWorkNodes = nodes.some(
    (n) => n.id !== 'start' && n.data.nodeType !== 'end',
  );
  if (!hasWorkNodes) {
    return {
      ok: false,
      error: 'Add at least one node after Start so the workflow has something to do.',
    };
  }
  const startNodes = nodes.filter((n) => n.id === 'start' || n.data.isStart || n.data.nodeType === 'start');
  if (startNodes.length === 0) {
    return { ok: false, error: 'Add a Start node to begin the workflow.' };
  }
  // The Start placeholder uses id "start"; trigger nodes from the palette have
  // nodeType="start" but a generated id. Prefer the placeholder when present.
  const startNode = startNodes.find((n) => n.id === 'start') || startNodes[0];
  const startEdges = edges.filter((e) => e.source === startNode.id);
  if (startEdges.length === 0) {
    return { ok: false, error: 'Connect the Start node to the first action of your workflow.' };
  }
  if (startEdges.length > 1) {
    return { ok: false, error: 'Start can only connect to one node. Remove the extra connections.' };
  }
  const firstNode = nodes.find((n) => n.id === startEdges[0].target);
  if (!firstNode) {
    return { ok: false, error: 'The Start connection points to a node that no longer exists.' };
  }
  const computed = getTriggerEventForFirstNode({
    nodeType: firstNode.data.nodeType,
    config: firstNode.data.config,
  });
  if (!computed) {
    const isAction = firstNode.data.nodeType === 'action';
    const reason = isAction
      ? 'This action cannot be used as a trigger. Choose a Create / Update / Delete platform function (marked with ⚡), or insert a dedicated trigger node first.'
      : 'Configure the trigger event on the first node so the workflow knows when to run.';
    return { ok: false, error: reason, firstNodeKey: firstNode.id };
  }
  return { ok: true, firstNodeKey: firstNode.id, computedTrigger: computed };
}

export const TRIGGER_EVENT_MAP: Record<string, string> = {
  // Core
  manual_trigger: 'manual.trigger',
  schedule_recurring: 'scheduler.recurring',
  webhook: 'workflow.webhook',
  // Evidence & compliance
  evidence_uploaded: 'evidence_uploaded',
  evidence_approved: 'evidence_approved',
  evidence_expires: 'evidence_expires',
  framework_deadline_approaching: 'framework_deadline_approaching',
  framework_evidence_complete: 'framework_evidence_complete',
  assessment_status_change: 'assessment_status_change',
  compliance_gap_detected: 'compliance_gap_detected',
  certification_expiry_approaching: 'certification_expiry_approaching',
  // Risk
  risk_created: 'risk_created',
  risk_updated: 'risk_updated',
  risk_deleted: 'risk_deleted',
  risk_status_changed: 'risk_status_changed',
  risk_score_exceeds_threshold: 'risk_score_exceeds_threshold',
  kri_breach: 'kri_breach',
  incident_reported: 'incident_reported',
  // Vulnerability
  vulnerability_created: 'vulnerability_created',
  vulnerability_updated: 'vulnerability_updated',
  vulnerability_deleted: 'vulnerability_deleted',
  new_vulnerability_detected: 'new_vulnerability_detected',
  vulnerability_sla_breach: 'vulnerability_sla_breach',
  vulnerability_sla_warning: 'vulnerability_sla_warning',
  // Governance & policy
  policy_submitted_for_review: 'policy_submitted_for_review',
  policy_review_due: 'policy_review_due',
  policy_approved: 'policy_approved',
  control_review_due: 'control_review_due',
  attestation_overdue: 'attestation_overdue',
  // Governance documents
  governance_document_created: 'governance_document_created',
  governance_document_expires: 'governance_document_expires',
  governance_document_published: 'governance_document_published',
  // Auditor Portal
  audit_review_submitted: 'audit_review_submitted',
  audit_control_approved: 'audit_control_approved',
  // IT Assets
  asset_created: 'asset_created',
  asset_updated: 'asset_updated',
  asset_deleted: 'asset_deleted',
  // Control Library
  control_group_created: 'control_group_created',
  control_group_updated: 'control_group_updated',
  control_group_deleted: 'control_group_deleted',
  // Governance: document review & sign-off
  document_review_started: 'document_review_started',
  document_review_completed: 'document_review_completed',
  document_signoff_requested: 'document_signoff_requested',
  document_signoff_completed: 'document_signoff_completed',
  // Governance: committees
  committee_created: 'committee_created',
  committee_updated: 'committee_updated',
  committee_meeting_scheduled: 'committee_meeting_scheduled',
  committee_meeting_completed: 'committee_meeting_completed',
  committee_action_overdue: 'committee_action_overdue',
  // Governance: attestations & certification
  attestation_requested: 'attestation_requested',
  attestation_completed: 'attestation_completed',
  attestation_campaign_activated: 'attestation_campaign_activated',
  attestation_campaign_completed: 'attestation_campaign_completed',
  attestation_campaign_escalated: 'attestation_campaign_escalated',
  // Governance: regulatory changes & exceptions
  regulatory_change_created: 'regulatory_change_created',
  regulatory_change_closed: 'regulatory_change_closed',
  regulatory_task_created: 'regulatory_task_created',
  policy_exception_created: 'policy_exception_created',
  policy_exception_approved: 'policy_exception_approved',
  policy_exception_revoked: 'policy_exception_revoked',
  // Risk / ERM: mitigation actions & incidents
  mitigation_action_created: 'mitigation_action_created',
  mitigation_action_completed: 'mitigation_action_completed',
  mitigation_action_overdue: 'mitigation_action_overdue',
  incident_closed: 'incident_closed',
  incident_updated: 'incident_updated',
  // Risk / ERM: KRIs
  kri_measured: 'kri_measured',
  kri_breach_resolved: 'kri_breach_resolved',
  // Risk / ERM: reviews & assessments
  risk_review_scheduled: 'risk_review_scheduled',
  risk_review_completed: 'risk_review_completed',
  risk_closed: 'risk_closed',
  risk_reopened: 'risk_reopened',
  risk_assessment_created: 'risk_assessment_created',
  risk_assessment_completed: 'risk_assessment_completed',
  // Risk / ERM: RCSA
  rcsa_campaign_activated: 'rcsa_campaign_activated',
  rcsa_assessment_submitted: 'rcsa_assessment_submitted',
  rcsa_assessment_approved: 'rcsa_assessment_approved',
  // Risk / ERM: internal controls
  internal_control_submitted: 'internal_control_submitted',
  internal_control_approved: 'internal_control_approved',
  internal_control_test_failed: 'internal_control_test_failed',
  appetite_breach_detected: 'appetite_breach_detected',
  // Third-Party Risk: vendors, assessments, questionnaires
  vendor_created: 'vendor_created',
  vendor_updated: 'vendor_updated',
  vendor_assessment_created: 'vendor_assessment_created',
  vendor_assessment_approved: 'vendor_assessment_approved',
  vendor_questionnaire_sent: 'vendor_questionnaire_sent',
  vendor_questionnaire_completed: 'vendor_questionnaire_completed',
  vendor_incident_created: 'vendor_incident_created',
  vendor_remediation_created: 'vendor_remediation_created',
  vendor_reassessment_scheduled: 'vendor_reassessment_scheduled',
  vendor_offboarding_updated: 'vendor_offboarding_updated',
  // Compliance: evidence & access reviews
  evidence_submitted: 'evidence_submitted',
  evidence_rejected: 'evidence_rejected',
  evidence_renewed: 'evidence_renewed',
  evidence_stale: 'evidence_stale',
  audit_package_finalized: 'audit_package_finalized',
  evidence_linked_to_control: 'evidence_linked_to_control',
  compliance_assessment_created: 'compliance_assessment_created',
  compliance_assessment_completed: 'compliance_assessment_completed',
  framework_published: 'framework_published',
  access_review_campaign_created: 'access_review_campaign_created',
  access_review_item_decided: 'access_review_item_decided',
  access_review_campaign_closed: 'access_review_campaign_closed',
  access_review_escalated: 'access_review_escalated',
  // Issues / CAPA
  issue_closed: 'issue_closed',
  issue_reopened: 'issue_reopened',
  issue_assigned: 'issue_assigned',
  capa_action_created: 'capa_action_created',
  capa_action_completed: 'capa_action_completed',
  // Assets / BCM / Administration / Tasks
  asset_criticality_changed: 'asset_criticality_changed',
  bcm_plan_created: 'bcm_plan_created',
  bcm_plan_activated: 'bcm_plan_activated',
  bcm_drill_scheduled: 'bcm_drill_scheduled',
  bcm_drill_completed: 'bcm_drill_completed',
  bcm_bia_updated: 'bcm_bia_updated',
  user_created: 'user_created',
  user_updated: 'user_updated',
  user_deactivated: 'user_deactivated',
  role_created: 'role_created',
  role_updated: 'role_updated',
  password_policy_updated: 'password_policy_updated',
  critical_task_created: 'critical_task_created',
  critical_task_completed: 'critical_task_completed',
  critical_task_overdue: 'critical_task_overdue',
  // Optional metrics
  kpi_breached: 'kpi_breached',
};

export const NODE_TYPE_LABELS: Record<string, string> = {
  // Core triggers
  manual_trigger: 'Manual Trigger',
  schedule_recurring: 'Recurring Schedule',
  webhook: 'Webhook',
  // Evidence & compliance triggers
  evidence_uploaded: 'Evidence Uploaded',
  evidence_approved: 'Evidence Approved',
  evidence_expires: 'Evidence Expires',
  framework_deadline_approaching: 'Framework Deadline',
  framework_evidence_complete: 'Evidence Complete',
  assessment_status_change: 'Assessment Changed',
  compliance_gap_detected: 'Gap Detected',
  certification_expiry_approaching: 'Cert. Expiry',
  // Risk triggers
  risk_created: 'Risk Created',
  risk_updated: 'Risk Updated',
  risk_deleted: 'Risk Deleted',
  risk_status_changed: 'Risk Status Changed',
  risk_score_exceeds_threshold: 'Risk Threshold',
  kri_breach: 'KRI Breach',
  incident_reported: 'Incident Reported',
  // Vulnerability triggers
  vulnerability_created: 'Vulnerability Created',
  vulnerability_updated: 'Vulnerability Updated',
  vulnerability_deleted: 'Vulnerability Deleted',
  new_vulnerability_detected: 'Auto-Detected Vuln',
  vulnerability_sla_breach: 'SLA Breached',
  vulnerability_sla_warning: 'SLA Warning',
  // Governance triggers
  policy_submitted_for_review: 'Policy Submitted for Review',
  policy_review_due: 'Policy Review Due',
  policy_approved: 'Policy Approved',
  control_review_due: 'Control Review Due',
  attestation_overdue: 'Attestation Overdue',
  // Governance document triggers
  governance_document_created: 'Document Created',
  governance_document_expires: 'Document Expires',
  governance_document_published: 'Document Published',
  // Auditor Portal triggers
  audit_review_submitted: 'Auditor Review Submitted',
  audit_control_approved: 'Auditor Control Approved',
  // IT Asset triggers
  asset_created: 'Asset Created',
  asset_updated: 'Asset Updated',
  asset_deleted: 'Asset Deleted',
  // Control Library triggers
  control_group_created: 'Control Group Created',
  control_group_updated: 'Control Group Updated',
  control_group_deleted: 'Control Group Deleted',
  // Governance: document review & sign-off
  document_review_started: 'Document Review Started',
  document_review_completed: 'Document Review Completed',
  document_signoff_requested: 'Document Sign-Off Requested',
  document_signoff_completed: 'Document Sign-Off Completed',
  // Governance: committees
  committee_created: 'Committee Created',
  committee_updated: 'Committee Updated',
  committee_meeting_scheduled: 'Committee Meeting Scheduled',
  committee_meeting_completed: 'Committee Meeting Completed',
  committee_action_overdue: 'Committee Action Overdue',
  // Governance: attestations & certification
  attestation_requested: 'Attestation Requested',
  attestation_completed: 'Attestation Completed',
  attestation_campaign_activated: 'Attestation Campaign Activated',
  attestation_campaign_completed: 'Attestation Campaign Completed',
  attestation_campaign_escalated: 'Attestation Campaign Escalated',
  // Governance: regulatory changes & exceptions
  regulatory_change_created: 'Regulatory Change Created',
  regulatory_change_closed: 'Regulatory Change Closed',
  regulatory_task_created: 'Regulatory Task Created',
  policy_exception_created: 'Policy Exception Created',
  policy_exception_approved: 'Policy Exception Approved',
  policy_exception_revoked: 'Policy Exception Revoked',
  // Risk / ERM: mitigation actions & incidents
  mitigation_action_created: 'Mitigation Action Created',
  mitigation_action_completed: 'Mitigation Action Completed',
  mitigation_action_overdue: 'Mitigation Action Overdue',
  incident_closed: 'Incident Closed',
  incident_updated: 'Incident Updated',
  // Risk / ERM: KRIs
  kri_measured: 'KRI Measured',
  kri_breach_resolved: 'KRI Breach Resolved',
  // Risk / ERM: reviews & assessments
  risk_review_scheduled: 'Risk Review Scheduled',
  risk_review_completed: 'Risk Review Completed',
  risk_closed: 'Risk Closed',
  risk_reopened: 'Risk Reopened',
  risk_assessment_created: 'Risk Assessment Created',
  risk_assessment_completed: 'Risk Assessment Completed',
  // Risk / ERM: RCSA
  rcsa_campaign_activated: 'RCSA Campaign Activated',
  rcsa_assessment_submitted: 'RCSA Assessment Submitted',
  rcsa_assessment_approved: 'RCSA Assessment Approved',
  // Risk / ERM: internal controls
  internal_control_submitted: 'Internal Control Submitted',
  internal_control_approved: 'Internal Control Approved',
  internal_control_test_failed: 'Internal Control Test Failed',
  appetite_breach_detected: 'Appetite Breach Detected',
  // Third-Party Risk
  vendor_created: 'Vendor Created',
  vendor_updated: 'Vendor Updated',
  vendor_assessment_created: 'Vendor Assessment Created',
  vendor_assessment_approved: 'Vendor Assessment Approved',
  vendor_questionnaire_sent: 'Vendor Questionnaire Sent',
  vendor_questionnaire_completed: 'Vendor Questionnaire Completed',
  vendor_incident_created: 'Vendor Incident Created',
  vendor_remediation_created: 'Vendor Remediation Created',
  vendor_reassessment_scheduled: 'Vendor Reassessment Scheduled',
  vendor_offboarding_updated: 'Vendor Offboarding Updated',
  // Compliance: evidence & access reviews
  evidence_submitted: 'Evidence Submitted',
  evidence_rejected: 'Evidence Rejected',
  evidence_renewed: 'Evidence Renewed',
  evidence_stale: 'Evidence Stale',
  audit_package_finalized: 'Audit Package Finalized',
  evidence_linked_to_control: 'Evidence Linked To Control',
  compliance_assessment_created: 'Compliance Assessment Created',
  compliance_assessment_completed: 'Compliance Assessment Completed',
  framework_published: 'Framework Published',
  access_review_campaign_created: 'Access Review Campaign Created',
  access_review_item_decided: 'Access Review Item Decided',
  access_review_campaign_closed: 'Access Review Campaign Closed',
  access_review_escalated: 'Access Review Escalated',
  // Issues / CAPA
  issue_closed: 'Issue Closed',
  issue_reopened: 'Issue Reopened',
  issue_assigned: 'Issue Assigned',
  capa_action_created: 'CAPA Action Created',
  capa_action_completed: 'CAPA Action Completed',
  // Assets / BCM / Administration / Tasks
  asset_criticality_changed: 'Asset Criticality Changed',
  bcm_plan_created: 'BCM Plan Created',
  bcm_plan_activated: 'BCM Plan Activated',
  bcm_drill_scheduled: 'BCM Drill Scheduled',
  bcm_drill_completed: 'BCM Drill Completed',
  bcm_bia_updated: 'BCM BIA Updated',
  user_created: 'User Created',
  user_updated: 'User Updated',
  user_deactivated: 'User Deactivated',
  role_created: 'Role Created',
  role_updated: 'Role Updated',
  password_policy_updated: 'Password Policy Updated',
  critical_task_created: 'Critical Task Created',
  critical_task_completed: 'Critical Task Completed',
  critical_task_overdue: 'Critical Task Overdue',
  // Optional metrics
  kpi_breached: 'KPI Breached',
  // Actions - notifications
  send_notification_email: 'Send Email',
  send_in_app_alert: 'In-System Alert',
  escalate_to_management: 'Escalate',
  call_webhook_api: 'Call Webhook',
  generate_report: 'Generate Report',
  // Actions - evidence
  request_evidence_upload: 'Request Evidence',
  request_evidence_review: 'Request Review',
  approve_evidence: 'Approve Evidence',
  reject_evidence: 'Reject Evidence',
  update_compliance_status: 'Update Compliance',
  start_compliance_assessment: 'Start Assessment',
  close_compliance_gap: 'Close Gap',
  link_evidence_to_control: 'Link Evidence',
  assign_control_owner: 'Assign Owner',
  // Actions - risk
  create_risk_entry: 'Create Risk',
  update_risk_status: 'Update Risk Status',
  assign_risk_owner: 'Assign Risk Owner',
  trigger_risk_review: 'Trigger Risk Review',
  create_remediation_task: 'Create Remediation',
  // Actions - vulnerability
  assign_vulnerability_owner: 'Assign Vuln Owner',
  update_vulnerability_status: 'Update Vuln Status',
  create_vulnerability_entry: 'Create Vulnerability',
  // Actions - governance
  create_policy_review_task: 'Policy Review Task',
  publish_policy: 'Publish Policy',
  submit_policy_exception: 'Submit Exception',
  approve_policy_exception: 'Approve Exception',
  request_attestation: 'Request Attestation',
  // Actions - control library
  update_control_effectiveness: 'Update Control Rating',
  set_control_not_applicable: 'Set Not Applicable',
  // Actions - KRI management
  create_kri: 'Create KRI',
  update_kri_value: 'Log KRI Value',
  resolve_kri_breach: 'Resolve KRI Breach',
  // Actions - incident management
  create_incident: 'Create Incident',
  update_incident_status: 'Update Incident Status',
  assign_incident_owner: 'Assign Incident Owner',
  close_incident: 'Close Incident',
  // Actions - mitigation plans
  create_mitigation_plan: 'Create Mitigation Plan',
  update_mitigation_status: 'Update Mitigation Status',
  link_risk_to_mitigation: 'Link Risk to Mitigation',
  // Actions - RCSA
  initiate_rcsa: 'Initiate RCSA',
  submit_rcsa_results: 'Submit RCSA Results',
  review_rcsa: 'Review RCSA',
  // Actions - risk reviews
  schedule_risk_review: 'Schedule Risk Review',
  complete_risk_review: 'Complete Risk Review',
  // Actions - risk assessments
  create_risk_assessment: 'Create Risk Assessment',
  update_risk_assessment_status: 'Update Assessment Status',
  assign_risk_assessor: 'Assign Risk Assessor',
  // Actions - internal controls
  create_internal_control: 'Create Internal Control',
  test_internal_control: 'Test Control',
  update_control_test_result: 'Update Test Result',
  // Actions - risk appetite
  set_risk_appetite: 'Set Risk Appetite',
  update_risk_tolerance: 'Update Risk Tolerance',
  // Actions - risk dependencies
  add_risk_dependency: 'Add Risk Dependency',
  // Conditions
  check_risk_level: 'Check Risk Level',
  check_compliance_status: 'Check Compliance',
  check_evidence_age: 'Check Evidence Age',
  check_evidence_completeness: 'Check Coverage %',
  check_framework_coverage: 'Check Framework %',
  check_vulnerability_severity: 'Check Vuln Severity',
  check_policy_status: 'Check Policy Status',
  check_approval_status: 'Check Approval',
  check_user_role: 'Check Role',
  evaluate_business_unit: 'Business Unit Check',
  expression_builder: 'Expression',
  // Approvals
  single: 'Single Approver',
  multi_level: 'Multi-Level Approval',
  quorum: 'Quorum Approval',
  // Timers
  wait_duration: 'Wait Duration',
  wait_until_date: 'Wait Until Date',
  sla_countdown: 'SLA Countdown',
  // Control
  subworkflow: 'Sub-Workflow',
  end: 'End',
  start: 'Start',
};

export const PALETTE_DESCRIPTIONS: Record<string, string> = {
  // Core triggers
  manual_trigger: 'Manually triggered by a user',
  schedule_recurring: 'Runs on a recurring schedule (daily, weekly, etc.)',
  webhook: 'Triggered by an external webhook call',
  // Evidence & compliance triggers
  evidence_uploaded: 'Fires when evidence is uploaded against a framework requirement',
  evidence_approved: 'Fires when uploaded evidence is reviewed and approved',
  evidence_expires: 'Fires when evidence is about to expire',
  framework_deadline_approaching: 'Fires when a framework assessment deadline is approaching',
  framework_evidence_complete: 'Fires when all required evidence for a framework scope is uploaded',
  assessment_status_change: 'Fires when a compliance assessment status changes',
  compliance_gap_detected: 'Fires when a gap is identified in a compliance assessment',
  certification_expiry_approaching: 'Fires when a compliance certification is nearing expiry',
  // Risk triggers
  risk_created: 'Fires when a new risk entry is added to the risk register',
  risk_updated: 'Fires when an existing risk entry is updated',
  risk_deleted: 'Fires when a risk entry is deleted from the register',
  risk_status_changed: 'Fires when a risk\'s status or treatment changes',
  risk_score_exceeds_threshold: 'Fires when a risk score exceeds a defined threshold',
  kri_breach: 'Fires when a KRI breaches its threshold',
  incident_reported: 'Fires when an incident is reported',
  // Vulnerability triggers
  vulnerability_created: 'Fires when a new vulnerability is created',
  vulnerability_updated: 'Fires when an existing vulnerability is updated',
  vulnerability_deleted: 'Fires when a vulnerability is deleted',
  new_vulnerability_detected: 'Fires when a new vulnerability is detected',
  vulnerability_sla_breach: 'Fires when a vulnerability SLA deadline has been breached',
  vulnerability_sla_warning: 'Fires when a vulnerability SLA deadline is approaching',
  // Governance triggers
  policy_submitted_for_review: 'Fires when a policy is submitted for review',
  policy_review_due: 'Fires when a policy is due for review',
  policy_approved: 'Fires when a policy is approved or published',
  control_review_due: 'Fires when a control effectiveness review is due',
  attestation_overdue: 'Fires when an attestation campaign response is overdue',
  // Auditor Portal triggers
  audit_review_submitted: 'Fires when an auditor submits a control review',
  audit_control_approved: 'Fires when an auditor auto-approves a control',
  // IT Asset triggers
  asset_created: 'Fires when a new IT asset is added to the inventory',
  asset_updated: 'Fires when an IT asset record is updated',
  asset_deleted: 'Fires when an IT asset is removed from the inventory',
  // Control Library triggers
  control_group_created: 'Fires when a new control group is created in the Control Library',
  control_group_updated: 'Fires when a control group is updated in the Control Library',
  control_group_deleted: 'Fires when a control group is deleted from the Control Library',
  // Actions - notifications
  send_notification_email: 'Sends a notification email to specified recipients',
  send_in_app_alert: 'Sends an in-system alert to selected users or roles — appears in their navbar notification bell',
  escalate_to_management: 'Escalates an issue through configurable escalation levels',
  call_webhook_api: 'Calls an external webhook or API endpoint',
  generate_report: 'Generates a compliance or risk report and optionally sends it',
  // Actions - evidence
  request_evidence_upload: 'Sends a request for evidence to be uploaded for a framework',
  request_evidence_review: 'Requests a manual review of uploaded evidence',
  approve_evidence: 'Marks uploaded evidence as approved and optionally notifies stakeholders',
  reject_evidence: 'Returns evidence for revision with reviewer notes and notifications',
  update_compliance_status: 'Updates the status of a compliance assessment',
  start_compliance_assessment: 'Starts a compliance assessment and assigns accountable users',
  close_compliance_gap: 'Marks a compliance gap as remediated or accepted',
  link_evidence_to_control: 'Associates matching evidence with one or more controls',
  assign_control_owner: 'Assigns an owner to a control in the control library',
  // Actions - risk
  create_risk_entry: 'Creates a new risk entry in the risk register',
  update_risk_status: 'Updates the status or treatment of an existing risk',
  assign_risk_owner: 'Assigns or reassigns ownership of a risk record',
  trigger_risk_review: 'Starts a risk review cycle with due dates and reviewers',
  create_remediation_task: 'Creates a remediation task assigned to users or roles',
  // Actions - vulnerability
  assign_vulnerability_owner: 'Assigns a vulnerability finding to a user or team',
  update_vulnerability_status: 'Updates the lifecycle status of matching vulnerability items',
  create_vulnerability_entry: 'Creates a new vulnerability record with severity and ownership',
  // Actions - governance
  create_policy_review_task: 'Creates a task for policy review and assigns reviewers',
  publish_policy: 'Publishes a policy or governance document and notifies recipients',
  submit_policy_exception: 'Creates a policy exception request with justification and approvers',
  approve_policy_exception: 'Approves an outstanding policy exception and records notes',
  request_attestation: 'Launches an attestation request to selected users or roles',
  // Actions - control library
  update_control_effectiveness: 'Updates the effectiveness rating for matching controls',
  set_control_not_applicable: 'Marks controls as not applicable with justification and approval routing',
  // Actions - KRI management
  create_kri: 'Creates a new Key Risk Indicator linked to a risk, with thresholds and frequency',
  update_kri_value: 'Logs a new KRI measurement value and updates the current status (green/amber/red)',
  resolve_kri_breach: 'Acknowledges and resolves a KRI threshold breach, restoring green status',
  // Actions - incident management
  create_incident: 'Creates a new risk incident record with severity and optional risk linkage',
  update_incident_status: 'Updates the lifecycle status of an incident (investigating, contained, etc.)',
  assign_incident_owner: 'Assigns an incident response owner to an incident record',
  close_incident: 'Closes and resolves an incident with lessons learned and corrective actions',
  // Actions - mitigation plans
  create_mitigation_plan: 'Creates a mitigation action plan for a risk with owner and priority',
  update_mitigation_status: 'Updates the progress status of a risk mitigation plan',
  link_risk_to_mitigation: 'Associates a risk with an existing mitigation action plan',
  // Actions - RCSA
  initiate_rcsa: 'Initiates a new Risk Control Self-Assessment campaign cycle',
  submit_rcsa_results: 'Marks an RCSA assessment as submitted for review',
  review_rcsa: 'Moves an RCSA assessment into under-review status for approver action',
  // Actions - risk reviews
  schedule_risk_review: 'Schedules a periodic risk review with a due date and review cycle',
  complete_risk_review: 'Records completion of a risk review with findings and recommendations',
  // Actions - risk assessments
  create_risk_assessment: 'Initiates a formal risk assessment campaign with type and methodology',
  update_risk_assessment_status: 'Updates the progress status of a risk assessment',
  assign_risk_assessor: 'Assigns a lead assessor to a risk assessment',
  // Actions - internal controls
  create_internal_control: 'Creates a new internal control record with type and category',
  test_internal_control: 'Logs a design or operating effectiveness test for an internal control',
  update_control_test_result: 'Records or updates the outcome of a control test with management response',
  // Actions - risk appetite
  set_risk_appetite: 'Defines or updates the risk appetite level for a risk category',
  update_risk_tolerance: 'Updates quantitative risk tolerance thresholds for a risk category',
  // Actions - risk dependencies
  add_risk_dependency: 'Creates a dependency link between two risks with type and impact factor',
  // Conditions
  check_risk_level: 'Branches based on risk level (Critical/High/Medium/Low)',
  check_compliance_status: 'Branches based on compliance assessment status',
  check_evidence_age: 'Branches based on evidence age in days',
  check_evidence_completeness: 'Branches based on % of required evidences uploaded',
  check_framework_coverage: 'Branches based on framework coverage percentage',
  check_vulnerability_severity: 'Branches based on vulnerability severity level',
  check_policy_status: 'Branches based on policy lifecycle status',
  check_approval_status: 'Branches based on approval step status',
  check_user_role: 'Branches based on the current user\'s role',
  evaluate_business_unit: 'Branches based on business unit',
  expression_builder: 'Custom condition using a JSON expression or rule',
  // Approvals
  single: 'Requires approval from a single designated approver',
  multi_level: 'Requires sequential approvals from multiple levels',
  quorum: 'Requires a quorum (e.g., 3 of 5) to approve',
  // Timers
  wait_duration: 'Pauses the workflow for a specified duration',
  wait_until_date: 'Pauses until a specific date or time',
  sla_countdown: 'SLA timer with automatic escalation on breach',
  // Control
  subworkflow: 'Embeds and executes a reusable sub-workflow',
  end: 'Marks the end of the workflow',
};

// ─── TRIGGER_TEMPLATE_VARS ───────────────────────────────────────────────────
// Maps each trigger key → ordered sections of template variables that can be
// used in email subjects, bodies, and in-app alert messages.

export type TemplateVar = {
  key: string;
  label: string;
};

export type TemplateSections = {
  section: string;
  vars: TemplateVar[];
};

const _COMMON: TemplateVar[] = [
  { key: 'workflow_name',    label: 'Workflow Name'      },
  { key: 'event_timestamp',  label: 'Event Timestamp'    },
  { key: 'resource_type',    label: 'Resource Type'      },
  { key: 'resource_id',      label: 'Record ID'          },
  { key: 'action',           label: 'Event Action'       },
  { key: 'created_by_name',  label: 'Created By (Name)'  },
  { key: 'created_by_email', label: 'Created By (Email)' },
];

const _RISK: TemplateVar[] = [
  { key: 'title',             label: 'Risk Title'         },
  { key: 'description',       label: 'Description'        },
  { key: 'category',          label: 'Category'           },
  { key: 'status',            label: 'Status'             },
  { key: 'severity',          label: 'Severity'           },
  { key: 'inherent_score',    label: 'Inherent Score'     },
  { key: 'residual_score',    label: 'Residual Score'     },
  { key: 'risk_appetite',     label: 'Risk Appetite'      },
  { key: 'due_date',          label: 'Due Date'           },
  { key: 'register_type',     label: 'Register Type'      },
  { key: 'risk_sub_category', label: 'Sub-Category'       },
  { key: 'owner_name',        label: 'Risk Owner (Name)'  },
  { key: 'owner_email',       label: 'Risk Owner (Email)' },
];

const _VULN: TemplateVar[] = [
  { key: 'title',                label: 'Vulnerability Title' },
  { key: 'description',          label: 'Description' },
  { key: 'severity',             label: 'Severity' },
  { key: 'cvss_score',           label: 'CVSS Score' },
  { key: 'status',               label: 'Status' },
  { key: 'cve_id',               label: 'CVE ID' },
  { key: 'cwe_id',               label: 'CWE ID' },
  { key: 'affected_component',   label: 'Affected Component' },
  { key: 'affected_host',        label: 'Affected Host' },
  { key: 'affected_url',         label: 'Affected URL' },
  { key: 'due_date',             label: 'Due Date' },
  { key: 'vuln_id',              label: 'Vuln ID'                  },
  { key: 'recommendation',       label: 'Recommendation'           },
  { key: 'remediation_plan',     label: 'Remediation Plan'         },
  { key: 'sla_remediation_days', label: 'SLA Remediation Days'     },
  { key: 'sla_due_date',         label: 'SLA Due Date'             },
  { key: 'assignee_name',        label: 'Assignee (Name)'          },
  { key: 'assignee_email',       label: 'Assignee (Email)'         },
  { key: 'owner_name',           label: 'Owner (Name)'             },
  { key: 'owner_email',          label: 'Owner (Email)'            },
];

const _POLICY: TemplateVar[] = [
  { key: 'title',            label: 'Policy Title' },
  { key: 'description',      label: 'Description' },
  { key: 'doc_type',         label: 'Document Type' },
  { key: 'status',           label: 'Status' },
  { key: 'current_version',  label: 'Current Version' },
  { key: 'next_review_date', label: 'Next Review Date' },
  { key: 'expiry_date',      label: 'Expiry Date' },
];

const _EVIDENCE: TemplateVar[] = [
  { key: 'name',          label: 'Evidence Name' },
  { key: 'description',   label: 'Description' },
  { key: 'status',        label: 'Status' },
  { key: 'evidence_type', label: 'Evidence Type' },
  { key: 'file_name',     label: 'File Name' },
  { key: 'expiry_date',   label: 'Expiry Date' },
  { key: 'quality_score', label: 'Quality Score' },
  { key: 'version',       label: 'Version' },
];

const _ASSET: TemplateVar[] = [
  { key: 'name',                   label: 'Asset Name' },
  { key: 'description',            label: 'Description' },
  { key: 'asset_type',             label: 'Asset Type' },
  { key: 'criticality',            label: 'Criticality' },
  { key: 'status',                 label: 'Status' },
  { key: 'host_name',              label: 'Hostname' },
  { key: 'ip_address',             label: 'IP Address' },
  { key: 'vendor',                 label: 'Vendor' },
  { key: 'location',               label: 'Location' },
  { key: 'valuation',              label: 'Valuation' },
  { key: 'custodian',              label: 'Custodian' },
  { key: 'confidentiality_rating', label: 'Confidentiality (CIA)' },
  { key: 'integrity_rating',       label: 'Integrity (CIA)' },
  { key: 'availability_rating',    label: 'Availability (CIA)' },
  { key: 'owner_name',             label: 'Asset Owner (Name)' },
  { key: 'owner_email',            label: 'Asset Owner (Email)' },
];

export const TRIGGER_TEMPLATE_VARS: Record<string, TemplateSections[]> = {
  // Core
  manual_trigger:   [{ section: 'Common', vars: _COMMON }],
  schedule_recurring: [{ section: 'Common', vars: _COMMON }],
  webhook:          [{ section: 'Common', vars: _COMMON }],
  // Evidence & compliance
  evidence_uploaded: [{ section: 'Evidence Fields', vars: _EVIDENCE }, { section: 'Common', vars: _COMMON }],
  evidence_approved: [{ section: 'Evidence Fields', vars: _EVIDENCE }, { section: 'Common', vars: _COMMON }],
  evidence_expires:  [{ section: 'Evidence Fields', vars: _EVIDENCE }, { section: 'Common', vars: _COMMON }],
  framework_deadline_approaching:  [{ section: 'Common', vars: _COMMON }],
  framework_evidence_complete:     [{ section: 'Common', vars: _COMMON }],
  assessment_status_change:        [{ section: 'Common', vars: _COMMON }],
  compliance_gap_detected:         [{ section: 'Common', vars: _COMMON }],
  certification_expiry_approaching:[{ section: 'Common', vars: _COMMON }],
  // Risk
  risk_created:               [{ section: 'Risk Fields', vars: _RISK }, { section: 'Common', vars: _COMMON }],
  risk_updated:               [{ section: 'Risk Fields', vars: _RISK }, { section: 'Common', vars: _COMMON }],
  risk_deleted:               [{ section: 'Risk Fields', vars: _RISK }, { section: 'Common', vars: _COMMON }],
  risk_status_changed:        [{ section: 'Risk Fields', vars: _RISK }, { section: 'Common', vars: _COMMON }],
  risk_score_exceeds_threshold:[{ section: 'Risk Fields', vars: _RISK }, { section: 'Common', vars: _COMMON }],
  kri_breach:       [{ section: 'Common', vars: _COMMON }],
  incident_reported:[{ section: 'Common', vars: _COMMON }],
  // Vulnerability
  vulnerability_created:      [{ section: 'Vulnerability Fields', vars: _VULN }, { section: 'Common', vars: _COMMON }],
  vulnerability_updated:      [{ section: 'Vulnerability Fields', vars: _VULN }, { section: 'Common', vars: _COMMON }],
  vulnerability_deleted:      [{ section: 'Vulnerability Fields', vars: _VULN }, { section: 'Common', vars: _COMMON }],
  new_vulnerability_detected: [{ section: 'Vulnerability Fields', vars: _VULN }, { section: 'Common', vars: _COMMON }],
  vulnerability_sla_breach:   [{ section: 'Vulnerability Fields', vars: _VULN }, { section: 'Common', vars: _COMMON }],
  vulnerability_sla_warning:  [{ section: 'Vulnerability Fields', vars: _VULN }, { section: 'Common', vars: _COMMON }],
  // Governance & policy
  policy_submitted_for_review: [{ section: 'Policy Fields', vars: _POLICY }, { section: 'Common', vars: _COMMON }],
  policy_review_due:           [{ section: 'Policy Fields', vars: _POLICY }, { section: 'Common', vars: _COMMON }],
  policy_approved:             [{ section: 'Policy Fields', vars: _POLICY }, { section: 'Common', vars: _COMMON }],
  control_review_due:          [{ section: 'Common', vars: _COMMON }],
  attestation_overdue:         [{ section: 'Common', vars: _COMMON }],
  // Auditor Portal
  audit_review_submitted: [{ section: 'Common', vars: _COMMON }],
  audit_control_approved: [{ section: 'Common', vars: _COMMON }],
  // IT Assets
  asset_created: [{ section: 'Asset Fields', vars: _ASSET }, { section: 'Common', vars: _COMMON }],
  asset_updated: [{ section: 'Asset Fields', vars: _ASSET }, { section: 'Common', vars: _COMMON }],
  asset_deleted: [{ section: 'Asset Fields', vars: _ASSET }, { section: 'Common', vars: _COMMON }],
};
