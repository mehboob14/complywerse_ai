'use client';

import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import type { Section } from './types';
import { BAND_COLOR, BAND_LABEL, BAND_PILL, bandColor, bandOf, TARGET } from './scoring';

/**
 * Waterfall variant — each metric's weighted contribution steps the score up
 * (bars colored by the metric's own band), the final bar is the section score,
 * all against the dashed 85 target. No per-metric text on the card.
 */
export default function SectionWaterfallCard({ section, onClick }: { section: Section; onClick: () => void }) {
  const band = bandOf(section.score);
  const color = BAND_COLOR[band];

  const scored = section.metrics.filter((m) => m.score != null);
  const weightSum = scored.reduce((sum, m) => sum + m.weight, 0) || 1;
  let running = 0;
  const data = scored.map((m) => {
    const contribution = ((m.score as number) * m.weight) / weightSum;
    const row = {
      name: m.label,
      base: running,
      value: contribution,
      fill: bandColor(m.score),
      display: `${Math.round(m.score as number)}%`,
    };
    running += contribution;
    return row;
  });
  data.push({
    name: 'Section score',
    base: 0,
    value: section.score ?? 0,
    fill: color,
    display: `${Math.round(section.score ?? 0)}`,
  });

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
    >
      <div className="h-[3px] w-full" style={{ backgroundColor: color }} />
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-800">{section.label}</h3>
            <p className="mt-0.5 text-[10.5px] text-slate-400">{Math.round(section.weight * 100)}% of module score</p>
          </div>
          <div className="flex flex-shrink-0 flex-col items-end gap-1">
            <span className="text-2xl font-bold leading-none tracking-tight" style={{ color }}>
              {section.score == null ? '—' : Math.round(section.score)}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${BAND_PILL[band]}`}>
              {BAND_LABEL[band]}
            </span>
          </div>
        </div>

        <div className="h-[134px] w-full pb-1">
          {data.length > 1 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 14, right: 10, bottom: 10, left: 10 }} barCategoryGap="22%">
                <YAxis domain={[0, 100]} hide />
                <ReferenceLine
                  y={TARGET}
                  stroke="#334155"
                  strokeWidth={1.2}
                  strokeDasharray="4 3"
                  label={{ value: '85', position: 'right', fontSize: 9, fill: '#94a3b8' }}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(148,163,184,0.08)' }}
                  contentStyle={{ fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', color: '#1e293b' }}
                  formatter={(_v, _n, entry) => [(entry?.payload as { display: string })?.display, undefined]}
                  labelFormatter={(label) => String(label)}
                />
                <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
                <Bar dataKey="value" stackId="wf" radius={[3, 3, 3, 3]} isAnimationActive={false}>
                  {data.map((d) => (
                    <Cell key={d.name} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">No data yet</div>
          )}
        </div>
      </div>
    </button>
  );
}
