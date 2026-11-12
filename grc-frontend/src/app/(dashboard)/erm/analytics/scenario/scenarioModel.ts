// Scenario Analysis (Risk Management wave 4, L1): the shapes GET /erm/scenarios returns and the rules the page draws from them.
import type { Tone } from '@/lib/status';

export type ScenarioStatus = 'draft' | 'estimated' | 'reviewed' | 'approved';

export interface ScenarioResult {
  mean: number;
  median: number;
  p90: number;
  one_in_20: number;
  one_in_100: number;
  iterations: number;
  seed: number;
  engine_version: string;
  currency: string;
  run_at: string;
  inputs: { frequency_per_year: number; loss_low: number | null; loss_typical: number; loss_severe: number };
}

export interface AppetiteRow {
  category: string;
  tolerance: number | null;
  reason?: string;
  currency?: string;
  limit?: string;
  severe_loss?: number | null;
  within?: boolean | null;
}

export interface AgreedAction { id: number; risk_id: number; title: string; status: string; due_date: string | null }

export interface Scenario {
  id: number;
  title: string;
  description: string | null;
  status: ScenarioStatus;
  risk_ids: number[];
  risks: Array<{ id: number; title: string; category: string; residual_score: number | null }>;
  workshop_notes: string | null;
  currency: string;
  frequency_per_year: number | null;
  loss_low: number | null;
  loss_typical: number | null;
  loss_severe: number | null;
  result: ScenarioResult | null;
  last_run_at: string | null;
  previous_run_at: string | null;
  created_by_name: string | null;
  estimated_by_name: string | null;
  reviewed_by_name: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  review_note: string | null;
  reopened_from_id: number | null;
  can_approve: boolean;
  appetite: AppetiteRow[];
  actions: AgreedAction[];
}

export interface ScenarioRow {
  id: number;
  title: string;
  status: ScenarioStatus;
  currency: string;
  risk_count: number;
  last_run_at: string | null;
  mean: number | null;
  severe_loss: number | null;
}

export const SCENARIO_STATUS: Record<ScenarioStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  estimated: { label: 'Estimated', tone: 'progress' },
  reviewed: { label: 'Reviewed', tone: 'pending' },
  approved: { label: 'Approved', tone: 'success' },
};

export const STEPS: Array<{ status: ScenarioStatus; label: string }> = [
  { status: 'draft', label: 'Define the scenario' },
  { status: 'estimated', label: 'Estimate and run' },
  { status: 'reviewed', label: 'Compare with appetite' },
  { status: 'approved', label: 'Approve' },
];

/** Each step as done, current or still to do; an approved scenario has every step done. */
export function stepStates(status: ScenarioStatus): Array<'done' | 'current' | 'todo'> {
  const at = STEPS.findIndex((s) => s.status === status);
  return STEPS.map((_, i) => (i < at || status === 'approved' ? 'done' : i === at ? 'current' : 'todo'));
}

export type ScenarioAction = 'edit' | 'run' | 'review' | 'approve' | 'sendBack' | 'reopen' | 'addAction';

/** What the person may do: edit and run until it is reviewed, review an estimate, approve when the server says they are not the
 *  estimator or reviewer, send back an estimate or a review, re-open an approved one as a new draft. A reader does nothing. */
export function scenarioActions(s: Pick<Scenario, 'status' | 'can_approve'>, canEdit: boolean): ScenarioAction[] {
  if (!canEdit) return [];
  switch (s.status) {
    case 'draft': return ['edit', 'run', 'addAction'];
    case 'estimated': return ['edit', 'run', 'review', 'sendBack', 'addAction'];
    case 'reviewed': return [...(s.can_approve ? ['approve' as const] : []), 'sendBack', 'addAction'];
    default: return ['reopen'];
  }
}

/** A loss in its own currency, whole units: "£1,234,567". Nothing recorded is a dash, never 0. */
export function formatMoney(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Math.round(value).toLocaleString('en-GB')}`;
  }
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** The workshop's frequency in its own words: "1 in 5 years" under once a year, "3 a year" from once a year. */
export function frequencyLabel(perYear: number | null | undefined): string {
  if (!perYear || perYear <= 0) return '—';
  return perYear < 1 ? `1 in ${round(1 / perYear, 1)} years` : `${round(perYear, 2)} a year`;
}

export type FrequencyMode = 'one_in' | 'per_year';

/** The form's frequency for a stored rate: "1 in N years" under once a year. */
export function frequencyInput(perYear: number | null | undefined): { mode: FrequencyMode; value: string } {
  if (!perYear || perYear <= 0) return { mode: 'one_in', value: '' };
  return perYear < 1 ? { mode: 'one_in', value: String(round(1 / perYear, 2)) } : { mode: 'per_year', value: String(perYear) };
}

/** A typed amount ("4,000,000", "250 000") as a number; blank or not a number is null. */
export function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[\s,]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** The frequency the server takes: one_in_years or frequency_per_year; a blank field sends neither. */
export function frequencyPayload(mode: FrequencyMode, raw: string): Record<string, number> {
  const n = parseAmount(raw);
  if (!n) return {};
  return mode === 'one_in' ? { one_in_years: n } : { frequency_per_year: n };
}

/** The appetite line for one category: within or above the money tolerance, or why there is no comparison. */
export function appetiteVerdict(row: AppetiteRow): { text: string; tone: Tone } {
  if (row.tolerance === null) return { text: row.reason || 'No loss tolerance set', tone: 'neutral' };
  if (row.within === null || row.within === undefined) return { text: 'Not run yet', tone: 'neutral' };
  return row.within ? { text: 'Within tolerance', tone: 'success' } : { text: 'Above tolerance', tone: 'danger' };
}

export const SCENARIOS = ['erm-scenarios'];
export const CARD = 'rounded-xl border border-slate-200 bg-white p-4';
export const day = (iso?: string | null): string =>
  (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
