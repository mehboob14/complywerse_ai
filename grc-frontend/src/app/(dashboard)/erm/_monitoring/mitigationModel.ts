// The mitigation-action register's definition (facets, quick chips, sorts, board), apart from React (`mitigationModel.test.ts`). The rows are GET /erm/mitigation-actions (every
// action of the tenant with its risk's title, the owner's name and the evidence count). "Overdue" is derived (lib/erm/mitigation.ts), never a status the page sets.
import { ACTION_PRIORITIES, ACTION_TYPES, isOpenAction, isOverdueAction, shownStatus } from '../../../../lib/erm/mitigation.ts';
import { mitigationStatus, severity, treatmentType } from '../../../../lib/statuses/monitoring.ts';
import { parseUtc } from '../../../../lib/serverTime.ts';
import { buildSchema, type RegisterDef } from './registerModel.ts';

export interface ActionRow {
  id: number;
  risk_id: number;
  title: string;
  description?: string | null;
  action_type: string;
  status: string;
  priority: string;
  owner_id?: number | null;
  owner_name?: string | null;
  due_date?: string | null;
  completed_at?: string | null;
  expected_residual_reduction?: number | null;
  actual_residual_reduction?: number | null;
  notes?: string | null;
  risk_title?: string | null;
  risk_category?: string | null;
  evidence_count?: number;
}

const NONE = 'none';
const DAY = 86_400_000;
const PRIORITY_RANK: Readonly<Record<string, number>> = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER = ['open', 'in_progress', 'overdue', 'completed', 'cancelled'];

/** Still to do and due within the next seven days (not yet late). */
export function dueThisWeek(a: ActionRow, now: Date): boolean {
  if (!isOpenAction(a) || isOverdueAction(a, now)) return false;
  const due = parseUtc(a.due_date ?? undefined);
  return !!due && due.getTime() - now.getTime() <= 7 * DAY;
}

const column = (a: ActionRow): string => (a.status === 'overdue' ? 'open' : STATUS_ORDER.includes(a.status) ? a.status : 'cancelled');

function people<R>(rows: readonly R[], idOf: (r: R) => number | null | undefined, nameOf: (r: R) => string | null | undefined, noneLabel: string, fallback: string) {
  const seen = new Map<string, string>();
  rows.forEach((r) => { const id = idOf(r); if (id) seen.set(String(id), nameOf(r) || `${fallback} ${id}`); });
  const list = Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
  return rows.some((r) => !idOf(r)) ? list.concat({ value: NONE, label: noneLabel }) : list;
}

export function actionDef(me: number | null): RegisterDef<ActionRow> {
  return {
    key: 'action',
    noun: { one: 'action', other: 'actions' },
    idOf: (a) => a.id,
    text: (a) => [a.title, a.risk_title, a.owner_name, a.description, a.notes].filter(Boolean).join(' '),
    facets: [
      { key: 'status', label: 'Status', defaultOpen: true, values: (a) => [a.status], options: () => ['open', 'in_progress', 'completed', 'cancelled'].map((value) => ({ value, label: mitigationStatus.label(value) })) },
      { key: 'priority', label: 'Priority', defaultOpen: true, values: (a) => [a.priority], options: () => ACTION_PRIORITIES.map((value) => ({ value, label: severity.label(value) })) },
      { key: 'type', label: 'Treatment', values: (a) => [a.action_type], options: () => ACTION_TYPES.map((value) => ({ value, label: treatmentType.label(value) })) },
      { key: 'owner', label: 'Owner', searchable: true, limit: 7, values: (a) => [a.owner_id ? String(a.owner_id) : NONE], options: (rows) => people(rows, (a) => a.owner_id, (a) => a.owner_name, 'Unassigned', 'User') },
      {
        key: 'risk', label: 'Risk', searchable: true, limit: 7, values: (a) => [String(a.risk_id)],
        options: (rows) => {
          const seen = new Map<string, string>();
          rows.forEach((a) => seen.set(String(a.risk_id), a.risk_title || `Risk ${a.risk_id}`));
          return Array.from(seen.entries()).sort((x, y) => x[1].localeCompare(y[1])).map(([value, label]) => ({ value, label }));
        },
      },
    ],
    quick: [
      { key: 'overdue', label: 'Overdue', test: (a, now) => isOverdueAction(a, now), title: 'Still to do and past its date: the Overview counts the same ones' },
      { key: 'week', label: 'Due this week', test: (a, now) => dueThisWeek(a, now) },
      { key: 'open', label: 'To do', test: (a) => a.status === 'open' || a.status === 'in_progress', title: 'Open or in progress' },
      { key: 'noowner', label: 'Unassigned', test: (a) => !a.owner_id && isOpenAction(a) },
      { key: 'noevidence', label: 'No evidence', test: (a) => a.status === 'completed' && !a.evidence_count, title: 'Completed with nothing attached' },
      ...(me != null ? [{ key: 'mine', label: 'Mine', test: (a: ActionRow) => a.owner_id === me }] : []),
    ],
    sorts: [
      { key: 'due', label: 'Due date', firstDir: 'asc', value: (a) => (a.due_date ? a.due_date.slice(0, 10) : null) },
      { key: 'priority', label: 'Priority (highest first)', firstDir: 'asc', value: (a) => PRIORITY_RANK[a.priority] ?? 9 },
      { key: 'status', label: 'Status', firstDir: 'asc', value: (a) => STATUS_ORDER.indexOf(shownStatus(a)) },
      { key: 'title', label: 'Title', firstDir: 'asc', value: (a) => a.title },
      { key: 'risk', label: 'Risk', firstDir: 'asc', value: (a) => a.risk_title || null },
      { key: 'owner', label: 'Owner', firstDir: 'asc', value: (a) => a.owner_name || null },
    ],
    defaultSort: { key: 'due', dir: 'asc' },
    board: {
      label: 'Mitigation actions by status',
      columns: ['open', 'in_progress', 'completed', 'cancelled'].map((id) => ({ id, label: mitigationStatus.label(id), test: (a: ActionRow) => column(a) === id })),
    },
    pageSize: 25,
  };
}

export const ACTION_SCHEMA = buildSchema(actionDef(0));   // with a person, so every chip key is one the address may name
