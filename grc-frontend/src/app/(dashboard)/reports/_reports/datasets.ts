// Report dataset registry — maps each module's list API to a set of columns.
// Add a dataset here and it shows up in the Reports module switcher automatically.

import apiClient, {
  risksApi, controlsApi, evidenceApi, certificationsApi, assetsApi, vendorRiskApi,
  vulnManagementApi, issuesApi, ermApi, criticalTasksApi, bcmApi, isProjectsApi,
  criticalityApi, discoveryApi, regulatoryApi, frameworksApi,
  committeeApi, policyExceptionApi,
} from '@/lib/api';
import { asRows } from './grid-utils';
import type { ReportDataset } from './types';

const TONE = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-rose-50 text-rose-700 border-rose-200',
  orange: 'bg-orange-50 text-orange-700 border-orange-200',
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
  teal: 'bg-primary-50 text-primary-700 border-primary-200',
};
const statusTone = (v: unknown): string => {
  const s = String(v ?? '').toLowerCase();
  if (!s) return TONE.slate;
  if (/(approv|complet|verified|implement|closed|active|pass|done|mitigat|resolved)/.test(s)) return TONE.green;
  if (/(review|progress|pending|partial|draft|planned)/.test(s)) return TONE.amber;
  if (/(open|fail|overdue|not[_ ]|non[- ]|reject|expired|breach|missing)/.test(s)) return TONE.red;
  return TONE.slate;
};
const sevTone = (v: unknown): string => {
  const s = String(v ?? '').toLowerCase();
  if (/(crit|high)/.test(s)) return TONE.red;
  if (/med/.test(s)) return TONE.amber;
  if (/low/.test(s)) return TONE.green;
  return TONE.slate;
};
const scoreTone = (v: unknown): string => {
  const n = Number(v);
  if (!Number.isFinite(n)) return TONE.slate;
  if (n >= 15) return TONE.red;
  if (n >= 8) return TONE.amber;
  if (n > 0) return TONE.green;
  return TONE.slate;
};
const titleCase = (v: unknown) => String(v ?? '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
// Robust truthiness — the API may serialise a boolean as a real bool OR the
// string "false"/"0", both of which are truthy in JS; treat them as false.
const boolTrue = (v: unknown): boolean => {
  if (v === true) return true;
  const s = String(v ?? '').toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
};
const boolFmt = (v: unknown) => (v == null || v === '' ? '' : boolTrue(v) ? 'Yes' : 'No');

export const DATASETS: ReportDataset[] = [
  {
    key: 'risks', permissions: ['erm:risks:*'], module: 'Risk Management', label: 'Risk Register', server: true,
    description: 'All enterprise risks with inherent/residual scoring and ownership.',
    fetch: async () => asRows((await risksApi.getAll()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/erm/risks/${r.id}` },
      { key: 'title', label: 'Risk', type: 'text', width: 320, href: (r) => `/erm/risks/${r.id}` },
      // `risk_category` is the real column (server mode); the risk list API (RiskResponse)
      // exposes it as `category`, so fall back to that for client mode.
      { key: 'risk_category', label: 'Category', type: 'badge', width: 150, badgeTone: () => TONE.slate, format: titleCase, accessor: (r) => r.risk_category ?? r.category },
      { key: 'register_type', label: 'Register', type: 'text', width: 130, format: titleCase },
      // (Owner column removed — the risk list API returns only business_owner_id, no
      //  resolvable owner name, so it would always render blank.)
      { key: 'inherent_score', label: 'Inherent', type: 'number', width: 100, align: 'right', badgeTone: scoreTone, agg: 'avg' },
      { key: 'residual_score', label: 'Residual', type: 'number', width: 100, align: 'right', badgeTone: scoreTone, agg: 'avg' },
      { key: 'risk_appetite', label: 'Appetite', type: 'text', width: 120, format: titleCase },
      { key: 'closure_status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'closed_at', label: 'Closed', type: 'date', width: 120 },
    ],
  },
  {
    key: 'controls', permissions: ['controls:control_library:*'], module: 'Controls', label: 'Controls Library',
    description: 'Control objectives, type and automation status.',
    fetch: async () => asRows((await controlsApi.getAll()).data),
    columns: [
      // Aligned to NormalizedControlResponse (the /controls list shape): code, name,
      // control_owner, maturity_level, created_at. The prior keys (reference_code,
      // control_type, automation_status, owner_id) are not in the response → were blank.
      { key: 'code', label: 'Ref', type: 'text', width: 120, href: (r) => `/control-library/${r.id}` },
      { key: 'name', label: 'Control', type: 'text', width: 340, href: (r) => `/control-library/${r.id}` },
      { key: 'maturity_level', label: 'Maturity', type: 'badge', width: 130, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'control_owner', label: 'Owner', type: 'text', width: 150 },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
    ],
  },
  {
    key: 'evidence', permissions: ['evidence:evidence_library:*', 'evidence:evidence_upload:*'], module: 'Evidence', label: 'Evidence Library', server: true,
    description: 'Collected evidence with type, status and expiry.',
    fetch: async () => asRows((await evidenceApi.getAll()).data),
    columns: [
      // Aligned to EvidenceResponse (the /evidence list shape): id, name, file_type,
      // status, uploaded_at, version. The prior keys (title, evidence_type,
      // collection_date, expiry_date, created_at) are not in the response → were blank.
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/evidence/${r.id}` },
      { key: 'name', label: 'Evidence', type: 'text', width: 340, href: (r) => `/evidence/${r.id}` },
      { key: 'file_type', label: 'Type', type: 'badge', width: 120, badgeTone: () => TONE.teal, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'version', label: 'Version', type: 'text', width: 90 },
      { key: 'uploaded_at', label: 'Uploaded', type: 'date', width: 130 },
    ],
  },
  {
    key: 'journeys', permissions: ['compliance:frameworks:*'], module: 'Compliance', label: 'Framework Journeys',
    description: 'Certification journeys, target dates and progress.',
    fetch: async () => asRows((await certificationsApi.getAll()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/frameworks/${r.id}` },
      { key: 'framework_name', label: 'Framework', type: 'text', width: 300, href: (r) => `/frameworks/${r.id}` },
      { key: 'framework_type', label: 'Type', type: 'badge', width: 140, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 140, badgeTone: statusTone, format: titleCase },
      { key: 'current_phase', label: 'Phase', type: 'number', width: 90, align: 'right' },
      { key: 'target_date', label: 'Target', type: 'date', width: 120 },
      { key: 'started_at', label: 'Started', type: 'date', width: 120 },
      { key: 'completed_at', label: 'Completed', type: 'date', width: 120 },
    ],
  },
  {
    key: 'gov_documents', permissions: ['governance:policies:*'], module: 'Governance', label: 'Governance Documents',
    description: 'Policies, procedures and standards with review dates.',
    fetch: async () => asRows((await apiClient.get('/governance/documents')).data),
    columns: [
      { key: 'title', label: 'Document', type: 'text', width: 320, href: (r) => `/governance/documents/${r.id}` },
      { key: 'document_type', label: 'Type', type: 'badge', width: 130, badgeTone: () => TONE.teal, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 140, badgeTone: statusTone, format: titleCase },
      { key: 'category', label: 'Category', type: 'text', width: 150 },
      { key: 'version_number', label: 'Version', type: 'text', width: 90 },
      { key: 'owner_name', label: 'Owner', type: 'text', width: 150 },
      { key: 'effective_date', label: 'Effective', type: 'date', width: 120 },
      { key: 'next_review_date', label: 'Next review', type: 'date', width: 130 },
    ],
  },
  {
    key: 'assets', permissions: ['assets:asset_inventory:*'], module: 'IT Assets', label: 'Asset Inventory', server: true,
    description: 'IT assets with type, criticality, ownership and internet exposure.',
    fetch: async () => asRows((await assetsApi.getAll()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/assets/${r.id}` },
      { key: 'name', label: 'Asset', type: 'text', width: 260, href: (r) => `/assets/${r.id}` },
      { key: 'asset_type', label: 'Type', type: 'badge', width: 140, badgeTone: () => TONE.teal, format: titleCase },
      { key: 'criticality', label: 'Criticality', type: 'badge', width: 130, badgeTone: sevTone, format: titleCase },
      { key: 'owner_name', label: 'Owner', type: 'text', width: 150 },
      { key: 'host_name', label: 'Host', type: 'text', width: 150 },
      { key: 'ip_address', label: 'IP', type: 'text', width: 130 },
      { key: 'location', label: 'Location', type: 'text', width: 140 },
      { key: 'internet_facing', label: 'Internet-facing', type: 'badge', width: 150, badgeTone: (v) => (boolTrue(v) ? TONE.red : TONE.slate), format: boolFmt },
      { key: 'status', label: 'Status', type: 'badge', width: 120, badgeTone: statusTone, format: titleCase },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
    ],
  },
  {
    key: 'vendors', permissions: ['erm:risks:*'], module: 'Vendor Risk', label: 'Vendor Register',
    description: 'Third-party vendors with tier, data-access level and status.',
    fetch: async () => asRows((await vendorRiskApi.getVendors()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/vendor-risk/vendors/${r.id}` },
      { key: 'name', label: 'Vendor', type: 'text', width: 260, href: (r) => `/vendor-risk/vendors/${r.id}`, accessor: (r) => r.name ?? r.vendor_name ?? r.company_name },
      { key: 'vendor_type', label: 'Type', type: 'badge', width: 150, badgeTone: () => TONE.teal, format: titleCase },
      { key: 'criticality', label: 'Tier / risk', type: 'badge', width: 140, badgeTone: sevTone, format: titleCase, accessor: (r) => r.criticality ?? r.risk_tier ?? r.risk_rating ?? r.inherent_risk },
      { key: 'data_access_level', label: 'Data access', type: 'badge', width: 150, badgeTone: sevTone, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'created_at', label: 'Onboarded', type: 'date', width: 120 },
    ],
  },
  {
    key: 'vulnerabilities', permissions: ['vulnerabilities:vulnerability_register:*'], module: 'Vulnerabilities', label: 'Vulnerability Register', server: true,
    description: 'Open vulnerabilities with severity, CVSS, KEV and remediation status.',
    fetch: async () => asRows((await vulnManagementApi.vulnerabilities.getAll()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/vulnerabilities/${r.id}` },
      { key: 'title', label: 'Vulnerability', type: 'text', width: 320, href: (r) => `/vulnerabilities/${r.id}`, accessor: (r) => r.title ?? r.name ?? r.vuln_id },
      { key: 'severity', label: 'Severity', type: 'badge', width: 110, badgeTone: sevTone, format: titleCase },
      { key: 'cvss_score', label: 'CVSS', type: 'number', width: 80, align: 'right', agg: 'avg' },
      { key: 'cve_id', label: 'CVE', type: 'text', width: 150 },
      { key: 'kev_flag', label: 'KEV', type: 'badge', width: 80, badgeTone: (v) => (boolTrue(v) ? TONE.red : TONE.slate), format: boolFmt },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'asset', label: 'Asset', type: 'text', width: 180, accessor: (r) => r.asset_name ?? r.host_name },
      { key: 'owner', label: 'Owner', type: 'text', width: 150, accessor: (r) => r.owner_name ?? r.assigned_to },
      { key: 'due_date', label: 'Due', type: 'date', width: 120, accessor: (r) => r.due_date ?? r.sla_due_date },
      { key: 'created_at', label: 'Detected', type: 'date', width: 120, accessor: (r) => r.created_at ?? r.discovered_at },
    ],
  },
  {
    key: 'issues', permissions: ['issue_management:issues:*'], module: 'Issue Management', label: 'Enterprise Log',
    description: 'Issues and findings with severity, workflow state, assignment and SLA.',
    fetch: async () => asRows((await issuesApi.list({ limit: 2000 })).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/issues/${r.id}` },
      { key: 'code', label: 'Code', type: 'text', width: 90, href: (r) => `/issues/${r.id}` },
      { key: 'title', label: 'Issue', type: 'text', width: 300, href: (r) => `/issues/${r.id}` },
      { key: 'severity', label: 'Severity', type: 'badge', width: 110, badgeTone: sevTone, format: titleCase },
      { key: 'workflow_state', label: 'State', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'issue_type', label: 'Type', type: 'badge', width: 130, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'category', label: 'Category', type: 'text', width: 120, format: titleCase },
      { key: 'sla_breached', label: 'SLA breached', type: 'badge', width: 110, badgeTone: (v) => (boolTrue(v) ? TONE.red : TONE.slate), format: boolFmt },
      { key: 'assignee', label: 'Assignee', type: 'text', width: 150, accessor: (r) => (r.assignee as { display_name?: string })?.display_name },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
      { key: 'target_closure_date', label: 'Target close', type: 'date', width: 120 },
    ],
  },
  {
    key: 'incidents', permissions: ['erm:incidents:*'], module: 'ERM', label: 'Incidents',
    description: 'Risk incidents with severity, status, assignment and impact.',
    fetch: async () => asRows((await ermApi.incidents.getAll()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/erm/incidents` },
      { key: 'title', label: 'Incident', type: 'text', width: 300 },
      { key: 'severity', label: 'Severity', type: 'badge', width: 110, badgeTone: sevTone, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'risk_title', label: 'Primary risk', type: 'text', width: 200 },
      { key: 'assignee_name', label: 'Assignee', type: 'text', width: 150 },
      { key: 'financial_impact', label: 'Financial impact', type: 'number', width: 120, align: 'right', agg: 'sum' },
      { key: 'incident_date', label: 'Incident date', type: 'date', width: 120 },
      { key: 'tags', label: 'Tags', type: 'text', width: 180, accessor: (r) => Array.isArray(r.tags) ? r.tags.join(', ') : '' },
    ],
  },
  {
    key: 'tasks', permissions: ['critical_tasks:tasks:*', 'critical_tasks:reports:view'], module: 'Tasks', label: 'Critical Tasks',
    description: 'Task workspace items with status, priority, SLA and ownership.',
    fetch: async () => asRows((await criticalTasksApi.list({ limit: 2000 })).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/tasks/${r.id}` },
      { key: 'title', label: 'Task', type: 'text', width: 300, href: (r) => `/tasks/${r.id}`, accessor: (r) => r.title ?? r.name },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'priority', label: 'Priority', type: 'badge', width: 110, badgeTone: sevTone, format: titleCase },
      { key: 'assignee_name', label: 'Assignee', type: 'text', width: 150, accessor: (r) => r.assignee_name ?? (r.assignee as { display_name?: string })?.display_name },
      { key: 'due_date', label: 'Due', type: 'date', width: 120 },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
      { key: 'module', label: 'Source module', type: 'text', width: 140, format: titleCase, accessor: (r) => r.source_module ?? r.module },
      { key: 'source', label: 'Source', type: 'text', width: 120, format: titleCase },
      { key: 'category', label: 'Category', type: 'text', width: 130, format: titleCase },
      { key: 'linked_risk_id', label: 'Linked risk ID', type: 'number', width: 110, align: 'right' },
      { key: 'linked_issue_id', label: 'Linked issue ID', type: 'number', width: 110, align: 'right' },
    ],
  },
  {
    key: 'kris', permissions: ['erm:kris:*'], module: 'Governance', label: 'KRIs',
    description: 'Key risk indicators with thresholds and ownership.',
    fetch: async () => asRows((await ermApi.kris.getAll()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/erm/kris` },
      { key: 'name', label: 'KRI', type: 'text', width: 280, accessor: (r) => r.name ?? r.title },
      { key: 'category', label: 'Category', type: 'badge', width: 140, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'current_value', label: 'Current', type: 'number', width: 100, align: 'right', accessor: (r) => r.current_value ?? r.last_value },
      { key: 'threshold', label: 'Threshold', type: 'number', width: 100, align: 'right' },
      { key: 'owner_name', label: 'Owner', type: 'text', width: 150 },
      { key: 'next_measurement_date', label: 'Next measure', type: 'date', width: 130 },
    ],
  },
  {
    key: 'bcm_plans', permissions: ['bcm:plans:*'], module: 'BCM', label: 'Continuity Plans',
    description: 'Business continuity plans with status and ownership.',
    fetch: async () => asRows((await bcmApi.plans.list()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/bcm/plans/${r.id}` },
      { key: 'name', label: 'Plan', type: 'text', width: 280, href: (r) => `/bcm/plans/${r.id}`, accessor: (r) => r.name ?? r.title },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'plan_type', label: 'Type', type: 'badge', width: 140, badgeTone: () => TONE.teal, format: titleCase },
      { key: 'owner_name', label: 'Owner', type: 'text', width: 150 },
      { key: 'next_review_date', label: 'Next review', type: 'date', width: 130 },
      { key: 'updated_at', label: 'Updated', type: 'date', width: 120 },
    ],
  },
  {
    key: 'bcm_drills', permissions: ['bcm:drills:*'], module: 'BCM', label: 'Drills & Invocations',
    description: 'BCM drills and invocations with outcome and schedule.',
    fetch: async () => asRows((await bcmApi.drills.list()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/bcm/drills/${r.id}` },
      { key: 'name', label: 'Drill', type: 'text', width: 280, href: (r) => `/bcm/drills/${r.id}`, accessor: (r) => r.name ?? r.title },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'drill_type', label: 'Type', type: 'badge', width: 140, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'scheduled_at', label: 'Scheduled', type: 'date', width: 130 },
      { key: 'outcome', label: 'Outcome', type: 'text', width: 160, format: titleCase },
    ],
  },
  {
    key: 'is_projects', permissions: ['is_projects:projects:*', 'is_projects:dashboard:view'], module: 'Governance', label: 'IS Projects',
    description: 'Information-security projects with health, budget and status.',
    fetch: async () => asRows((await isProjectsApi.getAll()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/is-projects/${r.id}` },
      { key: 'name', label: 'Project', type: 'text', width: 280, href: (r) => `/is-projects/${r.id}` },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'health', label: 'Health', type: 'badge', width: 120, badgeTone: sevTone, format: titleCase },
      { key: 'priority', label: 'Priority', type: 'badge', width: 110, badgeTone: sevTone, format: titleCase },
      { key: 'category', label: 'Category', type: 'text', width: 140 },
      { key: 'completion_percentage', label: '% complete', type: 'number', width: 110, align: 'right', agg: 'avg' },
      { key: 'budget_estimated', label: 'Budget est.', type: 'number', width: 120, align: 'right', agg: 'sum' },
      { key: 'budget_actual', label: 'Budget act.', type: 'number', width: 120, align: 'right', agg: 'sum' },
      { key: 'target_end_date', label: 'Target end', type: 'date', width: 120 },
    ],
  },
  {
    key: 'criticality_info', permissions: ['assets:criticality_assessments:view'], module: 'IT Assets', label: 'Info-system criticality',
    description: 'Information-system criticality assessments.',
    fetch: async () => asRows((await criticalityApi.infoSystem.list()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/assets/criticality-assessments` },
      { key: 'name', label: 'System', type: 'text', width: 260, accessor: (r) => r.name ?? r.system_name ?? r.title },
      { key: 'criticality', label: 'Criticality', type: 'badge', width: 130, badgeTone: sevTone, format: titleCase, accessor: (r) => r.criticality ?? r.overall_rating },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'owner_name', label: 'Owner', type: 'text', width: 150 },
      { key: 'updated_at', label: 'Updated', type: 'date', width: 120 },
    ],
  },
  {
    key: 'criticality_infra', permissions: ['assets:criticality_assessments:view'], module: 'IT Assets', label: 'Infra criticality',
    description: 'Infrastructure asset criticality assessments.',
    fetch: async () => asRows((await criticalityApi.infraAsset.list()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/assets/criticality-assessments` },
      { key: 'name', label: 'Asset', type: 'text', width: 260, accessor: (r) => r.name ?? r.asset_name ?? r.title },
      { key: 'criticality', label: 'Criticality', type: 'badge', width: 130, badgeTone: sevTone, format: titleCase, accessor: (r) => r.criticality ?? r.overall_rating },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'owner_name', label: 'Owner', type: 'text', width: 150 },
      { key: 'updated_at', label: 'Updated', type: 'date', width: 120 },
    ],
  },
  {
    key: 'discovery_campaigns', permissions: ['assets:asset_inventory:*'], module: 'IT Assets', label: 'Discovery campaigns',
    description: 'IT asset discovery campaigns and schedules.',
    fetch: async () => asRows((await discoveryApi.listCampaigns()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/asset-discovery` },
      { key: 'name', label: 'Campaign', type: 'text', width: 260 },
      { key: 'method', label: 'Method', type: 'badge', width: 120, badgeTone: () => TONE.teal, format: titleCase },
      { key: 'is_active', label: 'Active', type: 'badge', width: 90, badgeTone: (v) => (boolTrue(v) ? TONE.green : TONE.slate), format: boolFmt },
      { key: 'last_run_at', label: 'Last run', type: 'date', width: 130 },
      { key: 'next_run_at', label: 'Next run', type: 'date', width: 130 },
      { key: 'created_by_name', label: 'Created by', type: 'text', width: 140 },
    ],
  },
  {
    key: 'regulatory_changes', permissions: ['governance:regulatory_changes:*'], module: 'Compliance', label: 'Regulatory changes',
    description: 'Tracked regulatory changes with priority and status.',
    fetch: async () => asRows((await regulatoryApi.getChanges()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/governance/regulatory-changes/${r.id}` },
      { key: 'title', label: 'Change', type: 'text', width: 300, href: (r) => `/governance/regulatory-changes/${r.id}` },
      { key: 'source', label: 'Source', type: 'badge', width: 140, badgeTone: () => TONE.teal, format: titleCase },
      { key: 'priority', label: 'Priority', type: 'badge', width: 110, badgeTone: sevTone, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'effective_date', label: 'Effective', type: 'date', width: 120 },
      { key: 'created_at', label: 'Logged', type: 'date', width: 120 },
    ],
  },
  {
    key: 'exceptions', permissions: ['governance:policies:*'], module: 'Governance', label: 'Policy exceptions',
    description: 'Policy exceptions with approval state and expiry.',
    fetch: async () => asRows((await policyExceptionApi.getAll()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/governance/exceptions` },
      { key: 'title', label: 'Exception', type: 'text', width: 280, accessor: (r) => r.title ?? r.name },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'risk_level', label: 'Risk', type: 'badge', width: 110, badgeTone: sevTone, format: titleCase, accessor: (r) => r.risk_level ?? r.severity },
      { key: 'expires_at', label: 'Expires', type: 'date', width: 120, accessor: (r) => r.expires_at ?? r.expiry_date },
      { key: 'owner_name', label: 'Owner', type: 'text', width: 150 },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
    ],
  },
  {
    key: 'committees', permissions: ['governance:committees:*'], module: 'Governance', label: 'Committees',
    description: 'Governance committees and status.',
    fetch: async () => asRows((await committeeApi.getCommittees()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/governance/committees/${r.id}` },
      { key: 'name', label: 'Committee', type: 'text', width: 260, href: (r) => `/governance/committees/${r.id}` },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'committee_type', label: 'Type', type: 'badge', width: 140, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'chair_name', label: 'Chair', type: 'text', width: 150 },
      { key: 'member_count', label: 'Members', type: 'number', width: 100, align: 'right' },
    ],
  },
  {
    key: 'frameworks', permissions: ['compliance:frameworks:*'], module: 'Compliance', label: 'Framework catalog',
    description: 'Available compliance frameworks in the tenant.',
    fetch: async () => asRows((await frameworksApi.getAll()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/frameworks/${r.id}` },
      { key: 'name', label: 'Framework', type: 'text', width: 280, href: (r) => `/frameworks/${r.id}` },
      { key: 'framework_type', label: 'Type', type: 'badge', width: 140, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'version', label: 'Version', type: 'text', width: 100 },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'publisher', label: 'Publisher', type: 'text', width: 160 },
    ],
  },
];

export { sevTone };
export function datasetByKey(key: string): ReportDataset | undefined {
  return DATASETS.find((d) => d.key === key);
}
