// Report dataset registry — maps each module's list API to a set of columns.
// Add a dataset here and it shows up in the Reports module switcher automatically.

import apiClient, {
  risksApi, controlsApi, evidenceApi, certificationsApi, assetsApi, vendorRiskApi,
  vulnManagementApi, issuesApi, ermApi, criticalTasksApi, bcmApi, isProjectsApi,
  criticalityApi, discoveryApi, regulatoryApi, frameworksApi,
  committeeApi, policyExceptionApi,
  rcsaApi, complianceApi, tpraApi, aiRiskAssessmentApi,
} from '@/lib/api';
import { asRows } from './grid-utils';
import type { ColumnDef, ReportDataset } from './types';

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

const fetchAssessmentsByFormats = async (formats: string[]) => {
  const results = await Promise.all(
    formats.map((f) => apiClient.get('/compliance/assessments', { params: { limit: 500, assessment_format: f } }))
  );
  return results.flatMap((r) => asRows(r.data?.assessments ?? r.data));
};
const ASSESSMENT_COLUMNS: ColumnDef[] = [
  { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/compliance/assessments/${r.id}` },
  { key: 'name', label: 'Assessment', type: 'text', width: 300, href: (r) => `/compliance/assessments/${r.id}` },
  { key: 'assessment_format', label: 'Format', type: 'badge', width: 220, badgeTone: () => TONE.teal, format: titleCase },
  { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
  { key: 'overall_score', label: 'Score', type: 'number', width: 90, align: 'right', badgeTone: scoreTone, agg: 'avg' },
  { key: 'total_items', label: 'Items', type: 'number', width: 90, align: 'right', agg: 'sum' },
  { key: 'complied_count', label: 'Complied', type: 'number', width: 100, align: 'right', agg: 'sum' },
  { key: 'not_complied_count', label: 'Not complied', type: 'number', width: 120, align: 'right', agg: 'sum' },
  { key: 'in_progress_count', label: 'In progress', type: 'number', width: 110, align: 'right', agg: 'sum' },
  { key: 'assessor', label: 'Assessor', type: 'text', width: 150 },
  { key: 'due_date', label: 'Due', type: 'date', width: 120 },
  { key: 'created_at', label: 'Created', type: 'date', width: 120 },
  { key: 'updated_at', label: 'Updated', type: 'date', width: 120 },
];

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
    key: 'controls', permissions: ['controls:control_library:*'], module: 'Control Testing & Assurance', label: 'Controls Library',
    description: 'Control objectives, type and automation status.',
    fetch: async () => asRows((await controlsApi.getAll()).data),
    columns: [
      // Aligned to NormalizedControlResponse (the /controls list shape): code, name,
      // statement, objective, control_owner, maturity_level, created_at. The prior
      // keys (reference_code, control_type, automation_status, owner_id) are not in
      // the response → were blank.
      { key: 'code', label: 'Ref', type: 'text', width: 120, href: (r) => `/control-library/${r.id}` },
      { key: 'name', label: 'Control', type: 'text', width: 300, href: (r) => `/control-library/${r.id}` },
      { key: 'maturity_level', label: 'Maturity', type: 'badge', width: 130, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'control_owner', label: 'Owner', type: 'text', width: 150 },
      { key: 'statement', label: 'Description', type: 'text', width: 320 },
      { key: 'objective', label: 'Objective', type: 'text', width: 260 },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
    ],
  },
  {
    key: 'evidence', permissions: ['evidence:evidence_library:*', 'evidence:evidence_upload:*'], module: 'Compliance Management', label: 'Evidence Library', server: true,
    description: 'Collected evidence with type, status, expiry and linkage counts.',
    fetch: async () => asRows((await evidenceApi.getAll()).data),
    columns: [
      // Aligned to serialize_evidence() (the /evidence list shape) — richer than
      // the bare EvidenceResponse schema: evidence_type, collection/expiry dates,
      // owner/uploader names and cross-module link counts are all populated there.
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/evidence/${r.id}` },
      { key: 'name', label: 'Evidence', type: 'text', width: 300, href: (r) => `/evidence/${r.id}` },
      { key: 'evidence_type', label: 'Type', type: 'badge', width: 140, badgeTone: () => TONE.teal, format: titleCase, accessor: (r) => r.evidence_type ?? r.file_type },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'is_stale', label: 'Stale', type: 'badge', width: 90, badgeTone: (v) => (boolTrue(v) ? TONE.red : TONE.slate), format: boolFmt },
      { key: 'owner_name', label: 'Owner', type: 'text', width: 150, accessor: (r) => r.owner_name ?? r.uploader_name ?? r.owner_id },
      { key: 'version', label: 'Version', type: 'text', width: 90 },
      { key: 'collection_date', label: 'Collected', type: 'date', width: 120 },
      { key: 'expiry_date', label: 'Expires', type: 'date', width: 120 },
      { key: 'uploaded_at', label: 'Uploaded', type: 'date', width: 130 },
      { key: 'control_mappings_count', label: 'Controls linked', type: 'number', width: 120, align: 'right', agg: 'sum' },
      { key: 'risk_links_count', label: 'Risks linked', type: 'number', width: 110, align: 'right', agg: 'sum' },
    ],
  },
  {
    key: 'journeys', permissions: ['compliance:frameworks:*'], module: 'Compliance Management', label: 'Framework Journeys',
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
    key: 'gov_documents', permissions: ['governance:policies:*'], module: 'Governance', label: 'Governance Documents', server: true,
    description: 'Policies, procedures and standards with review dates.',
    fetch: async () => asRows((await apiClient.get('/governance/documents')).data),
    columns: [
      // Aligned to serialize_document(): `doc_type`/`classification`/`current_version`
      // are the real field names (document_type/category/version_number were blank).
      { key: 'title', label: 'Document', type: 'text', width: 280, href: (r) => `/governance/documents/${r.id}` },
      { key: 'doc_type', label: 'Type', type: 'badge', width: 130, badgeTone: () => TONE.teal, format: titleCase, accessor: (r) => r.doc_type ?? r.document_type },
      { key: 'status', label: 'Status', type: 'badge', width: 140, badgeTone: statusTone, format: titleCase },
      { key: 'classification', label: 'Classification', type: 'text', width: 140, accessor: (r) => r.classification ?? r.category },
      { key: 'current_version', label: 'Version', type: 'text', width: 90, accessor: (r) => r.current_version ?? r.version_number },
      { key: 'owner_name', label: 'Owner', type: 'text', width: 150, accessor: (r) => r.owner_name ?? r.owner_id },
      { key: 'effective_date', label: 'Effective', type: 'date', width: 120 },
      { key: 'next_review_date', label: 'Next review', type: 'date', width: 130 },
      { key: 'last_reviewed_at', label: 'Last reviewed', type: 'date', width: 130 },
      { key: 'approved_at', label: 'Approved', type: 'date', width: 120 },
      { key: 'published_at', label: 'Published', type: 'date', width: 120 },
    ],
  },
  {
    key: 'assets', permissions: ['assets:asset_inventory:*'], module: 'Cybersecurity Assurance', label: 'Asset Inventory', server: true,
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
    key: 'vendors', permissions: ['erm:risks:*'], module: 'Third-Party Vendor Risk', label: 'Vendor Register', server: true,
    description: 'Third-party vendors with tier, data-access level, contact and residual risk.',
    fetch: async () => asRows((await vendorRiskApi.getVendors()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/vendor-risk/vendors/${r.id}` },
      { key: 'name', label: 'Vendor', type: 'text', width: 240, href: (r) => `/vendor-risk/vendors/${r.id}`, accessor: (r) => r.name ?? r.vendor_name ?? r.company_name },
      { key: 'vendor_type', label: 'Type', type: 'badge', width: 150, badgeTone: () => TONE.teal, format: titleCase },
      { key: 'tier', label: 'Tier / risk', type: 'badge', width: 130, badgeTone: sevTone, format: titleCase, accessor: (r) => r.tier ?? r.criticality ?? r.risk_rating },
      { key: 'data_access_level', label: 'Data access', type: 'badge', width: 140, badgeTone: sevTone, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 120, badgeTone: statusTone, format: titleCase },
      { key: 'primary_contact_name', label: 'Contact', type: 'text', width: 150 },
      { key: 'website', label: 'Website', type: 'text', width: 170 },
      { key: 'residual_risk_score', label: 'Residual risk', type: 'number', width: 110, align: 'right', badgeTone: scoreTone, agg: 'avg' },
      { key: 'next_reassessment_date', label: 'Next assessment', type: 'date', width: 130 },
      { key: 'created_at', label: 'Onboarded', type: 'date', width: 120 },
    ],
  },
  {
    key: 'vulnerabilities', permissions: ['vulnerabilities:vulnerability_register:*'], module: 'Cybersecurity Assurance', label: 'Vulnerability Register', server: true,
    description: 'Open vulnerabilities with severity, CVSS, KEV and remediation status.',
    fetch: async () => asRows((await vulnManagementApi.vulnerabilities.getAll()).data),
    columns: [
      // Aligned to VulnerabilityResponse: affected_host, assigned_to/assignee_name,
      // discovered_at, resolved_at, vuln_id are the real field names on the list API.
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/vulnerabilities/${r.id}` },
      { key: 'title', label: 'Vulnerability', type: 'text', width: 280, href: (r) => `/vulnerabilities/${r.id}`, accessor: (r) => r.title ?? r.name ?? r.vuln_id },
      { key: 'vuln_id', label: 'Vuln ID', type: 'text', width: 110 },
      { key: 'severity', label: 'Severity', type: 'badge', width: 110, badgeTone: sevTone, format: titleCase },
      { key: 'cvss_score', label: 'CVSS', type: 'number', width: 80, align: 'right', agg: 'avg' },
      { key: 'cve_id', label: 'CVE', type: 'text', width: 150 },
      { key: 'kev_flag', label: 'KEV', type: 'badge', width: 80, badgeTone: (v) => (boolTrue(v) ? TONE.red : TONE.slate), format: boolFmt },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'affected_host', label: 'Asset', type: 'text', width: 160, accessor: (r) => r.affected_host ?? r.asset_name ?? r.host_name },
      { key: 'assigned_to', label: 'Owner', type: 'text', width: 150, accessor: (r) => r.assignee_name ?? r.assigned_to },
      { key: 'due_date', label: 'Due', type: 'date', width: 120, accessor: (r) => r.due_date ?? r.sla_due_date },
      { key: 'discovered_at', label: 'Detected', type: 'date', width: 120, accessor: (r) => r.discovered_at ?? r.created_at },
      { key: 'resolved_at', label: 'Resolved', type: 'date', width: 120 },
    ],
  },
  {
    key: 'issues', permissions: ['issue_management:issues:*'], module: 'Issue & Incident Management', label: 'Enterprise Log', server: true,
    description: 'Issues and findings with severity, workflow state, assignment and SLA.',
    fetch: async () => asRows((await issuesApi.list({ limit: 5000 })).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/issues/${r.id}` },
      { key: 'code', label: 'Code', type: 'text', width: 90, href: (r) => `/issues/${r.id}` },
      { key: 'title', label: 'Issue', type: 'text', width: 260, href: (r) => `/issues/${r.id}` },
      { key: 'description', label: 'Description', type: 'text', width: 300 },
      { key: 'severity', label: 'Severity', type: 'badge', width: 110, badgeTone: sevTone, format: titleCase },
      { key: 'workflow_state', label: 'State', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'issue_type', label: 'Type', type: 'badge', width: 130, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'category', label: 'Category', type: 'text', width: 120, format: titleCase },
      { key: 'source_type', label: 'Source', type: 'badge', width: 130, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'sla_breached', label: 'SLA breached', type: 'badge', width: 110, badgeTone: (v) => (boolTrue(v) ? TONE.red : TONE.slate), format: boolFmt },
      { key: 'assignee', label: 'Assignee', type: 'text', width: 150, accessor: (r) => r.assignee_name ?? (r.assignee as { display_name?: string })?.display_name ?? r.assignee_id },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
      { key: 'target_closure_date', label: 'Target close', type: 'date', width: 120 },
    ],
  },
  {
    key: 'incidents', permissions: ['erm:incidents:*'], module: 'Issue & Incident Management', label: 'Incidents',
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
    key: 'tasks', permissions: ['critical_tasks:tasks:*', 'critical_tasks:reports:view'], module: 'Critical Tasks', label: 'Critical Tasks', server: true,
    description: 'Task workspace items with status, priority, SLA and ownership.',
    fetch: async () => asRows((await criticalTasksApi.list({ limit: 5000 })).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/tasks/${r.id}` },
      { key: 'title', label: 'Task', type: 'text', width: 300, href: (r) => `/tasks/${r.id}`, accessor: (r) => r.title ?? r.name },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'priority', label: 'Priority', type: 'badge', width: 110, badgeTone: sevTone, format: titleCase },
      { key: 'assignee_name', label: 'Assignee', type: 'text', width: 150, accessor: (r) => r.assignee_name ?? (r.assignee as { display_name?: string })?.display_name ?? r.assigned_owner_id },
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
    key: 'bcm_plans', permissions: ['bcm:plans:*'], module: 'Business Continuity', label: 'Continuity Plans',
    description: 'Business continuity plans with RTO/RPO, review cadence, BIA and drill coverage.',
    fetch: async () => asRows((await bcmApi.plans.list()).data),
    columns: [
      // Aligned to serialize_plan() (bcm/routers/_common.py) — `title` (not `name`)
      // is the real field; `plan_type` does not exist on BcmPlan.
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/bcm/plans/${r.id}` },
      { key: 'title', label: 'Plan', type: 'text', width: 260, href: (r) => `/bcm/plans/${r.id}`, accessor: (r) => r.title ?? r.name },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'business_unit', label: 'Business unit', type: 'text', width: 150 },
      { key: 'owner_name', label: 'Owner', type: 'text', width: 150 },
      { key: 'rto_hours', label: 'RTO (hrs)', type: 'number', width: 90, align: 'right', agg: 'avg' },
      { key: 'rpo_hours', label: 'RPO (hrs)', type: 'number', width: 90, align: 'right', agg: 'avg' },
      { key: 'testing_frequency', label: 'Test freq', type: 'badge', width: 120, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'bia_count', label: 'BIAs', type: 'number', width: 80, align: 'right', agg: 'sum' },
      { key: 'drill_count', label: 'Drills', type: 'number', width: 80, align: 'right', agg: 'sum' },
      { key: 'next_review_due', label: 'Next review', type: 'date', width: 130 },
      { key: 'approved_date', label: 'Approved', type: 'date', width: 120 },
      { key: 'updated_at', label: 'Updated', type: 'date', width: 120 },
    ],
  },
  {
    key: 'bcm_drills', permissions: ['bcm:drills:*'], module: 'Business Continuity', label: 'Drills & Invocations',
    description: 'BCM drills and invocations with outcome, schedule and findings.',
    fetch: async () => asRows((await bcmApi.drills.list()).data),
    columns: [
      // Aligned to serialize_drill() — `title` + `scheduled_date` are the real
      // fields; `outcome` does not exist on BcmDrill (effective_status/has_result
      // are the closest real signals of drill outcome).
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/bcm/drills/${r.id}` },
      { key: 'title', label: 'Drill', type: 'text', width: 240, href: (r) => `/bcm/drills/${r.id}`, accessor: (r) => r.title ?? r.name },
      { key: 'plan_title', label: 'Plan', type: 'text', width: 200 },
      { key: 'drill_type', label: 'Type', type: 'badge', width: 130, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'source_type', label: 'Source', type: 'badge', width: 140, badgeTone: () => TONE.teal, format: titleCase },
      { key: 'effective_status', label: 'Status', type: 'badge', width: 120, badgeTone: statusTone, format: titleCase },
      { key: 'is_overdue', label: 'Overdue', type: 'badge', width: 90, badgeTone: (v) => (boolTrue(v) ? TONE.red : TONE.slate), format: boolFmt },
      { key: 'owner_name', label: 'Owner', type: 'text', width: 150 },
      { key: 'scheduled_date', label: 'Scheduled', type: 'date', width: 130 },
      { key: 'actual_start', label: 'Started', type: 'date', width: 120 },
      { key: 'actual_end', label: 'Completed', type: 'date', width: 120 },
      { key: 'has_result', label: 'Has result', type: 'badge', width: 100, badgeTone: (v) => (boolTrue(v) ? TONE.green : TONE.slate), format: boolFmt },
      { key: 'finding_count', label: 'Findings', type: 'number', width: 90, align: 'right', agg: 'sum' },
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
    key: 'criticality_info', permissions: ['assets:criticality_assessments:view'], module: 'Cybersecurity Assurance', label: 'Info-system criticality',
    description: 'Information-system criticality assessments with total score, approval and owners.',
    fetch: async () => asRows((await criticalityApi.infoSystem.list()).data),
    columns: [
      // Aligned to ISCAResponse: total_score/criticality_level (not `criticality`/
      // `overall_rating`), business_owner_user_name, assessor_user_name, approval_status.
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/assets/criticality-assessments` },
      { key: 'name', label: 'System', type: 'text', width: 240, accessor: (r) => r.name ?? r.system_name ?? r.title },
      { key: 'total_score', label: 'Score', type: 'number', width: 90, align: 'right', badgeTone: scoreTone, agg: 'avg' },
      { key: 'criticality_level', label: 'Criticality', type: 'badge', width: 130, badgeTone: sevTone, format: titleCase, accessor: (r) => r.criticality_level ?? r.criticality },
      { key: 'approval_status', label: 'Approval', type: 'badge', width: 120, badgeTone: statusTone, format: titleCase },
      { key: 'business_owner_name', label: 'Business owner', type: 'text', width: 160, accessor: (r) => r.business_owner_user_name ?? r.business_owner_name ?? r.owner_name },
      { key: 'assessor_name', label: 'Assessor', type: 'text', width: 150, accessor: (r) => r.assessor_user_name ?? r.assessor_name },
      { key: 'date_of_assessment', label: 'Assessed', type: 'date', width: 120 },
      { key: 'updated_at', label: 'Updated', type: 'date', width: 120 },
    ],
  },
  {
    key: 'criticality_infra', permissions: ['assets:criticality_assessments:view'], module: 'Cybersecurity Assurance', label: 'Infra criticality',
    description: 'Infrastructure asset criticality assessments with total score, approval and custodians.',
    fetch: async () => asRows((await criticalityApi.infraAsset.list()).data),
    columns: [
      // Aligned to IACAResponse: total_score/criticality_level, custodian_user_name,
      // administrator_user_name, approval_status.
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/assets/criticality-assessments` },
      { key: 'name', label: 'Asset', type: 'text', width: 240, accessor: (r) => r.name ?? r.asset_name ?? r.title },
      { key: 'total_score', label: 'Score', type: 'number', width: 90, align: 'right', badgeTone: scoreTone, agg: 'avg' },
      { key: 'criticality_level', label: 'Criticality', type: 'badge', width: 130, badgeTone: sevTone, format: titleCase, accessor: (r) => r.criticality_level ?? r.criticality },
      { key: 'approval_status', label: 'Approval', type: 'badge', width: 120, badgeTone: statusTone, format: titleCase },
      { key: 'custodian_user_name', label: 'Custodian', type: 'text', width: 150, accessor: (r) => r.custodian_user_name ?? r.custodian_name },
      { key: 'administrator_user_name', label: 'Administrator', type: 'text', width: 160 },
      { key: 'location', label: 'Location', type: 'text', width: 140 },
      { key: 'updated_at', label: 'Updated', type: 'date', width: 120 },
    ],
  },
  {
    key: 'discovery_campaigns', permissions: ['assets:asset_inventory:*'], module: 'Cybersecurity Assurance', label: 'Discovery campaigns',
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
    key: 'regulatory_changes', permissions: ['governance:regulatory_changes:*'], module: 'Compliance Management', label: 'Regulatory changes',
    description: 'Tracked regulatory changes with regulator, owner, impact and implementation progress.',
    fetch: async () => asRows((await regulatoryApi.getChanges()).data),
    columns: [
      // Aligned to RegulatoryChangeResponse — no jurisdiction/deadline field exists;
      // regulatory_body + effective_date are the closest real equivalents.
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/governance/regulatory-changes/${r.id}` },
      { key: 'title', label: 'Change', type: 'text', width: 280, href: (r) => `/governance/regulatory-changes/${r.id}` },
      { key: 'source', label: 'Source', type: 'badge', width: 120, badgeTone: () => TONE.teal, format: titleCase },
      { key: 'regulatory_body', label: 'Regulator', type: 'badge', width: 140, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'priority', label: 'Priority', type: 'badge', width: 110, badgeTone: sevTone, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'assignee_name', label: 'Owner', type: 'text', width: 150 },
      { key: 'impact_summary', label: 'Impact', type: 'text', width: 260 },
      { key: 'gap_count', label: 'Gaps', type: 'number', width: 80, align: 'right', agg: 'sum' },
      { key: 'task_count', label: 'Tasks', type: 'number', width: 80, align: 'right', agg: 'sum' },
      { key: 'completed_task_count', label: 'Tasks done', type: 'number', width: 100, align: 'right', agg: 'sum' },
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
    description: 'Governance committees with cadence, secretariat and open-action load.',
    fetch: async () => asRows((await committeeApi.getCommittees()).data),
    columns: [
      // `status` does not exist on GovernanceCommittee (only `is_active`) — was blank.
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/governance/committees/${r.id}` },
      { key: 'name', label: 'Committee', type: 'text', width: 220, href: (r) => `/governance/committees/${r.id}` },
      { key: 'committee_type', label: 'Type', type: 'badge', width: 140, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'is_active', label: 'Active', type: 'badge', width: 90, badgeTone: (v) => (boolTrue(v) ? TONE.green : TONE.slate), format: boolFmt },
      { key: 'chair_name', label: 'Chair', type: 'text', width: 150 },
      { key: 'secretary_name', label: 'Secretariat', type: 'text', width: 150 },
      { key: 'meeting_frequency', label: 'Cadence', type: 'badge', width: 120, badgeTone: () => TONE.teal, format: titleCase },
      { key: 'member_count', label: 'Members', type: 'number', width: 90, align: 'right' },
      { key: 'meeting_count', label: 'Meetings', type: 'number', width: 90, align: 'right', agg: 'sum' },
      { key: 'pending_actions_count', label: 'Open actions', type: 'number', width: 110, align: 'right', agg: 'sum' },
      { key: 'description', label: 'Description', type: 'text', width: 240 },
      { key: 'updated_at', label: 'Updated', type: 'date', width: 120 },
    ],
  },
  {
    key: 'frameworks', permissions: ['compliance:frameworks:*'], module: 'Compliance Management', label: 'Framework catalog',
    description: 'Available compliance frameworks in the tenant, with control coverage.',
    fetch: async () => asRows((await frameworksApi.getAll()).data),
    columns: [
      // Aligned to FrameworkResponse — `framework_type`/`status`/`publisher` do not
      // exist on this response (were blank); short_code/regulator/jurisdiction/
      // is_mandatory/is_custom/control_count/domain_count are the real fields.
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/frameworks/${r.id}` },
      { key: 'name', label: 'Framework', type: 'text', width: 240, href: (r) => `/frameworks/${r.id}` },
      { key: 'short_code', label: 'Code', type: 'text', width: 100 },
      { key: 'regulator', label: 'Regulator', type: 'badge', width: 140, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'jurisdiction', label: 'Jurisdiction', type: 'text', width: 130 },
      { key: 'version', label: 'Version', type: 'text', width: 90 },
      { key: 'is_mandatory', label: 'Mandatory', type: 'badge', width: 110, badgeTone: (v) => (boolTrue(v) ? TONE.teal : TONE.slate), format: boolFmt },
      { key: 'is_custom', label: 'Custom', type: 'badge', width: 90, badgeTone: (v) => (boolTrue(v) ? TONE.teal : TONE.slate), format: boolFmt },
      { key: 'is_active', label: 'Active', type: 'badge', width: 90, badgeTone: (v) => (boolTrue(v) ? TONE.green : TONE.slate), format: boolFmt },
      { key: 'control_count', label: 'Controls', type: 'number', width: 90, align: 'right', agg: 'sum' },
      { key: 'domain_count', label: 'Domains', type: 'number', width: 90, align: 'right', agg: 'sum' },
      { key: 'description', label: 'Description', type: 'text', width: 260 },
    ],
  },
  {
    key: 'internal_controls', permissions: ['erm:risks:*'], module: 'Control Testing & Assurance', label: 'Internal Control Register', server: true,
    description: 'Internal controls with design/operating effectiveness, testing and ownership.',
    fetch: async () => asRows((await ermApi.internalControls.getAll()).data),
    columns: [
      { key: 'control_id', label: 'Ref', type: 'text', width: 120, href: () => `/erm/internal-controls` },
      { key: 'name', label: 'Control', type: 'text', width: 320, href: () => `/erm/internal-controls` },
      { key: 'category', label: 'Category', type: 'badge', width: 150, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'control_type', label: 'Type', type: 'badge', width: 130, badgeTone: () => TONE.teal, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'design_effectiveness', label: 'Design', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'operating_effectiveness', label: 'Operating', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'priority', label: 'Priority', type: 'badge', width: 110, badgeTone: sevTone, format: titleCase },
      { key: 'is_key_control', label: 'Key', type: 'badge', width: 80, badgeTone: (v) => (boolTrue(v) ? TONE.teal : TONE.slate), format: boolFmt },
      { key: 'owner_name', label: 'Owner', type: 'text', width: 150, accessor: (r) => r.owner_name ?? r.owner_id },
      { key: 'next_test_date', label: 'Next test', type: 'date', width: 130 },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
    ],
  },
  {
    key: 'risk_assessments', permissions: ['risks:risk_assessment:*', 'erm:risks:*'], module: 'Risk Management', label: 'Risk Assessments',
    description: 'ERM risk assessments with methodology, period and status.',
    fetch: async () => asRows((await ermApi.riskAssessments.getAll()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: () => `/erm/risk-assessments` },
      { key: 'name', label: 'Assessment', type: 'text', width: 300, href: () => `/erm/risk-assessments` },
      { key: 'assessment_type', label: 'Type', type: 'badge', width: 140, badgeTone: () => TONE.teal, format: titleCase },
      { key: 'methodology', label: 'Methodology', type: 'text', width: 150, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'assessed_risks_count', label: 'Risks', type: 'number', width: 90, align: 'right', agg: 'sum' },
      { key: 'assessment_period_start', label: 'Period start', type: 'date', width: 120 },
      { key: 'assessment_period_end', label: 'Period end', type: 'date', width: 120 },
      { key: 'approved_at', label: 'Approved', type: 'date', width: 120 },
      { key: 'completed_at', label: 'Completed', type: 'date', width: 120 },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
    ],
  },
  {
    key: 'risk_reviews', permissions: ['erm:risks:*'], module: 'Risk Management', label: 'Risk Reviews',
    description: 'Risk review cycles with before/after scoring and outcomes.',
    fetch: async () => asRows((await ermApi.reviews.getAll()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: () => `/erm/reviews` },
      { key: 'risk_title', label: 'Risk', type: 'text', width: 300, href: () => `/erm/reviews` },
      { key: 'review_cycle', label: 'Cycle', type: 'text', width: 120, format: titleCase },
      { key: 'review_type', label: 'Type', type: 'badge', width: 130, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'new_inherent_score', label: 'Inherent', type: 'number', width: 100, align: 'right', badgeTone: scoreTone, agg: 'avg' },
      { key: 'new_residual_score', label: 'Residual', type: 'number', width: 100, align: 'right', badgeTone: scoreTone, agg: 'avg' },
      { key: 'due_date', label: 'Due', type: 'date', width: 120 },
      { key: 'started_at', label: 'Started', type: 'date', width: 120 },
      { key: 'completed_at', label: 'Completed', type: 'date', width: 120 },
    ],
  },
  {
    key: 'rcsa_findings', permissions: ['erm:rcsa:*'], module: 'Risk Management', label: 'RCSA Findings',
    description: 'Risk & control self-assessment findings with severity and remediation.',
    fetch: async () => asRows((await rcsaApi.getFindings()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: () => `/erm/rcsa` },
      { key: 'title', label: 'Finding', type: 'text', width: 320, href: () => `/erm/rcsa` },
      { key: 'finding_type', label: 'Type', type: 'badge', width: 130, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'severity', label: 'Severity', type: 'badge', width: 110, badgeTone: sevTone, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'risk_category', label: 'Category', type: 'text', width: 150, format: titleCase },
      { key: 'remediation_owner_name', label: 'Owner', type: 'text', width: 150 },
      { key: 'ai_generated', label: 'AI', type: 'badge', width: 70, badgeTone: (v) => (boolTrue(v) ? TONE.teal : TONE.slate), format: boolFmt },
      { key: 'remediation_due_date', label: 'Due', type: 'date', width: 120 },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
      { key: 'closed_at', label: 'Closed', type: 'date', width: 120 },
    ],
  },
  {
    key: 'rcsa_campaigns', permissions: ['erm:rcsa:*'], module: 'Risk Management', label: 'RCSA Campaigns',
    description: 'RCSA campaigns with period, progress and completion.',
    fetch: async () => asRows((await rcsaApi.getCampaigns()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: () => `/erm/rcsa` },
      { key: 'name', label: 'Campaign', type: 'text', width: 300, href: () => `/erm/rcsa` },
      { key: 'template_name', label: 'Template', type: 'text', width: 180 },
      { key: 'period_type', label: 'Period', type: 'badge', width: 120, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'period_label', label: 'Label', type: 'text', width: 130 },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'assessment_count', label: 'Assessments', type: 'number', width: 120, align: 'right', agg: 'sum' },
      { key: 'completed_count', label: 'Completed', type: 'number', width: 110, align: 'right', agg: 'sum' },
      { key: 'start_date', label: 'Start', type: 'date', width: 120 },
      { key: 'due_date', label: 'Due', type: 'date', width: 120 },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
    ],
  },
  {
    key: 'policy_statements', permissions: ['governance:policies:*'], module: 'Governance', label: 'Policy Statements',
    description: 'Extracted policy statements with compliance status and ownership.',
    fetch: async () => asRows((await complianceApi.statements.getAll()).data?.statements),
    columns: [
      { key: 'statement_code', label: 'Code', type: 'text', width: 120, href: () => `/compliance/statements` },
      { key: 'document_title', label: 'Document', type: 'text', width: 240 },
      { key: 'category', label: 'Category', type: 'badge', width: 140, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'priority', label: 'Priority', type: 'badge', width: 110, badgeTone: sevTone, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 120, badgeTone: statusTone, format: titleCase },
      { key: 'compliance_status', label: 'Compliance', type: 'badge', width: 140, badgeTone: statusTone, format: titleCase },
      { key: 'compliance_score', label: 'Score', type: 'number', width: 90, align: 'right', agg: 'avg' },
      { key: 'assignee_name', label: 'Owner', type: 'text', width: 150 },
      { key: 'is_mandatory', label: 'Mandatory', type: 'badge', width: 110, badgeTone: (v) => (boolTrue(v) ? TONE.teal : TONE.slate), format: boolFmt },
      { key: 'review_date', label: 'Review', type: 'date', width: 120 },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
    ],
  },
  {
    key: 'audit_packages', permissions: ['evidence:evidence_library:*', 'evidence:evidence_upload:*'], module: 'Compliance Management', label: 'Audit Packages',
    description: 'Evidence audit packages with framework, retention and legal hold.',
    fetch: async () => asRows((await apiClient.get('/evidence-mgmt/audit-packages')).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: () => `/evidence/audit-packages` },
      { key: 'name', label: 'Package', type: 'text', width: 280, href: () => `/evidence/audit-packages` },
      { key: 'framework_name', label: 'Framework', type: 'text', width: 200 },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'evidence_count', label: 'Evidence', type: 'number', width: 100, align: 'right', agg: 'sum' },
      { key: 'creator_name', label: 'Created by', type: 'text', width: 150 },
      { key: 'is_legal_hold', label: 'Legal hold', type: 'badge', width: 110, badgeTone: (v) => (boolTrue(v) ? TONE.red : TONE.slate), format: boolFmt },
      { key: 'audit_period_start', label: 'Period start', type: 'date', width: 120 },
      { key: 'audit_period_end', label: 'Period end', type: 'date', width: 120 },
      { key: 'finalized_at', label: 'Finalized', type: 'date', width: 120 },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
    ],
  },
  {
    key: 'vendor_assessments', permissions: ['erm:risks:*'], module: 'Third-Party Vendor Risk', label: 'Vendor Assessments',
    description: 'Third-party assessments with inherent/residual scoring and rating.',
    fetch: async () => asRows((await vendorRiskApi.getAssessments()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: () => `/vendor-risk/assessments` },
      { key: 'vendor_name', label: 'Vendor', type: 'text', width: 220, href: () => `/vendor-risk/assessments` },
      { key: 'assessment_type', label: 'Type', type: 'badge', width: 140, badgeTone: () => TONE.teal, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'risk_rating', label: 'Risk', type: 'badge', width: 120, badgeTone: sevTone, format: titleCase },
      { key: 'inherent_score', label: 'Inherent', type: 'number', width: 100, align: 'right', badgeTone: scoreTone, agg: 'avg' },
      { key: 'residual_score', label: 'Residual', type: 'number', width: 100, align: 'right', badgeTone: scoreTone, agg: 'avg' },
      { key: 'template_name', label: 'Template', type: 'text', width: 170 },
      { key: 'due_date', label: 'Due', type: 'date', width: 120 },
      { key: 'completed_at', label: 'Completed', type: 'date', width: 120 },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
    ],
  },
  {
    key: 'tpra_findings', permissions: ['erm:risks:*'], module: 'Third-Party Vendor Risk', label: 'TPRA Findings',
    description: 'Third-party risk assessment findings across the vendor portfolio.',
    fetch: async () => asRows((await tpraApi.findingsRegister()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: () => `/vendor-risk` },
      { key: 'title', label: 'Finding', type: 'text', width: 320, href: () => `/vendor-risk` },
      { key: 'vendor_name', label: 'Vendor', type: 'text', width: 200 },
      { key: 'severity', label: 'Severity', type: 'badge', width: 110, badgeTone: sevTone, format: titleCase },
      { key: 'domain', label: 'Domain', type: 'badge', width: 150, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'is_critical_control_fail', label: 'Critical fail', type: 'badge', width: 120, badgeTone: (v) => (boolTrue(v) ? TONE.red : TONE.slate), format: boolFmt },
      { key: 'overdue', label: 'Overdue', type: 'badge', width: 100, badgeTone: (v) => (boolTrue(v) ? TONE.red : TONE.slate), format: boolFmt },
      { key: 'due_date', label: 'Due', type: 'date', width: 120 },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
    ],
  },
  {
    key: 'oversight_actions', permissions: ['governance:committees:*'], module: 'Governance', label: 'Oversight Actions',
    description: 'Committee oversight actions with assignment and due tracking.',
    fetch: async () => asRows((await committeeApi.getActions()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: () => `/governance/committees` },
      { key: 'action_number', label: 'No.', type: 'text', width: 100 },
      { key: 'title', label: 'Action', type: 'text', width: 300, href: () => `/governance/committees` },
      { key: 'committee_name', label: 'Committee', type: 'text', width: 180 },
      { key: 'action_type', label: 'Type', type: 'badge', width: 130, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'assignee_name', label: 'Assignee', type: 'text', width: 150 },
      { key: 'is_overdue', label: 'Overdue', type: 'badge', width: 100, badgeTone: (v) => (boolTrue(v) ? TONE.red : TONE.slate), format: boolFmt },
      { key: 'due_date', label: 'Due', type: 'date', width: 120 },
      { key: 'completed_at', label: 'Completed', type: 'date', width: 120 },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
    ],
  },
  {
    key: 'ai_risk_assessments', permissions: ['erm:risks:*'], module: 'Risk Management', label: 'AI Risk Assessments',
    description: 'AI system risk assessment entries with scoring and residual level.',
    fetch: async () => asRows((await aiRiskAssessmentApi.list()).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: () => `/erm/ai-risk-assessment` },
      { key: 'ai_system_use_case', label: 'Use case', type: 'text', width: 300, href: () => `/erm/ai-risk-assessment` },
      { key: 'risk_category', label: 'Category', type: 'badge', width: 150, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'likelihood', label: 'Likelihood', type: 'number', width: 100, align: 'right' },
      { key: 'impact', label: 'Impact', type: 'number', width: 90, align: 'right' },
      { key: 'risk_score', label: 'Score', type: 'number', width: 90, align: 'right', badgeTone: scoreTone, agg: 'avg' },
      { key: 'residual_risk_level', label: 'Residual', type: 'badge', width: 120, badgeTone: sevTone, format: titleCase },
      { key: 'risk_owner', label: 'Owner', type: 'text', width: 150 },
      { key: 'status', label: 'Status', type: 'badge', width: 130, badgeTone: statusTone, format: titleCase },
      { key: 'target_review_date', label: 'Review', type: 'date', width: 120 },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
    ],
  },
  // ── Wave 3 — newly covered product areas ──────────────────────────────────
  {
    key: 'access_reviews', permissions: ['compliance:frameworks:*'], module: 'Compliance Management', label: 'Access Review Campaigns',
    description: 'User access certification campaigns with sampling, decisions and exceptions.',
    // Backend wraps the list as { campaigns: [...] } (grc/routers/access_review_router.py).
    fetch: async () => { const d = (await apiClient.get('/access-reviews')).data; return asRows(d?.campaigns ?? d); },
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70, href: (r) => `/compliance/access-reviews/${r.id}` },
      { key: 'name', label: 'Campaign', type: 'text', width: 260, href: (r) => `/compliance/access-reviews/${r.id}` },
      { key: 'review_type', label: 'Scope', type: 'badge', width: 130, badgeTone: () => TONE.slate, format: titleCase },
      { key: 'sampling_method', label: 'Sampling', type: 'badge', width: 120, badgeTone: () => TONE.teal, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 140, badgeTone: statusTone, format: titleCase },
      { key: 'population_size', label: 'Population', type: 'number', width: 100, align: 'right', agg: 'sum' },
      { key: 'requested_sample_size', label: 'Sample size', type: 'number', width: 110, align: 'right', agg: 'sum' },
      { key: 'items_reviewed', label: 'Reviewed', type: 'number', width: 100, align: 'right', agg: 'sum' },
      { key: 'exceptions_found', label: 'Exceptions', type: 'number', width: 100, align: 'right', agg: 'sum' },
      { key: 'created_at', label: 'Created', type: 'date', width: 120 },
    ],
  },
  {
    key: 'regulatory_feeds', permissions: ['governance:regulatory_changes:*'], module: 'Compliance Management', label: 'Regulatory Feeds',
    description: 'Ingested regulatory feed items with AI-assessed priority and processing status.',
    fetch: async () => asRows((await apiClient.get('/governance/regulatory-feeds/items')).data),
    columns: [
      { key: 'id', label: 'ID', type: 'number', width: 70 },
      { key: 'title', label: 'Item', type: 'text', width: 320, href: (r) => (typeof r.link === 'string' && r.link) || null },
      { key: 'feed_source_name', label: 'Source', type: 'badge', width: 160, badgeTone: () => TONE.teal, format: titleCase },
      { key: 'status', label: 'Status', type: 'badge', width: 120, badgeTone: statusTone, format: titleCase },
      { key: 'priority', label: 'AI priority', type: 'badge', width: 110, badgeTone: sevTone, format: titleCase, accessor: (r) => (r.ai_analysis as { priority?: string } | null)?.priority },
      { key: 'regulatory_change_id', label: 'Linked change', type: 'number', width: 120, align: 'right' },
      { key: 'published_date', label: 'Published', type: 'date', width: 130 },
      { key: 'processed_at', label: 'Processed', type: 'date', width: 130 },
      { key: 'created_at', label: 'Ingested', type: 'date', width: 120 },
    ],
  },
  {
    key: 'assessments_cyber', permissions: ['compliance:assessments:*'], module: 'Compliance Management', label: 'Cyber Security Assessments',
    description: 'ASVS, OWASP, mobile app security and cyber-maturity assessments (CSIR/CTI/Incident/ITSecOps).',
    fetch: async () => fetchAssessmentsByFormats([
      'asvs_checklist', 'owasp_v4_testing_checklist', 'mobile_app_security',
      'csir_maturity', 'cti_maturity', 'incident_maturity', 'itsecops_maturity',
    ]),
    columns: ASSESSMENT_COLUMNS,
  },
  {
    key: 'assessments_nca', permissions: ['compliance:assessments:*'], module: 'Compliance Management', label: 'NCA Assessments',
    description: 'NCA DCC essential-controls tool plus vulnerability/audit/risk registers.',
    fetch: async () => fetchAssessmentsByFormats([
      'nca_dcc_tool', 'nca_vuln_register', 'nca_audit_register', 'nca_risk_register',
    ]),
    columns: ASSESSMENT_COLUMNS,
  },
  {
    key: 'assessments_digital_ops', permissions: ['compliance:assessments:*'], module: 'Compliance Management', label: 'Digital Operations Maturity',
    description: 'Digital operations maturity assessments.',
    fetch: async () => fetchAssessmentsByFormats(['digital_ops_maturity']),
    columns: ASSESSMENT_COLUMNS,
  },
  {
    key: 'assessments_dpia', permissions: ['compliance:assessments:*'], module: 'Compliance Management', label: 'DPIA / PIA Assessments',
    description: 'Data Protection Impact Assessments.',
    fetch: async () => fetchAssessmentsByFormats(['dpia_pia']),
    columns: ASSESSMENT_COLUMNS,
  },
  {
    key: 'assessments_pdpl', permissions: ['compliance:assessments:*'], module: 'Compliance Management', label: 'Saudi PDPL Assessments',
    description: 'Saudi PDPL assessment toolkit submissions.',
    fetch: async () => fetchAssessmentsByFormats(['pdpl_assessment_toolkit']),
    columns: ASSESSMENT_COLUMNS,
  },
  {
    key: 'internal_audit', permissions: ['compliance:assessments:*'], module: 'Auditor Portal', label: 'Internal Audit',
    description: 'Internal audit master-tracking assessments (UBL audit format).',
    fetch: async () => fetchAssessmentsByFormats(['ubl_audit_master_tracking']),
    columns: ASSESSMENT_COLUMNS,
  },
  // `auditor_packages` (Sidebar: Auditor Portal › Portal) has no dedicated list
  // API of its own — the page picks a framework via the same certification-journey
  // list already covered by the `journeys` dataset, then drills into per-framework
  // evidence/controls/risks/vendors tabs (no flat register to report on). Reused
  // rather than duplicated; see COVERAGE_MATRIX.md.
];

export { sevTone };
export function datasetByKey(key: string): ReportDataset | undefined {
  return DATASETS.find((d) => d.key === key);
}
