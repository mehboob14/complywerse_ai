// Risk Appetite: statement versions, the breach log and what can be done on each breach. Pure, so node --test runs it.

export type StatementStatus = 'draft' | 'pending_approval' | 'approved' | 'superseded';
export type BreachStatus = 'open' | 'plan_proposed' | 'plan_approved' | 'excess_approved' | 'resolved';
export type BreachAction = 'plan' | 'approve-plan' | 'reject-plan' | 'approve-excess';

export interface AppetiteStatement {
  id: number;
  version: number;
  statement: string;
  status: StatementStatus;
  created_by_name: string | null;
  submitted_by_name: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  effective_from: string | null;
  approval_note: string | null;
  updated_at: string | null;
  limits?: Record<string, unknown> | null;    // the limits frozen with this version at approval
}

export interface BreachRecord {
  id: number;
  category: string;
  risk_id: number | null;
  risk_title: string | null;
  kri_id: number | null;
  kri_name: string | null;
  measured_value: number | null;
  limit_value: number | null;
  detected_at: string;
  days_open: number;
  status: BreachStatus;
  plan: string | null;
  plan_by_name: string | null;
  plan_at: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  excess_expires_at: string | null;
  resolved_at: string | null;
  can_plan: boolean;
}

export interface LimitKRI {
  id: number;
  name: string;
  current_value: number | null;
  status: string;
}

export const STATEMENT_STATUS: Record<StatementStatus, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'border-slate-200 bg-slate-50 text-slate-700' },
  pending_approval: { label: 'Awaiting approval', tone: 'border-amber-200 bg-amber-50 text-amber-700' },
  approved: { label: 'Approved', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  superseded: { label: 'Superseded', tone: 'border-slate-200 bg-white text-slate-500' },
};

export const BREACH_STATUS: Record<BreachStatus, { label: string; tone: string }> = {
  open: { label: 'Open', tone: 'border-rose-200 bg-rose-50 text-rose-700' },
  plan_proposed: { label: 'Plan proposed', tone: 'border-amber-200 bg-amber-50 text-amber-700' },
  plan_approved: { label: 'Plan approved', tone: 'border-primary-200 bg-primary-50 text-primary-700' },
  excess_approved: { label: 'Excess approved', tone: 'border-orange-200 bg-orange-50 text-orange-700' },
  resolved: { label: 'Resolved', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
};

export interface DiffLine {
  kind: 'same' | 'added' | 'removed';
  text: string;
}

/** Line-by-line diff (longest common subsequence): what a new version removes and adds against the approved one. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  const lcs = a.map(() => new Array<number>(b.length + 1).fill(0));
  lcs.push(new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i++; j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: 'removed', text: a[i++] });
    } else {
      out.push({ kind: 'added', text: b[j++] });
    }
  }
  while (i < a.length) out.push({ kind: 'removed', text: a[i++] });
  while (j < b.length) out.push({ kind: 'added', text: b[j++] });
  return out;
}

/** What can be done on a breach now. The server refuses the plan's author a decision (maker-checker) and says so. */
export function breachActions(breach: Pick<BreachRecord, 'status' | 'can_plan'>, canDecide: boolean): BreachAction[] {
  const actions: BreachAction[] = [];
  if ((breach.status === 'open' || breach.status === 'plan_proposed') && breach.can_plan) actions.push('plan');
  if (breach.status === 'plan_proposed' && canDecide) actions.push('approve-plan', 'reject-plan');
  if ((breach.status === 'plan_proposed' || breach.status === 'plan_approved') && canDecide) actions.push('approve-excess');
  return actions;
}

const DAY_MS = 86_400_000;
const EXCESS_MAX_DAYS = 182;     // the server allows 183 days to the second; the last whole day the date picker may offer
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function excessExpiryRange(now: Date = new Date()): { min: string; max: string } {
  return { min: isoDate(new Date(now.getTime() + DAY_MS)), max: isoDate(new Date(now.getTime() + EXCESS_MAX_DAYS * DAY_MS)) };
}

/** A limit change proposed after a statement version was approved (RiskAppetiteConfig.limit_change on the server). */
export interface LimitChange {
  status: 'pending' | 'approved' | 'rejected';
  changes: Record<string, unknown>;
  proposed_by: number | null;
  proposed_by_name?: string | null;
  proposed_at: string | null;
  decided_by?: number | null;
  decided_by_name?: string | null;
  decided_at?: string | null;
  note?: string | null;
}

export type LimitsState = 'as_approved' | 'changed' | 'added' | 'proposed' | 'not_recorded' | 'no_approved_version';
export interface LimitsSource { version: number | null; state: LimitsState }

/** Which approved version a category's limits in force come from, in words. */
export function limitsSourceText(source: LimitsSource | null | undefined): string {
  if (!source || source.state === 'no_approved_version') return 'No approved statement yet: limits change at once.';
  const v = `version ${source.version}`;
  switch (source.state) {
    case 'as_approved': return `In force as approved with ${v}.`;
    case 'changed': return `Changed since ${v} by an approved limit change.`;
    case 'added': return `Added after ${v}: not in an approved version.`;
    case 'proposed': return `New limit waiting for someone else's approval: not in force yet.`;
    default: return `In force since ${v}, approved before limits were recorded with it.`;
  }
}

const LIMIT_LABEL: Record<string, string> = {
  appetite_level: 'Appetite level', max_acceptable_score: 'Max acceptable score', tolerance_threshold: 'Tolerance threshold',
  escalation_owner_id: 'Escalation owner', concentration_limit: 'Concentration limit', limit_kri_ids: 'Limit KRIs',
};

/** "Tolerance threshold: 10 → 15" for each limit a change moves, against the limits in force; a removal says so. */
export function limitChangeLines(inForce: Record<string, unknown>, changes: Record<string, unknown>,
  nameOf: (id: number) => string = (id) => `#${id}`): string[] {
  if (changes.remove) return ['Remove this limit'];
  const text = (field: string, value: unknown): string => {
    if (value == null || value === '') return '—';
    if (field === 'limit_kri_ids' && Array.isArray(value)) return `${value.length} linked`;
    if (field === 'escalation_owner_id') return nameOf(Number(value));
    return String(value);
  };
  return Object.entries(changes).map(([field, to]) => `${LIMIT_LABEL[field] || field}: ${text(field, inForce[field])} → ${text(field, to)}`);
}
