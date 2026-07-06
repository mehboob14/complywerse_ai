// Shared types + column configs for the ISO 27001 framework template registers.

export interface RegisterEntry {
  id: number;
  register_type: string;
  seq: number;
  is_seed: boolean;
  reference: string | null;
  title: string | null;
  status: string | null;
  result: string | null;
  finding_type: string | null;
  treatment_option: string | null;
  linked_control: string | null;
  action: string | null;
  evidence_reviewed: string | null;
  notes: string | null;
  justification: string | null;
  residual_risk: string | null;
  approved_by: string | null;
  owner_id: number | null;
  owner_name: string | null;
  target_date: string | null;
  evidence_id: number | null;
  risk_register_id: number | null;
  data: Record<string, unknown>;
}

export interface RegisterSummary {
  total: number;
  by_status: Record<string, number>;
  by_result: Record<string, number>;
  moved_to_risk: number;
  coverage_pct?: number;
}

export interface RegisterResponse {
  register_type: string;
  entries: RegisterEntry[];
  summary: RegisterSummary;
}

export interface TenantUserOption {
  id: number;
  name: string;
}

export type Tone = 'slate' | 'emerald' | 'amber' | 'orange' | 'rose' | 'sky' | 'teal';
export type CellType = 'text' | 'textarea' | 'select' | 'owner' | 'date';

export interface SelectOption {
  value: string;
  label: string;
  tone?: Tone;
}

export interface RegisterColumn {
  key: keyof RegisterEntry;
  label: string;
  type: CellType;
  options?: SelectOption[];
  minWidth?: string;
  grow?: boolean;
  /** When set, the edit-form field for this column is a picker instead of a plain input. */
  picker?: 'framework_risks' | 'framework_controls' | 'users';
}

export interface RegisterConfig {
  registerType: 'gap_analysis' | 'internal_audit' | 'risk_treatment';
  label: string;
  description: string;
  columns: RegisterColumn[];
  coverage?: boolean;
  moveToRisk?: boolean;
}

export const TONE_CLASSES: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  orange: 'bg-orange-50 text-orange-700 border-orange-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  sky: 'bg-sky-50 text-sky-700 border-sky-200',
  teal: 'bg-primary-50 text-primary-700 border-primary-200',
};

const GAP_STATUS: SelectOption[] = [
  { value: 'not_started', label: 'Not started', tone: 'slate' },
  { value: 'in_progress', label: 'In progress', tone: 'amber' },
  { value: 'covered', label: 'Covered', tone: 'emerald' },
  { value: 'not_applicable', label: 'N/A', tone: 'slate' },
];
const AUDIT_RESULT: SelectOption[] = [
  { value: '', label: '—', tone: 'slate' },
  { value: 'conform', label: 'Conform', tone: 'emerald' },
  { value: 'nonconform', label: 'Nonconform', tone: 'rose' },
  { value: 'ofi', label: 'OFI', tone: 'amber' },
  { value: 'not_applicable', label: 'N/A', tone: 'slate' },
];
const FINDING_TYPE: SelectOption[] = [
  { value: '', label: '—', tone: 'slate' },
  { value: 'nonconformity', label: 'Nonconformity', tone: 'rose' },
  { value: 'ofi', label: 'OFI', tone: 'amber' },
  { value: 'observation', label: 'Observation', tone: 'sky' },
];
const TREATMENT: SelectOption[] = [
  { value: '', label: '—', tone: 'slate' },
  { value: 'mitigate', label: 'Mitigate', tone: 'teal' },
  { value: 'accept', label: 'Accept', tone: 'sky' },
  { value: 'avoid', label: 'Avoid', tone: 'amber' },
  { value: 'transfer', label: 'Transfer', tone: 'slate' },
];
const RT_STATUS: SelectOption[] = [
  { value: 'open', label: 'Open', tone: 'slate' },
  { value: 'in_progress', label: 'In progress', tone: 'amber' },
  { value: 'implemented', label: 'Implemented', tone: 'emerald' },
  { value: 'accepted', label: 'Accepted', tone: 'sky' },
  { value: 'closed', label: 'Closed', tone: 'slate' },
];
const RESIDUAL: SelectOption[] = [
  { value: '', label: '—', tone: 'slate' },
  { value: 'low', label: 'Low', tone: 'emerald' },
  { value: 'medium', label: 'Medium', tone: 'amber' },
  { value: 'high', label: 'High', tone: 'orange' },
  { value: 'critical', label: 'Critical', tone: 'rose' },
];

export const REGISTER_CONFIGS: Record<string, RegisterConfig> = {
  gap_analysis: {
    registerType: 'gap_analysis',
    label: 'Gap Analysis',
    description: 'Clause-by-clause ISO 27001:2022 readiness. Set each area’s status, then record the gap, owner and target date. Coverage updates automatically.',
    coverage: true,
    moveToRisk: true,
    columns: [
      { key: 'reference', label: 'Clause / area', type: 'text', minWidth: '130px' },
      { key: 'title', label: 'Requirement', type: 'textarea', grow: true },
      { key: 'status', label: 'Status', type: 'select', options: GAP_STATUS, minWidth: '132px' },
      { key: 'action', label: 'Gap / action', type: 'textarea', grow: true },
      { key: 'owner_id', label: 'Owner', type: 'owner', minWidth: '150px' },
      { key: 'target_date', label: 'Target date', type: 'date', minWidth: '150px' },
    ],
  },
  internal_audit: {
    registerType: 'internal_audit',
    label: 'Internal Audit',
    description: 'Work through the ISO 27001 audit checklist. Record evidence reviewed and a result; log nonconformities and opportunities for improvement, and move any finding to the risk register.',
    moveToRisk: true,
    columns: [
      { key: 'reference', label: 'Clause / control', type: 'text', minWidth: '160px', picker: 'framework_controls' },
      { key: 'title', label: 'Audit question', type: 'textarea', grow: true },
      { key: 'evidence_reviewed', label: 'Evidence reviewed', type: 'textarea', grow: true },
      { key: 'result', label: 'Result', type: 'select', options: AUDIT_RESULT, minWidth: '132px' },
      { key: 'finding_type', label: 'Finding type', type: 'select', options: FINDING_TYPE, minWidth: '150px' },
      { key: 'notes', label: 'Notes / action', type: 'textarea', grow: true },
      { key: 'owner_id', label: 'Owner', type: 'owner', minWidth: '150px' },
    ],
  },
  risk_treatment: {
    registerType: 'risk_treatment',
    label: 'Risk Treatment',
    description: 'Link each risk to a treatment option and an Annex A control, assign an owner and track residual risk. Bring risks over from the register or add them here.',
    moveToRisk: true,
    columns: [
      { key: 'reference', label: 'Risk', type: 'text', minWidth: '120px', picker: 'framework_risks' },
      { key: 'title', label: 'Risk description', type: 'textarea', grow: true },
      { key: 'treatment_option', label: 'Treatment', type: 'select', options: TREATMENT, minWidth: '130px' },
      { key: 'linked_control', label: 'Annex A / control', type: 'text', minWidth: '160px', picker: 'framework_controls' },
      { key: 'action', label: 'Action plan', type: 'textarea', grow: true },
      { key: 'owner_id', label: 'Owner', type: 'owner', minWidth: '150px' },
      { key: 'target_date', label: 'Target date', type: 'date', minWidth: '150px' },
      { key: 'status', label: 'Status', type: 'select', options: RT_STATUS, minWidth: '130px' },
      { key: 'residual_risk', label: 'Residual', type: 'select', options: RESIDUAL, minWidth: '120px' },
      { key: 'approved_by', label: 'Approved by', type: 'text', minWidth: '150px', picker: 'users' },
    ],
  },
};
