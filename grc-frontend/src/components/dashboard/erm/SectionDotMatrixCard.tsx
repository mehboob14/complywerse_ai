'use client';

import type { Section } from './types';
import { BAND_COLOR, BAND_LABEL, BAND_PILL, bandColor, bandOf } from './scoring';

const ROWS = 10; // one dot = 10 points

/**
 * Dot-matrix variant — each metric is a vertical stack of 10 dots (1 dot = 10
 * points): filled dots in the metric's band color, the remainder muted, with
 * the dashed 85 target crossing the stacks. No per-metric text on the card.
 */
export default function SectionDotMatrixCard({ section, onClick }: { section: Section; onClick: () => void }) {
  const band = bandOf(section.score);
  const color = BAND_COLOR[band];
  const scored = section.metrics.filter((m) => m.score != null);

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

        <div className="relative h-[134px] w-full pb-2">
          {scored.length > 0 ? (
            <>
              {/* 85 target line: dots stack bottom-up, so 85 sits 15% from the top */}
              <div className="pointer-events-none absolute inset-x-0" style={{ top: '15%' }}>
                <div className="border-t-[1.2px] border-dashed border-slate-600" />
                <span className="absolute -top-1.5 right-0 text-[9px] text-slate-400">85</span>
              </div>
              <div className="flex h-full items-end justify-evenly gap-1 pr-6">
                {scored.map((m) => {
                  const filled = Math.max(1, Math.min(ROWS, Math.round(((m.score as number) / 100) * ROWS)));
                  const dotColor = bandColor(m.score);
                  return (
                    <div
                      key={m.label}
                      title={`${m.label}: ${Math.round(m.score as number)}%`}
                      className="flex h-full flex-col-reverse items-center justify-start gap-[3px]"
                    >
                      {Array.from({ length: ROWS }, (_, i) => (
                        <span
                          key={i}
                          className="block h-[9px] w-[9px] rounded-full transition-colors"
                          style={{ backgroundColor: i < filled ? dotColor : '#e2e8f0' }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-slate-400">No data yet</div>
          )}
        </div>
      </div>
    </button>
  );
}
