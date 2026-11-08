'use client';

// What happened to the file, in order, as one strip under the head (the model is recordModel.timelineOf). A dot and a word per step, never colour alone: a step that happened is a
// filled dot, the one in progress is ringed, one still to come is hollow, one that needs a look is amber and one that went wrong is red; each carries its own words ("Done", "In progress",
// ...) for a screen reader. Across on a desktop, one under another on a phone.
import { clsx } from 'clsx';
import { formatDate, formatDateTime } from '@/lib/format';
import type { StepState, TimelineStep } from './recordModel';

const DOT: Record<StepState, string> = {
  done: 'bg-ds-success',
  now: 'bg-ds-surface ring-[3px] ring-ds-primary',
  todo: 'border-2 border-ds-border-strong bg-ds-surface',
  warn: 'bg-ds-warning',
  bad: 'bg-ds-danger',
};
const STATE_WORD: Record<StepState, string> = { done: 'Done', now: 'In progress', todo: 'Still to come', warn: 'Needs a look', bad: 'Problem' };
const LINE: Record<StepState, string> = { done: 'bg-ds-success', now: 'bg-ds-border-strong', todo: 'bg-ds-border', warn: 'bg-ds-border-strong', bad: 'bg-ds-border-strong' };

export function RecordTimeline({ steps }: { steps: readonly TimelineStep[] }) {
  return (
    <ol aria-label="What happened to this file" className="m-0 flex list-none flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px] md:flex-row md:gap-0">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        // a validity date is a day; the rest are moments
        const when = step.key === 'validity' ? formatDate(step.when, { calendar: true, empty: '' }) : formatDateTime(step.when, { empty: '' });
        const facts = [when, step.who].filter(Boolean).join(' · ');
        return (
          <li key={step.key} data-step={step.key} data-state={step.state} className="flex min-w-0 gap-[10px] md:flex-1 md:flex-col md:gap-[8px] md:pr-[8px]">
            <div className="flex shrink-0 items-start pt-[3px] md:w-full md:items-center md:pt-0">
              <span aria-hidden className={clsx('relative z-10 box-border h-[14px] w-[14px] shrink-0 rounded-full', DOT[step.state])} />
              {!last && <span aria-hidden className={clsx('ml-[6px] hidden h-[2px] flex-1 md:block', LINE[step.state])} />}
            </div>
            <div className="min-w-0">
              <p className="break-words text-ds-body font-[500] text-ds-fg"><span className="sr-only">{STATE_WORD[step.state]}: </span>{step.label}</p>
              {facts && <p className="break-words text-ds-label text-ds-fg-muted">{facts}</p>}
              {step.text && <p className="break-words text-ds-label text-ds-fg-body [overflow-wrap:anywhere]">{step.text}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
