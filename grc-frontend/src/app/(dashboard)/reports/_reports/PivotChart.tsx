'use client';

// Chart view of a pivot result. Deliberate constraints (see vizPalette.ts):
//  · ONE measure per chart — two measures of different scale would mean a dual
//    axis, which invents correlations. Pick the measure instead.
//  · Colour comes from the field's UNFILTERED domain, so filtering a series out
//    never repaints the survivors.
//  · Series cap at 8 / slices at 6 — past that we cap and point at the Table view
//    rather than generating a 9th hue nobody can distinguish. A tail is only
//    folded into "Other" for additive aggregations (count/sum); folding an avg
//    would be an average-of-averages, so we cap instead.

import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import type { PivotResult } from './pivot';
import { ADDITIVE, fmtAgg } from './pivot';
import { INK, MAX_SERIES, MAX_SLICES, OTHER, SERIES } from './vizPalette';

export type ChartKind = 'bar' | 'line' | 'pie';

const TOOLTIP = {
  contentStyle: { borderRadius: 10, border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(15,23,42,0.08)', fontSize: 12, padding: '8px 10px' },
  labelStyle: { color: INK.primary, fontWeight: 600, marginBottom: 2 },
};
const AXIS = { tick: { fill: INK.muted, fontSize: 11 }, tickLine: false, axisLine: { stroke: INK.grid } };
const trunc = (s: string, n = 14) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export default function PivotChart({
  result, kind, measureIdx, colDomain, rowDomain, animate = true,
}: {
  result: PivotResult;
  kind: ChartKind;
  measureIdx: number;
  colDomain: string[];   // stable domain of the column field
  rowDomain: string[];   // stable domain of the outermost row field
  animate?: boolean;     // off for print — a snapshot must not catch a mid-animation frame
}) {
  const { nodes, colKeys, hasCol, measures } = result;
  const m = measures[measureIdx];

  if (!m || !nodes.length) {
    return (
      <div className="flex h-full min-h-[240px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-6 text-center">
        <p className="max-w-xs text-sm text-slate-500">
          {!m ? <>Add a <span className="font-medium text-slate-700">Value</span> to chart.</> : <>Add a <span className="font-medium text-slate-700">Row</span> field to plot categories.</>}
        </p>
      </div>
    );
  }

  // ── Pie: part-to-whole over the top-level row groups ──────────────────────
  if (kind === 'pie') {
    // Pie can only draw positive arcs, so ≤0 groups can't be shown.
    const all = nodes.map((n) => ({ name: n.label, value: Number(n.totals[measureIdx] ?? 0) }));
    const drawable = all.filter((s) => s.value > 0);
    const ranked = [...drawable].sort((a, b) => b.value - a.value);
    const head = ranked.slice(0, MAX_SLICES);
    const tail = ranked.slice(MAX_SLICES);
    const additive = ADDITIVE.includes(m.agg);
    const folded = tail.length > 0 && additive;
    const slices = folded
      ? [...head, { name: 'Other', value: tail.reduce((s, x) => s + x.value, 0) }]
      : head;
    const dropped = all.length - drawable.length; // groups omitted for a ≤0 value

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
              <Pie data={slices} dataKey="value" nameKey="name" innerRadius="52%" outerRadius="78%" paddingAngle={2} stroke={INK.surface} strokeWidth={2} isAnimationActive={animate}>
                {/* Colour by shown order (never grey a top slice); only the folded tail (last, when present) is grey. */}
                {slices.map((s, i) => <Cell key={s.name} fill={folded && i === slices.length - 1 ? OTHER : SERIES[i % SERIES.length]} />)}
              </Pie>
              <Tooltip {...TOOLTIP} formatter={(v) => fmtAgg(Number(v), m.agg)} />
              {slices.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: INK.secondary }} />}
            </PieChart>
          </ResponsiveContainer>
        </div>
        {(tail.length > 0 || dropped > 0) && (
          <p className="pt-1 text-center text-[11px] text-slate-400">
            {tail.length > 0 && additive && `Smallest ${tail.length} grouped as "Other". `}
            {tail.length > 0 && !additive && `Showing top ${head.length} of ${nodes.length} — see the Table view for all. `}
            {dropped > 0 && `${dropped} group${dropped > 1 ? 's' : ''} with no positive value omitted.`}
          </p>
        )}
      </div>
    );
  }

  // ── Bar / line: categories = top-level rows, series = column field ─────────
  const ranked = hasCol
    ? colKeys
        .map((ck, ci) => ({ ck, ci, mag: nodes.reduce((s, n) => s + Math.abs(Number(n.cells[ci]?.[measureIdx] ?? 0)), 0) }))
        .sort((a, b) => b.mag - a.mag)
    : [];
  const shown = hasCol ? ranked.slice(0, MAX_SERIES).sort((a, b) => colDomain.indexOf(a.ck) - colDomain.indexOf(b.ck)) : [];
  const hiddenCount = hasCol ? Math.max(0, ranked.length - shown.length) : 0;

  const data = nodes.map((n) => {
    const d: Record<string, string | number | null> = { name: n.label };
    if (hasCol) shown.forEach((s) => { d[s.ck] = n.cells[s.ci]?.[measureIdx] ?? null; });
    else d.Total = n.cells[0]?.[measureIdx] ?? null;
    return d;
  });
  const keys = hasCol ? shown.map((s) => s.ck) : ['Total'];
  // Colour by the entity's position among the SHOWN series (≤ MAX_SERIES), so a
  // top series is never dropped to grey just because its alphabetical domain
  // index is ≥ 8. For domains ≤ 8 this equals domain order (stable per entity).
  const colorOf = (k: string) => (hasCol ? SERIES[Math.max(0, keys.indexOf(k)) % SERIES.length] : SERIES[0]);
  const dense = data.length > 6;
  const xAxis = { ...AXIS, dataKey: 'name', tickFormatter: (v: string) => trunc(String(v)), interval: 0 as const, ...(dense ? { angle: -30, textAnchor: 'end' as const, height: 64 } : { height: 28 }) };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          {kind === 'bar' ? (
            <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }} barGap={2} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke={INK.grid} />
              <XAxis {...xAxis} />
              <YAxis {...AXIS} width={52} />
              <Tooltip {...TOOLTIP} cursor={{ fill: 'rgba(15,23,42,0.04)' }} formatter={(v) => fmtAgg(Number(v), m.agg)} />
              {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: INK.secondary }} />}
              {keys.map((k) => <Bar key={k} dataKey={k} fill={colorOf(k)} radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={animate} />)}
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid vertical={false} stroke={INK.grid} />
              <XAxis {...xAxis} />
              <YAxis {...AXIS} width={52} />
              <Tooltip {...TOOLTIP} formatter={(v) => fmtAgg(Number(v), m.agg)} />
              {keys.length > 1 && <Legend wrapperStyle={{ fontSize: 11, color: INK.secondary }} />}
              {keys.map((k) => (
                <Line key={k} type="monotone" dataKey={k} stroke={colorOf(k)} strokeWidth={2} connectNulls isAnimationActive={animate}
                  dot={{ r: 3, strokeWidth: 2, stroke: INK.surface }} activeDot={{ r: 5, strokeWidth: 2, stroke: INK.surface }} />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
      {hiddenCount > 0 && (
        <p className="pt-1 text-center text-[11px] text-slate-400">Showing the {MAX_SERIES} largest of {ranked.length} series — the Table view has them all.</p>
      )}
    </div>
  );
}
