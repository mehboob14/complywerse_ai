import type { ChartKind, ColumnDef, ReportSpec, Row } from './types';
import { fieldDomain } from './pivot';

/** Empty-first: never auto-pick columns. Users add exactly what they want. */
export function defaultVisibleColumns(_cols: ColumnDef[]): string[] {
  return [];
}

export function groupByKey(spec: ReportSpec): string | null {
  return spec.rows[0] ?? null;
}

/** Chart-friendly fields: badges, short enums, dates — not free-text titles. */
export function chartGroupCandidates(cols: ColumnDef[]): ColumnDef[] {
  return cols.filter((c) => {
    if (c.key.startsWith('link_') && c.key.endsWith('_names')) return false;
    if (c.type === 'badge') return true;
    if (c.type === 'date') return true;
    if (/category|status|severity|type|criticality|register|state|phase/i.test(c.key)) return true;
    return false;
  });
}

export interface ChartReadiness {
  ok: boolean;
  issues: string[];
  suggestion?: string;
}

export function chartReadiness(
  spec: ReportSpec,
  cols: ColumnDef[],
  rows: Row[],
): ChartReadiness {
  if (spec.view === 'table') return { ok: true, issues: [] };

  const issues: string[] = [];
  const group = groupByKey(spec);
  const split = spec.col;
  const kind = spec.view as ChartKind;

  if (!group) {
    issues.push('Choose what to group the chart by (e.g. Category or Severity).');
  }
  if (group && split && group === split) {
    issues.push('“Group by” and “Split by” cannot be the same field.');
  }
  if (group) {
    const col = cols.find((c) => c.key === group);
    if (col) {
      const domain = fieldDomain(col, rows);
      if (domain.length > 16 && (col.type === 'text' || col.key === 'title' || col.key === 'name')) {
        issues.push(
          `“${col.label}” has ${domain.length} unique values — charts become unreadable. Use Category, Status, or Severity instead.`,
        );
      }
      if ((kind === 'pie' || kind === 'donut') && domain.length > 8) {
        issues.push(`Pie/Donut works best with ≤6 categories — “${col.label}” has ${domain.length}. Try Treemap or a Bar chart.`);
      }
    }
  }
  if (!spec.measures.length) {
    issues.push('Pick a value to plot (usually Count).');
  }
  if (kind === 'scatter') {
    const numeric = spec.measures.filter((m) => m.key).length;
    if (numeric < 2) {
      issues.push('Scatter needs two numeric measures (X and Y). Add a second Value in Chart setup.');
    }
  }
  if ((kind === 'stacked' || kind === 'stacked100' || kind === 'heatmap') && !split) {
    issues.push(
      kind === 'heatmap'
        ? 'Heatmap needs a Split-by field to form the grid columns.'
        : 'Stacked charts need a Split-by field so each bar shows composition.',
    );
  }
  if ((kind === 'pie' || kind === 'donut') && split) {
    issues.push('Pie and Donut use a single series — clear Split-by, or switch to Stacked / Treemap.');
  }

  const ok = issues.length === 0;
  let suggestion: string | undefined;
  if (!ok && !group) {
    const candidates = chartGroupCandidates(cols);
    if (candidates[0]) {
      suggestion = `Try grouping by “${candidates[0].label}”.`;
    }
  }
  return { ok, issues, suggestion };
}

/** Prefer column chart when many long category labels would break horizontal bars. */
export function effectiveChartKind(kind: ChartKind, categoryCount: number, groupCol?: ColumnDef): ChartKind {
  if (kind === 'hbar' && categoryCount > 10) return 'bar';
  if (kind === 'hbar' && groupCol?.type === 'text' && categoryCount > 6) return 'bar';
  return kind;
}

export function toggleVisibleColumn(current: string[], key: string): string[] {
  return current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
}

/** Move a column key within the visible order. */
export function reorderColumnKeys(order: string[], from: string, to: string): string[] {
  if (from === to) return order;
  const base = order.slice();
  const fi = base.indexOf(from);
  const ti = base.indexOf(to);
  if (fi < 0 || ti < 0) return order;
  base.splice(ti, 0, base.splice(fi, 1)[0]);
  return base;
}

export function moveColumnKey(order: string[], key: string, dir: -1 | 1): string[] {
  const i = order.indexOf(key);
  if (i < 0) return order;
  const j = i + dir;
  if (j < 0 || j >= order.length) return order;
  const base = order.slice();
  [base[i], base[j]] = [base[j], base[i]];
  return base;
}

export function cellAlign(col: ColumnDef, overrides?: Record<string, 'left' | 'right'>): 'left' | 'right' {
  return overrides?.[col.key] ?? col.align ?? 'left';
}

export function cellDisplay(col: ColumnDef, row: Row): string {
  const raw = col.accessor ? col.accessor(row) : row[col.key];
  if (col.format) return col.format(raw, row);
  if (raw == null || raw === '') return '—';
  return String(raw);
}
