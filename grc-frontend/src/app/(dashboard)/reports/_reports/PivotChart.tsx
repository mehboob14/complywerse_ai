'use client';

// Chart view of a pivot result — 12 chart types, all built from the same pivot
// (rows = categories, the column field = series, one measure per chart).
//
// Deliberate constraints (see vizPalette.ts):
//  · ONE measure per chart (two measures of different scale ⇒ dual axis ⇒
//    invented correlations). Scatter is the sole exception: it plots measure 1
//    vs measure 2, which is its whole point.
//  · Colour follows the shown-series order from the validated categorical
//    palette; a filtered-out series never repaints the survivors.
//  · Series cap at 8 / pie slices at 6 — past that we cap and point at the Table
//    view rather than invent a 9th indistinguishable hue.

import { Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend,
  Line, LineChart, Pie, PieChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar,
  RadarChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, Treemap, XAxis,
  YAxis, ZAxis, LabelList,
} from 'recharts';
import type { PivotResult } from './pivot';
import { ADDITIVE, fmtAgg } from './pivot';
import type { ChartKind } from './types';
import { INK, MAX_SERIES, MAX_SLICES, OTHER, SERIES, heatColor, heatInk } from './vizPalette';

export type { ChartKind };

/** Picker metadata — grouped for the builder's chart menu. */
export interface ChartTypeDef {
  kind: ChartKind;
  label: string;
  group: 'Bars' | 'Trends' | 'Proportion' | 'Compare';
  blurb: string;
  tip: string;
}
export const CHART_TYPES: ChartTypeDef[] = [
  { kind: 'bar', label: 'Column', group: 'Bars', blurb: 'Compare values side by side', tip: 'Best for a handful of categories with clear rankings.' },
  { kind: 'hbar', label: 'Bar', group: 'Bars', blurb: 'Horizontal compare with long labels', tip: 'Use when category names are long or you have many rows.' },
  { kind: 'stacked', label: 'Stacked', group: 'Bars', blurb: 'Totals split into parts', tip: 'Needs a Split-by field so each bar shows composition.' },
  { kind: 'stacked100', label: '100% stack', group: 'Bars', blurb: 'Share of whole per category', tip: 'Compare mix (%) across categories, not absolute size.' },
  { kind: 'line', label: 'Line', group: 'Trends', blurb: 'Change across an ordered axis', tip: 'Works best with dates or a natural sequence.' },
  { kind: 'area', label: 'Area', group: 'Trends', blurb: 'Magnitude of change over time', tip: 'Same setup as Line — area emphasises volume.' },
  { kind: 'pie', label: 'Pie', group: 'Proportion', blurb: 'Parts of a single total', tip: 'Keep to ≤6 slices. One group field, no split.' },
  { kind: 'donut', label: 'Donut', group: 'Proportion', blurb: 'Parts of a total with centre focus', tip: 'Same rules as Pie — centre can show the total.' },
  { kind: 'treemap', label: 'Treemap', group: 'Proportion', blurb: 'Nested size of many parts', tip: 'Good when you have more categories than a pie can show.' },
  { kind: 'radar', label: 'Radar', group: 'Compare', blurb: 'Profile across several axes', tip: 'Compare a few series across the same set of dimensions.' },
  { kind: 'scatter', label: 'Scatter', group: 'Compare', blurb: 'Relationship between two measures', tip: 'Needs two numeric measures (X vs Y).' },
  { kind: 'heatmap', label: 'Heatmap', group: 'Compare', blurb: 'Intensity across a grid', tip: 'Needs Group-by and Split-by to form the matrix.' },
];

export const CHART_GROUPS: ChartTypeDef['group'][] = ['Bars', 'Trends', 'Proportion', 'Compare'];

const TOOLTIP = {
  contentStyle: { borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(15,23,42,0.08)', fontSize: 12, padding: '8px 10px' },
  labelStyle: { color: INK.primary, fontWeight: 600, marginBottom: 2 },
};
const AXIS = { tick: { fill: INK.muted, fontSize: 11 }, tickLine: false, axisLine: { stroke: INK.grid } };
const LEGEND = { wrapperStyle: { fontSize: 11, color: INK.secondary } };
const trunc = (s: string, n = 14) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full min-h-[240px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-6 text-center">
      <p className="max-w-xs text-sm text-slate-500">{children}</p>
    </div>
  );
}

export default function PivotChart({
  result, kind, measureIdx, colDomain, animate = true, options,
}: {
  result: PivotResult;
  kind: ChartKind;
  measureIdx: number;
  colDomain: string[];
  rowDomain?: string[];  // kept for callers; colour is by shown order now
  animate?: boolean;
  options?: { legend?: boolean; labels?: boolean };
}) {
  const { nodes, colKeys, hasCol, measures } = result;
  const m = measures[measureIdx];
  const legend = options?.legend !== false;   // default on
  const labels = !!options?.labels;
  const fmt = (v: unknown) => fmtAgg(Number(v), m?.agg ?? 'count');

  if (!m) return <Empty>Add a <span className="font-medium text-slate-700">Value</span> to chart.</Empty>;
  if (!nodes.length) return <Empty>Add a <span className="font-medium text-slate-700">Row</span> field to plot categories.</Empty>;

  // ── Shared: categories × series (the column field), capped at 8 series ──────
  const ranked = hasCol
    ? colKeys.map((ck, ci) => ({ ck, ci, mag: nodes.reduce((s, n) => s + Math.abs(Number(n.cells[ci]?.[measureIdx] ?? 0)), 0) })).sort((a, b) => b.mag - a.mag)
    : [];
  const shown = hasCol ? ranked.slice(0, MAX_SERIES).sort((a, b) => colDomain.indexOf(a.ck) - colDomain.indexOf(b.ck)) : [];
  const hiddenCount = hasCol ? Math.max(0, ranked.length - shown.length) : 0;
  const keys = hasCol ? shown.map((s) => s.ck) : ['Total'];
  const colorOf = (k: string) => (hasCol ? SERIES[Math.max(0, keys.indexOf(k)) % SERIES.length] : SERIES[0]);
  const data = nodes.map((n) => {
    const d: Record<string, string | number | null> = { name: n.label };
    if (hasCol) shown.forEach((s) => { d[s.ck] = n.cells[s.ci]?.[measureIdx] ?? null; });
    else d.Total = n.cells[0]?.[measureIdx] ?? null;
    return d;
  });
  const dense = data.length > 6;
  const capNote = hiddenCount > 0
    ? <p className="pt-1 text-center text-[11px] text-slate-400">Showing the {MAX_SERIES} largest of {ranked.length} series — the Table view has them all.</p>
    : null;
  const frame = (chart: ReactElement, note: ReactNode = capNote) => (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1"><ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer></div>
      {note}
    </div>
  );

  // ── Pie / Donut ────────────────────────────────────────────────────────────
  if (kind === 'pie' || kind === 'donut') {
    const all = nodes.map((n) => ({ name: n.label, value: Number(n.totals[measureIdx] ?? 0) }));
    const drawable = all.filter((s) => s.value > 0);
    const rankedS = [...drawable].sort((a, b) => b.value - a.value);
    const head = rankedS.slice(0, MAX_SLICES);
    const tail = rankedS.slice(MAX_SLICES);
    const additive = ADDITIVE.includes(m.agg);
    const folded = tail.length > 0 && additive;
    const slices = folded ? [...head, { name: 'Other', value: tail.reduce((s, x) => s + x.value, 0) }] : head;
    const dropped = all.length - drawable.length;
    return frame(
      <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <Pie data={slices} dataKey="value" nameKey="name" innerRadius={kind === 'donut' ? '52%' : 0} outerRadius="80%"
          paddingAngle={kind === 'donut' ? 2 : 0} stroke={INK.surface} strokeWidth={2} isAnimationActive={animate}
          label={labels ? (p: { name?: string; value?: number }) => `${p.name}: ${fmt(p.value)}` : undefined} labelLine={labels}>
          {slices.map((s, i) => <Cell key={s.name} fill={folded && i === slices.length - 1 ? OTHER : SERIES[i % SERIES.length]} />)}
        </Pie>
        <Tooltip {...TOOLTIP} formatter={(v) => fmt(v)} />
        {legend && slices.length > 1 && <Legend {...LEGEND} />}
      </PieChart>,
      (tail.length > 0 || dropped > 0) ? (
        <p className="pt-1 text-center text-[11px] text-slate-400">
          {tail.length > 0 && additive && `Smallest ${tail.length} grouped as "Other". `}
          {tail.length > 0 && !additive && `Top ${head.length} of ${nodes.length} — see the Table view for all. `}
          {dropped > 0 && `${dropped} group${dropped > 1 ? 's' : ''} with no positive value omitted.`}
        </p>
      ) : null,
    );
  }

  // ── Treemap (proportion by area) ────────────────────────────────────────────
  if (kind === 'treemap') {
    const tdata = nodes.map((n) => ({ name: n.label, size: Math.abs(Number(n.totals[measureIdx] ?? 0)) })).filter((d) => d.size > 0);
    if (!tdata.length) return <Empty>No positive values to size the treemap.</Empty>;
    return frame(
      <Treemap data={tdata} dataKey="size" stroke={INK.surface} isAnimationActive={animate}
        content={<TreemapCell />}>
        <Tooltip {...TOOLTIP} formatter={(v) => fmt(v)} />
      </Treemap>,
    );
  }

  // ── Radar (multi-axis compare; spokes = categories) ─────────────────────────
  if (kind === 'radar') {
    return frame(
      <RadarChart data={data} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <PolarGrid stroke={INK.grid} />
        <PolarAngleAxis dataKey="name" tick={{ fill: INK.muted, fontSize: 11 }} tickFormatter={(v: string) => trunc(String(v), 10)} />
        <PolarRadiusAxis tick={{ fill: INK.muted, fontSize: 10 }} axisLine={false} />
        <Tooltip {...TOOLTIP} formatter={(v) => fmt(v)} />
        {legend && keys.length > 1 && <Legend {...LEGEND} />}
        {keys.map((k) => <Radar key={k} name={k} dataKey={k} stroke={colorOf(k)} fill={colorOf(k)} fillOpacity={keys.length > 1 ? 0.15 : 0.3} isAnimationActive={animate} />)}
      </RadarChart>,
    );
  }

  // ── Scatter (measure 1 vs measure 2) ────────────────────────────────────────
  if (kind === 'scatter') {
    if (measures.length < 2) return <Empty>Scatter needs two <span className="font-medium text-slate-700">Values</span> — add another to plot X vs Y.</Empty>;
    const mx = measures[0], my = measures[1];
    const pts = nodes.map((n) => ({ name: n.label, x: Number(n.totals[0] ?? 0), y: Number(n.totals[1] ?? 0) }));
    const lbl = (mm: typeof mx) => (mm.agg === 'count' ? 'Count' : `${mm.agg} ${mm.key}`);
    return frame(
      <ScatterChart margin={{ top: 12, right: 16, bottom: 24, left: 4 }}>
        <CartesianGrid stroke={INK.grid} />
        <XAxis type="number" dataKey="x" name={lbl(mx)} {...AXIS} height={40}
          label={{ value: lbl(mx), position: 'insideBottom', offset: -2, fill: INK.muted, fontSize: 11 }} />
        <YAxis type="number" dataKey="y" name={lbl(my)} {...AXIS} width={52} />
        <ZAxis range={[60, 61]} />
        <Tooltip {...TOOLTIP} cursor={{ strokeDasharray: '3 3' }}
          formatter={(v: unknown, n: unknown) => [String(v), String(n)]}
          labelFormatter={() => ''} />
        <Scatter data={pts} fill={SERIES[0]} isAnimationActive={animate}>
          {labels && <LabelList dataKey="name" position="top" style={{ fontSize: 10, fill: INK.secondary }} />}
        </Scatter>
      </ScatterChart>,
      null,
    );
  }

  // ── Heatmap (categories × series grid, magnitude by colour) ─────────────────
  if (kind === 'heatmap') {
    const cols = hasCol ? shown.map((s) => ({ key: s.ck, ci: s.ci })) : [{ key: 'Total', ci: 0 }];
    const valAt = (n: typeof nodes[number], ci: number) => {
      const v = hasCol ? n.cells[ci]?.[measureIdx] : n.cells[0]?.[measureIdx];
      return typeof v === 'number' ? v : null;
    };
    let lo = Infinity, hi = -Infinity;
    for (const n of nodes) for (const c of cols) { const v = valAt(n, c.ci); if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }
    const span = hi - lo;
    const norm = (v: number | null) => (v == null ? NaN : span > 0 ? (v - lo) / span : 0.5);
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid gap-0.5" style={{ gridTemplateColumns: `minmax(120px, 180px) repeat(${cols.length}, minmax(64px, 1fr))` }}>
            <div className="sticky left-0 top-0 z-10 bg-white" />
            {cols.map((c) => (
              <div key={c.key} className="truncate px-2 py-1 text-center text-[11px] font-semibold text-slate-500" title={c.key}>{trunc(c.key, 12)}</div>
            ))}
            {nodes.map((n) => (
              <Fragment key={n.label}>
                <div className="sticky left-0 z-10 truncate bg-white px-2 py-1 text-[11px] font-medium text-slate-600" title={n.label}>{trunc(n.label, 20)}</div>
                {cols.map((c) => {
                  const v = valAt(n, c.ci); const t = norm(v);
                  return (
                    <div key={c.key} className="flex items-center justify-center rounded px-1 py-1.5 text-[11px] tabular-nums" title={`${n.label} · ${c.key}: ${fmt(v)}`}
                      style={{ background: heatColor(t), color: heatInk(t) }}>
                      {v == null ? '' : fmt(v)}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
        {hiddenCount > 0 && <p className="pt-1 text-center text-[11px] text-slate-400">Showing the {MAX_SERIES} largest of {ranked.length} columns — the Table view has them all.</p>}
      </div>
    );
  }

  // ── Cartesian: bar / hbar / stacked / stacked100 / line / area ──────────────
  const isBar = kind === 'bar' || kind === 'hbar' || kind === 'stacked' || kind === 'stacked100';
  const horizontal = kind === 'hbar';
  const stacked = kind === 'stacked' || kind === 'stacked100' || (kind === 'area' && keys.length > 1);
  const percent = kind === 'stacked100';
  const stackId = stacked ? 's' : undefined;

  const catAxis = horizontal
    ? <YAxis type="category" dataKey="name" width={120} tickFormatter={(v: string) => trunc(String(v))} interval={0} {...AXIS} />
    : <XAxis dataKey="name" tickFormatter={(v: string) => trunc(String(v))} interval={0} {...AXIS} {...(dense ? { angle: -30, textAnchor: 'end' as const, height: 64 } : { height: 28 })} />;
  const valAxis = horizontal
    ? <XAxis type="number" {...AXIS} height={28} tickFormatter={percent ? (v: number) => `${Math.round(v * 100)}%` : undefined} />
    : <YAxis {...AXIS} width={percent ? 46 : 52} tickFormatter={percent ? (v: number) => `${Math.round(v * 100)}%` : undefined} />;

  const common = { data, margin: { top: 8, right: 12, left: 0, bottom: 4 }, ...(percent ? { stackOffset: 'expand' as const } : {}) };
  const grid = <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke={INK.grid} />;
  const tip = <Tooltip {...TOOLTIP} cursor={isBar ? { fill: 'rgba(15,23,42,0.04)' } : undefined} formatter={(v) => fmt(v)} />;
  const leg = legend && keys.length > 1 ? <Legend {...LEGEND} /> : null;
  const dataLabel = labels && keys.length <= 3
    ? (k: string) => <LabelList dataKey={k} position={horizontal ? 'right' : 'top'} formatter={(v: unknown) => fmt(v)} style={{ fontSize: 10, fill: INK.secondary }} />
    : () => null;

  if (isBar) {
    return frame(
      <BarChart {...common} layout={horizontal ? 'vertical' : 'horizontal'} barGap={2} barCategoryGap={stacked ? '28%' : '22%'}>
        {grid}{horizontal ? valAxis : catAxis}{horizontal ? catAxis : valAxis}{tip}{leg}
        {keys.map((k) => (
          <Bar key={k} dataKey={k} stackId={stackId} fill={colorOf(k)} maxBarSize={stacked ? 60 : 44}
            radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]} isAnimationActive={animate}>
            {dataLabel(k)}
          </Bar>
        ))}
      </BarChart>,
    );
  }
  if (kind === 'area') {
    return frame(
      <AreaChart {...common}>
        {grid}{catAxis}{valAxis}{tip}{leg}
        {keys.map((k) => (
          <Area key={k} type="monotone" dataKey={k} stackId={stackId} stroke={colorOf(k)} fill={colorOf(k)}
            fillOpacity={stacked ? 0.75 : 0.25} strokeWidth={2} connectNulls isAnimationActive={animate}>
            {dataLabel(k)}
          </Area>
        ))}
      </AreaChart>,
    );
  }
  // line
  return frame(
    <LineChart {...common}>
      {grid}{catAxis}{valAxis}{tip}{leg}
      {keys.map((k) => (
        <Line key={k} type="monotone" dataKey={k} stroke={colorOf(k)} strokeWidth={2} connectNulls isAnimationActive={animate}
          dot={{ r: 3, strokeWidth: 2, stroke: INK.surface }} activeDot={{ r: 5, strokeWidth: 2, stroke: INK.surface }}>
          {dataLabel(k)}
        </Line>
      ))}
    </LineChart>,
  );
}

/** Treemap tile — colours by rank order, labels when the tile is big enough. */
function TreemapCell(props: Record<string, unknown>) {
  const { x, y, width, height, index, name } = props as { x: number; y: number; width: number; height: number; index: number; name: string };
  const fill = SERIES[(index ?? 0) % SERIES.length];
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#fff" strokeWidth={2} rx={2} />
      {width > 56 && height > 22 && (
        <text x={x + 6} y={y + 16} fill="#fff" fontSize={11} fontWeight={600}>{trunc(String(name ?? ''), Math.floor(width / 8))}</text>
      )}
    </g>
  );
}

