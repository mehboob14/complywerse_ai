'use client';

import { Area, AreaChart, ReferenceLine, ResponsiveContainer, YAxis } from 'recharts';
import type { Section } from './types';
import { BAND_COLOR, BAND_LABEL, BAND_PILL, bandColor, bandOf, TARGET } from './scoring';

/**
 * Section card — the ERM module's single chart family: a filled metric
 * PROFILE against the 85 target. No per-metric text on the card (labels live
 * in the hover tooltip and the detail popup); only section name, weight,
 * score, and band pill are printed. Fixed plot height + recharts responsive
 * width keep geometry identical whether a section has 2 metrics or 7.
 */
export default function SectionCard({ section, onClick }: { section: Section; onClick: () => void }) {
  const band = bandOf(section.score);
  const color = BAND_COLOR[band];
  const gradientId = `erm-grad-${section.key}`;

  // Scored metrics only, worst→best, so every card resolves to a clean
  // ascending profile a director can read in a glance.
  const data = section.metrics
    .filter((m) => m.score != null)
    .sort((a, b) => (a.score as number) - (b.score as number))
    .map((m) => ({ label: m.label, score: m.score as number }));

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
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 14, right: 10, bottom: 10, left: 10 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <YAxis domain={[0, 100]} hide />
              <ReferenceLine
                y={TARGET}
                stroke="#334155"
                strokeWidth={1.2}
                strokeDasharray="4 3"
                label={{ value: '85', position: 'right', fontSize: 9, fill: '#94a3b8' }}
              />
              <Area
                type="monotone"
                dataKey="score"
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
                dot={(props: { cx?: number; cy?: number; index?: number; payload?: { score: number } }) => (
                  <circle
                    key={props.index}
                    cx={props.cx}
                    cy={props.cy}
                    r={4}
                    fill={bandColor(props.payload?.score)}
                    stroke="#fff"
                    strokeWidth={2}
                  />
                )}
                activeDot={{ r: 5, strokeWidth: 2, stroke: '#fff' }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </button>
  );
}
