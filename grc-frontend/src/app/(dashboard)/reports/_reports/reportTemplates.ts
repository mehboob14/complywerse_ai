// Starting points for the three report types the module is expected to produce:
// Executive (posture at a glance), Audit (evidence of control operation) and
// Regulatory (framework/obligation status).
//
// These are ordinary builder specs, not bespoke report code. That matters: a
// template opens in the Builder as a normal editable report, so a user can
// re-slice it instead of asking for a new hard-coded page — and every template
// automatically inherits pivoting, filters, charts and all four export formats.
//
// Every `rows`/`col`/`measures` key below must exist in that dataset's columns
// (see datasets.ts) — a typo would silently produce an empty report.

import type { ReportSpec } from './types';

export type TemplateCategory = 'Executive' | 'Audit' | 'Regulatory';

export interface ReportTemplate {
  id: string;
  category: TemplateCategory;
  name: string;
  description: string;
  dataset: string;
  spec: Omit<ReportSpec, 'id' | 'name' | 'dataset'>;
}

const base = {
  rules: { logic: 'AND' as const, conditions: [] },
  search: '',
  measureIdx: 0,
};

export const REPORT_TEMPLATES: ReportTemplate[] = [
  // ── Executive ───────────────────────────────────────────────────────────
  {
    id: 'exec-risk-posture',
    category: 'Executive',
    name: 'Risk posture by category',
    description: 'Open vs closed risk across categories, with average residual score.',
    dataset: 'risks',
    spec: {
      ...base,
      rows: ['risk_category'],
      col: 'closure_status',
      measures: [{ id: 'm0', key: '', agg: 'count' }, { id: 'm1', key: 'residual_score', agg: 'avg' }],
      view: 'bar',
    },
  },
  {
    id: 'exec-vuln-posture',
    category: 'Executive',
    name: 'Vulnerability posture by severity',
    description: 'Remediation status across severities, with average CVSS.',
    dataset: 'vulnerabilities',
    spec: {
      ...base,
      rows: ['severity'],
      col: 'status',
      measures: [{ id: 'm0', key: '', agg: 'count' }, { id: 'm1', key: 'cvss_score', agg: 'avg' }],
      view: 'bar',
    },
  },
  {
    id: 'exec-asset-exposure',
    category: 'Executive',
    name: 'Asset exposure by criticality',
    description: 'Which critical assets are internet-facing.',
    dataset: 'assets',
    spec: {
      ...base,
      rows: ['criticality'],
      col: 'internet_facing',
      measures: [{ id: 'm0', key: '', agg: 'count' }],
      view: 'bar',
    },
  },

  // ── Audit ───────────────────────────────────────────────────────────────
  {
    id: 'audit-control-automation',
    category: 'Audit',
    name: 'Control maturity distribution',
    description: 'Control population broken down by maturity level.',
    dataset: 'controls',
    spec: {
      ...base,
      rows: ['maturity_level'],
      col: null,
      measures: [{ id: 'm0', key: '', agg: 'count' }],
      view: 'bar',
    },
  },
  {
    id: 'audit-evidence-status',
    category: 'Audit',
    name: 'Evidence status by type',
    description: 'Evidence population and approval status — the audit trail at a glance.',
    dataset: 'evidence',
    spec: {
      ...base,
      rows: ['file_type'],
      col: 'status',
      measures: [{ id: 'm0', key: '', agg: 'count' }],
      view: 'table',
    },
  },
  {
    id: 'audit-vuln-owner',
    category: 'Audit',
    name: 'Open findings by owner',
    description: 'Who owns the open remediation work, nested by severity.',
    dataset: 'vulnerabilities',
    spec: {
      ...base,
      rows: ['owner', 'severity'],
      col: 'status',
      measures: [{ id: 'm0', key: '', agg: 'count' }],
      view: 'table',
    },
  },

  // ── Regulatory ──────────────────────────────────────────────────────────
  {
    id: 'reg-framework-status',
    category: 'Regulatory',
    name: 'Framework journey status',
    description: 'Certification progress per framework — ISO, SOC 2, PCI, NIST and the rest.',
    dataset: 'journeys',
    spec: {
      ...base,
      rows: ['framework_type', 'framework_name'],
      col: 'status',
      measures: [{ id: 'm0', key: '', agg: 'count' }],
      view: 'table',
    },
  },
  {
    id: 'reg-policy-review',
    category: 'Regulatory',
    name: 'Policy review status',
    description: 'Governance documents by type and status — what is due for review.',
    dataset: 'gov_documents',
    spec: {
      ...base,
      rows: ['document_type'],
      col: 'status',
      measures: [{ id: 'm0', key: '', agg: 'count' }],
      view: 'table',
    },
  },
  {
    id: 'reg-vendor-tier',
    category: 'Regulatory',
    name: 'Third-party risk by tier',
    description: 'Vendor population by criticality tier and data-access level.',
    dataset: 'vendors',
    spec: {
      ...base,
      rows: ['criticality'],
      col: 'data_access_level',
      measures: [{ id: 'm0', key: '', agg: 'count' }],
      view: 'bar',
    },
  },
];

/** Build a fresh, unsaved spec from a template. */
export function specFromTemplate(t: ReportTemplate): ReportSpec {
  return { id: '', name: t.name, dataset: t.dataset, ...t.spec };
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['Executive', 'Audit', 'Regulatory'];
