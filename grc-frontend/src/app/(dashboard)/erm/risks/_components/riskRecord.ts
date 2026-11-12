// The risk record's rules, shared by the register form and the risk page. The backend owns them
// (grc/modules/erm/routers/risks.py: history, acceptance; Risk.acceptance_state); this file only presents them.
import { riskBandForScore, type RiskBand } from '../../../../../lib/riskBands.ts';

export type RiskResponseChoice = 'mitigate' | 'accept' | 'transfer' | 'avoid';
export type AcceptanceState = 'none' | 'requested' | 'accepted' | 'expiring' | 'expired';

/** The fields the risk record adds to a risk (the shared Risk type predates them). */
export interface RiskRecordFields {
  target_likelihood?: number | null;
  target_impact?: number | null;
  target_score?: number | null;
  response?: RiskResponseChoice | null;
  acceptance_status?: 'requested' | 'approved' | 'rejected' | null;
  acceptance_state?: AcceptanceState | null;
  acceptance_reason?: string | null;
  acceptance_requested_by?: number | null;
  acceptance_requested_at?: string | null;
  accepted_by?: number | null;
  accepted_at?: string | null;
  acceptance_expires_at?: string | null;
  /** Sent with an edit: why the scores, owner, status, response or category changed (kept in the history). */
  reason?: string;
}

export const RISK_RESPONSES: ReadonlyArray<{ value: RiskResponseChoice; label: string; hint: string }> = [
  { value: 'mitigate', label: 'Mitigate', hint: 'Reduce it with controls and actions' },
  { value: 'accept', label: 'Accept', hint: 'Live with it: a second person approves, until an expiry' },
  { value: 'transfer', label: 'Transfer', hint: 'Insure it or contract it out' },
  { value: 'avoid', label: 'Avoid', hint: 'Stop the activity that causes it' },
];

export const responseLabel = (value?: string | null): string | null =>
  RISK_RESPONSES.find((r) => r.value === value)?.label ?? null;

const DAY_MS = 86_400_000;
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** Whole days until `iso` (negative once past); null without a date. */
export function daysUntil(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : Math.ceil((at - now.getTime()) / DAY_MS);
}

export interface AcceptanceBadge {
  label: string;
  tone: 'slate' | 'amber' | 'emerald' | 'orange' | 'rose';
  detail: string | null;
}

/** How an acceptance reads on the risk page: the state the backend derived, with the time left to its expiry. */
export function acceptanceBadge(state: AcceptanceState | null | undefined, expiresAt: string | null | undefined,
                                now: Date = new Date()): AcceptanceBadge {
  const left = daysUntil(expiresAt, now);
  switch (state) {
    case 'requested':
      return { label: 'Acceptance requested', tone: 'amber', detail: 'Waiting for a second person to approve' };
    case 'accepted':
      return { label: 'Accepted', tone: 'emerald', detail: left == null ? null : `Expires in ${days(left)}` };
    case 'expiring':
      return { label: 'Acceptance expiring', tone: 'orange', detail: left == null ? null : `Expires in ${days(left)}` };
    case 'expired':
      return { label: 'Acceptance expired', tone: 'rose',
               detail: left == null || left >= 0 ? 'Expired today' : `Expired ${days(-left)} ago` };
    default:
      return { label: 'Not accepted', tone: 'slate', detail: null };
  }
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** The expiry dates the backend takes, as a date input's min and max: from tomorrow to 12 months away. */
export function acceptanceExpiryRange(now: Date = new Date()): { min: string; max: string } {
  return { min: isoDate(new Date(now.getTime() + DAY_MS)), max: isoDate(new Date(now.getTime() + 365 * DAY_MS)) };
}

export interface TrajectoryStep {
  key: 'inherent' | 'residual' | 'target';
  label: string;
  score: number | null;
  band: RiskBand | null;
}

interface Scores {
  inherent_score?: number | null;
  residual_score?: number | null;
  target_score?: number | null;
}

/** Before controls → After controls → Target, each with its band. */
export function riskTrajectory(risk: Scores): TrajectoryStep[] {
  const step = (key: TrajectoryStep['key'], label: string, score?: number | null): TrajectoryStep =>
    ({ key, label, score: score || null, band: riskBandForScore(score) });
  return [
    step('inherent', 'Before controls', risk.inherent_score),
    step('residual', 'After controls', risk.residual_score),
    step('target', 'Target', risk.target_score),
  ];
}

/** How far the risk still is above its target (0 when at or below it); null until both are scored. */
export function gapToTarget(risk: Scores): number | null {
  if (!risk.residual_score || !risk.target_score) return null;
  return Math.max(0, risk.residual_score - risk.target_score);
}

const SCORE_INPUTS = ['inherent_likelihood', 'inherent_impact', 'residual_likelihood', 'residual_impact',
  'target_likelihood', 'target_impact'] as const;
type ScoreInputs = Partial<Record<(typeof SCORE_INPUTS)[number], number | null>>;

/** Whether an edit moves any score, so the form asks for the reason. A new risk (no `before`) never does. */
export function scoresChanged(before: ScoreInputs | null | undefined, after: ScoreInputs): boolean {
  if (!before) return false;
  return SCORE_INPUTS.some((key) => (before[key] ?? null) !== (after[key] ?? null));
}

// Risk types are categories on one register (decision 5); Operational keeps the deep workflow.
export const RISK_TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'operational', label: 'Operational' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'technology', label: 'IT / Cyber' },
  { value: 'third_party', label: 'Third-party' },
  { value: 'strategic', label: 'Strategic' },
  { value: 'financial', label: 'Financial' },
  { value: 'credit', label: 'Credit' },
  { value: 'market', label: 'Market' },
  { value: 'liquidity', label: 'Liquidity' },
];

const OLD_DEFAULT_LABEL: Readonly<Record<string, string>> = { technology: 'Technology', third_party: 'Third Party' };

export const riskTypeLabel = (value: string): string | null => RISK_TYPES.find((t) => t.value === value)?.label ?? null;

/**
 * The tenant's category list with the risk types it lacks altogether added (one it archived stays out), and the old
 * default names of IT / Cyber and Third-party replaced. `all` is the tenant's whole list, archived ones included.
 * shortcut: the defaults live in backend services/module_settings.py ("risks" lists); move these there, then drop this.
 */
export function withRiskTypes<T extends { value: string; label: string }>(shown: T[], all: Array<{ value: string }> = shown): T[] {
  const relabelled = shown.map((o) => (OLD_DEFAULT_LABEL[o.value] === o.label ? { ...o, label: riskTypeLabel(o.value) ?? o.label } : o));
  const known = new Set(all.map((o) => o.value));
  return [...relabelled, ...RISK_TYPES.filter((t) => !known.has(t.value)).map((t) => ({ ...t }) as T)];
}

/**
 * A built-in field's label: the tenant's, unless it is still the old default, which gives way to the plain one.
 * shortcut: the defaults live in backend services/module_settings.py ("risks" builtins); rename them there, then drop this.
 */
export function recordLabel(tenantLabel: string | null | undefined, oldDefault: string, plain: string): string {
  return !tenantLabel || tenantLabel.trim().toLowerCase() === oldDefault.toLowerCase() ? plain : tenantLabel;
}
