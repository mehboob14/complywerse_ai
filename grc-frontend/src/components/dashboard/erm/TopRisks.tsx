'use client';

import Link from 'next/link';
import { ChevronDown, TrendingDown } from 'lucide-react';
import type { TopRisk } from './types';
import { severityOf } from './scoring';

/**
 * Top risks by residual — inherent → residual "dumbbell" on the 0–25 scale.
 * Hollow dot = inherent, solid (severity-colored) dot = residual, connector =
 * the reduction; the trailing figure is the points shaved off.
 */
export default function TopRisks({ risks }: { risks: TopRisk[] }) {
  const sorted = [...risks].sort((a, b) => b.residual - a.residual);
  const sumInherent = sorted.reduce((sum, r) => sum + r.inherent, 0);
  const sumResidual = sorted.reduce((sum, r) => sum + r.residual, 0);

  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-rose-600" />
          <span className="text-sm font-semibold text-slate-800">Top Risks by Residual</span>
        </div>
        <span className="flex items-center gap-3 text-[9.5px] text-slate-400">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full border-2 border-slate-300" />
            inherent
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-slate-600" />
            residual
          </span>
        </span>
      </div>

      <div className="flex flex-col">
        {sorted.map((risk) => {
          const sev = severityOf(risk.residual);
          const inhLeft = (risk.inherent / 25) * 100;
          const resLeft = (risk.residual / 25) * 100;
          const delta = risk.inherent - risk.residual;
          return (
            <Link
              key={risk.id}
              href="/erm/risks/list"
              title={`${risk.title} — inherent ${risk.inherent} → residual ${risk.residual} (−${delta} on the 25-pt scale) · open the risk register`}
              className="grid grid-cols-[72px_1fr_44px] items-center gap-2.5 border-t border-slate-100 py-2.5 transition-colors first:border-t-0 hover:bg-slate-50/70"
            >
              <span className={`rounded-full py-[3px] text-center text-[9.5px] font-bold uppercase tracking-wide ${sev.pill}`}>
                {sev.label}
              </span>
              <div className="min-w-0">
                <div className="mb-1.5 truncate text-[11.5px] text-slate-700">{risk.title}</div>
                <div className="relative h-2">
                  <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-slate-100" />
                  <div
                    className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full opacity-40"
                    style={{ left: `${resLeft}%`, width: `${inhLeft - resLeft}%`, backgroundColor: sev.color }}
                  />
                  <span
                    className="absolute top-1/2 h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-300 bg-white"
                    style={{ left: `${inhLeft}%` }}
                  />
                  <span
                    className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{ left: `${resLeft}%`, backgroundColor: sev.color }}
                  />
                </div>
              </div>
              {delta > 0 ? (
                <span className="flex items-center justify-end gap-0.5 text-[11px] font-semibold text-emerald-600">
                  <ChevronDown className="h-3 w-3" strokeWidth={2.4} />
                  {delta}
                </span>
              ) : (
                <span className="text-right text-[11px] font-medium text-slate-300">—</span>
              )}
            </Link>
          );
        })}
      </div>

      {sorted.length > 0 && (
        <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3 text-[10.5px] text-slate-500">
          <span>
            Σ inherent <span className="font-semibold text-slate-700">{sumInherent}</span>
            {' → '}Σ residual <span className="font-semibold text-slate-700">{sumResidual}</span>
          </span>
          <span className="flex items-center gap-1 font-semibold text-emerald-600">
            <ChevronDown className="h-3 w-3" strokeWidth={2.4} />
            {sumInherent - sumResidual} pts treated away
          </span>
        </div>
      )}
    </div>
  );
}
