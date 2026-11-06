'use client';

// StatTile: one number a page opens with. The label, the figure at 24px, what it counts (`unit`), a line of facts under it (`note`), an (i) that says what the
// figure rests on, a bar when the figure is a share (`progress`), the figure as a link when it opens the records (`link`), and room under it for pills or
// links (`children`). Five states, never confused: the figure; "Not recorded" (`value` null: nothing is recorded, which is not 0); loading (a skeleton
// that is announced); failed (what failed and Retry, `error`); and "No access" (`denied`: the person may not see this figure, with an (i) that says why).
// A refused or failed request is never drawn as a 0. The rules are statModel.ts (tested).
//
//   <StatTile label="Documents" value={formatCount(41)} unit="documents" note="3 archived" link={{ href: '/governance/documents', label: '41 documents. Open the library' }} />
//   <StatTile label="Attendance" value={null} info="No meeting has been marked completed yet." />
//
// The tile is a box, not a button: its (i) and its link are controls of their own. Tokens and arbitrary values only (kit rules).
import type { ReactNode } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { Lock } from 'lucide-react';
import { InfoTip } from '../InfoTip';
import { ErrorState } from './ErrorState';
import { ProgressBar } from './ProgressBar';
import { Skeleton } from './Skeleton';
import { NOT_RECORDED, NO_ACCESS, tileState } from './statModel';

export type StatTone = 'default' | 'success' | 'warning' | 'danger';

export interface StatTileProps {
  /** what the figure is: "Open reviews". 12px, above the figure */
  label: string;
  /** the figure as text (formatCount(n)); null means nothing is recorded: the tile says "Not recorded" and never 0 */
  value: string | null;
  /** what the figure counts, after it: "documents" */
  unit?: string;
  /** a line of facts under the figure: "3 archived", "32 of 41 documents mapped" (a node, so it can hold a link) */
  note?: ReactNode;
  /** what the figure rests on, from an (i) beside the label; with no figure (`value` null) it says why there is none, beside "Not recorded"; when `denied`, why the person may not see it */
  info?: string;
  /** the figure opens the records behind it: where, and the name the link has for a screen reader ("41 documents. Open the library") */
  link?: { href: string; label: string };
  /** the colour of the figure: danger for something wrong, success for something done */
  tone?: StatTone;
  /** a bar under the figure, 0 to 100, for a figure that is a share (null: no bar) */
  progress?: number | null;
  /** the person may not see this figure (the server refused, or their role has no right to it): "No access" with a lock, and the (i) says why. It wins over
   *  `loading`, `error` and `value`: nothing is waited for, retried or shown */
  denied?: boolean;
  /** the request has not answered yet: a skeleton in place of the figure */
  loading?: boolean;
  /** the request failed: what, in the server's words, and Retry when trying again can help. Shown in place of the figure */
  error?: { title: string; message?: string; onRetry?: () => void } | null;
  /** more under the figure: pills, links (each with its own margin) */
  children?: ReactNode;
  /** layout only (width, margin) */
  className?: string;
}

const TILE = 'flex min-w-0 flex-col rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
// the kit has no size between its 20px title and the page; a figure is read first, so it gets 24px on a 32px line
const FIGURE = 'text-[24px] font-[600] leading-[32px] tabular-nums';
const TONE: Record<StatTone, string> = { default: 'text-ds-fg', success: 'text-ds-success', warning: 'text-ds-warning', danger: 'text-ds-danger' };

export function StatTile({ label, value, unit, note, info, link, tone = 'default', progress, denied = false, loading = false, error = null, children, className }: StatTileProps) {
  const state = tileState({ denied, error: error !== null, loading, value });
  const figure = clsx(FIGURE, TONE[tone]);
  return (
    <div className={clsx(TILE, className)}>
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
          <div className="mt-[4px] flex flex-wrap items-baseline gap-x-[8px]">
            {link ? (
              <Link href={link.href} aria-label={link.label} className={clsx('w-fit min-w-[24px] rounded-ds-control hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring', figure)}>{value}</Link>
            ) : (
              <p className={figure}>{value}</p>
            )}
            {unit && <span className="text-ds-body text-ds-fg-muted">{unit}</span>}
          </div>
          {progress != null && <ProgressBar value={progress} label={label} showValue={false} className="mt-[8px]" />}
          {note && <div className="mt-[8px] text-ds-label font-normal text-ds-fg-muted">{note}</div>}
          {children && <div className="mt-[8px]">{children}</div>}
        </>
      )}
    </div>
  );
}
