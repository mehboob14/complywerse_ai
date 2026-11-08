// What the Issue & Incident Overview decides, apart from React so `node --test` pins it (overviewModel.test.ts): the counters, the work list, the breakdowns and the score's words.
// ONE definition: a counter is computed with the SAME chip test the register uses for the chip it opens (issueDef / actionDef / incidentDef `quick`), over the same rows, at the
// same instant, so the number on this page is always the number of rows the register shows after the click. A feed that is loading or failed makes its counters "loading" or
// "failed", never 0. "Needs attention" counts each record once, however many of the chips it matches.
import { issueDef, codeOf, personName, openOf, isLate, stateWord, type IssueRow } from '../../../../lib/issues/issueDef.ts';
import { actionDef, isActionOverdue, isManagedInTasks, issueLine, openAction, statusOf, type ActionRow } from '../../../../lib/issues/actionDef.ts';
import { ACTION_STATUSES, ISSUE_SEVERITIES, actionStepsFrom, isAwaitingClosure, severityRank, sourceWord, stepsFrom, type ActionStep, type IssueStep } from '../../../../lib/issues/words.ts';
import { incidentDef, type IncidentRow } from '../../erm/_monitoring/incidentModel.ts';
import { isOpenIncident } from '../../../../lib/erm/incident.ts';
import type { RegisterDef } from '../../../../components/records/registerModel.ts';
import { actionStatus, issueSeverity, issueState } from '../../../../lib/statuses/issues.ts';
import { incidentStatus, severity as incidentSeverity } from '../../../../lib/statuses/monitoring.ts';
import { parseUtc } from '../../../../lib/serverTime.ts';
import type { Tone } from '../../../../lib/status.ts';

// ── the feeds ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type FeedState = 'loading' | 'error' | 'ready';
export interface Feed<T> { state: FeedState; rows: readonly T[] }
export function loading<T>(): Feed<T> { return { state: 'loading', rows: [] }; }
export interface Feeds { issues: Feed<IssueRow>; actions: Feed<ActionRow>; /** null: the person may not read incidents (or the server refused them): nothing about incidents is drawn */ incidents: Feed<IncidentRow> | null }
export type FeedKey = keyof Feeds;

/** The incidents feed the page hands the model: loading while the person's rights are, none (nothing about incidents is drawn) when they may not read incidents or the server refused them, the query's own otherwise. */
export function incidentsFeed(permissionsLoading: boolean, allowed: boolean, feed: Feed<IncidentRow>): Feed<IncidentRow> | null {
  if (permissionsLoading) return loading();
  return allowed ? feed : null;
}

// ── the counters ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CounterDef {
  key: string;
  feed: FeedKey;
  /** the register's quick chip this counter opens (its test counts the rows) */
  chip: string;
  label: string;
  href: string;
  tone: Tone;
  /** part of "Needs attention" (the others are context) */
  attention: boolean;
}

/** In the order a person reads them: what is wrong first, the context last. Every address is a filter the register's schema reads (`?quick=` names the chip of the same key). */
export const COUNTER_DEFS: readonly CounterDef[] = [
  { key: 'late', feed: 'issues', chip: 'late', label: 'Late issues', href: '/issues/register?quick=late', tone: 'danger', attention: true },
  { key: 'serious', feed: 'issues', chip: 'serious', label: 'Critical or high issues', href: '/issues/register?quick=serious', tone: 'danger', attention: true },
  { key: 'closing', feed: 'issues', chip: 'closing', label: 'Awaiting closure', href: '/issues/register?quick=closing', tone: 'warning', attention: true },
  { key: 'unassigned', feed: 'issues', chip: 'unassigned', label: 'Unassigned issues', href: '/issues/register?quick=unassigned', tone: 'warning', attention: true },
  { key: 'actions_late', feed: 'actions', chip: 'late', label: 'Late actions', href: '/issues/actions?quick=late', tone: 'warning', attention: true },
  { key: 'incidents_severe', feed: 'incidents', chip: 'severe', label: 'Critical or high incidents', href: '/erm/incidents?quick=severe', tone: 'danger', attention: true },
  { key: 'open', feed: 'issues', chip: 'open', label: 'Open issues', href: '/issues/register?quick=open', tone: 'neutral', attention: false },
  { key: 'incidents_open', feed: 'incidents', chip: 'open', label: 'Open incidents', href: '/erm/incidents?quick=open', tone: 'neutral', attention: false },
];

type Test = (row: never, now: Date) => boolean;
function testsOf<R>(def: RegisterDef<R>): Record<string, Test> { return Object.fromEntries(def.quick.map((q) => [q.key, q.test as unknown as Test])); }
// the registers' own chips (built with no person: "Mine" is not a counter here)
const TESTS: Record<FeedKey, Record<string, Test>> = { issues: testsOf(issueDef(null)), actions: testsOf(actionDef(null)), incidents: testsOf(incidentDef(null)) };

/** Whether a row matches a counter's chip: the register's own test. A chip nobody defines matches nothing (the test file pins every counter to a chip that exists). */
export function matches(def: Pick<CounterDef, 'feed' | 'chip'>, row: IssueRow | ActionRow | IncidentRow, now: Date): boolean {
  const test = TESTS[def.feed][def.chip];
  return test ? test(row as never, now) : false;
}

export interface Counter { key: string; feed: FeedKey; label: string; href: string; tone: Tone; attention: boolean; state: FeedState; value?: number }

export function countersOf(feeds: Feeds, now: Date): Counter[] {
  return COUNTER_DEFS.flatMap((d): Counter[] => {
    const feed = feeds[d.feed];
    if (!feed) return [];
    const base = { key: d.key, feed: d.feed, label: d.label, href: d.href, tone: d.tone, attention: d.attention, state: feed.state };
    const rows = feed.rows as readonly (IssueRow | ActionRow | IncidentRow)[];
    return [feed.state === 'ready' ? { ...base, value: rows.filter((r) => matches(d, r, now)).length } : base];
  });
}

/** Each record that needs attention, once: the issues that match any of their attention chips, the actions that are late, the incidents that are critical or high and open.
 *  null while a feed that counts is loading or failed (an unknown total is never a smaller one). */
export function needsAttention(feeds: Feeds, now: Date): number | null {
  const keys: FeedKey[] = ['issues', 'actions'];
  if (feeds.incidents) keys.push('incidents');
  if (keys.some((k) => (feeds[k] as Feed<unknown>).state !== 'ready')) return null;
  const attention = COUNTER_DEFS.filter((d) => d.attention);
  let total = 0;
  keys.forEach((k) => {
    const defs = attention.filter((d) => d.feed === k);
    (feeds[k] as Feed<IssueRow | ActionRow | IncidentRow>).rows.forEach((r) => { if (defs.some((d) => matches(d, r, now))) total += 1; });
  });
  return total;
}

// ── the person's own work ────────────────────────────────────────────────────────────────────────────────────────────────

export type WorkKind = 'issue' | 'approve' | 'action' | 'incident';
export const WORK_KIND: Record<WorkKind, { label: string; tone: Tone }> = {
  issue: { label: 'Issue', tone: 'warning' },
  approve: { label: 'To approve', tone: 'pending' },
  action: { label: 'Action', tone: 'progress' },
  incident: { label: 'Incident', tone: 'danger' },
};

/** What a row's one button does: take the expected step of an issue or an action, or open the record. */
export type WorkAct =
  | { type: 'issue-step'; issue: IssueRow; step: IssueStep }
  | { type: 'action-step'; action: ActionRow; step: ActionStep }
  | { type: 'link'; label: string; href: string };

export interface WorkItem {
  key: string;
  kind: WorkKind;
  title: string;
  context: string;
  href: string;
  /** naive UTC from the server (a due date means a day: `calendar`); null: no date */
  due: string | null;
  calendar: boolean;
  overdue: boolean;
  act: WorkAct;
  /** the worst severity first inside a group */
  rank: number;
}

export interface WorkSources {
  me: number | null;
  now: Date;
  /** may take a step (issue_management:issues:edit: what the server asks) */
  canEdit: boolean;
  issues: readonly IssueRow[];
  actions: readonly ActionRow[];
  incidents: readonly IncidentRow[];
}

const primaryOf = <S extends { primary?: boolean }>(steps: S[]): S | null => steps.find((s) => s.primary) ?? null;
const open = (label: string, href: string): WorkAct => ({ type: 'link', label, href });
const sev = (s?: string | null): string => (s ? issueSeverity.label(s) : '');

/** Everything that waits for the person, unsorted: their open issues, (for those who may edit) the other issues waiting for a closure approval, their open actions and incidents. */
export function workOf(s: WorkSources): WorkItem[] {
  const out: WorkItem[] = [];
  if (s.me == null) return out;
  s.issues.filter(openOf).forEach((i) => {
    const mine = i.assignee?.id === s.me;
    const approving = !mine && s.canEdit && isAwaitingClosure(i.workflow_state);
    if (!mine && !approving) return;
    const step = s.canEdit ? primaryOf(stepsFrom(i.workflow_state)) : null;
    out.push({
      key: `issue-${i.id}`,
      kind: mine ? 'issue' : 'approve',
      title: i.title,
      context: [codeOf(i), sev(i.severity), mine ? issueState.label(stateWord(i)) : personName(i.assignee) ?? 'Unassigned'].filter(Boolean).join(' · '),
      href: `/issues/${i.id}`,
      due: i.target_closure_date ?? null,
      calendar: false,
      overdue: isLate(i, s.now),
      act: step ? { type: 'issue-step', issue: i, step } : open('Open', `/issues/${i.id}`),
      rank: severityRank(i.severity),
    });
  });
  s.actions.filter((a) => openAction(a) && a.assignee_id === s.me).forEach((a) => {
    const managed = isManagedInTasks(a);
    const step = s.canEdit && !managed ? primaryOf(actionStepsFrom(a.status)) : null;
    out.push({
      key: `action-${a.id}`,
      kind: 'action',
      title: a.title,
      context: [issueLine(a), actionStatus.label(statusOf(a)), managed ? 'Managed in Tasks' : ''].filter(Boolean).join(' · '),
      href: `/issues/${a.issue_id}`,
      due: a.due_date ?? null,
      calendar: true,
      overdue: isActionOverdue(a, s.now),
      act: step ? { type: 'action-step', action: a, step } : open('Open', `/issues/${a.issue_id}`),
      rank: 5,
    });
  });
  s.incidents.filter((i) => i.assigned_to === s.me && isOpenIncident(i.status)).forEach((i) => out.push({
    key: `incident-${i.id}`,
    kind: 'incident',
    title: i.title,
    context: [i.severity ? incidentSeverity.label(i.severity) : '', incidentStatus.label(i.status)].filter(Boolean).join(' · '),
    href: `/erm/incidents?id=${i.id}`,
    due: null,
    calendar: false,
    overdue: false,
    act: open('Open', `/erm/incidents?id=${i.id}`),
    rank: severityRank(i.severity),
  }));
  return out;
}

// the longer steps say it shorter on a row (the button's accessible name still carries the row's title)
const SHORT: Record<string, string> = { 'Move to resolution': 'To resolution', 'Send for closure review': 'Send for review', 'Mark completed': 'Complete', 'Resume work': 'Resume', 'Verify it worked': 'Verify' };
/** The word on a row's one button. */
export const actLabel = (act: WorkAct): string => (act.type === 'link' ? act.label : SHORT[act.step.label] ?? act.step.label);

export type Urgency = 'overdue' | 'week' | 'todo';
export const URGENCY_LABEL: Record<Urgency, string> = { overdue: 'Overdue', week: 'This week', todo: 'To do' };
const DAY = 86_400_000;
const at = (iso: string | null): number | null => parseUtc(iso)?.getTime() ?? null;

export function urgencyOf(item: Pick<WorkItem, 'due' | 'overdue'>, now: Date): Urgency {
  if (item.overdue) return 'overdue';
  const t = at(item.due);
  return t !== null && t - now.getTime() <= 7 * DAY ? 'week' : 'todo';
}

/** Most urgent first: overdue (the oldest date first), this week (the soonest first), then the rest (the worst severity first, then the date); a tie keeps the order of the sources. */
export function buildWork(s: WorkSources): WorkItem[] {
  const rank: Record<Urgency, number> = { overdue: 0, week: 1, todo: 2 };
  const byDate = (a: number | null, b: number | null): number => (a !== null && b !== null ? a - b : a !== null ? -1 : b !== null ? 1 : 0);          // no date goes last
  return workOf(s)
    .map((item, index) => ({ item, index, u: urgencyOf(item, s.now), t: at(item.due) }))
    .sort((a, b) => rank[a.u] - rank[b.u]
      || (a.u === 'todo' ? a.item.rank - b.item.rank || byDate(a.t, b.t) : byDate(a.t, b.t) || a.item.rank - b.item.rank)
      || a.index - b.index)
    .map((x) => x.item);
}

/** The first `limit` items with a header where the urgency changes. */
export function groupWork(items: readonly WorkItem[], now: Date, limit: number): Array<{ group: Urgency; items: WorkItem[] }> {
  const out: Array<{ group: Urgency; items: WorkItem[] }> = [];
  items.slice(0, limit).forEach((it) => {
    const g = urgencyOf(it, now);
    const last = out[out.length - 1];
    if (last && last.group === g) last.items.push(it);
    else out.push({ group: g, items: [it] });
  });
  return out;
}

// ── the breakdowns (all from the rows the page already holds) ───────────────────────────────────────────────────────────────

export interface Slice { key: string; label: string; total: number; critical: number; high: number; tone: Tone; href: string }
const NONE = 'none';
const REGISTER = '/issues/register?quick=open';

function slicesOf(rows: readonly IssueRow[], keyOf: (i: IssueRow) => { key: string; label: string }, param: string, tone: (key: string, c: { critical: number; high: number }) => Tone): Slice[] {
  const m = new Map<string, Slice>();
  rows.filter(openOf).forEach((i) => {
    const k = keyOf(i);
    const cur = m.get(k.key) ?? { key: k.key, label: k.label, total: 0, critical: 0, high: 0, tone: 'neutral' as Tone, href: `${REGISTER}&${param}=${encodeURIComponent(k.key)}` };
    cur.total += 1;
    if (i.severity === 'critical') cur.critical += 1;
    if (i.severity === 'high') cur.high += 1;
    m.set(k.key, cur);
  });
  return Array.from(m.values()).map((s) => ({ ...s, tone: tone(s.key, s) }));
}

/** Open issues by severity, worst first (a severity with none is left out). */
export function severitySlices(rows: readonly IssueRow[]): Slice[] {
  const tones: Record<string, Tone> = { critical: 'danger', high: 'warning', medium: 'progress' };
  return slicesOf(rows, (i) => { const s = (i.severity || '').toLowerCase(); return s ? { key: s, label: issueSeverity.label(s) } : { key: NONE, label: 'No severity' }; }, 'severity', (key) => tones[key] ?? 'neutral')
    .sort((a, b) => severityRank(a.key === NONE ? null : a.key) - severityRank(b.key === NONE ? null : b.key));
}

/** Open issues by where they were raised from, the biggest first. */
export function sourceSlices(rows: readonly IssueRow[]): Slice[] {
  return slicesOf(rows, (i) => { const k = i.source_type || 'manual'; return { key: k, label: sourceWord(k) }; }, 'source', (_k, c) => (c.critical > 0 ? 'danger' : c.high > 0 ? 'warning' : 'neutral'))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** Open issues by the person they are assigned to, the most loaded first; "Unassigned" is a row like any other. */
export function assigneeSlices(rows: readonly IssueRow[]): Slice[] {
  return slicesOf(rows, (i) => (i.assignee ? { key: String(i.assignee.id), label: personName(i.assignee) || `User ${i.assignee.id}` } : { key: NONE, label: 'Unassigned' }), 'assignee', (key, c) => (key === NONE ? 'warning' : c.critical > 0 ? 'danger' : c.high > 0 ? 'warning' : 'neutral'))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** Corrective actions by status in the order of their life, those that have any. */
export function actionSlices(rows: readonly ActionRow[]): Slice[] {
  const tones: Record<string, Tone> = { blocked: 'warning', in_progress: 'progress', planned: 'pending', completed: 'success', verified: 'success' };
  return ACTION_STATUSES.map((s) => ({ s, n: rows.filter((a) => statusOf(a) === s).length }))
    .filter((x) => x.n > 0)
    .map((x): Slice => ({ key: x.s, label: actionStatus.label(x.s), total: x.n, critical: 0, high: 0, tone: tones[x.s] ?? 'neutral', href: `/issues/actions?status=${x.s}` }));
}

export const AGE_BUCKETS = ['Up to 7 days', '8 to 30 days', '31 to 90 days', 'Over 90 days'] as const;
const bucketOf = (days: number): number => (days <= 7 ? 0 : days <= 30 ? 1 : days <= 90 ? 2 : 3);

export interface AgeMatrix { rows: Array<{ severity: string; label: string; cells: number[]; total: number }>; totals: number[]; total: number }

/** Open issues by severity (rows) and how long ago they were raised (columns); the rows with none are left out. An issue with no raised date is not placed (it is counted in none of the columns). */
export function ageMatrix(rows: readonly IssueRow[], now: Date): AgeMatrix {
  const cells = new Map<string, number[]>();
  rows.filter(openOf).forEach((i) => {
    const raised = parseUtc(i.created_at);
    if (!raised) return;
    const key = (i.severity || '').toLowerCase() || NONE;
    const row = cells.get(key) ?? [0, 0, 0, 0];
    row[bucketOf(Math.max(0, Math.floor((now.getTime() - raised.getTime()) / DAY)))] += 1;
    cells.set(key, row);
  });
  const order = (ISSUE_SEVERITIES as readonly string[]).concat(Array.from(cells.keys()).filter((k) => !(ISSUE_SEVERITIES as readonly string[]).includes(k)));
  const out = order.filter((k) => cells.has(k)).map((k) => { const c = cells.get(k) as number[]; return { severity: k, label: k === NONE ? 'No severity' : issueSeverity.label(k), cells: c, total: c.reduce((a, b) => a + b, 0) }; });
  const totals = [0, 1, 2, 3].map((b) => out.reduce((a, r) => a + r.cells[b], 0));
  return { rows: out, totals, total: totals.reduce((a, b) => a + b, 0) };
}

export interface TrendWeek { start: string; label: string; opened: number; closed: number }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Issues raised and issues closed in each of the last 12 weeks (weeks start on Monday, UTC like the server's times): "raised" by the raised date, "closed" by the closing date, so it is
 *  throughput. An issue that was closed without a closing date (a state change made before closing stamped one) is in no week. */
export function trend12w(rows: readonly IssueRow[], now: Date, weeks = 12): TrendWeek[] {
  const day = (now.getUTCDay() + 6) % 7;                                                        // Monday = 0
  const thisWeek = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - day * DAY;
  const created = rows.map((i) => parseUtc(i.created_at)?.getTime() ?? null);
  const closed = rows.map((i) => parseUtc(i.closed_at)?.getTime() ?? null);
  const out: TrendWeek[] = [];
  for (let w = weeks - 1; w >= 0; w -= 1) {
    const start = thisWeek - w * 7 * DAY;
    const end = start + 7 * DAY;
    const d = new Date(start);
    out.push({
      start: d.toISOString().slice(0, 10),
      label: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`,
      opened: created.filter((t) => t !== null && t >= start && t < end).length,
      closed: closed.filter((t) => t !== null && t >= start && t < end).length,
    });
  }
  return out;
}

// ── "how well issues close" (GET /dashboard/aggregate) ───────────────────────────────────────────────────────────────────────

export interface Aggregate {
  mttr_by_severity?: Array<{ severity: string; count: number; mean_days: number | null }>;
  sla_compliance_by_severity?: Array<{ severity: string; count: number; compliant_pct: number | null }>;
  reopen_stats?: { reopen_count?: number; closed_total?: number; reopen_rate_pct?: number | null };
}
export interface ClosingRow { severity: string; label: string; closed: number; meanDays: number | null; onTimePct: number | null; onTimeOf: number }

/** One row per severity that has closed issues: how many closed in the last 90 days with their average days to close, and the share closed by their target date (with how many that is of). */
export function closingRows(agg: Aggregate | undefined): ClosingRow[] {
  const mttr = new Map((agg?.mttr_by_severity ?? []).map((r) => [r.severity, r]));
  const sla = new Map((agg?.sla_compliance_by_severity ?? []).map((r) => [r.severity, r]));
  return (ISSUE_SEVERITIES as readonly string[])
    .map((s) => ({ s, m: mttr.get(s), c: sla.get(s) }))
    .filter((x) => (x.m?.count ?? 0) > 0 || (x.c?.count ?? 0) > 0)
    .map((x): ClosingRow => ({ severity: x.s, label: issueSeverity.label(x.s), closed: x.m?.count ?? 0, meanDays: x.m?.mean_days ?? null, onTimePct: x.c?.compliant_pct ?? null, onTimeOf: x.c?.count ?? 0 }));
}

/** "2 of 40 closed issues were reopened (5%)", or null when nothing has closed. */
export function reopenLine(stats: Aggregate['reopen_stats']): string | null {
  const closed = stats?.closed_total ?? 0;
  if (!closed) return null;
  const n = stats?.reopen_count ?? 0;
  const pct = stats?.reopen_rate_pct;
  return `${n} reopening${n === 1 ? '' : 's'} on ${closed} closed ${closed === 1 ? 'issue' : 'issues'}${typeof pct === 'number' ? ` (${pct}%)` : ''}`;
}

// ── the score (the server's scorecard) ───────────────────────────────────────────────────────────────────────────────────────

export type Grade = 'excellent' | 'good' | 'fair' | 'poor';
/** The server's cut, the one every scorecard prints (lib/perf/moduleFeeds.ts GRADE_LINES: the test pins this copy to it): 85 excellent, 70 good, 50 fair, below poor. */
export function gradeOf(score: number | null | undefined): Grade | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return score >= 85 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'fair' : 'poor';
}

export interface SectionLike { key: string; label: string; weight: number; score: number | null }
export interface ScorePayload {
  sections?: Record<string, SectionLike>;
  performance?: { score?: number | null; grade?: string | null; components?: Array<{ target?: number | null }> };
  target?: number | null;
  customized?: boolean;
}
export const SECTION_ORDER = ['issues', 'incidents', 'corrective_actions'] as const;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export interface Posture { score: number | null; grade: Grade | null; /** the target the server scored against; null: the answer carried none */ target: number | null; customized: boolean }
/** The module score as the server gave it, the grade as the server said it (derived by the same cut only when it sent none), and the target it scored against (never a number made up here). */
export function postureOf(p: ScorePayload | undefined): Posture {
  const raw = num(p?.performance?.score);
  const score = raw === null ? null : Math.round(raw);
  const said = String(p?.performance?.grade ?? '').toLowerCase();
  const grade = score === null ? null : (['excellent', 'good', 'fair', 'poor'] as const).find((g) => g === said) ?? gradeOf(raw);
  const target = num(p?.target) ?? num(p?.performance?.components?.[0]?.target);
  return { score, grade, target: target !== null && target > 0 ? target : null, customized: p?.customized === true };
}

export interface SectionRow extends SectionLike { grade: Grade | null }
export function sectionRows(p: ScorePayload | undefined): SectionRow[] {
  return SECTION_ORDER.map((k) => p?.sections?.[k]).filter((s): s is SectionLike => !!s).map((s) => ({ key: s.key, label: s.label, weight: s.weight, score: num(s.score), grade: gradeOf(num(s.score)) }));
}
