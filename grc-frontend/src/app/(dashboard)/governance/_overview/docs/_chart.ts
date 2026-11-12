// What the graphs of the Overview draw, without React (_chart.test.ts): the colours (the chart kit's palette: components/overview/charts/palette.ts), and the rows
// and series of each chart from the server's answer. A graph never shows a number the table does not: every row is `by_department`, one level at a time (the
// scope's own documents, then each department directly under it, so no document is drawn twice); the kit's charts carry their numbers as a table for a screen reader.
import { OTHER, SERIES, STATUS } from '../../../../../components/overview/charts/palette.ts';
import { documentStatus } from '../../../../../lib/status.ts';
import { STAGE_ORDER } from '../../documents/_workspace/libraryModel.ts';
import { ownOf } from './_matrix.ts';
import { rowValue, type DepartmentRow, type Overview } from './_model.ts';

/** Each status its own colour: the status tones of the chart kit's palette, and a categorical hue for the two that would share one (the two review and approval steps, the two that need attention). */
export const STATUS_COLOR: Readonly<Record<string, string>> = {
  draft: STATUS.neutral,
  pending_review: STATUS.pending,
  pending_approval: SERIES[6],
  approved: STATUS.progress,
  published: STATUS.good,
  expired: STATUS.bad,
  exception_applied: STATUS.warn,
  review_required: SERIES[3],
  archived: OTHER,
};
export const OTHER_STATUS_COLOR = OTHER;
/** The kinds of document, in the order the server lists them (the most first): the kit's categorical hues, in their order. */
export const TYPE_COLORS = SERIES;
export const WAITING_COLOR = { overdue: STATUS.bad, pending: STATUS.pending } as const;

export interface Series { key: string; label: string; color: string }
export interface StackRow {
  key: string;
  name: string;
  /** the department's `?dept=` value, for the click that opens its view; null for the scope's own documents */
  value: string | null;
  total: number;
  cells: Record<string, number>;
}
export interface Stack { rows: StackRow[]; series: Series[]; /** departments left out of the chart (the smallest) */ more: number }

export const MAX_BARS = 12;
const FLOW: readonly string[] = STAGE_ORDER;

/** The series of the status stacks: the steps of the approval flow, and any other status that some document has. */
export function statusSeries(data: Pick<Overview, 'by_status'>): Series[] {
  return data.by_status.filter((s) => FLOW.includes(s.status) || s.count > 0)
    .map((s) => ({ key: s.status, label: documentStatus.label(s.status), color: STATUS_COLOR[s.status] ?? OTHER_STATUS_COLOR }));
}

/** The series of the type stacks: one for each kind that some document is. */
export const typeSeries = (data: Pick<Overview, 'by_type'>): Series[] =>
  data.by_type.map((t, i) => ({ key: t.doc_type, label: t.label, color: TYPE_COLORS[i % TYPE_COLORS.length] }));

/** The rows one level deep: with a department as scope, what is filed in it itself and then each department directly under it; with the whole organisation, every
 *  top department and "No department". `own` is true for the scope's own row. Empty for "No department" (it has no tree). */
function levelRows(data: Pick<Overview, 'by_department' | 'scope'>): Array<{ row: DepartmentRow; index: number; own: boolean }> {
  const all = data.by_department;
  if (data.scope.department_id !== null) {
    const root = all.findIndex((r) => r.department_id === data.scope.department_id);
    if (root < 0) return [];
    return [{ row: all[root], index: root, own: true }, ...all.map((row, index) => ({ row, index, own: false })).filter((x) => x.row.depth === all[root].depth + 1)];
  }
  return all.map((row, index) => ({ row, index, own: false })).filter((x) => x.row.depth === 0);
}

function stack(data: Pick<Overview, 'by_department' | 'scope'>, series: Series[], read: (row: DepartmentRow, key: string) => number): Stack {
  const all = data.by_department;
  const rows = levelRows(data).map(({ row, index, own }): StackRow => {
    const cells: Record<string, number> = {};
    series.forEach((s) => { cells[s.key] = own ? ownOf(all, index, (r) => read(r, s.key)) : read(row, s.key); });
    return { key: row.key + (own ? ':own' : ''), name: own ? `Filed in ${row.name}` : row.name, value: own ? null : rowValue(row), total: series.reduce((n, s) => n + cells[s.key], 0), cells };
  });
  // the scope's own row stays first and "No department" last; the departments between are the biggest first
  const first = rows.filter((r) => r.value === null);
  const last = rows.filter((r) => r.value === 'none');
  const middle = rows.filter((r) => r.value !== null && r.value !== 'none').sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const room = Math.max(0, MAX_BARS - first.length - last.length);
  const shown = [...first, ...middle.slice(0, room), ...last];
  return { rows: shown, series, more: Math.max(0, middle.length - room) };
}

/** Documents by department, stacked by status or by type. */
export function departmentStack(data: Pick<Overview, 'by_department' | 'scope' | 'by_status' | 'by_type'>, by: 'status' | 'type'): Stack {
  return by === 'status'
    ? stack(data, statusSeries(data), (r, k) => r.by_status[k] ?? 0)
    : stack(data, typeSeries(data), (r, k) => r.by_type[k] ?? 0);
}

/** The biggest `max` bars of a stack (the Summary shows five and opens the Departments view for the rest): ranked by size, a tie by name, the departments left out counted in `more`. */
export function capStack(s: Stack, max: number): Stack {
  const ranked = s.rows.slice().sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const kept = ranked.slice(0, Math.max(1, Math.floor(max)));
  return { ...s, rows: kept, more: s.more + (ranked.length - kept.length) };
}

export const WAITING_SERIES: readonly Series[] = [
  { key: 'overdue', label: 'Overdue', color: WAITING_COLOR.overdue },
  { key: 'pending', label: 'Not yet due', color: WAITING_COLOR.pending },
];

/** Requests asked of people, by department: the overdue ones and the ones not yet due (all kinds added; the table has them by kind). */
export function waitingStack(data: Pick<Overview, 'by_department' | 'scope'>): Stack {
  const kinds = ['review', 'approval', 'acknowledgement'] as const;
  return stack(data, [...WAITING_SERIES], (r, k) => kinds.reduce((n, kind) => n + (k === 'overdue' ? r.waiting[kind].overdue : r.waiting[kind].pending - r.waiting[kind].overdue), 0));
}
