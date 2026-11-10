// The corrective-action register's definition (facets, quick chips, sorts, board), apart from React (`actionDef.test.ts`). The rows are GET /issue-management/actions (read whole,
// each with the code and title of its issue). The chips use the words.ts rules against the frame's `now`: an action is late when it is still open and past its due date.
import { buildSchema, type RegisterDef } from '../../components/records/registerModel.ts';
import { parseUtc } from '../serverTime.ts';
import { actionStatus, actionType } from '../statuses/issues.ts';
import { ACTION_STATUSES, ACTION_STATUS_OPTIONS, ACTION_TYPE_OPTIONS, awaitsVerification, daysLate, isActionLate, isOpenAction } from './words.ts';

export interface ActionRow {
  id: number;
  issue_id: number;
  issue_code?: string | null;
  issue_title?: string | null;
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
  overdue?: boolean;
  overdue_days?: number | null;
}

const NONE = 'none';
const ms = (iso?: string | null): number | null => parseUtc(iso)?.getTime() ?? null;
export const statusOf = (a: ActionRow): string => a.status || 'planned';
export const openAction = (a: ActionRow): boolean => isOpenAction(a.status);
export const isActionOverdue = (a: ActionRow, now: Date): boolean => isActionLate(a.status, a.due_date, now);
export const actionLateDays = (a: ActionRow, now: Date): number | null => (isActionOverdue(a, now) ? daysLate(a.due_date, now) : null);
/** "ISS-41 Unpatched gateway": the issue an action belongs to, as one line. */
export const issueLine = (a: ActionRow): string => [a.issue_code || `ISS-${a.issue_id}`, a.issue_title].filter(Boolean).join(' ');
/** An action that became a task is run from Task Management: the task's status flows back to it, so the register offers no status buttons for it. */
export const isManagedInTasks = (a: ActionRow): boolean => !!a.linked_critical_task_id;

export interface ActionCounts { total: number; open: number; late: number; verify: number }
export function actionCounts(rows: readonly ActionRow[], now: Date): ActionCounts {
  return { total: rows.length, open: rows.filter(openAction).length, late: rows.filter((a) => isActionOverdue(a, now)).length, verify: rows.filter((a) => awaitsVerification(a.status)).length };
}

export function actionDef(me: number | null): RegisterDef<ActionRow> {
  return {
    key: 'action',
    noun: { one: 'action', other: 'actions' },
    idOf: (a) => a.id,
    text: (a) => [a.title, a.issue_code, a.issue_title, a.assignee_name, a.description].filter(Boolean).join(' '),
    facets: [
      { key: 'status', label: 'Status', defaultOpen: true, values: (a) => [statusOf(a)], options: () => ACTION_STATUS_OPTIONS },
      { key: 'type', label: 'Type', defaultOpen: true, values: (a) => [a.action_type || NONE], options: () => ACTION_TYPE_OPTIONS },
      {
        key: 'assignee', label: 'Assigned to', searchable: true, limit: 7,
        values: (a) => [a.assignee_id ? String(a.assignee_id) : NONE],
        options: (rows) => {
          const seen = new Map<string, string>();
          rows.forEach((a) => { if (a.assignee_id) seen.set(String(a.assignee_id), a.assignee_name || `User ${a.assignee_id}`); });
          const list = Array.from(seen.entries()).sort((x, y) => x[1].localeCompare(y[1])).map(([value, label]) => ({ value, label }));
          return rows.some((a) => !a.assignee_id) ? list.concat({ value: NONE, label: 'Unassigned' }) : list;
        },
      },
      {
        key: 'issue', label: 'Issue', searchable: true, limit: 7, values: (a) => [String(a.issue_id)],
        options: (rows) => {
          const seen = new Map<string, string>();
          rows.forEach((a) => seen.set(String(a.issue_id), issueLine(a)));
          return Array.from(seen.entries()).sort((x, y) => x[1].localeCompare(y[1], 'en', { numeric: true })).map(([value, label]) => ({ value, label }));
        },
      },
    ],
    quick: [
      { key: 'open', label: 'Open', test: (a) => openAction(a), title: 'Planned, in progress or blocked' },
      ...(me != null ? [{ key: 'mine', label: 'Mine', test: (a: ActionRow) => openAction(a) && a.assignee_id === me, title: 'Open and assigned to you' }] : []),
      { key: 'late', label: 'Late', test: (a, now) => isActionOverdue(a, now), title: 'Still open and past its due date: the scorecard counts the same ones' },
      { key: 'verify', label: 'Awaiting verification', test: (a) => awaitsVerification(a.status), title: 'Completed, waiting for someone to confirm it worked' },
      { key: 'unassigned', label: 'Unassigned', test: (a) => openAction(a) && !a.assignee_id, title: 'Open and nobody is assigned' },
      { key: 'tasks', label: 'In Task Management', test: (a) => isManagedInTasks(a), title: 'Promoted to a task: its status is kept there' },
    ],
    sorts: [
      { key: 'attention', label: 'Needs attention first', firstDir: 'asc', value: (a) => (openAction(a) ? ms(a.due_date) ?? 8e15 : 9e15) },
      { key: 'due', label: 'Due date', firstDir: 'asc', value: (a) => ms(a.due_date) },
      { key: 'status', label: 'Status', firstDir: 'asc', value: (a) => (ACTION_STATUSES as readonly string[]).indexOf(statusOf(a)) },
      { key: 'title', label: 'Action', firstDir: 'asc', value: (a) => a.title },
      { key: 'issue', label: 'Issue', firstDir: 'asc', value: (a) => issueLine(a) },
      { key: 'assignee', label: 'Assigned to', firstDir: 'asc', value: (a) => a.assignee_name || null },
      { key: 'type', label: 'Type', firstDir: 'asc', value: (a) => (a.action_type ? actionType.label(a.action_type) : null) },
      { key: 'created', label: 'Added', firstDir: 'desc', value: (a) => ms(a.created_at) },
    ],
    defaultSort: { key: 'attention', dir: 'asc' },
    board: {
      label: 'Actions by status',
      columns: ACTION_STATUSES.map((id) => ({ id, label: actionStatus.label(id), test: (a: ActionRow) => statusOf(a) === id })),
    },
    pageSize: 25,
  };
}

export const ACTION_SCHEMA = buildSchema(actionDef(0));
