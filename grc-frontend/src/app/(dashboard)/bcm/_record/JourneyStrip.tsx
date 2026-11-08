'use client';

// The strip under a plan's or a drill's head that says where the record stands on its way (recordModel.planJourney / drillJourney): the steps in order, the one it is at lit, the ones
// behind it ticked. It is read-only (a status is moved from "Change status", which the server lets happen in any order for a plan), and it says its state in words for a screen reader
// (the lit step is `aria-current="step"`). A retired plan and a cancelled drill are off the way: the strip is dimmed, and the pill in the head says which.
import { Check, ChevronRight } from 'lucide-react';
import { clsx } from 'clsx';
import type { Journey } from './recordModel';

const STEP = 'inline-flex min-h-ds-control-sm items-center gap-[4px] rounded-full px-[10px] text-ds-body';

export function JourneyStrip({ journey, label }: { journey: Journey; label: string }) {
  return (
    <ol aria-label={label} className={clsx('m-0 flex list-none flex-wrap items-center gap-x-[4px] gap-y-[6px] p-0', journey.off && 'opacity-70')}>
      {journey.steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-[4px]">
          {i > 0 && <ChevronRight aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />}
          <span
            aria-current={s.state === 'current' ? 'step' : undefined}
            className={clsx(STEP, s.state === 'current' ? 'bg-ds-primary-soft font-[600] text-ds-primary-text' : s.state === 'done' ? 'text-ds-fg-body' : 'text-ds-fg-muted')}
          >
            {s.state === 'done' && <Check aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-success" strokeWidth={2} />}
            {s.label}
            <span className="sr-only">{s.state === 'done' ? ', done' : s.state === 'current' ? ', where it is now' : ', not reached'}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
