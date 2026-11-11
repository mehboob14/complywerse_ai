'use client';

// ChartCard: the card every chart and figure of an Overview sits in. A title with its (i), a line of facts, the card's own controls on the right, then ONE of
// five states, never confused: loading (a skeleton of the chart's own height, announced), failed (what failed and Retry, never an empty chart), "No access"
// (the person may not see it: a lock and why), nothing to show (a plain line that says what fills it), or the chart. A failed or refused request is never drawn
// as a chart of zeros. The card fills the height of its grid cell so a row of cards is level.
//
//   <ChartCard id="by-status" title="Issues by status" info="…" state="ready">…</ChartCard>
//   <ChartCard id="trend" title="Open issues, 12 months" state="empty" emptyText="No history yet. It builds up as issues are raised and closed.">
//
// Tokens and arbitrary values only (kit rules). The heading takes `!` like the kit's SectionCard (the shell remaps a bare h2).
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { Lock } from 'lucide-react';
import { InfoTip } from '../../ui/InfoTip';
import { ErrorState } from '../../ui/ds';

export type ChartState = 'loading' | 'error' | 'denied' | 'empty' | 'ready';

export interface ChartCardProps {
  /** the card's anchor, and what names its heading */
  id: string;
  title: string;
  /** what the chart rests on, from an (i) beside the title (not a sentence under it) */
  info?: string;
  /** one line of facts beside the title: "Last 12 months" */
  meta?: ReactNode;
  /** the card's own controls (a pivot, a link to the records), on the right of the title row */
  actions?: ReactNode;
  state: ChartState;
  /** `error`: what failed, in the server's words, and Retry when asking again can help */
  error?: { title?: string; message?: string; onRetry?: () => void } | null;
  /** `empty`: what the card would show and what fills it, one plain line: "No issues yet. They appear here once one is raised." */
  emptyText?: string;
  /** `denied`: why the person may not see it ("Your role cannot read vendor scores.") */
  deniedText?: string;
  /** `loading`: how tall the chart will be, so the card does not jump (default 160) */
  loadingHeight?: number;
  /** layout only (min-height, margin) */
  className?: string;
  children?: ReactNode;
}

export function ChartCard({ id, title, info, meta, actions, state, error, emptyText, deniedText, loadingHeight = 160, className, children }: ChartCardProps) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className={clsx('flex h-full min-w-0 scroll-mt-[64px] flex-col rounded-ds-card border border-ds-border bg-ds-surface p-[16px]', className)}>
      <div className="mb-[12px] flex flex-wrap items-center gap-x-[4px] gap-y-[8px]">
        <h2 id={`${id}-h`} className="min-w-0 break-words !text-ds-section !text-ds-fg">{title}</h2>
        {info && <InfoTip text={info} label={`About ${title.toLowerCase()}`} />}
        {meta && <span className="ml-[4px] text-ds-body text-ds-fg-muted">{meta}</span>}
        {actions && <div className="ml-auto flex max-w-full flex-wrap items-center gap-[8px]">{actions}</div>}
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        {state === 'loading' && (
          <div role="status" aria-busy="true">
            <span className="sr-only">{`Loading ${title.toLowerCase()}`}</span>
            <div aria-hidden style={{ height: loadingHeight }} className="w-full animate-pulse rounded-ds-control bg-ds-border" />
          </div>
        )}
        {state === 'error' && <ErrorState compact title={error?.title ?? `Couldn't load ${title.toLowerCase()}`} message={error?.message} onRetry={error?.onRetry} />}
        {state === 'denied' && (
          <p role="status" className="flex min-h-[32px] items-center gap-[6px] text-ds-body text-ds-fg-muted">
            <Lock aria-hidden className="h-[14px] w-[14px] shrink-0" strokeWidth={1.75} />
            {deniedText ?? 'Your role cannot see this.'}
          </p>
        )}
        {state === 'empty' && <p className="py-[8px] text-ds-body text-ds-fg-muted">{emptyText ?? 'Nothing to show yet.'}</p>}
        {state === 'ready' && children}
      </div>
    </section>
  );
}
