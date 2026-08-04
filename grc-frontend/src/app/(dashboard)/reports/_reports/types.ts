// Reporting engine — shared types.

export type ColType = 'text' | 'number' | 'date' | 'badge' | 'linkage';

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
  linkageKey?: string;                // cross-module linkage id (enrichment)
  linkageModule?: string;             // module label for grouping in the picker
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
export type AggFn = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max';

/** One aggregation measure — field is empty for row-count (`count(*)`). */
export interface Measure {
  id: string;
  key: string;
  agg: AggFn;
  label?: string;
  /** When true (count / count_distinct), also emit a % of grand-total column. */
  pctOfTotal?: boolean;
}

/** Dimensions + measures block persisted inside the report `spec` JSON. */
export interface AggregationSpec {
  groupBy: string[];
  measures: Measure[];
}

/** Every chart type the builder can render from a pivot result. */
export type ChartKind =
  | 'bar' | 'hbar' | 'stacked' | 'stacked100'   // bars
  | 'line' | 'area'                              // trends
  | 'pie' | 'donut' | 'treemap'                  // proportion
  | 'radar' | 'scatter' | 'heatmap';             // compare

/** A saved report definition — the unit the builder edits and persists. */
export interface ReportSpec {
  id: string;
  name: string;
  /** Optional user-written notes about what this custom report shows. */
  description?: string;
  dataset: string;
  /** Group-by dimensions (outermost first). Same as AggregationSpec.groupBy. */
  rows: string[];
  col: string | null;          // pivot-across field (charts)
  measures: Measure[];
  rules: FilterRules;
  search: string;
  view: 'table' | ChartKind;
  measureIdx: number;          // which measure the chart plots (charts show one)
  visibleColumns?: string[];     // flat table columns (detail mode)
  columnWidths?: Record<string, number>;
  columnAlign?: Record<string, 'left' | 'right'>;
  pinnedColumns?: string[];
  sorts?: SortSpec[];
  includes?: string[];         // cross-module linkage keys to enrich (e.g. vulnerabilities, risks)
  showLegend?: boolean;        // chart option (default on)
  showLabels?: boolean;        // data labels on marks (default off)
  shared?: boolean;            // visible to everyone in the tenant
  mine?: boolean;              // false for someone else's shared report (read-only to us)
  updatedAt?: string | null;   // ISO timestamp from server (local saves may omit)
}

export const emptySpec = (dataset: string): ReportSpec => ({
  id: '', name: '', description: '', dataset, rows: [], col: null, measures: [],
  rules: { logic: 'AND', conditions: [] }, search: '', view: 'table', measureIdx: 0,
  includes: [], visibleColumns: [], columnWidths: {}, columnAlign: {}, pinnedColumns: [], sorts: [],
});

/** Server-mode aggregate contract — mirrors backend POST /reporting/aggregate. */
export interface ServerAggregateQuery {
  dataset: string;
  search?: string;
  sorts: { key: string; dir: 'asc' | 'desc' }[];
  filters: { col: string; op: string; value: string }[];
  logic: 'AND' | 'OR';
  group_by: string[];
  measures: { id: string; field?: string; fn: AggFn; pct_of_total?: boolean }[];
}
export interface ServerAggregatePage {
  rows: Row[];
  total: number;
  columns: { key: string; label: string; type?: string }[];
  warnings?: { skipped_filters?: { col: string; op: string; reason: string }[]; skipped_measures?: string[]; skipped_group_by?: string[] };
}

/** One condition in the advanced AND/OR filter builder. */
export interface FilterRule { id: string; col: string; op: string; value: string }
export interface FilterRules { logic: 'AND' | 'OR'; conditions: FilterRule[] }

/** Operators available per column type in the advanced builder. */
export const OPERATORS: Record<string, { key: string; label: string }[]> = {
  text: [
    { key: 'eq', label: 'is' }, { key: 'neq', label: 'is not' },
    { key: 'contains', label: 'contains' }, { key: 'notcontains', label: 'does not contain' },
    { key: 'starts', label: 'starts with' },
    { key: 'empty', label: 'is empty' }, { key: 'notempty', label: 'is not empty' },
  ],
  number: [
    { key: 'eq', label: 'equals' }, { key: 'neq', label: 'does not equal' },
    { key: 'gt', label: 'greater than' }, { key: 'gte', label: 'greater or equal' },
    { key: 'lt', label: 'less than' }, { key: 'lte', label: 'less or equal' },
    { key: 'empty', label: 'is empty' }, { key: 'notempty', label: 'is not empty' },
  ],
  date: [
    { key: 'on', label: 'on' }, { key: 'before', label: 'before' }, { key: 'after', label: 'after' },
    { key: 'empty', label: 'is empty' }, { key: 'notempty', label: 'is not empty' },
  ],
  // Enum / status / Yes-No flags — pick from known values; no numeric compares.
  badge: [
    { key: 'eq', label: 'is' }, { key: 'neq', label: 'is not' },
    { key: 'contains', label: 'contains' }, { key: 'notcontains', label: 'does not contain' },
    { key: 'empty', label: 'is empty' }, { key: 'notempty', label: 'is not empty' },
  ],
  // Cross-module linkage presence. Orphan-finding ("not linked to any X") is the
  // primary use, so it leads. No value — the operator IS the predicate.
  linkage: [
    { key: 'notlinked', label: 'is not linked to any' }, { key: 'linked', label: 'is linked to any' },
  ],
};

/** Short plain-language hint for filter panel copy (by column type). */
export const FILTER_TYPE_HINT: Record<string, string> = {
  text: 'Text: is / contains / starts with / empty',
  number: 'Numbers: equals, greater/less than, empty',
  date: 'Dates: on / before / after / empty',
  badge: 'Tags & status: is / is not / empty',
  linkage: 'Links: linked to any / not linked to any',
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
