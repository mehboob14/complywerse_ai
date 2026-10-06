'use client';
// Where the review is in its six stages, as an ordered list a screen reader can read ("Step 3,
// Run rules, current step") and a sighted reader can scan. Done, current and up next are said
// in words as well as shown in colour and shape.

import { Check } from 'lucide-react';
import { clsx } from 'clsx';
import { STAGES, stageState } from '../../pipeline';
import type { StageIndex } from '../../types';

export function Stepper({ stage, closed }: { stage: StageIndex; closed: boolean }) {
  return (
    <nav aria-label="Review progress">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {STAGES.map((s) => {
          const state = stageState(s.n, stage, closed);
          const word = state === 'done' ? 'Done' : state === 'current' ? 'Current step' : 'Up next';
          return (
            <li key={s.n} aria-current={state === 'current' ? 'step' : undefined}
              className={clsx('flex items-start gap-3 rounded-lg border px-3 py-2.5',
                state === 'current' ? 'border-teal-700 bg-teal-50' : state === 'done' ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-50')}>
              <span aria-hidden className={clsx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                state === 'done' ? 'bg-teal-700 text-white' : state === 'current' ? 'border-2 border-teal-700 bg-white text-teal-900' : 'border border-slate-400 bg-white text-slate-700')}>
                {state === 'done' ? <Check size={14} /> : s.n}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">{s.label}</span>
                <span className={clsx('block text-xs', state === 'current' ? 'font-medium text-teal-900' : 'text-slate-600')}>
                  <span className="sr-only">Step {s.n}: </span>{word}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
