// Report dataset registry — maps each module's list API to a set of columns.
// Add a dataset here and it shows up in the Reports module switcher automatically.

import apiClient, { risksApi, controlsApi, evidenceApi, certificationsApi, assetsApi, vendorRiskApi, vulnManagementApi } from '@/lib/api';
import type { ColumnDef, ReportDataset, Row } from './types';

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
    fetch: async () => ((await risksApi.getAll()).data as unknown as Row[]) || [],
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
    fetch: async () => ((await controlsApi.getAll()).data as unknown as Row[]) || [],
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
    fetch: async () => ((await evidenceApi.getAll()).data as unknown as Row[]) || [],
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
    fetch: async () => ((await certificationsApi.getAll()).data as unknown as Row[]) || [],
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
    fetch: async () => ((await apiClient.get('/governance/documents')).data as unknown as Row[]) || [],
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
    fetch: async () => ((await assetsApi.getAll()).data as unknown as Row[]) || [],
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
    fetch: async () => {
      const d = (await vendorRiskApi.getVendors()).data as { items?: Row[]; vendors?: Row[] } | Row[];
      return (Array.isArray(d) ? d : d.items ?? d.vendors ?? []) as Row[];
    },
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
    fetch: async () => ((await vulnManagementApi.vulnerabilities.getAll()).data as unknown as Row[]) || [],
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
];

export { sevTone };
export function datasetByKey(key: string): ReportDataset | undefined {
  return DATASETS.find((d) => d.key === key);
}
