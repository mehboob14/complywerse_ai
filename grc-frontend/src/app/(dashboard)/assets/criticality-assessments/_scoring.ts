// Scoring metadata for the two criticality assessment templates.
//
// Both templates are sourced verbatim from the bank-provided Excel files
// (Selection + Calculation sheets):
//   - Information System Criticality Assessment v1.0 (ISCA)
//   - Infrastructure Assets Criticality Assessment v1.0 (IACA)
//
// Centralising it here keeps the drawer renderer schema-agnostic — adding
// or relabelling a criterion is a one-line change.

export type CriticalityBand = 'mission_critical' | 'high' | 'moderate' | 'low';

export const BAND_LABELS: Record<CriticalityBand, string> = {
  mission_critical: 'Mission-Critical',
  high: 'High',
  moderate: 'Moderate',
  low: 'Low',
};

export const BAND_BADGE: Record<CriticalityBand, string> = {
  mission_critical: 'bg-rose-100 text-rose-800 border-rose-200',
  high: 'bg-orange-100 text-orange-800 border-orange-200',
  moderate: 'bg-amber-100 text-amber-800 border-amber-200',
  low: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

export type ScoreOption = { value: number; label: string };

export interface ScoringCriterion {
  field: string;
  label: string;
  description?: string;
  /** Pre-defined options for the dropdown — taken from the template's
   *  Selection sheet. The picker is locked to these so an operator can't
   *  enter a free-form score. */
  options: ScoreOption[];
  /** IACA weight (%); ignored for ISCA. */
  weight?: number;
}

// ─── ISCA criteria ───────────────────────────────────────────────────────

const FOUR_BAND: ScoreOption[] = [
  { value: 1, label: '1 — Low' },
  { value: 2, label: '2 — Moderate' },
  { value: 3, label: '3 — High' },
  { value: 4, label: '4 — Mission-Critical' },
];

export const ISCA_CRITERIA: ScoringCriterion[] = [
  {
    field: 'operational_dependency',
    label: 'Operational Dependency',
    description: 'How essential is the system to daily operations?',
    options: FOUR_BAND,
  },
  {
    field: 'financial_impact',
    label: 'Financial Impact',
    description: 'Financial consequences of an outage or breach.',
    options: FOUR_BAND,
  },
  {
    field: 'customer_stakeholder_impact',
    label: 'Customer / Stakeholder Impact',
    description: 'Reach of impact across customers / stakeholders.',
    options: FOUR_BAND,
  },
  {
    field: 'data_sensitivity',
    label: 'Data Sensitivity & Breach Risk',
    description: 'Sensitivity of data + breach consequences.',
    options: FOUR_BAND,
  },
  {
    field: 'unauthorized_access_risk',
    label: 'Unauthorized Access / Manipulation Risk',
    description: 'Impact of unauthorised access or data manipulation.',
    options: FOUR_BAND,
  },
  {
    field: 'rto_rpo_requirements',
    label: 'RTO / RPO Requirements',
    description: 'Tightness of recovery time / point objectives.',
    options: FOUR_BAND,
  },
  {
    field: 'internet_facing',
    label: 'Internet Facing',
    description: 'Internet exposure of the system.',
    options: [
      { value: 0, label: '0 — No' },
      { value: 2, label: '2 — Yes, Whitelisted' },
      { value: 4, label: '4 — Yes' },
    ],
  },
  {
    field: 'b2b_exposure',
    label: 'B2B Exposure',
    description: 'Connectivity / integration with third parties.',
    options: [
      { value: 0, label: '0 — No' },
      { value: 4, label: '4 — Yes' },
    ],
  },
];

/** ISCA total = simple sum of all 8 criteria (matches template Calculation sheet). */
export function iscaTotal(item: Partial<Record<string, number | null | undefined>>): number | null {
  const vals = ISCA_CRITERIA.map((c) => item[c.field]).filter(
    (v): v is number => typeof v === 'number',
  );
  if (vals.length === 0) return null;
  return vals.reduce((s, v) => s + v, 0);
}

export function iscaBand(total: number | null): CriticalityBand | null {
  if (total === null) return null;
  if (total >= 24) return 'mission_critical';
  if (total >= 19) return 'high';
  if (total >= 13) return 'moderate';
  if (total >= 6) return 'low';
  return null;
}

// ─── IACA criteria + weights ─────────────────────────────────────────────

export const IACA_CRITERIA: ScoringCriterion[] = [
  { field: 'business_impact',           label: 'Business Impact',                weight: 15, options: FOUR_BAND },
  { field: 'service_dependency',        label: 'Service Dependency',             weight: 12, options: FOUR_BAND },
  { field: 'data_sensitivity',          label: 'Data Sensitivity',               weight: 12, options: FOUR_BAND },
  { field: 'redundancy_failover',       label: 'Redundancy / Failover',          weight: 10, options: FOUR_BAND },
  { field: 'rto',                       label: 'Recovery Time Objective (RTO)',  weight: 10, options: FOUR_BAND },
  { field: 'availability_requirement',  label: 'Availability Requirement',       weight: 10, options: FOUR_BAND },
  { field: 'operational_disruption',    label: 'Potential Operational Disruption', weight: 10, options: FOUR_BAND },
  { field: 'regulatory_dependency',     label: 'Regulatory / Compliance Dependency', weight: 11, options: FOUR_BAND },
  { field: 'exposure',                  label: 'Exposure',                       weight: 10, options: FOUR_BAND },
];

/** IACA total = weighted sum (rating × weight / 100). Range 0.00–4.00. */
export function iacaTotal(item: Partial<Record<string, number | null | undefined>>): number | null {
  let seen = false;
  let total = 0;
  for (const c of IACA_CRITERIA) {
    const v = item[c.field];
    if (typeof v !== 'number') continue;
    seen = true;
    total += v * ((c.weight ?? 0) / 100);
  }
  return seen ? Math.round(total * 100) / 100 : null;
}

export function iacaBand(total: number | null): CriticalityBand | null {
  if (total === null) return null;
  if (total >= 3.5) return 'mission_critical';
  if (total >= 3.0) return 'high';
  if (total >= 2.0) return 'moderate';
  return 'low';
}
