'use client';

import { Wrench, ChevronRight } from 'lucide-react';
import type { Section } from './types';
import { bandColor } from './scoring';

/**
 * "Fix these first" — the lowest-scoring formulas across the whole module,
 * ranked. The single most actionable card on the page: each row deep-opens
 * the owning section's detail popup. Doubles as the grid filler so the
 * section area closes with no empty slots.
 */
export default function FixFirstCard({
  sections,
  onOpenSection,
  className = '',
}: {
  sections: Section[];
  onOpenSection: (key: string) => void;
  className?: string;
}) {
  const worst = sections
    .flatMap((s) =>
      s.metrics
        .filter((m) => m.score != null)
        .map((m) => ({ sectionKey: s.key, sectionLabel: s.label, metric: m })),
    )
    .sort((a, b) => (a.metric.score as number) - (b.metric.score as number))
    .slice(0, 5);

  return (
    <div className={`flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <div className="h-[3px] w-full bg-slate-800" />
      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-center gap-2">
          <Wrench className="h-4 w-4 text-slate-700" />
          <h3 className="text-sm font-semibold text-slate-800">Fix these first</h3>
          <span className="text-[10.5px] text-slate-400">— the five weakest formulas across the module</span>
        </div>

        <div className="flex flex-1 flex-col justify-center">
          {worst.map((row, index) => {
            const color = bandColor(row.metric.score);
            const pct = Math.round(row.metric.score as number);
            return (
              <button
                key={`${row.sectionKey}-${row.metric.label}`}
                type="button"
                onClick={() => onOpenSection(row.sectionKey)}
                className="group grid grid-cols-[18px_1fr_46px_44px_14px] items-center gap-2.5 rounded-lg px-1.5 py-[7px] text-left transition-colors hover:bg-slate-50"
              >
                <span className="text-[11px] font-bold text-slate-300">{index + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium text-slate-700">{row.metric.label}</span>
                  <span className="block truncate text-[10px] text-slate-400">
                    {row.sectionLabel} · {row.metric.count}
                  </span>
                  <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-slate-100">
                    <span className="block h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                  </span>
                </span>
                <span className="text-right text-[13px] font-bold tabular-nums" style={{ color }}>
                  {pct}%
                </span>
                <span
                  className="rounded-full py-[2px] text-center text-[8.5px] font-bold uppercase tracking-wide"
                  style={{ backgroundColor: `${color}14`, color }}
                >
                  {pct >= 80 ? 'strong' : pct >= 60 ? 'fair' : 'weak'}
                </span>
                <ChevronRight className="h-3.5 w-3.5 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
