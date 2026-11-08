// A supplier's planned actions as the module reads them, apart from React so `node --test` pins them (actionsModel.test.ts): the shapes of the answer, how a due date is said, and the
// words of the Planned actions page. `actions/shared.tsx` re-exports the types and the words for the vendor record's action plan.
import { formatDate, formatRelative } from '../../../../../lib/format.ts';
import { errorMessage } from '../../../../../components/ui/ds/reportOutcome.ts';

export type ActionKind = 'todo' | 'questionnaire' | 'checkin' | 'reassessment';
export type ActionStatus = 'scheduled' | 'done' | 'failed' | 'cancelled';
export interface ActionItem {
  id: number; vendor: { id: number; name: string | null }; kind: ActionKind; kind_label: string; title: string;
  note: string | null; due_on: string; status: ActionStatus; overdue_days: number; assignee_ids: number[];
  people: Array<{ id: number; name: string | null }>; template_id: number | null; result: string | null;
  result_link: string | null; done_at: string | null; done_by: string | null; created_by: string | null;
  created_at: string; automatic: boolean;
  /** A questionnaire or reassessment for one engagement; null: General. */
  engagement?: { id: number; name: string | null } | null;
}

/** The kinds that can be for one of the supplier's engagements. */
export const FOR_ENGAGEMENT: ActionKind[] = ['questionnaire', 'reassessment'];

export type ActionState = 'open' | 'due' | 'failed' | 'done';
export const STATES: ReadonlyArray<{ value: ActionState; label: string }> = [
  { value: 'due', label: 'Due now' }, { value: 'open', label: 'All planned' }, { value: 'failed', label: 'Could not happen' }, { value: 'done', label: 'Done' },
];

/** The words of the state buttons, with the two counts the server gives ("Due now 3"). */
export function stateOptions(counts?: { due: number; failed: number } | null): Array<{ value: ActionState; label: string }> {
  return STATES.map((s) => {
    const n = counts && (s.value === 'due' ? counts.due : s.value === 'failed' ? counts.failed : 0);
    return n ? { value: s.value, label: `${s.label} ${n.toLocaleString('en-US')}` } : { ...s };
  });
}

/** "12 Nov 2026 · in 3 days" while it is planned (the day it is due, in words); just the day once it is done, failed or cancelled. */
export function whenLabel(item: Pick<ActionItem, 'due_on' | 'status'>, today: Date = new Date()): string {
  const date = formatDate(item.due_on, { calendar: true });
  if (item.status !== 'scheduled') return date;
  const relative = formatRelative(item.due_on, today, { calendar: true });
  return relative ? `${date} · ${relative.replace(/ ago$/, ' overdue')}` : date;
}

/** What the server said about a failure, in plain words, else `fallback`. */
export const errText = (e: unknown, fallback: string): string => errorMessage(e, fallback);

/** The empty-list sentence of each state. */
export const EMPTY: Record<ActionState, string> = {
  due: 'Nothing is due now.',
  open: 'Nothing is planned.',
  failed: 'Everything planned has happened.',
  done: 'Nothing has been done yet.',
};
