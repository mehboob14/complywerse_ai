'use client';

// 1LINK register — the template's own fields (Book4.xlsx risk-register workbook),
// rendered inside the risk Add/Edit modal when the "1LINK" register type is
// selected. Values are held as a flat string map and persisted verbatim on the
// risk's `template_fields` blob; `deriveCore()` maps the key fields onto the
// risk's core columns so the register list, heat-map and scoring stay in sync.
//
// Self-contained on purpose (config + renderer + helpers in one file) so the only
// change to the big list/page.tsx is a small import + one conditional block.

import React from 'react';

export type OneLinkValue = Record<string, string>;

/** Dropdown option lists resolved by the host form (tenant users, departments,
 *  incidents). Values are stored as plain strings on template_fields. */
export interface OneLinkLookups {
  users?: string[];
  departments?: string[];
  incidents?: string[];
  controls?: string[];
  documents?: string[];
}

type FieldType = 'text' | 'textarea' | 'select' | 'date' | 'rating' | 'number';
interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  full?: boolean;
  /** System-generated — rendered read-only. */
  readonly?: boolean;
  /** Populate options from the host-provided lookups. */
  lookup?: keyof OneLinkLookups;
  /** Options that depend on another field's current value (e.g. sub-category
   *  lists keyed by the selected category). */
  optionsFrom?: (v: OneLinkValue) => string[];
}
interface Group { title: string; hint?: string; fields: FieldDef[] }

const RATING = ['', '1', '2', '3', 'N/A'];
const LMH = ['', 'Low', 'Medium', 'High'];

// ERM risk categories & sub-categories exactly as defined in the 1LINK ERM
// Framework V2.0, §4.2 "Integrated Risk Management" (page 15 table).
export const ONELINK_CLASSIFICATIONS = ['Financial', 'Operational', 'Compliance', 'Strategic'];

export const ONELINK_SUBCATEGORIES: Record<string, string[]> = {
  Financial: ['Financial Reporting Risk', 'Liquidity Risk', 'Credit Risk', 'Settlement Risk', 'Market Risk'],
  Operational: [
    'Information Technology Risk', 'Cybersecurity Risk', 'People Risk',
    'Data Privacy Risk', 'Fraud Risk', 'Outsourcing and Third Party',
  ],
  Compliance: ['Regulatory and Compliance Risk', 'Legal Risk'],
  Strategic: ['Reputational and Brand Risk'],
};

// Basel II operational loss event taxonomy (Level I → Level II), referenced by
// the register's two Basel II columns.
export const BASEL_II_LEVEL_1 = [
  'Internal Fraud',
  'External Fraud',
  'Employment Practices and Workplace Safety',
  'Clients, Products & Business Practices',
  'Damage to Physical Assets',
  'Business Disruption and System Failures',
  'Execution, Delivery & Process Management',
];

export const BASEL_II_LEVEL_2: Record<string, string[]> = {
  'Internal Fraud': ['Unauthorised Activity', 'Theft and Fraud'],
  'External Fraud': ['Theft and Fraud', 'Systems Security'],
  'Employment Practices and Workplace Safety': ['Employee Relations', 'Safe Environment', 'Diversity & Discrimination'],
  'Clients, Products & Business Practices': [
    'Suitability, Disclosure & Fiduciary', 'Improper Business or Market Practices',
    'Product Flaws', 'Selection, Sponsorship & Exposure', 'Advisory Activities',
  ],
  'Damage to Physical Assets': ['Disasters and Other Events'],
  'Business Disruption and System Failures': ['Systems'],
  'Execution, Delivery & Process Management': [
    'Transaction Capture, Execution & Maintenance', 'Monitoring & Reporting',
    'Customer Intake & Documentation', 'Customer / Client Account Management',
    'Trade Counterparties', 'Vendors & Suppliers',
  ],
};

const COSO_COMPONENTS = [
  'Control Environment', 'Risk Assessment', 'Control Activities',
  'Information & Communication', 'Monitoring Activities',
];

/** True when a risk's register_type is the 1LINK register (current '1LINK'
 *  label or the legacy '1LINK ERM RCSA' value still stored on older rows). */
export function isOneLinkRegisterType(value: string | null | undefined): boolean {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes('1link');
}

/** The template groups that constitute the risk-assessment portion of the
 *  1LINK register (surfaced inside Risk Assessments for 1LINK risks). */
export const ONELINK_ASSESSMENT_GROUP_TITLES = [
  'Business Impact Factors',
  'Gross Risk Assessment',
  'Control Design Effectiveness Factors',
  'Control Assessment',
  'Residual Risk & Response',
];

// Groups, fields and labels mirror the 1LINK risk-register workbook column-for-
// column (Book4.xlsx). Keys are stable identifiers — do NOT rename them, they are
// how previously saved risks' template_fields are keyed.
export const ONELINK_FIELD_GROUPS: Group[] = [
  {
    title: 'Identification',
    fields: [
      { key: 'serial_no', label: 'S.No.', type: 'text', readonly: true },
      { key: 'risk_id', label: 'RISK ID', type: 'text', readonly: true },
      { key: 'newly_added', label: 'Newly added', type: 'select', options: ['', 'Yes', 'No'] },
      { key: 'date_identified', label: 'Date of Risk Identification', type: 'date' },
      { key: 'remarks', label: 'Remarks', type: 'textarea', full: true },
      { key: 'cisa_review_cycle', label: 'CISA Review Cycle', type: 'text' },
      { key: 'date_reassessment', label: 'Date of Risk Reassessment', type: 'date' },
      { key: 'department', label: 'Department', type: 'select', lookup: 'departments' },
      { key: 'function', label: 'Department - Function', type: 'text' },
      { key: 'product', label: 'Product', type: 'text' },
      { key: 'process_ref', label: 'Cycle / Process Reference', type: 'text' },
      { key: 'sub_process', label: 'Sub - Process Name', type: 'text' },
      { key: 'risk_owner', label: 'Risk Owner', type: 'select', lookup: 'users' },
      { key: 'erm_classification', label: 'ERM Risk Classification', type: 'select', options: ['', ...ONELINK_CLASSIFICATIONS] },
      {
        key: 'erm_sub_category', label: 'ERM Risk Sub-Categories', type: 'select',
        optionsFrom: (v) => ONELINK_SUBCATEGORIES[(v.erm_classification || '').trim()]
          || Object.values(ONELINK_SUBCATEGORIES).flat(),
      },
      {
        key: 'basel_ii_event_type_1', label: 'Basel II Operational Loss Event Type I', type: 'select', full: true,
        options: ['', ...BASEL_II_LEVEL_1],
      },
      {
        key: 'basel_ii_event_type_2', label: 'Basel II Operational Loss Event Type II', type: 'select', full: true,
        optionsFrom: (v) => BASEL_II_LEVEL_2[(v.basel_ii_event_type_1 || '').trim()]
          || Object.values(BASEL_II_LEVEL_2).flat(),
      },
    ],
  },
  {
    title: 'Business Impact Factors',
    hint: 'Rate each 1 (low) – 3 (high), or N/A',
    fields: [
      { key: 'impact_financial_impact', label: 'Financial Impact', type: 'rating' },
      { key: 'impact_criticality_on_revenue', label: 'Criticality on Revenue', type: 'rating' },
      { key: 'impact_impact_on_financial_ecosystem', label: 'Impact on Financial Ecosystem', type: 'rating' },
      { key: 'impact_geographical_spread_of_service_delivery', label: 'Geographical Spread of Service Delivery', type: 'rating' },
      { key: 'impact_strategic_importance', label: 'Strategic Importance', type: 'rating' },
      { key: 'impact_size_diversity_criticality_of_customer_base', label: 'Size & Diversity / Criticality of Customer Base', type: 'rating' },
      { key: 'impact_average_monthly_volume_of_transactions', label: 'Average Monthly Volume of Transactions/ Activity', type: 'rating' },
      { key: 'impact_regulatory_compliance_obligations', label: 'Regulatory Compliance Obligations', type: 'rating' },
      { key: 'impact_dependency_on_external_vendors', label: 'Dependency on External Vendor(s) and External Parties', type: 'rating' },
      { key: 'impact_extent_of_functions_impacted_by_process', label: 'Extent of Functions Impacted by Process', type: 'rating' },
    ],
  },
  {
    title: 'Gross Risk Assessment',
    hint: 'Ratings auto-computed per the 3×3 assessment mechanism',
    fields: [
      { key: 'overall_impact_rating', label: 'Overall Impact Rating (1–3)', type: 'text', readonly: true },
      { key: 'overall_impact', label: 'Overall Impact', type: 'text', readonly: true },
      { key: 'likelihood', label: 'Likelihood (1–3)', type: 'select', options: RATING },
      { key: 'inherent_rating', label: 'Inherent Risk Rating', type: 'text', readonly: true },
      { key: 'inherent_heatmap', label: 'Risk Heat Map - Inherent', type: 'text', readonly: true },
    ],
  },
  {
    title: 'Control',
    fields: [
      { key: 'control_ref', label: 'Control Reference No.', type: 'select', lookup: 'controls' },
      { key: 'control_owner', label: 'Control Owner', type: 'select', lookup: 'users' },
      { key: 'control_objective', label: 'Control Objective', type: 'textarea', full: true },
      { key: 'control_description', label: 'Control Description', type: 'textarea', full: true },
      { key: 'document_ref', label: 'Document Reference', type: 'select', lookup: 'documents' },
      { key: 'coso_classification', label: 'COSO Classification', type: 'select', options: ['', ...COSO_COMPONENTS] },
      { key: 'nature', label: 'Nature of Control (Preventive, Detective, Corrective)', type: 'select', options: ['', 'Preventive', 'Detective', 'Corrective'] },
      { key: 'mechanism', label: 'Control Mechanism (Automated / Manual)', type: 'select', options: ['', 'Automated', 'Manual'] },
      { key: 'frequency', label: 'Frequency of Control', type: 'text' },
    ],
  },
  {
    title: 'Control Design Effectiveness Factors',
    hint: 'Rate each 1 – 3, or N/A',
    fields: [
      { key: 'cde_controls_in_written_form', label: 'Controls in written form', type: 'rating' },
      { key: 'cde_1st_level_controls', label: '1st-Level Controls', type: 'rating' },
      { key: 'cde_2nd_level_controls', label: '2nd-Level Controls', type: 'rating' },
      { key: 'cde_design_reviews_2nd_line_of_defense', label: 'Diagnosis of control design reviews from second line of defense', type: 'rating' },
      { key: 'cde_design_reviews_during_audits_3rd_line', label: 'Diagnosis of control design reviews during audits from third line of defense', type: 'rating' },
      { key: 'cde_reviews_audits_from_third_parties', label: 'Diagnosis of reviews/audits from third parties', type: 'rating' },
      { key: 'cde_supervision', label: 'Supervision', type: 'rating' },
      { key: 'cde_complaint_management', label: 'Complaint Management', type: 'rating' },
    ],
  },
  {
    title: 'Control Assessment',
    hint: 'Scores auto-computed from the design factors & operating effectiveness',
    fields: [
      { key: 'design_score', label: 'Control Design Assessment Score', type: 'text', readonly: true },
      { key: 'design_assessment', label: 'Control Design Assessment', type: 'text', readonly: true },
      { key: 'key_control', label: 'Key Control (Yes/ No)', type: 'select', options: ['', 'Yes', 'No'] },
      { key: 'operating_effectiveness', label: 'Control Implementation (Operating) Effectiveness', type: 'select', options: ['', 'Effective', 'Partially Effective', 'Ineffective', 'Not Tested'] },
      { key: 'operating_effectiveness_rating', label: 'Control Implementation (Operating) Effectiveness Rating', type: 'text', readonly: true },
      { key: 'control_rating', label: 'Control Rating', type: 'text', readonly: true },
      { key: 'control_heatmap', label: 'Risk Heat Map - Control Rating', type: 'text', readonly: true },
    ],
  },
  {
    title: 'Residual Risk & Response',
    fields: [
      { key: 'residual_score', label: 'Residual Risk Score', type: 'text', readonly: true },
      { key: 'residual_rating', label: 'Residual Risk Rating', type: 'text', readonly: true },
      { key: 'risk_response', label: 'Risk Response', type: 'select', options: ['', 'Mitigate', 'Transfer', 'Avoid', 'Accept'] },
      { key: 'incident_reference', label: 'Incident Reference', type: 'select', lookup: 'incidents' },
      { key: 'ext_audit_ref', label: 'Ex. Audit Observation Reference no.', type: 'text' },
      { key: 'ia_ref', label: 'IA Observation Reference no.', type: 'text' },
      { key: 'mitigation_plan', label: 'Risk Mitigation Plan', type: 'textarea', full: true },
      { key: 'mitigation_timeline', label: 'Mitigation Timeline', type: 'text' },
      { key: 'implementation_status', label: 'Implementation Status', type: 'text' },
      { key: 'risk_status_dept', label: 'Risk Status from Departments (Accepted/Rejected/New Risk Added)', type: 'select', options: ['', 'Accepted', 'Rejected', 'New Risk Added'] },
      { key: 'poc', label: 'POC', type: 'select', lookup: 'users' },
    ],
  },
];

/** Flat list of every field key the block manages (for a clean initial value). */
export const ONELINK_FIELD_KEYS: string[] = ONELINK_FIELD_GROUPS.flatMap((g) => g.fields.map((f) => f.key));

/** Build the initial value map, seeded from an existing risk's template_fields. */
export function initOneLinkValue(existing?: Record<string, unknown> | null): OneLinkValue {
  const v: OneLinkValue = {};
  ONELINK_FIELD_KEYS.forEach((k) => { v[k] = ''; });
  if (existing && typeof existing === 'object') {
    Object.entries(existing).forEach(([k, val]) => {
      if (val != null && typeof val !== 'object') v[k] = String(val);
    });
  }
  return v;
}

// ── 3×3 assessment mechanism (ERM Framework Annexure B / workbook formulas) ──
// Every factor is rated 1–3 (or N/A). Overall impact = avg of business-impact
// factors; inherent = impact × likelihood on a 3×3 grid; control rating = worst
// of design score & operating effectiveness; residual = (inherent ÷ 3) ×
// control rating, banded on the same 1–9 scale.
const IMPACT_FACTOR_KEYS = ONELINK_FIELD_GROUPS
  .find((g) => g.title === 'Business Impact Factors')!.fields.map((f) => f.key);
const CDE_FACTOR_KEYS = ONELINK_FIELD_GROUPS
  .find((g) => g.title === 'Control Design Effectiveness Factors')!.fields.map((f) => f.key);

const threePointLabel = (n: number) => (n <= 1 ? 'Low' : n <= 2 ? 'Medium' : 'High');
const effectivenessLabel = (n: number) => (n <= 1 ? 'Effective' : n <= 2 ? 'Partially Effective' : 'Ineffective');
/** Band a 1–9 (impact × likelihood) score onto the 3×3 heat map. */
export const oneLinkHeatBand = (score: number) => (score >= 6 ? 'High' : score >= 3 ? 'Medium' : 'Low');

function avgRating(v: OneLinkValue, keys: string[]): number | null {
  const nums = keys
    .map((k) => parseInt(v[k], 10))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 3);
  if (!nums.length) return null;
  return Math.min(3, Math.max(1, Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)));
}

/** Fill in the template's computed columns from the rated inputs. */
export function computeOneLinkDerived(v: OneLinkValue): OneLinkValue {
  const out = { ...v };

  const impact = avgRating(v, IMPACT_FACTOR_KEYS);
  out.overall_impact_rating = impact != null ? String(impact) : '';
  out.overall_impact = impact != null ? threePointLabel(impact) : '';

  const lk = parseInt(v.likelihood, 10);
  const hasLk = Number.isFinite(lk) && lk >= 1 && lk <= 3;
  if (impact != null && hasLk) {
    const inherent = impact * lk;
    out.inherent_rating = String(inherent);
    out.inherent_heatmap = oneLinkHeatBand(inherent);
  } else {
    out.inherent_rating = '';
    out.inherent_heatmap = '';
  }

  const design = avgRating(v, CDE_FACTOR_KEYS);
  out.design_score = design != null ? String(design) : '';
  out.design_assessment = design != null ? effectivenessLabel(design) : '';

  const opMap: Record<string, number> = { Effective: 1, 'Partially Effective': 2, Ineffective: 3 };
  const op = opMap[(v.operating_effectiveness || '').trim()];
  out.operating_effectiveness_rating = op ? String(op) : '';

  const control = op && design != null ? Math.max(design, op) : (op || design || null);
  out.control_rating = control != null ? String(control) : '';
  out.control_heatmap = control != null ? effectivenessLabel(control) : '';

  if (impact != null && hasLk && control != null) {
    const residual = ((impact * lk) / 3) * control;
    out.residual_score = String(Math.round(residual * 100) / 100);
    out.residual_rating = oneLinkHeatBand(residual);
  } else {
    out.residual_score = '';
    out.residual_rating = '';
  }

  return out;
}

const CLASS_TO_CATEGORY: Record<string, string> = {
  operational: 'operational', fraud: 'operational', reputational: 'operational',
  financial: 'financial', 'financial reporting': 'compliance', strategic: 'strategic',
  compliance: 'compliance', 'data privacy': 'compliance', 'information technology': 'technology',
  cybersecurity: 'technology', 'third-party / outsourcing': 'third_party',
};

/** Map the template's key fields onto the risk's core columns so the register,
 *  heat-map and scoring reflect what was entered in the block. Only returns keys
 *  that were actually filled in. */
export function deriveCore(v: OneLinkValue): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const cls = (v.erm_classification || '').trim().toLowerCase();
  if (cls) out.risk_category = CLASS_TO_CATEGORY[cls] || cls;
  if (v.erm_sub_category) out.risk_sub_category = v.erm_sub_category.slice(0, 100);
  const lk = parseInt(v.likelihood, 10);
  if (lk >= 1) out.inherent_likelihood = lk;
  const im = parseInt(v.overall_impact_rating, 10);
  if (im >= 1) out.inherent_impact = im;
  if (lk >= 1 && im >= 1) out.inherent_score = lk * im;
  const rs = parseFloat(v.residual_score);
  if (!Number.isNaN(rs)) out.residual_score = rs;
  if (v.mitigation_plan) out.treatment_plan = v.mitigation_plan;
  if (v.title) out.title = v.title;
  return out;
}

// ── Renderer ──────────────────────────────────────────────────────────────────
function Input({ f, value, onChange, lookups, all }: { f: FieldDef; value: string; onChange: (val: string) => void; lookups?: OneLinkLookups; all: OneLinkValue }) {
  const base = 'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500';
  if (f.readonly) {
    return (
      <input
        type="text"
        value={value}
        readOnly
        disabled
        placeholder="System generated"
        className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1.5 text-sm text-slate-600"
      />
    );
  }
  if (f.type === 'textarea') {
    return <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} className={base} />;
  }
  if (f.type === 'select' || f.type === 'rating') {
    let opts = f.type === 'rating' ? RATING : (f.options || ['']);
    if (f.optionsFrom) opts = ['', ...f.optionsFrom(all)];
    if (f.lookup) opts = ['', ...(lookups?.[f.lookup] || [])];
    if (f.optionsFrom || f.lookup) {
      // A previously saved value that's no longer in the option list must stay
      // selectable, otherwise the select would silently blank it on edit.
      if (value && !opts.includes(value)) opts = [...opts, value];
    }
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
        {opts.map((o) => <option key={o} value={o}>{o === '' ? '—' : o}</option>)}
      </select>
    );
  }
  return <input type={f.type === 'date' ? 'date' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} className={base} />;
}

export default function OneLinkRegisterFields({
  value,
  onChange,
  lookups,
  groups,
}: {
  value: OneLinkValue;
  onChange: (next: OneLinkValue) => void;
  lookups?: OneLinkLookups;
  /** Restrict rendering to these group titles (default: all groups). */
  groups?: string[];
}) {
  const set = (key: string, val: string) => {
    const next = { ...value, [key]: val };
    // Dependent dropdowns: reset the child when the parent changes and the
    // current child value isn't valid for the new parent.
    if (key === 'erm_classification') {
      const allowed = ONELINK_SUBCATEGORIES[val.trim()] || [];
      if (next.erm_sub_category && !allowed.includes(next.erm_sub_category)) next.erm_sub_category = '';
    }
    if (key === 'basel_ii_event_type_1') {
      const allowed = BASEL_II_LEVEL_2[val.trim()] || [];
      if (next.basel_ii_event_type_2 && !allowed.includes(next.basel_ii_event_type_2)) next.basel_ii_event_type_2 = '';
    }
    onChange(computeOneLinkDerived(next));
  };
  const visibleGroups = groups
    ? ONELINK_FIELD_GROUPS.filter((g) => groups.includes(g.title))
    : ONELINK_FIELD_GROUPS;
  return (
    <div className="space-y-4">
      {visibleGroups.map((g) => (
        <div key={g.title} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <h4 className="text-sm font-semibold text-slate-800">{g.title}</h4>
            {g.hint && <span className="text-[11px] text-slate-400">{g.hint}</span>}
          </div>
          <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
            {g.fields.map((f) => (
              <div key={f.key} className={f.full ? 'sm:col-span-2' : ''}>
                <label className="mb-0.5 block text-[12px] font-medium text-slate-600">{f.label}</label>
                <Input f={f} value={value[f.key] ?? ''} onChange={(val) => set(f.key, val)} lookups={lookups} all={value} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
