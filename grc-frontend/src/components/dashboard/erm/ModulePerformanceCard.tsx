'use client';

import { ArrowUpRight } from 'lucide-react';
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import type { ModulePerformance, Section } from './types';
import { BAND_COLOR, bandColor } from './scoring';

/**
 * Module performance hero — 100% graphical: score + grade, a band gauge with
 * the 85 target tick, and a weighted section-contribution bar (colored by
 * band, with a grey segment for the sections still to launch). Clickable →
 * module breakdown popup.
 */
const SHORT_LABEL: Record<string, string> = {
  register: 'Register',
  assessments: 'Assess',
  rcsa: 'RCSA',
  controls: 'Controls',
  vendor_risk: 'Vendor',
  kris: 'KRIs',
  appetite: 'Appetite',
  mitigation: 'Mitig.',
  reviews: 'Reviews',
  incidents: 'Inc.',
};

export default function ModulePerformanceCard({
  perf,
  sections,
  onClick,
}: {
  perf: ModulePerformance;
  sections: Section[];
  onClick: () => void;
}) {
  const scoreColor = bandColor(perf.score);
  const liveWeight = sections.reduce((sum, s) => sum + s.weight, 0);
  const pendingWeight = 1 - liveWeight > 0.005 ? 1 - liveWeight : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all duration-200 hover:border-primary-400 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-slate-400">Module Performance</p>
          <div className="mt-1.5 flex items-end gap-3">
            <span className="text-[52px] font-bold leading-none tracking-tight" style={{ color: scoreColor }}>
              {perf.score}
            </span>
            <span
              className="mb-2 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
              style={{ backgroundColor: `${scoreColor}14`, color: scoreColor }}
            >
              {perf.grade}
            </span>
          </div>
        </div>
        <ArrowUpRight className="h-[18px] w-[18px] text-slate-300 transition-colors group-hover:text-primary-500" />
      </div>

      {/* Section band mix — fills the card's vertical rhythm with judgment */}
      <div className="mt-4 flex flex-wrap gap-2">
        {([
          ['strong', '#059669', sections.filter((s) => (s.score ?? 0) >= 80).length],
          ['fair', '#d97706', sections.filter((s) => (s.score ?? -1) >= 60 && (s.score ?? 0) < 80).length],
          ['weak', '#e11d48', sections.filter((s) => s.score != null && (s.score as number) < 60).length],
        ] as Array<[string, string, number]>).map(([label, color, count]) => (
          <span
            key={label}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
            style={{ backgroundColor: `${color}12`, color }}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            {count} {label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10.5px] font-semibold text-slate-500">
          {sections.length} sections live
        </span>
      </div>


      {/* Section-score profile — worst to best against the 85 target, filling
          the card's middle with the module's shape, not empty air */}
      <div className="mt-3 min-h-[110px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={sections
              .filter((s) => s.score != null)
              .sort((a, b) => (a.score as number) - (b.score as number))
              .map((s) => ({ label: s.label, score: Math.round(s.score as number) }))}
            margin={{ top: 12, right: 34, bottom: 4, left: 10 }}
          >
            <defs>
              <linearGradient id="erm-module-profile" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={scoreColor} stopOpacity={0.28} />
                <stop offset="100%" stopColor={scoreColor} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <YAxis domain={[0, 100]} hide />
            <ReferenceLine
              y={85}
              stroke="#334155"
              strokeWidth={1.2}
              strokeDasharray="4 3"
              label={{ value: '85', position: 'right', fontSize: 9, fill: '#94a3b8' }}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', color: '#1e293b' }}
              formatter={(value) => [`${value}`, 'score']}
            />
            <Area
              type="monotone"
              dataKey="score"
              stroke={scoreColor}
              strokeWidth={2.5}
              strokeLinecap="round"
              fill="url(#erm-module-profile)"
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

      {/* Band gauge */}
      <div className="pt-4">
        <div className="relative flex h-4 overflow-hidden rounded-md">
          <div className="w-[60%] bg-rose-100/70" />
          <div className="w-[20%] bg-amber-100/70" />
          <div className="w-[20%] bg-emerald-100/70" />
          {/* 85 target tick */}
          <div className="absolute inset-y-0 left-[85%] w-px border-l border-dashed border-slate-600" />
        </div>
        <div className="relative h-0">
          {/* score marker */}
          <div
            className="absolute -top-[30px] h-0 w-0 -translate-x-1/2"
            style={{
              left: `${perf.score}%`,
              borderLeft: '6px solid transparent',
              borderRight: '6px solid transparent',
              borderTop: `8px solid ${scoreColor}`,
            }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[9.5px] text-slate-400">
          <span>0</span>
          <span>weak</span>
          <span>60</span>
          <span>fair</span>
          <span>80</span>
          <span className="font-semibold text-slate-600">85 target</span>
          <span>100</span>
        </div>
      </div>

      {/* Weighted contribution */}
      <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.05em] text-slate-400">
        Weighted contribution by section
      </p>
      <div className="flex h-[26px] gap-0.5 overflow-hidden rounded-md">
        {sections.map((s) => (
          <div
            key={s.key}
            title={`${s.label} · ${Math.round(s.weight * 100)}% weight · score ${s.score ?? '—'}`}
            className="flex items-center justify-center text-[9.5px] font-semibold text-white"
            style={{ width: `${s.weight * 100}%`, backgroundColor: bandColor(s.score) }}
          >
            {s.weight >= 0.07 ? SHORT_LABEL[s.key] ?? s.label.split(' ')[0] : ''}
          </div>
        ))}
        {pendingWeight > 0 && (
          <div
            title={`${perf.upcomingSections} sections arriving soon — ${Math.round(pendingWeight * 100)}% of module weight`}
            className="flex items-center justify-center bg-slate-300 text-[9.5px] font-semibold text-slate-600"
            style={{ width: `${pendingWeight * 100}%` }}
          >
            {perf.upcomingSections} arriving
          </div>
        )}
      </div>
    </button>
  );
}
