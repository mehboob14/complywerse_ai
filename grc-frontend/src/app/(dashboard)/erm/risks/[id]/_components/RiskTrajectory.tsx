'use client';

import { ArrowRight, BarChart3 } from 'lucide-react';
import clsx from 'clsx';
import type { RiskBand } from '@/lib/riskBands';
import { gapToTarget, riskTrajectory } from '../../_components/riskRecord';

const BAND: Record<RiskBand, { label: string; style: string }> = {
  critical: { label: 'Critical', style: 'border-rose-200 bg-rose-50 text-rose-700' },
  high: { label: 'High', style: 'border-orange-200 bg-orange-50 text-orange-700' },
  medium: { label: 'Medium', style: 'border-amber-200 bg-amber-50 text-amber-700' },
  low: { label: 'Low', style: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
};

type Scored = Partial<Record<`${'inherent' | 'residual' | 'target'}_${'likelihood' | 'impact' | 'score'}`, number | null>>;

/** Before controls → After controls → Target, each in its band, with likelihood × impact underneath. */
export default function RiskTrajectory({ risk }: { risk: Scored }) {
  const steps = riskTrajectory(risk);
  const gap = gapToTarget(risk);
  return (
    <div className="cw-card rounded-xl p-4">
      <div className="mb-3 flex items-center justify-between gap-2 text-xs font-medium text-slate-500">
        <span className="flex items-center gap-1.5"><BarChart3 className="h-3.5 w-3.5" strokeWidth={1.75} /> Risk scores</span>
        {gap != null && <span className={gap === 0 ? 'text-emerald-700' : 'text-slate-600'}>{gap === 0 ? 'At target' : `${gap} above target`}</span>}
      </div>
      <ol className="flex items-stretch gap-1">
        {steps.map((step, idx) => (
          <li key={step.key} className="flex min-w-0 flex-1 items-center gap-1">
            <div className={clsx('min-w-0 flex-1 rounded-lg border px-2 py-2',
              step.band ? BAND[step.band].style : 'border-slate-200 bg-slate-50 text-slate-500')}>
              <p className="truncate text-[10px] font-semibold uppercase tracking-wider opacity-80">{step.label}</p>
              <p className="text-base font-bold tabular-nums">{step.score ?? '—'}<span className="text-[11px] font-normal opacity-70"> / 25</span></p>
              <p className="truncate text-[11px]">
                {step.band ? BAND[step.band].label : 'Not scored'}
                <span className="opacity-70"> · L {risk[`${step.key}_likelihood`] ?? '—'} × I {risk[`${step.key}_impact`] ?? '—'}</span>
              </p>
            </div>
            {idx < steps.length - 1 && <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
          </li>
        ))}
      </ol>
    </div>
  );
}
