// My work, apart from React so `node --test` pins it (taskWork.test.ts): which of the tasks a person has are THEIR work, the five numbers of the band (each with the address of All tasks
// that shows exactly those tasks), the order of "Do next", one task as a worklist row with its single next step, and the person's load. It is built on taskRecord.ts, the model every Task
// Management screen shares, and on the register's own rules (taskFacets.ts), so "overdue", "mine" and "to approve" are the same tasks here and in All tasks: a test applies the register's
// rules to the same fixture and compares the counts. Nothing here decides who may do what: the server does; where a rule copies it (who may approve) taskRecord.ts says so.
import { isDocumentTask, taskButtons } from '../../../../lib/documentTasks.ts';
import { norm, statusPill, type Tone } from '../../../../lib/status.ts';
import { taskPriority, taskStatus } from '../../../../lib/statuses/tasks.ts';
import { priorityValue } from '../_register/taskFacets.ts';
import { dueBucket, dueMoment, isDoneStatus, isMyWork, isOverdue, kindOf, nextStep, waitingFor, type NextStep, type RegisterTask } from '../taskRecord.ts';
import { PRIORITIES, recentlyCompleted } from '../tasksModel.ts';
import { tasksHref } from '../taskTabs.ts';

const DAY = 86_400_000;

// ── the person's tasks ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The lists the three requests answered (the tasks the person is on, reviews and made), joined by id: a task they are on AND review is one task. */
export function joinWork(lists: ReadonlyArray<readonly RegisterTask[]>): RegisterTask[] {
  const seen = new Map<number, RegisterTask>();
  lists.forEach((list) => list.forEach((t) => { if (!seen.has(t.id)) seen.set(t.id, t); }));
  return Array.from(seen.values());
}

/** Open and the person's: they are on it or review it, and it is not finished (the register's Mine view). */
export const isOpenMine = (t: RegisterTask, me: number | null): boolean => !isDoneStatus(t.status) && isMyWork(t, me);

/** The person is the one to decide on it: the task waits for an approval and they are its reviewer (and not its owner). It stays theirs when the task is Completed and waits to be Verified. */
export const waitsForMyDecision = (t: RegisterTask, me: number | null): boolean => nextStep(t, me)?.id === 'approve';

/** In "Do next": open work of theirs, and the decisions asked of them. */
export const isWork = (t: RegisterTask, me: number | null): boolean => isOpenMine(t, me) || waitsForMyDecision(t, me);

// ── the band ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type CounterKey = 'overdue' | 'week' | 'approve' | 'open' | 'created';
export interface Counter { key: CounterKey; label: string; value: number; /** All tasks, filtered to exactly the tasks counted */ href: string; tone: Tone }

/**
 * The five numbers. Each one is a link into All tasks whose address shows those very tasks (taskWork.test.ts holds the two together): Overdue is the server's Breached among the open work,
 * Due this week is today and the next seven days, To approve the tasks whose next step for the person is Approve, Open the open work, Created by me every task they made.
 */
export function countersOf(rows: readonly RegisterTask[], me: number | null, now: Date): Counter[] {
  const open = rows.filter((t) => isOpenMine(t, me));
  const bucketIn = (...buckets: string[]) => open.filter((t) => buckets.indexOf(dueBucket(t, now)) >= 0).length;
  return [
    { key: 'overdue', label: 'Overdue', value: bucketIn('overdue'), href: tasksHref('all', { quick: 'mine', due: ['overdue'] }), tone: 'danger' },
    { key: 'week', label: 'Due this week', value: bucketIn('today', 'week'), href: tasksHref('all', { quick: 'mine', due: ['today', 'week'] }), tone: 'warning' },
    { key: 'approve', label: 'To approve', value: rows.filter((t) => waitsForMyDecision(t, me)).length, href: tasksHref('all', { quick: 'approve' }), tone: 'pending' },
    { key: 'open', label: 'Open', value: open.length, href: tasksHref('all', { quick: 'mine' }), tone: 'neutral' },
    { key: 'created', label: 'Created by me', value: rows.filter((t) => me != null && t.created_by_id === me).length, href: tasksHref('all', { quick: 'created' }), tone: 'neutral' },
  ];
}

// ── the load ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Load {
  open: number;
  /** the open work by priority, Critical to Low; "Other" (no link: it is not one value of the register's Priority) only when a task carries another word */
  byPriority: Array<{ word: string; count: number; href: string | null }>;
  /** the person's tasks finished in the last 30 days */
  done30: number;
}

export function loadOf(rows: readonly RegisterTask[], me: number | null, now: Date): Load {
  const open = rows.filter((t) => isOpenMine(t, me));
  const byPriority = PRIORITIES.map((word) => ({
    word, count: open.filter((t) => priorityValue(t.priority) === word).length, href: tasksHref('all', { quick: 'mine', priority: [word] }) as string | null,
  }));
  const other = open.length - byPriority.reduce((n, p) => n + p.count, 0);
  if (other > 0) byPriority.push({ word: 'Other', count: other, href: null });
  const since = now.getTime() - 30 * DAY;
  const done30 = rows.filter((t) => isDoneStatus(t.status) && isMyWork(t, me) && (dueMoment(t.completed_at)?.getTime() ?? -Infinity) >= since).length;
  return { open: open.length, byPriority, done30 };
}

/** The latest ten tasks the person finished (the ones My Tasks listed, in the order it should have: the most recently completed first). */
export const recentDone = (rows: readonly RegisterTask[], me: number | null, shown = 10): RegisterTask[] =>
  recentlyCompleted(rows.filter((t) => isDoneStatus(t.status) && isMyWork(t, me)), shown);

// ── Do next ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const rankOf = (word: string): number => { const i = PRIORITIES.map(norm).indexOf(norm(word)); return i < 0 ? PRIORITIES.length : i; };

/**
 * The person's work in the order they should do it: what is late first (the longest late first), then what waits for their decision, then what is due (the soonest first), then what has
 * no date; inside each, the more severe priority first, then the newer task. A total order, so the list never jumps between refreshes.
 */
export function orderWork(rows: readonly RegisterTask[], me: number | null, now: Date): RegisterTask[] {
  const key = (t: RegisterTask): [number, number, number, number] => {
    const due = dueMoment(t.due_date)?.getTime() ?? Infinity;
    const group = dueBucket(t, now) === 'overdue' ? 0 : waitsForMyDecision(t, me) ? 1 : due === Infinity ? 3 : 2;
    return [group, due, rankOf(t.priority), -t.id];
  };
  return rows.filter((t) => isWork(t, me)).map((t) => ({ t, k: key(t) })).sort((a, b) => {
    for (let i = 0; i < 4; i += 1) { if (a.k[i] !== b.k[i]) return a.k[i] < b.k[i] ? -1 : 1; }
    return 0;
  }).map((x) => x.t);
}

export interface DoNextRow {
  id: number;
  title: string;
  href: string;
  kind: { label: string; tone: Tone };
  /** "High priority · Vendor finding · Remediation · 2 of 5 sub-tasks", then why there is no button when there is none */
  context: string;
  requester?: { name: string; role: string };
  due: string | null;
  overdue: boolean;
  /** the ONE thing to press: a step (a request to the server) or a link (a document request's own step); none when nothing is the person's to press */
  action: { label: string; step?: NextStep; href?: string } | null;
}

/** What the row's pill says: To approve when the decision is theirs, Document request, else the status in words. */
function kindPill(t: RegisterTask, me: number | null): { label: string; tone: Tone } {
  if (waitsForMyDecision(t, me)) return { label: 'To approve', tone: 'pending' };
  if (kindOf(t) === 'document') return { label: 'Document', tone: 'progress' };          // the pill column is narrow: the title says what is asked
  return statusPill(taskStatus, t.status);
}

export function rowOf(t: RegisterTask, me: number | null, now: Date): DoNextRow {
  const kind = kindPill(t, me);
  const step = nextStep(t, me);
  const own = isDocumentTask(t) ? taskButtons(t.document_request, me).filter((b) => b.primary)[0] : undefined;
  const action: DoNextRow['action'] = own ? { label: own.label, href: own.href } : step ? { label: step.label, step } : null;
  const priority = t.priority ? `${statusPill(taskPriority, priorityValue(t.priority)).label} priority` : null;
  const from = t.source_label && t.source_label !== kind.label ? t.source_label : null;
  const progress = t.sub_task_total ? `${t.sub_task_done ?? 0} of ${t.sub_task_total} sub-tasks` : null;
  const why = action ? null : waitingFor(t, me);
  const asker = waitsForMyDecision(t, me) ? t.assigned_owner : null;          // who asks for a decision is the news; who made an ordinary task is on its page (a worklist row has no room for it)
  return {
    id: t.id,
    title: t.title,
    href: `/tasks/${t.id}`,
    kind,
    context: [priority, from, t.category || null, progress, why].filter(Boolean).join(' · '),
    requester: asker?.display_name && asker.id !== me ? { name: asker.display_name, role: 'Asked by' } : undefined,
    due: t.due_date,
    overdue: isOverdue(t, now),
    action,
  };
}

/** Why the list has no rows: the person has no task at all ("none"), or everything they have is finished ("caught-up"); null while there is work. */
export function emptyKind(rows: readonly RegisterTask[], me: number | null): 'none' | 'caught-up' | null {
  if (rows.some((t) => isWork(t, me))) return null;
  return rows.some((t) => isMyWork(t, me)) ? 'caught-up' : 'none';
}
