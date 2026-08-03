// Pivot engine — turns flat rows into a nested row tree crossed with an optional
// column field, aggregated by one or more measures. Pure + synchronous so the
// builder can re-run it live on every keystroke.
//
// Shape: rows[] are the tree levels (rows[0] is the outermost group), `col` pivots
// across, and each node carries `cells[colIdx][measureIdx]` plus `totals[measureIdx]`
// (the row's total across all columns). Every branch node aggregates its own rows
// directly — subtotals are computed from source rows, never from child aggregates,
// so `avg` is a true average and not an average-of-averages.

import type { AggFn, ColumnDef, Measure, Row } from './types';
import { displayText, groupRows, numericValue } from './grid-utils';

export type { AggFn, Measure };

export const AGG_LABEL: Record<AggFn, string> = {
  count: 'How many',
  count_distinct: 'Unique',
  sum: 'Total',
  avg: 'Average',
  min: 'Lowest',
  max: 'Highest',
};
/** Aggregations that can be summed across a folded tail without lying. */
export const ADDITIVE: AggFn[] = ['count', 'sum'];

export interface PivotNode {
  key: string;           // stable path key (parent path + level + label)
  label: string;
  depth: number;
  count: number;         // source rows behind this node
  children: PivotNode[];
  cells: (number | null)[][];  // [colIdx][measureIdx]
  totals: (number | null)[];   // [measureIdx] across all columns
}

export interface PivotResult {
  colKeys: string[];      // [''] when there is no column field
  hasCol: boolean;
  rowFields: ColumnDef[];
  measures: Measure[];
  nodes: PivotNode[];
  grand: { cells: (number | null)[][]; totals: (number | null)[]; count: number };
}

const BLANK = '—';

/** Single-pass aggregate. Avoids Math.min(...arr) so it stays safe on big sets. */
export function runAgg(fn: AggFn, col: ColumnDef | undefined, rows: Row[]): number | null {
  if (fn === 'count') return rows.length;
  if (fn === 'count_distinct') {
    if (!col) return 0;
    const set = new Set<string>();
    for (const r of rows) {
      const t = displayText(col, r);
      if (t) set.add(t);
    }
    return set.size;
  }
  if (!col) return null;
  let n = 0, sum = 0, min = Infinity, max = -Infinity;
  for (const r of rows) {
    const v = numericValue(col, r); // null for blanks — never counted as 0
    if (v === null) continue;
    n += 1; sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (n === 0) return null;
  switch (fn) {
    case 'sum': return sum;
    case 'avg': return sum / n;
    case 'min': return min;
    case 'max': return max;
    default: return null;
  }
}

/** Distinct display values of a field, in stable sorted order. Pass the UNFILTERED
 *  rows to get a colour domain that doesn't shift when filters change. */
export function fieldDomain(col: ColumnDef | undefined, rows: Row[]): string[] {
  if (!col) return [];
  const set = new Set<string>();
  for (const r of rows) set.add(displayText(col, r) || BLANK);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function buildPivot(
  cols: ColumnDef[],
  rows: Row[],
  rowKeys: string[],
  colKey: string | null,
  measures: Measure[],
): PivotResult {
  const find = (k: string) => cols.find((c) => c.key === k);
  const rowFields = rowKeys.map(find).filter(Boolean) as ColumnDef[];
  const colField = colKey ? find(colKey) ?? null : null;
  const hasCol = !!colField;
  const colKeys = colField ? fieldDomain(colField, rows) : [''];

  const cellsFor = (rs: Row[]): (number | null)[][] =>
    colKeys.map((ck) => {
      const sub = colField ? rs.filter((r) => (displayText(colField, r) || BLANK) === ck) : rs;
      return measures.map((m) => runAgg(m.agg, find(m.key), sub));
    });
  const totalsFor = (rs: Row[]): (number | null)[] =>
    measures.map((m) => runAgg(m.agg, find(m.key), rs));

  const build = (rs: Row[], depth: number, prefix: string): PivotNode[] => {
    if (depth >= rowFields.length) return [];
    return groupRows(rowFields[depth], rs).map((g) => {
      //  delimiter (can't appear in a display label) so a label containing
      // "/" or ":" can't forge another node's path key.
      const key = `${prefix}${depth}${g.key}`;
      return {
        key,
        label: g.key,
        depth,
        count: g.rows.length,
        children: build(g.rows, depth + 1, key),
        cells: cellsFor(g.rows),
        totals: totalsFor(g.rows),
      };
    });
  };

  return {
    colKeys,
    hasCol,
    rowFields,
    measures,
    nodes: build(rows, 0, ''),
    grand: { cells: cellsFor(rows), totals: totalsFor(rows), count: rows.length },
  };
}

/** Format an aggregated value for display. */
export function fmtAgg(v: number | null, fn: AggFn): string {
  if (v == null) return '';
  if (fn === 'count' || fn === 'count_distinct') return v.toLocaleString();
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toLocaleString() : rounded.toFixed(1);
}

/** Flatten a pivot into tabular columns+rows — the single shape every export
 *  (CSV, Excel, Word, PDF) is built from, so they can't drift apart. Emits every
 *  node (branches included) with its row path, so subtotal rows survive export. */
export function flattenPivot(result: PivotResult, labelFor: (key: string) => string): { cols: ColumnDef[]; rows: Row[] } {
  const { rowFields, colKeys, hasCol, measures, nodes } = result;
  const mLabel = (m: Measure) => {
    if (m.agg === 'count' && !m.key) return 'How many';
    if (m.agg === 'count_distinct') return `Unique ${labelFor(m.key)}`;
    return `${AGG_LABEL[m.agg]} ${labelFor(m.key)}`;
  };

  const cols: ColumnDef[] = rowFields.map((f, i) => ({ key: `r${i}`, label: f.label, type: 'text' as const }));
  if (hasCol) {
    colKeys.forEach((ck) => measures.forEach((m) => cols.push({ key: `c_${ck}_${m.id}`, label: `${ck} · ${mLabel(m)}`, type: 'number' })));
    measures.forEach((m) => cols.push({ key: `t_${m.id}`, label: `Total · ${mLabel(m)}`, type: 'number' }));
  } else {
    measures.forEach((m) => cols.push({ key: `t_${m.id}`, label: mLabel(m), type: 'number' }));
  }

  const rows: Row[] = [];
  const walk = (ns: PivotNode[], path: string[]) => ns.forEach((n) => {
    const p = [...path, n.label];
    const row: Row = {};
    rowFields.forEach((f, i) => { row[`r${i}`] = p[i] ?? ''; });
    if (hasCol) {
      colKeys.forEach((ck, ci) => measures.forEach((m, mi) => { row[`c_${ck}_${m.id}`] = n.cells[ci]?.[mi] ?? ''; }));
      measures.forEach((m, mi) => { row[`t_${m.id}`] = n.totals[mi] ?? ''; });
    } else {
      measures.forEach((m, mi) => { row[`t_${m.id}`] = n.cells[0]?.[mi] ?? ''; });
    }
    rows.push(row);
    if (n.children.length) walk(n.children, p);
  });
  walk(nodes, []);
  return { cols, rows };
}

/** Collect every node key (for expand-all). */
export function allNodeKeys(nodes: PivotNode[]): string[] {
  const out: string[] = [];
  const walk = (ns: PivotNode[]) => ns.forEach((n) => { if (n.children.length) { out.push(n.key); walk(n.children); } });
  walk(nodes);
  return out;
}
