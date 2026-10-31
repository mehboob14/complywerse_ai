'use client';

// ProgressBar: a bar and its number. A real `role="progressbar"` with `aria-valuenow` and the words ("72%") as `aria-valuetext`, named by `label` so a screen
// reader says what it measures. The number is shown beside the bar unless `showValue` is false: the same words, hidden from the reader so they are not
// heard twice, at least four characters wide and right-aligned so a column of bars ends in the same place. A stored value outside 0-100 fills the track
// and no more; a value that is not recorded draws no bar, a dash and, for a screen reader, "<label>: not recorded": it is never read as 0%. The rules
// are statModel.ts (tested). Tokens and arbitrary values only (kit rules).
//
//   <ProgressBar value={project.completion} label={`${project.name} completion`} className="w-[160px]" />
import { clsx } from 'clsx';
import { EMPTY } from '@/lib/format';
import { NOT_RECORDED, barReading } from './statModel';

export type ProgressTone = 'primary' | 'success' | 'warning' | 'danger';

export interface ProgressBarProps {
  /** a percent, 0 to 100 (72 is 72%); null or undefined: not recorded */
  value: number | null | undefined;
  /** what the bar measures: "Delivery progress". Read out with the value; never drawn */
  label: string;
  /** the words beside the bar, instead of the percent: "3 of 5 steps" (the bar is still drawn from `value`) */
  valueText?: string;
  /** false: the bar alone (a tile that already shows the figure) */
  showValue?: boolean;
  /** the colour of the fill; the default is the brand */
  tone?: ProgressTone;
  /** layout only (width, margin): the bar fills the width it is given */
  className?: string;
}

const FILL: Record<ProgressTone, string> = { primary: 'bg-ds-primary', success: 'bg-ds-success', warning: 'bg-ds-warning', danger: 'bg-ds-danger' };

export function ProgressBar({ value, label, valueText, showValue = true, tone = 'primary', className }: ProgressBarProps) {
  const bar = barReading(value, valueText);
  if (bar.percent === null) {
    return (
      <span className={clsx('flex items-center text-ds-label text-ds-fg-muted', className)}>
        <span aria-hidden>{EMPTY}</span>
        <span className="sr-only">{`${label}: ${NOT_RECORDED.toLowerCase()}`}</span>
      </span>
    );
  }
  return (
    <div className={clsx('flex items-center gap-[8px]', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={bar.now ?? undefined}
        aria-valuetext={bar.text}
        className="h-[6px] min-w-[24px] flex-1 overflow-hidden rounded-full bg-ds-border"
      >
        <div className={clsx('h-full rounded-full', FILL[tone])} style={{ width: `${bar.percent}%` }} />
      </div>
      {showValue && <span aria-hidden className="min-w-[4ch] shrink-0 whitespace-nowrap text-right text-ds-label tabular-nums text-ds-fg-body">{bar.text}</span>}
    </div>
  );
}
