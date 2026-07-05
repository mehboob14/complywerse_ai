'use client';

/**
 * MixCharts — two compact, light-themed dashboard cards shared by the Assets &
 * Vulnerabilities workspaces:
 *   • SegmentedMixCard   — big total + segmented mix bar + sorted "exact values"
 *                          breakdown (a category distribution at a glance).
 *   • StackedOverTimeCard — stacked bars over time (per-period category mix).
 */

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';

export interface MixSlice { name: string; value: number; color: string }

/** One row per period, e.g. { label: 'Jun 26', critical: 2, high: 5, … }. */
export type StackedRow = Record<string, string | number>;

export function SegmentedMixCard({ totalLabel, data }: { totalLabel: string; data: MixSlice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold leading-none text-slate-900">{total}</span>
        <span className="text-xs text-slate-500">{totalLabel}</span>
      </div>
      {total > 0 ? (
        <>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
            {data.filter((d) => d.value > 0).map((d) => (
              <div key={d.name} style={{ width: `${(d.value / total) * 100}%`, backgroundColor: d.color }} title={`${d.name}: ${d.value}`} />
            ))}
          </div>
          <ul className="mt-2 space-y-1">
            {sorted.map((d) => (
              <li key={d.name} className="flex items-center gap-2 text-[11px]">
                <span className="flex w-16 shrink-0 items-center gap-1.5">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
                  <span className="truncate capitalize text-slate-600">{d.name}</span>
                </span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, backgroundColor: d.color }} />
                </span>
                <span className="w-6 shrink-0 text-right font-semibold text-slate-800">{d.value}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="py-6 text-center text-xs text-slate-400">No data yet</p>
      )}
    </div>
  );
}

export function StackedOverTimeCard({
  title, data, categories,
}: {
  title: string;
  data: StackedRow[];
  /** Bottom-to-top stacking order; each `name` must be a key on every row. */
  categories: MixSlice[];
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-card">
      <h3 className="mb-1.5 text-sm font-semibold text-slate-800">{title}</h3>
      {data.length === 0 ? (
        <p className="py-8 text-center text-xs text-slate-400">No dated data yet</p>
      ) : (
        <div className="h-28">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barCategoryGap="22%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} width={28} />
              <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} cursor={{ fill: '#f8fafc' }} />
              {categories.map((c, i) => (
                <Bar
                  key={c.name}
                  dataKey={c.name}
                  stackId="mix"
                  fill={c.color}
                  maxBarSize={44}
                  radius={i === categories.length - 1 ? [3, 3, 0, 0] : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {[...categories].reverse().map((c) => (
          <span key={c.name} className="inline-flex items-center gap-1 text-slate-500">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: c.color }} />
            <span className="capitalize">{c.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
