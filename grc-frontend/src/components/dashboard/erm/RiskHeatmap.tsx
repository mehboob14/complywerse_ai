'use client';

import { useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import type { HeatmapData } from './types';
import { heatCellColor } from './scoring';

type Mode = 'inherent' | 'residual';

/**
 * The module's signature 5×5 likelihood × impact matrix. Red→green cells,
 * count per cell, hover reveals the coordinate + count, and an inherent /
 * residual toggle.
 */
export default function RiskHeatmap({ data }: { data: HeatmapData }) {
  const [mode, setMode] = useState<Mode>('inherent');
  const matrix = data[mode];
  const total = matrix.flat().reduce((sum, n) => sum + n, 0);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Grid3x3 className="h-4 w-4 text-rose-600" />
          <span className="text-sm font-semibold text-slate-800">Risk Heatmap</span>
        </div>
        <div className="flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
          {(['inherent', 'residual'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 text-[11px] font-semibold capitalize transition-all ${
                mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2.5">
        <div className="flex items-center">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-slate-400 [writing-mode:vertical-rl] rotate-180">
            Likelihood
          </span>
        </div>
        <div className="flex-1">
          <div className="grid grid-cols-[18px_repeat(5,1fr)] gap-1">
            {matrix.map((row, ri) => {
              const likelihood = 5 - ri;
              return [
                <div key={`l-${likelihood}`} className="flex items-center justify-center text-[9.5px] font-semibold text-slate-400">
                  {likelihood}
                </div>,
                ...row.map((count, ci) => {
                  const impact = ci + 1;
                  const level = likelihood * impact;
                  return (
                    <div
                      key={`${likelihood}-${impact}`}
                      title={`Likelihood ${likelihood} × Impact ${impact} — ${count} risk${count === 1 ? '' : 's'} (${mode})`}
                      className="flex aspect-[1.5/1] items-center justify-center rounded-md text-[13px] font-bold text-slate-900 transition-transform hover:scale-[1.04]"
                      style={{ backgroundColor: heatCellColor(level) }}
                    >
                      {count > 0 ? count : ''}
                    </div>
                  );
                }),
              ];
            })}
            <div />
            {[1, 2, 3, 4, 5].map((impact) => (
              <div key={`i-${impact}`} className="text-center text-[9.5px] font-semibold text-slate-400">
                {impact}
              </div>
            ))}
          </div>
          <div className="mt-2 text-center text-[9.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">Impact</div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
          Low
          <span className="inline-block h-2 w-[90px] rounded-full bg-[linear-gradient(90deg,#86efac,#fde047,#fb923c,#f87171)]" />
          Critical
        </div>
        <span className="text-[10.5px] text-slate-400">
          {total} risks · {mode}
        </span>
      </div>
    </div>
  );
}
