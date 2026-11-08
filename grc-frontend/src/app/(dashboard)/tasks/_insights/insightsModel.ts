// The numbers of the Task Management Insights tab (the "Reports" tab), apart from React so `node --test` pins them (insightsModel.test.ts). They are the numbers `GET critical-tasks/reports/summary`
// has always answered, worked out HERE from the lean list the register loads (the same tasks the person may see), so that
//   - a number on the tab is exactly the count of the All tasks address it links to (insightsLinks.ts, and a test that applies the register's own rules to the same rows),
//   - "Include document requests" can be switched off (the server's summary could not be asked that), and
//   - every formula is one small function with its own test instead of 40 queries and three loops.
// The formulas are the server's (`reports_summary` in routers/critical_tasks_router.py); the notes name each one and a test re-reads the router, so a change there fails a test until this file is
// looked at. Three things differ on purpose, each said where it happens: the workload counts EVERY person on a task (the server counted the first owner), the trend says its year, and a status or
// priority is counted by its canonical word ("in progress" and "In Progress" are one bar). Nothing here decides who may do what: the server decides which tasks the person gets.
import { norm } from '../../../../lib/status.ts';
import { taskPriority, taskStatus } from '../../../../lib/statuses/tasks.ts';
import { NONE, peopleNames, priorityValue, statusValue } from '../_register/taskFacets.ts';
import { PRIORITIES, STATUSES } from '../tasksModel.ts';
import { dueMoment, isDoneStatus, kindOf, peopleOf, type RegisterTask } from '../taskRecord.ts';

const DAY = 86_400_000;
export const GONE = 'Someone no longer here';
export const NOT_SET_WORD = 'Not set';

// ── the tasks the numbers are of ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The document requests among the tasks: what "Include document requests" is about (a task a document review or acknowledgement raised for a person). */
export const isDocumentRequest = (t: RegisterTask): boolean => kindOf(t) === 'document';
export const documentCount = (rows: readonly RegisterTask[]): number => rows.filter(isDocumentRequest).length;

/** The tasks the tab counts: all of them (today's numbers), or without the document requests. */
export const countedRows = (rows: readonly RegisterTask[], includeDocuments: boolean): RegisterTask[] => (includeDocuments ? rows.slice() : rows.filter((t) => !isDocumentRequest(t)));

// ── rounding ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Python's `round(x, 1)`, which the server used for both rates: the nearest tenth of the exact value, and an exact tie (x.25, x.75: the only ones a double holds) goes to the even tenth, so 6.25 is 6.2
 *  where `toFixed` would say 6.3. */
export function round1(x: number): number {
  const quarters = x * 4;
  if (Number.isInteger(quarters) && quarters % 2 !== 0) {
    const tenths = Math.floor(x * 10);
    return (tenths % 2 === 0 ? tenths : tenths + 1) / 10;
  }
  return Number(x.toFixed(1));
}

/** A share of a total as a percent for a bar (0 when there is no total): not rounded, the bar is a picture and the count is beside it. */
export const share = (count: number, total: number): number => (total > 0 ? (count / total) * 100 : 0);

// ── the words of a group ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface CountRow {
  /** the value the register's facet knows it by (a status word, `none` for "not set") */
  key: string;
  label: string;
  count: number;
  /** the share of the total (workload: of the busiest) */
  percent: number;
}

const byCount = (a: { count: number; label: string }, b: { count: number; label: string }) => b.count - a.count || a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });

function tally<T>(rows: readonly T[], keyOf: (t: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  rows.forEach((t) => { const k = keyOf(t); counts.set(k, (counts.get(k) ?? 0) + 1); });
  return counts;
}

/** The groups of a word that has a workflow order (status, priority): the words of `order` first in that order, then any other word the tasks hold, most first. */
function ordered(counts: Map<string, number>, total: number, order: readonly string[], label: (word: string) => string): CountRow[] {
  const rank = (word: string): number => { const at = order.map(norm).indexOf(norm(word)); return at < 0 ? order.length : at; };
  return Array.from(counts.keys())
    .map((key) => ({ key, label: label(key), count: counts.get(key) ?? 0, percent: share(counts.get(key) ?? 0, total) }))
    .sort((a, b) => rank(a.key) - rank(b.key) || byCount(a, b));
}

/** The groups of a free word (source, category): most first; a task with no word is "Not set" (key `none`, the register's own). */
function plain(counts: Map<string, number>, total: number): CountRow[] {
  return Array.from(counts.keys())
    .map((key) => ({ key, label: key === NONE ? NOT_SET_WORD : key, count: counts.get(key) ?? 0, percent: share(counts.get(key) ?? 0, total) }))
    .sort(byCount);
}

// ── the numbers ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** `due < now` and not done: the server's `overdue` (and the register's Overdue, which is its Breached). */
export function isOverdueNow(t: RegisterTask, now: Date): boolean {
  const due = dueMoment(t.due_date);
  return !isDoneStatus(t.status) && due != null && due.getTime() < now.getTime();
}

export const AGING = ['0-7 days', '8-14 days', '15-30 days', '30+ days'] as const;
/** Which bucket an overdue task is in: whole days since its due moment, 7 or fewer, 14, 30, more (`(now - due).days` of the server). */
export function agingBucket(due: Date, now: Date): (typeof AGING)[number] {
  const days = Math.floor((now.getTime() - due.getTime()) / DAY);
  return days <= 7 ? AGING[0] : days <= 14 ? AGING[1] : days <= 30 ? AGING[2] : AGING[3];
}

/** Of the tasks WITH a due date: how many were finished by it, or are still open and not yet due (the server's `sla_met` / `sla_total`). A task done with no completion moment is not met. */
export function slaCounts(rows: readonly RegisterTask[], now: Date): { met: number; total: number } {
  let met = 0;
  let total = 0;
  rows.forEach((t) => {
    const due = dueMoment(t.due_date);
    if (!due) return;
    total += 1;
    if (isDoneStatus(t.status)) {
      const finished = dueMoment(t.completed_at);
      if (finished && finished.getTime() <= due.getTime()) met += 1;
    } else if (due.getTime() >= now.getTime()) met += 1;
  });
  return { met, total };
}

export interface SourceRate { key: string; label: string; total: number; completed: number; rate: number }

/** Per source: how many tasks, how many are done and the rate (one decimal), most tasks first. */
export function completionBySource(rows: readonly RegisterTask[]): SourceRate[] {
  const groups = new Map<string, { total: number; completed: number }>();
  rows.forEach((t) => {
    const key = t.source || NONE;
    const g = groups.get(key) ?? { total: 0, completed: 0 };
    g.total += 1;
    if (isDoneStatus(t.status)) g.completed += 1;
    groups.set(key, g);
  });
  return Array.from(groups.keys())
    .map((key) => { const g = groups.get(key) as { total: number; completed: number }; return { key, label: key === NONE ? NOT_SET_WORD : key, total: g.total, completed: g.completed, rate: g.total > 0 ? round1((g.completed / g.total) * 100) : 0 }; })
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

/** The open tasks of each person, most first, each as a share of the busiest. A task counts for EVERY person on it (the Owner facet's and My work's rule; the server counted its first owner, which
 *  is the same for a task with one owner). People are told apart by id, so two people with one name are two rows. */
export function workloadOf(rows: readonly RegisterTask[]): CountRow[] {
  const names = peopleNames(rows);
  const open = new Map<string, number>();
  rows.forEach((t) => { if (!isDoneStatus(t.status)) peopleOf(t).forEach((id) => open.set(String(id), (open.get(String(id)) ?? 0) + 1)); });
  const busiest = Math.max(0, ...Array.from(open.values()));
  return Array.from(open.keys())
    .map((key) => ({ key, label: names.get(Number(key)) ?? GONE, count: open.get(key) ?? 0, percent: share(open.get(key) ?? 0, busiest) }))
    .sort(byCount);
}

// ── the trend ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Month { key: string; /** "Mar" */ short: string; year: number; /** "Mar 2026" */ label: string; created: number; completed: number }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** The twelve calendar months ending with the one `now` is in (UTC, as the server's clock is): tasks created and tasks completed in each. The first of a month is never skipped (the server once stepped
 *  back 30 days at a time, so in March February had no bar); the current month ends at `now`. */
export function trendOf(rows: readonly RegisterTask[], now: Date): Month[] {
  const out: Month[] = [];
  const at = (value: string | null): number | null => dueMoment(value)?.getTime() ?? null;
  const created = rows.map((t) => at(t.created_at));
  const completed = rows.map((t) => at(t.completed_at));
  for (let back = 11; back >= 0; back -= 1) {
    const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1);
    const end = back === 0 ? now.getTime() : Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back + 1, 1);
    const inside = (ms: number | null) => ms != null && ms >= start && ms < end;
    const d = new Date(start);
    out.push({
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      short: MONTHS[d.getUTCMonth()],
      year: d.getUTCFullYear(),
      label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
      created: created.filter(inside).length,
      completed: completed.filter(inside).length,
    });
  }
  return out;
}

// ── everything ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Insights {
  total: number;
  /** Completed and Verified */
  done: number;
  /** total - done */
  active: number;
  overdue: number;
  /** done / total, one decimal; 0 with no tasks */
  completionRate: number;
  slaCompliance: number;
  slaMet: number;
  slaTotal: number;
  byStatus: CountRow[];
  byPriority: CountRow[];
  bySource: CountRow[];
  byCategory: CountRow[];
  aging: Array<{ label: string; count: number; percent: number }>;
  completionBySource: SourceRate[];
  workload: CountRow[];
  trend: Month[];
}

/** Every number of the tab, over exactly the tasks given (the caller leaves out the document requests when the switch is off). */
export function insightsOf(rows: readonly RegisterTask[], now: Date): Insights {
  const total = rows.length;
  const done = rows.filter((t) => isDoneStatus(t.status)).length;
  const late = rows.filter((t) => isOverdueNow(t, now));
  const aging = AGING.map((label) => ({ label, count: late.filter((t) => agingBucket(dueMoment(t.due_date) as Date, now) === label).length, percent: 0 }));
  aging.forEach((a) => { a.percent = share(a.count, late.length); });
  const sla = slaCounts(rows, now);
  return {
    total,
    done,
    active: total - done,
    overdue: late.length,
    completionRate: total > 0 ? round1((done / total) * 100) : 0,
    slaCompliance: sla.total > 0 ? round1((sla.met / sla.total) * 100) : 0,
    slaMet: sla.met,
    slaTotal: sla.total,
    byStatus: ordered(tally(rows, (t) => statusValue(t.status)), total, STATUSES, (w) => (w === NONE ? NOT_SET_WORD : taskStatus.label(w))),
    byPriority: ordered(tally(rows, (t) => priorityValue(t.priority)), total, PRIORITIES, (w) => (w === NONE ? NOT_SET_WORD : taskPriority.label(w))),
    bySource: plain(tally(rows, (t) => t.source || NONE), total),
    byCategory: plain(tally(rows, (t) => t.category || NONE), total),
    aging,
    completionBySource: completionBySource(rows),
    workload: workloadOf(rows),
    trend: trendOf(rows, now),
  };
}
