// The Mitigation actions register's rules, apart from React (`node --test src/lib/erm/mitigation.test.ts`). The status VALUES are the server's and the workflow engine's
// (open, in_progress, completed, overdue, cancelled; `_created`, `_completed` and `_overdue` events read the URLs, the `status` and `due_date` columns): none is renamed here.
// "Overdue" is a derived chip, never a status the page sets.
import { parseUtc } from '../serverTime.ts';

export const ACTION_STATUSES = ['open', 'in_progress', 'completed', 'overdue', 'cancelled'] as const;
export const ACTION_TYPES = ['mitigate', 'transfer', 'avoid', 'accept'] as const;
export const ACTION_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
/** What the edit form may set: completing goes through "Mark complete" (it stamps the completion date), and "overdue" is derived. */
export const SETTABLE_STATUSES = ['open', 'in_progress', 'cancelled'] as const;

export interface ActionLike { status?: string | null; due_date?: string | null; completed_at?: string | null; expected_residual_reduction?: number | null; actual_residual_reduction?: number | null }

/** Still to do: open, in progress, or flagged overdue. */
export const isOpenAction = (a: ActionLike): boolean => a.status === 'open' || a.status === 'in_progress' || a.status === 'overdue';

/**
 * Overdue, by the rule the Overview scores timeliness with (dashboard.py): an action still to do whose status says overdue or whose due date has passed. The server's own
 * /overdue list stops at open and in-progress; this also keeps the ones a workflow flagged. A due date is a day stored at midnight: it is overdue from that midnight.
 */
export function isOverdueAction(a: ActionLike, now: Date = new Date()): boolean {
  if (!isOpenAction(a)) return false;
  if (a.status === 'overdue') return true;
  const due = parseUtc(a.due_date ?? undefined);
  return !!due && due.getTime() < now.getTime();
}

/** The word a row shows: the stored status, except that an open or in-progress action past its date reads "overdue". */
export const shownStatus = (a: ActionLike, now: Date = new Date()): string => (isOverdueAction(a, now) && a.status !== 'overdue' ? 'overdue' : a.status || 'open');

export interface ActionTiles { total: number; open: number; overdue: number; completedThisMonth: number }

export function actionTiles(actions: readonly ActionLike[], now: Date = new Date()): ActionTiles {
  let open = 0;
  let overdue = 0;
  let completedThisMonth = 0;
  actions.forEach((a) => {
    if (a.status === 'open' || a.status === 'in_progress') open += 1;
    if (isOverdueAction(a, now)) overdue += 1;
    const done = parseUtc(a.completed_at ?? undefined);
    if (a.status === 'completed' && done && done.getFullYear() === now.getFullYear() && done.getMonth() === now.getMonth()) completedThisMonth += 1;
  });
  return { total: actions.length, open, overdue, completedThisMonth };
}

/**
 * What POST /erm/mitigation-actions/{id}/complete takes: the achieved reduction as the QUERY parameter `actual_reduction` (the route has no body model; sending it in the
 * body, as the page did, was ignored and "Treatment effectiveness" on the Overview could never be filled). null when the person left it empty: nothing is sent.
 */
export function completeParams(actualReduction: number | null | undefined): { actual_reduction: number } | undefined {
  return typeof actualReduction === 'number' && Number.isFinite(actualReduction) ? { actual_reduction: actualReduction } : undefined;
}

/** "70% of 80%" in the row, "—" when neither is recorded. */
export function reductionWords(a: ActionLike): string {
  const exp = a.expected_residual_reduction;
  const act = a.actual_residual_reduction;
  const f = (n: number) => `${Math.round(n * 10) / 10}%`;
  if (typeof exp === 'number' && typeof act === 'number') return `${f(act)} of ${f(exp)}`;
  if (typeof exp === 'number') return `${f(exp)} expected`;
  if (typeof act === 'number') return `${f(act)} achieved`;
  return '—';
}

/** Whole percent 0-100 or null: the form's reduction field. */
export function parseReduction(raw: string): number | null | undefined {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
}
