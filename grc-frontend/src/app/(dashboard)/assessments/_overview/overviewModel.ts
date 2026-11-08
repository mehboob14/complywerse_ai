// What the Assessments Overview decides, apart from React so `node --test` pins it (overviewModel.test.ts): the five counters of "Needs attention" and where each opens, the rows of "Do now"
// (the person's own controls, drafts to scope and evidence to decide, the most urgent first, one action each), the posture (the server's score and its grade), the categories as bars, and the
// remediation clock of the whole portfolio. Every figure is the SERVER's (`GET /overview`, `GET /my-work`); the clock's due-soon count and ageing come from the points with the server's own
// due-date rule (workspace/clockModel.ts), exactly as one assessment's Remediation tab does. A figure the server did not send is null: the page shows a dash or its error, never 0.
import type { Tone } from '../../../../lib/status.ts';
import { normaliseItem, DEFAULT_SLA_DAYS, type RawItem, type SlaDays, type WorkItem as Control } from '../../../../components/assessments/workspace/itemModel.ts';
import { remediationClock, type Clock } from '../../../../components/assessments/workspace/clockModel.ts';
import { kindOf } from '../../../../components/assessments/workspace/kinds.ts';
import { gradeOf, workspaceHref, type GradeWord } from '../../../../components/assessments/workspace/workspaceModel.ts';
import { subjectOf } from '../../../../components/compliance/scoping/scopingModel.ts';
import { categoryHref } from '../_data/categories.ts';
import type { Board, BoardCategory, MyApproval, MyDraft, MyItem, MyWork, Point, Policy } from '../_data/types.ts';

/** The server's target (`board`'s ring says "target 85"): a score from here is excellent. */
export const TARGET = 85;

export interface Counter { key: string; label: string; href: string; tone: Tone; value: number | null; source: 'work' | 'board' }

/** The counters of the band, in the order of urgency. `value` is null when the request that holds it has not answered (the page then shows its own state, never 0). Each opens what it counts. */
export function countersOf(board: Board | undefined, work: MyWork | undefined): Counter[] {
  return [
    { key: 'approve', label: 'To approve', href: '/needs-my-action', tone: 'pending', value: work ? work.counts.to_approve : null, source: 'work' },
    { key: 'overdue', label: 'Overdue gaps', href: '/assessments/register?quick=overdue', tone: 'danger', value: board ? board.attention.overdue_gaps : null, source: 'board' },
    { key: 'assigned', label: 'Controls assigned to me', href: '/assessments/register?quick=waiting', tone: 'warning', value: work ? work.counts.assigned : null, source: 'work' },
    { key: 'scope', label: 'To scope', href: '/assessments/register?quick=scoping', tone: 'pending', value: work ? work.counts.to_scope : null, source: 'work' },
    { key: 'notstarted', label: 'Not started', href: '/assessments/register?quick=notstarted', tone: 'neutral', value: board ? board.attention.not_started : null, source: 'board' },
  ];
}

/** The sum of the counters that were sent (the band's "N in total"); null when none was. */
export function attentionTotal(counters: readonly Counter[]): number | null {
  const sent = counters.filter((c) => c.value !== null);
  return sent.length === 0 ? null : sent.reduce((n, c) => n + (c.value as number), 0);
}

// ── Do now ──────────────────────────────────────────────────────────────────────

export interface WorkRowModel {
  key: string;
  kind: { label: string; tone: Tone };
  title: string;
  context: string | null;
  /** an ISO day or date-time; null when the row has no date */
  due: string | null;
  href: string;
  action: string;
  /** lower first */
  rank: number;
}

/** "NCA DCC-1:2022 · NCA DCC assessment": the kind is added after the name only when the name does not already say it. */
export function nameWithKind(name: string, format: string): string {
  const label = kindOf(format).label;
  return name.toLowerCase().includes(label.toLowerCase()) ? name : [name, label].filter(Boolean).join(' · ');
}

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const controlTitle = (i: MyItem): string => [i.item_number, clip(i.description, 140)].filter(Boolean).join(' ') || 'Control';

function itemRow(i: MyItem): WorkRowModel {
  return {
    key: `item:${i.item_id}`,
    kind: i.overdue ? { label: 'Overdue', tone: 'danger' } : { label: i.via === 'team' ? 'Your department' : 'Assigned', tone: 'progress' },
    title: controlTitle(i),
    context: nameWithKind(i.assessment_name, i.assessment_format),
    due: i.due,
    href: `${workspaceHref(i.assessment_id)}?tab=controls&item=${i.item_id}`,
    action: 'Open',
    rank: i.overdue ? 0 : 3,
  };
}
function draftRow(d: MyDraft): WorkRowModel {
  return {
    key: `draft:${d.id}`, kind: { label: 'To scope', tone: 'pending' }, title: subjectOf({ name: d.name, primary_asset_name: d.primary_asset_name, scope_model: 'process', assessment_format: d.assessment_format }),
    context: kindOf(d.assessment_format).label, due: null, href: workspaceHref(d.id), action: 'Scope', rank: 2,
  };
}
function approvalRow(a: MyApproval): WorkRowModel {
  return {
    key: `approval:${a.id}`, kind: { label: 'To approve', tone: 'pending' }, title: a.evidence_name || a.evidence_file_name || 'Evidence',
    context: [a.assessment_name, a.item_number].filter(Boolean).join(' · '), due: null, href: '/needs-my-action', action: 'Decide', rank: 1,
  };
}

/** The person's own work as rows, the most urgent first: controls past their date (the oldest first), evidence waiting for their decision, drafts to scope, then the rest by date. */
export function workRows(work: MyWork | undefined): WorkRowModel[] {
  if (!work) return [];
  const rows = [...work.assigned_items.map(itemRow), ...work.approvals.map(approvalRow), ...work.scoping.map(draftRow)];
  const day = (r: WorkRowModel): number => (r.due ? Date.parse(r.due) || Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER);
  return rows.sort((a, b) => a.rank - b.rank || day(a) - day(b) || a.title.localeCompare(b.title));
}

/** The true number of things the person has (the lists are cut at the request's limit; the counts are not). */
export function mineTotal(work: MyWork | undefined): number | null {
  return work ? work.counts.assigned + work.counts.to_scope + work.counts.to_approve : null;
}

/** "Showing 25 of 40" when the lists were cut, else "40 items". */
export function mineLine(shown: number, total: number): string {
  return total > shown ? `Showing ${shown} of ${total}` : `${total} ${total === 1 ? 'item' : 'items'}`;
}

// ── Posture ─────────────────────────────────────────────────────────────────────

export interface Posture {
  score: number | null;
  grade: GradeWord | null;
  sla: number | null;
  assessments: number;
  /** points to the target (85); null when there is no score or it is reached */
  toTarget: number | null;
}

export function postureOf(board: Board): Posture {
  const score = board.performance.score;
  return {
    score, grade: gradeOf(score), sla: board.sla.score, assessments: board.performance.assessments,
    toTarget: typeof score === 'number' && score < TARGET ? Math.round((TARGET - score) * 10) / 10 : null,
  };
}

export interface CategoryRow { category: string; href: string; score: number | null; grade: GradeWord | null; sla: number | null; count: number }

/** The categories of the board as rows: the most assessments first, ties by name. Each opens the register on that category. */
export function categoryRows(board: Board): CategoryRow[] {
  const row = (c: BoardCategory): CategoryRow => ({ category: c.category, href: categoryHref(c.category), score: c.score, grade: gradeOf(c.score), sla: c.sla, count: c.count });
  return board.categories.map(row).sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));
}

// ── The remediation clock of the portfolio ──────────────────────────────────────

const RAW = (p: Point): RawItem => ({
  id: p.id, item_number: p.item_number, area_domain: p.area_domain, control_description: p.control_description, compliance_status: p.compliance_status, priority: p.priority,
  remediation_status: p.remediation_status, timeline: p.timeline, target_date: p.target_date, closed_at: p.closed_at, created_at: p.created_at, updated_at: p.updated_at,
});

/** The days of the tenant's policy; until it answers (or if it fails) the defaults the server uses when a tenant set none. */
export function daysOf(policy: Policy | undefined): SlaDays {
  return policy ? {
    critical_days: policy.critical_days ?? DEFAULT_SLA_DAYS.critical_days, high_days: policy.high_days ?? DEFAULT_SLA_DAYS.high_days, medium_days: policy.medium_days ?? DEFAULT_SLA_DAYS.medium_days,
    low_days: policy.low_days ?? DEFAULT_SLA_DAYS.low_days, due_soon_days: policy.due_soon_days ?? DEFAULT_SLA_DAYS.due_soon_days,
  } : DEFAULT_SLA_DAYS;
}

/** The clock of every assessment the board counts: the headline counts are the server's (`board.sla`), the due-soon count and the ageing come from the points. `asOf` moves "today" forward (What if). */
export function portfolioClock(points: readonly Point[], days: SlaDays, board: Board | undefined, asOf: number = Date.now()): Clock {
  const items: Control[] = points.map((p) => normaliseItem(RAW(p)));
  return remediationClock(items, days, asOf, board ? board.sla : null);
}

const DAY = 86_400_000;
/** The furthest "What if" looks ahead. */
export const WHAT_IF_MAX_DAYS = 365;

/** The day a "What if" date input holds (a calendar day, "2026-12-31"), as the end of that day in the viewer's zone; null when it is empty, not a date, today or the past, or beyond a year. */
export function whatIfMs(day: string, now: number = Date.now()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split('-').map(Number);
  const at = new Date(y, m - 1, d, 23, 59, 59).getTime();
  if (Number.isNaN(at) || new Date(at).getDate() !== d) return null;
  const today = new Date(now);
  today.setHours(23, 59, 59, 0);                                            // the end of today: a what if starts tomorrow
  return at > today.getTime() && at <= now + WHAT_IF_MAX_DAYS * DAY ? at : null;
}

/** The day input's bounds, "2026-11-09" to a year on. */
export function whatIfBounds(now: number = Date.now()): { min: string; max: string } {
  const text = (ms: number): string => { const t = new Date(ms); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`; };
  return { min: text(now + DAY), max: text(now + WHAT_IF_MAX_DAYS * DAY) };
}

// ── The SLA policy dialog ───────────────────────────────────────────────────────

export const POLICY_DAYS = [
  { key: 'critical_days', label: 'Critical gaps are due in' },
  { key: 'high_days', label: 'High' },
  { key: 'medium_days', label: 'Medium' },
  { key: 'low_days', label: 'Low' },
  { key: 'due_soon_days', label: 'A gap is due soon this many days before its date' },
] as const;

export const POLICY_WEIGHTS = [
  { key: 'score_closed_ontime', label: 'Closed on time' },
  { key: 'score_closed_late', label: 'Closed late' },
  { key: 'score_on_track', label: 'On track' },
  { key: 'score_due_soon', label: 'Due soon' },
  { key: 'score_overdue', label: 'Overdue' },
  { key: 'score_no_date', label: 'No date' },
] as const;

export type PolicyKey = (typeof POLICY_DAYS)[number]['key'] | (typeof POLICY_WEIGHTS)[number]['key'];

/** Text for every field of the dialog, from the policy the server holds. */
export function policyDraft(policy: Policy): Record<PolicyKey, string> {
  const out = {} as Record<PolicyKey, string>;
  for (const f of [...POLICY_DAYS, ...POLICY_WEIGHTS]) out[f.key] = String(policy[f.key] ?? '');
  return out;
}

/** What is wrong with the draft ("" when nothing): days are whole numbers from 1 to 3650, scores whole numbers from 0 to 100. The server ignores a day count of 0 or less and clamps nothing, so a typo is refused here. */
export function policyProblem(draft: Record<PolicyKey, string>): string {
  for (const f of POLICY_DAYS) { const n = Number(draft[f.key]); if (!/^\d+$/.test(draft[f.key].trim()) || n < 1 || n > 3650) return `${f.label}: a whole number of days from 1 to 3650.`; }
  for (const f of POLICY_WEIGHTS) { const n = Number(draft[f.key]); if (!/^\d+$/.test(draft[f.key].trim()) || n > 100) return `${f.label}: a whole number from 0 to 100.`; }
  return '';
}

/** The policy to send: every field, as numbers. */
export function policyOf(draft: Record<PolicyKey, string>): Policy {
  const num = (k: PolicyKey): number => Number(draft[k]);
  return {
    critical_days: num('critical_days'), high_days: num('high_days'), medium_days: num('medium_days'), low_days: num('low_days'), due_soon_days: num('due_soon_days'),
    score_closed_ontime: num('score_closed_ontime'), score_closed_late: num('score_closed_late'), score_on_track: num('score_on_track'), score_due_soon: num('score_due_soon'),
    score_overdue: num('score_overdue'), score_no_date: num('score_no_date'),
  };
}

/** Whether the draft differs from the policy the server holds. */
export function policyChanged(draft: Record<PolicyKey, string>, policy: Policy): boolean {
  const was = policyDraft(policy);
  return (Object.keys(was) as PolicyKey[]).some((k) => was[k].trim() !== draft[k].trim());
}
