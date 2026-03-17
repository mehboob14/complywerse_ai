// Shared types for Workflow Engine components

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
  isStart?: boolean;
  isTerminal?: boolean;
  executionStatus?: 'running' | 'completed' | 'failed' | 'waiting' | null;
};

export type PaletteItem = {
  key: string;
  label: string;
  description: string;
  group: 'triggers' | 'actions' | 'conditions' | 'approvals' | 'timers' | 'control' | 'platform_functions';
  module?: string;
  submodule?: string;
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
  'framework_deadline_approaching',
  'risk_score_exceeds_threshold',
  'evidence_expires',
  'new_vulnerability_detected',
  'policy_review_due',
  'incident_reported',
  'kri_breach',
  'assessment_status_change',
  'manual_trigger',
  'schedule_recurring',
  'webhook',
]);

export const ACTION_KEYS = new Set([
  'create_risk_entry',
  'request_evidence_upload',
  'assign_control_owner',
  'send_notification_email',
  'generate_report',
  'update_compliance_status',
  'create_audit_finding',
  'escalate_to_management',
  'call_webhook_api',
]);

export const CONDITION_KEYS = new Set([
  'check_risk_level',
  'check_user_role',
  'check_compliance_status',
  'check_evidence_age',
  'check_approval_status',
  'evaluate_business_unit',
  'expression_builder',
]);

export const APPROVAL_KEYS = new Set(['single', 'multi_level', 'quorum']);
export const TIMER_KEYS = new Set(['wait_duration', 'wait_until_date', 'sla_countdown']);

export const TRIGGER_EVENT_MAP: Record<string, string> = {
  framework_deadline_approaching: 'frameworks.deadline_approaching',
  risk_score_exceeds_threshold: 'risks.score_threshold_exceeded',
  evidence_expires: 'evidence.expires',
  new_vulnerability_detected: 'vulnerabilities.detected',
  policy_review_due: 'governance.policy_review_due',
  incident_reported: 'erm.incident_reported',
  kri_breach: 'erm.kri_breach',
  assessment_status_change: 'compliance.assessment_status_change',
  manual_trigger: 'manual.trigger',
  schedule_recurring: 'scheduler.recurring',
  webhook: 'workflow.webhook',
};

export const NODE_TYPE_LABELS: Record<string, string> = {
  framework_deadline_approaching: 'Framework Deadline',
  risk_score_exceeds_threshold: 'Risk Threshold',
  evidence_expires: 'Evidence Expires',
  new_vulnerability_detected: 'New Vulnerability',
  policy_review_due: 'Policy Review Due',
  incident_reported: 'Incident Reported',
  kri_breach: 'KRI Breach',
  assessment_status_change: 'Assessment Changed',
  manual_trigger: 'Manual Trigger',
  schedule_recurring: 'Recurring Schedule',
  webhook: 'Webhook',
  create_risk_entry: 'Create Risk',
  request_evidence_upload: 'Request Evidence',
  assign_control_owner: 'Assign Owner',
  send_notification_email: 'Send Email',
  generate_report: 'Generate Report',
  update_compliance_status: 'Update Compliance',
  create_audit_finding: 'Audit Finding',
  escalate_to_management: 'Escalate',
  call_webhook_api: 'Call Webhook',
  check_risk_level: 'Check Risk Level',
  check_user_role: 'Check Role',
  check_compliance_status: 'Check Compliance',
  check_evidence_age: 'Check Evidence Age',
  check_approval_status: 'Check Approval',
  evaluate_business_unit: 'Business Unit Check',
  expression_builder: 'Expression',
  single: 'Single Approver',
  multi_level: 'Multi-Level Approval',
  quorum: 'Quorum Approval',
  wait_duration: 'Wait Duration',
  wait_until_date: 'Wait Until Date',
  sla_countdown: 'SLA Countdown',
  subworkflow: 'Sub-Workflow',
  end: 'End',
  start: 'Start',
};

export const PALETTE_DESCRIPTIONS: Record<string, string> = {
  framework_deadline_approaching: 'Fires when a framework deadline is approaching',
  risk_score_exceeds_threshold: 'Fires when a risk score exceeds a defined threshold',
  evidence_expires: 'Fires when evidence is about to expire',
  new_vulnerability_detected: 'Fires when a new vulnerability is detected',
  policy_review_due: 'Fires when a policy is due for review',
  incident_reported: 'Fires when an incident is reported',
  kri_breach: 'Fires when a KRI breaches its threshold',
  assessment_status_change: 'Fires when a compliance assessment status changes',
  manual_trigger: 'Manually triggered by a user',
  schedule_recurring: 'Runs on a recurring schedule (daily, weekly, etc.)',
  webhook: 'Triggered by an external webhook call',
  create_risk_entry: 'Creates a new risk entry in the risk register',
  request_evidence_upload: 'Sends a request for evidence to be uploaded',
  assign_control_owner: 'Assigns an owner to a control',
  send_notification_email: 'Sends a notification email to specified recipients',
  generate_report: 'Generates a compliance or risk report',
  update_compliance_status: 'Updates the status of a compliance assessment item',
  create_audit_finding: 'Creates a new audit finding',
  escalate_to_management: 'Escalates an issue to management',
  call_webhook_api: 'Calls an external webhook API endpoint',
  check_risk_level: 'Branches based on risk level (Critical/High/Medium/Low)',
  check_user_role: 'Branches based on the current user\'s role',
  check_compliance_status: 'Branches based on compliance status',
  check_evidence_age: 'Branches based on evidence age in days',
  check_approval_status: 'Branches based on approval status',
  evaluate_business_unit: 'Branches based on business unit',
  expression_builder: 'Custom condition using a JSON expression',
  single: 'Requires approval from a single designated approver',
  multi_level: 'Requires sequential approvals from multiple levels',
  quorum: 'Requires a quorum (e.g., 3 of 5) to approve',
  wait_duration: 'Pauses the workflow for a specified duration',
  wait_until_date: 'Pauses until a specific date or time',
  sla_countdown: 'SLA timer with automatic escalation on breach',
  subworkflow: 'Embeds and executes a reusable sub-workflow',
  end: 'Marks the end of the workflow',
};
