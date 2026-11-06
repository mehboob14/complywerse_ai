// What the graphs of At a glance draw, without React (_chart.test.ts): the colours (a chart is SVG, which cannot read a class: the hex of the --ds / tone tokens,
// lib/status.ts TONE), and the rows and series of each chart from the server's answer. A graph never shows a number the table does not: every row is `by_department`,
// one level at a time (the scope's own documents, then each department directly under it, so no document is drawn twice), and every chart has its table of numbers
// for a screen reader (ChartFrame).
import type { ChartData } from '../../../../../components/ui/ds/chartText.ts';
import { documentStatus } from '../../../../../lib/status.ts';
import { STAGE_ORDER } from '../_workspace/libraryModel.ts';
import { ownOf } from './_matrix.ts';
import { figureHref, rowValue, type DepartmentRow, type Overview } from './_model.ts';

// tokens, as hex
export const INK = '#586472';          // --ds-fg-muted
export const GRID = '#e1e6eb';         // --ds-border
export const HOVER = '#f3f6f8';        // --ds-surface-hover
export const FG = '#1f2933';           // --ds-fg
export const TIP = { fontSize: 12, border: '1px solid #e1e6eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(15, 23, 42, 0.14)', color: '#1f2933' };

/** Each status its own colour (the tone's dot, lib/status.ts TONE; the two that share the pending tone are told apart by their shade). */
export const STATUS_COLOR: Readonly<Record<string, string>> = {
  draft: '#64748B',
  pending_review: '#7C5CD6',
  pending_approval: '#5B3FB8',
  approved: '#0284C7',
  published: '#059669',
  expired: '#E11D48',
  exception_applied: '#D97706',
  review_required: '#B45309',
  archived: '#94A3B8',
};
export const OTHER_STATUS_COLOR = '#94A3B8';
/** The kinds of document, in the order the server lists them (the most first). */
export const TYPE_COLORS = ['#0F766E', '#0284C7', '#7C5CD6', '#D97706', '#059669', '#E11D48', '#64748B', '#0891B2'] as const;
export const WAITING_COLOR = { overdue: '#E11D48', pending: '#7C5CD6' } as const;

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

export const WAITING_SERIES: readonly Series[] = [
  { key: 'overdue', label: 'Overdue', color: WAITING_COLOR.overdue },
  { key: 'pending', label: 'Not yet due', color: WAITING_COLOR.pending },
];

/** Requests asked of people, by department: the overdue ones and the ones not yet due (all kinds added; the table has them by kind). */
export function waitingStack(data: Pick<Overview, 'by_department' | 'scope'>): Stack {
  const kinds = ['review', 'approval', 'acknowledgement'] as const;
  return stack(data, [...WAITING_SERIES], (r, k) => kinds.reduce((n, kind) => n + (k === 'overdue' ? r.waiting[kind].overdue : r.waiting[kind].pending - r.waiting[kind].overdue), 0));
}

export interface Slice { key: string; label: string; value: number; color: string; href: string | null }

/** The kinds of document as the slices of a donut, with where each opens in the library. A kind has the colour it has in the stacks (its place in the server's list). */
export const typeSlices = (data: Pick<Overview, 'by_type' | 'links'>): Slice[] =>
  data.by_type.map((t, i) => ({ key: t.key, label: t.label, value: t.count, color: TYPE_COLORS[i % TYPE_COLORS.length], href: figureHref(data, t.key) })).filter((s) => s.value > 0);

/** The steps of the approval flow (and the others that are there) as the bars of a status chart. */
export const statusBars = (data: Pick<Overview, 'by_status' | 'links'>): Slice[] =>
  data.by_status.filter((s) => FLOW.includes(s.status) || s.count > 0)
    .map((s) => ({ key: s.key, label: documentStatus.label(s.status), value: s.count, color: STATUS_COLOR[s.status] ?? OTHER_STATUS_COLOR, href: figureHref(data, s.key) }));

/** The numbers a stack draws, as the table a screen reader reads in place of the picture. */
export const stackTable = (s: Stack, first = 'Department'): ChartData => ({ columns: [first, ...s.series.map((x) => x.label)], rows: s.rows.map((r) => [r.name, ...s.series.map((x) => r.cells[x.key] ?? 0)]) });
export const sliceTable = (slices: readonly Slice[], first: string): ChartData => ({ columns: [first, 'Documents'], rows: slices.map((s) => [s.label, s.value]) });
