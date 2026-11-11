// What the Auditor Portal's front door DRAWS, apart from React so `node --test src/lib/auditorPortal/frontModel.test.ts` can pin it: the series of the charts (requests sent
// and decided per month, what waited at the end of each month, the waiting ones by age), the journeys' files by decision, the requirements by scope state, the observations by
// priority and status / by deadline / by regulator, and the figures of the tiles with their words. Every number is the server's (GET /auditor-portal/work/summary, GET
// /auditor-portal/work, GET /auditor-portal/statutory-audit/observations/summary): nothing here invents a figure, a missing array is "no data" and never a row of zeros.
import { changeOf, deltaOf, foldTail, trendText, type Change } from '../../components/overview/charts/chartModel.ts';
import { OTHER, STATUS } from '../../components/overview/charts/palette.ts';
import { counterTarget, journeyHref, orderJourneys, type JourneyCard, type QueueCounts, type WorkRowPayload } from './portalModel.ts';

// ── the payloads (additive endpoints, backend/grc/modules/auditor_portal/routers) ──────────────

export interface Flow { sent: number[]; decided: number[]; waiting: number[] }

export interface WorkSummary {
  as_of: string;
  /** "2025-12" … "2026-11": the last twelve calendar months, oldest first; the last one is the month so far */
  months: string[];
  files: Flow;
  scope: Flow;
  aging: { edges_days: number[]; files: number[]; scope: number[]; undated: { files: number; scope: number } };
  scope_totals: { controls: number; in_scope: number; out_of_scope: number; waiting: number; turned_down: number; no_request: number };
}

export interface ObservationLevel { key: string; label: string; terminal: boolean }

export interface ObservationSummary {
  total: number;
  open: number;
  deadlines: { overdue: number; due_30: number; later: number; paused: number; no_deadline: number };
  levels: ObservationLevel[];
  priorities: string[];
  by_priority: Record<string, Record<string, number>>;
  months: string[];
  opened: number[];
  closed: number[];
  regulators: Array<{ name: string | null; open: number; total: number }>;
}

// The shapes the chart kit takes, written out so this file needs none of its components (a structural match is enough).
export interface StackCat { key: string; label: string; cells: Record<string, number>; href?: string }
export interface TrendRowOf { label: string; [series: string]: string | number | null | undefined }
export interface BarRowOf { key: string; label: string; value: number; valueText?: string; color?: string; note?: string; href?: string }
export interface SliceOf { key: string; label: string; value: number; color?: string; href?: string }

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const word = (n: number, one: string, other: string): string => `${n} ${n === 1 ? one : other}`;

// ── the months ──────────────────────────────────────────────────────────────

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Dec 2025", "Jan 2026", "Feb", …: the year on the first month and on every January, so twelve labels are unique and read as a calendar. A key that is not "YYYY-MM" is kept as it is. */
export function monthLabels(keys: readonly string[]): string[] {
  return keys.map((key, i) => {
    const m = /^(\d{4})-(\d{2})$/.exec(key);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return key;
    const name = MONTH[Number(m[2]) - 1];
    return i === 0 || m[2] === '01' ? `${name} ${m[1]}` : name;
  });
}

const valid = (months: readonly string[], ...series: ReadonlyArray<readonly number[] | undefined>): boolean =>
  months.length > 0 && series.every((s) => Array.isArray(s) && s.length === months.length && s.every(finite));

const add = (a: readonly number[], b: readonly number[]): number[] => a.map((v, i) => v + (b[i] ?? 0));

/** Files and scope requests together, per month: raised and decided. null when the answer is not a full set of months (no history is not a row of zeros). */
export function flowRows(s: WorkSummary | null | undefined): TrendRowOf[] | null {
  if (!s || !valid(s.months, s.files?.sent, s.files?.decided, s.scope?.sent, s.scope?.decided)) return null;
  const sent = add(s.files.sent, s.scope.sent);
  const decided = add(s.files.decided, s.scope.decided);
  const labels = monthLabels(s.months);
  return labels.map((label, i) => ({ label, sent: sent[i], decided: decided[i] }));
}

/** True when anything was ever raised or decided in the twelve months: otherwise the chart says "No history yet". */
export const hasFlow = (rows: readonly TrendRowOf[] | null): boolean => !!rows && rows.some((r) => Number(r.sent) > 0 || Number(r.decided) > 0);

/** One part of one kind per month (files or scope requests; sent, decided or waiting: waiting is what waited at the end of each month, the last point is what waits now);
 *  null without a full set of months. */
export function kindSeries(s: WorkSummary | null | undefined, kind: 'files' | 'scope', part: keyof Flow): number[] | null {
  const series = s?.[kind]?.[part];
  return s && valid(s.months, series) ? (series as number[]) : null;
}

/** Files and scope requests together, one part per month. */
export function bothSeries(s: WorkSummary | null | undefined, part: keyof Flow): number[] | null {
  const a = kindSeries(s, 'files', part);
  const b = kindSeries(s, 'scope', part);
  return a && b ? add(a, b) : null;
}

export interface Tile { values: number[]; delta: ReturnType<typeof deltaOf>; summary: string }

/** The shape of a monthly series for a tile: the points, how the last two compare (words, arrow, tone: `goodWhen` says which way is good) and the trend in words. */
export function tileOf(months: readonly string[], values: readonly number[] | null, name: string, goodWhen?: 'up' | 'down', compare = true): Tile | null {
  if (!values || values.length !== months.length || values.length === 0) return null;
  const labels = monthLabels(months);
  const change: Change | null = compare ? changeOf(values) : null;
  return { values: values.slice(), delta: deltaOf(change, goodWhen), summary: trendText(name, values.map((value, i) => ({ label: labels[i], value }))) };
}

/** The two figures a flow tile prints: the month so far and the month before it. */
export function thisAndLast(values: readonly number[] | null): { now: number; before: number | null } | null {
  if (!values || values.length === 0 || !values.every(finite)) return null;
  return { now: values[values.length - 1], before: values.length > 1 ? values[values.length - 2] : null };
}

// ── what waits, by age ──────────────────────────────────────────────────────

/** The names of the age buckets the server cut at `edges` days ([7, 14, 30, 90]): "Under 7 days", "7-13 days", "14-29 days", "30-89 days", "90+ days". */
export function ageLabels(edges: readonly number[]): string[] {
  const cuts = edges.filter(finite);
  return [`Under ${cuts[0]} days`].concat(cuts.slice(1).map((c, i) => `${cuts[i]}-${c - 1} days`), [`${cuts[cuts.length - 1]}+ days`]);
}

/** The waiting files and scope requests by age, youngest first (a row per bucket; the bar of the oldest is the one to act on). null when the answer has no buckets. */
export function agingCategories(s: WorkSummary | null | undefined): StackCat[] | null {
  const a = s?.aging;
  if (!a || !Array.isArray(a.edges_days) || a.edges_days.length === 0 || a.files?.length !== a.edges_days.length + 1 || a.scope?.length !== a.edges_days.length + 1) return null;
  return ageLabels(a.edges_days).map((label, i) => ({ key: `age-${i}`, label, cells: { files: a.files[i], scope: a.scope[i] } }));
}

export const agingTotal = (cats: readonly StackCat[] | null): number => (cats ?? []).reduce((n, c) => n + c.cells.files + c.cells.scope, 0);

/** How long the oldest waiting item has waited, in whole days (never negative), and since when. The server lists the oldest first, so it is the first row. */
export function oldestWaiting(rows: readonly Pick<WorkRowPayload, 'since'>[] | null | undefined, now: Date = new Date()): { days: number; since: string } | null {
  const first = (rows ?? []).find((r) => !!r.since && !Number.isNaN(Date.parse(String(r.since))));
  if (!first || !first.since) return null;
  return { days: Math.max(0, Math.floor((now.getTime() - Date.parse(first.since)) / 86_400_000)), since: first.since };
}

/** The tone of a wait: from a month it is a warning, from three months a problem (the same cuts as the age buckets). */
export const waitTone = (days: number): 'default' | 'warning' | 'danger' => (days >= 90 ? 'danger' : days >= 30 ? 'warning' : 'default');

// ── the journeys ────────────────────────────────────────────────────────────

/** The files of each journey by decision, the journeys with the most waiting first; a journey with no file has nothing to show. `shown` of `withFiles` says when it was cut. */
export function journeyFiles(cards: readonly JourneyCard[], limit = 8): { categories: StackCat[]; shown: number; withFiles: number } {
  const withFiles = orderJourneys(cards).filter((c) => c.files.total > 0);
  const categories = withFiles.slice(0, Math.max(1, limit)).map((c) => ({
    key: String(c.id), label: c.name, href: journeyHref(c.id),
    cells: { approved: c.files.approved, rejected: c.files.rejected, pending: c.files.pending },
  }));
  return { categories, shown: categories.length, withFiles: withFiles.length };
}

export const FILE_SERIES = [
  { key: 'approved', label: 'Approved', color: STATUS.good },
  { key: 'rejected', label: 'Turned down', color: STATUS.bad },
  { key: 'pending', label: 'Waiting', color: STATUS.pending },
] as const;

/** "5 journeys: 3 in progress, 1 on hold, 1 completed": the journeys by where they stand, for a card's line of facts. */
export function journeyMix(cards: readonly JourneyCard[], label: (status: string | null) => string): string {
  const order: string[] = [];
  const counts = new Map<string, number>();
  cards.forEach((c) => { const l = label(c.status); if (!counts.has(l)) order.push(l); counts.set(l, (counts.get(l) ?? 0) + 1); });
  return `${word(cards.length, 'journey', 'journeys')}${order.length ? `: ${order.map((l) => `${counts.get(l)} ${l.toLowerCase()}`).join(', ')}` : ''}`;
}

// ── the requirements by scope state ─────────────────────────────────────────

/** Every requirement of the journeys' frameworks by where its scope decision stands. They add up to `controls`. */
export function scopeSlices(t: WorkSummary['scope_totals'] | null | undefined, cards: readonly JourneyCard[]): SliceOf[] | null {
  if (!t || ![t.controls, t.in_scope, t.out_of_scope, t.waiting, t.turned_down, t.no_request].every(finite)) return null;
  return [
    { key: 'in', label: 'In scope', value: t.in_scope, color: STATUS.good },
    { key: 'out', label: 'Out of scope', value: t.out_of_scope, color: STATUS.neutral },
    { key: 'waiting', label: 'Waiting for a decision', value: t.waiting, color: STATUS.pending, href: t.waiting > 0 ? counterTarget('scope', cards) : undefined },
    { key: 'down', label: 'Turned down', value: t.turned_down, color: STATUS.bad },
    { key: 'none', label: 'No request yet', value: t.no_request, color: OTHER },
  ];
}

// ── the observations ────────────────────────────────────────────────────────

const STATUTORY = '/auditor-portal/statutory-audit';

/** Observations by priority (rows, worst first) and status (columns, the organisation's own levels in order): the grid and where each cell opens the register. */
export function observationHeat(s: ObservationSummary | null | undefined, priorityLabel: (p: string) => string): {
  rows: string[]; cols: string[]; cells: number[][]; href: (row: number, col: number) => string; max: number;
} | null {
  if (!s || !Array.isArray(s.levels) || !Array.isArray(s.priorities) || !s.by_priority) return null;
  const cells = s.priorities.map((p) => s.levels.map((l) => s.by_priority[p]?.[l.key] ?? 0));
  return {
    rows: s.priorities.map(priorityLabel),
    cols: s.levels.map((l) => l.label),
    cells,
    href: (r, c) => `${STATUTORY}?priority=${encodeURIComponent(s.priorities[r])}&status=${encodeURIComponent(s.levels[c].key)}`,
    max: Math.max(0, ...cells.flat()),
  };
}

/** The open observations by where they stand against their due date or SLA, as the register's own chips read it. Overdue and "due in 30 days" open those chips. */
export function deadlineRows(s: ObservationSummary | null | undefined): BarRowOf[] | null {
  const d = s?.deadlines;
  if (!d || ![d.overdue, d.due_30, d.later, d.paused, d.no_deadline].every(finite)) return null;
  return [
    { key: 'overdue', label: 'Overdue', value: d.overdue, color: STATUS.bad, href: d.overdue > 0 ? `${STATUTORY}?quick=overdue` : undefined },
    { key: 'due30', label: 'Due in 30 days', value: d.due_30, color: STATUS.warn, href: d.due_30 > 0 ? `${STATUTORY}?quick=due30` : undefined },
    { key: 'later', label: 'Due later', value: d.later, color: STATUS.good },
    { key: 'paused', label: 'Clock paused', value: d.paused, color: STATUS.neutral, note: d.paused > 0 ? 'The status waits on someone else' : undefined },
    { key: 'none', label: 'No due date', value: d.no_deadline, color: STATUS.neutral },
  ];
}

/** Registered and closed observations per month. null without a full set of months. */
export function openedClosedRows(s: ObservationSummary | null | undefined): TrendRowOf[] | null {
  if (!s || !valid(s.months, s.opened, s.closed)) return null;
  return monthLabels(s.months).map((label, i) => ({ label, opened: s.opened[i], closed: s.closed[i] }));
}

/** The open observations by regulator: the six with most open, everything else in one "Other"; a regulator with none open is not a bar. Each opens the register on that regulator. */
export function regulatorRows(s: ObservationSummary | null | undefined, keep = 6): BarRowOf[] | null {
  if (!s || !Array.isArray(s.regulators)) return null;
  const rows = s.regulators.map((r, i) => ({ key: `r${i}`, label: r.name || 'No regulator', value: r.open, name: r.name, total: r.total }));
  const folded = foldTail(rows, keep);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return folded.map((f) => {
    const src = byKey.get(f.key);
    if (!src) return { key: f.key, label: f.label, value: f.value, color: OTHER };
    return {
      key: f.key, label: f.label, value: f.value, note: src.total > src.value ? `${src.total} in all` : undefined,
      href: `${STATUTORY}?regulator=${src.name ? encodeURIComponent(src.name) : 'none'}`,
    };
  });
}

/** Observations opened this month and closed this month, for the tile's line of facts. */
export function monthOfObservations(s: ObservationSummary | null | undefined): { opened: number; closed: number } | null {
  if (!s || !valid(s.months, s.opened, s.closed)) return null;
  return { opened: s.opened[s.opened.length - 1], closed: s.closed[s.closed.length - 1] };
}

// ── one journey's Summary tab (its queue counts, GET /auditor-portal/{id}/review-queue) ──────────────

/** The files of one journey by decision; each part with something in it opens the queue at that list (waiting is the files list, turned down and approved are in Decisions). */
export function journeyFileSlices(id: number, files: QueueCounts['files'] | null | undefined): SliceOf[] | null {
  if (!files || ![files.pending, files.approved, files.rejected].every(finite)) return null;
  return [
    { key: 'approved', label: 'Approved', value: files.approved, color: STATUS.good, href: files.approved > 0 ? journeyHref(id, { tab: 'decisions' }) : undefined },
    { key: 'rejected', label: 'Turned down', value: files.rejected, color: STATUS.bad, href: files.rejected > 0 ? journeyHref(id, { tab: 'decisions' }) : undefined },
    { key: 'pending', label: 'Waiting', value: files.pending, color: STATUS.pending, href: files.pending > 0 ? journeyHref(id) : undefined },
  ];
}

/** The requirements of one journey's framework by scope state: the requests (in scope, out of scope, waiting, turned down) and the requirements nobody has asked about. They add up to the requirements. */
export function journeyScopeSlices(id: number, counts: QueueCounts | null | undefined): SliceOf[] | null {
  const c = counts?.scope;
  if (!counts || !c || ![c.in_scope, c.out_of_scope, c.pending, c.rejected, counts.untouched].every(finite)) return null;
  return [
    { key: 'in', label: 'In scope', value: c.in_scope, color: STATUS.good },
    { key: 'out', label: 'Out of scope', value: c.out_of_scope, color: STATUS.neutral },
    { key: 'waiting', label: 'Waiting for a decision', value: c.pending, color: STATUS.pending, href: c.pending > 0 ? journeyHref(id, { kind: 'scope' }) : undefined },
    { key: 'down', label: 'Turned down', value: c.rejected, color: STATUS.bad },
    { key: 'none', label: 'No request yet', value: counts.untouched, color: OTHER, href: counts.untouched > 0 ? journeyHref(id, { kind: 'untouched' }) : undefined },
  ];
}
