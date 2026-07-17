// Reporting engine — shared types.

export type ColType = 'text' | 'number' | 'date' | 'badge';

export interface ColumnDef {
  key: string;
  label: string;
  type?: ColType;                     // default 'text'
  width?: number;                     // default width in px
  accessor?: (row: Row) => unknown;   // compute the raw value (defaults to row[key])
  format?: (value: unknown, row: Row) => string; // display string
  badgeTone?: (value: unknown) => string;         // tailwind classes for a badge cell
  href?: (row: Row) => string | null; // drill-down link for this cell
  align?: 'left' | 'right';
  agg?: 'sum' | 'avg';                // group-aggregate for numeric columns
}

export type Row = Record<string, unknown>;

export interface ReportDataset {
  key: string;            // stable id, e.g. 'risks'
  module: string;         // grouping label, e.g. 'Risk Management'
  label: string;          // dataset name, e.g. 'Risk Register'
  description?: string;
  columns: ColumnDef[];
  fetch: () => Promise<Row[]>;
  server?: boolean;       // supports server-side query (filter/sort/paginate in SQL)
  /** Permissions that grant this dataset — the same strings the module's own nav
   *  entry uses, so Reports can never surface data a user can't already open. */
  permissions?: string[];
}

export interface SortSpec { key: string; dir: 'asc' | 'desc' }

/** Server-mode query contract — mirrors backend POST /reporting/query. */
export interface ServerQuery {
  dataset: string;
  skip: number;
  limit: number;
  search?: string;
  sorts: { key: string; dir: 'asc' | 'desc' }[];
  filters: { col: string; op: string; value: string }[];
  logic: 'AND' | 'OR';
}
export interface ServerPage { rows: Row[]; total: number; skip: number; limit: number }

/** ── Report Builder ─────────────────────────────────────────────────────── */
export type AggFn = 'count' | 'sum' | 'avg' | 'min' | 'max';
export interface Measure { id: string; key: string; agg: AggFn }

/** A saved report definition — the unit the builder edits and persists. */
export interface ReportSpec {
  id: string;
  name: string;
  dataset: string;
  rows: string[];              // row group fields, outermost first (tree levels)
  col: string | null;          // pivot-across field
  measures: Measure[];
  rules: FilterRules;
  search: string;
  view: 'table' | 'bar' | 'line' | 'pie';
  measureIdx: number;          // which measure the chart plots (charts show one)
  shared?: boolean;            // visible to everyone in the tenant
  mine?: boolean;              // false for someone else's shared report (read-only to us)
}

export const emptySpec = (dataset: string): ReportSpec => ({
  id: '', name: '', dataset, rows: [], col: null, measures: [],
  rules: { logic: 'AND', conditions: [] }, search: '', view: 'table', measureIdx: 0,
});

/** One condition in the advanced AND/OR filter builder. */
export interface FilterRule { id: string; col: string; op: string; value: string }
export interface FilterRules { logic: 'AND' | 'OR'; conditions: FilterRule[] }

/** Operators available per column type in the advanced builder. */
export const OPERATORS: Record<string, { key: string; label: string }[]> = {
  text: [
    { key: 'contains', label: 'contains' }, { key: 'notcontains', label: 'does not contain' },
    { key: 'eq', label: 'is' }, { key: 'neq', label: 'is not' },
    { key: 'starts', label: 'starts with' }, { key: 'empty', label: 'is empty' }, { key: 'notempty', label: 'is not empty' },
  ],
  number: [
    { key: 'eq', label: '=' }, { key: 'neq', label: '≠' }, { key: 'gt', label: '>' },
    { key: 'lt', label: '<' }, { key: 'gte', label: '≥' }, { key: 'lte', label: '≤' },
  ],
  date: [
    { key: 'after', label: 'after' }, { key: 'before', label: 'before' }, { key: 'on', label: 'on' },
    { key: 'empty', label: 'is empty' }, { key: 'notempty', label: 'is not empty' },
  ],
  badge: [
    { key: 'eq', label: 'is' }, { key: 'neq', label: 'is not' }, { key: 'contains', label: 'contains' },
  ],
};
export interface ColumnFilter {
  text?: string;                 // "contains" for text/number
  values?: string[];             // multi-select equals for badge/enum
  from?: string;                 // date range (yyyy-mm-dd)
  to?: string;
  rel?: string;                  // relative preset (last30, thisquarter, overdue…)
}

/** Serializable grid state — the unit that gets saved as a named view. */
export interface ReportView {
  name?: string;
  search: string;
  sorts: SortSpec[];
  filters: Record<string, ColumnFilter>;
  hidden: string[];              // hidden column keys
  pinned: string[];              // pinned-left column keys
  widths: Record<string, number>;
  order: string[];               // explicit column order (drag-reorder)
  groupBy: string | null;        // group rows by this column key
  rules: FilterRules;            // advanced AND/OR condition builder
  pageSize: number;
}

export const emptyView = (): ReportView => ({
  search: '', sorts: [], filters: {}, hidden: [], pinned: [], widths: {}, order: [], groupBy: null,
  rules: { logic: 'AND', conditions: [] }, pageSize: 50,
});

export const REL_PRESETS: { key: string; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'last90', label: 'Last 90 days' },
  { key: 'thismonth', label: 'This month' },
  { key: 'thisquarter', label: 'This quarter' },
  { key: 'thisyear', label: 'This year' },
  { key: 'next30', label: 'Next 30 days' },
  { key: 'overdue', label: 'Overdue (before today)' },
];
