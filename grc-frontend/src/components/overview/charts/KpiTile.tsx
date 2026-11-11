'use client';

// KpiTile: the figure a dashboard leads with: the label, the figure at 24px, which way it moved ("Up 3", with an arrow, in the colour that says whether that is
// good for THIS figure) and its shape over time (a Sparkline), a bar when the figure is a share, the figure as a link when it opens the records. The five states are
// the StatTile's and never confused (statModel.ts): the figure, "Not recorded" (value null: nothing is recorded, which is not 0), loading, failed with Retry, and
// "No access". A refused or failed request is never a 0. Use it in a KpiRow; a plain number with nothing to say over time is the kit's StatTile.
//
//   <KpiTile label="Open issues" value={formatCount(42)} href="/issues/register?chip=open" linkLabel="42 open issues. Open the register" tone="danger"
//     delta={deltaOf(changeOf(series), 'down')} spark={{ values: series, label: 'Open issues, last 12 months', summary: trendText('Open issues', points) }} />
import type { ReactNode } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { ArrowDown, ArrowRight, ArrowUp, Lock } from 'lucide-react';
import { InfoTip } from '../../ui/InfoTip';
import { ErrorState, ProgressBar, Skeleton } from '../../ui/ds';
import { NOT_RECORDED, NO_ACCESS, tileState } from '../../ui/ds/statModel';
import type { Direction, DeltaTone } from './chartModel';
import { Sparkline, type SparklineProps } from './Sparkline';
import { BRAND, STATUS } from './palette';

export type KpiTone = 'default' | 'success' | 'warning' | 'danger';

export interface KpiTileProps {
  label: string;
  /** the figure as text (formatCount(n)); null: nothing is recorded, the tile says "Not recorded" and never 0 */
  value: string | null;
  /** what the figure counts, after it */
  unit?: string;
  /** a line of facts under the figure ("3 of 40 vendors") */
  note?: ReactNode;
  /** what the figure rests on, from an (i) */
  info?: string;
  /** the figure opens the records behind it, and the name that link has for a screen reader */
  href?: string;
  linkLabel?: string;
  /** the colour of the figure: danger for something wrong, success for something done */
  tone?: KpiTone;
  /** which way it moved: deltaOf(changeOf(series), 'down') (words, an arrow and a tone: never the colour alone) */
  delta?: { text: string; direction: Direction; tone: DeltaTone; /** "since last month" */ since?: string } | null;
  /** its shape over time */
  spark?: Pick<SparklineProps, 'values' | 'label' | 'summary' | 'floor'> | null;
  /** a bar under the figure, 0 to 100, for a share */
  progress?: number | null;
  denied?: boolean;
  loading?: boolean;
  error?: { title: string; message?: string; onRetry?: () => void } | null;
  className?: string;
  children?: ReactNode;
}

const TONE: Record<KpiTone, string> = { default: 'text-ds-fg', success: 'text-ds-success', warning: 'text-ds-warning', danger: 'text-ds-danger' };
const SPARK: Record<KpiTone, string> = { default: BRAND, success: STATUS.good, warning: STATUS.warn, danger: STATUS.bad };
const DELTA_TEXT: Record<DeltaTone, string> = { good: 'text-ds-success', bad: 'text-ds-danger', neutral: 'text-ds-fg-muted' };
const ARROW = { up: ArrowUp, down: ArrowDown, flat: ArrowRight } as const;

export function KpiTile({ label, value, unit, note, info, href, linkLabel, tone = 'default', delta, spark, progress, denied = false, loading = false, error = null, className, children }: KpiTileProps) {
  const state = tileState({ denied, error: error !== null, loading, value });
  const Arrow = delta ? ARROW[delta.direction] : null;
  return (
    <div className={clsx('flex min-w-0 flex-col rounded-ds-card border border-ds-border bg-ds-surface p-[16px]', className)}>
      <div className="flex items-center gap-[4px]">
        <p className="min-w-0 break-words text-ds-label text-ds-fg-muted">{label}</p>
        {info && state === 'value' && <InfoTip text={info} label={`About ${label.toLowerCase()}`} />}
      </div>

      {state === 'denied' && (
        <div className="mt-[4px] flex min-h-[32px] items-center gap-[6px] text-ds-body text-ds-fg-muted">
          <Lock aria-hidden className="h-[14px] w-[14px] shrink-0" strokeWidth={1.75} />
          {NO_ACCESS}
          {info && <InfoTip text={info} label={`Why ${label.toLowerCase()} is not shown`} />}
        </div>
      )}
      {state === 'loading' && (
        <div role="status" aria-busy="true" className="mt-[8px] space-y-[8px]">
          <span className="sr-only">{`Loading ${label.toLowerCase()}`}</span>
          <Skeleton className="h-[28px] w-[96px]" />
          <Skeleton className="h-[12px] w-[70%]" />
        </div>
      )}
      {state === 'error' && error && <ErrorState compact title={error.title} message={error.message} onRetry={error.onRetry} className="mt-[4px]" />}
      {state === 'empty' && (
        <div className="mt-[4px] flex min-h-[32px] items-center gap-[4px] text-ds-body text-ds-fg-muted">
          {NOT_RECORDED}
          {info && <InfoTip text={info} label={`Why ${label.toLowerCase()} is not recorded`} />}
        </div>
      )}

      {state === 'value' && (
        <>
          <div className="mt-[4px] flex items-end justify-between gap-[8px]">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-[8px]">
              {href ? (
                <Link href={href} aria-label={linkLabel ?? `${value} ${label.toLowerCase()}`} className={clsx('w-fit min-w-[24px] rounded-ds-control text-[24px] font-[600] leading-[32px] tabular-nums hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring', TONE[tone])}>{value}</Link>
              ) : (
                <p className={clsx('text-[24px] font-[600] leading-[32px] tabular-nums', TONE[tone])}>{value}</p>
              )}
              {unit && <span className="text-ds-body text-ds-fg-muted">{unit}</span>}
            </div>
            {spark && <Sparkline {...spark} color={SPARK[tone]} />}
          </div>
          {progress != null && <ProgressBar value={progress} label={label} showValue={false} className="mt-[8px]" />}
          {delta && Arrow && (
            <p className={clsx('mt-[8px] flex items-center gap-[4px] text-ds-label', DELTA_TEXT[delta.tone])}>
              <Arrow aria-hidden className="h-[12px] w-[12px] shrink-0" strokeWidth={2} />
              <span>{delta.since ? `${delta.text} ${delta.since}` : delta.text}</span>
            </p>
          )}
          {note && <div className="mt-[4px] text-ds-label font-normal text-ds-fg-muted">{note}</div>}
          {children && <div className="mt-[8px]">{children}</div>}
        </>
      )}
    </div>
  );
}

/** A row of KpiTiles that takes the width it has: as many columns as fit at 170px, two on a phone. */
export function KpiRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-[12px]', className)}>{children}</div>;
}
