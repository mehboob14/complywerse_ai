// The department table of At a glance as data, without React (_matrix.test.ts): which groups of columns it can show (by status, by type, waiting on people,
// reviews, issues, or all), what each column counts and where its figure opens in the library, the line of each department with its cells, the totals
// and the CSV of the whole matrix. Every number is the server's (`by_department`, documents_overview.py); an address is the library's own vocabulary
// (libraryModel.PARAM_KEYS) with `dept` first; a figure the library cannot filter on has none and is text.
import { documentStatus } from '../../../../../lib/status.ts';
import { STAGE_ORDER } from '../../documents/_workspace/libraryModel.ts';
import { csvText, type CsvCell } from './_csv.ts';
import { libraryHref, rowIsHere, rowValue, overviewHref, type DepartmentRow, type Overview, type Tone } from './_model.ts';

export type MeasureId = 'status' | 'type' | 'waiting' | 'reviews' | 'issues' | 'all';

export const MEASURES: ReadonlyArray<{ id: MeasureId; label: string; info: string }> = [
  { id: 'status', label: 'Status', info: 'Documents by where they are in the approval flow, for each department and everything under it.' },
  { id: 'type', label: 'Type', info: 'Documents by kind, for each department and everything under it.' },
  { id: 'waiting', label: 'Waiting on people', info: 'Reviews, approvals and acknowledgements asked of people and not answered yet, for the documents of each department and everything under it. One for each person asked, so a number can be larger than the documents it opens.' },
  { id: 'reviews', label: 'Reviews', info: 'Where the review dates of published or approved documents stand, for each department and everything under it.' },
  { id: 'issues', label: 'Issues', info: 'Documents that need attention, for each department and everything under it. One document can have several issues, so the columns can add up to more than the documents.' },
  { id: 'all', label: 'All columns', info: 'Every column, side by side.' },
];
export const MEASURE_IDS = MEASURES.map((m) => m.id) as MeasureId[];
export const DEFAULT_MEASURE: MeasureId = 'status';
/** What the page's table offers: one group of columns at a time. All of them together are the export's (24 columns are not a table to read). */
export const TABLE_MEASURES = MEASURES.filter((m) => m.id !== 'all');
export const TABLE_MEASURE_IDS = TABLE_MEASURES.map((m) => m.id) as MeasureId[];

export interface MatrixColumn {
  id: string;
  /** the measure it belongs to (its words in the CSV) */
  group: Exclude<MeasureId, 'all'>;
  label: string;
  /** what the figure counts, for the name of its link: "documents in review" */
  noun: string;
  tone: Tone;
  value: (row: DepartmentRow) => number;
  /** library parameters besides the department; null: the library cannot filter on it, so the figure is text */
  params: Readonly<Record<string, string>> | null;
}

const GROUP_LABEL: Record<Exclude<MeasureId, 'all'>, string> = { status: 'Status', type: 'Type', waiting: 'Waiting', reviews: 'Reviews', issues: 'Issues' };
const STATUS_TONE: Record<string, Tone> = { published: 'success', expired: 'danger', exception_applied: 'warning', review_required: 'warning' };
const FLOW: readonly string[] = STAGE_ORDER;

/** One column for each step of the approval flow, and one for each other status that some document has. */
export function statusColumns(data: Pick<Overview, 'by_status'>): MatrixColumn[] {
  return data.by_status.filter((s) => FLOW.includes(s.status) || s.count > 0).map((s) => {
    const label = documentStatus.label(s.status);
    return { id: `status:${s.status}`, group: 'status', label, noun: `documents with status ${label}`, tone: STATUS_TONE[s.status] ?? 'default', value: (r) => r.by_status[s.status] ?? 0, params: { status: s.status } };
  });
}

/** One column for each kind of document that some document is (the server's order: the most first). */
export function typeColumns(data: Pick<Overview, 'by_type'>): MatrixColumn[] {
  return data.by_type.map((t) => ({
    id: `type:${t.doc_type}`, group: 'type', label: t.label, noun: `${t.label.toLowerCase()} documents`, tone: 'default',
    value: (r) => r.by_type[t.doc_type] ?? 0, params: t.doc_type ? { type: t.doc_type } : null,
  }));
}

/** Pending and overdue, for each kind of request. Pending reviews and approvals open the documents at that status; an overdue one opens the late approvals; a pending acknowledgement has no address. */
export const WAITING_COLUMNS: readonly MatrixColumn[] = [
  { id: 'waiting:review:pending', group: 'waiting', label: 'Reviews pending', noun: 'review requests pending', tone: 'default', value: (r) => r.waiting.review.pending, params: { status: 'pending_review' } },
  { id: 'waiting:review:overdue', group: 'waiting', label: 'Reviews late', noun: 'review requests overdue', tone: 'danger', value: (r) => r.waiting.review.overdue, params: { attn: 'late_approvals' } },
  { id: 'waiting:approval:pending', group: 'waiting', label: 'Approvals pending', noun: 'approval requests pending', tone: 'default', value: (r) => r.waiting.approval.pending, params: { status: 'pending_approval' } },
  { id: 'waiting:approval:overdue', group: 'waiting', label: 'Approvals late', noun: 'approval requests overdue', tone: 'danger', value: (r) => r.waiting.approval.overdue, params: { attn: 'late_approvals' } },
  { id: 'waiting:acknowledgement:pending', group: 'waiting', label: 'Acknowledgements pending', noun: 'acknowledgement requests pending', tone: 'default', value: (r) => r.waiting.acknowledgement.pending, params: null },
  { id: 'waiting:acknowledgement:overdue', group: 'waiting', label: 'Acknowledgements late', noun: 'acknowledgement requests overdue', tone: 'warning', value: (r) => r.waiting.acknowledgement.overdue, params: { attn: 'late_acknowledgements' } },
];

/** Where the review dates of the documents that owe a review stand. */
export const REVIEW_COLUMNS: readonly MatrixColumn[] = [
  { id: 'reviews:overdue', group: 'reviews', label: 'Overdue reviews', noun: 'documents with an overdue review', tone: 'danger', value: (r) => r.reviews.overdue, params: { review: 'overdue' } },
  { id: 'reviews:due_soon', group: 'reviews', label: 'Due in 30 days', noun: 'documents with a review due in 30 days', tone: 'warning', value: (r) => r.reviews.due_soon, params: { review: 'due_soon' } },
  { id: 'reviews:unscheduled', group: 'reviews', label: 'No review date', noun: 'documents with no review date', tone: 'default', value: (r) => r.reviews.unscheduled, params: { review: 'unscheduled' } },
];

/** The documents with any issue (no single address), and each issue. */
export const ISSUE_COLUMNS: readonly MatrixColumn[] = [
  { id: 'issues:any', group: 'issues', label: 'With issues', noun: 'documents with issues', tone: 'warning', value: (r) => r.issues, params: null },
  { id: 'issues:stuck', group: 'issues', label: 'Stuck', noun: 'documents stuck in a stage', tone: 'danger', value: (r) => r.issues_by.stuck, params: { attn: 'stuck' } },
  { id: 'issues:on_hold', group: 'issues', label: 'On hold', noun: 'documents on hold', tone: 'warning', value: (r) => r.issues_by.on_hold, params: { attn: 'on_hold' } },
  { id: 'issues:late_approvals', group: 'issues', label: 'Late approvals', noun: 'documents with late approvals', tone: 'danger', value: (r) => r.issues_by.late_approvals, params: { attn: 'late_approvals' } },
  { id: 'issues:late_acknowledgements', group: 'issues', label: 'Late acknowledgements', noun: 'documents with late acknowledgements', tone: 'warning', value: (r) => r.issues_by.late_acknowledgements, params: { attn: 'late_acknowledgements' } },
  { id: 'issues:no_owner', group: 'issues', label: 'No owner', noun: 'documents without an owner', tone: 'warning', value: (r) => r.issues_by.no_owner, params: { owner: 'none' } },
];

/** The columns of a measure for this answer. */
export function columnsFor(measure: MeasureId, data: Pick<Overview, 'by_status' | 'by_type'>): MatrixColumn[] {
  switch (measure) {
    case 'status': return statusColumns(data);
    case 'type': return typeColumns(data);
    case 'waiting': return [...WAITING_COLUMNS];
    case 'reviews': return [...REVIEW_COLUMNS];
    case 'issues': return [...ISSUE_COLUMNS];
    default: return [...statusColumns(data), ...typeColumns(data), ...WAITING_COLUMNS, ...REVIEW_COLUMNS, ...ISSUE_COLUMNS];
  }
}

export interface MatrixCell { id: string; label: string; noun: string; value: number; tone: Tone; href: string | null }
export interface MatrixLine {
  row: DepartmentRow;
  /** the department's `?dept=` value */
  value: string;
  /** the row is the department the page is about: its name is not a link */
  here: boolean;
  /** the department's own view of the page, or null on the row that is the page itself */
  open: string | null;
  /** the path, the level in the organisation's word and how the documents split between the department itself and what is under it */
  title: string;
  cells: MatrixCell[];
}

const cellOf = (c: MatrixColumn, row: DepartmentRow, dept: string): MatrixCell => ({
  id: c.id, label: c.label, noun: c.noun, value: c.value(row), tone: c.tone, href: c.params ? libraryHref({ ...(dept ? { dept } : {}), ...c.params }) : null,
});

/** The rows of the table, in the tree's order, each with a cell for every column (the figures open the library on that department and everything under it). */
export function matrixLines(data: Pick<Overview, 'by_department' | 'scope'>, columns: readonly MatrixColumn[], open: (value: string) => string = overviewHref): MatrixLine[] {
  return data.by_department.map((row) => {
    const value = rowValue(row);
    const here = rowIsHere(row, data.scope);
    const below = row.documents - row.own;
    const where = [row.path.length > 1 ? row.path.join(' › ') : '', row.level_label, below > 0 ? `${row.own} filed in it, ${below} below it` : ''].filter(Boolean).join(' · ');
    return { row, value, here, open: here ? null : open(value), title: where || row.name, cells: columns.map((c) => cellOf(c, row, value)) };
  });
}

/** The scope's own figures: the top rows added up (a row counts everything under it, so only the top ones are added). The addresses are the scope's. */
export function matrixTotals(data: Pick<Overview, 'by_department' | 'scope'>, columns: readonly MatrixColumn[]): MatrixCell[] {
  const top = data.by_department.filter((r) => r.depth === 0);
  const dept = data.scope.value;
  return columns.map((c) => ({
    id: c.id, label: c.label, noun: c.noun, value: top.reduce((n, r) => n + c.value(r), 0), tone: c.tone,
    href: c.params ? libraryHref({ ...(dept ? { dept } : {}), ...c.params }) : null,
  }));
}

/** What is filed in a row's department itself: its figure less the figures of the rows directly under it (the table is in tree order, `depth` says who is under whom). */
export function ownOf(rows: readonly DepartmentRow[], index: number, value: (r: DepartmentRow) => number): number {
  const row = rows[index];
  let below = 0;
  for (let i = index + 1; i < rows.length && rows[i].depth > row.depth; i += 1) if (rows[i].depth === row.depth + 1) below += value(rows[i]);
  return value(row) - below;
}

/** A group's name and a column's name in a CSV: "Status: In review". */
export const csvLabel = (c: Pick<MatrixColumn, 'group' | 'label'>): string => `${GROUP_LABEL[c.group]}: ${c.label}`;

/** The whole matrix as CSV text: every department (the tree's order, the path in `Path`), its owner, its documents (everything under it) and how many are filed in it itself,
 *  then every column given. */
export function matrixCsv(data: Pick<Overview, 'by_department'>, columns: readonly MatrixColumn[]): string {
  const head: CsvCell[] = ['Department', 'Path', 'Level', 'Owner', 'Documents', 'Filed in it', ...columns.map(csvLabel)];
  const body = data.by_department.map((r): CsvCell[] => [r.name, r.path.join(' > '), r.level_label, r.owner, r.documents, r.own, ...columns.map((c) => c.value(r))]);
  return csvText([head, ...body]);
}
