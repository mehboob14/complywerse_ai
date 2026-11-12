// What the lifecycle workspace says and decides, apart from React: the chart's segments, the order of the checks and where each
// one is cleared, the history's sentences, and the tiering dialog's arithmetic (what is left to answer, what changed, the draft's key).
// Pure, so `node --test "src/app/(dashboard)/vendor-risk/_lib/lifecycleLogic.test.ts"` runs the tests against it.
import type { Tone } from '../_ui/tones.ts';

// The eleven stages, in order, with the words the rail and the chart use. Mirrors backend stages (TPRA_STAGES).
export const STAGES: ReadonlyArray<{ key: string; label: string; gate: boolean; group: number }> = [
  { key: 'intake', label: 'Intake & Scoping', gate: false, group: 0 },
  { key: 'tiering', label: 'Inherent Risk Tiering', gate: true, group: 0 },
  { key: 'dd_planning', label: 'Due Diligence Planning', gate: false, group: 0 },
  { key: 'questionnaire', label: 'Questionnaire & Evidence', gate: false, group: 0 },
  { key: 'scoring', label: 'Risk Analysis & Scoring', gate: false, group: 1 },
  { key: 'findings', label: 'Findings & Remediation', gate: false, group: 1 },
  { key: 'contracting', label: 'Contracting & Controls', gate: false, group: 1 },
  { key: 'approval', label: 'Approval Decision', gate: true, group: 1 },
  { key: 'onboarding', label: 'Onboarding & Enablement', gate: false, group: 2 },
  { key: 'monitoring', label: 'Continuous Monitoring', gate: false, group: 2 },
  { key: 'reassessment', label: 'Reassessment & Offboarding', gate: false, group: 2 },
];
export const GROUPS = ['Onboarding diligence', 'Decision & contracting', 'In-life management'] as const;

export const stageName = (key?: string | null): string => STAGES.find((s) => s.key === key)?.label ?? '';
export const stageNumber = (key?: string | null): number => STAGES.findIndex((s) => s.key === key) + 1;

// ── the checks ───────────────────────────────────────────────────────────────

export type Fix = 'edit_vendor' | 'tier' | 'questionnaire' | 'roster' | 'findings' | 'paperwork' | 'decision' | 'lifecycle' | 'outsourcing';

/** One condition on leaving a stage, as the server sends it. met: true, false, or null when it cannot be answered yet. */
export interface Check { key: string; text: string; met: boolean | null; fix: Fix | null; detail?: string }

export const FIX_LABEL: Record<Fix, string> = {
  edit_vendor: 'Edit vendor', tier: 'Tier engagement', questionnaire: 'Open questionnaire', roster: 'Open roster',
  findings: 'Open findings', paperwork: 'Open paperwork', decision: 'Go to decision', lifecycle: 'Open lifecycle',
  outsourcing: 'Open outsourcing',
};

/** Blocking first, then those not answerable yet, then those met; each group keeps the server's order. */
export function orderChecks(checks: ReadonlyArray<Check>): Check[] {
  const rank = (c: Check) => (c.met === false ? 0 : c.met === null ? 1 : 2);
  return checks.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i).map((x) => x.c);
}

export const openChecks = (checks?: ReadonlyArray<Check> | null): number => (checks ?? []).filter((c) => c.met === false).length;

/** Where a fix button goes: another tab or page, a stage of this workspace, or the tiering dialog. */
export type FixAction =
  | { kind: 'href'; href: string }
  | { kind: 'stage'; stage: string }
  | { kind: 'tier' }
  | { kind: 'outsourcing' };

export function fixAction(fix: Fix, where: { vendorId: number; engagementId: number | null; firstOpen?: string | null }): FixAction {
  const base = `/vendor-risk/vendors/${where.vendorId}`;
  const tab = (name: string) => ({ kind: 'href' as const, href: `${base}?tab=${name}${where.engagementId ? `&engagement=${where.engagementId}` : ''}` });
  switch (fix) {
    case 'tier': return { kind: 'tier' };
    case 'edit_vendor': return { kind: 'stage', stage: 'intake' };
    case 'decision': return { kind: 'stage', stage: 'approval' };
    case 'lifecycle': return { kind: 'stage', stage: where.firstOpen || 'intake' };
    case 'questionnaire': return tab('assessments');
    case 'findings': return tab('findings');
    case 'paperwork': return tab('paperwork');
    case 'roster': return { kind: 'href', href: '/vendor-risk/roster' };
    case 'outsourcing': return { kind: 'outsourcing' };
  }
}

// ── the chart ────────────────────────────────────────────────────────────────

export interface StageFact { stage_key: string; status: string; skipped_reason?: string | null; skipped_by?: number | null }
export type Segment = 'done' | 'current' | 'blocked' | 'skipped' | 'upcoming';

/** Complete or skipped: the stages that need nothing more. */
export const settled = (stages: ReadonlyArray<StageFact>): number => stages.filter((s) => s.status === 'complete' || s.status === 'skipped').length;

/** One segment per stage: done, the current one (blocked while its checks are open), skipped, or still to come. */
export function segments(stages: ReadonlyArray<StageFact>, current: string | null, blocked: boolean): Array<{ key: string; state: Segment }> {
  return STAGES.map((def) => {
    const row = stages.find((s) => s.stage_key === def.key);
    const state: Segment = row?.status === 'skipped' ? 'skipped'
      : row?.status === 'complete' ? 'done'
        : def.key === current ? (blocked ? 'blocked' : 'current')
          : 'upcoming';
    return { key: def.key, state };
  });
}

export interface ChartFacts { label: string; settled: number; toClear: number; done: number; skipped: number; toGo: number }

/** The chart's words: where the work is, how many stages are settled, how many checks stand open. */
export function chartFacts(stages: ReadonlyArray<StageFact>, current: string | null, checks?: ReadonlyArray<Check> | null): ChartFacts {
  const n = settled(stages);
  const skipped = stages.filter((s) => s.status === 'skipped').length;
  return {
    label: n >= STAGES.length ? 'All stages settled' : stageName(current) || 'Not started',
    settled: n, toClear: openChecks(checks), done: n - skipped, skipped, toGo: STAGES.length - n,
  };
}

/** The rail's note on a stage, right of its name: how many checks are open, "Now", "Skipped", or the tier on the tiering row. */
export function railNote(stage: StageFact | undefined, isCurrent: boolean, open: number, tier?: string | null): { text: string; tone: Tone } | null {
  if (!stage) return null;
  if (stage.status === 'skipped') return { text: 'Skipped', tone: 'neutral' };
  if (isCurrent && open > 0) return { text: `${open} open`, tone: 'warning' };
  if (isCurrent && stage.status !== 'complete') return { text: 'Now', tone: 'progress' };
  if (stage.stage_key === 'tiering' && tier) return { text: tier[0].toUpperCase() + tier.slice(1), tone: 'neutral' };
  return null;
}

/** Why a stage was skipped, for its hover and its callout: the policy's right-sizing, or a person's reason. */
export function skippedBy(stage: StageFact): { byPolicy: boolean; reason: string } {
  const byPolicy = stage.skipped_by == null;
  const reason = String(stage.skipped_reason ?? '').trim();
  return { byPolicy, reason: byPolicy ? (reason.replace(/^auto-skipped\s*[—-]\s*/i, '') || 'right-sized by its tier') : reason };
}

// ── what moved the work ──────────────────────────────────────────────────────

export interface HistoryRow { id: number; action: string; from: string | null; to: string | null; reason: string | null; actor: string | null; at: string | null; review: number | null }

/** "Advanced Intake to Tiering", "Sent back Planning to Tiering", "Skipped Scoring", "Reopened Planning". */
export function historyLine(h: HistoryRow): string {
  const from = stageName(h.from), to = stageName(h.to);
  switch (h.action) {
    case 'transition': return `Advanced ${from} to ${to}`;
    case 'send_back': return `Sent back ${from} to ${to}`;
    case 'skip': return `Skipped ${from}`;
    case 'reopen': return `Reopened ${to}`;
    default: return fmtWord(h.action);
  }
}
const fmtWord = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).replace(/_/g, ' ') : '');

/** The first `limit` rows, or all of them. */
export const shownHistory = <T,>(rows: ReadonlyArray<T>, all: boolean, limit = 6): T[] => (all ? [...rows] : rows.slice(0, limit));

// ── the tiering dialog ───────────────────────────────────────────────────────

export interface AskedQuestion { key: string; type: string; required?: boolean; justify?: boolean; show_if?: string | null }
export interface AskedSection { key: string; title: string; questions: AskedQuestion[]; can_answer?: boolean }
export type Answers = Record<string, unknown>;

const blank = (v: unknown): boolean => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** The questions to ask now: those a yes elsewhere does not hide. */
export const visibleQuestions = (section: AskedSection, answers: Answers): AskedQuestion[] =>
  section.questions.filter((q) => !q.show_if || answers[q.show_if] === 'yes');

/** What still owes an answer in a section this person answers: a required question left blank, a yes that owes its reason. */
export function owed(section: AskedSection, answers: Answers, reasons: Record<string, string>, minReason: number): string[] {
  if (section.can_answer === false) return [];
  return visibleQuestions(section, answers).filter((q) =>
    (q.required && blank(answers[q.key])) || (q.justify && answers[q.key] === 'yes' && (reasons[q.key] ?? '').trim().length < minReason),
  ).map((q) => q.key);
}

/** Only what differs from what is saved: the patch to send. Nothing, an empty text and an empty list are the same; an answer taken
 *  back is sent empty, which the server keeps as no answer. */
export function changed<T>(draft: Record<string, T>, saved: Record<string, T>): Record<string, T> {
  const none = (v: unknown) => (v === undefined || v === '' || (Array.isArray(v) && v.length === 0) ? null : v);
  const same = (a: unknown, b: unknown) => JSON.stringify(none(a) ?? null) === JSON.stringify(none(b) ?? null);
  return Object.fromEntries(Object.entries(draft).filter(([k, v]) => !same(v, saved[k])));
}

/** "High" when the new result differs from the tier the engagement has now; null when it does not, or there is no tier yet. */
export function changesFrom(current: string | null | undefined, next: string | null | undefined): string | null {
  const a = String(current ?? '').toLowerCase(), b = String(next ?? '').toLowerCase();
  return a && b && a !== b ? a[0].toUpperCase() + a.slice(1) : null;
}

export const draftKey = (vendorId: number, engagementId: number | null): string => `${vendorId}:${engagementId ?? 'general'}`;

/** Whether the override step is complete: the computed tier stands, or a different tier has a reason of at least `min` characters. */
export const overrideReady = (tier: string, reason: string, min = 10): boolean => !tier || reason.trim().length >= min;

/** The address parameter that asks for the dialog: `tier=1` (this engagement) or `tier=<engagement id>`. */
export function tierRequest(param: string | null, engagementId: number | null): { open: boolean; engagement: number | null } {
  if (!param) return { open: false, engagement: engagementId };
  const asked = Number(param);
  const target = Number.isInteger(asked) && asked > 1 ? asked : engagementId;
  return { open: target === engagementId, engagement: target };
}

// ── the decision at the gate ─────────────────────────────────────────────────

export const DECISIONS: ReadonlyArray<{ value: string; label: string; done: string; note: string }> = [
  { value: 'approve', label: 'Approve', done: 'Approved', note: 'Go ahead on the terms as they stand.' },
  { value: 'approve_with_conditions', label: 'Approve with conditions', done: 'Approved with conditions', note: 'Go ahead once the conditions are met.' },
  { value: 'defer', label: 'Defer', done: 'Deferred', note: 'Not yet. Come back to it.' },
  { value: 'reject', label: 'Reject', done: 'Rejected', note: 'Do not go ahead.' },
];
export const decisionWord = (value?: string | null): string => DECISIONS.find((d) => d.value === value)?.done ?? fmtWord(String(value ?? ''));

/** An approving decision waits on the stage's other checks and on the person being allowed to approve; saying "not yet" or "no" never does. */
export const decisionAvailable = (value: string, excluded: boolean, blocking: number): boolean =>
  !value.startsWith('approve') || (!excluded && blocking === 0);

/** Open with "Defer" when approving is not possible yet, else with "Approve". */
export const firstDecision = (excluded: boolean, blocking: number): string => (excluded || blocking > 0 ? 'defer' : 'approve');

/** The one line under the heading while no decision is in force. */
export function approvalNote(stageStatus: string | undefined, blocking: number, canApprove: boolean): string {
  if (stageStatus === 'complete') return 'Passed.';
  if (stageStatus === 'not_started') return 'Opens when the earlier stages are done.';
  if (!canApprove) return 'Needs the right to approve vendors.';
  return blocking > 0 ? 'Approving waits on the checks above. Deferring or rejecting does not.' : 'Ready for a decision.';
}

export interface ConditionFact { status?: string; due_date?: string | null; waived?: boolean }
export type ConditionState = 'open' | 'met' | 'overdue' | 'waived';

/** A condition is waived or met once closed, overdue when open past its day (`today` is "YYYY-MM-DD"), else open. */
export function conditionState(c: ConditionFact, today: string): ConditionState {
  if (c.status === 'closed') return c.waived ? 'waived' : 'met';
  return c.due_date && String(c.due_date).slice(0, 10) < today ? 'overdue' : 'open';
}
