'use client';

// The life cycle of ONE document as a stepper: Draft > In review > In approval > Approved > Published > Attestation > Acknowledgement, each done, here, next or not part of this document's
// path, with the date the platform has and a word (never colour alone: a tick, a ring, a warning mark and a word for a screen reader). Wide, the seven are a row; in a narrow box they are
// a list, one step a line. The rules are detailModel.ts (tested).
import { useRef } from 'react';
import { clsx } from 'clsx';
import { AlertTriangle, Check } from 'lucide-react';
import { useContainerWidth } from '@/components/records/useContainerWidth';
import { dayOf } from '../libraryTracker';
import type { DetailStep } from './detailModel';

/** Below this width of its own box the stepper is a list. */
const LIST_BELOW = 640;

function Pin({ step }: { step: DetailStep }) {
  const box = 'grid h-[20px] w-[20px] shrink-0 place-items-center rounded-full border-2';
  if (step.state === 'done') return <span className={clsx(box, 'border-ds-success bg-ds-success text-ds-on-primary')}><Check className="h-[12px] w-[12px]" strokeWidth={3} /></span>;
  if (step.state === 'here' && step.problem) return <span className={clsx(box, 'border-ds-warning bg-ds-warning-soft text-ds-warning')}><AlertTriangle className="h-[12px] w-[12px]" strokeWidth={2.5} /></span>;
  if (step.state === 'here') return <span className={clsx(box, 'border-ds-primary bg-ds-surface')}><span className="h-[8px] w-[8px] rounded-full bg-ds-primary" /></span>;
  if (step.state === 'off') return <span className={clsx(box, 'border-ds-border bg-ds-surface-subtle')} />;
  return <span className={clsx(box, 'border-ds-border-control bg-ds-surface')} />;
}

const STATE_WORD: Record<DetailStep['state'], string> = { done: 'Done', here: 'Now', next: 'Not yet', off: 'Not part of the path' };
/** What a screen reader says for a step: "In review: On hold, since 4 Nov 2026". */
const GENERIC: ReadonlySet<string> = new Set(['', 'Done', 'Now', 'Not yet', 'Not in use']);
/** The word a step adds to its name, if it has one of its own ("On hold", "4 of 12"); '' for the plain Done / Now / Not yet. */
const own = (s: DetailStep): string => (GENERIC.has(s.word) ? '' : s.word);
export const stepSpeech = (s: DetailStep): string => `${GENERIC.has(s.word) ? STATE_WORD[s.state] : s.word}${s.date ? `, ${dayOf(s.date)}` : ''}`;

export function TrackerStepper({ steps, label }: { steps: readonly DetailStep[]; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(box);
  const list = width != null && width < LIST_BELOW;
  const last = steps.length - 1;
  const firstHere = steps.findIndex((s) => s.state === 'here');
  return (
    <div ref={box} className="min-w-0">
      {list ? (
        <ol aria-label={label} className="m-0 flex list-none flex-col gap-[6px] p-0">
          {steps.map((s, i) => (
            <li key={s.id} aria-current={i === firstHere ? 'step' : undefined} className="flex min-w-0 items-center gap-[8px]">
              <Pin step={s} />
              <span className={clsx('min-w-0 flex-1 text-ds-body [overflow-wrap:anywhere]', s.state === 'here' ? 'font-[600] text-ds-fg' : s.state === 'done' ? 'text-ds-fg-body' : 'text-ds-fg-muted')}>
                {s.name}
                <span className="sr-only">{`: ${stepSpeech(s)}`}</span>
              </span>
              <span aria-hidden className={clsx('shrink-0 text-ds-label', s.problem ? 'font-[600] text-ds-warning' : 'text-ds-fg-muted')}>{[own(s), s.date ? dayOf(s.date) : ''].filter(Boolean).join(' · ')}</span>
            </li>
          ))}
        </ol>
      ) : (
        <ol aria-label={label} className="m-0 grid list-none grid-cols-7 p-0">
          {steps.map((s, i) => {
            const reached = s.state === 'done' || s.state === 'here';
            const caption = own(s);
            return (
              <li key={s.id} aria-current={i === firstHere ? 'step' : undefined} className="min-w-0">
                <div aria-hidden className="flex items-center">
                  <span className={clsx('h-[2px] flex-1', i === 0 ? 'bg-transparent' : reached ? 'bg-ds-success' : 'bg-ds-border')} />
                  <Pin step={s} />
                  <span className={clsx('h-[2px] flex-1', i === last ? 'bg-transparent' : s.state === 'done' ? 'bg-ds-success' : 'bg-ds-border')} />
                </div>
                <span className={clsx('mt-[4px] block px-[2px] text-center text-ds-label [overflow-wrap:anywhere]', s.state === 'here' ? 'font-[600] text-ds-fg' : s.state === 'done' ? 'text-ds-fg-body' : 'text-ds-fg-muted')}>
                  {s.name}
                  <span className="sr-only">{`: ${stepSpeech(s)}`}</span>
                </span>
                {caption && <span aria-hidden className={clsx('block px-[2px] text-center text-ds-label [overflow-wrap:anywhere]', s.problem ? 'font-[600] text-ds-warning' : 'text-ds-fg-muted')}>{caption}</span>}
                {s.date && <span aria-hidden className="block px-[2px] text-center text-ds-label text-ds-fg-muted">{dayOf(s.date)}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
