// The shapes and the pure rules of the Comply analyses (backend vendor_risk/tpra/fair.py), apart from React so `node --test` pins them (fairModel.test.ts): what an analysis holds, the money and share
// formats, the factors a person edits (three numbers each: the least, the likely and the most), and the one place that turns the form into the body of a save. Every figure of a RESULT (the chance of
// a loss, the average year, the one-in-twenty year, the least liability cap, how insurance stands) is computed by the server from the inputs; nothing here recomputes it.
import type { AnalysisEffect } from '../../../../../lib/statuses/vendorInsights.ts';

export type Triple = [number, number, number];
export interface FairInputs {
  tef: Triple; vulnerability: Triple;
  primary: { response: Triple; productivity: Triple; replacement: Triple };
  secondary: { probability: Triple; fines: Triple; reputation: Triple; competitive: Triple };
  iterations: number;
}
export interface FairResult {
  iterations: number; lef: { mean: number; p10: number; p90: number };
  annual: { chance: number; mean: number; p50: number; p90: number; p95: number; p99: number; max: number };
  per_event: { p10: number; p50: number; p90: number };
  split: { primary: number; secondary: number; secondary_share: number };
  lec: Array<{ loss: number; chance: number }>; liability_cap: number;
  cover?: { amount: number; chance_exceeded: number; gap_one_in_twenty: number; covers_one_in_twenty: boolean } | null;
}
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export interface WriteUp {
  risk_level: RiskLevel; confidence: 'low' | 'medium' | 'high'; summary: string; reasons: string[]; actions: string[];
  insurance: string; at: string; by: string | null;
}
export type CoverState = 'none' | 'covers' | 'short';
export interface FairAnalysis {
  id: number; vendor: { id: number; name: string; tier: string | null }; name: string;
  effect: AnalysisEffect; scenario: string | null; asset: string | null; threat: string | null;
  status: 'draft' | 'final'; currency: string; annual: FairResult['annual'] | null; liability_cap: number | null;
  updated_at: string; run_at: string | null; row_version: number;
  insurance_cover?: number | null; cover_state?: CoverState; risk_level?: RiskLevel | null;
  inputs?: FairInputs; notes?: string[]; result?: FairResult | null;
  ai_review?: WriteUp | null; ai_review_stale?: boolean;
}

/** "about 1 year in 14", from a chance a year. */
export const oneIn = (chance: number): string => (chance <= 0 ? 'never in the simulated years' : `about 1 year in ${Math.max(1, Math.round(1 / chance))}`);

/** A money amount in the analysis's currency; compact ("1.2M") unless `compact` is false; "—" when not recorded. */
export function money(value: number | null | undefined, currency = 'USD', compact = true): string {
  if (value === null || value === undefined) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, notation: compact ? 'compact' : 'standard', maximumFractionDigits: compact ? 1 : 0 }).format(value);
  } catch {
    return `${Math.round(value).toLocaleString()} ${currency}`;
  }
}

export const pct = (x: number | null | undefined, digits = 0): string => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits)}%`);

// ── the factors ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FactorRow { path: string; label: string; help: string; unit: 'events' | 'share' | 'money' }
export const GROUPS: ReadonlyArray<{ title: string; rows: readonly FactorRow[] }> = [
  { title: 'How often it happens', rows: [
    { path: 'tef', label: 'Threat events a year', help: 'Serious attempts against this supplier that could lead to a loss.', unit: 'events' },
    { path: 'vulnerability', label: 'Chance an attempt becomes a loss', help: 'Vulnerability: how much of what is tried succeeds.', unit: 'share' },
  ] },
  { title: 'What each loss costs us', rows: [
    { path: 'primary.response', label: 'Response', help: 'Investigation, notification, legal and recovery work.', unit: 'money' },
    { path: 'primary.productivity', label: 'Productivity', help: 'Work that stops while the service or data is unavailable.', unit: 'money' },
    { path: 'primary.replacement', label: 'Replacement', help: 'Records, systems or data to replace or make good.', unit: 'money' },
  ] },
  { title: 'When others react', rows: [
    { path: 'secondary.probability', label: 'Chance regulators, customers or others react', help: 'Secondary loss event frequency, per loss.', unit: 'share' },
    { path: 'secondary.fines', label: 'Fines and judgments', help: 'Penalties, settlements and damages.', unit: 'money' },
    { path: 'secondary.reputation', label: 'Reputation', help: 'Customers lost or not won.', unit: 'money' },
    { path: 'secondary.competitive', label: 'Competitive advantage', help: 'Value of information competitors gain.', unit: 'money' },
  ] },
];

export const POSITIONS = ['least', 'most likely', 'most'] as const;
export type FactorText = Record<string, [string, string, string]>;

export function get(inputs: FairInputs, path: string): Triple {
  return path.split('.').reduce((o: unknown, k) => (o as Record<string, unknown>)[k], inputs) as Triple;
}

/** The numbers as the form holds them: a share is shown in percent, everything else as it is. */
export function toText(inputs: FairInputs): FactorText {
  const out: FactorText = {};
  GROUPS.forEach((g) => g.rows.forEach((r) => {
    out[r.path] = get(inputs, r.path).map((v) => String(r.unit === 'share' ? Math.round(v * 1000) / 10 : v)) as [string, string, string];
  }));
  return out;
}

/** The inputs a save sends: the form's text back to numbers (a share back from percent). A cell that is not a number is 0, as it always was. */
export function fromText(text: FactorText, iterations: number): FairInputs {
  const t = (path: string, share: boolean) => text[path].map((v) => (Number(v) || 0) / (share ? 100 : 1)) as Triple;
  return {
    tef: t('tef', false), vulnerability: t('vulnerability', true),
    primary: { response: t('primary.response', false), productivity: t('primary.productivity', false), replacement: t('primary.replacement', false) },
    secondary: { probability: t('secondary.probability', true), fines: t('secondary.fines', false), reputation: t('secondary.reputation', false), competitive: t('secondary.competitive', false) },
    iterations,
  };
}

export interface Meta { name: string; scenario: string; asset: string; threat: string; cover: string }
export const metaOf = (x: Pick<FairAnalysis, 'name' | 'scenario' | 'asset' | 'threat' | 'insurance_cover'>): Meta => ({
  name: x.name, scenario: x.scenario || '', asset: x.asset || '', threat: x.threat || '', cover: x.insurance_cover == null ? '' : String(x.insurance_cover),
});

/** Whether the form differs from the saved analysis. */
export function isDirty(a: FairAnalysis, text: FactorText, meta: Meta): boolean {
  if (!a.inputs) return false;
  return JSON.stringify(toText(a.inputs)) !== JSON.stringify(text) || JSON.stringify(meta) !== JSON.stringify(metaOf(a));
}

/** What is wrong with the form, by row, in words: a range must go up from least to most (the server checks it too), no figure is negative, a share is at most 100%. */
export function problems(text: FactorText, meta?: Pick<Meta, 'name' | 'cover'>): Array<{ path: string; message: string }> {
  const out: Array<{ path: string; message: string }> = [];
  GROUPS.forEach((g) => g.rows.forEach((r) => {
    const nums = text[r.path].map((v) => Number(v));
    if (text[r.path].some((v, i) => v.trim() !== '' && Number.isNaN(nums[i]))) out.push({ path: r.path, message: `${r.label}: use numbers only` });
    else if (nums.some((n) => n < 0)) out.push({ path: r.path, message: `${r.label}: a figure cannot be negative` });
    else if (r.unit === 'share' && nums.some((n) => n > 100)) out.push({ path: r.path, message: `${r.label}: a share is at most 100%` });
    else if (!(nums[0] <= nums[1] && nums[1] <= nums[2])) out.push({ path: r.path, message: `${r.label}: least, most likely and most must go up in that order` });
  }));
  if (meta && !meta.name.trim()) out.push({ path: 'name', message: 'Give the analysis a name' });
  if (meta && meta.cover.trim() !== '' && !(Number(meta.cover) >= 0)) out.push({ path: 'cover', message: 'The insurance cover is an amount, 0 or more' });
  return out;
}

/** The body of PUT /vendor-risk/fair/{id}: the form, the version it was read at (so two people saving the same analysis never overwrite each other: the server says 409), and what else the call changes (a status). */
export function saveBody(a: FairAnalysis, text: FactorText, meta: Meta, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    inputs: fromText(text, (a.inputs as FairInputs).iterations), name: meta.name, scenario: meta.scenario, asset: meta.asset, threat: meta.threat,
    insurance_cover: meta.cover === '' ? null : Number(meta.cover), row_version: a.row_version, ...extra,
  };
}
