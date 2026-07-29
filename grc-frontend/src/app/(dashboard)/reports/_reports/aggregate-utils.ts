// Flat summary aggregation — Dimensions (group-by) + Measures (aggregations).
// Filters are expected to already be applied to `rows` (WHERE then GROUP BY).

import type { AggFn, ColumnDef, Measure, Row } from './types';
import { displayText } from './grid-utils';
import { AGG_LABEL, fmtAgg, runAgg } from './pivot';

const BLANK = '—';

export const AGG_OPTIONS: {
  key: AggFn;
  label: string;
  /** Plain-language hint for tooltips / option title. */
  hint: string;
  needsField: boolean;
  /** Sum / avg / min / max — only valid on number columns. */
  numericOnly?: boolean;
}[] = [
  { key: 'count', label: 'How many', hint: 'Count of matching rows (any list)', needsField: false },
  { key: 'count_distinct', label: 'Count unique', hint: 'How many different values in a column', needsField: true },
  { key: 'sum', label: 'Add up', hint: 'Add all numbers in a column', needsField: true, numericOnly: true },
  { key: 'avg', label: 'Average', hint: 'Average of numbers in a column', needsField: true, numericOnly: true },
  { key: 'min', label: 'Lowest', hint: 'Smallest number in a column', needsField: true, numericOnly: true },
  { key: 'max', label: 'Highest', hint: 'Largest number in a column', needsField: true, numericOnly: true },
];

/** Whether a column can be used with Add up / Average / Lowest / Highest. */
export function isNumericMeasureField(col: ColumnDef | undefined | null): boolean {
  if (!col) return false;
  return col.type === 'number' || col.agg === 'sum' || col.agg === 'avg';
}

/**
 * Calculation choices allowed for a selected field.
 * No field → all options (user will pick a number column after choosing Add up / etc.).
 * Non-numeric field → How many + Count unique only.
 * Keeps `currentAgg` in the list so saved reports stay editable.
 */
export function aggOptionsForField(
  col: ColumnDef | undefined | null,
  currentAgg?: AggFn,
): typeof AGG_OPTIONS {
  let list = !col || isNumericMeasureField(col)
    ? AGG_OPTIONS
    : AGG_OPTIONS.filter((o) => !o.numericOnly);
  if (currentAgg && !list.some((o) => o.key === currentAgg)) {
    const keep = AGG_OPTIONS.find((o) => o.key === currentAgg);
    if (keep) list = [...list, keep];
  }
  return list;
}

/** Fields offered for a calculation — numeric-only aggs list number columns. */
export function fieldsForAgg(
  agg: AggFn,
  cols: ColumnDef[],
  currentKey = '',
  resolveCol?: (key: string) => ColumnDef | undefined,
): ColumnDef[] {
  const opt = AGG_OPTIONS.find((o) => o.key === agg);
  const usable = cols.filter((c) => c.type !== 'linkage' && !c.key.startsWith('link_'));
  let list: ColumnDef[];
  if (opt?.numericOnly) {
    list = usable.filter((c) => isNumericMeasureField(c));
  } else if (agg === 'count') {
    list = usable;
  } else {
    // count_distinct — text, badge, number, date
    list = usable;
  }
  if (currentKey && !list.some((c) => c.key === currentKey)) {
    const stale = resolveCol?.(currentKey) ?? usable.find((c) => c.key === currentKey);
    list = [...list, stale ?? { key: currentKey, label: currentKey, type: 'text' }];
  }
  return list;
}

/** Summary mode is on whenever the user has configured at least one measure. */
export function isSummaryMode(measures: Measure[] | undefined | null): boolean {
  return Array.isArray(measures) && measures.length > 0;
}

export function measureLabel(m: Measure, fieldLabel: string): string {
  if (m.label?.trim()) return m.label.trim();
  if (m.agg === 'count' && !m.key) return 'How many';
  if (m.agg === 'count_distinct') return `Unique ${fieldLabel || m.key || 'values'}`;
  const prefix = AGG_LABEL[m.agg] ?? m.agg;
  return m.key ? `${prefix} ${fieldLabel}` : prefix;
}

export function measureColKey(m: Measure): string {
  return `m_${m.id}`;
}

export function measurePctKey(m: Measure): string {
  return `m_${m.id}_pct`;
}

/** Distinct non-blank values of a field (for count_distinct). */
function distinctCount(col: ColumnDef | undefined, rows: Row[]): number {
  if (!col) return 0;
  const set = new Set<string>();
  for (const r of rows) {
    const t = displayText(col, r);
    if (t) set.add(t);
  }
  return set.size;
}

/** Run one measure over a row bucket. */
export function runMeasure(m: Measure, col: ColumnDef | undefined, rows: Row[]): number | null {
  if (m.agg === 'count') return rows.length;
  if (m.agg === 'count_distinct') return distinctCount(col, rows);
  return runAgg(m.agg, col, rows);
}

function groupKey(dims: ColumnDef[], row: Row): string {
  // Unit separator — safe path key that can't collide with display labels.
  return dims.map((d) => displayText(d, row) || BLANK).join('\u0001');
}

export interface AggregateResult {
  cols: ColumnDef[];
  rows: Row[];
  /** Ungrouped totals (one synthetic row of measure values). */
  grand: Row;
  sourceCount: number;
}

/**
 * Group filtered rows by dimension display values and compute measures.
 * Empty dimensions → a single overall-totals row.
 */
export function aggregateRows(
  allCols: ColumnDef[],
  rows: Row[],
  groupByKeys: string[],
  measures: Measure[],
): AggregateResult {
  const find = (k: string) => allCols.find((c) => c.key === k);
  const dims = groupByKeys.map(find).filter((c): c is ColumnDef => !!c);
  const activeMeasures = measures.filter((m) => m.agg === 'count' || m.key || m.agg === 'count_distinct');

  const dimCols: ColumnDef[] = dims.map((d) => ({
    key: d.key,
    label: d.label,
    type: d.type === 'badge' ? 'badge' : 'text',
    width: d.width ?? 160,
    badgeTone: d.badgeTone,
    format: d.format,
  }));

  const measureCols: ColumnDef[] = [];
  for (const m of activeMeasures) {
    const fieldLabel = m.key ? (find(m.key)?.label ?? m.key) : '';
    measureCols.push({
      key: measureColKey(m),
      label: measureLabel(m, fieldLabel),
      type: 'number',
      align: 'right',
      width: 120,
      format: (v) => fmtAgg(v == null || v === '' ? null : Number(v), m.agg === 'count_distinct' ? 'count' : m.agg),
    });
    if (m.pctOfTotal && (m.agg === 'count' || m.agg === 'count_distinct')) {
      measureCols.push({
        key: measurePctKey(m),
        label: `% of total`,
        type: 'number',
        align: 'right',
        width: 100,
        format: (v) => {
          if (v == null || v === '') return '';
          const n = Number(v);
          return Number.isFinite(n) ? `${n.toFixed(1)}%` : '';
        },
      });
    }
  }

  const cols = [...dimCols, ...measureCols];

  const buckets = new Map<string, { labels: string[]; rows: Row[] }>();
  if (dims.length === 0) {
    buckets.set('', { labels: [], rows });
  } else {
    for (const r of rows) {
      const k = groupKey(dims, r);
      const existing = buckets.get(k);
      if (existing) existing.rows.push(r);
      else {
        buckets.set(k, {
          labels: dims.map((d) => displayText(d, r) || BLANK),
          rows: [r],
        });
      }
    }
  }

  const grandVals: Record<string, number | null> = {};
  for (const m of activeMeasures) {
    grandVals[measureColKey(m)] = runMeasure(m, find(m.key), rows);
  }

  const outRows: Row[] = [];
  const sorted = Array.from(buckets.entries()).sort((a, b) =>
    a[1].labels.join('\u0001').localeCompare(b[1].labels.join('\u0001')),
  );

  for (const [, bucket] of sorted) {
    const row: Row = {};
    dims.forEach((d, i) => { row[d.key] = bucket.labels[i]; });
    for (const m of activeMeasures) {
      const v = runMeasure(m, find(m.key), bucket.rows);
      row[measureColKey(m)] = v;
      if (m.pctOfTotal && (m.agg === 'count' || m.agg === 'count_distinct')) {
        const g = grandVals[measureColKey(m)];
        row[measurePctKey(m)] = g && g > 0 && v != null ? (Number(v) / Number(g)) * 100 : null;
      }
    }
    outRows.push(row);
  }

  const grand: Row = { ...grandVals };
  dims.forEach((d) => { grand[d.key] = 'Total'; });
  for (const m of activeMeasures) {
    if (m.pctOfTotal && (m.agg === 'count' || m.agg === 'count_distinct')) {
      grand[measurePctKey(m)] = grandVals[measureColKey(m)] != null ? 100 : null;
    }
  }

  return { cols, rows: outRows, grand, sourceCount: rows.length };
}

/** Numeric fields suitable for sum/avg/min/max. */
export function numericMeasureFields(cols: ColumnDef[]): ColumnDef[] {
  return cols.filter((c) => isNumericMeasureField(c));
}

/** Dimension candidates — categorical / short text / dates; skip long free-text titles. */
export function dimensionCandidates(cols: ColumnDef[]): ColumnDef[] {
  return cols.filter((c) => {
    if (c.key.startsWith('link_') && c.key.endsWith('_names')) return false;
    if (c.type === 'linkage') return false;
    if (c.type === 'badge' || c.type === 'date') return true;
    if (c.type === 'number') return false;
    if (/^(title|name|description|statement|objective)$/i.test(c.key)) return false;
    return c.type === 'text';
  });
}

export function newMeasureId(existing: Measure[]): string {
  let n = existing.length;
  const ids = new Set(existing.map((m) => m.id));
  while (ids.has(`m${n}`)) n += 1;
  return `m${n}`;
}

/** Whether every group-by + measure field is a real (non-linkage / non-xmod) column
 *  that the server can aggregate — used to prefer SQL GROUP BY. */
export function canServerAggregate(
  groupBy: string[],
  measures: Measure[],
  serverFilterableKeys: Set<string> | string[],
): boolean {
  const allow = serverFilterableKeys instanceof Set
    ? serverFilterableKeys
    : new Set(serverFilterableKeys);
  // Also allow any field that appears as a sortable/filterable identity.
  for (const k of groupBy) {
    if (!k || k.startsWith('link_') || k.startsWith('xmod_')) return false;
    if (allow.size && !allow.has(k)) return false;
  }
  for (const m of measures) {
    if (m.agg === 'count' && !m.key) continue;
    if (!m.key) return false;
    if (m.key.startsWith('link_') || m.key.startsWith('xmod_')) return false;
    if (allow.size && !allow.has(m.key)) return false;
  }
  return true;
}
