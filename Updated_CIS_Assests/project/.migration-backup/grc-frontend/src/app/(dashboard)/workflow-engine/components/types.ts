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
  module?: string;
  submodule?: string;
  domains?: WorkflowDomain[];
  isStart?: boolean;
  isTerminal?: boolean;
  executionStatus?: 'running' | 'completed' | 'failed' | 'waiting' | null;
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
  // Audit
  'audit_finding_created',
  // IT Assets
  'asset_created',
  'asset_updated',
  'asset_deleted',
]);

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
  // Audit
  'create_audit_finding',
  'create_audit_plan',
  'close_audit_finding',
  'assign_auditor',
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
  framework_deadline_approaching: { domains: ['compliance'], module: 'Compliance' },
  framework_evidence_complete: { domains: ['evidence', 'compliance'], module: 'Compliance' },
  assessment_status_change: { domains: ['compliance'], module: 'Compliance' },
  compliance_gap_detected: { domains: ['compliance'], module: 'Compliance' },
  certification_expiry_approaching: { domains: ['compliance'], module: 'Compliance' },
  risk_created: { domains: ['risk'], module: 'Risk Management' },
  risk_status_changed: { domains: ['risk'], module: 'Risk Management' },
  risk_score_exceeds_threshold: { domains: ['risk'], module: 'Risk Management' },
  kri_breach: { domains: ['risk'], module: 'Risk Management' },
  incident_reported: { domains: ['risk'], module: 'Risk Management' },
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
  audit_finding_created: { domains: ['audit'], module: 'Audit Management' },
  asset_created: { domains: ['assets'], module: 'IT Asset Management' },
  asset_updated: { domains: ['assets'], module: 'IT Asset Management' },
  asset_deleted: { domains: ['assets'], module: 'IT Asset Management' },
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
  create_remediation_task: { domains: ['risk', 'vulnerability', 'compliance'], module: 'Workflow Engine' },
  assign_vulnerability_owner: { domains: ['vulnerability'], module: 'Vulnerability Management' },
  update_vulnerability_status: { domains: ['vulnerability'], module: 'Vulnerability Management' },
  create_vulnerability_entry: { domains: ['vulnerability'], module: 'Vulnerability Management' },
  create_policy_review_task: { domains: ['governance'], module: 'Governance' },
  publish_policy: { domains: ['governance'], module: 'Governance' },
  submit_policy_exception: { domains: ['governance'], module: 'Governance' },
  approve_policy_exception: { domains: ['governance'], module: 'Governance' },
  request_attestation: { domains: ['governance'], module: 'Governance' },
  create_audit_finding: { domains: ['audit'], module: 'Audit Management' },
  create_audit_plan: { domains: ['audit'], module: 'Audit Management' },
  close_audit_finding: { domains: ['audit'], module: 'Audit Management' },
  assign_auditor: { domains: ['audit'], module: 'Audit Management' },
  update_control_effectiveness: { domains: ['control', 'governance'], module: 'Control Library' },
  set_control_not_applicable: { domains: ['control', 'governance'], module: 'Control Library' },
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
    const module = configuredModule || parsed.module;
    const submodule = configuredSubmodule || parsed.submodule;
    return {
      key,
      domains: inferWorkflowDomainsFromModuleName(module),
      module,
      submodule,
      isPlatformFunction: true,
    };
  }

  const module = configuredModule || meta?.module;
  return {
    key,
    domains: meta?.domains || inferWorkflowDomainsFromModuleName(module),
    module,
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
  // Audit
  audit_finding_created: 'audit_finding_created',
  // IT Assets
  asset_created: 'asset_created',
  asset_updated: 'asset_updated',
  asset_deleted: 'asset_deleted',
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
  new_vulnerability_detected: 'New Vulnerability',
  vulnerability_sla_breach: 'SLA Breached',
  vulnerability_sla_warning: 'SLA Warning',
  // Governance triggers
  policy_submitted_for_review: 'Policy Submitted for Review',
  policy_review_due: 'Policy Review Due',
  policy_approved: 'Policy Approved',
  control_review_due: 'Control Review Due',
  attestation_overdue: 'Attestation Overdue',
  // Audit triggers
  audit_finding_created: 'Audit Finding Created',
  // IT Asset triggers
  asset_created: 'Asset Created',
  asset_updated: 'Asset Updated',
  asset_deleted: 'Asset Deleted',
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
  // Actions - audit
  create_audit_finding: 'Audit Finding',
  create_audit_plan: 'Audit Plan',
  close_audit_finding: 'Close Finding',
  assign_auditor: 'Assign Auditor',
  // Actions - control library
  update_control_effectiveness: 'Update Control Rating',
  set_control_not_applicable: 'Set Not Applicable',
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
  // Audit triggers
  audit_finding_created: 'Fires when a new audit finding is recorded',
  // IT Asset triggers
  asset_created: 'Fires when a new IT asset is added to the inventory',
  asset_updated: 'Fires when an IT asset record is updated',
  asset_deleted: 'Fires when an IT asset is removed from the inventory',
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
  // Actions - audit
  create_audit_finding: 'Creates a new audit finding with severity and assignment',
  create_audit_plan: 'Creates an audit plan with assigned auditors and timing',
  close_audit_finding: 'Closes or remediates matching audit findings with closure notes',
  assign_auditor: 'Assigns auditors to matching audit activities or findings',
  // Actions - control library
  update_control_effectiveness: 'Updates the effectiveness rating for matching controls',
  set_control_not_applicable: 'Marks controls as not applicable with justification and approval routing',
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

const _AUDIT: TemplateVar[] = [
  { key: 'title',          label: 'Finding Title' },
  { key: 'condition',      label: 'Condition' },
  { key: 'severity',       label: 'Severity' },
  { key: 'status',         label: 'Status' },
  { key: 'finding_number', label: 'Finding Number' },
  { key: 'due_date',       label: 'Due Date' },
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
  // Audit
  audit_finding_created: [{ section: 'Audit Fields', vars: _AUDIT }, { section: 'Common', vars: _COMMON }],
  // IT Assets
  asset_created: [{ section: 'Asset Fields', vars: _ASSET }, { section: 'Common', vars: _COMMON }],
  asset_updated: [{ section: 'Asset Fields', vars: _ASSET }, { section: 'Common', vars: _COMMON }],
  asset_deleted: [{ section: 'Asset Fields', vars: _ASSET }, { section: 'Common', vars: _COMMON }],
};
