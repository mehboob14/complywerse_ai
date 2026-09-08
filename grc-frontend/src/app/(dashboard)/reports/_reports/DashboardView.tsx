'use client';

// Dashboard view — every visible column rendered as the chart its own shape
// warrants, with no configuration from the user.
//
// The design problem this solves: the chart view needs a Summarize setup before
// it can draw anything, so a user who has only picked columns hits "Add a Value
// to chart" and gives up. Here each column is pivoted to a count on the fly, so
// picking columns is the only setup there is.
//
// Chart choice is driven by the data, not by preference — see `analyse()`. The
// cases that matter are the degenerate ones: a column where every row is blank,
// a column with one distinct value, and a column that is effectively unique per
// row. Each of those draws a *readable* card instead of a misleading chart.
//
// Everything is built through buildPivot + PivotChart so the validated palette,
// the 8-series / 6-slice caps and the "Other" folding all apply unchanged.

import { useMemo } from 'react';
import { BarChart3, LayoutGrid, Minus } from 'lucide-react';
import PivotChart from './PivotChart';
import { buildPivot } from './pivot';
import { displayText, numericValue } from './grid-utils';
import type { ChartKind, ColumnDef, Measure, Row } from './types';
import { SERIES } from './vizPalette';

/** One count measure, reused for every card. */
const COUNT: Measure[] = [{ id: 'n', key: '', agg: 'count' }];

/** Above this, a categorical column is charted as a ranked top-N with the tail
 *  folded rather than drawn — 400 bars is not a chart, it is a wall. */
const MAX_BARS = 12;
/** Donuts read as part-to-whole only while the eye can hold the slices. */
const MAX_DONUT_SLICES = 6;
/** A numeric column with few enough distinct values is really a category
 *  (severity 1–5, inherent 3/6/9) and charts far better as one. */
const NUMERIC_AS_CATEGORY = 12;
/** Past this a column is effectively an identifier or free text: charting its
 *  distribution says nothing, so we show fill and cardinality instead. */
const UNIQUE_RATIO = 0.8;
/** Full analysis above this row count is slow enough to feel broken, so we
 *  sample deterministically and say so rather than freezing the tab. */
const MAX_ANALYSE = 100_000;

type CardKind =
  | { kind: 'chart'; chart: ChartKind; note?: string }
  | { kind: 'empty' }
  | { kind: 'single'; value: string }
  | { kind: 'unique' }
  | { kind: 'numeric-summary' };

interface Analysis {
  col: ColumnDef;
  label: string;
  filled: number;
  total: number;
  distinct: number;
  numeric: boolean;
  card: CardKind;
  stats?: { min: number; max: number; avg: number };
}

const BLANK = '—';

/** Decide what this column should look like, from the data alone. */
function analyse(col: ColumnDef, rows: Row[], label: string): Analysis {
  const total = rows.length;
  const seen = new Set<string>();
  let filled = 0;
  let numericCount = 0;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;

  for (const r of rows) {
    const t = displayText(col, r).trim();
    if (t && t !== BLANK) {
      filled += 1;
      seen.add(t);
    }
    const n = numericValue(col, r);
    if (n !== null) {
      numericCount += 1;
      sum += n;
      if (n < min) min = n;
      if (n > max) max = n;
    }
  }

  const distinct = seen.size;
  // "Numeric" means most present values parse as numbers — a text column with a
  // stray "3" in it should not be treated as a measure.
  const numeric = filled > 0 && numericCount >= filled * 0.9;
  const stats = numericCount > 0 ? { min, max, avg: sum / numericCount } : undefined;

  const base = { col, label, filled, total, distinct, numeric, stats };

  if (total === 0) return { ...base, card: { kind: 'empty' } };
  if (filled === 0) return { ...base, card: { kind: 'empty' } };
  if (distinct === 1) return { ...base, card: { kind: 'single', value: Array.from(seen)[0] } };

  // Effectively unique — an id, a description, a free-text note. A distribution
  // of 200 one-row categories is noise; the useful facts are fill and spread.
  if (distinct > MAX_BARS && distinct >= filled * UNIQUE_RATIO) {
    return { ...base, card: numeric ? { kind: 'numeric-summary' } : { kind: 'unique' } };
  }

  // A numeric column with real spread is summarised, not sliced.
  if (numeric && distinct > NUMERIC_AS_CATEGORY) {
    return { ...base, card: { kind: 'numeric-summary' } };
  }

  if (distinct <= MAX_DONUT_SLICES) {
    return { ...base, card: { kind: 'chart', chart: 'donut' } };
  }
  return {
    ...base,
    card: {
      kind: 'chart',
      chart: 'hbar',
      note: distinct > MAX_BARS ? `Top ${MAX_BARS} of ${distinct} values` : undefined,
    },
  };
}

/** Keep the n largest nodes and fold the rest into "Other".
 *  Safe because every card measures `count`, which is additive. */
function foldTail(
  result: ReturnType<typeof buildPivot>,
  n: number,
): ReturnType<typeof buildPivot> {
  if (result.nodes.length <= n) return result;
  const ranked = [...result.nodes].sort(
    (a, b) => Number(b.totals[0] ?? 0) - Number(a.totals[0] ?? 0),
  );
  const head = ranked.slice(0, n);
  const tail = ranked.slice(n);
  const tailTotal = tail.reduce((s, x) => s + Number(x.totals[0] ?? 0), 0);
  return {
    ...result,
    nodes: [
      ...head,
      {
        key: '__other__',
        label: `Other (${tail.length})`,
        depth: 0,
        count: tail.reduce((s, x) => s + x.count, 0),
        children: [],
        cells: [[tailTotal]],
        totals: [tailTotal],
      },
    ],
  };
}

function Card({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex shrink-0 items-baseline justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <h3 className="truncate text-xs font-semibold text-slate-800" title={title}>
          {title}
        </h3>
        {subtitle && (
          <span className="shrink-0 text-[10px] font-medium tabular-nums text-slate-400">{subtitle}</span>
        )}
      </header>
      <div className="min-h-0 flex-1 p-2.5">{children}</div>
      {footer && (
        <p className="shrink-0 border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">{footer}</p>
      )}
    </article>
  );
}

/** A column with nothing to chart still has something to say. */
function StatBody({
  primary,
  caption,
  tone = 'slate',
}: {
  primary: string;
  caption: string;
  tone?: 'slate' | 'muted';
}) {
  return (
    <div className="flex h-full min-h-[9rem] flex-col items-center justify-center px-2 text-center">
      <p
        className={`max-w-full truncate text-2xl font-bold tabular-nums ${
          tone === 'muted' ? 'text-slate-300' : 'text-slate-800'
        }`}
        title={primary}
      >
        {primary}
      </p>
      <p className="mt-1.5 max-w-full text-[11px] leading-snug text-slate-500">{caption}</p>
    </div>
  );
}

/** Min / average / max for a numeric column, with a proportional bar. */
function NumericBody({ stats, filled }: { stats: { min: number; max: number; avg: number }; filled: number }) {
  const span = stats.max - stats.min;
  const pos = span > 0 ? ((stats.avg - stats.min) / span) * 100 : 50;
  const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));
  return (
    <div className="flex h-full min-h-[9rem] flex-col justify-center gap-3 px-2">
      <div className="text-center">
        <p className="text-2xl font-bold tabular-nums text-slate-800">{fmt(stats.avg)}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">average across {filled.toLocaleString()} values</p>
      </div>
      <div>
        <div className="relative h-1.5 rounded-full bg-slate-100">
          <div
            className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full"
            style={{ left: `${Math.max(0, Math.min(100, pos))}%`, background: SERIES[0] }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[10px] tabular-nums text-slate-400">
          <span>min {fmt(stats.min)}</span>
          <span>max {fmt(stats.max)}</span>
        </div>
      </div>
    </div>
  );
}

export default function DashboardView({
  cols,
  rows,
  visibleKeys,
  labelFor,
  totalRows,
  showLegend = true,
  onOpenColumns,
}: {
  cols: ColumnDef[];
  rows: Row[];
  visibleKeys: string[];
  labelFor: (key: string) => string;
  /** Rows in the dataset before filtering — for the "no rows match" case. */
  totalRows: number;
  showLegend?: boolean;
  onOpenColumns?: () => void;
}) {
  // Sampling keeps a very large result set responsive. Deterministic (every Nth
  // row) so the picture doesn't shuffle between renders.
  const { sample, sampled } = useMemo(() => {
    if (rows.length <= MAX_ANALYSE) return { sample: rows, sampled: false };
    const step = Math.ceil(rows.length / MAX_ANALYSE);
    return { sample: rows.filter((_, i) => i % step === 0), sampled: true };
  }, [rows]);

  const analyses = useMemo(
    () =>
      visibleKeys
        .map((k) => cols.find((c) => c.key === k))
        .filter(Boolean)
        .map((c) => analyse(c as ColumnDef, sample, labelFor((c as ColumnDef).key))),
    [visibleKeys, cols, sample, labelFor],
  );

  // ── No columns picked ──────────────────────────────────────────────────────
  if (visibleKeys.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 text-center">
        <LayoutGrid className="h-9 w-9 text-slate-300" />
        <h2 className="mt-3 text-base font-semibold text-slate-800">Nothing to visualise yet</h2>
        <p className="mt-1 max-w-md text-sm text-slate-500">
          Add columns and each one appears here as a chart — a donut for a few categories, a
          ranked bar for many, a summary for numbers.
        </p>
        {onOpenColumns && (
          <button
            type="button"
            onClick={onOpenColumns}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Add columns
          </button>
        )}
      </div>
    );
  }

  // ── Columns picked, but no rows ────────────────────────────────────────────
  if (rows.length === 0) {
    const filteredOut = totalRows > 0;
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 text-center">
        <Minus className="h-9 w-9 text-slate-300" />
        <h2 className="mt-3 text-base font-semibold text-slate-800">
          {filteredOut ? 'No rows match your filters' : 'No data in this report yet'}
        </h2>
        <p className="mt-1 max-w-md text-sm text-slate-500">
          {filteredOut
            ? `All ${totalRows.toLocaleString()} rows were filtered out. Clear or widen a filter to see the charts.`
            : 'Once this module has records they will appear here as charts automatically.'}
        </p>
      </div>
    );
  }

  const chartable = analyses.filter((a) => a.card.kind === 'chart').length;

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {(sampled || chartable === 0) && (
        <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          {sampled
            ? `Charts estimated from a ${sample.length.toLocaleString()}-row sample of ${rows.length.toLocaleString()} — the table view has every row.`
            : 'None of these columns has a shape worth charting yet. The cards below show what each one holds.'}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 pb-1 sm:grid-cols-2 xl:grid-cols-3">
        {analyses.map((a) => {
          const pct = a.total > 0 ? Math.round((a.filled / a.total) * 100) : 0;
          const subtitle =
            a.card.kind === 'chart' || a.card.kind === 'single'
              ? `${a.distinct.toLocaleString()} value${a.distinct === 1 ? '' : 's'}`
              : `${pct}% filled`;

          // Blank column — say so rather than draw six identical empty slices.
          if (a.card.kind === 'empty') {
            return (
              <Card key={a.col.key} title={a.label} subtitle={subtitle}>
                <StatBody
                  tone="muted"
                  primary="—"
                  caption={`No values recorded in ${a.total.toLocaleString()} row${a.total === 1 ? '' : 's'}.`}
                />
              </Card>
            );
          }

          // One distinct value — a donut of a single slice tells you nothing.
          if (a.card.kind === 'single') {
            return (
              <Card key={a.col.key} title={a.label} subtitle={subtitle}>
                <StatBody
                  primary={a.card.value}
                  caption={
                    a.filled === a.total
                      ? `Every row (${a.total.toLocaleString()}) has this value.`
                      : `${a.filled.toLocaleString()} of ${a.total.toLocaleString()} rows; the rest are blank.`
                  }
                />
              </Card>
            );
          }

          if (a.card.kind === 'numeric-summary' && a.stats) {
            return (
              <Card key={a.col.key} title={a.label} subtitle={subtitle}>
                <NumericBody stats={a.stats} filled={a.filled} />
              </Card>
            );
          }

          // Effectively unique — identifiers, free text.
          if (a.card.kind === 'unique' || a.card.kind === 'numeric-summary') {
            return (
              <Card
                key={a.col.key}
                title={a.label}
                subtitle={subtitle}
                footer="Nearly unique per row — not a distribution."
              >
                <StatBody
                  primary={a.distinct.toLocaleString()}
                  caption={`distinct values across ${a.filled.toLocaleString()} filled row${a.filled === 1 ? '' : 's'}.`}
                />
              </Card>
            );
          }

          // ── Chartable ────────────────────────────────────────────────────
          const chart = a.card.chart;
          let result = buildPivot(cols, sample, [a.col.key], null, COUNT);
          // Numeric categories read wrong in alphabetical order (10 before 2).
          if (a.numeric) {
            result = {
              ...result,
              nodes: [...result.nodes].sort(
                (x, y) => (parseFloat(x.label) || 0) - (parseFloat(y.label) || 0),
              ),
            };
          }
          if (chart === 'hbar') result = foldTail(result, MAX_BARS);

          return (
            <Card
              key={a.col.key}
              title={a.label}
              subtitle={subtitle}
              footer={
                a.card.note ??
                (a.filled < a.total
                  ? `${(a.total - a.filled).toLocaleString()} row${a.total - a.filled === 1 ? '' : 's'} blank, not charted.`
                  : undefined)
              }
            >
              <div className="h-[13rem]">
                <PivotChart
                  result={result}
                  kind={chart}
                  measureIdx={0}
                  colDomain={['']}
                  options={{ legend: showLegend && chart === 'donut', labels: false }}
                />
              </div>
            </Card>
          );
        })}
      </div>

      <p className="py-2 text-center text-[10px] text-slate-400">
        Chart type follows each column&apos;s shape — donut for a few categories, ranked bar for
        many, a summary for numbers. Colour and slice limits are fixed by the palette rules.
      </p>
    </div>
  );
}
