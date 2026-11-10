// The Actions tab of an issue, apart from React (actionsModel.test.ts): the corrective actions in the order a person works them, the form's starting values and what it sends, and the line that
// says how far the work has got. The status rules (which step follows which, what is late) are lib/issues/words.ts; the call shapes are the ones the corrective-action register already sends.
import { isActionLate, isOpenAction } from '../../../../../lib/issues/words.ts';

/** A row of GET /issue-management/issues/{id}/actions. */
export interface IssueActionRow {
  id: number;
  issue_id: number;
  action_type?: string | null;
  title: string;
  description?: string | null;
  assignee_id?: number | null;
  assignee_name?: string | null;
  due_date?: string | null;
  status?: string | null;
  completed_at?: string | null;
  verified_by_name?: string | null;
  verified_at?: string | null;
  effectiveness_review_at?: string | null;
  linked_critical_task_id?: number | null;
  created_at?: string | null;
}

const ms = (iso?: string | null): number => {
  const t = iso ? Date.parse(iso.length === 10 ? `${iso}T00:00:00Z` : iso.endsWith('Z') || /[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`) : NaN;
  return Number.isNaN(t) ? Infinity : t;
};

/** Work still to do first (the soonest due first, no date last), then what is done; ties keep the order they were added. */
export function orderActions(rows: readonly IssueActionRow[]): IssueActionRow[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const open = Number(isOpenAction(b.row.status)) - Number(isOpenAction(a.row.status));
      if (open) return open;
      const due = isOpenAction(a.row.status) ? ms(a.row.due_date) - ms(b.row.due_date) : 0;
      return (Number.isNaN(due) ? 0 : due) || a.index - b.index;
    })
    .map((x) => x.row);
}

export interface ActionSummary { total: number; done: number; open: number; late: number }
export function summarize(rows: readonly IssueActionRow[], now: Date = new Date()): ActionSummary {
  return {
    total: rows.length,
    done: rows.filter((a) => a.status === 'completed' || a.status === 'verified').length,
    open: rows.filter((a) => isOpenAction(a.status)).length,
    late: rows.filter((a) => isActionLate(a.status, a.due_date, now)).length,
  };
}
/** "2 of 5 done · 1 late", or null when there are no actions. */
export function summaryLine(s: ActionSummary): string | null {
  if (s.total === 0) return null;
  return [`${s.done} of ${s.total} done`, s.late > 0 ? `${s.late} late` : null].filter(Boolean).join(' · ');
}

export interface ActionDraft { title: string; type: string; due: string; assignee: string | null; notes: string }
export const TITLE_MAX = 255;

export const draftOf = (a: IssueActionRow | null): ActionDraft => ({
  title: a?.title ?? '', type: a?.action_type || 'corrective', due: a?.due_date ? a.due_date.slice(0, 10) : '',
  assignee: a?.assignee_id ? String(a.assignee_id) : null, notes: a?.description ?? '',
});
export const isDirty = (opened: ActionDraft, now: ActionDraft): boolean => (Object.keys(opened) as Array<keyof ActionDraft>).some((k) => opened[k] !== now[k]);
export function actionErrors(d: ActionDraft): { title?: string } {
  if (!d.title.trim()) return { title: 'Enter what has to be done.' };
  return d.title.trim().length > TITLE_MAX ? { title: `Keep it under ${TITLE_MAX} characters.` } : {};
}

/** The body of POST /issues/{id}/actions (a new action leaves out what is empty) or PATCH /actions/{id} (an edit clears what was emptied with null). The due date is a day. */
export function actionBody(d: ActionDraft, isNew: boolean): Record<string, unknown> {
  return {
    title: d.title.trim(),
    action_type: d.type,
    description: d.notes,
    assignee_id: d.assignee ? Number(d.assignee) : (isNew ? undefined : null),
    due_date: d.due || (isNew ? undefined : null),
  };
}
